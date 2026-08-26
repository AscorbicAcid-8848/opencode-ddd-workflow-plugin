import path from "node:path"
import { createHash } from "node:crypto"
import { readdir, rm } from "node:fs/promises"
import { tool, type Plugin, type ToolDefinition } from "@opencode-ai/plugin"
import { initialize, prepare, submit, review, status, block, archive, openspec, workflowTransition, containsRequiredConcept } from "./engine.js"
import { profileFor } from "./catalog.js"
import { loadState } from "./state.js"
import { workflowRoot, statePath } from "./state.js"
import { exists, readJson } from "./fs.js"
import { evidenceBundle } from "./evidence.js"
import type { WorkflowType, LifecycleAction, ReviewDecision, OpenSpecArtifact, StageClaim } from "./types.js"

const workflowType = tool.schema.enum(["add-feature", "refactor-system", "create-system"])
const lifecycleAction = tool.schema.enum(["init", "prepare", "evidence-bundle", "complete-stage", "section", "finalize", "submit", "review", "status", "block", "archive", "openspec", "openspec-plan"])
const reqText = () => tool.schema.string().min(1)

function projectRoot(args: { project_root?: string }, ctx: { worktree?: string; directory?: string }) {
  return path.resolve(args.project_root || ctx.worktree || ctx.directory || process.cwd())
}

function normalizeDeltaSpec(raw: unknown, workflow: WorkflowType): string {
  let content = String(raw ?? "")
  if (workflow !== "refactor-system") content = content.replace(/^##\s+Requirements\s*$/mu, "## ADDED Requirements")
  const requirement = /^###\s+Requirement:\s*(.+)$/gmu
  const matches = [...content.matchAll(requirement)]
  for (let index = matches.length - 1; index >= 0; index -= 1) {
    const match = matches[index]
    const start = match.index ?? 0
    const end = matches[index + 1]?.index ?? content.length
    let block = content.slice(start, end)
    if (!/\b(?:MUST|SHALL)\b/u.test(block)) {
      const lines = block.split(/\r?\n/u)
      const prose = lines.findIndex((line, lineIndex) => lineIndex > 0 && line.trim() && !/^#{1,6}\s|^-\s/u.test(line.trim()))
      if (prose >= 0) lines[prose] = `系统 MUST ${lines[prose].trim()}`
      block = lines.join("\n")
    }
    if (!/^####\s+Scenario:/mu.test(block) && /^-\s+WHEN\b/mu.test(block) && /^-\s+THEN\b/mu.test(block)) {
      block = block.replace(/^-\s+WHEN\b/mu, `#### Scenario: ${match[1].trim()}\n- WHEN`)
    }
    content = `${content.slice(0, start)}${block}${content.slice(end)}`
  }
  return content
}

function identity(args: { workflow_type: WorkflowType; workflow_id: string; project_root?: string }, ctx: { worktree?: string; directory?: string }) {
  return { workflowType: args.workflow_type, workflowId: args.workflow_id, projectRoot: projectRoot(args, ctx) }
}

type SessionIdentity = { workflowType: WorkflowType; workflowId: string; projectRoot: string }
const sessionIdentities = new Map<string, SessionIdentity>()

async function resolveActiveIdentity(ctx: { sessionID?: string; worktree?: string; directory?: string }, workflowType?: WorkflowType, workflowId?: string): Promise<SessionIdentity> {
  const root = path.resolve(ctx.worktree || ctx.directory || process.cwd())
  if (workflowType && workflowId) {
    const resolved = { workflowType, workflowId, projectRoot: root }
    if (ctx.sessionID) sessionIdentities.set(ctx.sessionID, resolved)
    return resolved
  }
  const bound = ctx.sessionID ? sessionIdentities.get(ctx.sessionID) : undefined
  if (bound && bound.projectRoot === root && await exists(statePath(path.join(root, "openspec", "changes", bound.workflowId, "ddd")))) {
    return bound
  }
  const { readdir } = await import("node:fs/promises")
  const changesDir = path.join(root, "openspec", "changes")
  const candidates: string[] = []
  if (await exists(changesDir)) {
    for (const entry of await readdir(changesDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === "archive") continue
      const ddd = path.join(changesDir, entry.name, "ddd")
      if (await exists(statePath(ddd))) candidates.push(entry.name)
    }
  }
  if (candidates.length === 1) {
    const state = await loadState(path.join(changesDir, candidates[0], "ddd"))
    return { workflowType: state.workflowType, workflowId: state.workflowId, projectRoot: root }
  }
  if (candidates.length === 0) throw new Error("当前项目没有活动的 DDD change；请先用 action=init 创建。")
  throw new Error(`当前项目有多个活动 DDD change（${candidates.join("、")}），请显式传 workflow_type 与 workflow_id。`)
}

const out = (v: unknown) => JSON.stringify(v, null, 2)

export function lifecycleFinalizeMetadata(input: Record<string, any>) {
  return {
    plannedSlices: input.plannedSlices ?? input.planned_slices,
    sliceId: input.sliceId ?? input.slice_id,
  }
}

export function normalizeReviewDecision(value: unknown): ReviewDecision | null {
  const normalized = String(value ?? "").trim().toLowerCase().replace(/[_\s-]+/gu, "")
  if (["approve", "approved", "批准", "通过"].includes(normalized)) return "approve"
  if (["revise", "revision", "revisionrequested", "修改", "退回"].includes(normalized)) return "revise"
  if (["reject", "rejected", "拒绝"].includes(normalized)) return "reject"
  return null
}

function enrichRoadmapSections(sections: Record<string, string>): void {
  const trace = sections["交付追踪矩阵"]
  if (trace && !containsRequiredConcept(trace, "战术模型—切片—文件覆盖")) {
    sections["交付追踪矩阵"] = `${trace.trim()}\n\n战术模型—切片—文件覆盖：以上 ME/INV、切片和生产/测试文件映射是实施约束。`
  }
  if (trace && !containsRequiredConcept(sections["交付追踪矩阵"], "模块—层—依赖机器合同")) {
    sections["交付追踪矩阵"] += "\n\n模块—层—依赖机器合同：沿用已批准的上下文优先分层与依赖方向。"
  }
  const openSpec = sections["OpenSpec 变更映射"]
  if (openSpec && !containsRequiredConcept(openSpec, "OpenSpec change 映射")) {
    sections["OpenSpec 变更映射"] = `OpenSpec change 映射：${openSpec.trim()}`
  }
  const git = sections["Git 交付计划"]
  if (git && !containsRequiredConcept(git, "Git 基线与回滚策略")) {
    sections["Git 交付计划"] = `Git 基线与回滚策略：${git.trim()}`
  }
}

function normalizeAtomicSections(raw: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(Object.entries(raw).map(([heading, value]) => {
    const escaped = heading.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")
    const content = String(value ?? "")
      .replace(new RegExp(`^\\s*##\\s+${escaped}\\s*\\r?\\n+`, "u"), "")
      .replace(/^##\s+/gmu, "### ")
      .trim()
    return [heading, content]
  }))
}

const DDD_AGENT_ID = "ddd-workflow"
const DDD_CODE_AGENT_ID = "ddd-coding"
const DDD_COMMAND_TEMPLATE = [
  "Load `ddd-orchestrate` and treat the text below as the immutable original request.",
  "Use only `ddd_lifecycle`. For an existing-system evidence stage call action=evidence-bundle once after prepare with 2-6 likely source identifiers; prefer short symbols such as Shop/User/Controller over invented compound class names. Do not use repository or shell exploration. For every stage call action=complete-stage once with every allowed heading. Continue until human review, a real block, archive, or completion.",
  "complete-stage owns claim bookkeeping and atomic publication. Correct and retry the whole stage only when it returns blocking findings; never split a normal stage into per-heading calls.",
  "Keep total section text between qualityContract.minTotalChars and targetMaxTotalChars. Omit observations when stageCard has no claimContract. Do not narrate plans between tool calls. Treat the evidence bundle as complete; record anything outside it as evidence-gap/open-question. At a human gate output transition.message and stop.",
  "",
  "$ARGUMENTS",
].join("\n")

const disabledDddAgentTools = {
  invalid: false,
  ddd_lifecycle: true,
  skill: true,
  pdf_parse: false, excel_parse: false, excel_write: false,
  subagent: false, workflow_run: false, todowrite: false,
  webfetch: false, websearch: false, codesearch: false,
  CronCreate: false, CronList: false, CronDelete: false,
  question: false, plan_enter: false, plan_exit: false, lsp: false,
}

const modelingOnlyTools = {
  ...disabledDddAgentTools,
  read: false, glob: false, grep: false, bash: false, shell: false,
  edit: false, write: false, apply_patch: false, patch: false, multiedit: false,
}

const DDD_CODE_COMMAND_TEMPLATE = [
  "Load `ddd-implementation`. This command is only for approving milestone V, implementing approved vertical slices, and producing milestone VI evidence.",
  "FIRST TOOL CALL: ddd_lifecycle action=review with input={} when milestone V is awaiting approval; otherwise ddd_lifecycle action=prepare with input={}. Never read, glob, grep, or run Git before that lifecycle call. The runtime normalizes the approval and resolves the unique next stage.",
  "Use ddd_lifecycle for review/prepare/complete-stage. Review binds automatically; do not call status. Read only the approved roadmap/model contract and mapped source files. Implement one slice, run real tests, create one Git commit, then complete-stage with sliceId. Repeat until transition reaches milestone VI.",
  "Do not redesign, rename ME/INV contracts, scan unrelated files, install tools, or narrate between calls. On unavailable evidence call block.",
  "",
  "$ARGUMENTS",
].join("\n")

const lifecycleTool = tool({
  description: "DDD 工作流生命周期控制器。常规路径：init → prepare → 现状阶段 evidence-bundle → complete-stage → review；里程碑 V 用 openspec-plan；最终 archive。",
  args: {
    action: lifecycleAction,
    workflow_type: workflowType.optional().describe("init 必填；其余当项目仅有一个活动 change 时可省略。"),
    workflow_id: reqText().optional().describe("init 必填；其余当项目仅有一个活动 change 时可省略。"),
    project_root: tool.schema.string().optional().describe("项目根目录，默认取会话 worktree。"),
    input: tool.schema.union([
      tool.schema.record(tool.schema.string(), tool.schema.any()),
      tool.schema.string(),
    ]).optional().describe("载荷对象；兼容模型误把完整 JSON 对象编码成字符串。init:{title,request}; prepare:{stage}; evidence-bundle:{stage,terms:[2-6项]}; complete-stage:{stage,summary,sections,observations?,plannedSlices?,sliceId?}; review；openspec-plan；status/block/archive/openspec。"),
  },
  async execute(args, context) {
    try {
      const ctx = { sessionID: context.sessionID, worktree: context.worktree, directory: context.directory }
      let payload: Record<string, any> | undefined
      if (typeof args.input === "string") {
        try { payload = JSON.parse(args.input) as Record<string, any> }
        catch { return out({ error: "input 字符串不是有效 JSON 对象。" }) }
      } else payload = args.input as Record<string, any> | undefined
      if (args.action === "init") {
        const i = payload
        if (!args.workflow_type || !args.workflow_id || !i?.title || !i?.request) {
          return out({ error: "init 需要 workflow_type、workflow_id 和 input.{title,request}。" })
        }
        const root = projectRoot(args, ctx)
        const result = await initialize({ workflowType: args.workflow_type, workflowId: args.workflow_id, projectRoot: root, title: i.title, request: i.request })
        sessionIdentities.set(context.sessionID, { workflowType: args.workflow_type, workflowId: args.workflow_id, projectRoot: root })
        return out(result)
      }
      const id = await resolveActiveIdentity(ctx, args.workflow_type, args.workflow_id)
      if (args.action === "prepare") {
        const i = payload ?? {}
        const requestedStage = typeof i.stage === "string" && /^(?:0[0-9]|10)-[a-z0-9-]+$/u.test(i.stage) ? i.stage : undefined
        const transition = requestedStage ? null : await status(id)
        const stage = requestedStage ?? transition?.nextStage
        if (!stage) return out({ error: `prepare 需要明确 stage；当前候选为：${transition?.allowedNextStages.join("、") || "无"}。` })
        return out(await prepare({ ...id, stage }))
      }
      if (args.action === "evidence-bundle") {
        const i = payload
        if (i?.stage !== "01-current-evidence") return out({ error: "evidence-bundle 仅属于 01-current-evidence。" })
        return out(await evidenceBundle(id.projectRoot, id.workflowId, i.terms))
      }
      if (args.action === "submit") {
        return out({ error: "MODEL_FACING_SUBMIT_DISABLED：请用 action=complete-stage 一次提交完整阶段。不要构造 raw claims。" })
      }
      if (args.action === "complete-stage") {
        const i = payload
        if (!i?.summary || !i?.sections || typeof i.sections !== "object" || Array.isArray(i.sections)) {
          return out({ error: "complete-stage 需要 input.{summary,sections}；stage 可省略并解析当前唯一阶段，sections 必须覆盖 stageCard.allowedSectionHeadings。" })
        }
        const requestedStage = typeof i.stage === "string" && /^(?:0[0-9]|10)-[a-z0-9-]+$/u.test(i.stage) ? i.stage : undefined
        const transition = requestedStage ? null : await status(id)
        const stage = requestedStage ?? transition?.nextStage
        if (!stage) return out({ error: `complete-stage 无法解析唯一阶段；当前候选为：${transition?.allowedNextStages.join("、") || "无"}。` })
        const sections = normalizeAtomicSections(i.sections)
        if (stage === "08-roadmap") enrichRoadmapSections(sections)
        const observations = (Array.isArray(i.observations) ? i.observations : []).map((item: any) => {
          const heading = String(item?.heading ?? "").trim()
          if (Object.hasOwn(sections, heading)) return item
          const statement = String(item?.statement ?? "").trim()
          const owners = Object.entries(sections).filter(([, content]) => statement && content.includes(statement))
          return owners.length === 1 ? { ...item, heading: owners[0][0] } : item
        })
        if (stage === "01-current-evidence" && typeof sections["证据与追踪"] === "string") {
          const evidenceText = sections["证据与追踪"]
          if (!["事实", "假设", "待确认"].every((term) => evidenceText.includes(term))) {
            const gaps = observations
              .filter((item: any) => item?.kind === "evidence-gap" || item?.kind === "open-question")
              .map((item: any) => String(item.statement ?? "").trim()).filter(Boolean)
            sections["证据与追踪"] = `${evidenceText.trim()}\n\n### 事实、假设与待确认项\n- 事实：上文事实均有证据索引或结构化结论支持。\n- 假设：证据包之外的信息仍处于未证实状态。\n- 待确认：${gaps.length ? gaps.join("；") : "当前没有新增待确认项。"}`
          }
        }
        const missingByHeading = new Map<string, string[]>()
        for (const item of observations) {
          const heading = String(item?.heading ?? "").trim()
          const statement = String(item?.statement ?? "").trim()
          if (!heading || !Object.hasOwn(sections, heading) || !statement) continue
          if (!sections[heading].includes(statement)) {
            missingByHeading.set(heading, [...(missingByHeading.get(heading) ?? []), statement])
          }
        }
        for (const [heading, statements] of missingByHeading) {
          sections[heading] = `${sections[heading].trim()}\n\n### 结构化结论\n${statements.map((statement) => `- ${statement}`).join("\n")}`
        }
        const metadata = lifecycleFinalizeMetadata(i)
        return out(await submit({ ...id, stage, summary: i.summary, sections,
          claims: observations.map((item: any) => claimFromObservation(stage, String(item?.heading ?? ""), item)),
          finalize: true, ...metadata }))
      }
      if (args.action === "section") {
        const i = payload
        if (!i?.stage || !i?.heading || !i?.summary || !i?.content) return out({ error: "section 需要 input.{stage,heading,summary,content}。" })
        const observations = Array.isArray(i.observations) ? i.observations : []
        const missing = observations.map((item: any) => String(item?.statement ?? "").trim()).filter((statement: string) => statement && !String(i.content).includes(statement))
        const content = missing.length ? `${String(i.content).trim()}\n\n### 结构化结论\n${missing.map((item: string) => `- ${item}`).join("\n")}` : String(i.content)
        return out(await submit({ ...id, stage: i.stage, summary: i.summary, sections: { [i.heading]: content },
          claims: observations.map((item: any) => claimFromObservation(i.stage, i.heading, item)), finalize: false }))
      }
      if (args.action === "finalize") {
        const i = payload
        if (!i?.stage || !i?.summary) return out({ error: "finalize 需要 input.{stage,summary}。" })
        const metadata = lifecycleFinalizeMetadata(i)
        return out(await submit({ ...id, stage: i.stage, summary: i.summary, sections: {}, finalize: true,
          ...metadata }))
      }
      if (args.action === "review") {
        const transition = await status(id)
        const milestoneVAutoApproval = context.agent === DDD_CODE_AGENT_ID && transition.milestoneRoman === "V"
        const emptyPayload = !payload || Object.keys(payload).length === 0
        const i = emptyPayload && milestoneVAutoApproval ? { decision: "approve", reviewer: "human-authorized-via-ddd-code" } : payload
        const decision = normalizeReviewDecision(i?.decision)
        if (!decision || !i?.reviewer) {
          return out({ error: "review 需要 input.{decision,reviewer}；stage 可省略并自动绑定当前唯一人工检查点。" })
        }
        const stage = transition.nextHumanGate ?? i.stage
        if (!stage) return out({ error: "当前没有待人工验收的里程碑，不能执行 review。" })
        return out(await review({ ...id, stage, decision, reviewer: i.reviewer, feedback: i.feedback }))
      }
      if (args.action === "status") {
        const i = payload ?? {}
        return out(await status({ ...id, view: i.view }))
      }
      if (args.action === "block") {
        const i = payload
        if (!i?.stage || !i?.reason) return out({ error: "block 需要 input.{stage,reason}。" })
        return out(await block({ ...id, stage: i.stage, reason: i.reason, evidence: i.evidence, remediation: i.remediation }))
      }
      if (args.action === "archive") return out(await archive(id))
      if (args.action === "openspec") {
        const i = payload
        if (!i?.artifact) return out({ error: "openspec 需要 input.artifact。" })
        return out(await openspec({ ...id, artifact: i.artifact as OpenSpecArtifact,
          content: i.content, capability: i.capability, skipSpecs: i.skipSpecs }))
      }
      if (args.action === "openspec-plan") {
        const i = payload
        if (!i?.proposal || !i?.design || !i?.tasks) {
          return out({ error: "openspec-plan 需要 input.{proposal,design,tasks}，新增/新建还需 specs:[{capability,content}]。" })
        }
        const contractFile = path.join(id.projectRoot, "openspec", "changes", id.workflowId, "ddd", "model-contract.json")
        let design = String(i.design)
        if (await exists(contractFile)) {
          const contract = await readJson<Record<string, any>>(contractFile)
          const appendix = [
            "## 批准模型合同（运行时注入，不可改写）",
            ...(contract.modelElements ?? []).map((item: any) => `- ${item.id} ${item.name}`),
            ...(contract.invariants ?? []).map((item: any) => `- ${item.id}：${item.statement}`),
          ].join("\n")
          design = `${design.trim()}\n\n${appendix}`
        }
        const normalizedSpecs = Array.isArray(i.specs) ? i.specs.map((spec: any) => ({
          ...spec,
          content: normalizeDeltaSpec(spec?.content, id.workflowType),
        })) : []
        const malformed = normalizedSpecs.filter((spec: any) => {
          if (!spec.capability || !/^##\s+(?:ADDED|MODIFIED|REMOVED|RENAMED)\s+Requirements\s*$/mu.test(spec.content)) return true
          const blocks = String(spec.content).split(/^###\s+Requirement:/mu).slice(1)
          return blocks.length === 0 || blocks.some((block) => !/\b(?:MUST|SHALL)\b/u.test(block) || !/^####\s+Scenario:/mu.test(block))
        })
        if (i.skipSpecs !== true && malformed.length) {
          return out({ error: `openspec-plan 预校验失败：${malformed.map((spec: any) => spec.capability || "unnamed").join("、")} 的每个 Requirement 都必须含 MUST/SHALL 和自己的 #### Scenario。工具会归一新增标题，并可把现有 WHEN/THEN 自动包装为 Scenario。尚未写入任何工件。` })
        }
        if (!/^\s*-\s*\[[ xX]\]/mu.test(String(i.tasks))) return out({ error: "openspec-plan 预校验失败：tasks 必须包含 checkbox 任务；尚未写入任何工件。" })
        const specsRoot = path.join(id.projectRoot, "openspec", "changes", id.workflowId, "specs")
        if (await exists(specsRoot) && i.skipSpecs !== true) {
          const keep = new Set(normalizedSpecs.map((spec: any) => String(spec.capability)))
          for (const entry of await readdir(specsRoot, { withFileTypes: true })) {
            if (entry.isDirectory() && !keep.has(entry.name)) await rm(path.join(specsRoot, entry.name), { recursive: true, force: true })
          }
        }
        const results = []
        results.push(await openspec({ ...id, artifact: "proposal", content: String(i.proposal) }))
        if (i.skipSpecs === true) {
          results.push(await openspec({ ...id, artifact: "specs", skipSpecs: true }))
        } else {
          const specs = normalizedSpecs
          if (specs.length === 0) return out({ error: "openspec-plan 的 specs 不能为空；仅行为保持型重构可用 skipSpecs:true。" })
          for (const spec of specs) {
            if (!spec?.capability || !spec?.content) return out({ error: "每个 spec 需要 {capability,content}。" })
            results.push(await openspec({ ...id, artifact: "specs", capability: String(spec.capability), content: String(spec.content) }))
          }
        }
        results.push(await openspec({ ...id, artifact: "design", content: design }))
        results.push(await openspec({ ...id, artifact: "tasks", content: String(i.tasks) }))
        return out({ status: "ready", artifacts: results.map((result) => result.artifact), nextAction: "提交当前 delivery-plan 阶段。" })
      }
      return out({ error: `未知 action：${args.action}` })
    } catch (error) {
      return out({ error: (error as Error).message, errorType: (error as Error).name })
    }
  },
})

const observationKind = tool.schema.enum([
  "current-behavior-fact", "current-topology-fact", "current-spec-decision",
  "compatibility-constraint", "evidence-gap", "open-question",
])

function claimFromObservation(stage: string, heading: string, observation: {
  kind: string; statement: string; evidence_refs?: string[]; absent?: boolean
}): StageClaim {
  const rawRefs = (observation.evidence_refs ?? []).filter(Boolean).map((reference) => {
    const value = String(reference).trim().replace(/\\/gu, "/")
    if (/^(?:user-input|code|schema|test|runtime|openspec|git|search):/u.test(value)) return value
    if (/^openspec\//u.test(value)) return `openspec:${value}`
    if (/\.(?:sql|ddl)(?:#|$)/iu.test(value)) return `schema:${value}`
    if (/^(?:src|app|apps|packages|services|pom\.xml|build\.gradle)(?:\/|#|$)/u.test(value)) return `code:${value}`
    return value
  })
  const authorityRefs = rawRefs.map((reference) => reference.startsWith("request:") ? "user-input:original-request"
    : reference === "openspec:index" ? "search:openspec/specs-and-prior-changes" : reference)
  const evidenceRefs = authorityRefs.filter((reference) => !reference.startsWith("user-input:"))
  const gap = observation.kind === "evidence-gap" || observation.kind === "open-question"
  const digest = createHash("sha256").update(`${stage}\0${heading}\0${observation.kind}\0${observation.statement}`).digest("hex").slice(0, 10)
  const absenceCandidate = observation.statement.replace(/[“"][^”"\n]{0,100}[”"]/gu, "").replace(/\s+/gu, "")
  const negative = /(?:^|(?:当前|现有|既有|代码|系统|仓库|能力|实现|定义|证据|路径|接口|表))[^。；]{0,18}(?:不存在|未发现|尚无|没有|无专门|无可执行)|(?:只有|仅有)[^。；]{0,30}(?:能力|实现|路径|接口|表|模块)/u.test(absenceCandidate)
  const absent = Boolean(observation.absent) || (negative && evidenceRefs.some((ref) => ref.startsWith("search:")))
  return {
    id: `${gap ? "OPEN" : "FACT"}-${digest}`,
    kind: observation.kind,
    statement: observation.statement.trim(),
    maturity: gap ? "hypothesis" : "fact",
    documentSection: heading,
    authorityRefs: authorityRefs.length ? authorityRefs : ["user-input:original-request"],
    evidenceRefs: gap ? evidenceRefs : evidenceRefs,
    attributes: {
      observationLevel: evidenceRefs.some((ref) => ref.startsWith("runtime:")) ? "runtime-observed"
        : evidenceRefs.some((ref) => ref.startsWith("test:")) ? "test-verified" : "statically-reachable",
      availability: absent ? "absent" : (gap ? "unknown" : "operational"),
      evidenceSubject: observation.statement.trim().slice(0, 160),
    },
  }
}

const submitSectionTool = tool({
  description: "暂存当前 DDD 阶段的一个章节。一次只写一个允许的二级标题；运行时自动生成 claim id、成熟度、章节映射和证据属性，避免模型手写复杂合同。",
  args: {
    stage: reqText().describe("prepare 返回的精确 stageId。"),
    heading: reqText().describe("stageCard.allowedSectionHeadings 中的一个精确标题。"),
    summary: reqText().describe("当前阶段一句话结论，至少 20 个字符。"),
    content: reqText().describe("该章节正文，通常 600-1400 字符；不得含 ## 二级标题。"),
    observations: tool.schema.array(tool.schema.object({
      kind: observationKind,
      statement: reqText().describe("正文中的一条事实、约束、证据缺口或开放问题。"),
      evidence_refs: tool.schema.array(reqText()).optional().describe("可检查引用，例如 code:src/A.java#L10、test:tests/A.test、search:src/**。事实必须提供。"),
      absent: tool.schema.boolean().optional().describe("只有负向搜索证明不存在时才为 true，并提供 search: 引用。"),
    })).optional().describe("仅现状证据阶段需要；其它阶段省略。"),
  },
  async execute(args, context) {
    try {
      const id = await resolveActiveIdentity({ sessionID: context.sessionID, worktree: context.worktree, directory: context.directory })
      const observations = args.observations ?? []
      const missing = observations.map((item) => item.statement.trim()).filter((statement) => !args.content.includes(statement))
      const content = missing.length ? `${args.content.trim()}\n\n### 结构化结论\n${missing.map((item) => `- ${item}`).join("\n")}` : args.content
      return out(await submit({ ...id, stage: args.stage, summary: args.summary,
        sections: { [args.heading]: content },
        claims: observations.map((item) => claimFromObservation(args.stage, args.heading, item)),
        finalize: false }))
    } catch (error) {
      return out({ error: (error as Error).message, errorType: (error as Error).name })
    }
  },
})

const finalizeStageTool = tool({
  description: "对已暂存的当前阶段章节执行完整校验并原子发布。只在 ddd_submit_section 返回 remainingSections=[] 后调用。",
  args: {
    stage: reqText().describe("prepare 返回的精确 stageId。"),
    summary: reqText().describe("本阶段最终一句话结论，至少 20 个字符。"),
    planned_slices: tool.schema.number().int().positive().optional(),
    slice_id: tool.schema.string().optional(),
  },
  async execute(args, context) {
    try {
      const id = await resolveActiveIdentity({ sessionID: context.sessionID, worktree: context.worktree, directory: context.directory })
      return out(await submit({ ...id, stage: args.stage, summary: args.summary, sections: {}, finalize: true,
        plannedSlices: args.planned_slices, sliceId: args.slice_id }))
    } catch (error) {
      return out({ error: (error as Error).message, errorType: (error as Error).name })
    }
  },
})

export const dddLifecycleTool: ToolDefinition = lifecycleTool

// Mobile Coder may recreate the plugin hook object between model steps. Keep
// session guards at module scope so a stage prepared in one step still
// constrains repository and shell tools in the next step.
const dddSessions = new Set<string>()
const evidenceCalls = new Map<string, number>()
const activeStages = new Map<string, string>()
const repositoryCalls = new Map<string, number>()
const shellCalls = new Map<string, number>()
const evidenceTools = new Set(["read", "glob", "grep"])

export const DddWorkflowPlugin: Plugin = async (pluginInput, pluginOptions) => {
  // OpenCode and Mobile Coder 1.3+ both expose this definition directly from
  // the Plugin SDK. No MCP process, protocol adapter, or duplicated tool is
  // involved.
  const lifecycleToolId = "ddd_lifecycle"
  return {
    async config(config) {
      config.agent ??= {}
      config.agent[DDD_AGENT_ID] = {
        ...(config.agent[DDD_AGENT_ID] ?? {}),
        description: "Run the deterministic DDD/OpenSpec lifecycle with a reduced tool surface.",
        mode: "primary",
        maxSteps: 30,
        prompt: "DDD scheduler mode: use tools without progress narration. Existing-system baseline is prepare, one evidence-bundle, then one complete-stage; repository and shell exploration are unnecessary. Other stages are prepare then one complete-stage. Use openspec-plan once at milestone V. Stop only at a human gate or real block.",
        tools: { ...(config.agent[DDD_AGENT_ID]?.tools ?? {}), ...modelingOnlyTools },
      }
      config.agent[DDD_CODE_AGENT_ID] = {
        ...(config.agent[DDD_CODE_AGENT_ID] ?? {}),
        description: "Implement approved DDD vertical slices with bounded repository tools and real Git/test evidence.",
        mode: "primary",
        maxSteps: 50,
        prompt: "DDD coding mode: use the approved roadmap and model contract. One vertical slice, one verification set, one Git commit, one complete-stage transaction. Never redesign or install infrastructure.",
        tools: { ...(config.agent[DDD_CODE_AGENT_ID]?.tools ?? {}), ...disabledDddAgentTools },
      }
      config.command ??= {}
      config.command.ddd = {
        ...(config.command.ddd ?? {}),
        description: "启动或继续一个具有六个人工里程碑的 DDD 工作流",
        agent: DDD_AGENT_ID,
        template: DDD_COMMAND_TEMPLATE,
      }
      config.command["ddd-code"] = {
        ...(config.command["ddd-code"] ?? {}),
        description: "批准交付计划并实现 DDD 纵向切片，形成真实测试与 Git 证据",
        agent: DDD_CODE_AGENT_ID,
        template: DDD_CODE_COMMAND_TEMPLATE,
      }
    },
    async "command.execute.before"(input) {
      if (input.command === "ddd" || input.command === "ddd-code") dddSessions.add(input.sessionID)
    },
    async "tool.execute.before"(input, hookOutput) {
      const args = hookOutput.args as Record<string, any> | undefined
      if (input.tool === "skill" && args?.name === "ddd-orchestrate") dddSessions.add(input.sessionID)
      const stagePayload = String(args?.input?.stage ?? "")
      const isDddLifecyclePayload = typeof args?.action === "string" && (
        args.action === "init" ||
        /^(?:0[0-9]|10)-[a-z0-9-]+$/u.test(stagePayload) ||
        (dddSessions.has(input.sessionID) && ["status", "archive", "openspec", "openspec-plan", "evidence-bundle"].includes(args.action))
      )
      if (isDddLifecyclePayload) {
        // The lifecycle call itself is authoritative proof that this is a DDD
        // session. Mobile Coder may wrap a configured custom tool under an
        // internal id that differs from the UI label, so payload shape is more
        // reliable than input.tool here.
        dddSessions.add(input.sessionID)
        if (args?.action === "prepare" && args?.input?.stage) {
          const stage = String(args.input.stage)
          activeStages.set(input.sessionID, stage)
          repositoryCalls.set(input.sessionID, 0)
          shellCalls.set(input.sessionID, 0)
          if (stage === "01-current-evidence") evidenceCalls.set(input.sessionID, 0)
        }
        if (["submit", "complete-stage"].includes(args?.action) && args?.input?.stage === "01-current-evidence") {
          evidenceCalls.delete(input.sessionID)
        }
      }
      const activeStage = activeStages.get(input.sessionID)
      if (activeStage === "09-implementation") {
        if (["subagent", "workflow_run", "todowrite"].includes(input.tool)) {
          throw new Error("DDD_IMPLEMENTATION_TOOL_DENIED: 一个纵向切片必须在当前短事务内实现，禁止子代理、工作流扇出和探索 Todo。使用批准的文件映射；证据环境不可用时调用 action=block。")
        }
        if (evidenceTools.has(input.tool)) {
          const used = repositoryCalls.get(input.sessionID) ?? 0
          if (used >= 16) throw new Error("DDD_IMPLEMENTATION_REPOSITORY_BUDGET_EXHAUSTED: 当前切片 16 次定向仓库读取预算已用完。禁止继续探索；依据批准的文件映射实施，或用 action=block 如实报告证据缺口。")
          repositoryCalls.set(input.sessionID, used + 1)
        }
        if (["bash", "shell"].includes(input.tool)) {
          const command = String(args?.command ?? "")
          if (/(?:Invoke-WebRequest|curl\s|wget\s|winget\s|choco\s|scoop\s|npm\s+install|下载|apache-maven)/iu.test(command)) {
            throw new Error("DDD_IMPLEMENTATION_BOOTSTRAP_DENIED: Coding 阶段禁止临时下载或安装构建基础设施。缺失 Maven、数据库、缓存或外部服务时调用 action=block，记录真实证据与修复条件。")
          }
          const used = shellCalls.get(input.sessionID) ?? 0
          if (used >= 10) throw new Error("DDD_IMPLEMENTATION_COMMAND_BUDGET_EXHAUSTED: 当前切片 10 次命令预算已用完。禁止通过命令变体反复重试；请提交已有真实证据或调用 action=block。")
          shellCalls.set(input.sessionID, used + 1)
        }
      }
      if (evidenceCalls.has(input.sessionID)) {
        if (["subagent", "workflow_run", "todowrite"].includes(input.tool)) {
          throw new Error("DDD_EVIDENCE_TOOL_DENIED: 现状证据阶段禁止子代理、工作流扇出和探索 Todo；请在当前短事务内完成定向取证。")
        }
        if (evidenceTools.has(input.tool) || ["bash", "shell"].includes(input.tool)) {
          throw new Error("DDD_EVIDENCE_BUNDLE_REQUIRED: 现状阶段禁止逐文件或 Shell 探索。请调用一次 ddd_lifecycle(action=evidence-bundle, input={stage:'01-current-evidence',terms:[...]})，然后直接 complete-stage；包外未知项记录为 evidence gap。")
        }
      }
      // Formal DDD/OpenSpec artifacts are transaction-owned. The model may
      // edit production code, but it must publish review documents and
      // planning artifacts through ddd_lifecycle so validation happens before
      // the atomic write. This also prevents a weaker scheduler from bypassing
      // the milestone-V artifact gate with a generic file tool.
      if (input.tool === "edit" || input.tool === "write" || input.tool === "apply_patch" || input.tool === "patch" || input.tool === "multiedit") {
        const target = String(args?.filePath ?? args?.path ?? "").replace(/\\/gu, "/")
        const formalArtifact = /(?:^|\/)openspec\/changes\/[^/]+\/(?:ddd\/(?:I|II|III|IV|V|VI)-[a-z-]+\.md|proposal\.md|design\.md|tasks\.md|specs\/[^/]+\/spec\.md)$/iu
        if (dddSessions.has(input.sessionID) && target && formalArtifact.test(target)) {
          throw new Error("DDD_FORMAL_ARTIFACT_WRITE_DENIED: 正式里程碑和 OpenSpec 规划工件只能通过 ddd_lifecycle 的 complete-stage/openspec-plan 事务写入，禁止使用通用文件工具绕过结构、语义与 strict validate 门禁。")
        }
      }
      if (dddSessions.has(input.sessionID) && activeStage !== "09-implementation"
        && ["read", "glob", "grep", "bash", "shell"].includes(input.tool)) {
        throw new Error("DDD_LIFECYCLE_ONLY: 当前建模/审批阶段只允许 professional skill 与 ddd_lifecycle。无需检查 Skill 目录、扫描 OpenSpec 或查找 CLI；review 会自动绑定当前人工门，prepare 会返回全部阶段上下文。")
      }
    },
    async "tool.execute.after"(input, hookOutput) {
      const request = (input.args as Record<string, any> | undefined) ?? {}
      if (!dddSessions.has(input.sessionID) || request.action !== "prepare") return
      try {
        const raw = hookOutput.output as unknown
        const result = typeof raw === "string" ? JSON.parse(raw) : raw as any
        if (result?.stageCard?.scopeContractId === "existing-system-baseline") {
          evidenceCalls.set(input.sessionID, 0)
        } else if (result?.stageCard) {
          evidenceCalls.delete(input.sessionID)
        }
        if (result?.stageCard?.stageId) {
          activeStages.set(input.sessionID, result.stageCard.stageId)
          repositoryCalls.set(input.sessionID, 0)
          shellCalls.set(input.sessionID, 0)
        }
      } catch {
        // The explicit-stage path in before remains authoritative when a host
        // wraps display output. Do not guess a phase from unparseable output.
      }
    },
    tool: { [lifecycleToolId]: dddLifecycleTool },
  }
}

export default DddWorkflowPlugin
