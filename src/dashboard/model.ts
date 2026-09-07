import path from "node:path"
import { readFile, readdir, realpath, stat } from "node:fs/promises"
import { createHash } from "node:crypto"
import { profileFor } from "../catalog.js"
import { workflowTransition } from "../transition.js"
import { documentSections } from "../documents.js"
import type { Checkpoint, WorkflowState, WorkflowProfile, Transition } from "../types.js"
import type { ProjectedState, MilestoneProjection, ProjectionRef } from "./projections.js"

export const romans = ["I", "II", "III", "IV", "V", "VI"] as const
export const titles = ["战略事件风暴", "战略设计", "战术事件风暴", "战术设计", "交付计划", "最终验收"]
export const typeLabels: Record<string, string> = { "add-feature": "新增功能", "refactor-system": "系统重构", "create-system": "新建系统" }
export type PanelStatus = "待审核" | "阻塞" | "要求修改" | "进行中" | "待归档" | "已完成" | "已拒绝" | "一致性异常"
export interface WorkflowItem {
  key: string; root: string; project: string; archived: boolean; title: string; id: string
  status: PanelStatus; updatedAt: string; issues: string[]; approved: number
  state?: WorkflowState; profile?: WorkflowProfile; transition?: Transition; legacy?: boolean
}
export interface MilestoneView {
  roman: string; title: string; status: string; checkpoint?: Checkpoint
  history: Checkpoint[]; body: string; sections: Record<string, string>; file: string
  token: string; issues: string[]; plan?: any; model?: any; tasks?: string
  projection?: MilestoneProjection; revisions?: ProjectionRef[]; historical?: boolean
}

/** All reads are bounded and confined to the selected physical change; no state migration on browse. */
export async function safeRead(root: string, relative: string): Promise<string> {
  const base = await realpath(root)
  const requested = path.resolve(base, relative)
  const lexical = path.relative(base, requested)
  if (lexical.startsWith("..") || path.isAbsolute(lexical)) throw new Error("文档路径超出当前 change")
  const file = await realpath(requested)
  const rel = path.relative(base, file)
  if (rel.startsWith("..") || path.isAbsolute(rel)) throw new Error("文档路径超出当前 change")
  if ((await stat(file)).size > 2 * 1024 * 1024) throw new Error("文档超过 2 MB，无法在面板中加载")
  return readFile(file, "utf8")
}
async function folders(root: string): Promise<string[]> {
  try { return (await readdir(root, { withFileTypes: true })).filter(d => d.isDirectory() && !d.isSymbolicLink()).map(d => d.name) }
  catch (error: any) { if (error.code === "ENOENT") return []; throw error }
}

export async function readWorkflow(project: string, root: string, archived: boolean): Promise<WorkflowItem> {
  const result: WorkflowItem = { key: path.relative(project, root), root, project, archived,
    title: path.basename(path.dirname(root)), id: path.basename(path.dirname(root)), status: "一致性异常", updatedAt: "", issues: [], approved: 0 }
  try {
    const data = JSON.parse(await safeRead(root, ".ddd/workflow-state.json"))
    if (!data || !Array.isArray(data.checkpoints) || typeof data.workflowId !== "string" || !typeLabels[data.workflowType]) throw new Error("无法识别的 workflow state")
    const state = data as WorkflowState
    const profile = await profileFor(state.workflowType)
    // Legacy skills stored review decisions separately and used document filenames.
    // Normalize the in-memory projection only. Never migrate historical records on browse.
    result.legacy = state.checkpoints.some(c => !c.milestone)
    if (result.legacy) state.checkpoints = data.checkpoints.map((c: any) => {
      const roman = romans.find(r => c.document === profile.documents[`milestone${r}`] || c.document === `milestone${r}`)
      const decision = c.review?.decision
      const status = c.status === "superseded" ? c.status : decision === "approve" ? "approved"
        : decision === "revise" ? "revision_requested" : decision === "reject" ? "rejected"
        : c.status === "submitted" ? "completed" : c.status
      return { ...c, milestone: c.milestone ?? roman, status }
    })
    Object.assign(result, { state, profile, title: state.title || state.workflowId, id: state.workflowId, updatedAt: state.updatedAt })
    const transition = workflowTransition(profile, state)
    result.transition = transition
    result.approved = romans.filter(roman => milestoneCheckpoint(result, roman)?.status === "approved").length
    if (!archived && path.basename(path.dirname(root)) !== state.workflowId) result.issues.push("活动目录与 workflow ID 不一致")
    if (archived && state.status !== "complete") result.issues.push("目录已归档，但状态未完成")
    if (!archived && state.status === "complete") result.issues.push("状态已完成，但目录尚未归档")
    if (archived && result.approved !== 6) result.issues.push("归档记录缺少完整的六里程碑批准证据")
    result.status = result.issues.length ? "一致性异常" : state.status === "complete" ? "已完成"
      : state.status === "rejected" ? "已拒绝" : state.status === "runtime_blocked" ? "阻塞"
      : state.status === "revision_requested" ? "要求修改" : state.status === "awaiting_archive" ? "待归档"
      : transition.humanReviewRequired ? "待审核" : "进行中"
  } catch (error) { result.issues.push(String(error)) }
  return result
}

export function milestoneCheckpoint(item: WorkflowItem, roman: string): Checkpoint | undefined {
  return item.state?.checkpoints.filter(c => c.milestone === roman && c.status !== "superseded"
    && !(item.legacy && (c as Checkpoint & { reviewStatus?: string }).reviewStatus === "not_required")).at(-1)
}
export function milestoneStatus(item: WorkflowItem, roman: string): string {
  const c = milestoneCheckpoint(item, roman)
  if (!c) return "未开始"
  return ({ approved: "已批准", awaiting_review: "待审核", revision_requested: "要求修改", rejected: "已拒绝", superseded: "已替代", completed: "形成中" })[c.status] ?? "未知"
}

export async function discoverWorkflows(project: string): Promise<WorkflowItem[]> {
  project = await realpath(project)
  const changes = path.join(project, "openspec", "changes")
  // Do not cross junctions or symlinks into another project.
  try {
    const rel = path.relative(project, await realpath(changes))
    if (rel.startsWith("..") || path.isAbsolute(rel)) throw new Error("OpenSpec 目录不属于当前项目")
  } catch (error: any) { if (error.code === "ENOENT") return []; throw error }
  const active = (await folders(changes)).filter(n => n !== "archive").map(n => ({ root: path.join(changes, n, "ddd"), archived: false }))
  const archived = (await folders(path.join(changes, "archive"))).map(n => ({ root: path.join(changes, "archive", n, "ddd"), archived: true }))
  const items: WorkflowItem[] = []
  for (const entry of [...active, ...archived]) {
    try {
      const physical = await realpath(entry.root)
      const rel = path.relative(project, physical)
      if (rel.startsWith("..") || path.isAbsolute(rel)) continue
      await stat(path.join(entry.root, ".ddd", "workflow-state.json"))
      items.push(await readWorkflow(project, entry.root, entry.archived))
    } catch (error: any) { if (error.code !== "ENOENT") throw error }
  }
  for (const item of items) {
    if (items.filter(other => other.id === item.id).length > 1) {
      item.issues.push("发现相同 workflow ID 的多个记录，请核对活动与归档目录")
      item.status = "一致性异常"
    }
  }
  const order: PanelStatus[] = ["待审核", "阻塞", "一致性异常", "要求修改", "进行中", "待归档", "已拒绝", "已完成"]
  return items.sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status) || b.updatedAt.localeCompare(a.updatedAt))
}

export function filterWorkflows(items: WorkflowItem[], query = "", status = "全部", type = "全部"): WorkflowItem[] {
  const term = query.toLocaleLowerCase()
  return items.filter(item => (status === "全部" || item.status === status) && (type === "全部" || typeLabels[item.state?.workflowType ?? ""] === type)
    && `${item.title} ${item.id} ${item.state?.originalRequest ?? ""}`.toLocaleLowerCase().includes(term))
}

export async function loadMilestone(item: WorkflowItem, index: number): Promise<MilestoneView> {
  const roman = romans[index]
  if (!roman || !item.profile) throw new Error("无效的里程碑或工作流")
  const name = item.profile.documents[`milestone${roman}`]
  const view: MilestoneView = { roman, title: titles[index], status: milestoneStatus(item, roman),
    checkpoint: milestoneCheckpoint(item, roman), history: item.state!.checkpoints.filter(c => c.milestone === roman),
    file: path.join(item.root, name), body: "", sections: {}, token: "", issues: [] }
  if (view.checkpoint) {
    try { view.body = await safeRead(item.root, name); view.sections = documentSections(view.body) }
    catch (error) { view.issues.push(`正式文档不可读取：${String(error)}`) }
  }
  view.token = createHash("sha256").update(await safeRead(item.root, ".ddd/workflow-state.json")).update(view.body).digest("hex")
  view.revisions = (item.state as ProjectedState).dashboard?.revisions.filter(r => r.roman === roman) ?? []
  const latestProjection = view.revisions.at(-1)
  if (latestProjection) {
    try {
      const projection = await readProjection(item, latestProjection)
      if (projection.documentHash !== createHash("sha256").update(view.body).digest("hex")) throw new Error("正式文档与已发布投影不一致")
      if (latestProjection.checkpointId !== view.checkpoint?.checkpointId || projection.status !== view.checkpoint?.status) throw new Error("当前检查点与已发布投影不一致")
      view.projection = projection
    } catch (error) { view.issues.push(`可视化投影：${String(error)}`) }
  }
  // Engineering artifacts are relevant only from their owning milestones onward.
  for (const [key, file, since] of [["model", "model-contract.json", 3], ["plan", ".ddd/delivery/plan.json", 4]] as const) {
    if (index < since) continue
    try { view[key] = JSON.parse(await safeRead(item.root, file)) }
    catch (error: any) { if (error.code !== "ENOENT") view.issues.push(`${file}：${String(error)}`) }
  }
  if (index >= 4) {
    try { view.tasks = await safeRead(path.dirname(item.root), "tasks.md") }
    catch (error: any) { if (error.code !== "ENOENT") view.issues.push(`tasks.md：${String(error)}`) }
  }
  return view
}

export async function readProjection(item: WorkflowItem, ref: ProjectionRef): Promise<MilestoneProjection> {
  const projection = JSON.parse(await safeRead(item.root, ref.file)) as MilestoneProjection
  if (projection.version !== 1 || projection.workflowId !== item.id || projection.milestoneRoman !== ref.roman
    || projection.revision !== ref.revision || !Array.isArray(projection.cards)) throw new Error("投影身份或版本不匹配")
  return projection
}

export async function historicalMilestone(item: WorkflowItem, current: MilestoneView, ref: ProjectionRef): Promise<MilestoneView> {
  const projection = await readProjection(item, ref)
  const sections = documentSections(projection.documentBody)
  const checkpoint = item.state?.checkpoints.find(c => c.checkpointId === ref.checkpointId)
  return { ...current, projection, body: projection.documentBody, sections, historical: true,
    status: `历史版本 ${ref.revision} · ${projection.status}`,
    checkpoint: checkpoint ? { ...checkpoint, summary: sections["一页结论"] ?? checkpoint.summary, decisionItems: projection.decisions } : undefined }
}
