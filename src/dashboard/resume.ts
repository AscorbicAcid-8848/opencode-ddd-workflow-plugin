import { realpath } from "node:fs/promises"
import { randomBytes } from "node:crypto"
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import { discoverWorkflows, type WorkflowItem } from "./model.js"

const inFlight = new Set<string>()
const sameDirectory = async (a: string, b: string) => {
  const paths = await Promise.all([realpath(a), realpath(b)])
  return process.platform === "win32" ? paths[0].toLowerCase() === paths[1].toLowerCase() : paths[0] === paths[1]
}

export async function projectSessions(project: string, client: TuiPluginApi["client"]) {
  const result = await client.session.list({ directory: project })
  if (result.error || !result.data) throw new Error("无法读取项目会话")
  const sessions = []
  for (const session of result.data) {
    if (session.time.archived || session.parentID) continue
    try { if (await sameDirectory(session.directory, project)) sessions.push(session) } catch { /* inaccessible directory */ }
  }
  return sessions.sort((a, b) => b.time.updated - a.time.updated)
}

/** Dispatch only. Session history is recorded by the lifecycle tool, not browsing or selection. */
export async function resumeInSession(item: WorkflowItem, target: string | null, client: TuiPluginApi["client"]) {
  const key = `${item.project}:${item.key}`
  if (inFlight.has(key)) throw new Error("工作流正在提交续跑请求")
  inFlight.add(key)
  try {
    const fresh = (await discoverWorkflows(item.project)).find(w => w.key === item.key)
    if (!fresh?.state || fresh.archived || fresh.legacy || fresh.issues.length || ["complete", "rejected"].includes(fresh.state.status)) throw new Error("该工作流不可续跑，请刷新查看")
    const statuses = await client.session.status({ directory: item.project })
    if (statuses.error || !statuses.data) throw new Error("无法确认会话是否空闲")
    const linked = new Set([fresh.state.runtimeSessionId, ...(fresh.state.runtimeSessionIds ?? [])])
    for (const id of linked) {
      if (id && statuses.data[id] && statuses.data[id].type !== "idle") throw new Error("该工作流的执行会话正在运行，请等待完成")
    }
    let sessionID = target
    if (sessionID) {
      const session = await client.session.get({ sessionID, directory: item.project })
      if (session.error || !session.data || session.data.time.archived || session.data.parentID || !await sameDirectory(session.data.directory, item.project)) throw new Error("目标会话不可用或不属于当前目录")
      if (statuses.data[sessionID] && statuses.data[sessionID].type !== "idle") throw new Error("目标会话正在运行，请稍后再试")
    } else {
      const created = await client.session.create({ directory: item.project, title: `DDD · ${fresh.title}` })
      if (created.error || !created.data) throw new Error("新建会话失败")
      sessionID = created.data.id
    }
    const text = `继续已有 DDD 工作流。先调用 ddd_lifecycle(action="status", workflow_id=${JSON.stringify(fresh.id)}, input={view:"compact"})，按返回状态推进，不得 init 或重置。续跑不代表批准：等待人工审核时展示当前结果并停止，不得自行 review。只在 allowedNextStages 内工作，遇到人工检查点或真实阻塞停止。`
    const sent = await client.session.promptAsync({ directory: item.project, sessionID,
      messageID: `msg_${randomBytes(16).toString("hex")}`, parts: [{ type: "text", text }] })
    if (sent.error) throw new Error(`续跑发送失败，请检查目标会话后再操作：${sessionID}`)
    return sessionID
  } finally { inFlight.delete(key) }
}
