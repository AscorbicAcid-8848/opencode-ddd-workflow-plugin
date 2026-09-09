import { createHash } from "node:crypto"
import { realpath } from "node:fs/promises"
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import { discoverWorkflows, loadMilestone, romans, type WorkflowItem, type MilestoneView } from "./model.js"

const sending = new Set<string>()
export function reviewMessageId(workflowId: string, checkpointId: number, record: unknown): string {
  return `msg_${createHash("sha256").update(JSON.stringify([workflowId, checkpointId, record])).digest("hex").slice(0, 32)}`
}

/** Reconstruct panel context from its deterministic message ID and saved review. No sidecar state. */
export async function resolvePanelReview(project: string, sessionID: string, messageID?: string) {
  if (!messageID || !/^msg_[a-f0-9]{32}$/u.test(messageID)) return undefined
  for (const item of await discoverWorkflows(project)) {
    const state = item.state
    if (!state || ![state.runtimeSessionId, ...(state.runtimeSessionIds ?? [])].includes(sessionID)) continue
    for (const checkpoint of state.checkpoints) {
      const record = checkpoint.review
      if (record?.reviewer !== "user:tui" || reviewMessageId(item.id, checkpoint.checkpointId, record) !== messageID) continue
      return { workflowId: item.id, workflowType: state.workflowType, decision: record.decision,
        milestone: checkpoint.milestone, checkpointId: checkpoint.checkpointId,
        stale: item.archived || item.issues.length > 0 || state.checkpoints.at(-1)?.checkpointId !== checkpoint.checkpointId }
    }
  }
  return undefined
}

/** Retry only message delivery; never calls the review transaction. */
export async function sendPanelReview(item: WorkflowItem, previous: MilestoneView, client: TuiPluginApi["client"]) {
  const fresh = (await discoverWorkflows(item.project)).find(w => w.key === item.key)
  if (!fresh || fresh.archived) throw new Error("工作流已移动或归档，不能自动继续。")
  const view = await loadMilestone(fresh, romans.indexOf(previous.roman as typeof romans[number]))
  const checkpoint = view.checkpoint
  const record = checkpoint?.review
  if (!checkpoint || checkpoint.checkpointId !== previous.checkpoint?.checkpointId || !record || record.reviewer !== "user:tui") {
    throw new Error("当前审核记录已变化，请刷新后查看原会话。")
  }
  if (fresh.issues.length || view.issues.length) throw new Error("工作流存在一致性异常，不能自动继续。")
  const sessionID = fresh.state?.runtimeSessionId
  if (!sessionID) throw new Error("该工作流没有绑定原会话。请在原会话继续，不会发送到其他会话。")
  const messageID = reviewMessageId(fresh.id, checkpoint.checkpointId, record)
  if (sending.has(messageID)) throw new Error("审核消息正在同步，请勿重复操作。")
  sending.add(messageID)
  try {
    const session = await client.session.get({ sessionID, directory: item.project })
    if (session.error || !session.data) throw new Error("原会话不存在或不可访问。")
    const samePath = (a: string, b: string) => process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b
    if (!samePath(await realpath(session.data.directory), await realpath(item.project)) || session.data.time.archived) {
      throw new Error("原会话不属于当前项目或已归档，已阻止发送。")
    }
    const existing = await client.session.message({ sessionID, messageID, directory: item.project })
    if (existing.data) return { sessionID, messageID, alreadySent: true }
    if (existing.response?.status !== 404) throw new Error("无法确认审核消息是否已发送。请检查原会话后再重试。")
    if (fresh.state?.checkpoints.at(-1)?.checkpointId !== checkpoint.checkpointId) throw new Error("工作流已进入后续阶段，不再补发旧审核的继续指令。")
    const statuses = await client.session.status({ directory: item.project })
    if (statuses.error || !statuses.data) throw new Error("无法读取原会话状态，请稍后重试同步。")
    if (statuses.data[sessionID] && statuses.data[sessionID].type !== "idle") throw new Error("原会话正在运行。审核已保存，请在会话空闲后重试同步。")
    const label = { approve: "批准", revise: "修改", reject: "拒绝" }[record.decision]
    const text = `${label}里程碑 ${view.roman}${record.feedback ? `：${record.feedback}` : "。"}`
    const result = await client.session.promptAsync({ sessionID, directory: item.project, messageID,
      noReply: record.decision === "reject", agent: view.roman === "VI" || (view.roman === "V" && record.decision === "approve") ? "ddd-coding" : "ddd-workflow",
      parts: [{ type: "text", text }] })
    if (result.error) throw new Error("审核已保存，但消息发送失败。请重试同步，不要重复审核。")
    return { sessionID, messageID, alreadySent: false }
  } finally { sending.delete(messageID) }
}
