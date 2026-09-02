import { createHash } from "node:crypto"
import type { WorkflowType } from "./types.js"

export type RequirementDelta = "ADDED" | "MODIFIED"

export interface DeliveryScenario {
  name: string
  given?: string
  when: string
  then: string
}

export interface DeliveryRequirement {
  name: string
  rule: string
  scenarios: DeliveryScenario[]
}

export interface DeliveryCapability {
  id: string
  title?: string
  /**
   * OpenSpec requirement delta. Feature/greenfield plans default to ADDED;
   * refactoring plans default to MODIFIED and may not silently widen scope.
   */
  delta?: RequirementDelta
  requirements: DeliveryRequirement[]
}

export interface RefactorBehaviorProtection {
  /** Stable IDs for approved or recovered AS-IS scenarios. */
  baselineScenarioRefs: string[]
  /** Real characterization tests that execute the preserved behavior. */
  characterizationTests: string[]
  /** Observable semantics that must remain equivalent before and after. */
  preservedSemantics: string[]
  /** How legacy and target paths coexist while this slice is deployed. */
  coexistenceStrategy: string
}

export interface RollbackContract {
  /** Observable condition that requires rollback. */
  trigger: string
  /** Ordered, executable rollback actions. */
  steps: string[]
  /** Commands or observations proving rollback restored the approved state. */
  verification: string[]
}

export interface DeliverySlice {
  id: string
  title: string
  outcome: string
  consumer: string
  dependsOn: string[]
  acceptanceCriteria: string[]
  modelElementIds: string[]
  invariantIds: string[]
  productionPaths: string[]
  testPaths: string[]
  verification: string[]
  compatibility: string
  /** Required for refactor-system. */
  behaviorProtection?: RefactorBehaviorProtection
  rollback: RollbackContract
}

export interface StructuredDeliveryPlan {
  title: string
  objective: string
  nonGoals: string[]
  designDecisions: string[]
  capabilities: DeliveryCapability[]
  slices: DeliverySlice[]
}

export interface PlanFinding {
  code: string
  path: string
  message: string
}

export interface ApprovedModelContract {
  modelElements?: Array<{ id: string; name?: string; type?: string; responsibility?: string }>
  invariants?: Array<{ id: string; statement?: string }>
  sourceSha256?: string
}

export interface DeliveryCompilationContext {
  workflowType?: WorkflowType
  /** Only behavior-preserving refactors may omit Delta Specs. */
  skipSpecs?: boolean
}

/** Machine-readable evidence for workflow-specific delivery obligations. */
export interface DeliveryPlanSemanticEvidence {
  sliceCount: number
  migrationVerticalSlices: boolean
  behaviorProtection: boolean
  independentRollback: boolean
}

const DELTAS = new Set<RequirementDelta>(["ADDED", "MODIFIED"])
const PLACEHOLDER = /^(?:(?:todo|tbd|later)\b.*|(?:待定|稍后|后续补充|后续完善|可回滚|兼容)(?:[：:].*)?)$/iu

const text = (value: unknown) => String(value ?? "").trim()
const list = (value: unknown) => Array.isArray(value) ? value.map(text).filter(Boolean) : []
const record = (value: unknown): Record<string, any> | undefined =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : undefined
const meaningful = (value: string) => Boolean(value.trim()) && !PLACEHOLDER.test(value.trim())

const decisionList = (value: unknown) => Array.isArray(value) ? value.map((item) => {
  if (!item || typeof item !== "object" || Array.isArray(item)) return text(item)
  const decision = text((item as any).decision)
  const rationale = text((item as any).rationale)
  const id = text((item as any).id)
  return [id, decision, rationale ? `理由：${rationale}` : ""].filter(Boolean).join("；")
}).filter(Boolean) : []

function mergeById<T extends { id: string }>(current: T[], patch: T[]): T[] {
  const merged = new Map(current.map((item) => [item.id, item]))
  for (const item of patch) merged.set(item.id, { ...(merged.get(item.id) ?? {}), ...item })
  return [...merged.values()]
}

function normalizeDelta(value: unknown, prior?: RequirementDelta): RequirementDelta | undefined {
  if (value === undefined) return prior
  const normalized = text(value).toUpperCase()
  return (normalized || undefined) as RequirementDelta | undefined
}

function normalizeBehaviorProtection(
  value: unknown,
  prior?: RefactorBehaviorProtection,
): RefactorBehaviorProtection | undefined {
  if (value === undefined && !prior) return undefined
  const raw = record(value) ?? {}
  const array = (field: keyof RefactorBehaviorProtection) => raw[field] === undefined
    ? [...((prior?.[field] as string[] | undefined) ?? [])]
    : list(raw[field])
  return {
    baselineScenarioRefs: array("baselineScenarioRefs"),
    characterizationTests: array("characterizationTests"),
    preservedSemantics: array("preservedSemantics"),
    coexistenceStrategy: raw.coexistenceStrategy === undefined
      ? text(prior?.coexistenceStrategy)
      : text(raw.coexistenceStrategy),
  }
}

function normalizeRollback(value: unknown, prior?: RollbackContract): RollbackContract {
  if (value === undefined && prior) return {
    trigger: prior.trigger,
    steps: [...prior.steps],
    verification: [...prior.verification],
  }
  // Preserve a deterministic repair path for old drafts, but deliberately
  // leave verification empty so validation forces migration to the typed form.
  if (typeof value === "string") return {
    trigger: "manual-revert-requested",
    steps: list([value]),
    verification: [],
  }
  const raw = record(value) ?? {}
  return {
    trigger: raw.trigger === undefined ? text(prior?.trigger) : text(raw.trigger),
    steps: raw.steps === undefined ? [...(prior?.steps ?? [])] : list(raw.steps),
    verification: raw.verification === undefined ? [...(prior?.verification ?? [])] : list(raw.verification),
  }
}

export function normalizeStructuredPlan(raw: any, current?: StructuredDeliveryPlan): StructuredDeliveryPlan {
  const currentCapabilities = new Map((current?.capabilities ?? []).map((item) => [item.id, item]))
  const capabilities = Array.isArray(raw?.capabilities) ? raw.capabilities.map((capability: any) => {
    const id = text(capability?.id)
    const prior = currentCapabilities.get(id)
    return {
      id,
      title: capability?.title === undefined ? prior?.title : (text(capability.title) || undefined),
      delta: normalizeDelta(capability?.delta, prior?.delta),
      requirements: capability?.requirements === undefined ? (prior?.requirements ?? []) : capability.requirements.map((requirement: any) => ({
        name: text(requirement?.name),
        rule: text(requirement?.rule),
        scenarios: Array.isArray(requirement?.scenarios) ? requirement.scenarios.map((scenario: any) => ({
          name: text(scenario?.name), given: text(scenario?.given) || undefined,
          when: text(scenario?.when), then: text(scenario?.then),
        })) : [],
      })),
    } as DeliveryCapability
  }) : []

  const currentSlices = new Map((current?.slices ?? []).map((item) => [item.id, item]))
  const slices = Array.isArray(raw?.slices) ? raw.slices.map((slice: any) => {
    const id = text(slice?.id)
    const prior = currentSlices.get(id)
    const scalar = (field: "title" | "outcome" | "consumer" | "compatibility") =>
      slice?.[field] === undefined ? text(prior?.[field]) : text(slice[field])
    const array = (field: "dependsOn" | "acceptanceCriteria" | "modelElementIds" | "invariantIds" | "productionPaths" | "testPaths" | "verification") =>
      slice?.[field] === undefined ? [...(prior?.[field] ?? [])] : list(slice[field])
    return {
      id,
      title: scalar("title"), outcome: scalar("outcome"), consumer: scalar("consumer"),
      dependsOn: array("dependsOn"), acceptanceCriteria: array("acceptanceCriteria"),
      modelElementIds: array("modelElementIds"), invariantIds: array("invariantIds"),
      productionPaths: array("productionPaths"), testPaths: array("testPaths"), verification: array("verification"),
      compatibility: scalar("compatibility"),
      behaviorProtection: normalizeBehaviorProtection(slice?.behaviorProtection, prior?.behaviorProtection),
      rollback: normalizeRollback(slice?.rollback, prior?.rollback),
    } satisfies DeliverySlice
  }) : []

  return {
    title: text(raw?.title) || current?.title || "",
    objective: text(raw?.objective) || current?.objective || "",
    nonGoals: raw?.nonGoals === undefined ? (current?.nonGoals ?? []) : list(raw.nonGoals),
    designDecisions: raw?.designDecisions === undefined ? (current?.designDecisions ?? []) : decisionList(raw.designDecisions),
    // An explicit empty array is a deliberate clear operation. This is
    // required when repairing a behavior-preserving refactor from a draft
    // that previously declared capability deltas before switching to
    // skipSpecs=true. Omitting the field still preserves the current draft.
    capabilities: Array.isArray(raw?.capabilities) && raw.capabilities.length === 0
      ? []
      : mergeById(current?.capabilities ?? [], capabilities),
    slices: Array.isArray(raw?.slices) && raw.slices.length === 0
      ? []
      : mergeById(current?.slices ?? [], slices),
  }
}

function defaultDelta(context: DeliveryCompilationContext): RequirementDelta {
  return context.workflowType === "refactor-system" ? "MODIFIED" : "ADDED"
}

function effectiveDelta(capability: DeliveryCapability, context: DeliveryCompilationContext): RequirementDelta {
  return capability.delta ?? defaultDelta(context)
}

function rollbackComplete(rollback: RollbackContract): boolean {
  return meaningful(rollback.trigger)
    && rollback.steps.length > 0 && rollback.steps.every(meaningful)
    && rollback.verification.length > 0 && rollback.verification.every(meaningful)
}

function behaviorProtectionComplete(protection?: RefactorBehaviorProtection): boolean {
  return Boolean(protection
    && protection.baselineScenarioRefs.length > 0 && protection.baselineScenarioRefs.every(meaningful)
    && protection.characterizationTests.length > 0 && protection.characterizationTests.every(meaningful)
    && protection.preservedSemantics.length > 0 && protection.preservedSemantics.every(meaningful)
    && meaningful(protection.coexistenceStrategy))
}

export function deliveryPlanSemanticEvidence(
  plan: StructuredDeliveryPlan,
  context: DeliveryCompilationContext = {},
): DeliveryPlanSemanticEvidence {
  const isRefactor = context.workflowType === "refactor-system"
  const hasSlices = plan.slices.length > 0
  return {
    sliceCount: plan.slices.length,
    migrationVerticalSlices: !isRefactor || hasSlices,
    behaviorProtection: !isRefactor || (hasSlices && plan.slices.every((slice) => behaviorProtectionComplete(slice.behaviorProtection))),
    independentRollback: hasSlices && plan.slices.every((slice) => rollbackComplete(slice.rollback)),
  }
}

export function validateStructuredPlan(
  plan: StructuredDeliveryPlan,
  context: DeliveryCompilationContext = {},
): PlanFinding[] {
  const findings: PlanFinding[] = []
  const required = (value: string, path: string, label: string) => {
    if (!meaningful(value)) findings.push({ code: "PLAN_FIELD_REQUIRED", path, message: `${label}不能为空或使用占位词。` })
  }

  required(plan.title, "plan.title", "计划标题")
  required(plan.objective, "plan.objective", "业务目标")

  const isRefactor = context.workflowType === "refactor-system"
  if (context.skipSpecs && !isRefactor) findings.push({
    code: "PLAN_SKIP_SPECS_WORKFLOW_INVALID", path: "skipSpecs",
    message: "skipSpecs 只允许行为保持型 refactor-system。",
  })
  if (isRefactor && context.skipSpecs && plan.capabilities.length > 0) findings.push({
    code: "PLAN_SKIP_SPECS_CAPABILITY_CONFLICT", path: "plan.capabilities",
    message: "skipSpecs=true 表示没有行为契约变化，因此不得同时声明 MODIFIED capability。",
  })
  if (!plan.capabilities.length && !(isRefactor && context.skipSpecs)) findings.push({
    code: "PLAN_CAPABILITY_REQUIRED", path: "plan.capabilities",
    message: isRefactor
      ? "有行为契约变化的重构至少需要一个 MODIFIED capability；纯行为保持重构应显式使用 skipSpecs。"
      : "新增功能至少需要一个行为 capability。",
  })
  if (!plan.slices.length) findings.push({
    code: "PLAN_SLICE_REQUIRED", path: "plan.slices", message: "至少需要一个可独立验收的纵向切片。",
  })

  const capabilityIds = new Set<string>()
  plan.capabilities.forEach((capability, ci) => {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(capability.id)) findings.push({
      code: "PLAN_CAPABILITY_ID_INVALID", path: `plan.capabilities[${ci}].id`, message: "capability id 必须是 kebab-case。",
    })
    if (capabilityIds.has(capability.id)) findings.push({
      code: "PLAN_CAPABILITY_DUPLICATE", path: `plan.capabilities[${ci}].id`, message: `capability ${capability.id} 重复。`,
    })
    capabilityIds.add(capability.id)

    const delta = effectiveDelta(capability, context)
    if (!DELTAS.has(delta)) findings.push({
      code: "PLAN_CAPABILITY_DELTA_INVALID", path: `plan.capabilities[${ci}].delta`,
      message: "结构化编译器当前只允许 ADDED 或 MODIFIED；移除和重命名需要单独的 OpenSpec 操作结构，不能套用普通 Requirement 模板。",
    })
    if (!isRefactor && delta !== "ADDED") findings.push({
      code: "PLAN_NON_REFACTOR_DELTA_INVALID", path: `plan.capabilities[${ci}].delta`,
      message: `${context.workflowType ?? "add-feature"} 只能生成 ADDED Requirements。`,
    })
    if (isRefactor && delta === "ADDED") findings.push({
      code: "PLAN_REFACTOR_ADDED_CAPABILITY", path: `plan.capabilities[${ci}].delta`,
      message: "refactor-system 不得把既有行为迁移伪装为 ADDED capability；新增能力应使用 add-feature 或回到战略里程碑扩大范围。",
    })

    if (!capability.requirements.length) findings.push({
      code: "PLAN_REQUIREMENT_REQUIRED", path: `plan.capabilities[${ci}].requirements`,
      message: "每个 capability 至少需要一个 Requirement。",
    })
    capability.requirements.forEach((requirement, ri) => {
      required(requirement.name, `plan.capabilities[${ci}].requirements[${ri}].name`, "Requirement 名称")
      required(requirement.rule, `plan.capabilities[${ci}].requirements[${ri}].rule`, "行为规则")
      if (!requirement.scenarios.length) findings.push({
        code: "PLAN_SCENARIO_REQUIRED", path: `plan.capabilities[${ci}].requirements[${ri}].scenarios`,
        message: "每个 Requirement 至少需要一个 Given/When/Then Scenario。",
      })
      requirement.scenarios.forEach((scenario, si) => {
        required(scenario.name, `plan.capabilities[${ci}].requirements[${ri}].scenarios[${si}].name`, "Scenario 名称")
        required(scenario.when, `plan.capabilities[${ci}].requirements[${ri}].scenarios[${si}].when`, "WHEN")
        required(scenario.then, `plan.capabilities[${ci}].requirements[${ri}].scenarios[${si}].then`, "THEN")
      })
    })
  })

  const sliceIds = new Set<string>()
  plan.slices.forEach((slice, index) => {
    const base = `plan.slices[${index}]`
    if (!/^[A-Za-z][A-Za-z0-9_-]*$/u.test(slice.id)) findings.push({
      code: "PLAN_SLICE_ID_INVALID", path: `${base}.id`, message: "切片 ID 必须稳定且以字母开头。",
    })
    if (sliceIds.has(slice.id)) findings.push({
      code: "PLAN_SLICE_DUPLICATE", path: `${base}.id`, message: `切片 ${slice.id} 重复。`,
    })
    sliceIds.add(slice.id)

    for (const [field, label] of [["title", "标题"], ["outcome", "可观察结果"], ["consumer", "真实消费者"], ["compatibility", "兼容策略"]] as const) {
      required(slice[field], `${base}.${field}`, `切片${label}`)
    }
    for (const [field, label] of [["acceptanceCriteria", "验收标准"], ["modelElementIds", "ME 模型元素"], ["invariantIds", "INV 不变量"], ["productionPaths", "生产路径"], ["testPaths", "测试路径"], ["verification", "验证命令"]] as const) {
      if (!slice[field].length || slice[field].some((item) => !meaningful(item))) findings.push({
        code: "PLAN_SLICE_LIST_REQUIRED", path: `${base}.${field}`, message: `切片必须声明真实${label}，不能使用占位词。`,
      })
    }

    if (!meaningful(slice.rollback.trigger)) findings.push({
      code: "PLAN_ROLLBACK_TRIGGER_REQUIRED", path: `${base}.rollback.trigger`,
      message: "回滚合同必须声明可观察触发条件。",
    })
    if (!slice.rollback.steps.length || slice.rollback.steps.some((item) => !meaningful(item))) findings.push({
      code: "PLAN_ROLLBACK_STEPS_REQUIRED", path: `${base}.rollback.steps`,
      message: "回滚合同必须声明有序且可执行的步骤。",
    })
    if (!slice.rollback.verification.length || slice.rollback.verification.some((item) => !meaningful(item))) findings.push({
      code: "PLAN_ROLLBACK_VERIFICATION_REQUIRED", path: `${base}.rollback.verification`,
      message: "回滚合同必须声明恢复后验证命令或观察。",
    })

    if (isRefactor) {
      const protection = slice.behaviorProtection
      if (!protection) findings.push({
        code: "PLAN_BEHAVIOR_PROTECTION_REQUIRED", path: `${base}.behaviorProtection`,
        message: "重构切片必须提交结构化行为保护合同。",
      })
      else {
        for (const [field, label] of [["baselineScenarioRefs", "基线场景引用"], ["characterizationTests", "特征测试"], ["preservedSemantics", "保留语义"]] as const) {
          if (!protection[field].length || protection[field].some((item) => !meaningful(item))) findings.push({
            code: "PLAN_BEHAVIOR_PROTECTION_FIELD_REQUIRED", path: `${base}.behaviorProtection.${field}`,
            message: `重构切片必须声明真实${label}。`,
          })
        }
        if (!meaningful(protection.coexistenceStrategy)) findings.push({
          code: "PLAN_BEHAVIOR_COEXISTENCE_REQUIRED", path: `${base}.behaviorProtection.coexistenceStrategy`,
          message: "重构切片必须说明迁移期间新旧路径如何共存。",
        })
      }
    }
  })

  plan.slices.forEach((slice, index) => slice.dependsOn.forEach((dependency) => {
    if (!sliceIds.has(dependency)) findings.push({
      code: "PLAN_DEPENDENCY_UNKNOWN", path: `plan.slices[${index}].dependsOn`, message: `依赖切片 ${dependency} 不存在。`,
    })
    if (dependency === slice.id) findings.push({
      code: "PLAN_DEPENDENCY_SELF", path: `plan.slices[${index}].dependsOn`, message: "切片不能依赖自身。",
    })
  }))

  const visiting = new Set<string>(); const visited = new Set<string>()
  const deps = new Map(plan.slices.map((slice) => [slice.id, slice.dependsOn]))
  const cycle = (id: string): boolean => {
    if (visiting.has(id)) return true
    if (visited.has(id)) return false
    visiting.add(id)
    for (const dependency of deps.get(id) ?? []) if (cycle(dependency)) return true
    visiting.delete(id); visited.add(id); return false
  }
  if ([...sliceIds].some(cycle)) findings.push({
    code: "PLAN_DEPENDENCY_CYCLE", path: "plan.slices", message: "纵向切片依赖图必须无环。",
  })
  return findings
}

function deltaLabel(delta: RequirementDelta): string {
  return ({ ADDED: "新增", MODIFIED: "调整" } as const)[delta]
}

function formatRollbackInline(rollback: RollbackContract): string {
  return `触发：${rollback.trigger}；步骤：${rollback.steps.join("；")}；恢复验证：${rollback.verification.join("；")}`
}

function formatBehaviorProtectionInline(protection?: RefactorBehaviorProtection): string {
  if (!protection) return "未提供结构化行为保护合同"
  return [
    `基线场景：${protection.baselineScenarioRefs.join("、")}`,
    `特征测试：${protection.characterizationTests.join("、")}`,
    `保留语义：${protection.preservedSemantics.join("；")}`,
    `共存策略：${protection.coexistenceStrategy}`,
  ].join("；")
}

export function compileStructuredPlan(
  plan: StructuredDeliveryPlan,
  workflowId: string,
  context: DeliveryCompilationContext = {},
) {
  const capabilityChanges = plan.capabilities.length
    ? plan.capabilities.map((capability) => {
      const delta = effectiveDelta(capability, context)
      return `- ${deltaLabel(delta)} ${capability.title || capability.id} 行为契约（${delta}）。`
    })
    : [`- 在不改变已批准行为的前提下迁移 ${plan.slices.length} 个真实业务路径。`]
  const proposal = [
    `# ${plan.title}`, "", "## Why", plan.objective, "", "## What Changes",
    ...capabilityChanges,
    "", "## Non-goals", ...(plan.nonGoals.length ? plan.nonGoals.map((item) => `- ${item}`) : ["- 无额外范围。"]), "",
  ].join("\n")

  const specs = context.skipSpecs ? [] : plan.capabilities.map((capability) => {
    const delta = effectiveDelta(capability, context)
    return {
      capability: capability.id,
      delta,
      content: [`## ${delta} Requirements`, ...capability.requirements.flatMap((requirement) => [
        "", `### Requirement: ${requirement.name}`, `系统 MUST ${requirement.rule.replace(/^系统\s+(?:MUST|SHALL)\s+/iu, "")}`,
        ...requirement.scenarios.flatMap((scenario) => ["", `#### Scenario: ${scenario.name}`,
          ...(scenario.given ? [`- GIVEN ${scenario.given}`] : []), `- WHEN ${scenario.when}`, `- THEN ${scenario.then}`]),
      ]), ""].join("\n"),
    }
  })

  const isRefactor = context.workflowType === "refactor-system"
  const design = [
    `# ${plan.title} 设计`, "", `OpenSpec change: ${workflowId}`, "", "## Approved design decisions",
    ...(plan.designDecisions.length ? plan.designDecisions.map((item) => `- ${item}`) : ["- 沿用里程碑 IV 已批准的领域模型与依赖方向。"]),
    "", "## Vertical slices",
    ...plan.slices.flatMap((slice) => [
      `### ${slice.id} ${slice.title}`,
      `- 结果：${slice.outcome}`,
      `- 消费者：${slice.consumer}`,
      `- 依赖：${slice.dependsOn.join("、") || "无"}`,
      `- 模型：${slice.modelElementIds.join("、")}`,
      `- 不变量：${slice.invariantIds.join("、")}`,
      `- 兼容：${slice.compatibility}`,
      ...(isRefactor ? [`- 行为保护：${formatBehaviorProtectionInline(slice.behaviorProtection)}`] : []),
      `- 回滚：${formatRollbackInline(slice.rollback)}`,
    ]), "",
  ].join("\n")

  const tasks = plan.slices.map((slice, index) =>
    `- [ ] ${index + 1}.1 [${slice.id}] ${slice.title}；消费者：${slice.consumer}；验证：${slice.verification.join("；")}`,
  ).join("\n") + "\n"

  const roadmap = {
    schemaVersion: "ddd-delivery-roadmap/v3", workflowId, generatedAt: new Date().toISOString(),
    slices: plan.slices.map((slice, index) => ({ ...slice, order: index + 1, status: "planned" })),
    sourceHash: createHash("sha256").update(JSON.stringify(plan)).digest("hex"),
  }
  return { proposal, specs, design, tasks, roadmap }
}

export function compileDeliveryMilestoneSections(
  plan: StructuredDeliveryPlan,
  workflowId: string,
  contract: ApprovedModelContract = {},
  context: DeliveryCompilationContext = {},
): { summary: string; sections: Record<string, string> } {
  const isRefactor = context.workflowType === "refactor-system"
  const semanticEvidence = deliveryPlanSemanticEvidence(plan, context)
  const models = new Map((contract.modelElements ?? []).map((item) => [item.id, item]))
  const invariants = new Map((contract.invariants ?? []).map((item) => [item.id, item]))
  const modelLabel = (id: string) => {
    const item = models.get(id)
    return item ? `${id} ${item.name ?? ""}`.trim() : id
  }
  const invariantLabel = (id: string) => {
    const item = invariants.get(id)
    return item?.statement ? `${id}：${item.statement}` : id
  }

  const sliceDetails = [
    ...(isRefactor ? [
      `迁移纵向切片：以下 ${semanticEvidence.sliceCount} 个切片直接来自已校验的 plan.slices；迁移顺序由 dependsOn 决定。`,
      "",
    ] : []),
    ...plan.slices.flatMap((slice) => [
      `### ${slice.id}：${slice.title}`,
      `- 可观察业务结果：${slice.outcome}`,
      `- 真实消费者：${slice.consumer}`,
      `- 前置切片：${slice.dependsOn.join("、") || "无"}`,
      `- 验收标准：${slice.acceptanceCriteria.join("；")}`,
      `- 模型元素：${slice.modelElementIds.map(modelLabel).join("；")}`,
      `- 业务不变量：${slice.invariantIds.map(invariantLabel).join("；")}`,
      `- 生产文件：${slice.productionPaths.join("；")}`,
      `- 测试文件：${slice.testPaths.join("；")}`,
      `- 真实验证：${slice.verification.join("；")}`,
      `- ${isRefactor ? "迁移兼容" : "兼容策略"}：${slice.compatibility}`,
      ...(isRefactor ? [
        `- 行为保护基线：${slice.behaviorProtection?.baselineScenarioRefs.join("；") ?? ""}`,
        `- Characterization tests：${slice.behaviorProtection?.characterizationTests.join("；") ?? ""}`,
        `- 保留语义：${slice.behaviorProtection?.preservedSemantics.join("；") ?? ""}`,
        `- 新旧路径共存：${slice.behaviorProtection?.coexistenceStrategy ?? ""}`,
      ] : []),
      `- 回滚触发：${slice.rollback.trigger}`,
      `- 回滚步骤：${slice.rollback.steps.join("；")}`,
      `- 回滚验证：${slice.rollback.verification.join("；")}`,
      "",
    ]),
  ].join("\n").trim()

  const traceRows = plan.slices.map((slice) =>
    `| ${slice.id} | ${slice.acceptanceCriteria.join("；")} | ${slice.modelElementIds.join("、")} | ${slice.invariantIds.join("、")} | ${slice.productionPaths.join("；")} | ${slice.testPaths.join("；")} |`)
  const requirementRows = plan.capabilities.flatMap((capability) => capability.requirements.flatMap((requirement) =>
    requirement.scenarios.map((scenario) =>
      `- ${capability.id} [${effectiveDelta(capability, context)}] / ${requirement.name} / ${scenario.name}：WHEN ${scenario.when}；THEN ${scenario.then}`)))
  const summary = `${plan.title}将按 ${plan.slices.length} 个可独立验收和回滚的纵向切片交付；所有切片均绑定真实消费者、批准模型、不变量、生产与测试文件以及验证命令。`

  const sections: Record<string, string> = {
    "一页结论": `${summary}\n\n业务目标：${plan.objective}\n\n当前状态：结构化 OpenSpec 计划已通过运行时编译，等待里程碑 V 人工批准后进入编码。`,
    "本次请您确认": [
      "请确认以下交付决策，而不是重新评审领域模型：",
      `- ${plan.slices.length} 个纵向切片的业务结果、顺序和依赖是否合理。`,
      "- 每个切片的真实消费者、验收标准、验证命令和结构化回滚合同是否可执行。",
      ...(isRefactor ? ["- 每个重构切片的基线场景、特征测试、保留语义和新旧路径共存策略是否充分。"] : []),
      `- 明确不做：${plan.nonGoals.join("；") || "无额外范围"}。`,
      "AI 建议：优先批准能贯通真实消费者的最小 Walking Skeleton，再按依赖顺序完成后续切片。",
    ].join("\n"),
    "交付范围": [
      `业务目标：${plan.objective}`, "", "批准设计决策：",
      ...(plan.designDecisions.length ? plan.designDecisions.map((item) => `- ${item}`) : ["- 沿用里程碑 IV 已批准设计。"]),
      "", "明确不做：", ...(plan.nonGoals.length ? plan.nonGoals.map((item) => `- ${item}`) : ["- 无额外范围。"]),
    ].join("\n"),
    "纵向交付切片": sliceDetails,
    "交付追踪矩阵": [
      "纵向切片—验收—文件映射：", "", "战术模型—切片—文件覆盖：",
      "| 切片 | 验收标准 | 模型元素 | 不变量 | 生产文件 | 测试文件 |",
      "|---|---|---|---|---|---|", ...traceRows, "",
      "模块—层—依赖机器合同：生产文件必须遵循里程碑 IV 已批准的上下文优先分层和依赖方向；编码阶段不得另建未批准入口或基础设施。",
    ].join("\n"),
    "OpenSpec 变更映射": [
      `OpenSpec change 映射：${workflowId}`, "OpenSpec Requirement/Scenario 追踪：",
      ...(requirementRows.length ? requirementRows : ["- 行为保持型重构：skipSpecs=true；行为契约由基线场景与特征测试保护。"]),
      `- 纵向切片：${plan.slices.map((slice) => slice.id).join("、")}`,
    ].join("\n"),
    "测试与验证计划": [
      "架构验证命令：复用下列每个切片已校验的工程验证命令，并在真实消费者链路中核验已批准的模块边界和依赖方向。",
      "",
      ...plan.slices.map((slice) => [
        `### ${slice.id}`,
        `- 验收：${slice.acceptanceCriteria.join("；")}`,
        `- 测试文件：${slice.testPaths.join("；")}`,
        `- 验证命令：${slice.verification.join("；")}`,
        ...(isRefactor ? [`- 特征测试：${slice.behaviorProtection?.characterizationTests.join("；") ?? ""}`] : []),
        `- 回滚验证：${slice.rollback.verification.join("；")}`,
      ].join("\n")),
    ].join("\n\n"),
    "Git 交付计划": [
      "Git 基线与回滚策略：编码开始前记录当前分支与 HEAD；每个切片形成一个独立提交。",
      ...plan.slices.map((slice) =>
        `- ${slice.id}：验证通过后独立提交；触发“${slice.rollback.trigger}”时执行：${slice.rollback.steps.join("；")}；随后验证：${slice.rollback.verification.join("；")}。`),
      "- 禁止把多个未验证切片合并为一次提交；提交标识写入实现证据。",
    ].join("\n"),
    "风险、迁移与上线": [
      ...(isRefactor ? [
        "### 行为保护与回滚",
        `结构化合同判定：行为保护字段${semanticEvidence.behaviorProtection ? "完整" : "不完整"}；独立回滚字段${semanticEvidence.independentRollback ? "完整" : "不完整"}。`,
        "",
      ] : []),
      ...plan.slices.flatMap((slice) => [
        `- ${slice.id} 兼容与迁移：${slice.compatibility}`,
        ...(isRefactor ? [`  - 行为保护：${formatBehaviorProtectionInline(slice.behaviorProtection)}`] : []),
        `  - 回滚合同：${formatRollbackInline(slice.rollback)}`,
      ]),
    ].join("\n"),
    "备选交付方案与建议": `推荐按当前 ${plan.slices.length} 个纵向切片渐进交付，每个切片都产生真实业务结果并可独立验证。若合并切片会扩大失败与回滚范围；若按技术层拆分则无法独立业务验收，因此均不推荐。`,
    "证据与追踪": [
      `- OpenSpec change：${workflowId}`,
      `- 结构化计划哈希：${createHash("sha256").update(JSON.stringify(plan)).digest("hex")}`,
      `- model-contract.json 哈希：${contract.sourceSha256 ?? "由当前批准模型合同提供"}`,
      `- 切片数量：${plan.slices.length}`,
      ...(isRefactor ? [
        `- 重构交付合同：迁移纵向切片=${semanticEvidence.migrationVerticalSlices ? "满足" : "不满足"}；行为保护=${semanticEvidence.behaviorProtection ? "满足" : "不满足"}；独立回滚=${semanticEvidence.independentRollback ? "满足" : "不满足"}。`,
      ] : []),
      "- 本文由运行时从已校验的结构化计划和批准模型合同确定性编译，未接受模型自由改写。",
    ].join("\n"),
  }
  return { summary, sections }
}
