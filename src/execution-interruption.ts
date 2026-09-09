import path from "node:path"
import {createHash} from "node:crypto"
import {readFile} from "node:fs/promises"
import {atomicText} from "./fs.js"
import {discoverWorkflows} from "./dashboard/model.js"
import {profileFor} from "./catalog.js"
import {workflowTransition} from "./transition.js"

const name = "execution-interruption.json"
function fingerprint(state: any) {
  return createHash('sha256').update(JSON.stringify([state.status,state.currentStage,state.updatedAt,state.preparedStage,state.checkpoints])).digest('hex')
}
export async function readExecutionInterruption(root: string, state: any) {
  try {
    const record = JSON.parse(await readFile(path.join(root,'.ddd',name),'utf8'))
    return record.fingerprint === fingerprint(state) ? record : undefined
  } catch { return undefined }
}

export function isInterruptedReply(messages: any[]) {
  const sorted = [...messages].sort((a,b)=>(a.info.time?.created ?? 0)-(b.info.time?.created ?? 0))
  const last = sorted.at(-1)
  if (!last || last.info.role !== 'assistant' || !last.info.time?.completed) return undefined
  // The caller verifies workflow/session binding; slash commands use the user's agent.
  // A new user message, cancellation or tool execution must never cause automatic recovery.
  if (last.info.error?.name === 'MessageAbortedError') return undefined
  if (last.parts.some((p:any)=>p.type==='tool' || p.type==='text' && p.text?.trim())) return undefined
  if (!['unknown','length','stop'].includes(last.info.finish) && !last.info.error) return undefined
  return last.info
}

/** No model calls or business state mutations. Idle is not workflow completion. */
export function createInterruptionMonitor(project: string, client: any) {
  const pending = new Set<string>()
  return async (sessionID: string) => {
    if (pending.has(sessionID)) return
    pending.add(sessionID)
    try {
      const items = (await discoverWorkflows(project)).filter(w=>!w.archived && !w.issues.length && w.state?.runtimeSessionId===sessionID)
      if (!items.length) return
      const response = await client.session.messages({path:{id:sessionID},query:{directory:project,limit:4}})
      if (response.error || !Array.isArray(response.data)) return
      const info = isInterruptedReply(response.data)
      if (!info) return
      for (const item of items) {
        const state=item.state!
        const transition=workflowTransition(await profileFor(state.workflowType),state)
        if (transition.stopAllowed !== false || Date.parse(state.updatedAt)>info.time.completed) continue
        const old=await readExecutionInterruption(item.root,state)
        if (old?.messageID===info.id) continue
        const message=`DDD 执行中断，尚未到人工检查点。停在 ${state.preparedStage?.stage ?? state.currentStage}；模型回复结束（${info.finish ?? 'error'}），没有正文或工具调用。已保留阶段进度；确认继续时输入 /ddd ${state.workflowId}。不会自动重试或批准。`
        await atomicText(path.join(item.root,'.ddd',name),JSON.stringify({fingerprint:fingerprint(state),messageID:info.id,sessionID,finish:info.finish,detectedAt:new Date().toISOString(),message},null,2))
        await client.tui.showToast({body:{title:'DDD 执行中断',message,variant:'warning',duration:15000},query:{directory:project}})
      }
    } finally { pending.delete(sessionID) }
  }
}
