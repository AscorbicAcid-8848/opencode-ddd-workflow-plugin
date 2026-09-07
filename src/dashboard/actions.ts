import { review } from "../engine.js"
import { discoverWorkflows, loadMilestone, romans, type WorkflowItem, type MilestoneView } from "./model.js"
import type { ReviewDecision } from "../types.js"

const pending = new Set<string>()
export function canReview(item: WorkflowItem, view: MilestoneView): boolean {
  return !item.archived && !item.legacy && !view.historical && !item.issues.length && !view.issues.length && item.status === "待审核"
    && view.checkpoint?.status === "awaiting_review" && item.state?.checkpoints.at(-1)?.checkpointId === view.checkpoint.checkpointId
    && !!item.transition?.humanReviewRequired
}

/** UI uses the same review transaction as the tool; it cannot set workflow state or approve an archive. */
export async function reviewFromPanel(item: WorkflowItem, view: MilestoneView, decision: ReviewDecision, feedback: string,
  selections: Record<string, string> = {}, runReview: typeof review = review) {
  if (!canReview(item, view)) throw new Error("当前里程碑不可审核")
  if (decision !== "approve" && !feedback.trim()) throw new Error("请填写修改意见或拒绝原因")
  if (pending.has(item.root)) throw new Error("该 workflow 的审核正在提交")
  pending.add(item.root)
  try {
    const fresh = (await discoverWorkflows(item.project)).find(w => w.key === item.key)
    if (!fresh) throw new Error("Workflow 已移动，请刷新后重新审核")
    const current = await loadMilestone(fresh, romans.indexOf(view.roman as typeof romans[number]))
    if (!canReview(fresh, current) || view.token !== current.token) throw new Error("审核期间文档或状态发生变化，请刷新并重新确认")
    for (const d of current.checkpoint?.decisionItems ?? []) {
      if (decision === "approve" && d.status === "open" && !d.options.some(o => o.id === selections[d.id])) throw new Error(`请选择 ${d.id} 的决定`)
    }
    return await runReview({ projectRoot: item.project, workflowType: fresh.state!.workflowType, workflowId: fresh.id,
      stage: current.checkpoint!.stage, decision, reviewer: "user:tui", feedback, resolution: { selections } })
  } finally { pending.delete(item.root) }
}
