import path from "node:path"
import { createHash } from "node:crypto"
import { exists, readJson, writeJson, atomicText, now } from "./fs.js"
import { profileFor, stageContract, stageIndex, milestoneFor, stageTitle } from "./catalog.js"
import { loadState, saveState, activeChange, workflowRoot, statePath } from "./state.js"
import { workflowTransition } from "./transition.js"
import { candidateDocument, documentSections, publishSections, documentPath, writableHeadingsForStage, unfilledHeadings } from "./documents.js"
import { newChange, writeLink, verifyArchive, runOpenSpec, openSpecAction, planningArtifacts } from "./openspec.js"
import type {
  Identity, WorkflowProfile, WorkflowState, Checkpoint, Transition,
  ReviewDecision, OpenSpecArtifact, ValidationFinding, HumanDecisionResolution, DecisionItem,
} from "./types.js"
import { WorkflowError } from "./types.js"
import { claimContractFor, validateStageClaims } from "./claims.js"

export interface InitInput extends Identity { title: string; request: string }
export interface PrepareInput extends Identity { stage?: string }
export interface SubmitInput extends Identity {
  stage: string
  summary: string
  sections: Record<string, string>
  claims?: unknown
  ambiguityResolution?: unknown
  decisionItems?: unknown
  plannedSlices?: number
  sliceId?: string
  finalize?: boolean
  /** A lifecycle observations payload is a complete claim set, not a patch. */
  replaceClaims?: boolean
}
export interface ReviewInput extends Identity { stage: string; decision: ReviewDecision; reviewer: string; feedback?: string; resolution?: HumanDecisionResolution }
export interface StatusInput extends Identity { view?: "compact" | "full" }
export interface BlockInput extends Identity { stage: string; reason: string; evidence?: string[]; remediation?: string[] }
export interface ArchiveInput extends Identity {}
export interface OpenSpecInput extends Identity { artifact: OpenSpecArtifact; content?: string; capability?: string; skipSpecs?: boolean }

export function requiresScenarioClarification(request: string): boolean {
  const text = String(request ?? "").trim()
  if (!text) return true
  const hasScenarioStructure = /(?:当|如果|若|每次|一旦)[^。；\n]{1,60}(?:时|后|前|则|就)/u.test(text)
    || /(?:必须|不得|仅限|允许|禁止)[^。；\n]{1,80}/u.test(text)
    || /(?:查询|记录|展示)[^。；\n]{1,50}(?:返回|形成|保存|展示|成功|失败|为空)/u.test(text)
    || /\b(?:when|if|after|before)\b[^.\n]{1,80}\b(?:then|return|record|display)\b/iu.test(text)
    || /\b(?:must|shall|must not|may only)\b/iu.test(text)
  return !hasScenarioStructure && text.length < 48
}

const DECISION_LEDGER_SCOPES = new Set(["system-discovery", "system-strategy", "context-discovery", "context-tactical-design"])
const DECISION_SOURCE_PREFIX = /^(?:user-input|code|schema|test|runtime|openspec|git|search|decision):/u

function normalizedDecisionItems(raw: unknown, stageId: string): DecisionItem[] | undefined {
  if (!Array.isArray(raw)) return undefined
  return raw.map((item: any) => ({
    id: String(item?.id ?? "").trim(),
    ownerStage: stageId,
    question: String(item?.question ?? "").trim(),
    options: (Array.isArray(item?.options) ? item.options : []).map((option: any) => ({
      id: String(option?.id ?? "").trim(),
      label: String(option?.label ?? "").trim(),
      ...(String(option?.impact ?? "").trim() ? { impact: String(option.impact).trim() } : {}),
    })),
    ...(String(item?.recommendationId ?? "").trim() ? { recommendationId: String(item.recommendationId).trim() } : {}),
    status: ["open", "deferred", "out-of-scope"].includes(String(item?.status ?? "")) ? item.status : "open",
    blocks: (Array.isArray(item?.blocks) ? item.blocks : []).map(String).map((value: string) => value.trim()).filter(Boolean),
    sourceRefs: (Array.isArray(item?.sourceRefs) ? item.sourceRefs : []).map(String).map((value: string) => value.trim()).filter(Boolean),
    ...(String(item?.deferredToStage ?? "").trim() ? { deferredToStage: String(item.deferredToStage).trim() } : {}),
  })) as DecisionItem[]
}

function legacyDecisionItems(ambiguity: any, stageId: string, sections: Record<string, string>): DecisionItem[] | undefined {
  if (ambiguity?.status !== "unresolved" || !Array.isArray(ambiguity?.candidates) || ambiguity.candidates.length === 0) return undefined
  const options = ambiguity.candidates.map((candidate: any) => ({
    id: String(candidate?.id ?? "").trim(), label: String(candidate?.label ?? "").trim(),
  })).filter((option: any) => option.id && option.label)
  const explicit = String(ambiguity?.recommendedCandidateId ?? "").trim()
  const advisory = [sections["本次请您确认"] ?? "", sections["备选解释与建议"] ?? "", sections["备选战略方案与建议"] ?? ""].join("\n")
  const mentioned = options.filter((option: any) => {
    if (/推荐/u.test(option.label)) return true
    const escaped = option.id.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")
    return new RegExp(`(?:推荐[^。；\\n]{0,30}${escaped}|${escaped}[^。；\\n]{0,30}推荐)`, "iu").test(advisory)
  })
  const recommendationId = explicit || (mentioned.length === 1 ? mentioned[0].id : "")
  const affected = Array.isArray(ambiguity?.affectedDecisions) ? ambiguity.affectedDecisions.map(String).filter(Boolean) : []
  return [{
    id: `DEC-${stageId.toUpperCase()}`,
    ownerStage: stageId,
    question: affected.length ? affected.join("；") : "请选择本里程碑的业务解释",
    options,
    ...(recommendationId ? { recommendationId } : {}),
    status: "open",
    blocks: affected.length ? affected : ["当前里程碑唯一结论"],
    sourceRefs: ["user-input:original-request"],
  }]
}

export function renderDecisionReviewSection(items: DecisionItem[]): string {
  const open = items.filter((item) => item.status === "open")
  const deferred = items.filter((item) => item.status !== "open")
  const lines = open.length ? [
    "以下决策尚需人工选择；正文中被 blocks 指向的结论在批准前不具有权威性：",
    ...open.flatMap((item) => [
      `### ${item.id} ${item.question}`,
      ...item.options.map((option) => `- ${option.id}${item.recommendationId === option.id ? "（推荐）" : ""}：${option.label}${option.impact ? `；影响：${option.impact}` : ""}`),
      `- blocks：${item.blocks.join("、")}`,
    ]),
  ] : [
    "本阶段没有待选择的业务决策。",
    "回复“批准”表示接受本文正文中的完整方案；如有不符合业务认知之处，请回复“修改：...”。",
  ]
  if (deferred.length) lines.push("", "### 已明确延期或排除", ...deferred.map((item) => `- ${item.id}：${item.question}（${item.status}）`))
  return lines.join("\n")
}

export function validateHumanDecisionContract(
  state: WorkflowState,
  stage: any,
  sections: Record<string, string>,
  decisionItems: unknown,
): ValidationFinding[] {
  if (!stage.humanGate || !DECISION_LEDGER_SCOPES.has(stage.scopeContract?.id ?? "")) return []
  const findings: ValidationFinding[] = []
  const items = normalizedDecisionItems(decisionItems, stage.id)
  if (!items) return [{
    code: "DECISION_ITEMS_REQUIRED", path: "decisionItems", severity: "blocking",
    message: "DDD 建模里程碑必须显式提交 decisionItems 数组；没有待选择项时提交空数组。审核区由运行时生成，禁止依赖自由 Markdown 猜测人类决策。",
  }]
  const ids = new Set<string>()
  const prior = new Map((state.decisionLedger ?? []).map((item) => [item.id, item]))
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]
    const base = `decisionItems[${index}]`
    if (!/^[A-Za-z][A-Za-z0-9._-]{2,80}$/u.test(item.id)) findings.push({ code: "DECISION_ID_INVALID", path: `${base}.id`, severity: "blocking", message: "决策 id 必须稳定、唯一且可跨里程碑引用。" })
    if (ids.has(item.id)) findings.push({ code: "DECISION_ID_DUPLICATED", path: `${base}.id`, severity: "blocking", message: `决策 id 重复：${item.id}。` })
    ids.add(item.id)
    if (!item.question) findings.push({ code: "DECISION_QUESTION_REQUIRED", path: `${base}.question`, severity: "blocking", message: "决策必须说明人类实际要选择的问题。" })
    if (item.status === "open") {
      const optionIds = new Set(item.options.map((option) => option.id))
      if (item.options.length < 2 || item.options.length > 4 || optionIds.size !== item.options.length
        || item.options.some((option) => !option.id || !option.label)) findings.push({
        code: "DECISION_OPTIONS_INVALID", path: `${base}.options`, severity: "blocking",
        message: "open 决策必须提供 2 至 4 个具有唯一 id 和可读 label 的完整选项。",
      })
      if (item.recommendationId && !optionIds.has(item.recommendationId)) findings.push({
        code: "DECISION_RECOMMENDATION_INVALID", path: `${base}.recommendationId`, severity: "blocking",
        message: "recommendationId 必须引用当前决策的一个真实 option id。",
      })
      if (!item.recommendationId) findings.push({
        code: "DECISION_RECOMMENDATION_MISSING", path: `${base}.recommendationId`, severity: "warning",
        message: "当前 open 决策没有唯一推荐项；普通‘批准’不会替人类随机选择。",
      })
    }
    if (item.blocks.length === 0) findings.push({ code: "DECISION_BLOCKS_REQUIRED", path: `${base}.blocks`, severity: "blocking", message: "决策必须列出被阻塞的场景、规则、用例或模型稳定标识。" })
    if (item.sourceRefs.length === 0 || item.sourceRefs.some((reference) => !DECISION_SOURCE_PREFIX.test(reference))) findings.push({
      code: "DECISION_SOURCE_REQUIRED", path: `${base}.sourceRefs`, severity: "blocking",
      message: "决策必须绑定 user-input/code/test/runtime/openspec/decision 等可追踪来源。",
    })
    if (prior.get(item.id)?.status === "resolved") findings.push({
      code: "DECISION_ALREADY_RESOLVED", path: `${base}.id`, severity: "blocking",
      message: `决策 ${item.id} 已在上游解决，当前阶段只能通过 decision:${item.id} 引用其结果；如需改变必须退回 ownerStage。`,
    })
  }
  const openIds = items.filter((item) => item.status === "open").map((item) => item.id)
  const unresolvedLines = Object.entries(sections)
    .filter(([heading]) => !["本次请您确认", "输入场景与现状事实", "备选解释与建议", "备选战略方案与建议", "证据与追踪", "业务验收记录"].includes(heading))
    .flatMap(([, value]) => value.split(/\r?\n/u))
    .filter((line) => /[？?]|待确认(?:[：:]|为|是|$)|尚未决定|\bTBD\b|还是/u.test(line))
    .filter((line) => !openIds.some((id) => line.includes(id)))
  if (unresolvedLines.length) findings.push({
    code: "UNTRACKED_OPEN_DECISION", path: "sections", severity: "blocking",
    message: `正文存在未登记或未引用 decision id 的开放问题：${unresolvedLines.slice(0, 3).join("；")}。`,
  })
  return findings
}

export function validateExternalPartyEvidence(
  state: WorkflowState,
  stage: any,
  sections: Record<string, string>,
): ValidationFinding[] {
  if (stage.scopeContract?.id !== "system-strategy") return []
  const strategicText = Object.entries(sections)
    .filter(([heading]) => !["证据与追踪", "业务验收记录"].includes(heading))
    .map(([, value]) => value).join("\n")
  const assertions = strategicText.split(/\r?\n/u).filter((line) =>
    /(?:外部[^。；\n]{0,24}(?:身份|提供方|上游|系统|服务)|身份[^。；\n]{0,24}(?:外部上游|外部提供方))/u.test(line)
    && !/(?:候选|假设|待确认|尚无证据|不能证明|不视为|不代表|非外部)/u.test(line))
  if (!assertions.length) return []
  const evidence = sections["证据与追踪"] ?? ""
  const original = state.originalRequest ?? ""
  const explicitEvidence = /boundaryEvidence\s*[：:]\s*(?!(?:无|待确认|未知)\b).{4,}/iu.test(evidence)
  const userAuthorizedExternalParty = /(?:外部|第三方|微信|支付宝|OAuth|OIDC|SSO)[^。；\n]{0,30}(?:提供方|平台|系统|服务|身份|支付)/iu.test(original)
  if (explicitEvidence || userAuthorizedExternalParty) return []
  return [{
    code: "STRATEGIC_EXTERNAL_PARTY_WITHOUT_BOUNDARY_EVIDENCE",
    path: "sections.证据与追踪",
    severity: "blocking",
    message: `战略设计声明了系统边界外的参与方或上游，但没有提供 boundaryEvidence：${assertions.slice(0, 3).join("；")}。请求头、字段名或本地校验只能证明接口形态，不能证明存在外部系统。`,
    suggestion: "若确有外部参与方，在证据章节写明 boundaryEvidence: <用户输入/运行时调用/独立部署证据>；否则将其建模为当前单体内部身份能力。",
  }]
}

async function resolveRoot(id: Identity): Promise<{ root: string; profile: WorkflowProfile }> {
  const profile = await profileFor(id.workflowType)
  const root = await workflowRoot(id.projectRoot, profile.artifactBase, profile.artifactSubdir, id.workflowId)
  return { root, profile }
}

export async function initialize(input: InitInput): Promise<Transition & { workflowId: string }> {
  const profile = await profileFor(input.workflowType)
  const root = await workflowRoot(input.projectRoot, profile.artifactBase, profile.artifactSubdir, input.workflowId)
  if (await exists(statePath(root))) throw new WorkflowError(`Workflow already exists: ${input.workflowId} at ${root}`)
  await newChange(input.projectRoot, input.workflowId, input.title, input.request)
  const firstStage = profile.stages[0]
  const rootMkdir = path.join(root, ".ddd", "workbench")
  await import("node:fs/promises").then(({ mkdir }) => mkdir(rootMkdir, { recursive: true }))
  const state: WorkflowState = {
    schemaVersion: "ddd-workflow-state/v1",
    workflowType: input.workflowType,
    workflowId: input.workflowId,
    title: input.title,
    originalRequest: input.request,
    projectRoot: path.resolve(input.projectRoot),
    artifactRoot: root,
    status: "active",
    currentStage: firstStage?.id ?? "",
    createdAt: now(),
    updatedAt: now(),
    checkpoints: [],
    openSpec: { changeId: input.workflowId, status: "created" },
  }
  await saveState(root, state)
  await writeLink(root, state, "created", input.workflowId)
  // Auto-complete the 00-request routing stage: init already captured the request.
  if (firstStage && firstStage.id === "00-request" && !firstStage.humanGate) {
    const firstMilestone = milestoneFor(profile, firstStage.document)
    state.checkpoints.push({
      checkpointId: 1, stage: firstStage.id, milestone: firstMilestone?.roman ?? "",
      summary: `${input.title}：${input.request}`,
      status: "completed", review: null, reviewChecklist: [],
      adviceRequired: false, document: firstStage.document, completedAt: now(),
    })
    state.currentStage = firstStage.id
    await saveState(root, state)
  }
  const t = workflowTransition(profile, state)
  return { ...t, workflowId: input.workflowId }
}

export async function prepare(input: PrepareInput): Promise<Transition & { stageCard: any }> {
  const { root, profile } = await resolveRoot(input)
  const state = await loadState(root)
  let transition = workflowTransition(profile, state)
  let stageId = input.stage
  if (!stageId) {
    if (transition.nextStage) stageId = transition.nextStage
    else if (transition.allowedNextStages.length === 1) stageId = transition.allowedNextStages[0]
    else throw new WorkflowError(
      `必须显式指定 stage。当前可选：${transition.allowedNextStages.join("、") || "无"}。`,
    )
  }
  const stage = stageContract(profile, stageId)
  const allowed = state.status === "runtime_blocked"
    ? [state.runtimeBlock?.stage].filter(Boolean)
    : transition.allowedNextStages
  if (!allowed.includes(stage.id)) throw new WorkflowError(
    `阶段 ${stage.id} 不是当前合法阶段；只允许：${allowed.join("、") || "无"}。必须按 transition 推进。`,
  )
  // The runtime-block transition explicitly tells the caller to resume by
  // preparing the same stage after remediation. Make that prepare call the
  // atomic resume point; otherwise the returned stage card still says
  // requiredAction=stop and weaker schedulers stop again even though work may
  // legally continue. Final submission still has to pass every evidence gate.
  if (state.status === "runtime_blocked" && state.runtimeBlock?.stage === stage.id) {
    state.status = "active"
    state.currentStage = stage.id
    delete state.runtimeBlock
    await saveState(root, state)
    transition = workflowTransition(profile, state)
  }
  const upstream = collectUpstream(state, stage.document)
  const currentArchitectureEvidence = await compactArchitectureEvidence(root, stage.scopeContract?.id)
  const approvedModelContract = await compactApprovedModelContract(root, stage.scopeContract?.id)
  const currentCandidate = await candidateDocument(root, profile, stage.document, {})
  const allowedSectionHeadings = writableHeadingsForStage(stage)
  const milestoneMissing = unfilledHeadings(currentCandidate)
  const stageCard = {
    stageId: stage.id,
    scopeContractId: stage.scopeContract?.id ?? null,
    stageTitle: stageTitle(stage),
    humanGate: Boolean(stage.humanGate),
    ...(stage.adviceRequired ? { adviceRequired: true } : {}),
    ...(stage.repeatable ? { repeatable: true } : {}),
    ...(stage.cycleGroup ? { cycleGroup: stage.cycleGroup } : {}),
    // The scheduler owns lifecycle and permissions; compact professional
    // skills own the DDD method used inside this one stage.
    skills: stage.skills ?? [],
    checklist: stage.checklist ?? [],
    upstreamSummary: upstream,
    ...(currentArchitectureEvidence ? { currentArchitectureEvidence } : {}),
    ...(approvedModelContract ? { approvedModelContract } : {}),
    ...(stage.scopeContract?.id === "delivery-planning" ? { openSpecChangeId: state.workflowId } : {}),
    intentContract: {
      originalRequest: state.originalRequest ?? "",
      rule: "本阶段只能细化原始请求与已批准上游决策；新增可观察业务能力必须先回到相应人工里程碑批准，禁止从 workflow_id、代码命名或技术可能性推断需求。",
    },
    approvedHumanDecisions: state.humanDecisions ?? [],
    ...(stage.humanGate ? {
      humanDecisionContract: {
        rule: "必须提交 decisionItems 数组；没有待选择项时提交空数组。每个 open 决策使用稳定 id、2 至 4 个 options、recommendationId、blocks 和 sourceRefs。运行时独占生成‘本次请您确认’，正文开放问题必须引用对应 decision id。",
        submitField: "complete-stage.input.decisionItems=[{id:'DEC-...',question:'...',options:[{id:'OPT-A',label:'...',impact:'...'},...],recommendationId:'OPT-A',status:'open',blocks:['场景/规则/用例/模型ID'],sourceRefs:['user-input:original-request']}]",
        approvalMeaning: "用户回复‘批准’接受每个 open 决策的唯一推荐 option；若某项无推荐，review.resolution.selections 必须逐项给出 decisionId→optionId。已解决的 decision id 不得在下游重开。",
      },
      effectiveDecisions: (state.decisionLedger ?? []).filter((item) => item.status === "resolved"),
    } : {}),
    ...(stage.scopeContract?.id === "system-discovery" && requiresScenarioClarification(state.originalRequest ?? "") ? {
      ambiguityContract: {
        requiresHumanChoice: true,
        reason: "原始请求只给出能力名称，未明确触发条件、业务结果或异常语义。",
        presentation: "只围绕直接阻塞本功能业务语义的 1 至 4 个高影响决策，给出 2 至 3 套完整候选解释及事件流。人工批准前，候选不得进入唯一主流程或已确认规则。",
        submitField: "使用 humanDecisionContract 的 decisionItems；每个开放决策用 blocks 指向被阻塞结论，并给出唯一 recommendationId。",
        forbids: [
          "把代码中的现有入口自动解释为新能力触发点",
          "把候选查询、记录、时间或权限规则写成已批准需求",
          "主动扩展匿名访问、历史保留、补偿、推荐分析或跨时区等邻接需求，除非原始请求或现状证据明确要求",
        ],
      },
    } : {}),
    unfilledSectionHeadings: milestoneMissing.filter((heading) => allowedSectionHeadings.includes(heading)),
    ...(stage.qualityContract ? { qualityContract: {
      minTotalChars: stage.qualityContract.minSectionChars,
      targetMaxTotalChars: (stage.qualityContract.minSectionChars ?? 600) * 2,
      minSummaryChars: stage.qualityContract.minSummaryChars,
      requiredContent: stage.qualityContract.requiredContent,
    } } : {}),
    ...(claimContractFor(stage.scopeContract?.id) ? { claimContract: {
      required: true,
      allowedKinds: claimContractFor(stage.scopeContract?.id)!.allowedKinds,
      instruction: "complete-stage.observations: heading 使用 allowedSectionHeadings 的精确顶层标题，不用正文中的 ### 小标题；事实需 evidence_refs；未知项用 evidence-gap/open-question。",
    } } : {}),
    stageBoundary: stageBoundary(stage.scopeContract?.id),
    ...(stage.implementationEvidence ? { requiredSubmitMetadata: { sliceId: "当前切片稳定 ID" } } : {}),
    ...(stage.deliveryAssetGate ? {
      requiredSubmitMetadata: { plannedSlices: "必须等于结构化 OpenSpec 计划中的切片数量" },
      structuredPlanningContract: {
        action: "openspec-plan",
        rule: "提交结构化 plan；运行时编译 proposal/specs/design/tasks/roadmap，禁止模型手写 OpenSpec Markdown。",
        required: ["title", "objective", "capabilities[].requirements[].scenarios[]", "slices[]"],
        sliceRequired: ["id", "title", "outcome", "consumer", "dependsOn", "acceptanceCriteria", "modelElementIds", "invariantIds", "productionPaths", "testPaths", "verification", "compatibility", "rollback"],
      },
    } : {}),
    allowedSectionHeadings,
  }
  // A successful prepare is a Harness-owned stage selection transaction.
  // Persist it so complete-stage and resumed host sessions never have to
  // reconstruct the active stage from model memory.
  state.currentStage = stage.id
  state.preparedStage = { stage: stage.id, preparedAt: now() }
  await saveState(root, state)
  return { ...workflowTransition(profile, state), stageCard }
}

function stageBoundary(scopeId?: string): { owns: string[]; forbids: string[]; exit: string } {
  const contracts: Record<string, { owns: string[]; forbids: string[]; exit: string }> = {
    "existing-system-baseline": {
      owns: ["当前代码、接口、数据、测试和运行行为事实", "兼容性约束与证据缺口"],
      forbids: ["目标边界设计", "聚合与持久化方案", "编码"],
      exit: "用有限证据形成可核验的 AS-IS 基线，未知项明确标记为 evidence gap。",
    },
    "system-discovery": {
      owns: ["系统级场景", "业务事件时间线", "参与者、规则、异常、热点和边界线索"],
      forbids: ["API、类、表、数据库和中间件选型", "聚合、应用服务与事务设计"],
      exit: "形成纯业务语言的 Big Picture EventStorming，技术事实只进入证据章节。",
    },
    "system-strategy": {
      owns: ["子域与限界上下文", "职责、数据所有权、上下文协作", "实现单元业务用例包"],
      forbids: ["聚合根、值对象、领域/应用服务", "DTO、仓储、SQL、表和文件设计"],
      exit: "输出可供一个实现单元直接消费的业务用例包，不扩大原始需求。",
    },
    "context-discovery": {
      owns: ["单一限界上下文内的命令、事件、策略、失败和不变量候选", "事务与持久化热点"],
      forbids: ["最终类、接口、表结构和代码文件", "跨上下文战略重划"],
      exit: "形成 Design-Level EventStorming，足以驱动战术设计但不提前编码。",
    },
    "context-tactical-design": {
      owns: ["应用服务、聚合、领域交互、持久化与测试设计", "ME/INV 实现合同"],
      forbids: ["修改已批准战略边界", "实际编码和伪造运行证据"],
      exit: "模型职责、签名、不变量、依赖和测试归属全部达到实施就绪。",
    },
    "delivery-planning": {
      owns: ["OpenSpec 工件", "纵向切片、文件映射、验证、Git 与回滚计划"],
      forbids: ["新增领域能力或改变批准模型", "实际生产代码"],
      exit: "每个切片可独立验收、提交和回滚，并声明 plannedSlices。",
    },
    "approved-slice-implementation": {
      owns: ["一个批准纵向切片的真实代码、测试、E2E 和 Git 证据"],
      forbids: ["重新做战略或战术设计", "临时下载工具、伪造或跳过验证"],
      exit: "真实 Commit 可验证、含代码增量，所有验证通过；否则 action=block。",
    },
    "acceptance-evidence": {
      owns: ["全部切片、模型覆盖、测试、E2E、Git、回滚和上线证据的最终审计"],
      forbids: ["补写实现", "用计划代替运行证据"],
      exit: "只有全部证据真实通过，才形成里程碑 VI 人工验收。",
    },
  }
  return contracts[scopeId ?? ""] ?? { owns: [], forbids: [], exit: "只完成 stageCard.checklist 指定的当前阶段。" }
}

function collectUpstream(state: WorkflowState, document: string): string[] {
  const latestByStage = new Map<string, WorkflowState["checkpoints"][number]>()
  for (const checkpoint of state.checkpoints) {
    const currentDocumentIncrement = checkpoint.document === document && checkpoint.status === "completed"
    const approvedMilestoneInput = checkpoint.document !== document && checkpoint.status === "approved"
    if (currentDocumentIncrement || approvedMilestoneInput) latestByStage.set(checkpoint.stage, checkpoint)
  }
  return [...latestByStage.values()].slice(-8).map((checkpoint) => {
    const decision = checkpoint.review?.feedback?.trim()
      ? `；人工批准决策：${checkpoint.review.feedback.trim()}`
      : ""
    return `[${checkpoint.stage}] ${(checkpoint.summary + decision).slice(0, 520)}`
  })
}

function conciseReviewText(value: string, limit = 320): string {
  const plain = value.replace(/^#{1,6}\s+/gmu, "").replace(/[`*_>]/gu, "").replace(/\s+/gu, " ").trim()
  return plain.length <= limit ? plain : `${plain.slice(0, limit)}…`
}

function humanReviewSummary(stage: any, milestone: any, summary: string, sections: Record<string, string>, decisionItems: unknown): string {
  const hidden = new Set(["证据与追踪", "输入场景与现状事实", "业务验收记录"])
  const results = Object.entries(sections).filter(([heading, content]) => !hidden.has(heading) && content.trim())
    .slice(0, 5).map(([heading, content]) => `- ${heading}：${conciseReviewText(content)}`)
  const decisions = Array.isArray(decisionItems) ? decisionItems.filter((item: any) => item?.status === "open") : []
  const candidates = decisions.length
    ? ["", "需要选择的业务决策：", ...decisions.flatMap((item: any) => [
      `- ${item.id}：${item.question}`,
      ...(Array.isArray(item.options) ? item.options.map((option: any) =>
        `  - ${option.id}${item.recommendationId === option.id ? "（推荐）" : ""}：${option.label}`) : []),
    ])] : []
  return [
    `# 里程碑 ${milestone?.roman ?? "?"}：${stage.reviewTitle ?? milestone?.title ?? "人工验收"}`,
    "", `本阶段结论：${summary}`, "", "关键业务与设计结果：", ...results,
    ...candidates, "", "请重点确认：", ...(stage.checklist ?? []).slice(0, 5).map((item: string) => `- ${item}`),
    "", "回复 `批准`，或回复 `修改：...` 并指出不符合业务认知的决策。",
  ].join("\n")
}

type StageDraft = Pick<SubmitInput, "summary" | "sections" | "claims" | "ambiguityResolution" | "decisionItems" | "plannedSlices" | "sliceId"> & {
  validation?: { signature: string; repeated: number }
}

function stageDraftPath(root: string, stageId: string): string {
  return path.join(root, ".ddd", "workbench", `${stageId}.draft.json`)
}

function mergeClaims(current: unknown, increment: unknown, replacedHeadings: Set<string> = new Set()): unknown {
  if (!Array.isArray(current) && !Array.isArray(increment)) return increment ?? current
  const merged = new Map<string, any>()
  const retained = (Array.isArray(current) ? current : [])
    .filter((claim: any) => !replacedHeadings.has(String(claim?.documentSection ?? "")))
  for (const claim of [...retained, ...(Array.isArray(increment) ? increment : [])]) {
    const key = typeof claim?.id === "string" && claim.id.trim() ? claim.id : `anonymous-${merged.size}`
    merged.set(key, claim)
  }
  return [...merged.values()]
}

async function mergeStageDraft(root: string, input: SubmitInput): Promise<SubmitInput> {
  const file = stageDraftPath(root, input.stage)
  const draft = await exists(file) ? await readJson<StageDraft>(file) : undefined
  const sections = { ...(draft?.sections ?? {}), ...(input.sections ?? {}) }
  // A final-stage Markdown repair must not silently delete the structured
  // claims owned by the section being edited. Partial section authoring still
  // replaces that section's claims, while a lifecycle observations payload is
  // explicitly the complete replacement set.
  const replacedHeadings = input.finalize === false
    ? new Set(Object.keys(input.sections ?? {}))
    : new Set<string>()
  const rawClaims = input.replaceClaims && Array.isArray(input.claims)
    ? input.claims
    : mergeClaims(draft?.claims, input.claims, replacedHeadings)
  const claims = Array.isArray(rawClaims) ? rawClaims.map((claim: any) => ({ ...claim })) : rawClaims

  if (input.replaceClaims && Array.isArray(claims)) {
    const missingByHeading = new Map<string, string[]>()
    for (const claim of claims) {
      const statement = String(claim?.statement ?? "").trim()
      if (!statement) continue
      const owners = Object.entries(sections).filter(([, content]) => content.includes(statement))
      if (owners.length === 1) {
        claim.documentSection = owners[0][0]
        continue
      }
      const heading = String(claim?.documentSection ?? "").trim()
      if (owners.length === 0 && heading && Object.hasOwn(sections, heading)) {
        missingByHeading.set(heading, [...(missingByHeading.get(heading) ?? []), statement])
      }
    }
    for (const [heading, statements] of missingByHeading) {
      const unique = [...new Set(statements)].filter((statement) => !sections[heading].includes(statement))
      if (unique.length) {
        sections[heading] = `${sections[heading].trim()}\n\n### 结构化结论\n${unique.map((statement) => `- ${statement}`).join("\n")}`
      }
    }
  }
  return {
    ...input,
    summary: input.summary || draft?.summary || "",
    sections,
    claims,
    ambiguityResolution: input.ambiguityResolution ?? draft?.ambiguityResolution,
    decisionItems: input.decisionItems ?? draft?.decisionItems,
    plannedSlices: input.plannedSlices ?? draft?.plannedSlices,
    sliceId: input.sliceId ?? draft?.sliceId,
  }
}

export async function submit(input: SubmitInput): Promise<Transition & { findings: ValidationFinding[]; documentPath: string; draft?: Record<string, unknown> }> {
  const { root, profile } = await resolveRoot(input)
  const state = await loadState(root)
  const stage = stageContract(profile, input.stage)
  const merged = await mergeStageDraft(root, input)
  const stageWriters = profile.stages.filter((item) => item.document === stage.document)
  const closesHumanMilestone = Boolean(stage.humanGate && stageWriters.at(-1)?.id === stage.id)
  if (closesHumanMilestone && DECISION_LEDGER_SCOPES.has(stage.scopeContract?.id ?? "")) {
    const items = normalizedDecisionItems(merged.decisionItems, stage.id)
      ?? legacyDecisionItems(merged.ambiguityResolution, stage.id, merged.sections)
    if (items) {
      merged.decisionItems = items
      merged.sections["本次请您确认"] = renderDecisionReviewSection(items)
    }
  }
  const partial = input.finalize === false
  const findings = await validateSubmission(root, profile, state, stage, merged, { partial })
  if (findings.some((f) => f.severity === "blocking")) {
    // A stage rejected by the durable transition cannot be repaired by
    // rewriting its content. Persisting that payload as a repair draft tells
    // weaker schedulers to retry an impossible action and was the direct cause
    // of a Mobile loop at an awaiting-review gate. Fail closed without
    // touching the workbench; the caller must follow the returned transition.
    if (findings.some((finding) => finding.code === "STAGE_NOT_ALLOWED")) {
      return {
        ...workflowTransition(profile, state), findings,
        documentPath: documentPath(root, profile, stage.document),
        draft: {
          saved: false,
          repairOnly: false,
          retryableByModel: false,
          mustStop: true,
          nextAction: "当前 transition 不允许提交该阶段。禁止重试 complete-stage；只执行 requiredAction，若正在人工门则等待或提交 review。",
        },
      }
    }
    // Deliberately partial drafts are only persisted after validation. This
    // keeps the workbench from becoming a bypass for out-of-stage content.
    if (partial) return { ...workflowTransition(profile, state), findings, documentPath: documentPath(root, profile, stage.document) }
    const file = stageDraftPath(root, stage.id)
    const previous = await exists(file) ? await readJson<StageDraft>(file) : undefined
    const signature = findings.filter((finding) => finding.severity === "blocking")
      .map((finding) => `${finding.code}:${finding.path}`).sort().join("|")
    const repeated = previous?.validation?.signature === signature ? previous.validation.repeated + 1 : 1
    const editablePaths = [...new Set(findings.filter((finding) => finding.severity === "blocking")
      .map((finding) => finding.path))]
    const replaceObservations = editablePaths.some((item) => item === "claims" || item.startsWith("claims["))
    const allowedHeadings = new Set(writableHeadingsForStage(stage))
    const safeSections = Object.fromEntries(Object.entries(merged.sections ?? {})
      .filter(([heading]) => allowedHeadings.has(heading)))
    const safeClaims = Array.isArray(merged.claims)
      ? merged.claims.filter((claim: any) => allowedHeadings.has(String(claim?.documentSection ?? "")))
      : merged.claims
    await writeJson(file, {
      summary: merged.summary, sections: safeSections, claims: safeClaims,
      ambiguityResolution: merged.ambiguityResolution,
      decisionItems: merged.decisionItems,
      plannedSlices: merged.plannedSlices, sliceId: merged.sliceId,
      validation: { signature, repeated },
    } satisfies StageDraft)
    return {
      ...workflowTransition(profile, state), findings,
      documentPath: documentPath(root, profile, stage.document),
      draft: {
        saved: true, repairOnly: true, repeatedFindingSet: repeated,
        retryableByModel: repeated < 3,
        repairContract: { editablePaths, replaceObservations, preserveOtherSections: true },
        nextAction: repeated < 3
          ? replaceObservations
            ? "候选稿已保存。只修复 editablePaths；重新提交一份完整 observations 数组，运行时会原子替换旧 claims，并保留未点名的正文。"
            : "候选稿已保存。下一次只提交 editablePaths 指向的正文或必要元数据，不要重写整篇文档。"
          : "相同阻塞项已连续出现 3 次。停止自动重试并报告阻塞，避免继续消耗 Token。",
      },
    }
  }
  if (partial) {
    await writeJson(stageDraftPath(root, stage.id), {
      summary: merged.summary, sections: merged.sections, claims: merged.claims,
      ambiguityResolution: merged.ambiguityResolution,
      decisionItems: merged.decisionItems,
      plannedSlices: merged.plannedSlices, sliceId: merged.sliceId,
    } satisfies StageDraft)
    const allowed = writableHeadingsForStage(stage)
    return {
      ...workflowTransition(profile, state), findings,
      documentPath: documentPath(root, profile, stage.document),
      draft: {
        saved: true, stage: stage.id,
        completedSections: Object.keys(merged.sections),
        remainingSections: allowed.filter((heading) => !Object.hasOwn(merged.sections, heading)),
        claimCount: Array.isArray(merged.claims) ? merged.claims.length : 0,
        nextAction: "继续用 finalize=false 添加剩余章节；完成后调用 finalize=true 且 sections={}。",
      },
    }
  }
  await publishSections(root, profile, stage.document, merged.sections)
  const milestone = milestoneFor(profile, stage.document)
  const writers = profile.stages.filter((s) => s.document === stage.document)
  const isLastWriter = writers.at(-1)?.id === stage.id
  if (stage.humanGate && isLastWriter) {
    await publishSections(root, profile, stage.document, {
      "业务验收记录": "- 验收状态：待人工验收\n- 上一次退回意见已完成修订，请以当前文档为准。",
    })
  }
  const checkpoint: Checkpoint = {
    checkpointId: (state.checkpoints.at(-1)?.checkpointId ?? 0) + 1,
    stage: stage.id,
    milestone: milestone?.roman ?? "",
    summary: merged.summary,
    status: (stage.humanGate && isLastWriter ? "awaiting_review" : "completed") as Checkpoint["status"],
    review: null,
    reviewTitle: stage.reviewTitle,
    reviewChecklist: stage.humanGate ? (stage.checklist ?? []) : [],
    adviceRequired: Boolean(stage.adviceRequired),
    document: stage.document,
    completedAt: now(),
    plannedSlices: merged.plannedSlices,
    sliceId: merged.sliceId,
    ambiguityResolution: merged.ambiguityResolution,
    decisionItems: normalizedDecisionItems(merged.decisionItems, stage.id),
    humanReviewSummary: stage.humanGate && isLastWriter
      ? humanReviewSummary(stage, milestone, merged.summary, merged.sections, merged.decisionItems) : undefined,
  }
  state.checkpoints.push(checkpoint)
  if (stage.implementationEvidence && merged.sliceId && state.deliveryPlan) {
    if (!state.deliveryPlan.completedSliceIds.includes(merged.sliceId)) state.deliveryPlan.completedSliceIds.push(merged.sliceId)
  }
  if (state.status === "runtime_blocked") {
    state.status = "active"
    delete state.runtimeBlock
  }
  if (state.status === "revision_requested") state.status = "active"
  state.currentStage = stage.id
  delete state.preparedStage
  if (stage.humanGate && isLastWriter) {
    // milestone ready, awaiting review; status stays active but transition reflects gate
  }
  await saveState(root, state)
  await import("node:fs/promises").then(({ rm }) => rm(stageDraftPath(root, stage.id), { force: true }))
  const transition = workflowTransition(profile, state)
  return { ...transition, findings, documentPath: documentPath(root, profile, stage.document) }
}

async function validateSubmission(root: string, profile: WorkflowProfile, state: WorkflowState, stage: any, input: SubmitInput, options: { partial?: boolean } = {}): Promise<ValidationFinding[]> {
  const findings: ValidationFinding[] = []
  const transition = workflowTransition(profile, state)
  const allowed = state.status === "runtime_blocked"
    ? [state.runtimeBlock?.stage].filter(Boolean)
    : transition.allowedNextStages
  if (!allowed.includes(input.stage)) {
    findings.push({ code: "STAGE_NOT_ALLOWED", path: "stage", severity: "blocking",
      message: `阶段 ${input.stage} 不是当前合法阶段；只允许：${allowed.join("、") || "无"}。必须按 transition 推进。` })
  }
  if (!input.summary || input.summary.trim().length < (stage.qualityContract?.minSummaryChars ?? 20)) {
    findings.push({ code: "SUMMARY_TOO_SHORT", path: "summary", severity: "blocking",
      message: `summary 至少 ${stage.qualityContract?.minSummaryChars ?? 20} 字，当前 ${input.summary?.trim().length ?? 0} 字。` })
  }
  if (!input.sections || Object.keys(input.sections).length === 0) {
    findings.push({ code: "SECTIONS_EMPTY", path: "sections", severity: "blocking", message: "sections 不能为空。" })
  }
  if (!options.partial && stage.deliveryAssetGate && (!Number.isInteger(input.plannedSlices) || Number(input.plannedSlices) <= 0)) {
    findings.push({ code: "PLANNED_SLICES_REQUIRED", path: "plannedSlices", severity: "blocking",
      message: "交付计划必须声明大于 0 的 plannedSlices，最终验收门禁以此判断全部纵向切片是否完成。" })
  }
  if (!options.partial && stage.deliveryAssetGate && state.deliveryPlan) {
    if (input.plannedSlices !== state.deliveryPlan.sliceIds.length) findings.push({
      code: "PLANNED_SLICES_ROADMAP_MISMATCH", path: "plannedSlices", severity: "blocking",
      message: `plannedSlices 必须等于批准路线图切片数 ${state.deliveryPlan.sliceIds.length}，不能使用独立计数。`,
    })
  }
  if (!options.partial && stage.deliveryAssetGate && !state.deliveryPlan) findings.push({
    code: "STRUCTURED_DELIVERY_PLAN_REQUIRED", path: "deliveryPlan", severity: "blocking",
    message: "里程碑 V 必须先通过 openspec-plan 提交结构化路线图，由运行时生成 OpenSpec 工件和切片状态。",
  })
  if (!options.partial && stage.openspecArtifactGate) {
    const artifacts = await planningArtifacts(state.projectRoot, state.workflowId)
    if (!artifacts.complete) findings.push({
      code: "OPENSPEC_PLANNING_ARTIFACTS_MISSING", path: "openspec", severity: "blocking",
      message: `里程碑 V 发布前必须在同一 change 中生成 OpenSpec 工件；当前缺少：${artifacts.missing.join("、")}。`,
    })
    else {
      try { await runOpenSpec(state.projectRoot, ["validate", state.workflowId, "--strict"]) }
      catch (error) { findings.push({
        code: "OPENSPEC_STRICT_VALIDATION_FAILED", path: "openspec", severity: "blocking",
        message: `里程碑 V 发布前 OpenSpec strict validate 必须通过：${(error as Error).message}`,
      }) }
    }
  }
  if (!options.partial && stage.implementationEvidence && !input.sliceId?.trim()) {
    findings.push({ code: "SLICE_ID_REQUIRED", path: "sliceId", severity: "blocking",
      message: "实现阶段必须提供稳定 sliceId，并为每个纵向切片形成独立实现证据。" })
  }
  if (!options.partial && stage.implementationEvidence && input.sliceId && state.deliveryPlan) {
    if (!state.deliveryPlan.sliceIds.includes(input.sliceId)) findings.push({
      code: "SLICE_NOT_IN_APPROVED_ROADMAP", path: "sliceId", severity: "blocking",
      message: `切片 ${input.sliceId} 不在里程碑 V 批准的路线图中。`,
    })
    const incompleteDependencies = (state.deliveryPlan.dependencies[input.sliceId] ?? [])
      .filter((dependency) => !state.deliveryPlan!.completedSliceIds.includes(dependency))
    if (incompleteDependencies.length) findings.push({
      code: "SLICE_DEPENDENCY_NOT_READY", path: "sliceId", severity: "blocking",
      message: `切片 ${input.sliceId} 的前置切片尚未完成：${incompleteDependencies.join("、")}。`,
    })
  }
  if (!options.partial && stage.implementationEvidence && state.checkpoints.some((checkpoint) => checkpoint.stage === stage.id && checkpoint.sliceId === input.sliceId)) {
    findings.push({ code: "SLICE_ALREADY_COMPLETED", path: "sliceId", severity: "blocking",
      message: `切片 ${input.sliceId} 已提交，禁止用重复 sliceId 虚增完成数量。` })
  }
  const writableHeadings = writableHeadingsForStage(stage)
  const allowedHeadings = new Set(writableHeadings)
  for (const [heading, content] of Object.entries(input.sections ?? {})) {
    if (!allowedHeadings.has(heading)) {
      findings.push({
        code: "SECTION_HEADING_NOT_IN_TEMPLATE", path: `sections.${heading}`, severity: "blocking",
        message: `阶段 ${stage.id} 不拥有章节「${heading}」。本阶段只能写：${[...allowedHeadings].join("、") || "无"}。`,
      })
    }
    if (/^##\s+/mu.test(content)) {
      findings.push({
        code: "NESTED_LEVEL_TWO_HEADING", path: `sections.${heading}`, severity: "blocking",
        message: `章节「${heading}」正文不得再次包含 ## 标题；运行时会生成二级标题，正文只可使用 ### 或更低级标题。`,
      })
    }
  }
  const minChars = options.partial ? undefined : stage.qualityContract?.minSectionChars
  if (minChars) {
    const total = Object.values(input.sections ?? {}).join("\n").trim().length
    if (total < minChars) {
      findings.push({ code: "SECTIONS_TOTAL_TOO_SHORT", path: "sections", severity: "warning",
        message: `本阶段全部章节正文共 ${total} 字，建议总计 >= ${minChars} 字。` })
    }
  }
  findings.push(...await validateStageClaims(state, stage.scopeContract?.id, writableHeadings, input.sections, input.claims))
  findings.push(...validateStageSemantics(state, stage, input))
  if (!options.partial && stage.implementationEvidence) findings.push(...await validateImplementationEvidence(state, input))
  const candidate = await candidateDocument(root, profile, stage.document, input.sections)
  const candidateSections = documentSections(candidate)
  const milestoneWriters = profile.stages.filter((item) => item.document === stage.document)
  const closesHumanMilestone = Boolean(stage.humanGate && milestoneWriters.at(-1)?.id === stage.id)
  if (!options.partial && closesHumanMilestone) {
    findings.push(...validateHumanDecisionContract(state, stage, candidateSections, input.decisionItems))
  }
  if (!options.partial) findings.push(...validateExternalPartyEvidence(state, stage, candidateSections))
  if (!options.partial) findings.push(...await validateMandatoryCompatibilityConstraints(
    root, stage.scopeContract?.id, candidate,
  ))
  const required = stage.qualityContract?.requiredContent as string[] | undefined
  if (!options.partial && required) {
    for (const concept of required) {
      if (!containsRequiredConcept(candidate, concept)) {
        findings.push({ code: "REQUIRED_CONTENT_MISSING", path: "sections", severity: "blocking",
          message: `候选里程碑缺少必需业务概念：「${concept}」。` })
      }
    }
  }
  const ownMissing = unfilledHeadings(candidate).filter((heading) => writableHeadings.includes(heading))
  if (!options.partial && ownMissing.length) {
    findings.push({ code: "STAGE_OWNED_SECTIONS_INCOMPLETE", path: "sections", severity: "blocking",
      message: `阶段 ${stage.id} 尚未完成自己拥有的章节：${ownMissing.join("、")}。不得把缺口留给后续阶段。` })
  }
  const writers = profile.stages.filter((item) => item.document === stage.document)
  if (!options.partial && stage.humanGate && writers.at(-1)?.id === stage.id) {
    const missing = unfilledHeadings(candidate)
    if (missing.length) {
      findings.push({ code: "MILESTONE_DOCUMENT_INCOMPLETE", path: "sections", severity: "blocking",
        message: `人工里程碑文档仍有未完成章节：${missing.join("、")}。请在本次 submit 一并补齐，禁止把占位内容提交给用户验收。` })
    }
  }
  return findings
}

export async function validateMandatoryCompatibilityConstraints(
  root: string,
  scopeId: string | undefined,
  candidate: string,
): Promise<ValidationFinding[]> {
  if (!new Set(["context-tactical-design", "delivery-planning", "implementation"]).has(scopeId ?? "")) return []
  const file = path.join(root, ".ddd", "workbench", "evidence-snapshot.json")
  if (!await exists(file)) return []
  const snapshot = await readJson<Record<string, any>>(file)
  const constraints = Array.isArray(snapshot.mandatoryCompatibilityConstraints)
    ? snapshot.mandatoryCompatibilityConstraints : []
  const findings: ValidationFinding[] = []
  for (const constraint of constraints) {
    const ref = String(constraint?.ref ?? "").trim()
    const text = String(constraint?.text ?? "").replace(/^L\d+:\s*/u, "").trim()
    if (!text) continue
    const identifiers = [...new Set(text.match(/\b[A-Z][A-Za-z0-9_]{3,}\b/gu) ?? [])]
    const semanticAnchors = [...new Set(text.match(/持久化|存储|身份|认证|兼容|测试|事务|排序|文件|数据库/gu) ?? [])]
    const identifiersCovered = identifiers.length > 0 && identifiers.every((token) => candidate.includes(token))
    const semanticCovered = identifiers.length === 0 && semanticAnchors.length > 0
      && semanticAnchors.slice(0, 2).every((token) => candidate.includes(token))
    if (ref && candidate.includes(ref) || identifiersCovered || semanticCovered) continue
    findings.push({
      code: "MANDATORY_COMPATIBILITY_CONSTRAINT_UNTRACED",
      path: "sections",
      severity: "blocking",
      message: `现状证据中的强制工程约束尚未进入当前设计：${text}`,
      suggestion: `在当前阶段明确落实 ${ref || text}；不得降级为 Coding 前的可选核验项。`,
    })
  }
  return findings
}

export function containsRequiredConcept(text: string, concept: string): boolean {
  const normalized = (value: string) => value.toLowerCase().replace(/[\s、，,：:；;（）()\-_/]/gu, "")
  if (normalized(text).includes(normalized(concept))) return true
  if (concept === "事实、假设与待确认项") return ["事实", "假设", "待确认"].every((part) => text.includes(part))
  if (concept === "异常与补偿") return ["异常", "补偿"].every((part) => text.includes(part))
  if (concept === "热点与未决问题") return ["热点", "未决问题"].every((part) => text.includes(part))
  if (concept === "业务验收标准") return ["业务", "验收标准"].every((part) => text.includes(part))
  if (concept === "事务边界与并发热点") return ["事务边界", "并发", "热点"].every((part) => text.includes(part))
  const semanticGroups: Record<string, string[][]> = {
    "公开接口与 DTO 契约": [["公开接口", "接口契约", "API", "Controller", "GET /", "POST /"], ["DTO"]],
    "应用服务签名": [["应用服务"], ["签名", "Command(", "Query(", "Handler", "Service（", "Service(" ]],
    "聚合行为与不变量": [["聚合行为", "聚合根"], ["不变量", "INV-"]],
    "仓储语义签名": [["仓储", "Repository", "Mapper"], ["签名", "save(", "findBy", "BaseMapper", "SELECT", "WHERE"]],
    "持久化查询与迁移": [["持久化"], ["查询", "索引"], ["迁移", "新增表"]],
    "测试场景与实现文件映射": [["测试", "T-"], ["生产路径", "实现文件", "路径"]],
    "模块目录与层级归属": [["模块", "目录"], ["层", "application", "domain", "infrastructure"]],
    "允许与禁止依赖矩阵": [["依赖"], ["允许"], ["禁止"]],
    "Published Language 与循环依赖约束": [["Published Language"], ["循环依赖"]],
    "批准战术模型实现清单": [["ME-"], ["清单", "职责"]],
    "不变量—模型—测试归属": [["INV-", "不变量"], ["模型", "ME-"], ["测试", "T-"]],
    "禁止实现降级": [["禁止实现降级", "不得用", "禁止用"]],
    "纵向切片—验收—文件映射": [["切片"], ["验收"], ["文件"]],
    "战术模型—切片—文件覆盖": [["战术模型", "ME-"], ["切片"], ["文件"]],
    "模块—层—依赖机器合同": [["模块"], ["层"], ["依赖"], ["合同", "矩阵"]],
    "Git 基线与回滚策略": [["Git"], ["基线"], ["回滚"]],
    "OpenSpec change 映射": [["OpenSpec"], ["change"], ["映射", "capability"]],
    "OpenSpec Requirement/Scenario 追踪": [["Requirement"], ["Scenario"], ["追踪", "映射"]],
  }
  const groups = semanticGroups[concept]
  if (groups) return groups.every((alternatives) => alternatives.some((term) => text.includes(term)))
  return false
}

export function queryPseudoEvents(text: string): string[] {
  const chinese = /(?:事件|领域事件|\bemits\b)\s*[：:]?\s*([^→\n。；]{0,40}(?:查询|详情|列表|轨迹|结果|页面)[^→\n。；]{0,20}(?:已查询|已返回|已展示|已读取|已生成|已形成|查询已完成))/giu
  const english = /(?:事件|领域事件|\bemits\b)\s*[：:]?\s*([A-Za-z]*(?:Query|Trail|List|Result|View)[A-Za-z]*(?:Returned|Queried|Loaded|Displayed)\b)/giu
  const queryChains = text.split(/\r?\n/u).flatMap((line) => {
    if (!/(?:查询|读取|检索|获取|列表|\bquery\b|\bread\b)/iu.test(line) || !/(?:→|->)/u.test(line)) return []
    const segments = line.split(/(?:→|->)/u).map((item) => item.trim())
    const queryIndex = segments.findIndex((item) => /(?:查询|读取|检索|获取|\bquery\b|\bread\b)/iu.test(item))
    if (queryIndex < 0) return []
    const candidates: string[] = []
    // A line may contain `query -> returns read model -> command -> emits event`.
    // Only the result portion of the query belongs to the query chain; scanning
    // through a later command used to misclassify its genuine state-changing
    // event as a query-completion pseudo event.
    for (const segment of segments.slice(queryIndex + 1)) {
      if (/(?:[（(]\s*(?:命令|command)\s*[）)]|(?:命令|command)\s*[：:]|\bissues?\s+command\b)/iu.test(segment)) break
      const explicitReadModel = /(?:\breturns?\b|读模型|read model|非领域事件)/iu.test(segment)
      const declaredEvent = /(?:🟧|领域事件|\bevent\b|\bemits\b)/iu.test(segment)
      const resultDisguisedAsFact = /(?:轨迹|列表|详情|结果|页面|视图|报告|数据)[^。；]{0,20}(?:已生成|已形成|已返回|已查询|已读取|已加载|已展示)/u.test(segment)
      if (!/(?:读模型|read model|非领域事件)/iu.test(segment) && (declaredEvent || resultDisguisedAsFact)) {
        candidates.push(segment)
      }
      // An explicit return/read-model segment resolves this query. Anything to
      // its right is a subsequent interaction, even when the author omitted a
      // `(命令)` label on the following business action.
      if (explicitReadModel) break
    }
    return candidates.map((segment) => segment
      .replace(/^(?:🟧\s*|领域事件\s*[：:]?\s*|事件\s*[：:]?\s*)/iu, "")
      .replace(/\([^)]*\)\s*$/u, "")
      .replace(/[。；;]+$/u, "")
      .trim())
  })
  const standaloneEnglish = [...text.matchAll(/\b[A-Za-z]*(?:Query|Trail|List|Result|View)[A-Za-z]*(?:Returned|Queried|Loaded|Displayed)\b/gu)]
    .map((match) => match[0])
  return [...new Set([
    ...[...text.matchAll(chinese), ...text.matchAll(english)].map((match) => match[1].trim()),
    ...queryChains,
    ...standaloneEnglish,
  ])]
}

function approvedSemanticContext(state: WorkflowState): string {
  return [
    state.originalRequest ?? "",
    ...(state.checkpoints ?? []).filter((checkpoint) => checkpoint.status === "approved").flatMap((checkpoint) => [
      checkpoint.summary,
      checkpoint.review?.feedback ?? "",
    ]),
    ...(state.humanDecisions ?? []).flatMap((decision: any) => [
      String(decision?.feedback ?? ""),
      String(decision?.selectedCandidateId ?? ""),
      String(decision?.candidateLabel ?? ""),
      ...(Array.isArray(decision?.resolvedDecisions) ? decision.resolvedDecisions.map(String) : []),
    ]),
    ...(state.decisionLedger ?? []).filter((decision) => decision.status === "resolved").flatMap((decision) => [
      decision.id, decision.question, decision.selectedOptionId ?? "", decision.selectedOptionLabel ?? "", ...decision.blocks,
    ]),
  ].join("\n")
}

async function compactArchitectureEvidence(root: string, scopeId?: string): Promise<Record<string, unknown> | undefined> {
  if (!["context-tactical-design", "delivery-planning", "implementation"].includes(scopeId ?? "")) return undefined
  const file = path.join(root, ".ddd", "workbench", "evidence-snapshot.json")
  if (!await exists(file)) return undefined
  const snapshot = await readJson<Record<string, unknown>>(file)
  return {
    instruction: "沿用这些现状证据中的工程约定；不得臆造不同框架、模块系统或目录。信息不足时显式列为实施前核验项。",
    ...snapshot,
  }
}

async function compactApprovedModelContract(root: string, scopeId?: string): Promise<Record<string, unknown> | undefined> {
  if (!["delivery-planning", "implementation", "acceptance-evidence"].includes(scopeId ?? "")) return undefined
  const file = path.join(root, "model-contract.json")
  if (!await exists(file)) {
    const milestone = path.join(root, "IV-tactical-design.md")
    if (!await exists(milestone)) return undefined
    const text = await import("node:fs/promises").then(({ readFile }) => readFile(milestone, "utf8"))
    await writeApprovedModelContract(root, text)
  }
  let contract = await readJson<Record<string, any>>(file)
  if (!Array.isArray(contract.invariants) || contract.invariants.some((item: unknown) => typeof item === "string")) {
    const milestone = path.join(root, "IV-tactical-design.md")
    const text = await import("node:fs/promises").then(({ readFile }) => readFile(milestone, "utf8"))
    await writeApprovedModelContract(root, text)
    contract = await readJson<Record<string, any>>(file)
  }
  return {
    sourceSha256: contract.sourceSha256,
    modelElements: contract.modelElements ?? [],
    invariants: contract.invariants ?? [],
    instruction: "OpenSpec、切片、代码与测试必须使用这些已批准名称和职责；禁止重命名、替换或新增战术模型。发现缺口应回里程碑 IV 修订。",
  }
}

export function extractApprovedModelContract(document: string) {
  const text = String(document)
  const modelElements: Array<{ id: string; name: string }> = []
  const invariantMatches: Array<{ id: string; statement: string }> = []

  // Prefer an explicitly embedded machine contract when one is present.  The
  // scanner accepts fenced JSON and a balanced object following a
  // `model-contract` label, while still validating every extracted field.
  const jsonCandidates: string[] = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/giu)].map((match) => match[1])
  for (const marker of text.matchAll(/model-contract/giu)) {
    const start = text.indexOf("{", (marker.index ?? 0) + marker[0].length)
    if (start < 0) continue
    let depth = 0; let inString = false; let escaped = false
    for (let index = start; index < text.length; index += 1) {
      const char = text[index]
      if (inString) {
        if (escaped) escaped = false
        else if (char === "\\") escaped = true
        else if (char === '"') inString = false
        continue
      }
      if (char === '"') inString = true
      else if (char === "{") depth += 1
      else if (char === "}" && --depth === 0) {
        jsonCandidates.push(text.slice(start, index + 1))
        break
      }
    }
  }
  const visitContract = (value: unknown): void => {
    if (Array.isArray(value)) { value.forEach(visitContract); return }
    if (!value || typeof value !== "object") return
    const record = value as Record<string, unknown>
    if (Array.isArray(record.modelElements)) {
      for (const item of record.modelElements) {
        if (!item || typeof item !== "object") continue
        const id = String((item as any).id ?? "").trim()
        const name = String((item as any).name ?? "").trim()
        if (/^ME-\d+$/u.test(id) && /^[\p{L}_][\p{L}\p{N}_.\- ]{1,79}$/u.test(name)) modelElements.push({ id, name })
      }
    }
    if (Array.isArray(record.invariants)) {
      for (const item of record.invariants) {
        if (!item || typeof item !== "object") continue
        const id = String((item as any).id ?? "").trim()
        const statement = String((item as any).statement ?? (item as any).rule ?? "").trim()
        if (/^INV-\d+$/u.test(id) && statement.length >= 3 && statement.length <= 500) invariantMatches.push({ id, statement })
      }
    }
    Object.values(record).forEach(visitContract)
  }
  for (const candidate of jsonCandidates) {
    try { visitContract(JSON.parse(candidate)) } catch { /* prose fallback below */ }
  }

  // Prose contracts are intentionally recognized by high-confidence shapes:
  // a quoted name, an explicit colon, an ASCII identifier, or a Chinese name
  // immediately qualified by a DDD model kind.  Plain references such as
  // `ME-01 和 ME-02` therefore cannot become model definitions accidentally.
  const kinds = "聚合根|实体|值对象|领域服务|应用服务|仓储抽象|仓储接口|读模型|工厂|策略|端口|适配器"
  for (const match of text.matchAll(/\b(ME-\d+)\b/gu)) {
    const id = match[1]
    const rawTail = text.slice((match.index ?? 0) + match[0].length, (match.index ?? 0) + match[0].length + 140)
    // Identifiers are frequently wrapped independently in Markdown, for
    // example `` `ME-04` FavoriteShop.handle(...) ``. Remove only that closing
    // marker; the following definition still has to match a trusted shape.
    const clause = rawTail.split(/[；;。|\n]/u, 1)[0].replace(/^\s*[`*]{1,2}\s*/u, "").trim()
    if (!clause || /^[\/、,，→]/u.test(clause)) continue
    const quoted = clause.match(/^\s*(?:[：:]\s*)?[`*]{1,2}([^`*]{2,80})[`*]{1,2}/u)?.[1]
    const canonicalInParentheses = clause.match(/^\s*(?:[：:]\s*)?[^（）()\n]{1,80}[（(]([A-Za-z][A-Za-z0-9_.\-]{1,79})[）)](?=[：:\s，,]|$)/u)?.[1]
    const typedSuffix = clause.match(new RegExp(`^\\s*(?:[：:]\\s*)?[\`*]{0,2}([\\p{L}_][\\p{L}\\p{N}_.\\- ]{1,79}?)[\`*]{0,2}\\s*(?:${kinds})(?=[：:\\s，,（(]|$)`, "u"))?.[1]
    const typedPrefix = clause.match(new RegExp(`^\\s*(?:[：:]\\s*)?(?:${kinds})\\s*[\`*]{0,2}([\\p{L}_][\\p{L}\\p{N}_.\\- ]{1,79})[\`*]{0,2}(?=[：:\\s，,]|$)`, "u"))?.[1]
    const typedOnlyClause = clause.replace(/^\s*(?:[：:]\s*)?/u, "")
    const typedOnly = kinds.split("|").find((kind) => typedOnlyClause.startsWith(kind)
      && /^(?:[：:\s、，,（(]|$)/u.test(typedOnlyClause.slice(kind.length)))
    const colonName = clause.match(/^\s*[：:]\s*[`*]{0,2}([\p{L}_][\p{L}\p{N}_.\-]{1,79})[`*]{0,2}(?=[：:\s，,({]|$)/u)?.[1]
    const asciiName = clause.match(/^\s*(?:[：:]\s*)?[`*]{0,2}([A-Za-z][A-Za-z0-9_.\-]{1,79})[`*]{0,2}(?=[：:\s，,({]|$)/u)?.[1]
    const name = String(quoted ?? canonicalInParentheses ?? typedSuffix ?? typedPrefix ?? typedOnly ?? colonName ?? asciiName ?? "").trim()
    if (name && !/^(?:的|由|与|和|及|在|位于|用于|依赖|保护|覆盖|对应)/u.test(name)) modelElements.push({ id, name })
  }
  invariantMatches.push(...[...text.matchAll(/\b(INV-\d+)\b[`*]{0,2}(?:\s*[：:]\s*|\s+)([^|\n。；]{3,180}?)(?=(?:[、,，]\s*)?[`*]{0,2}INV-\d+\b|[。；\n]|$)/gu)]
    .map((match) => ({ id: match[1], statement: match[2].replace(/[`*_]/gu, "").trim() })))
  const firstModels = new Map<string, { id: string; name: string }>()
  for (const item of modelElements) if (!firstModels.has(item.id)) firstModels.set(item.id, item)
  const firstInvariants = new Map<string, { id: string; statement: string }>()
  for (const item of invariantMatches) if (!firstInvariants.has(item.id)) firstInvariants.set(item.id, item)
  const uniqueModels = [...firstModels.values()].sort((a, b) => a.id.localeCompare(b.id))
  const invariants = [...firstInvariants.values()].sort((a, b) => a.id.localeCompare(b.id))
  return { modelElements: uniqueModels, invariants }
}

async function writeApprovedModelContract(root: string, document: string): Promise<void> {
  const text = String(document)
  const { modelElements: uniqueModels, invariants } = extractApprovedModelContract(text)
  if (uniqueModels.length === 0 || invariants.length === 0) {
    throw new WorkflowError("里程碑 IV 缺少可提取的 ME/INV 稳定标识，无法生成 model-contract.json。")
  }
  await writeJson(path.join(root, "model-contract.json"), {
    schemaVersion: "ddd-model-contract/v1",
    sourceMilestone: "IV",
    sourceDocument: "IV-tactical-design.md",
    sourceSha256: createHash("sha256").update(text).digest("hex"),
    modelElements: uniqueModels,
    invariants,
    generatedAt: now(),
  })
}

async function validateImplementationEvidence(state: WorkflowState, input: SubmitInput): Promise<ValidationFinding[]> {
  const findings: ValidationFinding[] = []
  const text = Object.values(input.sections ?? {}).join("\n")
  const sha = text.match(/(?:Commit SHA|commit|提交)[：:`\s]*([0-9a-f]{7,40})/iu)?.[1]
  if (!sha) {
    findings.push({ code: "IMPLEMENTATION_COMMIT_MISSING", path: "sections", severity: "blocking",
      message: "实现证据必须包含真实 Git Commit SHA。" })
    return findings
  }
  const { execFile } = await import("node:child_process")
  const runGit = (args: string[]) => new Promise<string>((resolve, reject) => execFile("git", args, { cwd: state.projectRoot, windowsHide: true },
    (error, stdout) => error ? reject(error) : resolve(stdout.trim())))
  try {
    await runGit(["cat-file", "-e", `${sha}^{commit}`])
    const fullSha = await runGit(["rev-parse", sha])
    if (state.implementationBaseline?.head && fullSha === state.implementationBaseline.head) {
      findings.push({ code: "IMPLEMENTATION_COMMIT_EQUALS_BASELINE", path: "sections", severity: "blocking",
        message: "实现 Commit 与里程碑 V 批准时的 Git 基线相同，没有代码增量。" })
    }
    const files = (await runGit(["diff-tree", "--no-commit-id", "--name-only", "-r", fullSha])).split(/\r?\n/u).filter(Boolean)
    if (!files.some((file) => !file.startsWith("openspec/") && !file.endsWith(".md"))) {
      findings.push({ code: "IMPLEMENTATION_COMMIT_NO_PRODUCTION_CHANGE", path: "sections", severity: "blocking",
        message: "该 Commit 未包含 OpenSpec/Markdown 之外的生产或测试代码变更。" })
    }
  } catch {
    findings.push({ code: "IMPLEMENTATION_COMMIT_INVALID", path: "sections", severity: "blocking",
      message: `Git 中不存在可验证的实现 Commit：${sha}。` })
  }
  if (hasFailedVerificationEvidence(text)) {
    findings.push({ code: "IMPLEMENTATION_VERIFICATION_NOT_PASSED", path: "sections", severity: "blocking",
      message: "实现证据包含未运行、跳过、环境不可用或失败状态；应调用 action=block，而不是提交完成切片。" })
  }
  return findings
}

export function hasFailedVerificationEvidence(text: string): boolean {
  const evidenceSubject = String.raw`(?:测试|验证|构建|build|e2e|端到端|集成测试|运行结果|验证命令|检查)`
  const failedState = String.raw`(?:未运行|未执行|无法验证|环境不可用|跳过|待验证|失败|未通过|不通过)`
  const separator = String.raw`\s*(?:结果|状态)?\s*[：:,，]?\s*`
  return new RegExp(`${evidenceSubject}${separator}${failedState}`, "iu").test(text)
    || new RegExp(`${failedState}${separator}${evidenceSubject}`, "iu").test(text)
    || /BUILD\s+FAILURE/iu.test(text)
    || /(?:Failures|Errors)\s*:\s*[1-9]\d*/iu.test(text)
}

export function validateStageSemantics(state: WorkflowState, stage: any, input: SubmitInput): ValidationFinding[] {
  const findings: ValidationFinding[] = []
  const entries = Object.entries(input.sections ?? {})
  const addFinding = (code: string, heading: string, terms: string[], message: string) => findings.push({
    code, path: `sections.${heading}`, severity: "blocking", message: `${message}：${terms.join("、")}。`,
  })

  if (stage.scopeContract?.id === "system-discovery") {
    const allowedEvidenceHeadings = new Set(["输入场景与现状事实", "证据与追踪"])
    const forbidden = [
      "MySQL", "Redis", "API", "GET /", "POST /", "PUT /", "DELETE /", "queryById", "Controller", "Mapper", "DTO", "SQL", "事务内", "表结构", "接口路径",
      "持久化", "服务器时间", "时间戳精确", "横切关注点", "技术耦合", "UI交互", "植入逻辑",
    ]
    for (const [heading, text] of entries) {
      if (allowedEvidenceHeadings.has(heading)) continue
      const hits = forbidden.filter((term) => hasStrategicTechnicalOccurrence(text, term))
      if (hits.length) addFinding("STRATEGIC_EVENTSTORM_TECHNICAL_LEAK", heading, hits,
        "战略事件风暴只表达业务事件流、参与者、规则、异常和边界线索；技术证据只能放入证据章节")
    }
    const eventStorm = String(input.sections?.["战略事件风暴"] ?? "")
    const eventMarker = /(?:领域事件|事件\s*[：:]|[（(]\s*事件\s*[）)]|⚡|\bemits\b)/iu
    const pseudoQuery = /(?:查询|详情|列表|轨迹|结果|页面)[^。；\n]{0,20}(?:已查询|已返回|已展示|已读取|已生成|已形成|查询已完成)/u
    const declaredQueryResults = eventStorm.split(/\r?\n/u).flatMap((line) => {
      const declaredList = /(?:领域事件|事件)\s*[：:]|⚡|[（(]\s*事件\s*[）)]/u.test(line)
      return line.split(/[；;]/u).map((segment) => segment.trim()).filter((segment) =>
        pseudoQuery.test(segment)
        && (declaredList || eventMarker.test(segment) || /(?:→|->)/u.test(segment))
        && !/(?:读模型|非领域事件)/u.test(segment))
    })
    const pseudoEvents = [...new Set([...queryPseudoEvents(eventStorm), ...declaredQueryResults])]
    if (pseudoEvents.length) addFinding(
      "STRATEGIC_EVENT_NOT_STATE_CHANGE", "战略事件风暴", pseudoEvents,
      "查询、返回、展示或读取完成属于读模型结果，不是领域主体状态变化，不能列为过去时领域事件",
    )
  }

  if (stage.scopeContract?.id === "system-strategy") {
    const forbidden = ["聚合根", "值对象", "应用服务", "领域服务", "仓储接口", "DTO", "Mapper", "Controller", "SQL", "表结构", "类名", "方法名"]
    for (const [heading, text] of entries) {
      if (heading === "证据与追踪") continue
      const hits = forbidden.filter((term) => hasAffirmativeOccurrence(text, term))
      if (hits.length) addFinding("STRATEGIC_DESIGN_TACTICAL_LEAK", heading, hits,
        "战略设计只能决定子域、限界上下文、职责、协作和实现单元用例，禁止提前完成战术设计")
    }
    if (stage.id === "04-service-use-cases") {
      const deferred = new Set((state.humanDecisions ?? []).flatMap((decision) => decision.deferredToTacticalFamilies ?? []))
      const assertedText = entries.map(([, value]) => value).join("\n").split(/\r?\n/u)
        .filter((line) => !/(?:待战术事件风暴|未来候选|尚未决定|待确认)/u.test(line)).join("\n")
      const promoted = BUSINESS_RULE_FAMILIES.filter((rule) => deferred.has(rule.family) && rule.pattern.test(assertedText))
      if (promoted.length) addFinding("STRATEGIC_USE_CASE_DEFERRED_RULE_PROMOTED", "实现单元用例包",
        promoted.map((rule) => rule.label),
        "里程碑 I 已明确把这些规则交给战术事件风暴，本阶段只能把它们列为待战术澄清项，不能提前写成用例前置条件、失败语义或验收结果")
    }
  }

  if (stage.scopeContract?.id === "context-discovery") {
    const forbidden = [
      "复合索引", "索引设计", "唯一索引", "唯一约束", "联合唯一", "UNIQUE",
      "数据库约束", "分桶键", "分库", "分表", "表名", "字段类型", "数据库选型", "Redis", "Kafka", "SQL",
    ]
    for (const [heading, text] of entries) {
      if (heading === "证据与追踪") continue
      const hits = forbidden.filter((term) => hasAffirmativeOccurrence(text, term))
      if (hits.length) addFinding("TACTICAL_EVENTSTORM_IMPLEMENTATION_LEAK", heading, hits,
        "战术事件风暴只能识别业务幂等需求、访问模式、事务/并发与持久化热点；唯一约束、索引、分片、表和中间件都是战术设计的实现决策")
    }
    const pseudoEvents = queryPseudoEvents(String(input.sections?.["战术事件风暴"] ?? ""))
    if (pseudoEvents.length) addFinding("TACTICAL_EVENT_NOT_STATE_CHANGE", "战术事件风暴", pseudoEvents,
      "查询命令只返回读模型；只有改变领域状态或触发真实领域策略的事实才能标为领域事件")
  }

  if (stage.scopeContract?.id === "context-tactical-design" && stage.id === "06-tactical-design") {
    const designText = entries.map(([, text]) => text).join("\n")
    const domainText = String(input.sections?.["领域模型设计"] ?? "")
    const approvedContext = approvedSemanticContext(state)
    const automaticCapture = /(?:每次|当).{0,30}成功.{0,30}(?:记录|保存)|成功.{0,20}(?:时|后).{0,20}(?:记录|保存)|(?:详情页|既有业务路径)[^。；\n]{0,40}(?:访问|成功)?[^。；\n]{0,20}触发/u.test(approvedContext)
    const explicitCaptureEndpoint = /POST\s+\/[\w{}\-/?=]*(?:view|record|track|trail|history)/iu.test(designText)
    const existingSuccessHook = /(?:成功路径|成功返回|查询成功|详情成功).{0,50}(?:调用|触发|记录)/u.test(designText)
    if (automaticCapture && explicitCaptureEndpoint && existingSuccessHook) {
      addFinding("TACTICAL_DUPLICATE_EXTERNAL_TRIGGER", "公开接口与 DTO 契约", ["POST capture endpoint"],
        "原始场景要求由既有业务成功自动记录，设计又暴露独立写入端点会形成第二个未授权触发入口；只保留既有成功路径内的应用服务调用")
    }
    const aggregateOrmMerge = [...designText.matchAll(/[^。；\n]{0,30}(?:聚合根\s*[+＋/]\s*(?:MyBatis|JPA|ORM|数据库实体)|(?:MyBatis|JPA|ORM)\s*(?:实体)?\s*[+＋/]\s*聚合根)[^。；\n]{0,30}/giu)].map((match) => match[0].trim())
    if (aggregateOrmMerge.length) addFinding("TACTICAL_AGGREGATE_INFRASTRUCTURE_MERGE", "领域模型设计", aggregateOrmMerge,
      "聚合根是领域模型，不能同时充当 MyBatis/JPA/ORM 持久化实体；请分别定义领域模型与基础设施映射模型/适配器")
    const original = state.originalRequest ?? ""
    if (automaticCapture && !/INV-\d+[^。\n]{0,120}(?:每次|每一)[^。\n]{0,80}成功[^。\n]{0,80}(?:恰好|一条|一次)/u.test(domainText)) {
      addFinding("TACTICAL_INVARIANT_EXACTLY_ONE_MISSING", "领域模型设计", ["每次成功查看恰好一条记录"],
        "原始请求的强业务约束必须成为拥有该行为的聚合不变量，不能只写在阶段输入或应用服务说明中")
    }
    const repeatedViews = /(?:重复|同一[^。；]{0,20}多次)[^。；]{0,30}(?:保留|不去重)/u.test(original)
    if (repeatedViews && !/INV-\d+[^。\n]{0,120}(?:重复|多次)[^。\n]{0,100}(?:保留|不去重|独立)/u.test(domainText)) {
      addFinding("TACTICAL_INVARIANT_DUPLICATES_MISSING", "领域模型设计", ["重复查看逐条保留"],
        "重复行为的保留/去重语义必须由聚合不变量明确拥有")
    }
    const viewNotVisit = /页面查看[^。；]{0,20}(?:不表示|不等于)[^。；]{0,20}(?:到店|实际到店)/u.test(original)
    if (viewNotVisit && !/页面查看[^。；\n]{0,30}(?:不表示|不等于)[^。；\n]{0,30}(?:到店|实际到店)/u.test(domainText)) {
      addFinding("TACTICAL_UBIQUITOUS_LANGUAGE_DISTINCTION_MISSING", "领域模型设计", ["页面查看不等于实际到店"],
        "原始请求明确的业务术语边界必须进入领域模型，防止实现把两个概念合并")
    }
    const moduleText = String(input.sections?.["模块与分层设计"] ?? "")
    const directMapperDependency = [...moduleText.matchAll(/[^。；\n]{0,40}(?:app(?:lication)?service|应用服务)[^。；\n]{0,20}(?:→|依赖)[^。；\n]{0,20}mapper[^。；\n]{0,30}/giu)].map((match) => match[0].trim())
    if (directMapperDependency.length) addFinding("TACTICAL_APPLICATION_INFRASTRUCTURE_DEPENDENCY", "模块与分层设计", directMapperDependency,
      "应用服务只能依赖仓储端口；MyBatis Mapper 属于基础设施适配器，不得成为应用服务的直接依赖")
    const contextFirstLayers = [/(?:\bdomain\b|领域层)/iu, /(?:\bapplication\b|应用层)/iu,
      /(?:\binfrastructure\b|基础设施层)/iu, /(?:\binterfaces?\b|接口层|适配层)/iu]
    if (moduleText && !contextFirstLayers.every((pattern) => pattern.test(moduleText))) {
      addFinding("TACTICAL_BOUNDED_CONTEXT_MODULE_INCOMPLETE", "模块与分层设计", ["domain/application/infrastructure/interfaces"],
        "新增限界上下文必须在同一 context-first 模块根下明确领域层、应用层、基础设施层和接口适配层，不能继续散落到全局 entity/service/mapper 包")
    }
  }

  if (stage.scopeContract?.id === "delivery-planning") {
    const text = entries.map(([, value]) => value).join("\n")
    const declared = [...text.matchAll(/\bchange\s*[=:：]\s*[`"']?([a-z0-9][a-z0-9-]*)/giu)].map((match) => match[1])
    const mismatches = [...new Set(declared.filter((value) => value !== state.workflowId))]
    if (mismatches.length) addFinding("OPENSPEC_CHANGE_ID_MISMATCH", "OpenSpec 变更映射", mismatches,
      `交付文档中的 OpenSpec change 必须使用当前真实 changeId ${state.workflowId}；capability 名不能冒充 changeId`)
  }

  if (["system-discovery", "system-strategy"].includes(stage.scopeContract?.id)) {
    const original = state.originalRequest ?? ""
    const authorizedContext = approvedSemanticContext(state)
    const advisoryHeadings = new Set(["证据与追踪", "备选解释与建议", "备选战略方案与建议", "本次请您确认"])
    const onlyAdvisory = entries.length > 0 && entries.every(([heading]) => advisoryHeadings.has(heading))
    const businessText = [...(onlyAdvisory ? [] : [input.summary]), ...entries
      .filter(([heading]) => !advisoryHeadings.has(heading))
      .map(([, text]) => text)].join("\n")
    // Single words such as “推荐” also describe an advisory choice (“推荐方案 A”).
    // Match recommendation *capabilities* with a business object/qualifier so
    // strategic advice is not misclassified as intent expansion.
    const capabilityTerms = [
      "计数", "统计", "排行", "区间查询", "支付", "个性化推荐", "智能推荐",
      "店铺推荐", "内容推荐", "推荐分析", "推荐系统", "导出", "审批", "核销",
    ]
    const expanded = capabilityTerms.filter((term) => !original.includes(term)
      && hasUnauthorizedCapabilityOccurrence(businessText, term, authorizedContext))
    if (expanded.length) addFinding("INTENT_CAPABILITY_EXPANSION", "originalRequest", expanded,
      "提交内容把原始需求未授权的能力写入了主流程、用例或验收结果")
  }
  return findings
}

function hasAffirmativeOccurrence(text: string, term: string): boolean {
  let offset = text.indexOf(term)
  while (offset >= 0) {
    if (isAffirmativeOccurrenceAt(text, term, offset)) return true
    offset = text.indexOf(term, offset + term.length)
  }
  return false
}

function isAffirmativeOccurrenceAt(text: string, term: string, offset: number): boolean {
  const sentenceStart = Math.max(text.lastIndexOf("。", offset - 1), text.lastIndexOf("；", offset - 1), text.lastIndexOf("\n", offset - 1)) + 1
  const ends = [text.indexOf("。", offset), text.indexOf("；", offset), text.indexOf("\n", offset)].filter((i) => i >= 0)
  const sentenceEnd = ends.length ? Math.min(...ends) : text.length
  const headingStart = Math.max(text.lastIndexOf("\n###", offset), text.lastIndexOf("\n##", offset))
  const contextStart = headingStart >= 0 ? headingStart : sentenceStart
  const sentence = text.slice(contextStart, sentenceEnd)
  const prefix = text.slice(Math.max(0, offset - 500), offset)
  const categoryPattern = /(?:#{1,6}\s*|\*\*)?(非目标|范围外|未来候选|后续候选|不纳入本次|本次目标|主流程|验收结果|现状已存在)(?:\*\*)?\s*[：:]?/gu
  const categories = [...prefix.matchAll(categoryPattern)]
  const nearestCategory = categories.at(-1)?.[1] ?? ""
  const excludedCategory = /^(?:非目标|范围外|未来候选|后续候选|不纳入本次)$/u.test(nearestCategory)
  const localOffset = offset - contextStart
  const before = sentence.slice(0, Math.max(0, localOffset))
  const after = sentence.slice(Math.max(0, localOffset + term.length))
  const scopedExclusionBefore = /(?:范围外|非目标|未来候选|后续候选|不纳入本次)[^。；\n]{0,100}$/u.test(before)
  const directExclusionBefore = /(?:排除|暂不|无需|不做|有意遗漏|未授权|(?:不|未)(?:在本阶段)?(?:给出|要求|支持|提供|实现|采用|使用|涉及|设计|指定|决定|引入|新增|包含|触碰)|没有|推迟|留待|不纳入|不触碰)[^、，,。；\n]{0,40}(?:、[^、，,。；\n]{0,40})*$/u.test(before)
  const excludedAfter = /^[^。；\n]{0,120}(?:(?:只|仅)作为(?:未来|后续)(?:机会|候选|演进项|热点)|不(?:进入|参与|纳入|作为)(?:本次|首期|当前)?(?:主流程|范围|交付|能力)?|留待后续|待后续|未来候选|后续候选|范围外|非目标)/u.test(after)
  const excluded = excludedCategory || scopedExclusionBefore || directExclusionBefore || excludedAfter
    || /(?:禁止|不得|不得提前|归(?:战术|后续)[^。；\n]{0,8}设计|不恢复)/u.test(sentence)
  return !excluded
}

function hasUnauthorizedCapabilityOccurrence(text: string, term: string, authorizedContext: string): boolean {
  let offset = text.indexOf(term)
  while (offset >= 0) {
    if (isAffirmativeOccurrenceAt(text, term, offset)
      && !isAuthorizedDerivedCapability(term, text, offset, authorizedContext)) return true
    offset = text.indexOf(term, offset + term.length)
  }
  return false
}

function isAuthorizedDerivedCapability(term: string, text: string, offset: number, authorizedContext: string): boolean {
  if (term !== "计数") return false
  // Counting is a distinct capability in e.g. "按日浏览计数", but it is an
  // unavoidable state measure of an already authorized capacity/quota rule.
  // Authorization must come from the original request or an approved human
  // milestone, never from the candidate text itself.
  const capacityAuthorized = /(?:名额|容量|配额|席位)[^。；\n]{0,24}(?:约束|上限|限制|不得超过|未满|满员)|(?:名额约束|容量约束|配额约束)/u.test(authorizedContext)
  if (!capacityAuthorized) return false
  const local = text.slice(Math.max(0, offset - 48), Math.min(text.length, offset + term.length + 48))
  return /(?:报名|名额|容量|配额|席位|满员|剩余|占用|释放)/u.test(local)
}

function hasStrategicTechnicalOccurrence(text: string, term: string): boolean {
  let offset = text.indexOf(term)
  while (offset >= 0) {
    const lineStart = text.lastIndexOf("\n", offset - 1) + 1
    const lineEndCandidate = text.indexOf("\n", offset)
    const lineEnd = lineEndCandidate >= 0 ? lineEndCandidate : text.length
    const line = text.slice(lineStart, lineEnd)
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")
    const negatedBefore = new RegExp(`(?:不|禁止|不得|无需|未|没有|排除)[^。；]{0,18}${escaped}`, "iu").test(line)
    const negatedAfter = new RegExp(`${escaped}[^。；]{0,18}(?:不在本阶段|不属于本阶段|留待后续|尚未决定)`, "iu").test(line)
    if (!negatedBefore && !negatedAfter) return true
    offset = text.indexOf(term, offset + term.length)
  }
  return false
}

const BUSINESS_RULE_FAMILIES = [
  { family: "authorization", label: "权限/未登录处理", pattern: /未登录[^。；\n]{0,30}(?:拒绝|忽略|记录|允许|提示)|仅(?:登录|已登录)用户/u },
  { family: "repeat", label: "重复/去重规则", pattern: /(?:重复|同日同店|同一店铺)[^。；\n]{0,40}(?:幂等|去重|仅记录|保留首次|允许多次)/u },
  { family: "retention", label: "保留周期", pattern: /(?:轨迹|记录|数据)[^。；\n]{0,30}(?:永久保留|仅保留|保留\d+|TTL|自动过期)/iu },
  { family: "compensation", label: "撤销/补偿规则", pattern: /(?:误签到|误记录|补偿|撤销)[^。；\n]{0,35}(?:支持|不支持|申请|允许|删除|恢复)/u },
  { family: "time-boundary", label: "自然日边界", pattern: /(?:自然日|一日)[^。；\n]{0,35}(?:00:00|23:59|系统时区|用户时区|服务器时间)/u },
  { family: "invalid-reference", label: "对象不存在处理", pattern: /(?:店铺|用户|对象|ID)[^。；\n]{0,25}(?:不存在|无效)[^。；\n]{0,20}(?:拒绝|报错|提示|忽略)/u },
]

function deferredRuleFamilies(document: string): string[] {
  const deferredText = document.split(/\r?\n/u)
    .filter((line) => /(?:待战术事件风暴|未来候选|后续阶段定义)/u.test(line)).join("\n")
  return BUSINESS_RULE_FAMILIES.filter((rule) => rule.pattern.test(deferredText)).map((rule) => rule.family)
}

export async function review(input: ReviewInput): Promise<Transition & { reviewRecord: any }> {
  if (!["approve", "revise", "reject"].includes(input.decision)) {
    throw new WorkflowError(`非法验收决定：${String(input.decision)}；只允许 approve、revise、reject。`)
  }
  const { root, profile } = await resolveRoot(input)
  const state = await loadState(root)
  const idx = state.checkpoints.map((c) => c.stage).lastIndexOf(input.stage)
  if (idx < 0) throw new WorkflowError(`未找到阶段 ${input.stage} 的 checkpoint。`)
  const checkpoint = state.checkpoints[idx]
  if (checkpoint.status === "revision_requested" && input.decision === "revise") {
    return { ...workflowTransition(profile, state), reviewRecord: checkpoint.review }
  }
  if (checkpoint.status !== "awaiting_review") throw new WorkflowError(`阶段 ${input.stage} 不在待验收状态。`)
  const stage = stageContract(profile, input.stage)
  const document = await import("node:fs/promises").then(({ readFile }) => readFile(documentPath(root, profile, checkpoint.document), "utf8"))
  let record = { decision: input.decision, reviewer: input.reviewer, reviewedAt: now(), feedback: input.feedback ?? "" }
  if (input.decision === "approve") {
    const missing = unfilledHeadings(document)
    if (missing.length) throw new WorkflowError(`正式里程碑文档仍有未完成章节，禁止人工批准：${missing.join("、")}。`)
    const allSections = documentSections(document)
    const owned = new Set(writableHeadingsForStage(stage))
    const semanticBlockers = [...validateStageSemantics(state, stage, {
      ...input,
      summary: checkpoint.summary,
      sections: Object.fromEntries(Object.entries(allSections).filter(([heading]) => owned.has(heading))),
      ambiguityResolution: checkpoint.ambiguityResolution,
    }), ...validateHumanDecisionContract(state, stage, allSections, checkpoint.decisionItems ?? []),
    ...validateExternalPartyEvidence(state, stage, allSections)]
      .filter((finding) => finding.severity === "blocking")
    if (semanticBlockers.length) throw new WorkflowError(
      `正式里程碑文档未通过阶段语义复核，禁止人工批准：${semanticBlockers.map((finding) => finding.message).join("；")}`,
    )
    if (checkpoint.document === "milestoneIV") await writeApprovedModelContract(root, String(document))
    const decisionItems = checkpoint.decisionItems ?? []
    const openItems = decisionItems.filter((item) => item.status === "open")
    const selections = input.resolution?.selections ?? {}
    const resolvedItems: DecisionItem[] = []
    const missingSelections: string[] = []
    for (const item of openItems) {
      const requested = selections[item.id]
        ?? (openItems.length === 1 ? input.resolution?.selectedCandidateId : undefined)
      const selected = item.options.find((option) => option.id === requested)
        ?? item.options.find((option) => record.feedback.includes(option.id) || record.feedback.includes(option.label))
        ?? item.options.find((option) => option.id === item.recommendationId)
      if (!selected) {
        missingSelections.push(`${item.id}（${item.options.map((option) => option.id).join("/")}）`)
        continue
      }
      resolvedItems.push({
        ...item, status: "resolved", selectedOptionId: selected.id, selectedOptionLabel: selected.label,
        resolvedAt: now(), resolvedBy: input.reviewer,
      })
    }
    if (missingSelections.length) throw new WorkflowError(
      `这些决策没有唯一推荐项，批准时必须提供 resolution.selections：${missingSelections.join("、")}。`,
    )
    if (resolvedItems.length || decisionItems.some((item) => item.status !== "open")) {
      const unchanged = decisionItems.filter((item) => item.status !== "open")
      checkpoint.decisionItems = [...resolvedItems, ...unchanged]
      state.decisionLedger ??= []
      const replaced = new Set(checkpoint.decisionItems.map((item) => item.id))
      state.decisionLedger = [...state.decisionLedger.filter((item) => !replaced.has(item.id)), ...checkpoint.decisionItems]
      const decisionFeedback = resolvedItems.length
        ? `批准并接受：${resolvedItems.map((item) => `${item.id}=${item.selectedOptionId}（${item.selectedOptionLabel}）`).join("；")}`
        : "批准当前里程碑；没有待选择的业务决策。"
      if (!record.feedback.trim()) record = { ...record, feedback: decisionFeedback }
      state.humanDecisions ??= []
      for (const item of resolvedItems) state.humanDecisions.push({
        milestone: checkpoint.milestone, stage: checkpoint.stage, selectedCandidateId: item.selectedOptionId,
        candidateLabel: item.selectedOptionLabel,
        resolvedDecisions: [item.question, ...item.blocks],
        deferredToTacticalFamilies: deferredRuleFamilies(document),
        feedback: decisionFeedback,
        reviewer: input.reviewer, decidedAt: now(),
      })
      const ambiguity = checkpoint.ambiguityResolution as any
      if (ambiguity?.status === "unresolved" && resolvedItems.length === 1) checkpoint.ambiguityResolution = {
        ...ambiguity, status: "resolved", selectedCandidateId: resolvedItems[0].selectedOptionId,
        selectedCandidateLabel: resolvedItems[0].selectedOptionLabel,
        resolvedDecisions: input.resolution?.resolvedDecisions ?? ambiguity.affectedDecisions ?? [],
        resolvedAt: now(), resolvedBy: input.reviewer,
      }
    }
  }
  checkpoint.review = record
  if (input.decision === "approve") {
    checkpoint.status = "approved"
    if (stage.deliveryAssetGate) {
      const { execFile } = await import("node:child_process")
      const head = await new Promise<string>((resolve, reject) => execFile("git", ["rev-parse", "HEAD"], { cwd: state.projectRoot, windowsHide: true },
        (error, stdout) => error ? reject(new WorkflowError("里程碑 V 批准前必须存在可读取的 Git 基线。")) : resolve(stdout.trim())))
      state.implementationBaseline = { head, capturedAt: now() }
      if (state.deliveryPlan) state.deliveryPlan.approvedAt = now()
    }
    if (stage.openspecArchiveGate) state.status = "awaiting_archive"
    else if (stageIndex(profile, input.stage) === profile.stages.length - 1) state.status = "complete"
  } else if (input.decision === "revise") {
    checkpoint.status = "revision_requested"
    state.status = "revision_requested"
  } else {
    checkpoint.status = "rejected"
    state.status = "rejected"
  }
  await publishSections(root, profile, checkpoint.document, {
    "业务验收记录": `- 验收决定：${input.decision}\n- 验收人：${input.reviewer}\n- 验收时间：${record.reviewedAt}\n- 反馈：${record.feedback || "无"}`,
  })
  state.checkpoints[idx] = checkpoint
  delete state.preparedStage
  await saveState(root, state)
  const transition = workflowTransition(profile, state)
  return { ...transition, reviewRecord: record }
}

export async function status(input: StatusInput): Promise<Transition & { state?: any }> {
  const { root, profile } = await resolveRoot(input)
  const state = await loadState(root)
  const transition = workflowTransition(profile, state)
  if (input.view === "full") return { ...transition, state }
  return { ...transition }
}

export async function block(input: BlockInput): Promise<Transition & { runtimeBlock: NonNullable<WorkflowState["runtimeBlock"]> }> {
  const { root, profile } = await resolveRoot(input)
  const state = await loadState(root)
  const transition = workflowTransition(profile, state)
  if (!transition.allowedNextStages.includes(input.stage) && state.runtimeBlock?.stage !== input.stage) {
    throw new WorkflowError(`只能阻塞当前合法阶段：${transition.allowedNextStages.join("、") || "无"}。`)
  }
  if (!input.reason || input.reason.trim().length < 20) throw new WorkflowError("block.reason 至少 20 字，必须说明真实阻塞原因。")
  const record = {
    stage: input.stage,
    reason: input.reason.trim(),
    evidence: (input.evidence ?? []).filter(Boolean),
    remediation: (input.remediation ?? []).filter(Boolean),
    blockedAt: now(),
  }
  state.status = "runtime_blocked"
  state.currentStage = input.stage
  delete state.preparedStage
  state.runtimeBlock = record
  await saveState(root, state)
  return { ...workflowTransition(profile, state), runtimeBlock: record }
}

export async function archive(input: ArchiveInput): Promise<Transition & { archiveResult: any }> {
  const { root, profile } = await resolveRoot(input)
  const state = await loadState(root)
  if (state.status !== "awaiting_archive") throw new WorkflowError("仅最终验收批准后可归档。")
  const result = await verifyArchive(state.projectRoot, input.workflowId)
  if (result.archived) {
    state.status = "complete"
    delete state.preparedStage
    state.openSpec = { ...state.openSpec, status: "archived", archivedAt: now() }
    const archivedRoot = result.target ? path.join(result.target, profile.artifactSubdir ?? "") : root
    state.artifactRoot = archivedRoot
    await saveState(archivedRoot, state)
    await writeLink(archivedRoot, state, "archived", input.workflowId, result.target)
  }
  const transition = workflowTransition(profile, state)
  return { ...transition, archiveResult: result }
}

export async function openspec(input: OpenSpecInput): Promise<{ status: string; detail: string; artifact: string }> {
  const { root, profile } = await resolveRoot(input)
  const state = await loadState(root)
  const transition = workflowTransition(profile, state)
  const writing = input.content !== undefined || input.skipSpecs !== undefined
  if (writing) {
    const atPlanningGate = transition.allowedNextStages.some((id) => Boolean(stageContract(profile, id).openspecArtifactGate))
    if (!atPlanningGate && state.status !== "awaiting_archive") {
      throw new WorkflowError("OpenSpec 规划工件只能在交付计划阶段写入；awaiting_archive 仅允许修复缺失工件后重新严格校验。")
    }
  }
  const result = await openSpecAction({ projectRoot: state.projectRoot, artifact: input.artifact, state,
    content: input.content, capability: input.capability, skipSpecs: input.skipSpecs })
  return { ...result, artifact: input.artifact }
}

export { workflowTransition }
