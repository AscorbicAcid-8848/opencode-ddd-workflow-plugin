import path from "node:path"
import { createHash } from "node:crypto"
import { readFile, readdir, rm } from "node:fs/promises"
import { tool, type Plugin, type ToolDefinition } from "@opencode-ai/plugin"
import { initialize, prepare, submit, review, status, block, archive, openspec, workflowTransition, containsRequiredConcept } from "./engine.js"
import { profileFor } from "./catalog.js"
import { loadState, saveState } from "./state.js"
import { workflowRoot, statePath } from "./state.js"
import { exists, readJson, writeJson } from "./fs.js"
import { evidenceBundle } from "./evidence.js"
import { compileDeliveryMilestoneSections, compileStructuredPlan, normalizeStructuredPlan, validateStructuredPlan, type StructuredDeliveryPlan } from "./delivery-plan.js"
import type { WorkflowType, LifecycleAction, ReviewDecision, OpenSpecArtifact, StageClaim } from "./types.js"

const workflowType = tool.schema.enum(["add-feature", "refactor-system", "create-system"])
const lifecycleAction = tool.schema.enum(["init", "prepare", "evidence-bundle", "complete-stage", "review", "status", "block", "archive", "openspec", "openspec-plan"])
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

async function bindRuntimeSession(identity: SessionIdentity, sessionID?: string): Promise<void> {
  if (!sessionID) return
  const root = path.join(identity.projectRoot, "openspec", "changes", identity.workflowId, "ddd")
  if (!await exists(statePath(root))) return
  const state = await loadState(root)
  if (state.runtimeSessionId === sessionID) return
  state.runtimeSessionId = sessionID
  await saveState(root, state)
}

const LIFECYCLE_ONLY_SENTINEL = "__ddd-lifecycle-only__"

function pluginProjectRoots(pluginInput: unknown): string[] {
  const input = pluginInput as { worktree?: string; directory?: string }
  return [...new Set([input.directory, input.worktree, process.cwd()]
    .filter((candidate): candidate is string => Boolean(candidate))
    .map((candidate) => path.resolve(candidate)))]
}

async function persistedStageForSession(projectRoots: string | string[], sessionID: string): Promise<string | undefined> {
  for (const projectRoot of Array.isArray(projectRoots) ? projectRoots : [projectRoots]) {
    const changesDir = path.join(projectRoot, "openspec", "changes")
    if (!await exists(changesDir)) continue
    for (const entry of await readdir(changesDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === "archive") continue
      const root = path.join(changesDir, entry.name, "ddd")
      if (!await exists(statePath(root))) continue
      try {
        const state = await loadState(root)
        if (state.runtimeSessionId !== sessionID || ["complete", "rejected"].includes(state.status)) continue
        // prepare is intentionally cleared when a stage is published and at a
        // human gate. A new Mobile process must still recover the owning DDD
        // session before its first Read/Bash call. Prefer the explicit prepared
        // or blocked stage, then the pending human gate, and finally the durable
        // current/checkpoint stage. The sentinel fails closed for older states
        // that have session ownership but no usable stage id.
        const pendingGate = [...state.checkpoints].reverse().find((checkpoint) =>
          checkpoint.status === "awaiting_review" || checkpoint.status === "revision_requested")
        if (state.status === "runtime_blocked") return LIFECYCLE_ONLY_SENTINEL
        return [state.preparedStage?.stage, state.runtimeBlock?.stage, pendingGate?.stage,
          state.currentStage, state.checkpoints.at(-1)?.stage]
          .find((stage): stage is string => typeof stage === "string" && stage.trim().length > 0)
          ?? LIFECYCLE_ONLY_SENTINEL
      } catch {
        // A malformed unrelated change must not break tool dispatch.
      }
    }
  }
  return undefined
}

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

function lifecycleFailure(error: unknown, action: unknown) {
  const result: Record<string, unknown> = {
    error: (error as Error).message,
    errorType: (error as Error).name,
  }
  if (action === "review") {
    return {
      ...result,
      retryableByModel: false,
      mustStop: true,
      stopReason: "human-gate-contract-failed",
      repairContract: {
        boundary: "human-review",
        allowedTools: ["ddd_lifecycle"],
        forbiddenRecovery: ["read milestone files", "scan OpenSpec", "inspect plugin source", "run shell commands"],
        nextAction: "原样向用户报告本错误并停止。不得自行把批准改为退回；只有用户明确给出修改意见后，才可用 review(decision=revise) 返回拥有该决策的阶段。",
      },
    }
  }
  return result
}

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

function endpointContracts(text: string): Set<string> {
  const result = new Set<string>()
  for (const match of text.matchAll(/\b(GET|POST|PUT|PATCH|DELETE)\s+(\/[A-Za-z0-9_{}\-/.?=&$()]+)/giu)) {
    const route = match[2].split("?")[0].replace(/\/$/u, "") || "/"
    result.add(`${match[1].toUpperCase()} ${route}`)
  }
  return result
}

async function validatePlanAgainstApprovedDesign(
  projectRoot: string,
  root: string,
  profile: Awaited<ReturnType<typeof profileFor>>,
  state: Awaited<ReturnType<typeof loadState>>,
  plan: StructuredDeliveryPlan,
) {
  const findings: Array<{ code: string; path: string; message: string }> = []
  const tacticalStages = new Set(profile.stages.filter((stage) => stage.scopeContract?.id === "context-tactical-design").map((stage) => stage.id))
  const tacticalCheckpoint = [...state.checkpoints].reverse().find((checkpoint) => tacticalStages.has(checkpoint.stage) && ["completed", "approved"].includes(checkpoint.status))
  let approvedText = ""
  if (tacticalCheckpoint) {
    const fileName = profile.documents[tacticalCheckpoint.document]
    const file = fileName ? path.join(root, fileName) : ""
    if (file && await exists(file)) approvedText = await readFile(file, "utf8")
  }
  const planText = JSON.stringify(plan)
  const approvedEndpoints = endpointContracts(approvedText)
  for (const endpoint of endpointContracts(planText)) {
    if (!approvedEndpoints.has(endpoint)) findings.push({
      code: "PLAN_UNAPPROVED_INTERFACE",
      path: "plan.slices",
      message: `交付计划引入了战术设计未批准的接口 ${endpoint}；路线图只能映射里程碑 IV 已批准契约。`,
    })
  }
  const repositoryEvidenceParts = [approvedText]
  for (const file of ["pom.xml", "build.gradle", "build.gradle.kts", "package.json", "docker-compose.yml", "compose.yml"]) {
    const candidate = path.join(projectRoot, file)
    if (await exists(candidate)) repositoryEvidenceParts.push(await readFile(candidate, "utf8"))
  }
  const repositoryEvidence = repositoryEvidenceParts.join("\n")
  const infrastructureChecks: Array<[RegExp, RegExp, string]> = [
    [/\bflyway\b/iu, /\bflyway\b/iu, "Flyway"],
    [/\bliquibase\b/iu, /\bliquibase\b/iu, "Liquibase"],
    [/\bdocker(?:-compose|\s+compose)\b/iu, /\bdocker(?:-compose|\s+compose)\b/iu, "Docker Compose"],
    [/\bkafka(?:-topics|-console)?\b/iu, /\bkafka\b/iu, "Kafka 工具链"],
    [/\bredis-cli\b/iu, /\bredis(?:-cli)?\b/iu, "redis-cli"],
  ]
  for (const [used, evidenced, label] of infrastructureChecks) {
    if (used.test(planText) && !evidenced.test(repositoryEvidence)) findings.push({
      code: "PLAN_UNEVIDENCED_INFRASTRUCTURE",
      path: "plan.slices[].verification",
      message: `交付计划使用了 ${label}，但批准战术设计和仓库构建配置均无该工具证据；请改用现有工程能力或列为人工阻塞。`,
    })
  }
  return findings
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
  "Use only `ddd_lifecycle`. Every input/sections/observations value must be a native object or array, never a JSON string. For an existing-system evidence stage call action=evidence-bundle once after prepare with 2-6 likely source identifiers; prefer short symbols such as Shop/User/Controller over invented compound class names. Do not use repository or shell exploration. For every stage call action=complete-stage once with every allowed heading. Continue until human review, a real block, archive, or completion.",
  "complete-stage owns claim bookkeeping and atomic publication. Submit the full stage once. If it returns draft.saved=true, obey draft.repairContract: repair only editablePaths; when replaceObservations=true resend one complete observations array, otherwise do not resend unchanged sections. If draft.retryableByModel=false, stop and report the block. At milestone V submit one structured openspec-plan, then call complete-stage with empty input; the runtime compiles all OpenSpec and milestone-V Markdown.",
  "Keep total section text between qualityContract.minTotalChars and targetMaxTotalChars. Omit observations when stageCard has no claimContract. Do not narrate plans between tool calls. Treat the evidence bundle as complete; record anything outside it as evidence-gap/open-question. At a human gate output transition.message and stop.",
  "",
  "$ARGUMENTS",
].join("\n")

const disabledDddAgentTools = {
  invalid: false,
  ddd_lifecycle: true,
  skill: true,
  pdf_parse: false, excel_parse: false, excel_write: false,
  subagent: false, task: false, workflow_run: false, todowrite: false,
  webfetch: false, websearch: false, codesearch: false,
  // Skill authoring/evaluation tools are host-management capabilities. DDD
  // stages consume professional guidance through `skill`; exposing the
  // management surface only adds schema tokens and escape routes.
  skill_run_script: false,
  skill_prepare_workspace: false, skill_validate: false, skill_parse: false,
  skill_add_gold_standard: false, skill_list_gold_standards: false,
  skill_remove_gold_standard: false, skill_get_gold_advice: false,
  skill_eval: false, skill_improve_description: false, skill_optimize_loop: false,
  skill_aggregate_benchmark: false, skill_generate_report: false,
  skill_serve_review: false, skill_stop_review: false,
  skill_export_static_review: false,
  CronCreate: false, CronList: false, CronDelete: false,
  question: false, plan_enter: false, plan_exit: false, lsp: false,
  ls: false, list: false, mcp: false, lingji_run: false, evolve_run: false,
}

const modelingOnlyTools = {
  ...disabledDddAgentTools,
  read: false, glob: false, grep: false, bash: false, shell: false,
  edit: false, write: false, apply_patch: false, patch: false, multiedit: false, multi_edit: false,
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
  description: "DDD 工作流生命周期控制器。init→prepare→现状 evidence-bundle→complete-stage→review；里程碑 V 只提交结构化 openspec-plan，由运行时编译 OpenSpec 和路线图；Coding 按批准 sliceId 推进；最终 archive。",
  args: {
    action: lifecycleAction,
    workflow_type: workflowType.optional().describe("init 必填；其余当项目仅有一个活动 change 时可省略。"),
    workflow_id: reqText().optional().describe("init 必填；其余当项目仅有一个活动 change 时可省略。"),
    project_root: tool.schema.string().optional().describe("项目根目录，默认取会话 worktree。"),
    input: tool.schema.record(tool.schema.string(), tool.schema.any()).optional()
      .describe("init/prepare/evidence-bundle/complete-stage/review 的原生对象载荷。必须直接传对象，禁止把 JSON 再编码成字符串。"),
    plan: tool.schema.record(tool.schema.string(), tool.schema.any()).optional()
      .describe("仅 openspec-plan 使用的顶层计划对象：title/objective/nonGoals/designDecisions/capabilities/slices。直接传对象，禁止 JSON 字符串。"),
    mode: tool.schema.enum(["replace", "repair"]).optional().describe("openspec-plan 模式；首次 replace，修复 findings 时 repair。"),
    skip_specs: tool.schema.boolean().optional().describe("仅行为保持型重构的 openspec-plan 可设 true。"),
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
        const identity = { workflowType: args.workflow_type, workflowId: args.workflow_id, projectRoot: root }
        sessionIdentities.set(context.sessionID, identity)
        await bindRuntimeSession(identity, context.sessionID)
        return out(result)
      }
      const id = await resolveActiveIdentity(ctx, args.workflow_type, args.workflow_id)
      await bindRuntimeSession(id, context.sessionID)
      if (args.action === "prepare") {
        const i = payload ?? {}
        const requestedStage = typeof i.stage === "string" && /^(?:0[0-9]|1[0-2])-[a-z0-9-]+$/u.test(i.stage) ? i.stage : undefined
        const transition = requestedStage ? null : await status(id)
        const stage = requestedStage ?? transition?.nextStage
        if (!stage) return out({ error: `prepare 需要明确 stage；当前候选为：${transition?.allowedNextStages.join("、") || "无"}。` })
        return out(await prepare({ ...id, stage }))
      }
      if (args.action === "evidence-bundle") {
        const i = payload
        if (!baselineStages.has(String(i?.stage ?? ""))) return out({ error: "evidence-bundle 仅属于已有系统基线阶段（01-current-evidence 或 01-baseline-evidence）。" })
        return out(await evidenceBundle(id.projectRoot, id.workflowId, i?.terms))
      }
      if (args.action === "complete-stage") {
        const i: Record<string, any> = payload ?? {}
        const requestedStage = typeof i.stage === "string" && /^(?:0[0-9]|1[0-2])-[a-z0-9-]+$/u.test(i.stage) ? i.stage : undefined
        const transition = requestedStage ? null : await status(id)
        const stage = requestedStage ?? transition?.nextStage
        if (!stage) return out({ error: `complete-stage 无法解析唯一阶段；当前候选为：${transition?.allowedNextStages.join("、") || "无"}。` })
        const workflowProfile = await profileFor(id.workflowType)
        const stageContract = workflowProfile.stages.find((item) => item.id === stage)
        let summary = String(i.summary ?? "").trim()
        let rawSections = i.sections
        if (stageContract?.deliveryAssetGate) {
          const root = await workflowRoot(id.projectRoot, workflowProfile.artifactBase, workflowProfile.artifactSubdir, id.workflowId)
          const state = await loadState(root)
          const planFile = path.join(root, ".ddd", "delivery", "plan.json")
          if (!state.deliveryPlan || !await exists(planFile)) return out({
            error: "交付规划阶段必须先成功调用一次 openspec-plan；运行时随后会自动编译里程碑 V，无需模型再次手写全文。",
          })
          const plan = await readJson<StructuredDeliveryPlan>(planFile)
          const contractFile = path.join(root, "model-contract.json")
          const contract = await exists(contractFile) ? await readJson<any>(contractFile) : {}
          const compiledMilestone = compileDeliveryMilestoneSections(plan, id.workflowId, contract, {
            workflowType: id.workflowType,
          })
          summary = compiledMilestone.summary
          rawSections = compiledMilestone.sections
          i.plannedSlices = state.deliveryPlan.sliceIds.length
        } else if ((!summary && !rawSections) || (rawSections !== undefined && (typeof rawSections !== "object" || Array.isArray(rawSections)))) {
          return out({ error: "首次 complete-stage 需要 input.{summary,sections}。若上次返回 draft.saved=true，可只提交 findings.path 涉及的 sections；运行时会合并候选稿。" })
        }
        const sections = normalizeAtomicSections(rawSections ?? {})
        if (stageContract?.deliveryAssetGate) enrichRoadmapSections(sections)
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
        return out(await submit({ ...id, stage, summary, sections,
          claims: observations.map((item: any) => claimFromObservation(stage, String(item?.heading ?? ""), item)),
          replaceClaims: Array.isArray(i.observations),
          ambiguityResolution: i.ambiguityResolution,
          decisionItems: i.decisionItems,
          finalize: true, ...metadata }))
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
        return out(await review({ ...id, stage, decision, reviewer: i.reviewer, feedback: i.feedback,
          resolution: i.resolution ?? (i.selectedCandidateId ? { selectedCandidateId: i.selectedCandidateId } : undefined) }))
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
        const i: Record<string, any> = { ...(payload ?? {}), ...(args.plan ? { plan: args.plan } : {}), ...(args.mode ? { mode: args.mode } : {}),
          ...(args.skip_specs !== undefined ? { skipSpecs: args.skip_specs } : {}) }
        const planningTransition = await status(id)
        const planningStageId = planningTransition.nextStage ?? planningTransition.allowedNextStages[0]
        const workflowProfile = await profileFor(id.workflowType)
        const planningStage = workflowProfile.stages.find((stage) => stage.id === planningStageId)
        if (!planningStage?.deliveryAssetGate) return out({
          error: `openspec-plan 只允许在交付规划阶段调用；当前阶段为 ${planningStageId ?? "无"}。`,
          retryableByModel: false,
        })
        const root = await workflowRoot(id.projectRoot, workflowProfile.artifactBase, workflowProfile.artifactSubdir, id.workflowId)
        const currentState = await loadState(root)
        const roadmapFile = path.join(root, ".ddd", "delivery", "roadmap.json")
        if (currentState.deliveryPlan?.source === "structured-openspec-plan"
          && currentState.deliveryPlan.sliceIds.length > 0 && await exists(roadmapFile)) {
          return out({
            status: "ready",
            alreadyCompiled: true,
            immutable: true,
            plannedSlices: currentState.deliveryPlan.sliceIds.length,
            sliceIds: currentState.deliveryPlan.sliceIds,
            nextAction: `不要再次调用 openspec-plan；只调用 {"action":"complete-stage","input":{}}。运行时将从已编译计划生成 ${planningStageId}，并自动设置 plannedSlices=${currentState.deliveryPlan.sliceIds.length}。`,
          })
        }
        if (!i?.plan || typeof i.plan !== "object" || Array.isArray(i.plan)) return out({
          error: "openspec-plan 需要顶层 plan 对象；不要放入 input 字符串。运行时会编译 proposal/specs/design/tasks/roadmap。",
          requiredPlanFields: ["title", "objective", "nonGoals", "designDecisions", "capabilities[].requirements[].scenarios[]", "slices[]"],
          exampleShape: { action: "openspec-plan", plan: { title: "...", objective: "...", nonGoals: [], designDecisions: [], capabilities: [], slices: [] } },
        })
        const draftFile = path.join(root, ".ddd", "workbench", "openspec-plan.draft.json")
        const currentDraft = i.mode === "repair" && await exists(draftFile)
          ? await readJson<any>(draftFile) : undefined
        const plan = normalizeStructuredPlan(i.plan, currentDraft)
        await writeJson(draftFile, plan)
        const findings = [
          ...validateStructuredPlan(plan),
          ...await validatePlanAgainstApprovedDesign(id.projectRoot, root, workflowProfile, currentState, plan),
        ]
        if (findings.length) return out({
          status: "invalid", findings, draftSaved: true, retryableByModel: true,
          nextAction: "用 mode=repair 只提交 findings 涉及的 capability 或 slice；运行时保留其余草稿字段。",
        })
        const compiled = compileStructuredPlan(plan, id.workflowId)
        const contractFile = path.join(id.projectRoot, "openspec", "changes", id.workflowId, "ddd", "model-contract.json")
        let design = compiled.design
        if (await exists(contractFile)) {
          const contract = await readJson<Record<string, any>>(contractFile)
          const approvedModels = new Set<string>((contract.modelElements ?? []).map((item: any) => String(item.id)))
          const approvedInvariants = new Set<string>((contract.invariants ?? []).map((item: any) => String(item.id)))
          const referencedModels = new Set(plan.slices.flatMap((slice) => slice.modelElementIds))
          const referencedInvariants = new Set(plan.slices.flatMap((slice) => slice.invariantIds))
          const modelFindings = [
            ...[...referencedModels].filter((modelId) => !approvedModels.has(modelId)).map((modelId) => ({ code: "PLAN_MODEL_UNKNOWN", path: "plan.slices[].modelElementIds", message: `${modelId} 不在批准的 model-contract.json 中。` })),
            ...[...referencedInvariants].filter((invariantId) => !approvedInvariants.has(invariantId)).map((invariantId) => ({ code: "PLAN_INVARIANT_UNKNOWN", path: "plan.slices[].invariantIds", message: `${invariantId} 不在批准的 model-contract.json 中。` })),
            ...[...approvedModels].filter((modelId) => !referencedModels.has(modelId)).map((modelId) => ({ code: "PLAN_MODEL_UNCOVERED", path: "plan.slices", message: `批准模型 ${modelId} 未被任何纵向切片覆盖。` })),
            ...[...approvedInvariants].filter((invariantId) => !referencedInvariants.has(invariantId)).map((invariantId) => ({ code: "PLAN_INVARIANT_UNCOVERED", path: "plan.slices", message: `批准不变量 ${invariantId} 未被任何纵向切片覆盖。` })),
          ]
          if (modelFindings.length) return out({ status: "invalid", findings: modelFindings, draftSaved: true, retryableByModel: true,
            nextAction: "用 mode=repair 修正切片的 modelElementIds/invariantIds，必须与批准模型合同完全覆盖。" })
          const appendix = [
            "## 批准模型合同（运行时注入，不可改写）",
            ...(contract.modelElements ?? []).map((item: any) => `- ${item.id} ${item.name}`),
            ...(contract.invariants ?? []).map((item: any) => `- ${item.id}：${item.statement}`),
          ].join("\n")
          design = `${design.trim()}\n\n${appendix}`
        }
        const normalizedSpecs = compiled.specs.map((spec) => ({ ...spec, content: normalizeDeltaSpec(spec.content, id.workflowType) }))
        const malformed = normalizedSpecs.filter((spec: any) => {
          if (!spec.capability || !/^##\s+(?:ADDED|MODIFIED|REMOVED|RENAMED)\s+Requirements\s*$/mu.test(spec.content)) return true
          const blocks = String(spec.content).split(/^###\s+Requirement:/mu).slice(1)
          return blocks.length === 0 || blocks.some((block) => !/\b(?:MUST|SHALL)\b/u.test(block) || !/^####\s+Scenario:/mu.test(block))
        })
        if (i.skipSpecs !== true && malformed.length) throw new Error("STRUCTURED_PLAN_COMPILER_DEFECT：运行时生成了非法 Delta Spec。")
        const specsRoot = path.join(id.projectRoot, "openspec", "changes", id.workflowId, "specs")
        if (await exists(specsRoot) && i.skipSpecs !== true) {
          const keep = new Set(normalizedSpecs.map((spec: any) => String(spec.capability)))
          for (const entry of await readdir(specsRoot, { withFileTypes: true })) {
            if (entry.isDirectory() && !keep.has(entry.name)) await rm(path.join(specsRoot, entry.name), { recursive: true, force: true })
          }
        }
        const results = []
        results.push(await openspec({ ...id, artifact: "proposal", content: compiled.proposal }))
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
        results.push(await openspec({ ...id, artifact: "tasks", content: compiled.tasks }))
        const deliveryRoot = path.join(root, ".ddd", "delivery")
        await writeJson(path.join(deliveryRoot, "plan.json"), plan)
        await writeJson(path.join(deliveryRoot, "roadmap.json"), compiled.roadmap)
        const state = await loadState(root)
        state.deliveryPlan = {
          source: "structured-openspec-plan",
          sliceIds: plan.slices.map((slice) => slice.id),
          dependencies: Object.fromEntries(plan.slices.map((slice) => [slice.id, slice.dependsOn])),
          completedSliceIds: [],
        }
        await saveState(root, state)
        await rm(draftFile, { force: true })
        return out({ status: "ready", artifacts: results.map((result) => result.artifact),
          plannedSlices: plan.slices.length, sliceIds: state.deliveryPlan.sliceIds,
          nextAction: `只调用 {"action":"complete-stage","input":{}}；运行时将从已校验计划确定性编译里程碑 V，并自动设置 plannedSlices=${plan.slices.length}。` })
      }
      return out({ error: `未知 action：${args.action}` })
    } catch (error) {
      return out(lifecycleFailure(error, args.action))
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
      evidence_refs: tool.schema.array(reqText()).optional().describe("可检查引用，例如 code:src/A.java#L10、test:tests/A.test。负向 search: 引用只能逐字复制 evidence-bundle 签发的 negativeSearchEvidence.ref。"),
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
const codingSessions = new Set<string>()
// The command hook is the only runtime boundary that sees the user's exact
// slash-command argument before the model can reinterpret it. Bind that text
// to the session and make init consume it as authoritative input.
const pendingOriginalRequests = new Map<string, string>()
const evidenceCalls = new Map<string, number>()
const activeStages = new Map<string, string>()
const repositoryCalls = new Map<string, number>()
const shellCalls = new Map<string, number>()
const evidenceTools = new Set(["read", "glob", "grep"])
const implementationStages = new Set(["08-implementation", "09-implementation", "11-implementation"])
const baselineStages = new Set(["01-current-evidence", "01-baseline-evidence"])
const lifecycleActions = new Set(["init", "prepare", "evidence-bundle", "complete-stage", "review", "status", "block", "archive", "openspec", "openspec-plan"])

function lifecyclePayload(args: Record<string, any> | undefined): Record<string, any> {
  if (!args) return {}
  if (typeof args.input === "string") {
    try {
      const parsed = JSON.parse(args.input)
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}
    } catch {
      return {}
    }
  }
  return args.input && typeof args.input === "object" && !Array.isArray(args.input) ? args.input : {}
}

function dddRequestFromMessage(parts: any[]): string | undefined {
  for (const part of parts) {
    if (part?.type !== "text") continue
    const raw = String(part.text ?? "").trim().replace(/^(?:"|')|(?:"|')$/gu, "").trim()
    const match = raw.match(/^\/ddd(?:\s+)([\s\S]+)$/u)
    if (match?.[1]?.trim()) return match[1].trim()
  }
  return undefined
}

function applyModelingToolMask(message: { tools?: Record<string, boolean> }): void {
  // UserMessage.tools is the Mobile/OpenCode boundary that controls the model
  // schema for the whole turn. Permission rules alone are insufficient in
  // YOLO mode, and in-memory Sets disappear between `mobile run` processes.
  // Reuse the same policy object used by the configured agent. Keeping one
  // source of truth prevents a host restart or slash-command expansion from
  // exposing a tool that the static agent configuration already denied.
  message.tools = { ...(message.tools ?? {}), ...modelingOnlyTools }
}

export const DddWorkflowPlugin: Plugin = async (pluginInput, pluginOptions) => {
  // OpenCode and Mobile Coder 1.3+ both expose this definition directly from
  // the Plugin SDK. No MCP process, protocol adapter, or duplicated tool is
  // involved.
  const lifecycleToolId = "ddd_lifecycle"
  return {
    async "chat.message"(input, output) {
      const originalRequest = dddRequestFromMessage(output.parts as any[])
      const persistedStage = await persistedStageForSession(pluginProjectRoots(pluginInput), input.sessionID)
      const modelingAgent = input.agent === DDD_AGENT_ID
      const codingAgent = input.agent === DDD_CODE_AGENT_ID
      if (!originalRequest && !persistedStage && !modelingAgent && !codingAgent) return
      dddSessions.add(input.sessionID)
      if (persistedStage) activeStages.set(input.sessionID, persistedStage)
      if (originalRequest) pendingOriginalRequests.set(input.sessionID, originalRequest)
      if (codingAgent) codingSessions.add(input.sessionID)
      else codingSessions.delete(input.sessionID)
      // Mobile derives the visible tool table from UserMessage.tools. Put the
      // modeling policy at that boundary so disallowed tools are physically
      // absent from the model schema instead of relying only on a later hook.
      // ddd-coding keeps its bounded engineering tools visible, but the
      // execute hook still requires lifecycle review/prepare before using them.
      if (!codingAgent) applyModelingToolMask(output.message)
    },
    async config(config) {
      config.agent ??= {}
      config.agent[DDD_AGENT_ID] = {
        ...(config.agent[DDD_AGENT_ID] ?? {}),
        description: "Run the deterministic DDD/OpenSpec lifecycle with a reduced tool surface.",
        mode: "primary",
        maxSteps: 30,
        prompt: "DDD scheduler mode: use tools without progress narration. Existing-system baseline is prepare, one evidence-bundle, then one complete-stage; repository and shell exploration are unnecessary. Other stages are prepare then one complete-stage. At milestone V send one structured plan to openspec-plan, then complete-stage with empty input; never hand-write OpenSpec or milestone-V Markdown. At every DDD modeling human milestone submit decisionItems (empty when no open choice); the runtime, not the model, owns 本次请您确认. Open questions in body must cite their decision id. A plain human approval accepts each unique recommendation; otherwise review must submit resolution.selections. Stop only at a human gate or real block.",
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
      if (input.command === "ddd-code") codingSessions.add(input.sessionID)
      else if (input.command === "ddd") codingSessions.delete(input.sessionID)
      if (input.command === "ddd") {
        const originalRequest = String(input.arguments ?? "").trim()
        if (originalRequest) pendingOriginalRequests.set(input.sessionID, originalRequest)
      }
    },
    async "tool.execute.before"(input, hookOutput) {
      const args = hookOutput.args as Record<string, any> | undefined
      // Mobile Coder may expose built-in tool ids with title casing (Read,
      // Glob, Edit). Normalize at the adapter boundary so policy cannot be
      // bypassed by host-specific capitalization.
      const toolName = String(input.tool ?? "").toLowerCase()
      const boundOriginalRequest = pendingOriginalRequests.get(input.sessionID)
      if (args?.action === "init" && boundOriginalRequest) {
        let initPayload: Record<string, any> = {}
        if (typeof args.input === "string") {
          try {
            const parsed = JSON.parse(args.input)
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) initPayload = parsed
          } catch {
            // Preserve the valid command request even when a weaker caller
            // encoded the remaining init payload incorrectly. The lifecycle
            // will still report any missing required field such as title.
          }
        } else if (args.input && typeof args.input === "object" && !Array.isArray(args.input)) {
          initPayload = args.input
        }
        args.input = { ...initPayload, request: boundOriginalRequest }
      }
      if (toolName === "skill" && args?.name === "ddd-orchestrate") dddSessions.add(input.sessionID)
      const payload = lifecyclePayload(args)
      const stagePayload = String(payload.stage ?? "")
      const isDddLifecyclePayload = typeof args?.action === "string" && lifecycleActions.has(args.action) && (
        toolName === lifecycleToolId ||
        args.action === "init" ||
        /^(?:0[0-9]|1[0-2])-[a-z0-9-]+$/u.test(stagePayload) ||
        dddSessions.has(input.sessionID)
      )
      if (isDddLifecyclePayload) {
        // The lifecycle call itself is authoritative proof that this is a DDD
        // session. Mobile Coder may wrap a configured custom tool under an
        // internal id that differs from the UI label, so payload shape is more
        // reliable than input.tool here.
        dddSessions.add(input.sessionID)
        if (args?.action === "prepare" && payload.stage) {
          const stage = String(payload.stage)
          activeStages.set(input.sessionID, stage)
          repositoryCalls.set(input.sessionID, 0)
          shellCalls.set(input.sessionID, 0)
          if (baselineStages.has(stage)) evidenceCalls.set(input.sessionID, 0)
        }
        if (["submit", "complete-stage"].includes(args?.action) && baselineStages.has(String(payload.stage ?? ""))) {
          evidenceCalls.delete(input.sessionID)
        }
      }
      const activeStage = activeStages.get(input.sessionID)
        ?? await persistedStageForSession(pluginProjectRoots(pluginInput), input.sessionID)
      const sessionIsDdd = dddSessions.has(input.sessionID) || Boolean(activeStage)
      if (sessionIsDdd) {
        dddSessions.add(input.sessionID)
        if (activeStage) activeStages.set(input.sessionID, activeStage)
      }
      const codingToolAccess = Boolean(activeStage && implementationStages.has(activeStage) && codingSessions.has(input.sessionID))
      if (activeStage && implementationStages.has(activeStage)) {
        if (["subagent", "workflow_run", "todowrite"].includes(toolName)) {
          throw new Error("DDD_IMPLEMENTATION_TOOL_DENIED: 一个纵向切片必须在当前短事务内实现，禁止子代理、工作流扇出和探索 Todo。使用批准的文件映射；证据环境不可用时调用 action=block。")
        }
        if (evidenceTools.has(toolName)) {
          const used = repositoryCalls.get(input.sessionID) ?? 0
          if (used >= 16) throw new Error("DDD_IMPLEMENTATION_REPOSITORY_BUDGET_EXHAUSTED: 当前切片 16 次定向仓库读取预算已用完。禁止继续探索；依据批准的文件映射实施，或用 action=block 如实报告证据缺口。")
          repositoryCalls.set(input.sessionID, used + 1)
        }
        if (["bash", "shell"].includes(toolName)) {
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
        if (["subagent", "workflow_run", "todowrite"].includes(toolName)) {
          throw new Error("DDD_EVIDENCE_TOOL_DENIED: 现状证据阶段禁止子代理、工作流扇出和探索 Todo；请在当前短事务内完成定向取证。")
        }
        if (evidenceTools.has(toolName) || ["bash", "shell"].includes(toolName)) {
          throw new Error("DDD_EVIDENCE_BUNDLE_REQUIRED: 现状阶段禁止逐文件或 Shell 探索。请调用一次 ddd_lifecycle(action=evidence-bundle, input={stage:'01-current-evidence',terms:[...]})，然后直接 complete-stage；包外未知项记录为 evidence gap。")
        }
      }
      // Formal DDD/OpenSpec artifacts are transaction-owned. The model may
      // edit production code, but it must publish review documents and
      // planning artifacts through ddd_lifecycle so validation happens before
      // the atomic write. This also prevents a weaker scheduler from bypassing
      // the milestone-V artifact gate with a generic file tool.
      if (["edit", "write", "apply_patch", "patch", "multiedit", "multi_edit"].includes(toolName)) {
        const target = String(args?.filePath ?? args?.path ?? "").replace(/\\/gu, "/")
        const formalArtifact = /(?:^|\/)openspec\/changes\/[^/]+\/(?:ddd\/(?:I|II|III|IV|V|VI)-[a-z-]+\.md|proposal\.md|design\.md|tasks\.md|specs\/[^/]+\/spec\.md)$/iu
        if (sessionIsDdd && target && formalArtifact.test(target)) {
          throw new Error("DDD_FORMAL_ARTIFACT_WRITE_DENIED: 正式里程碑和 OpenSpec 规划工件只能通过 ddd_lifecycle 的 complete-stage/openspec-plan 事务写入，禁止使用通用文件工具绕过结构、语义与 strict validate 门禁。")
        }
      }
      if (sessionIsDdd && !codingToolAccess && !isDddLifecyclePayload && toolName !== "skill") {
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
