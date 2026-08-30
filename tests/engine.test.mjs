import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm, readFile, writeFile, mkdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { initialize, prepare, submit, review, status, block, archive, hasFailedVerificationEvidence, containsRequiredConcept, extractApprovedModelContract, queryPseudoEvents, requiresScenarioClarification, validateStageSemantics } from "../dist/engine.js"
import { DddWorkflowPlugin, dddLifecycleTool, lifecycleFinalizeMetadata, normalizeReviewDecision } from "../dist/index.js"
import { renderSections, unfilledHeadings } from "../dist/documents.js"
import { newChange, openSpecAction, planningArtifacts, runOpenSpec, verifyArchive } from "../dist/openspec.js"
import { evidenceBundle } from "../dist/evidence.js"
import { profileFor } from "../dist/catalog.js"
import { workflowTransition } from "../dist/transition.js"
import { loadState } from "../dist/state.js"
import { compileDeliveryMilestoneSections, compileStructuredPlan, deliveryPlanSemanticEvidence, normalizeStructuredPlan, validateStructuredPlan } from "../dist/delivery-plan.js"

test("renderSections replaces only the matching level-two milestone section", () => {
  const skeleton = [
    "# 里程碑 III",
    "",
    "## 一页结论",
    "",
    "### 模型与边界候选",
    "",
    "这里是概览中的三级标题。",
    "",
    "## 模型与边界候选",
    "",
    "> _待填写_",
    "",
    "## 证据与追踪",
    "",
    "> _待填写_",
    "",
  ].join("\n")

  const rendered = renderSections(skeleton, { "模型与边界候选": "正式候选内容。" })
  assert.match(rendered, /### 模型与边界候选\n\n这里是概览中的三级标题。/u)
  assert.match(rendered, /## 模型与边界候选\n\n正式候选内容。/u)
  assert.deepEqual(unfilledHeadings(rendered), ["证据与追踪"])
})

test("lifecycle finalize accepts stage-card camelCase metadata", () => {
  assert.deepEqual(lifecycleFinalizeMetadata({ plannedSlices: 2, sliceId: "slice-1" }), {
    plannedSlices: 2,
    sliceId: "slice-1",
  })
  assert.deepEqual(lifecycleFinalizeMetadata({ planned_slices: 3, slice_id: "slice-2" }), {
    plannedSlices: 3,
    sliceId: "slice-2",
  })
})

test("review decision normalization accepts weaker model aliases", () => {
  assert.equal(normalizeReviewDecision("approved"), "approve")
  assert.equal(normalizeReviewDecision("revision_requested"), "revise")
  assert.equal(normalizeReviewDecision("rejected"), "reject")
  assert.equal(normalizeReviewDecision("V"), null)
})

const validStructuredPlan = {
  title: "用户访问轨迹", objective: "用户可以查看当天真实访问过的店铺轨迹。", nonGoals: ["不表示物理到店"],
  designDecisions: ["沿用批准的 VisitTrail 上下文和模型合同。"],
  capabilities: [{ id: "daily-visit-trail", requirements: [{ name: "查询当天轨迹", rule: "返回当前用户当天访问轨迹", scenarios: [{ name: "当天存在记录", given: "用户已经访问店铺", when: "用户查询当天轨迹", then: "按访问时间返回轨迹" }] }] }],
  slices: [{ id: "S1", title: "记录并查询访问轨迹", outcome: "用户可以看到当天轨迹", consumer: "ShopController",
    dependsOn: [], acceptanceCriteria: ["能够返回当天轨迹"], modelElementIds: ["ME-01"], invariantIds: ["INV-01"], productionPaths: ["src/main/java/com/hmdp/visit/VisitTrail.java"],
    testPaths: ["src/test/java/com/hmdp/visit/VisitTrailTest.java"], verification: ["mvn -Dtest=VisitTrailTest test"],
    compatibility: "保留既有商铺详情响应", rollback: "revert slice commit" }],
}

// Reduced from the Codex six-way failure
// `legacy-shop-access-records-refactor/.ddd/delivery/plan.json`.  Both slices
// had complete typed compatibility/rollback fields, but milestone V was
// rejected because its deterministic prose did not repeat two profile labels.
const refactorRoadmapRegressionPlan = {
  ...validStructuredPlan,
  title: "遗留店铺访问记录行为保持重构",
  objective: "保持公开调用、错误语义、排序与 JSON 格式，将规则迁入批准模型。",
  nonGoals: ["不新增公开接口", "不迁移存储介质"],
  slices: [
    {
      ...validStructuredPlan.slices[0],
      id: "S1",
      title: "记录访问路径迁入批准模型",
      outcome: "recordShopVisit 的成功、拒绝、排序和保存结果保持不变。",
      consumer: "现有 recordShopVisit 调用方与 characterization tests",
      compatibility: "先通过记录路径特征测试，再让原入口委派给批准的记录用例；JSON 不迁移。",
      rollback: "独立 Git 提交；revert S1 即恢复原记录流程。",
    },
    {
      ...validStructuredPlan.slices[0],
      id: "S2",
      title: "按日查询路径迁入批准模型",
      outcome: "listDailyVisits 的身份拒绝、严格筛选和顺序保持不变。",
      consumer: "现有 listDailyVisits 调用方与 characterization tests",
      dependsOn: ["S1"],
      compatibility: "复用 S1 已验证的仓储端口，原查询入口只进行委派。",
      rollback: "独立 Git 提交；revert S2 只恢复原查询流程。",
    },
  ],
}

test("structured delivery plan compiles OpenSpec artifacts and an executable slice graph", () => {
  const plan = normalizeStructuredPlan(validStructuredPlan)
  assert.deepEqual(validateStructuredPlan(plan), [])
  const compiled = compileStructuredPlan(plan, "daily-visit-trail")
  assert.match(compiled.specs[0].content, /系统 MUST/u)
  assert.match(compiled.specs[0].content, /#### Scenario:/u)
  assert.match(compiled.tasks, /- \[ \] 1\.1 \[S1\]/u)
  assert.equal(compiled.roadmap.slices[0].status, "planned")
})

test("refactor delivery evidence is derived from typed slices and compiles all migration obligations", () => {
  const plan = normalizeStructuredPlan(refactorRoadmapRegressionPlan)
  assert.deepEqual(validateStructuredPlan(plan), [])
  assert.deepEqual(deliveryPlanSemanticEvidence(plan, { workflowType: "refactor-system" }), {
    sliceCount: 2,
    migrationVerticalSlices: true,
    behaviorProtection: true,
    independentRollback: true,
  })
  const compiled = compileDeliveryMilestoneSections(plan, "legacy-shop-access-records-refactor", {}, {
    workflowType: "refactor-system",
  })
  const candidate = Object.values(compiled.sections).join("\n")
  for (const concept of ["迁移纵向切片", "行为保护与回滚", "model-contract.json", "模块—层—依赖机器合同", "架构验证命令", "OpenSpec change 映射"]) {
    assert.equal(containsRequiredConcept(candidate, concept), true, `missing ${concept}`)
  }
  assert.match(compiled.sections["纵向交付切片"], /plan\.slices/u)
  assert.match(compiled.sections["风险、迁移与上线"], /行为保护字段完整；独立回滚字段完整/u)
})

test("structured delivery plan returns all graph and business-contract findings together", () => {
  const plan = normalizeStructuredPlan({ ...validStructuredPlan, capabilities: [], slices: [
    { ...validStructuredPlan.slices[0], id: "S1", dependsOn: ["S2"] },
    { ...validStructuredPlan.slices[0], id: "S2", dependsOn: ["S1"], consumer: "" },
  ] })
  const findings = validateStructuredPlan(plan)
  assert.ok(findings.some((finding) => finding.code === "PLAN_CAPABILITY_REQUIRED"))
  assert.ok(findings.some((finding) => finding.code === "PLAN_DEPENDENCY_CYCLE"))
  assert.ok(findings.some((finding) => finding.path.endsWith("consumer")))
})

test("structured delivery plan repair preserves untouched slice fields", () => {
  const current = normalizeStructuredPlan(validStructuredPlan)
  const repaired = normalizeStructuredPlan({ slices: [{ id: "S1", consumer: "VisitTrailController" }] }, current)
  assert.equal(repaired.slices[0].consumer, "VisitTrailController")
  assert.deepEqual(repaired.slices[0].verification, current.slices[0].verification)
  assert.deepEqual(repaired.capabilities, current.capabilities)
})

test("structured delivery plan normalizes object decisions without object-string leakage", () => {
  const plan = normalizeStructuredPlan({
    ...validStructuredPlan,
    designDecisions: [{ id: "DD-1", decision: "沿用批准聚合", rationale: "里程碑 IV 已批准" }],
  })
  assert.deepEqual(plan.designDecisions, ["DD-1；沿用批准聚合；理由：里程碑 IV 已批准"])
  const milestone = compileDeliveryMilestoneSections(plan, "daily-visit-trail", {})
  assert.doesNotMatch(milestone.sections["交付范围"], /\[object Object\]/u)
  assert.match(milestone.sections["交付追踪矩阵"], /纵向切片—验收—文件映射/u)
  assert.match(milestone.sections["证据与追踪"], /model-contract\.json/u)
})

test("state migration repairs legacy approved decisions that were misclassified as rejected", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "ddd-state-migration-"))
  try {
    await mkdir(path.join(dir, ".ddd"), { recursive: true })
    const state = {
      schemaVersion: "ddd-workflow-state/v1", workflowType: "add-feature", workflowId: "legacy",
      title: "t", projectRoot: dir, artifactRoot: dir, status: "rejected", currentStage: "08-roadmap",
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), checkpoints: [{
        checkpointId: 1, stage: "08-roadmap", milestone: "V", summary: longSummary, status: "rejected",
        review: { decision: "approved", reviewer: "human", reviewedAt: new Date().toISOString(), feedback: "" },
        reviewChecklist: [], adviceRequired: false, document: "milestoneV", completedAt: new Date().toISOString(),
      }],
    }
    await writeFile(path.join(dir, ".ddd", "workflow-state.json"), JSON.stringify(state), "utf8")
    const migrated = await loadState(dir)
    assert.equal(migrated.status, "active")
    assert.equal(migrated.checkpoints[0].status, "approved")
    assert.equal(migrated.checkpoints[0].review.decision, "approve")
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("core review rejects unknown decisions instead of treating them as rejection", async () => {
  await assert.rejects(review({ workflowType: "add-feature", workflowId: "x", projectRoot: "Z:/missing",
    stage: "08-roadmap", decision: "approved", reviewer: "human" }), /非法验收决定/u)
})

test("model contract extraction accepts colon and Markdown-list invariant forms", () => {
  const contract = extractApprovedModelContract("- ME-01 PageView 聚合根\n- INV-01 每次成功查看恰好一条记录\n- INV-02：重复查看逐条保留")
  assert.deepEqual(contract.modelElements, [{ id: "ME-01", name: "PageView" }])
  assert.deepEqual(contract.invariants, [
    { id: "INV-01", statement: "每次成功查看恰好一条记录" },
    { id: "INV-02", statement: "重复查看逐条保留" },
  ])
})

test("model contract extraction accepts the original refactor prose without format-only rewrites", () => {
  const contract = extractApprovedModelContract([
    "ME-01 `VisitKey` 值对象：严格保存 userId、shopId、day。ME-02: DailyShopVisit 聚合根。",
    "ME-03 访问时刻值对象；ME-04 访问日志仓储抽象；ME-05 记录店铺访问应用服务。",
    "INV-01 同键最多一个事实；INV-02：最早访问时间只能保持或提前。",
    "ME-99 和 ME-98 仅是普通追踪引用，不是模型定义。",
    "唯一有意例外是 ME-04 的批量端口；INV-01 由 ME-01 与 ME-04 共同保护。",
  ].join("\n"))
  assert.deepEqual(contract.modelElements, [
    { id: "ME-01", name: "VisitKey" },
    { id: "ME-02", name: "DailyShopVisit" },
    { id: "ME-03", name: "访问时刻" },
    { id: "ME-04", name: "访问日志" },
    { id: "ME-05", name: "记录店铺访问" },
  ])
  assert.deepEqual(contract.invariants, [
    { id: "INV-01", statement: "同键最多一个事实" },
    { id: "INV-02", statement: "最早访问时间只能保持或提前" },
  ])
})

test("model contract extraction accepts a typed embedded JSON contract", () => {
  const contract = extractApprovedModelContract([
    "model-contract",
    "```json",
    JSON.stringify({ modelElements: [{ id: "ME-01", name: "访问日志" }], invariants: [{ id: "INV-01", statement: "同一用户同店同日最多一条访问事实" }] }),
    "```",
  ].join("\n"))
  assert.deepEqual(contract.modelElements, [{ id: "ME-01", name: "访问日志" }])
  assert.deepEqual(contract.invariants, [{ id: "INV-01", statement: "同一用户同店同日最多一条访问事实" }])
})

test("model contract extraction accepts inline-code ids, method signatures, events, and semicolon invariants", () => {
  const document = [
    "`ME-01 Favorite` 是聚合根，身份为 `ME-02 FavoriteKey(UserId, ShopId)`，状态含不可变 `ME-03 FavoritedAt`。",
    "`ME-04 FavoriteShop.handle({userId, shopId})` 与 `ME-05 ListFavoriteShops.handle({userId})` 是应用服务。",
    "`ME-06 FavoriteRepository.find(FavoriteKey)`、`ME-07 FavoriteReadRepository.listByUser(UserId)` 是仓储端口。",
    "`ME-08 ShopCatalogPort.findAvailable(shopId)` 与 `ME-10 IdentityPort.requireRecognized(userId)` 是上游端口。",
    "`ME-09 ShopFavorited {userId, shopId, favoritedAt}` 是领域事件。",
    "`INV-01` 同一 FavoriteKey 至多一个聚合；`INV-02` FavoritedAt 创建后不可变；`INV-03` 事件只产生一次；",
    "`INV-04` 查询必须按 UserId 隔离；`INV-05` 最近优先稳定排序；`INV-06` 提交后立即可见。",
  ].join("\n")
  const contract = extractApprovedModelContract(document)
  assert.deepEqual(contract.modelElements.map((item) => item.id), [
    "ME-01", "ME-02", "ME-03", "ME-04", "ME-05", "ME-06", "ME-07", "ME-08", "ME-09", "ME-10",
  ])
  assert.deepEqual(contract.invariants.map((item) => item.id), [
    "INV-01", "INV-02", "INV-03", "INV-04", "INV-05", "INV-06",
  ])
})

test("refactor milestone IV approval materializes Chinese typed model names without a format-only revision", async () => {
  const dir = await freshProject()
  try {
    await initialize({ workflowType: "refactor-system", workflowId: "chinese-model-contract", projectRoot: dir,
      title: "访问日志重构", request: "保持现有行为并迁移访问日志模型" })
    const root = path.join(dir, "openspec", "changes", "chinese-model-contract", "ddd")
    const stateFile = path.join(root, ".ddd", "workflow-state.json")
    const state = JSON.parse(await readFile(stateFile, "utf8"))
    state.currentStage = "06-pilot-tactical-design"
    state.checkpoints.push({ checkpointId: 4, stage: "06-pilot-tactical-design", milestone: "IV", summary: longSummary,
      status: "awaiting_review", reviewTitle: "确认试点服务的领域模型", reviewChecklist: [], adviceRequired: true,
      document: "milestoneIV", completedAt: new Date().toISOString() })
    await writeFile(stateFile, JSON.stringify(state), "utf8")
    await writeFile(path.join(root, "IV-tactical-design.md"), [
      "# 里程碑 IV：战术设计",
      "",
      "## 领域模型设计",
      "ME-01 访问日志聚合根；ME-02 访问记录实体；ME-03 首次访问时间值对象；ME-04 访问日志仓储抽象；ME-05 记录店铺访问应用服务；INV-01 去重；INV-02 最早时间。",
      "",
      "## 证据与追踪",
      "上述稳定编号均来自本轮已批准战术设计。",
      "",
    ].join("\n"), "utf8")

    await review({ workflowType: "refactor-system", workflowId: "chinese-model-contract", projectRoot: dir,
      stage: "06-pilot-tactical-design", decision: "approve", reviewer: "tester" })
    const contract = JSON.parse(await readFile(path.join(root, "model-contract.json"), "utf8"))
    assert.deepEqual(contract.modelElements.map(({ id, name }) => ({ id, name })), [
      { id: "ME-01", name: "访问日志" },
      { id: "ME-02", name: "访问记录" },
      { id: "ME-03", name: "首次访问时间" },
      { id: "ME-04", name: "访问日志" },
      { id: "ME-05", name: "记录店铺访问" },
    ])
    assert.deepEqual(contract.invariants, [{ id: "INV-02", statement: "最早时间" }])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

async function freshProject() {
  return mkdtemp(path.join(tmpdir(), "ddd-v2-"))
}

const longSummary = "本阶段结论已完成并形成必要证据，可进入下一里程碑。"

test("OpenSpec bridge writes official metadata and planning artifact graph", async () => {
  const dir = await freshProject()
  try {
    await newChange(dir, "feature-delta", "新增能力", "新增一个可观察业务能力")
    const change = path.join(dir, "openspec", "changes", "feature-delta")
    assert.match(await readFile(path.join(change, ".openspec.yaml"), "utf8"), /^schema: spec-driven$/mu)
    const state = { workflowId: "feature-delta", workflowType: "add-feature" }
    await openSpecAction({ projectRoot: dir, artifact: "proposal", state,
      content: "## Why\n需要该能力。\n\n## What Changes\n- 新增轨迹。\n\n## Capabilities\n\n### New Capabilities\n- `visit-trail`: 用户轨迹。\n\n### Modified Capabilities\n\n## Impact\n新增接口。" })
    await openSpecAction({ projectRoot: dir, artifact: "specs", state, capability: "visit-trail",
      content: "## Purpose\n为登录用户提供可核验的一日店铺查看轨迹，并保持页面查看与实际到店语义分离。\n\n## ADDED Requirements\n\n### Requirement: 查询本人轨迹\n系统 SHALL 返回本人轨迹。\n\n#### Scenario: 当天无记录\n- **WHEN** 用户查询无记录日期\n- **THEN** 系统返回空列表" })
    await openSpecAction({ projectRoot: dir, artifact: "design", state,
      content: "## Context\n现有单体。\n\n## Goals / Non-Goals\n保持边界。\n\n## Decisions\n追加事实。\n\n## Risks / Trade-offs\n写入失败隔离。" })
    await openSpecAction({ projectRoot: dir, artifact: "tasks", state,
      content: "## 1. Delivery\n\n- [ ] 1.1 实现纵向切片\n- [ ] 1.2 验证真实链路" })
    assert.equal((await planningArtifacts(dir, "feature-delta")).complete, true)
    await runOpenSpec(dir, ["validate", "feature-delta", "--strict"])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("OpenSpec bridge rejects feature skip_specs and malformed deltas", async () => {
  const dir = await freshProject()
  try {
    await newChange(dir, "bad-delta", "错误能力", "验证门禁")
    const state = { workflowId: "bad-delta", workflowType: "add-feature" }
    await assert.rejects(openSpecAction({ projectRoot: dir, artifact: "specs", state, skipSpecs: true }), /refactor-system/)
    await assert.rejects(openSpecAction({ projectRoot: dir, artifact: "specs", state,
      capability: "bad", content: "## ADDED Requirements\n没有场景" }), /Scenario/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("openspec-plan compiles a structured plan and binds the approved slice graph to workflow state", async () => {
  const dir = await freshProject()
  const context = { sessionID: "structured-plan", directory: dir, worktree: dir, abort: new AbortController().signal, metadata() {}, async ask() {} }
  try {
    await dddLifecycleTool.execute({ action: "init", workflow_type: "add-feature", workflow_id: "structured-plan",
      input: { title: "结构化计划", request: "新增用户查询当天访问轨迹功能" } }, context)
    const root = path.join(dir, "openspec", "changes", "structured-plan", "ddd")
    const stateFile = path.join(root, ".ddd", "workflow-state.json")
    const state = JSON.parse(await readFile(stateFile, "utf8"))
    state.checkpoints.push({ checkpointId: 2, stage: "07-model-review", milestone: "IV", summary: longSummary,
      status: "approved", review: { decision: "approve", reviewer: "tester", reviewedAt: new Date().toISOString(), feedback: "" },
      reviewChecklist: [], adviceRequired: false, document: "milestoneIV", completedAt: new Date().toISOString() })
    state.currentStage = "07-model-review"
    await writeFile(stateFile, JSON.stringify(state), "utf8")

    const prepared = JSON.parse(await dddLifecycleTool.execute({ action: "prepare", input: {} }, context))
    assert.equal(prepared.stageCard.stageId, "08-roadmap")
    assert.equal((await loadState(root)).preparedStage.stage, "08-roadmap")
    const result = JSON.parse(await dddLifecycleTool.execute({ action: "openspec-plan", plan: validStructuredPlan }, context))
    assert.equal(result.status, "ready")
    assert.equal(result.plannedSlices, 1)
    assert.deepEqual(result.sliceIds, ["S1"])
    const stored = JSON.parse(await readFile(stateFile, "utf8"))
    assert.deepEqual(stored.deliveryPlan.dependencies, { S1: [] })
    assert.equal((await planningArtifacts(dir, "structured-plan")).complete, true)
    const roadmap = JSON.parse(await readFile(path.join(root, ".ddd", "delivery", "roadmap.json"), "utf8"))
    assert.equal(roadmap.slices[0].id, "S1")
    const storedPlan = JSON.parse(await readFile(path.join(root, ".ddd", "delivery", "plan.json"), "utf8"))
    assert.equal(storedPlan.objective, validStructuredPlan.objective)
    const duplicate = JSON.parse(await dddLifecycleTool.execute({
      action: "openspec-plan", plan: { title: "破坏既有计划" },
    }, context))
    assert.equal(duplicate.status, "ready")
    assert.equal(duplicate.alreadyCompiled, true)
    assert.equal(duplicate.immutable, true)
    assert.equal(duplicate.plannedSlices, 1)
    const preserved = JSON.parse(await readFile(path.join(root, ".ddd", "delivery", "roadmap.json"), "utf8"))
    assert.deepEqual(preserved.slices.map((slice) => slice.id), ["S1"])
    const milestone = JSON.parse(await dddLifecycleTool.execute({ action: "complete-stage", input: {} }, context))
    assert.equal(milestone.humanReviewRequired, true, JSON.stringify(milestone, null, 2))
    assert.equal(milestone.milestoneRoman, "V")
    assert.equal((await loadState(root)).preparedStage, undefined)
    const milestoneText = await readFile(path.join(root, "V-delivery-plan.md"), "utf8")
    assert.match(milestoneText, /运行时从已校验的结构化计划和批准模型合同确定性编译/u)
    await runOpenSpec(dir, ["validate", "structured-plan", "--strict"])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("refactor openspec-plan reaches milestone V from the typed two-slice migration plan", async () => {
  const dir = await freshProject()
  const context = { sessionID: "refactor-plan-regression", directory: dir, worktree: dir, abort: new AbortController().signal, metadata() {}, async ask() {} }
  try {
    await dddLifecycleTool.execute({ action: "init", workflow_type: "refactor-system", workflow_id: "legacy-shop-access-records-refactor",
      input: { title: "遗留店铺访问记录重构", request: "保持全部公开行为，将店铺访问记录逐步迁入批准的 DDD 模型" } }, context)
    const root = path.join(dir, "openspec", "changes", "legacy-shop-access-records-refactor", "ddd")
    const stateFile = path.join(root, ".ddd", "workflow-state.json")
    const state = JSON.parse(await readFile(stateFile, "utf8"))
    state.checkpoints.push({ checkpointId: 4, stage: "06-pilot-tactical-design", milestone: "IV", summary: longSummary,
      status: "approved", review: { decision: "approve", reviewer: "tester", reviewedAt: new Date().toISOString(), feedback: "" },
      reviewChecklist: [], adviceRequired: false, document: "milestoneIV", completedAt: new Date().toISOString() })
    state.currentStage = "06-pilot-tactical-design"
    await writeFile(stateFile, JSON.stringify(state), "utf8")

    const prepared = JSON.parse(await dddLifecycleTool.execute({ action: "prepare", input: {} }, context))
    assert.equal(prepared.stageCard.stageId, "07-migration-roadmap")
    const result = JSON.parse(await dddLifecycleTool.execute({ action: "openspec-plan", plan: refactorRoadmapRegressionPlan }, context))
    assert.equal(result.status, "ready", JSON.stringify(result, null, 2))
    assert.equal(result.plannedSlices, 2)
    const milestone = JSON.parse(await dddLifecycleTool.execute({ action: "complete-stage", input: {} }, context))
    assert.equal(milestone.humanReviewRequired, true, JSON.stringify(milestone, null, 2))
    assert.equal(milestone.milestoneRoman, "V")
    assert.ok(!(milestone.findings ?? []).some((finding) => finding.code === "REQUIRED_CONTENT_MISSING"), JSON.stringify(milestone, null, 2))
    const milestoneText = await readFile(path.join(root, "V-delivery-plan.md"), "utf8")
    assert.match(milestoneText, /迁移纵向切片/u)
    assert.match(milestoneText, /行为保护与回滚/u)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("openspec-plan rejects interfaces and infrastructure absent from approved tactical design", async () => {
  const dir = await freshProject()
  const context = { sessionID: "plan-traceability", directory: dir, worktree: dir, abort: new AbortController().signal, metadata() {}, async ask() {} }
  try {
    await dddLifecycleTool.execute({ action: "init", workflow_type: "add-feature", workflow_id: "plan-traceability",
      input: { title: "计划追踪", request: "新增用户查询当天访问轨迹功能" } }, context)
    const root = path.join(dir, "openspec", "changes", "plan-traceability", "ddd")
    const stateFile = path.join(root, ".ddd", "workflow-state.json")
    const state = JSON.parse(await readFile(stateFile, "utf8"))
    state.checkpoints.push({ checkpointId: 2, stage: "07-model-review", milestone: "IV", summary: longSummary,
      status: "approved", review: { decision: "approve", reviewer: "tester", reviewedAt: new Date().toISOString(), feedback: "" },
      reviewChecklist: [], adviceRequired: false, document: "milestoneIV", completedAt: new Date().toISOString() })
    state.currentStage = "07-model-review"
    await writeFile(stateFile, JSON.stringify(state), "utf8")
    await writeFile(path.join(root, "IV-tactical-design.md"), "# 战术设计\n\n批准接口：GET /trail/daily?date={date}\n", "utf8")
    const invalidPlan = structuredClone(validStructuredPlan)
    invalidPlan.slices[0].verification = ["mvn flyway:migrate", "curl -X POST /shop-visit"]
    const result = JSON.parse(await dddLifecycleTool.execute({ action: "openspec-plan", plan: invalidPlan }, context))
    const codes = new Set(result.findings.map((finding) => finding.code))
    assert.ok(codes.has("PLAN_UNAPPROVED_INTERFACE"), JSON.stringify(result, null, 2))
    assert.ok(codes.has("PLAN_UNEVIDENCED_INFRASTRUCTURE"), JSON.stringify(result, null, 2))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("implementation refuses an approved roadmap slice whose dependencies are incomplete", async () => {
  const dir = await freshProject()
  try {
    await initialize({ workflowType: "add-feature", workflowId: "slice-deps", projectRoot: dir, title: "t", request: "新增轨迹查询" })
    const stateFile = path.join(dir, "openspec", "changes", "slice-deps", "ddd", ".ddd", "workflow-state.json")
    const state = JSON.parse(await readFile(stateFile, "utf8"))
    state.checkpoints.push({ checkpointId: 2, stage: "08-roadmap", milestone: "V", summary: longSummary,
      status: "approved", review: { decision: "approve", reviewer: "tester", reviewedAt: new Date().toISOString(), feedback: "" },
      reviewChecklist: [], adviceRequired: false, document: "milestoneV", completedAt: new Date().toISOString(), plannedSlices: 2 })
    state.currentStage = "08-roadmap"
    state.deliveryPlan = { source: "structured-openspec-plan", sliceIds: ["S1", "S2"], dependencies: { S1: [], S2: ["S1"] }, completedSliceIds: [] }
    await writeFile(stateFile, JSON.stringify(state), "utf8")
    const result = await submit({ workflowType: "add-feature", workflowId: "slice-deps", projectRoot: dir,
      stage: "09-implementation", sliceId: "S2", summary: longSummary,
      sections: { "已交付范围": "实际代码增量、设计一致性证据、架构一致性证据、测试覆盖与必需层级证据、E2E 真实链路证据、验证结果、Commit SHA、兼容性与回滚。" } })
    assert.ok(result.findings.some((finding) => finding.code === "SLICE_DEPENDENCY_NOT_READY"))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("OpenSpec archive uses the bundled 1.7 CLI and is idempotent", async () => {
  const dir = await freshProject()
  try {
    await newChange(dir, "archive-me", "归档能力", "验证归档兼容")
    const state = { workflowId: "archive-me", workflowType: "add-feature" }
    await openSpecAction({ projectRoot: dir, artifact: "proposal", state,
      content: "## Why\n需要归档。\n\n## What Changes\n- 新增能力。\n\n## Capabilities\n\n### New Capabilities\n- `archive-capability`: 归档能力。\n\n### Modified Capabilities\n\n## Impact\n无。" })
    await openSpecAction({ projectRoot: dir, artifact: "specs", state, capability: "archive-capability",
      content: "## Purpose\n提供一个用于验证 OpenSpec 归档兼容性的可观察能力，并确保正式 spec 能被正确更新。\n\n## ADDED Requirements\n\n### Requirement: 可归档\n系统 SHALL 归档已完成变更。\n\n#### Scenario: 完成归档\n- **WHEN** 严格校验通过\n- **THEN** change 被移入 archive" })
    await openSpecAction({ projectRoot: dir, artifact: "design", state,
      content: "## Context\n归档测试。\n\n## Goals / Non-Goals\n验证兼容。\n\n## Decisions\n使用捆绑 CLI。\n\n## Risks / Trade-offs\n无。" })
    await openSpecAction({ projectRoot: dir, artifact: "tasks", state,
      content: "## 1. Archive\n\n- [x] 1.1 完成归档准备" })
    assert.equal((await verifyArchive(dir, "archive-me")).archived, true)
    assert.equal((await verifyArchive(dir, "archive-me")).archived, true)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("workflow archive saves completed state only inside the archived change", async () => {
  const dir = await freshProject()
  try {
    await initialize({ workflowType: "add-feature", workflowId: "state-archive", projectRoot: dir, title: "归档状态", request: "验证归档后不重建活动 change" })
    const active = path.join(dir, "openspec", "changes", "state-archive")
    const stateFile = path.join(active, "ddd", ".ddd", "workflow-state.json")
    const state = JSON.parse(await readFile(stateFile, "utf8"))
    state.status = "awaiting_archive"
    state.currentStage = "10-final-review"
    await writeFile(stateFile, JSON.stringify(state), "utf8")
    const artifactState = { workflowId: "state-archive", workflowType: "add-feature" }
    await openSpecAction({ projectRoot: dir, artifact: "proposal", state: artifactState,
      content: "## Why\n验证状态。\n\n## What Changes\n- 新增能力。\n\n## Capabilities\n\n### New Capabilities\n- `state-archive`: 状态归档。\n\n### Modified Capabilities\n\n## Impact\n无。" })
    await openSpecAction({ projectRoot: dir, artifact: "specs", state: artifactState, capability: "state-archive",
      content: "## Purpose\n验证 DDD 工作流归档完成后，状态文件只存在于归档 change 中而不会重建活动目录。\n\n## ADDED Requirements\n\n### Requirement: 状态随 change 归档\n系统 SHALL 将完成状态保存在归档 change。\n\n#### Scenario: 归档成功\n- **WHEN** change 归档\n- **THEN** 活动目录不存在" })
    await openSpecAction({ projectRoot: dir, artifact: "design", state: artifactState,
      content: "## Context\n状态归档。\n\n## Goals / Non-Goals\n避免幽灵目录。\n\n## Decisions\n归档路径写状态。\n\n## Risks / Trade-offs\n无。" })
    await openSpecAction({ projectRoot: dir, artifact: "tasks", state: artifactState,
      content: "## 1. State\n\n- [x] 1.1 验证归档状态" })
    const result = await archive({ workflowType: "add-feature", workflowId: "state-archive", projectRoot: dir })
    assert.equal(result.workflowStatus, "complete")
    assert.equal(await import("node:fs/promises").then(({ stat }) => stat(active).then(() => true).catch(() => false)), false)
    const archivedState = JSON.parse(await readFile(path.join(result.archiveResult.target, "ddd", ".ddd", "workflow-state.json"), "utf8"))
    assert.equal(archivedState.status, "complete")
    assert.match(archivedState.artifactRoot.replace(/\\/gu, "/"), /changes\/archive\/\d{4}-\d{2}-\d{2}-state-archive\/ddd$/u)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

function baselinePayload(overrides = {}) {
  const fact = overrides.fact ?? "当前系统的既有业务入口已通过测试验证。"
  const constraint = overrides.constraint ?? "既有业务入口的可观察行为必须保持兼容。"
  const sections = overrides.sections ?? {
    "输入场景与现状事实": `${fact}\n\n事实、假设与待确认项已经分开记录；可执行验收约束只保护已有行为。`,
    "证据与追踪": `${constraint}\n\n现状代码证据索引与验证基线已经建立；OpenSpec历史战略基线当前为空。`,
  }
  return {
    sections,
    claims: [
      {
        id: "FACT-001", kind: "current-behavior-fact", statement: fact, maturity: "fact",
        documentSection: "输入场景与现状事实", authorityRefs: ["test:baseline"], evidenceRefs: ["test:baseline"],
        attributes: { observationLevel: "test-verified", availability: "operational", evidenceSubject: "既有业务入口" },
      },
      {
        id: "COMPAT-001", kind: "compatibility-constraint", statement: constraint, maturity: "fact",
        documentSection: "证据与追踪", authorityRefs: ["test:baseline"], evidenceRefs: ["test:baseline"], attributes: {},
      },
    ],
  }
}

async function completeMilestoneI(dir, workflowId) {
  await submit({
    workflowType: "add-feature", workflowId, projectRoot: dir,
    stage: "01-current-evidence", summary: longSummary,
    ...baselinePayload(),
  })
  const p = await prepare({ workflowType: "add-feature", workflowId, projectRoot: dir, stage: "02-big-picture-event-storm" })
  assert.deepEqual(p.stageCard.skills, ["ddd-scope", "ddd-discover"])
  const requiredConcepts = p.stageCard.qualityContract.requiredContent.join("、")
  const sections = Object.fromEntries(p.stageCard.unfilledSectionHeadings.map((heading) => [heading,
    `### ${heading}结论\n围绕用户目标梳理业务参与者、命令、已经发生的业务事件、规则、异常、补偿、时间约束、读模型和边界线索。本次目标与未来候选明确分离，未决问题不会进入主流程。阶段概念覆盖：${requiredConcepts}。`]))
  if (p.stageCard.ambiguityContract) {
    sections["战略事件风暴"] += "\n\n候选场景 A：参与者发起业务动作后形成候选业务事件。\n候选场景 B：外部业务事实到达后形成另一条候选事件流。\n人工确认前，任何候选均不进入本次目标或主流程。"
  }
  return submit({
    workflowType: "add-feature", workflowId, projectRoot: dir,
    stage: "02-big-picture-event-storm", summary: longSummary, sections,
    ...(p.stageCard.ambiguityContract ? { ambiguityResolution: {
      status: "unresolved",
      candidates: [{ id: "candidate-a", label: "参与者主动发起" }, { id: "candidate-b", label: "外部事实触发" }],
      affectedDecisions: ["触发条件", "业务结果", "异常与规则"],
    } } : {}),
  })
}

test("init creates state and milestone skeletons", async () => {
  const dir = await freshProject()
  try {
    const t = await initialize({
      workflowType: "add-feature", workflowId: "test-feat-1",
      projectRoot: dir, title: "测试功能", request: "为现有系统新增测试功能",
    })
    assert.equal(t.workflowId, "test-feat-1")
    assert.equal(t.requiredAction, "continue")
    assert.equal(t.nextStage, "01-current-evidence")
    const stateFile = path.join(dir, "openspec", "changes", "test-feat-1", "ddd", ".ddd", "workflow-state.json")
    const state = JSON.parse(await readFile(stateFile, "utf8"))
    assert.equal(state.workflowType, "add-feature")
    assert.equal(state.status, "active")
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("init rejects duplicate workflow", async () => {
  const dir = await freshProject()
  try {
    await initialize({ workflowType: "add-feature", workflowId: "dup", projectRoot: dir, title: "t", request: "r" })
    await assert.rejects(
      initialize({ workflowType: "add-feature", workflowId: "dup", projectRoot: dir, title: "t", request: "r" }),
      /already exists/,
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("prepare returns a stage card for the next stage", async () => {
  const dir = await freshProject()
  try {
    await initialize({ workflowType: "add-feature", workflowId: "p1", projectRoot: dir, title: "t", request: "r" })
    const p = await prepare({ workflowType: "add-feature", workflowId: "p1", projectRoot: dir })
    assert.equal(p.stageCard.stageId, "01-current-evidence")
    assert.ok(p.stageCard.checklist.length > 0)
    assert.equal(p.stageCard.humanGate, false)
    assert.deepEqual(p.stageCard.skills, ["ddd-evidence-recovery"])
    assert.ok(p.stageCard.allowedSectionHeadings.includes("输入场景与现状事实"))
    assert.ok(!p.stageCard.allowedSectionHeadings.includes("一页结论"))
    assert.deepEqual(p.stageCard.unfilledSectionHeadings.sort(), ["证据与追踪", "输入场景与现状事实"].sort())
    assert.ok(!p.stageCard.allowedSectionHeadings.includes("事实、假设与待确认项"))
    assert.equal(p.stageCard.claimContract.required, true)
    assert.ok(p.stageCard.claimContract.allowedKinds.includes("current-behavior-fact"))
    const persisted = await loadState(path.join(dir, "openspec", "changes", "p1", "ddd"))
    assert.equal(persisted.currentStage, "01-current-evidence")
    assert.equal(persisted.preparedStage.stage, "01-current-evidence")
    const transition = await status({ workflowType: "add-feature", workflowId: "p1", projectRoot: dir })
    assert.equal(transition.nextStage, "01-current-evidence")
    assert.deepEqual(transition.allowedNextStages, ["01-current-evidence"])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("prepare projects approved prior-milestone summaries into a fresh stage card", async () => {
  const dir = await freshProject()
  try {
    await initialize({ workflowType: "add-feature", workflowId: "upstream", projectRoot: dir, title: "t", request: "新增访问轨迹" })
    await completeMilestoneI(dir, "upstream")
    await review({ workflowType: "add-feature", workflowId: "upstream", projectRoot: dir,
      stage: "02-big-picture-event-storm", decision: "approve", reviewer: "tester",
      resolution: { selectedCandidateId: "candidate-a" } })
    const prepared = await prepare({ workflowType: "add-feature", workflowId: "upstream", projectRoot: dir,
      stage: "03-strategic-impact" })
    assert.ok(prepared.stageCard.upstreamSummary.some((item) => item.startsWith("[02-big-picture-event-storm]")))
    assert.ok(!prepared.stageCard.upstreamSummary.some((item) => item.startsWith("[01-current-evidence]")))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("evidence stage requires typed claims and does not advance state on rejection", async () => {
  const dir = await freshProject()
  try {
    await initialize({ workflowType: "add-feature", workflowId: "claims-required", projectRoot: dir, title: "t", request: "新增访问轨迹" })
    const r = await submit({ workflowType: "add-feature", workflowId: "claims-required", projectRoot: dir,
      stage: "01-current-evidence", summary: longSummary,
      sections: baselinePayload().sections })
    assert.ok(r.findings.some((f) => f.code === "STAGE_CLAIMS_REQUIRED" && f.severity === "blocking"))
    assert.equal(r.lastCompletedStage, "00-request")
    const state = await status({ workflowType: "add-feature", workflowId: "claims-required", projectRoot: dir })
    assert.equal(state.nextStage, "01-current-evidence")
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("evidence stage blocks target persistence, read-only and rollback decisions hidden in prose", async () => {
  const dir = await freshProject()
  try {
    await initialize({ workflowType: "add-feature", workflowId: "evidence-leak", projectRoot: dir, title: "t", request: "新增访问轨迹" })
    const payload = baselinePayload()
    payload.sections["输入场景与现状事实"] += "\n\n新增能力须在不改动既有表结构前提下实现为只读查询。"
    payload.sections["证据与追踪"] += "\n\n回滚即移除新入口，对既有写入无副作用。"
    const r = await submit({ workflowType: "add-feature", workflowId: "evidence-leak", projectRoot: dir,
      stage: "01-current-evidence", summary: longSummary, ...payload })
    assert.ok(r.findings.some((f) => f.code === "EVIDENCE_STAGE_TARGET_DESIGN_LEAK" && f.severity === "blocking"))
    assert.equal(r.lastCompletedStage, "00-request")
    const doc = await readFile(path.join(dir, "openspec", "changes", "evidence-leak", "ddd", "I-strategic-eventstorm.md"), "utf8").catch(() => "")
    assert.ok(!doc.includes("回滚即移除新入口"))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("evidence stage blocks unapproved future acceptance behavior disguised as a baseline", async () => {
  const dir = await freshProject()
  try {
    await initialize({ workflowType: "add-feature", workflowId: "future-behavior", projectRoot: dir, title: "t", request: "新增用户轨迹" })
    const base = baselinePayload()
    base.sections["证据与追踪"] += "\n\nGiven 用户未登录，When 尝试记录轨迹，Then 应返回 401。\nGiven 用户已登录，When 光顾店铺，Then 轨迹中应包含该店铺。"
    const result = await submit({ workflowType: "add-feature", workflowId: "future-behavior", projectRoot: dir,
      stage: "01-current-evidence", summary: longSummary, ...base })
    assert.ok(result.findings.some((finding) => finding.code === "EVIDENCE_STAGE_TARGET_BEHAVIOR_LEAK"))
    assert.equal(result.lastCompletedStage, "00-request")
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("evidence stage rejects constraints on hypothetical new tables and Redis keys", async () => {
  const dir = await freshProject()
  try {
    await initialize({ workflowType: "add-feature", workflowId: "future-negative-design", projectRoot: dir, title: "t", request: "新增轨迹" })
    const payload = baselinePayload({ sections: {
      "输入场景与现状事实": "当前系统行为仍按现状运行。事实、假设与待确认项已分开；可执行验收约束只保护已有行为。",
      "证据与追踪": "新增表不得修改既有用户表；Redis 缓存 key 命名须避免与现有空间冲突。OpenSpec历史战略基线为空。",
    } })
    const result = await submit({ workflowType: "add-feature", workflowId: "future-negative-design", projectRoot: dir,
      stage: "01-current-evidence", summary: longSummary, ...payload })
    assert.ok(result.findings.some((finding) => finding.code === "EVIDENCE_STAGE_TARGET_DESIGN_LEAK"))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("evidence stage rejects technical quality decisions for the future feature", async () => {
  const dir = await freshProject()
  try {
    await initialize({ workflowType: "add-feature", workflowId: "future-quality-design", projectRoot: dir, title: "t", request: "新增轨迹" })
    const payload = baselinePayload({ sections: {
      "输入场景与现状事实": "当前系统行为仍按现状运行。事实、假设与待确认项已分开；可执行验收约束只保护已有行为。",
      "证据与追踪": "轨迹记录写入应为异步或低延迟；新功能需与现有 Redis 缓存体系保持一致。OpenSpec历史战略基线为空。",
    } })
    const result = await submit({ workflowType: "add-feature", workflowId: "future-quality-design", projectRoot: dir,
      stage: "01-current-evidence", summary: longSummary, ...payload })
    assert.ok(result.findings.some((finding) => finding.code === "EVIDENCE_STAGE_TARGET_DESIGN_LEAK"))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("evidence stage rejects model-invented negative search references", async () => {
  const dir = await freshProject()
  try {
    await initialize({ workflowType: "add-feature", workflowId: "invented-search", projectRoot: dir, title: "t", request: "新增轨迹" })
    const statement = "当前代码库只有四类实体，其他业务模块不存在。"
    const payload = baselinePayload()
    payload.sections["证据与追踪"] += `\n${statement}`
    payload.claims.push({
      id: "OPEN-INVENTED", kind: "evidence-gap", statement, maturity: "hypothesis",
      documentSection: "证据与追踪", authorityRefs: ["search:src/main/java"], evidenceRefs: ["search:src/main/java"],
      attributes: { observationLevel: "statically-reachable", availability: "absent", evidenceSubject: statement },
    })
    const result = await submit({ workflowType: "add-feature", workflowId: "invented-search", projectRoot: dir,
      stage: "01-current-evidence", summary: longSummary, ...payload })
    assert.ok(result.findings.some((finding) => finding.code === "SEARCH_EVIDENCE_NOT_ISSUED"))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("evidence stage permits a design-looking sentence when it is an explicit evidence gap", async () => {
  const dir = await freshProject()
  try {
    await initialize({ workflowType: "add-feature", workflowId: "declared-gap", projectRoot: dir, title: "t", request: "新增访问轨迹" })
    const payload = baselinePayload()
    const statement = "shop 表精确 schema 与索引尚未读取，记录表设计的字段类型待战术设计阶段补证。"
    payload.sections["证据与追踪"] += `\n\n${statement}`
    payload.claims.push({
      id: "OPEN-001", kind: "evidence-gap", statement, maturity: "hypothesis",
      documentSection: "证据与追踪", authorityRefs: ["user-input:original-request"], evidenceRefs: [], attributes: {},
    })
    const r = await submit({ workflowType: "add-feature", workflowId: "declared-gap", projectRoot: dir,
      stage: "01-current-evidence", summary: longSummary, ...payload })
    assert.equal(r.lastCompletedStage, "01-current-evidence")
    assert.ok(!r.findings?.some((f) => f.code === "EVIDENCE_STAGE_TARGET_DESIGN_LEAK"))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("evidence scope does not confuse a business empty-list outcome with a database table decision", async () => {
  const dir = await freshProject()
  try {
    await initialize({ workflowType: "add-feature", workflowId: "empty-list", projectRoot: dir, title: "t", request: "当天无记录返回空列表" })
    const payload = baselinePayload()
    payload.sections["证据与追踪"] += "\n\n新增轨迹查询应能在当天无记录时返回空列表且不报错。"
    const r = await submit({ workflowType: "add-feature", workflowId: "empty-list", projectRoot: dir,
      stage: "01-current-evidence", summary: longSummary, ...payload })
    assert.ok(!r.findings?.some((f) => f.code === "EVIDENCE_STAGE_TARGET_DESIGN_LEAK"))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("evidence gap cannot smuggle a target persistence decision", async () => {
  const dir = await freshProject()
  try {
    await initialize({ workflowType: "add-feature", workflowId: "gap-design", projectRoot: dir, title: "t", request: "新增访问轨迹" })
    const payload = baselinePayload()
    const statement = "证据包未出现轨迹能力，因此该能力需新增持久化模型。"
    payload.sections["证据与追踪"] += `\n\n${statement}`
    payload.claims.push({ id: "OPEN-DESIGN", kind: "evidence-gap", statement, maturity: "hypothesis",
      documentSection: "证据与追踪", authorityRefs: ["user-input:original-request"], evidenceRefs: [], attributes: {} })
    const r = await submit({ workflowType: "add-feature", workflowId: "gap-design", projectRoot: dir,
      stage: "01-current-evidence", summary: longSummary, ...payload })
    assert.ok(r.findings.some((f) => f.code === "EVIDENCE_STAGE_TARGET_DESIGN_LEAK"))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("evidence stage scope checks ignore whitespace inserted inside Chinese tool arguments", async () => {
  const dir = await freshProject()
  try {
    await initialize({ workflowType: "add-feature", workflowId: "evidence-leak-spaces", projectRoot: dir, title: "t", request: "新增访问轨迹" })
    const payload = baselinePayload()
    payload.sections["输入场景与现状事实"] += "\n\n候选方案决定不 改表 结构，并采用只 读查询。"
    payload.sections["证据与追踪"] += "\n\n回滚 即移除新入口。"
    const r = await submit({ workflowType: "add-feature", workflowId: "evidence-leak-spaces", projectRoot: dir,
      stage: "01-current-evidence", summary: longSummary, ...payload })
    assert.ok(r.findings.some((f) => f.code === "EVIDENCE_STAGE_TARGET_DESIGN_LEAK" && f.severity === "blocking"))
    assert.equal(r.lastCompletedStage, "00-request")
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("evidence stage rejects downstream claim kinds and unproven absence claims", async () => {
  const dir = await freshProject()
  try {
    await initialize({ workflowType: "add-feature", workflowId: "claim-kinds", projectRoot: dir, title: "t", request: "新增访问轨迹" })
    const payload = baselinePayload()
    const absent = "当前系统不存在任何访问轨迹能力。"
    payload.sections["输入场景与现状事实"] += `\n\n${absent}`
    payload.sections["证据与追踪"] += "\n\n回滚方案为移除新入口。"
    payload.claims.push({
      id: "ABSENT-001", kind: "current-behavior-fact", statement: absent, maturity: "fact",
      documentSection: "输入场景与现状事实", authorityRefs: ["code:src"], evidenceRefs: ["runtime:assumption"],
      attributes: { observationLevel: "declared", availability: "unknown", evidenceSubject: "访问轨迹能力" },
    })
    payload.claims.push({
      id: "ROLLBACK-001", kind: "rollback-plan", statement: "回滚方案为移除新入口。", maturity: "proposed",
      documentSection: "证据与追踪", authorityRefs: ["user-input:original-request"], evidenceRefs: [], attributes: {},
    })
    const r = await submit({ workflowType: "add-feature", workflowId: "claim-kinds", projectRoot: dir,
      stage: "01-current-evidence", summary: longSummary, ...payload })
    assert.ok(r.findings.some((f) => f.code === "CLAIM_KIND_OUT_OF_STAGE"))
    assert.ok(r.findings.some((f) => f.code === "CLAIM_MATURITY_OUT_OF_STAGE"))
    assert.ok(r.findings.some((f) => f.code === "ABSENCE_CLAIM_NOT_PROVEN"))
    assert.equal(r.lastCompletedStage, "00-request")
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("submit blocks headings outside the milestone template and nested level-two headings", async () => {
  const dir = await freshProject()
  try {
    await initialize({ workflowType: "add-feature", workflowId: "headings", projectRoot: dir, title: "t", request: "r" })
    const r = await submit({
      workflowType: "add-feature", workflowId: "headings", projectRoot: dir,
      stage: "01-current-evidence", summary: longSummary,
      sections: {
        "事实、假设与待确认项": "不应作为二级标题",
        "输入场景与现状事实": "## 输入场景与现状事实\n### 事实\n正文",
      },
    })
    assert.ok(r.findings.some((f) => f.code === "SECTION_HEADING_NOT_IN_TEMPLATE" && f.severity === "blocking"))
    assert.ok(r.findings.some((f) => f.code === "NESTED_LEVEL_TWO_HEADING" && f.severity === "blocking"))
    assert.equal(r.lastCompletedStage, "00-request")
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("submit blocks a stage that is not allowed by the transition", async () => {
  const dir = await freshProject()
  try {
    await initialize({ workflowType: "add-feature", workflowId: "order", projectRoot: dir, title: "t", request: "r" })
    const r = await submit({ workflowType: "add-feature", workflowId: "order", projectRoot: dir,
      stage: "02-big-picture-event-storm", summary: longSummary,
      sections: { "战略事件风暴": "用户提交请求后业务受理并形成结果。" } })
    assert.ok(r.findings.some((f) => f.code === "STAGE_NOT_ALLOWED" && f.severity === "blocking"))
    assert.equal(r.draft.saved, false)
    assert.equal(r.draft.retryableByModel, false)
    assert.equal(r.draft.mustStop, true)
    await assert.rejects(
      readFile(path.join(dir, "openspec", "changes", "order", "ddd", ".ddd", "workbench", "02-big-picture-event-storm.draft.json"), "utf8"),
      { code: "ENOENT" },
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("orchestrator blocks a stage from writing another stage's milestone sections", async () => {
  const dir = await freshProject()
  try {
    await initialize({ workflowType: "add-feature", workflowId: "ownership", projectRoot: dir, title: "t", request: "新增访问轨迹" })
    const r = await submit({ workflowType: "add-feature", workflowId: "ownership", projectRoot: dir,
      stage: "01-current-evidence", summary: longSummary,
      sections: {
        "一页结论": "证据阶段不应写入这个战略事件风暴概览。",
        "输入场景与现状事实": "当前行为和兼容性约束已经核验。",
        "证据与追踪": "当前代码与测试形成直接证据。",
      } })
    assert.ok(r.findings.some((f) => f.code === "SECTION_HEADING_NOT_IN_TEMPLATE" && f.severity === "blocking"))
    const doc = await readFile(path.join(dir, "openspec", "changes", "ownership", "ddd", "I-strategic-eventstorm.md"), "utf8").catch(() => "")
    assert.ok(!doc.includes("证据阶段不应写入"))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("strategic event storm blocks technical design leakage", async () => {
  const dir = await freshProject()
  try {
    await initialize({ workflowType: "add-feature", workflowId: "scope", projectRoot: dir, title: "t", request: "新增访问轨迹" })
    await submit({ workflowType: "add-feature", workflowId: "scope", projectRoot: dir,
      stage: "01-current-evidence", summary: longSummary, ...baselinePayload() })
    const r = await submit({ workflowType: "add-feature", workflowId: "scope", projectRoot: dir,
      stage: "02-big-picture-event-storm", summary: longSummary,
      sections: { "战略事件风暴": "用户发起查看后，使用 Redis 保存结果并设计 API 接口路径。" } })
    assert.ok(r.findings.some((f) => f.code === "STRATEGIC_EVENTSTORM_TECHNICAL_LEAK" && f.severity === "blocking"))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("capability-only requests require human choice between candidate event flows", () => {
  assert.equal(requiresScenarioClarification("新增用户一日光顾店铺轨迹功能"), true)
  assert.equal(requiresScenarioClarification("在当前项目新增用户一日光顾店铺轨迹功能"), true)
  assert.equal(requiresScenarioClarification("新增用户轨迹查询功能"), true)
  assert.equal(requiresScenarioClarification("当用户成功查看店铺详情后记录一次访问，并支持查询当天记录"), false)
  const state = { originalRequest: "新增用户一日光顾店铺轨迹功能" }
  const stage = { id: "02-big-picture-event-storm", scopeContract: { id: "system-discovery" } }
  const premature = validateStageSemantics(state, stage, {
    stage: stage.id,
    summary: "选择查看店铺详情作为唯一触发路径。",
    sections: {
      "一页结论": "用户查看店铺详情后自动记录光顾。",
      "战略事件风暴": "用户 → 查看店铺详情 → 光顾已记录。",
    },
  })
  assert.ok(premature.some((finding) => finding.code === "AMBIGUOUS_SCENARIO_PREMATURE_COMMITMENT"))

  const candidates = validateStageSemantics(state, stage, {
    stage: stage.id,
    summary: "并列呈现两套待选择的业务解释。",
    sections: {
      "一页结论": "触发与结果尚待人工确认。",
      "战略事件风暴": "候选场景 A：用户实际到店 → 光顾已发生。\n候选场景 B：用户查看详情 → 浏览已发生。\n人工确认前，候选均不进入本次目标或主流程。",
    },
    ambiguityResolution: {
      status: "unresolved",
      candidates: [{ id: "physical", label: "实际到店" }, { id: "browse", label: "页面浏览" }],
      affectedDecisions: ["光顾触发条件", "用户可见的业务结果", "重复行为与异常规则"],
    },
  })
  assert.ok(!candidates.some((finding) => finding.code === "AMBIGUOUS_SCENARIO_PREMATURE_COMMITMENT"))
})

test("ambiguous discovery registers every human question and cannot pre-commit its answer", () => {
  const findings = validateStageSemantics(
    { originalRequest: "新增用户一日光顾店铺轨迹功能" },
    { id: "02-big-picture-event-storm", scopeContract: { id: "system-discovery" } },
    {
      stage: "02-big-picture-event-storm", summary: "候选仍待人工决定。",
      sections: {
        "本次请您确认": "1. **触发条件**：浏览还是主动标记？\n2. **未登录行为**：记录还是忽略？\n3. **轨迹保留**：仅当日还是历史？",
        "战略事件风暴": "候选A与候选B并列。登录校验规则：仅登录用户被记录，未登录用户忽略。",
      },
      ambiguityResolution: {
        status: "unresolved",
        candidates: [{ id: "a", label: "浏览触发并返回轨迹" }, { id: "b", label: "主动标记并返回轨迹" }],
        affectedDecisions: ["触发条件", "业务结果", "异常与重复规则"],
      },
    },
  )
  const codes = new Set(findings.map((finding) => finding.code))
  assert.ok(codes.has("AMBIGUITY_DECISION_UNREGISTERED"))
  assert.ok(codes.has("AMBIGUITY_UNRESOLVED_DECISION_COMMITTED"))
})

test("ambiguous discovery bounds the human decision set instead of expanding adjacent requirements", () => {
  const findings = validateStageSemantics(
    { originalRequest: "新增用户一日光顾店铺轨迹功能" },
    { id: "02-big-picture-event-storm", scopeContract: { id: "system-discovery" } },
    {
      stage: "02-big-picture-event-storm", summary: "候选仍待人工决定。",
      sections: {
        "本次请您确认": "1. 触发条件：浏览还是标记？\n2. 业务结果：追加还是覆盖？\n3. 匿名访问：是否支持？\n4. 历史保留：保存多久？\n5. 跨时区：按哪个时区？",
        "战略事件风暴": "候选 A 与候选 B 并列，人工批准前不进入唯一主流程。",
      },
      ambiguityResolution: {
        status: "unresolved",
        candidates: [{ id: "a", label: "浏览触发并返回轨迹" }, { id: "b", label: "主动标记并返回轨迹" }],
        affectedDecisions: ["触发条件", "业务结果", "匿名访问规则", "历史保留规则", "跨时区规则"],
      },
    },
  )
  const codes = new Set(findings.map((finding) => finding.code))
  assert.ok(codes.has("AMBIGUOUS_SCENARIO_PREMATURE_COMMITMENT"))
  assert.ok(codes.has("AMBIGUITY_SCOPE_OVEREXPANDED"))
})

test("candidate description labels are not misclassified as additional human decisions", () => {
  const findings = validateStageSemantics(
    { originalRequest: "在当前项目新增用户一日光顾店铺轨迹功能" },
    { id: "02-big-picture-event-storm", scopeContract: { id: "system-discovery" } },
    {
      stage: "02-big-picture-event-storm", summary: "并列展示两套完整候选。",
      sections: {
        "本次请您确认": "### 光顾触发方式待确认\n候选 checkin：主动签到并返回轨迹列表\n候选 auto：自动判定并返回轨迹列表",
        "战略事件风暴": "两套候选事件流并列，人工批准前不进入唯一主流程。",
      },
      ambiguityResolution: {
        status: "unresolved",
        candidates: [{ id: "checkin", label: "主动签到并返回轨迹" }, { id: "auto", label: "自动判定并返回轨迹" }],
        affectedDecisions: ["触发方式：主动签到或自动判定", "用户可见结果：确认提示与轨迹列表"],
      },
    },
  )
  assert.ok(!findings.some((finding) => finding.code === "AMBIGUITY_DECISION_UNREGISTERED"))
})

test("ambiguous discovery rejects unapproved exception and compensation rules in the main flow", () => {
  const findings = validateStageSemantics(
    { originalRequest: "在当前项目新增用户一日光顾店铺轨迹功能" },
    { id: "02-big-picture-event-storm", scopeContract: { id: "system-discovery" } },
    {
      stage: "02-big-picture-event-storm", summary: "并列展示触发候选。",
      sections: {
        "本次请您确认": "候选 checkin：主动签到并返回轨迹\n候选 auto：自动判定并返回轨迹",
        "战略事件风暴": "两套候选事件流并列。",
        "异常、补偿与时间约束": "未登录用户一律拒绝；同日同店重复签到幂等返回；误签到可申请撤销；自然日按用户时区 00:00 划分。",
      },
      ambiguityResolution: {
        status: "unresolved",
        candidates: [{ id: "checkin", label: "主动签到并返回轨迹" }, { id: "auto", label: "自动判定并返回轨迹" }],
        affectedDecisions: ["触发方式：主动签到或自动判定", "用户可见结果：确认提示与轨迹列表"],
      },
    },
  )
  const precommit = findings.find((finding) => finding.code === "AMBIGUITY_RULE_PRECOMMITTED")
  assert.ok(precommit)
  assert.match(precommit.message, /权限|重复|撤销|自然日/u)
})

test("strategic use-case packaging cannot promote rules deferred to tactical event storm", () => {
  const findings = validateStageSemantics(
    { originalRequest: "新增用户一日光顾店铺轨迹功能", humanDecisions: [{
      milestone: "I", stage: "02-big-picture-event-storm", resolvedDecisions: ["主动签到"],
      deferredToTacticalFamilies: ["authorization", "repeat", "compensation"], reviewer: "user", decidedAt: new Date().toISOString(),
    }] },
    { id: "04-service-use-cases", scopeContract: { id: "system-strategy" } },
    {
      stage: "04-service-use-cases", summary: "形成实现单元用例包。",
      sections: { "实现单元用例包": "未登录用户拒绝签到；同日同店重复签到幂等返回；误签到允许申请撤销。" },
    },
  )
  const promoted = findings.find((finding) => finding.code === "STRATEGIC_USE_CASE_DEFERRED_RULE_PROMOTED")
  assert.ok(promoted)
  assert.match(promoted.message, /权限|重复|撤销/u)
})

test("blocking stage draft is saved, repaired incrementally, and fused after repeated identical failures", async () => {
  const dir = await freshProject()
  try {
    await initialize({ workflowType: "add-feature", workflowId: "draft-repair", projectRoot: dir, title: "t", request: "新增明确功能" })
    const first = await submit({ workflowType: "add-feature", workflowId: "draft-repair", projectRoot: dir,
      stage: "01-current-evidence", summary: "太短", ...baselinePayload() })
    assert.equal(first.draft.saved, true)
    assert.equal(first.draft.repairOnly, true)
    assert.equal(first.draft.repeatedFindingSet, 1)

    const repaired = await submit({ workflowType: "add-feature", workflowId: "draft-repair", projectRoot: dir,
      stage: "01-current-evidence", summary: longSummary, sections: {} })
    assert.equal(repaired.findings.filter((finding) => finding.severity === "blocking").length, 0)

    await initialize({ workflowType: "add-feature", workflowId: "draft-fuse", projectRoot: dir, title: "t", request: "新增明确功能" })
    let failed
    for (let attempt = 0; attempt < 3; attempt += 1) {
      failed = await submit({ workflowType: "add-feature", workflowId: "draft-fuse", projectRoot: dir,
        stage: "01-current-evidence", summary: "太短", ...baselinePayload() })
    }
    assert.equal(failed.draft.repeatedFindingSet, 3)
    assert.equal(failed.draft.retryableByModel, false)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("claim-only repair atomically replaces stale claims and maps them into the saved draft", async () => {
  const dir = await freshProject()
  try {
    await initialize({ workflowType: "add-feature", workflowId: "claim-repair", projectRoot: dir,
      title: "t", request: "新增收藏店铺查询" })
    const payload = baselinePayload()
    const stale = structuredClone(payload.claims)
    stale[0].statement = `${stale[0].statement}（旧表述）`
    stale[0].id = "FACT-STALE"
    const failed = await submit({ workflowType: "add-feature", workflowId: "claim-repair", projectRoot: dir,
      stage: "01-current-evidence", summary: longSummary, sections: payload.sections, claims: stale })
    assert.ok(failed.findings.some((finding) => finding.code === "CLAIM_NOT_MAPPED_TO_DOCUMENT"))
    assert.equal(failed.draft.repairContract.replaceObservations, true)
    assert.ok(failed.draft.repairContract.editablePaths.includes("claims[0].statement"))

    const repairedClaims = structuredClone(payload.claims)
    repairedClaims[0].id = "FACT-REPAIRED"
    repairedClaims[0].documentSection = "证据与追踪"
    const repaired = await submit({ workflowType: "add-feature", workflowId: "claim-repair", projectRoot: dir,
      stage: "01-current-evidence", summary: longSummary, sections: {}, claims: repairedClaims,
      replaceClaims: true })
    assert.equal(repaired.findings.filter((finding) => finding.severity === "blocking").length, 0)
    assert.equal(repaired.lastCompletedStage, "01-current-evidence")
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("invalid headings are not retained in the repair workbench", async () => {
  const dir = await freshProject()
  try {
    await initialize({ workflowType: "add-feature", workflowId: "draft-heading", projectRoot: dir, title: "t", request: "新增明确功能" })
    const payload = baselinePayload()
    const first = await submit({ workflowType: "add-feature", workflowId: "draft-heading", projectRoot: dir,
      stage: "01-current-evidence", summary: longSummary,
      sections: { ...payload.sections, "意外拆分标题": "不应进入下一次候选稿。" }, claims: payload.claims })
    assert.ok(first.findings.some((finding) => finding.code === "SECTION_HEADING_NOT_IN_TEMPLATE"))
    const repaired = await submit({ workflowType: "add-feature", workflowId: "draft-heading", projectRoot: dir,
      stage: "01-current-evidence", summary: longSummary, sections: {} })
    assert.equal(repaired.findings.filter((finding) => finding.severity === "blocking").length, 0)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("strategic event storm rejects query completion presented as a domain event", async () => {
  const dir = await freshProject()
  try {
    await initialize({ workflowType: "add-feature", workflowId: "query-event", projectRoot: dir, title: "t", request: "新增访问轨迹查询" })
    await submit({ workflowType: "add-feature", workflowId: "query-event", projectRoot: dir,
      stage: "01-current-evidence", summary: longSummary, ...baselinePayload() })
    const r = await submit({ workflowType: "add-feature", workflowId: "query-event", projectRoot: dir,
      stage: "02-big-picture-event-storm", summary: longSummary,
      sections: { "战略事件风暴": "过去时领域事件：店铺已查看；当日轨迹已查询。\n事件时间线：用户查询后返回读模型。" } })
    assert.ok(r.findings.some((f) => f.code === "STRATEGIC_EVENT_NOT_STATE_CHANGE"))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("strategic event storm rejects standalone English query-result event names", () => {
  const hits = queryPseudoEvents("1. ShopVisited\n2. DailyTrailQueried ⭐ — 用户查询一日轨迹")
  assert.ok(hits.includes("DailyTrailQueried"))
})

test("strategic event storm keeps real command events after an explicit query result", () => {
  const eventStorm = [
    "社区用户 → `查看活动报名信息`（查询）→ `returns 活动报名概览` → `报名活动`（命令）→ `emits 用户已报名活动`。",
    "已报名用户 → `查看我的报名状态`（查询）→ `returns 用户活动报名状态`（读模型）→ `取消报名`（命令）→ `emits 用户已取消活动报名`。",
  ].join("\n")
  const hits = queryPseudoEvents(eventStorm)
  assert.deepEqual(hits, [])
  const findings = validateStageSemantics(
    { originalRequest: "支持用户报名与取消报名" },
    { id: "02-big-picture-event-storm", scopeContract: { id: "system-discovery" } },
    { summary: "形成报名状态变化时间线。", sections: { "战略事件风暴": eventStorm } },
  )
  assert.ok(!findings.some((finding) => finding.code === "STRATEGIC_EVENT_NOT_STATE_CHANGE"))

  const pseudo = queryPseudoEvents("用户 → 查询活动 → emits 活动详情已返回")
  assert.ok(pseudo.includes("活动详情已返回"))
})

test("strategic event storm rejects a returned trail marked with the event icon", async () => {
  const dir = await freshProject()
  try {
    await initialize({ workflowType: "add-feature", workflowId: "returned-trail-event", projectRoot: dir, title: "t", request: "新增访问轨迹查询" })
    await submit({ workflowType: "add-feature", workflowId: "returned-trail-event", projectRoot: dir,
      stage: "01-current-evidence", summary: longSummary, ...baselinePayload() })
    const r = await submit({ workflowType: "add-feature", workflowId: "returned-trail-event", projectRoot: dir,
      stage: "02-big-picture-event-storm", summary: longSummary,
      sections: { "战略事件风暴": "### 事件时间线\n⚡ 店铺详情页已查看。\n⚡ 查看轨迹已返回。\n📖 一日查看轨迹列表。" } })
    assert.ok(r.findings.some((f) => f.code === "STRATEGIC_EVENT_NOT_STATE_CHANGE"))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("strategic event storm rejects returned detail labeled as a parenthesized event", async () => {
  const dir = await freshProject()
  try {
    await initialize({ workflowType: "add-feature", workflowId: "returned-detail-event", projectRoot: dir, title: "t", request: "新增访问轨迹" })
    await submit({ workflowType: "add-feature", workflowId: "returned-detail-event", projectRoot: dir,
      stage: "01-current-evidence", summary: longSummary, ...baselinePayload() })
    const r = await submit({ workflowType: "add-feature", workflowId: "returned-detail-event", projectRoot: dir,
      stage: "02-big-picture-event-storm", summary: longSummary,
      sections: { "战略事件风暴": "### 事件时间线\n用户 → 查看店铺详情(命令) → 店铺详情已返回(事件)\n页面查看已记录(事件)。" } })
    assert.ok(r.findings.some((f) => f.code === "STRATEGIC_EVENT_NOT_STATE_CHANGE"))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("strategic event storm accepts returned detail explicitly labeled as a read model", async () => {
  const dir = await freshProject()
  try {
    await initialize({ workflowType: "add-feature", workflowId: "returned-detail-read-model", projectRoot: dir, title: "t", request: "新增访问轨迹" })
    await submit({ workflowType: "add-feature", workflowId: "returned-detail-read-model", projectRoot: dir,
      stage: "01-current-evidence", summary: longSummary, ...baselinePayload() })
    const r = await submit({ workflowType: "add-feature", workflowId: "returned-detail-read-model", projectRoot: dir,
      stage: "02-big-picture-event-storm", summary: longSummary,
      sections: { "战略事件风暴": "### 事件时间线\n店铺详情已返回（读模型，非领域事件），同时页面查看已记录（领域事件）。" } })
    assert.ok(!r.findings.some((f) => f.code === "STRATEGIC_EVENT_NOT_STATE_CHANGE"))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("strategic event storm rejects an arrow timeline that disguises query completion as an event", async () => {
  const dir = await freshProject()
  try {
    await initialize({ workflowType: "add-feature", workflowId: "arrow-query-event", projectRoot: dir, title: "t", request: "新增访问轨迹" })
    await submit({ workflowType: "add-feature", workflowId: "arrow-query-event", projectRoot: dir,
      stage: "01-current-evidence", summary: longSummary, ...baselinePayload() })
    const r = await submit({ workflowType: "add-feature", workflowId: "arrow-query-event", projectRoot: dir,
      stage: "02-big-picture-event-storm", summary: longSummary,
      sections: { "战略事件风暴": "### 事件时间线\n[用户] → (查询一日轨迹) → **一日轨迹已查询(DailyTrailQueried)**" } })
    assert.ok(r.findings.some((f) => f.code === "STRATEGIC_EVENT_NOT_STATE_CHANGE"))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("strategic event storm allows negated technical terms and recommendations in advisory sections", async () => {
  const dir = await freshProject()
  try {
    await initialize({ workflowType: "add-feature", workflowId: "advice-scope", projectRoot: dir, title: "t", request: "新增访问轨迹" })
    await submit({ workflowType: "add-feature", workflowId: "advice-scope", projectRoot: dir,
      stage: "01-current-evidence", summary: longSummary, ...baselinePayload() })
    const negated = await submit({ workflowType: "add-feature", workflowId: "advice-scope", projectRoot: dir,
      stage: "02-big-picture-event-storm", summary: longSummary,
      sections: { "异常、补偿与时间约束": "非法输入形成业务拒绝，具体形式留待后续确认，本阶段不决定 API。" } })
    assert.ok(!negated.findings.some((f) => f.code === "STRATEGIC_EVENTSTORM_TECHNICAL_LEAK"))
    const advice = await submit({ workflowType: "add-feature", workflowId: "advice-scope", projectRoot: dir,
      stage: "02-big-picture-event-storm", summary: "比较多种业务解释并给出推荐理由，仍不扩大原始需求范围。",
      sections: { "备选解释与建议": "比较自然日与营业日两种解释，推荐自然日；画像推荐属于未来候选，不进入本次交付。" } })
    assert.ok(!advice.findings.some((f) => f.code === "INTENT_CAPABILITY_EXPANSION"))
    const outOfScope = await submit({ workflowType: "add-feature", workflowId: "advice-scope", projectRoot: dir,
      stage: "02-big-picture-event-storm", summary: "保持原始访问轨迹范围，不加入额外验收能力。",
      sections: { "业务主题与分析范围": "### 范围外\n店铺热度统计与排行均不纳入本次交付。" } })
    assert.ok(!outOfScope.findings.some((f) => f.code === "INTENT_CAPABILITY_EXPANSION"))
    const categorized = await submit({ workflowType: "add-feature", workflowId: "advice-scope", projectRoot: dir,
      stage: "02-big-picture-event-storm", summary: "保持原始访问轨迹范围。",
      sections: { "业务主题与分析范围": "**本次目标**：记录访问轨迹。\n\n**非目标**：光顾频次统计、个性化推荐。\n\n**未来候选**：商家排行。" } })
    assert.ok(!categorized.findings.some((f) => f.code === "INTENT_CAPABILITY_EXPANSION"))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("strategic intent guard distinguishes recommended choices from recommendation capabilities", () => {
  const choice = validateStageSemantics(
    { originalRequest: "新增用户一日光顾店铺轨迹" },
    { id: "02-big-picture-event-storm", scopeContract: { id: "system-discovery" } },
    {
      summary: "推荐以查看店铺详情作为光顾触发候选。",
      sections: { "一页结论": "本次推荐候选 A，它仍只交付用户一日光顾轨迹。" },
    },
  )
  assert.ok(!choice.some((finding) => finding.code === "INTENT_CAPABILITY_EXPANSION"))

  const capability = validateStageSemantics(
    { originalRequest: "新增用户一日光顾店铺轨迹" },
    { id: "02-big-picture-event-storm", scopeContract: { id: "system-discovery" } },
    {
      summary: "额外交付智能推荐能力。",
      sections: { "一页结论": "主流程将一日轨迹输入智能推荐系统并返回推荐店铺。" },
    },
  )
  assert.ok(capability.some((finding) => finding.code === "INTENT_CAPABILITY_EXPANSION"))
})

test("strategic intent guard treats excluded payment as a non-capability", () => {
  const excluded = validateStageSemantics(
    { originalRequest: "从零创建社区活动报名系统，支持活动发布、用户报名、取消报名和名额约束" },
    { id: "02-big-picture-event-storm", scopeContract: { id: "system-discovery" } },
    {
      summary: "形成活动发布、报名、取消和名额约束的业务时间线。",
      sections: {
        "一页结论": "当前目标只有活动发布、报名、取消和名额约束。支付、审核和通知只作为未来机会或热点，不进入首期主流程。",
        "业务主题与分析范围": "原始范围未给出支付或外部支付系统，不得凭空纳入。",
        "热点与边界线索": "本轮有意遗漏支付、候补与签到，它们均不纳入本次交付。",
      },
    },
  )
  assert.ok(!excluded.some((finding) => finding.code === "INTENT_CAPABILITY_EXPANSION"))

  const positive = validateStageSemantics(
    { originalRequest: "从零创建社区活动报名系统，支持活动发布、用户报名、取消报名和名额约束" },
    { id: "02-big-picture-event-storm", scopeContract: { id: "system-discovery" } },
    { summary: "本期增加在线支付能力。", sections: { "一页结论": "报名成功后进入支付主流程并以支付成功作为验收结果。" } },
  )
  assert.ok(positive.some((finding) => finding.code === "INTENT_CAPABILITY_EXPANSION" && finding.message.includes("支付")))
})

test("strategic intent guard allows capacity-derived registration counts but not unrelated counting", () => {
  const state = { originalRequest: "从零创建社区活动报名系统，支持活动发布、用户报名、取消报名和名额约束" }
  const stage = { id: "06-service-use-cases", scopeContract: { id: "system-strategy" } }
  const capacityCount = validateStageSemantics(state, stage, {
    summary: "形成活动报名用例包，落实名额约束。",
    sections: {
      "实现单元用例包": "发布活动时报名计数从 0 开始。报名成功后计数加一；满员拒绝时计数不变；取消报名后计数减一并释放名额。",
    },
  })
  assert.ok(!capacityCount.some((finding) => finding.code === "INTENT_CAPABILITY_EXPANSION"))

  const unrelatedCount = validateStageSemantics(state, stage, {
    summary: "额外交付用户内容分析。",
    sections: { "实现单元用例包": "新增按日浏览计数能力，并把浏览计数结果作为验收输出。" },
  })
  assert.ok(unrelatedCount.some((finding) => finding.code === "INTENT_CAPABILITY_EXPANSION" && finding.message.includes("计数")))
})

test("strategic event storm does not hide technical design behind current or future category labels", () => {
  const findings = validateStageSemantics(
    { originalRequest: "当用户主动签到后记录光顾，并返回当日轨迹" },
    { id: "02-big-picture-event-storm", scopeContract: { id: "system-discovery" } },
    {
      stage: "02-big-picture-event-storm", summary: "只检查战略事件风暴的专业边界。",
      sections: {
        "业务主题与分析范围": "现状已存在：GET /shop/{id} 接口。",
        "备选解释与建议": "未来候选：使用 Redis Sorted Set 并异步持久化。",
        "战略事件风暴": "明确不在本阶段设计 API、数据库表或 Redis。",
      },
    },
  )
  const leaks = findings.filter((finding) => finding.code === "STRATEGIC_EVENTSTORM_TECHNICAL_LEAK")
  assert.ok(leaks.some((finding) => finding.path.endsWith("业务主题与分析范围")))
  assert.ok(leaks.some((finding) => finding.path.endsWith("备选解释与建议")))
  assert.ok(!leaks.some((finding) => finding.path.endsWith("战略事件风暴")))
})

test("human milestone cannot be submitted with placeholder sections", async () => {
  const dir = await freshProject()
  try {
    await initialize({ workflowType: "add-feature", workflowId: "placeholder", projectRoot: dir, title: "t", request: "新增访问轨迹" })
    await submit({ workflowType: "add-feature", workflowId: "placeholder", projectRoot: dir,
      stage: "01-current-evidence", summary: longSummary, ...baselinePayload() })
    const r = await submit({ workflowType: "add-feature", workflowId: "placeholder", projectRoot: dir,
      stage: "02-big-picture-event-storm", summary: longSummary,
      sections: { "战略事件风暴": "用户发起业务动作，业务规则生效并形成可观察结果。" } })
    assert.ok(r.findings.some((f) => f.code === "MILESTONE_DOCUMENT_INCOMPLETE" && f.severity === "blocking"))
    assert.equal(r.requiredAction, "continue")
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("strategic design blocks capabilities not authorized by the original request", async () => {
  const dir = await freshProject()
  try {
    await initialize({ workflowType: "add-feature", workflowId: "intent", projectRoot: dir, title: "t",
      request: "登录用户查看店铺成功后记录当天首次访问，并查询当天访问店铺。" })
    await completeMilestoneI(dir, "intent")
    await review({ workflowType: "add-feature", workflowId: "intent", projectRoot: dir,
      stage: "02-big-picture-event-storm", decision: "approve", reviewer: "tester",
      resolution: { selectedCandidateId: "candidate-a" } })
    const r = await submit({ workflowType: "add-feature", workflowId: "intent", projectRoot: dir,
      stage: "03-strategic-impact", summary: "战略设计新增按日浏览计数能力并形成业务结果。",
      sections: { "子域划分": "本次核心能力包含按日浏览计数，并把计数结果作为验收输出。" } })
    assert.ok(r.findings.some((f) => f.code === "INTENT_CAPABILITY_EXPANSION" && f.severity === "blocking"))
    const negated = await submit({ workflowType: "add-feature", workflowId: "intent", projectRoot: dir,
      stage: "03-strategic-impact", summary: "本阶段只决定业务边界与职责归属，不提前进入战术模型设计。",
      sections: { "战略设计范围与输入": "本阶段未设计聚合根、值对象、应用服务、DTO、SQL 或表结构。" } })
    assert.ok(!negated.findings.some((f) => f.code === "STRATEGIC_DESIGN_TACTICAL_LEAK"))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("plugin installs a bounded DDD command agent with noisy tools disabled", async () => {
  const plugin = await DddWorkflowPlugin({ directory: process.cwd(), worktree: process.cwd() })
  const config = {}
  await plugin.config(config)
  assert.equal(config.command.ddd.agent, "ddd-workflow")
  assert.equal(config.agent["ddd-workflow"].maxSteps, 30)
  assert.equal(config.agent["ddd-workflow"].tools.subagent, false)
  assert.equal(config.agent["ddd-workflow"].tools.workflow_run, false)
  assert.equal(config.agent["ddd-workflow"].tools.skill_eval, false)
  assert.match(config.command.ddd.template, /action=complete-stage/)
  assert.deepEqual(Object.keys(plugin.tool), ["ddd_lifecycle"])
  assert.equal(config.mcp, undefined)
})

test("Mobile adapter mode exposes the lifecycle directly through the native SDK", async () => {
  const plugin = await DddWorkflowPlugin({ directory: process.cwd(), worktree: process.cwd() }, { host: "mobile" })
  const config = {}
  await plugin.config(config)
  assert.equal(config.mcp, undefined)
  assert.deepEqual(Object.keys(plugin.tool), ["ddd_lifecycle"])
  assert.equal(plugin.tool.ddd_lifecycle, dddLifecycleTool)
})

test("DDD command binds the exact user request over model-expanded init input", async () => {
  const plugin = await DddWorkflowPlugin({ directory: process.cwd(), worktree: process.cwd() })
  const sessionID = "exact-command-intent"
  const original = "新增用户一日光顾店铺轨迹功能"
  await plugin["command.execute.before"]({ command: "ddd", sessionID, arguments: original }, { parts: [] })
  const hookOutput = {
    args: {
      action: "init",
      workflow_type: "add-feature",
      workflow_id: "intent-bound",
      input: {
        title: "用户轨迹",
        request: `${original}。目标：记录进店离店事件。排除项：不做实时推送。`,
      },
    },
  }
  await plugin["tool.execute.before"]({ tool: "ddd_lifecycle", sessionID, callID: "init" }, hookOutput)
  assert.equal(hookOutput.args.input.request, original)
  assert.equal(hookOutput.args.input.title, "用户轨迹")
})

test("DDD command repairs JSON-string init input without changing the exact request", async () => {
  const plugin = await DddWorkflowPlugin({ directory: process.cwd(), worktree: process.cwd() })
  const sessionID = "exact-string-intent"
  const original = "重构店铺查询模块"
  await plugin["command.execute.before"]({ command: "ddd", sessionID, arguments: `  ${original}  ` }, { parts: [] })
  const hookOutput = {
    args: {
      action: "init",
      workflow_type: "refactor-system",
      workflow_id: "intent-string-bound",
      input: JSON.stringify({ title: "店铺查询重构", request: "重构整个项目并拆分微服务" }),
    },
  }
  await plugin["tool.execute.before"]({ tool: "ddd_lifecycle", sessionID, callID: "init" }, hookOutput)
  assert.deepEqual(hookOutput.args.input, { title: "店铺查询重构", request: original })
})

test("Mobile chat hook binds the exact slash-command request when command hook is skipped", async () => {
  const plugin = await DddWorkflowPlugin({ directory: process.cwd(), worktree: process.cwd() })
  const sessionID = "mobile-chat-intent"
  const original = "新增用户一日光顾店铺轨迹功能"
  const messageOutput =
    { message: {}, parts: [{ type: "text", text: `"/ddd ${original}"` }] }
  await plugin["chat.message"](
    { sessionID },
    messageOutput,
  )
  assert.equal(messageOutput.message.tools.subagent, false)
  assert.equal(messageOutput.message.tools.skill_eval, false)
  assert.equal(messageOutput.message.tools.read, false)
  assert.equal(messageOutput.message.tools.ddd_lifecycle, true)
  assert.equal(messageOutput.message.tools.skill, true)
  const hookOutput = {
    args: {
      action: "init",
      workflow_type: "add-feature",
      workflow_id: "mobile-intent-bound",
      input: JSON.stringify({ title: "用户轨迹", request: `${original}，并增加运营分析` }),
    },
  }
  await plugin["tool.execute.before"]({ tool: "ddd_lifecycle", sessionID, callID: "init" }, hookOutput)
  assert.deepEqual(hookOutput.args.input, { title: "用户轨迹", request: original })
})

test("Mobile physically hides engineering tools from every ddd-workflow turn after slash expansion", async () => {
  const plugin = await DddWorkflowPlugin({ directory: process.cwd(), worktree: process.cwd() })
  const messageOutput = {
    message: {},
    // Mobile expands /ddd before chat.message, so this deliberately contains
    // no literal slash command and cannot rely on dddRequestFromMessage.
    parts: [{ type: "text", text: "Load ddd-orchestrate and continue to the next human gate." }],
  }
  await plugin["chat.message"]({ sessionID: "expanded-command-mask", agent: "ddd-workflow" }, messageOutput)
  assert.equal(messageOutput.message.tools.read, false)
  assert.equal(messageOutput.message.tools.bash, false)
  assert.equal(messageOutput.message.tools.ls, false)
  assert.equal(messageOutput.message.tools.mcp, false)
  assert.equal(messageOutput.message.tools.write, false)
  assert.equal(messageOutput.message.tools.subagent, false)

  const codingOutput = { message: {}, parts: [{ type: "text", text: "批准" }] }
  await plugin["chat.message"]({ sessionID: "coding-command-tools", agent: "ddd-coding" }, codingOutput)
  assert.equal(codingOutput.message.tools, undefined)
})

test("direct lifecycle init remains compatible when no DDD command request is bound", async () => {
  const plugin = await DddWorkflowPlugin({ directory: process.cwd(), worktree: process.cwd() })
  const hookOutput = {
    args: {
      action: "init",
      workflow_type: "create-system",
      workflow_id: "direct-init",
      input: { title: "直接初始化", request: "创建会员系统" },
    },
  }
  await plugin["tool.execute.before"]({ tool: "ddd_lifecycle", sessionID: "direct-init-session", callID: "init" }, hookOutput)
  assert.equal(hookOutput.args.input.request, "创建会员系统")
})

test("lifecycle binds an initialized change to its Mobile session", async () => {
  const dir = await freshProject()
  const context = {
    sessionID: "bound-session", messageID: "message", agent: "ddd-workflow",
    directory: dir, worktree: dir, abort: new AbortController().signal,
    metadata() {}, async ask() {},
  }
  try {
    const initialized = JSON.parse(await dddLifecycleTool.execute({
      action: "init", workflow_type: "add-feature", workflow_id: "bound-change",
      input: { title: "绑定测试", request: "新增绑定测试能力" },
    }, context))
    assert.equal(initialized.workflowId, "bound-change")
    await initialize({ workflowType: "add-feature", workflowId: "other-change", projectRoot: dir, title: "other", request: "other" })
    const prepared = JSON.parse(await dddLifecycleTool.execute({ action: "prepare", input: {} }, context))
    assert.equal(prepared.stageCard.stageId, "01-current-evidence")
    assert.equal(prepared.error, undefined)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("lifecycle tolerates a JSON-encoded input object from weaker tool callers", async () => {
  const dir = await freshProject()
  const context = {
    sessionID: "string-input-session", messageID: "message", agent: "ddd-workflow",
    directory: dir, worktree: dir, abort: new AbortController().signal,
    metadata() {}, async ask() {},
  }
  try {
    const initialized = JSON.parse(await dddLifecycleTool.execute({
      action: "init", workflow_type: "add-feature", workflow_id: "string-input",
      input: JSON.stringify({ title: "字符串载荷", request: "新增访问轨迹" }),
    }, context))
    assert.equal(initialized.workflowId, "string-input")
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("lifecycle complete-stage publishes all sections in one model call", async () => {
  const dir = await freshProject()
  const context = {
    sessionID: "atomic-stage-session", messageID: "message", agent: "ddd-workflow",
    directory: dir, worktree: dir, abort: new AbortController().signal,
    metadata() {}, async ask() {},
  }
  try {
    await dddLifecycleTool.execute({
      action: "init", workflow_type: "add-feature", workflow_id: "atomic-stage",
      input: { title: "原子阶段测试", request: "为现有系统新增访问轨迹查询能力" },
    }, context)
    const fact = "当前店铺详情缺失时返回“店铺不存在”错误结果，该既有业务入口已通过自动化测试验证。"
    const topology = "HMDP 当前为单体应用，未拆分微服务。"
    const constraint = "必须保持既有业务入口的可观察行为兼容。"
    const result = JSON.parse(await dddLifecycleTool.execute({
      action: "complete-stage",
      input: {
        summary: "现状基线已经通过一次原子阶段提交完成，并明确记录兼容约束与证据来源。",
        sections: {
          "输入场景与现状事实": `## 输入场景与现状事实\n\n${fact}\n\n${topology}\n\n事实、假设与待确认项已经分开记录；可执行验收约束只保护已有行为。`,
          "证据与追踪": `## 证据与追踪\n\n## 验证基线\n\n${constraint}\n\n现状代码证据索引与验证基线已经建立；OpenSpec历史战略基线当前为空。`,
        },
        observations: [
          { heading: "输入场景与现状事实", kind: "current-behavior-fact", statement: fact, evidence_refs: ["test:baseline"] },
          { heading: "输入场景与现状事实", kind: "current-topology-fact", statement: topology, evidence_refs: ["test:baseline"] },
          { heading: "证据与追踪", kind: "compatibility-constraint", statement: constraint, evidence_refs: ["request:00-request"] },
        ],
      },
    }, context))
    assert.equal(result.lastCompletedStage, "01-current-evidence", JSON.stringify(result, null, 2))
    assert.equal(result.nextStage, "02-big-picture-event-storm")
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("plugin replaces evidence-stage repository exploration with one bundle", async () => {
  const plugin = await DddWorkflowPlugin({ directory: process.cwd(), worktree: process.cwd() })
  const sessionID = "budget-test"
  await plugin["command.execute.before"]({ command: "ddd", sessionID }, {})
  await plugin["tool.execute.before"](
    { tool: "mcp", sessionID, callID: "prepare" },
    { args: { action: "prepare", input: { stage: "01-current-evidence" } } },
  )
  await assert.rejects(
    plugin["tool.execute.before"](
      { tool: "read", sessionID, callID: "read-9" },
      { args: { filePath: "Shop.java" } },
    ),
    /DDD_EVIDENCE_BUNDLE_REQUIRED/,
  )
})

test("JSON-string prepare payload activates the evidence guard and blocks Mobile subagents", async () => {
  const plugin = await DddWorkflowPlugin({ directory: process.cwd(), worktree: process.cwd() })
  const sessionID = "mobile-string-prepare"
  await plugin["chat.message"](
    { sessionID },
    { message: {}, parts: [{ type: "text", text: "/ddd 新增访问轨迹" }] },
  )
  await plugin["tool.execute.before"](
    { tool: "ddd_lifecycle", sessionID, callID: "prepare" },
    { args: { action: "prepare", input: JSON.stringify({ stage: "01-current-evidence" }) } },
  )
  await assert.rejects(
    plugin["tool.execute.before"](
      { tool: "subagent", sessionID, callID: "explore" },
      { args: { description: "Explore codebase" } },
    ),
    /DDD_EVIDENCE_TOOL_DENIED/,
  )
})

test("modeling stages fail closed for unknown tools", async () => {
  const plugin = await DddWorkflowPlugin({ directory: process.cwd(), worktree: process.cwd() })
  const sessionID = "modeling-tool-allowlist"
  await plugin["chat.message"](
    { sessionID },
    { message: {}, parts: [{ type: "text", text: "/ddd 新增访问轨迹" }] },
  )
  await assert.rejects(
    plugin["tool.execute.before"](
      { tool: "future_unknown_agent_tool", sessionID, callID: "unknown" },
      { args: {} },
    ),
    /DDD_LIFECYCLE_ONLY/,
  )
  await assert.doesNotReject(
    plugin["tool.execute.before"](
      { tool: "skill", sessionID, callID: "skill" },
      { args: { name: "ddd-orchestrate" } },
    ),
  )
})

test("evidence bundle guard survives plugin hook recreation", async () => {
  const sessionID = "recreated-plugin-budget-test"
  const preparedPlugin = await DddWorkflowPlugin({ directory: process.cwd(), worktree: process.cwd() })
  await preparedPlugin["tool.execute.before"](
    { tool: "configured_custom_tool_42", sessionID, callID: "prepare" },
    { args: { action: "prepare", input: { stage: "01-current-evidence" } } },
  )

  const finalPlugin = await DddWorkflowPlugin({ directory: process.cwd(), worktree: process.cwd() })
  await assert.rejects(
    finalPlugin["tool.execute.before"](
      { tool: "grep", sessionID, callID: "grep-9" },
      { args: { pattern: "Shop" } },
    ),
    /DDD_EVIDENCE_BUNDLE_REQUIRED/,
  )
})

test("persisted session binding blocks Mobile fallback tools after in-memory hook state is absent", async () => {
  const dir = await freshProject()
  const sessionID = "persisted-mobile-guard"
  const context = {
    sessionID, messageID: "message", agent: "build", directory: dir, worktree: dir,
    abort: new AbortController().signal, metadata() {}, async ask() {},
  }
  try {
    await dddLifecycleTool.execute({ action: "init", workflow_type: "add-feature", workflow_id: "persisted-guard",
      input: { title: "持久化会话门禁", request: "新增访问轨迹" } }, context)
    const recreated = await DddWorkflowPlugin({ directory: dir, worktree: dir })
    await assert.rejects(
      recreated["tool.execute.before"](
        { tool: "multi_edit", sessionID, callID: "unexpected-edit" },
        { args: { filePath: path.join(dir, "openspec", "changes", "persisted-guard", "ddd", "scratch.js") } },
      ),
      /DDD_LIFECYCLE_ONLY/,
    )
    await assert.rejects(
      recreated["tool.execute.before"](
        { tool: "skill_run_script", sessionID, callID: "unexpected-script" },
        { args: { scriptPath: "scratch.js" } },
      ),
      /DDD_LIFECYCLE_ONLY/,
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("recreated Mobile process fails closed at a human gate before its first Read or Bash", async () => {
  const dir = await freshProject()
  const sessionID = "persisted-human-gate-guard"
  const context = {
    sessionID, messageID: "message", agent: "ddd-workflow", directory: dir, worktree: dir,
    abort: new AbortController().signal, metadata() {}, async ask() {},
  }
  try {
    await dddLifecycleTool.execute({ action: "init", workflow_type: "add-feature", workflow_id: "human-gate-guard",
      input: { title: "跨进程人工门", request: "新增访问轨迹" } }, context)
    await completeMilestoneI(dir, "human-gate-guard")
    const stateFile = path.join(dir, "openspec", "changes", "human-gate-guard", "ddd", ".ddd", "workflow-state.json")
    const state = JSON.parse(await readFile(stateFile, "utf8"))
    assert.equal(state.preparedStage, undefined)
    assert.equal(state.checkpoints.at(-1).status, "awaiting_review")

    // Mobile starts a fresh process for the next human response. `worktree`
    // may be broader than `directory`, so recovery must inspect both roots.
    const recreated = await DddWorkflowPlugin({ directory: dir, worktree: path.dirname(dir) })
    await assert.rejects(
      recreated["tool.execute.before"](
        { tool: "Read", sessionID, callID: "first-read" },
        { args: { filePath: path.join(dir, "openspec", "changes", "human-gate-guard", "ddd", "I-strategic-eventstorm.md") } },
      ),
      /DDD_LIFECYCLE_ONLY/,
    )
    await assert.rejects(
      recreated["tool.execute.before"](
        { tool: "Bash", sessionID, callID: "first-bash" },
        { args: { command: "find openspec -type f" } },
      ),
      /DDD_LIFECYCLE_ONLY/,
    )

    const approvalMessage = { message: {}, parts: [{ type: "text", text: "批准" }] }
    await recreated["chat.message"]({ sessionID, agent: "ddd-workflow" }, approvalMessage)
    assert.equal(approvalMessage.message.tools.read, false)
    assert.equal(approvalMessage.message.tools.bash, false)
    assert.equal(approvalMessage.message.tools.skill_run_script, false)
    assert.equal(approvalMessage.message.tools.skill_eval, false)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("review runtime failures return a self-contained stop contract instead of inviting source exploration", async () => {
  const dir = await freshProject()
  const sessionID = "review-repair-contract"
  const context = {
    sessionID, messageID: "message", agent: "ddd-workflow", directory: dir, worktree: dir,
    abort: new AbortController().signal, metadata() {}, async ask() {},
  }
  try {
    await dddLifecycleTool.execute({ action: "init", workflow_type: "add-feature", workflow_id: "review-contract",
      input: { title: "人工门错误合同", request: "新增访问轨迹" } }, context)
    await completeMilestoneI(dir, "review-contract")
    const document = path.join(dir, "openspec", "changes", "review-contract", "ddd", "I-strategic-eventstorm.md")
    await writeFile(document, (await readFile(document, "utf8")).replace("## 一页结论", "## 一页结论\n\n_待填写_"), "utf8")
    const result = JSON.parse(await dddLifecycleTool.execute({
      action: "review", input: { decision: "approve", reviewer: "human" },
    }, context))
    assert.equal(result.retryableByModel, false)
    assert.equal(result.mustStop, true)
    assert.equal(result.stopReason, "human-gate-contract-failed")
    assert.deepEqual(result.repairContract.allowedTools, ["ddd_lifecycle"])
    assert.match(result.repairContract.nextAction, /原样向用户报告/u)
    assert.match(result.repairContract.nextAction, /不得自行把批准改为退回/u)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("plugin activates the evidence bundle guard when prepare infers the stage", async () => {
  const plugin = await DddWorkflowPlugin({ directory: process.cwd(), worktree: process.cwd() })
  const sessionID = "inferred-budget-test"
  await plugin["command.execute.before"]({ command: "ddd", sessionID }, {})
  await plugin["tool.execute.before"](
    { tool: "mcp", sessionID, callID: "prepare" },
    { args: { action: "prepare", input: {} } },
  )
  await plugin["tool.execute.after"](
    { tool: "mcp", sessionID, callID: "prepare", args: { action: "prepare", input: {} } },
    { output: JSON.stringify({ stageCard: { scopeContractId: "existing-system-baseline" } }) },
  )
  await assert.rejects(
    plugin["tool.execute.before"](
      { tool: "grep", sessionID, callID: "grep-9" },
      { args: { pattern: "Shop" } },
    ),
    /DDD_EVIDENCE_BUNDLE_REQUIRED/,
  )
})

test("evidence bundle returns bounded cited excerpts and OpenSpec index", async () => {
  const dir = await freshProject()
  try {
    const source = path.join(dir, "src", "ShopService.java")
    await mkdir(path.dirname(source), { recursive: true })
    await writeFile(source, "class ShopService { Result queryShop(Long id) { return Result.ok(id); } }\n", "utf8")
    await mkdir(path.join(dir, "openspec", "specs", "current-shop"), { recursive: true })
    const packet = await evidenceBundle(dir, "new-change", ["Shop", "queryShop"])
    assert.equal(packet.schemaVersion, "ddd-evidence-bundle/v1")
    assert.equal(packet.matches[0].file, "src/ShopService.java")
    assert.match(packet.matches[0].excerpts[0].ref, /^code:src\/ShopService\.java#L\d+-L\d+$/u)
    assert.ok(packet.requiredCoverage.includes("事实、假设与待确认项"))
    assert.deepEqual(packet.openSpecIndex.currentSpecs, ["current-shop"])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("evidence bundle decomposes invented compound identifiers into repository symbols", async () => {
  const dir = await freshProject()
  try {
    const source = path.join(dir, "src", "ShopController.java")
    await mkdir(path.dirname(source), { recursive: true })
    await writeFile(source, "class ShopController { public Object queryShopById(Long id) { return id; } }\n", "utf8")
    const packet = await evidenceBundle(dir, "new-change", ["ShopDetailView", "UserSession"])
    assert.ok(packet.expandedSearchTerms.includes("shop"))
    assert.equal(packet.matches[0].file, "src/ShopController.java")
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("submit advances to next stage and writes document sections", async () => {
  const dir = await freshProject()
  try {
    await initialize({ workflowType: "add-feature", workflowId: "s1", projectRoot: dir, title: "t", request: "r" })
    const r = await submit({
      workflowType: "add-feature", workflowId: "s1", projectRoot: dir,
      stage: "01-current-evidence",
      summary: "现状证据已收集并形成可执行验收约束基线，现状代码与历史战略已盘点。",
      ...baselinePayload(),
    })
    assert.equal(r.findings.filter((f) => f.severity === "blocking").length, 0)
    assert.equal(r.nextStage, "02-big-picture-event-storm")
    const doc = await readFile(path.join(dir, "openspec", "changes", "s1", "ddd", "I-strategic-eventstorm.md"), "utf8")
    assert.ok(doc.includes("当前系统的既有业务入口已通过测试验证"))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("incremental submit accumulates small section drafts and publishes atomically on finalize", async () => {
  const dir = await freshProject()
  try {
    await initialize({ workflowType: "add-feature", workflowId: "draft-submit", projectRoot: dir, title: "t", request: "新增访问轨迹" })
    const payload = baselinePayload()
    const first = await submit({
      workflowType: "add-feature", workflowId: "draft-submit", projectRoot: dir,
      stage: "01-current-evidence", summary: longSummary, finalize: false,
      sections: { "输入场景与现状事实": payload.sections["输入场景与现状事实"] },
      claims: [payload.claims[0]],
    })
    assert.equal(first.lastCompletedStage, "00-request")
    assert.equal(first.draft.saved, true)
    assert.deepEqual(first.draft.remainingSections, ["证据与追踪"])

    const second = await submit({
      workflowType: "add-feature", workflowId: "draft-submit", projectRoot: dir,
      stage: "01-current-evidence", summary: longSummary, finalize: false,
      sections: { "证据与追踪": payload.sections["证据与追踪"] },
      claims: [payload.claims[1]],
    })
    assert.deepEqual(second.draft.remainingSections, [])
    assert.equal(second.draft.claimCount, 2)

    const finalized = await submit({
      workflowType: "add-feature", workflowId: "draft-submit", projectRoot: dir,
      stage: "01-current-evidence", summary: longSummary, sections: {}, finalize: true,
    })
    assert.equal(finalized.lastCompletedStage, "01-current-evidence")
    assert.equal(finalized.nextStage, "02-big-picture-event-storm")
    const draftFile = path.join(dir, "openspec", "changes", "draft-submit", "ddd", ".ddd", "workbench", "01-current-evidence.draft.json")
    await assert.rejects(readFile(draftFile, "utf8"), /ENOENT/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("incremental submit refuses to persist an out-of-scope draft", async () => {
  const dir = await freshProject()
  try {
    await initialize({ workflowType: "add-feature", workflowId: "bad-draft", projectRoot: dir, title: "t", request: "新增访问轨迹" })
    const statement = "当前行为仍需补充证据。"
    const result = await submit({
      workflowType: "add-feature", workflowId: "bad-draft", projectRoot: dir,
      stage: "01-current-evidence", summary: longSummary, finalize: false,
      sections: { "输入场景与现状事实": `${statement} 候选方案采用只读查询并回滚即移除入口。` },
      claims: [{ id: "GAP-1", kind: "open-question", statement, maturity: "hypothesis",
        documentSection: "输入场景与现状事实", authorityRefs: ["user-input:original-request"], evidenceRefs: [], attributes: {} }],
    })
    assert.ok(result.findings.some((finding) => finding.code === "EVIDENCE_STAGE_TARGET_DESIGN_LEAK"))
    assert.equal(result.draft, undefined)
    const draftFile = path.join(dir, "openspec", "changes", "bad-draft", "ddd", ".ddd", "workbench", "01-current-evidence.draft.json")
    await assert.rejects(readFile(draftFile, "utf8"), /ENOENT/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("human gate: submit then review approve advances", async () => {
  const dir = await freshProject()
  try {
    await initialize({ workflowType: "add-feature", workflowId: "g1", projectRoot: dir, title: "t", request: "r" })
    await completeMilestoneI(dir, "g1")
    const s = await status({ workflowType: "add-feature", workflowId: "g1", projectRoot: dir, view: "compact" })
    assert.equal(s.humanReviewRequired, true)
    assert.equal(s.requiredAction, "await-human-review")
    const r = await review({
      workflowType: "add-feature", workflowId: "g1", projectRoot: dir,
      stage: "02-big-picture-event-storm", decision: "approve", reviewer: "tester",
      resolution: { selectedCandidateId: "candidate-a", resolvedDecisions: ["触发条件"] },
    })
    assert.equal(r.reviewRecord.decision, "approve")
    assert.notEqual(r.requiredAction, "await-human-review")
    const approved = await status({ workflowType: "add-feature", workflowId: "g1", projectRoot: dir, view: "full" })
    assert.equal(approved.state.checkpoints.at(-1).ambiguityResolution.status, "resolved")
    assert.equal(approved.state.humanDecisions[0].selectedCandidateId, "candidate-a")
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("review revise routes back", async () => {
  const dir = await freshProject()
  try {
    await initialize({ workflowType: "add-feature", workflowId: "rv1", projectRoot: dir, title: "t", request: "r" })
    await completeMilestoneI(dir, "rv1")
    const r = await review({
      workflowType: "add-feature", workflowId: "rv1", projectRoot: dir,
      stage: "02-big-picture-event-storm", decision: "revise", reviewer: "tester",
      feedback: "战术事件风暴需要补充失败矩阵",
    })
    assert.equal(r.requiredAction, "revise")
    assert.ok(r.allowedNextStages.length > 0)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("milestone IV model identifier feedback stays in model review instead of event storming", async () => {
  const profile = await profileFor("add-feature")
  const state = {
    schemaVersion: "ddd-workflow-state/v1", workflowType: "add-feature", workflowId: "model-id-owner",
    title: "t", request: "r", status: "revision_requested", currentStage: "07-model-review",
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), checkpoints: [{
      checkpointId: 1, stage: "07-model-review", milestone: "IV", summary: longSummary,
      status: "revision_requested", createdAt: new Date().toISOString(), artifact: "IV-tactical-design.md",
      review: { decision: "revise", reviewer: "tester", reviewedAt: new Date().toISOString(),
        feedback: "07-model-review 输出缺少可提取的 ME/INV 稳定标识。" },
    }],
  }
  const transition = workflowTransition(profile, state)
  assert.equal(transition.nextStage, "07-model-review")
  assert.deepEqual(transition.allowedNextStages, ["07-model-review"])
})

test("review revise bypasses approval validation and a corrected resubmit restores the human gate", async () => {
  const dir = await freshProject()
  try {
    await initialize({ workflowType: "add-feature", workflowId: "rv-invalid", projectRoot: dir, title: "t", request: "新增访问轨迹" })
    await completeMilestoneI(dir, "rv-invalid")
    const docPath = path.join(dir, "openspec", "changes", "rv-invalid", "ddd", "I-strategic-eventstorm.md")
    const invalid = (await readFile(docPath, "utf8")).replace("## 一页结论", "## 一页结论\n\n使用 MySQL 和 Redis 设计查询 API。")
    await writeFile(docPath, invalid, "utf8")

    const returned = await review({ workflowType: "add-feature", workflowId: "rv-invalid", projectRoot: dir,
      stage: "02-big-picture-event-storm", decision: "revise", reviewer: "tester",
      feedback: "战略事件风暴的一页结论泄露技术设计，请退回当前阶段修正。" })
    assert.equal(returned.requiredAction, "revise")
    assert.deepEqual(returned.allowedNextStages, ["02-big-picture-event-storm"])

    await prepare({ workflowType: "add-feature", workflowId: "rv-invalid", projectRoot: dir, stage: "02-big-picture-event-storm" })
    const resubmitted = await submit({ workflowType: "add-feature", workflowId: "rv-invalid", projectRoot: dir,
      stage: "02-big-picture-event-storm", summary: longSummary,
      sections: {
        "一页结论": "当前结论基于系统级业务事件流，不包含任何技术实现决策。",
        "战略事件风暴": "候选场景 A：参与者发起业务动作后形成候选业务事件。\n候选场景 B：外部业务事实到达后形成另一条候选事件流。\n人工确认前，任何候选均不进入本次目标或主流程。",
      },
      ambiguityResolution: {
        status: "unresolved",
        candidates: [{ id: "candidate-a", label: "参与者主动发起" }, { id: "candidate-b", label: "外部事实触发" }],
        affectedDecisions: ["触发条件", "业务结果", "异常与规则"],
      } })
    assert.equal(resubmitted.workflowStatus, "active")
    assert.equal(resubmitted.requiredAction, "await-human-review")
    const resubmittedDoc = await readFile(docPath, "utf8")
    assert.match(resubmittedDoc, /验收状态：待人工验收/u)
    assert.doesNotMatch(resubmittedDoc, /验收决定：revise/u)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("formal document normalizes double-escaped newlines before publication", async () => {
  const dir = await freshProject()
  try {
    await initialize({ workflowType: "add-feature", workflowId: "newlines", projectRoot: dir, title: "t", request: "新增访问轨迹" })
    const r = await submit({ workflowType: "add-feature", workflowId: "newlines", projectRoot: dir,
      stage: "01-current-evidence", summary: longSummary,
      ...baselinePayload({
        fact: "当前系统的第一条事实已经被测试验证。",
        sections: {
          "输入场景与现状事实": "### 事实\\n当前系统的第一条事实已经被测试验证。\\n\\n事实、假设与待确认项已经分离，可执行验收约束只保护已有行为。",
          "证据与追踪": "### 证据\\n既有业务入口的可观察行为必须保持兼容。\\n\\n现状代码证据索引、验证基线和 OpenSpec历史战略基线已经记录。",
        },
      }) })
    assert.equal(r.findings.filter((f) => f.severity === "blocking").length, 0)
    const doc = await readFile(path.join(dir, "openspec", "changes", "newlines", "ddd", "I-strategic-eventstorm.md"), "utf8")
    assert.ok(doc.includes("### 事实\n当前系统的第一条事实已经被测试验证。"))
    assert.ok(!doc.includes("\\n"))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("runtime block records evidence and prepare atomically resumes the same stage", async () => {
  const dir = await freshProject()
  try {
    await initialize({ workflowType: "add-feature", workflowId: "blocked", projectRoot: dir, title: "t", request: "r" })
    const r = await block({ workflowType: "add-feature", workflowId: "blocked", projectRoot: dir,
      stage: "01-current-evidence", reason: "当前测试环境缺少可访问的遗留数据库与运行日志，无法恢复真实行为基线。",
      evidence: ["数据库连接失败"], remediation: ["启动测试数据库并提供只读访问"] })
    assert.equal(r.workflowStatus, "runtime_blocked")
    assert.equal(r.requiredAction, "stop")
    assert.equal(r.nextStage, "01-current-evidence")
    const resumed = await prepare({ workflowType: "add-feature", workflowId: "blocked", projectRoot: dir,
      stage: "01-current-evidence" })
    assert.equal(resumed.workflowStatus, "active")
    assert.equal(resumed.requiredAction, "continue")
    assert.equal(resumed.stageCard.stageId, "01-current-evidence")
    const resumedState = await status({ workflowType: "add-feature", workflowId: "blocked", projectRoot: dir,
      view: "full" })
    assert.equal(resumedState.state.runtimeBlock, undefined)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("implementation stage hook rejects subagents and tool downloads", async () => {
  const plugin = await DddWorkflowPlugin({ directory: process.cwd(), worktree: process.cwd() })
  const sessionID = "implementation-policy"
  await plugin["command.execute.before"]({ command: "ddd", sessionID }, {})
  await plugin["tool.execute.before"](
    { tool: "mcp", sessionID, callID: "prepare" },
    { args: { action: "prepare", input: { stage: "09-implementation" } } },
  )
  await assert.rejects(
    plugin["tool.execute.before"]({ tool: "subagent", sessionID, callID: "fanout" }, { args: {} }),
    /DDD_IMPLEMENTATION_TOOL_DENIED/,
  )
  await assert.rejects(
    plugin["tool.execute.before"]({ tool: "bash", sessionID, callID: "download" },
      { args: { command: "powershell Invoke-WebRequest https://example.invalid/apache-maven.zip" } }),
    /DDD_IMPLEMENTATION_BOOTSTRAP_DENIED/,
  )
})

test("ddd-coding cannot use repository tools before lifecycle review and prepare", async () => {
  const plugin = await DddWorkflowPlugin({ directory: process.cwd(), worktree: process.cwd() })
  const sessionID = "coding-first-call-gate"
  await plugin["command.execute.before"]({ command: "ddd-code", sessionID }, {})
  await assert.rejects(
    plugin["tool.execute.before"](
      { tool: "read", sessionID, callID: "premature-read" },
      { args: { filePath: "src/main/App.java" } },
    ),
    /DDD_LIFECYCLE_ONLY/,
  )
})

test("plugin rejects generic writes to formal milestone and OpenSpec planning artifacts", async () => {
  const plugin = await DddWorkflowPlugin({ directory: process.cwd(), worktree: process.cwd() })
  const sessionID = "formal-artifact-policy"
  await plugin["command.execute.before"]({ command: "ddd", sessionID }, {})
  for (const filePath of [
    "openspec/changes/c1/ddd/I-strategic-eventstorm.md",
    "openspec/changes/c1/proposal.md",
    "openspec/changes/c1/specs/visit-trail/spec.md",
    "openspec/changes/c1/design.md",
    "openspec/changes/c1/tasks.md",
  ]) {
    await assert.rejects(
      plugin["tool.execute.before"]({ tool: "write", sessionID, callID: filePath }, { args: { filePath } }),
      /DDD_FORMAL_ARTIFACT_WRITE_DENIED/,
    )
  }
  await assert.rejects(
    plugin["tool.execute.before"]({ tool: "Edit", sessionID, callID: "mobile-title-case" },
      { args: { filePath: "openspec/changes/c1/ddd/IV-tactical-design.md" } }),
    /DDD_FORMAL_ARTIFACT_WRITE_DENIED/,
  )
  await assert.rejects(
    plugin["tool.execute.before"]({ tool: "write", sessionID, callID: "source" }, { args: { filePath: "src/main/App.java" } }),
    /DDD_LIFECYCLE_ONLY/,
  )
})

test("delivery plan requires a positive planned slice count", async () => {
  const dir = await freshProject()
  try {
    await initialize({ workflowType: "add-feature", workflowId: "plan", projectRoot: dir, title: "t", request: "r" })
    const stateFile = path.join(dir, "openspec", "changes", "plan", "ddd", ".ddd", "workflow-state.json")
    const state = JSON.parse(await readFile(stateFile, "utf8"))
    state.checkpoints.push({ checkpointId: 2, stage: "07-model-review", milestone: "IV", summary: longSummary,
      status: "approved", review: null, reviewChecklist: [], adviceRequired: false, document: "milestoneIV", completedAt: new Date().toISOString() })
    state.currentStage = "07-model-review"
    await writeFile(stateFile, JSON.stringify(state), "utf8")
    const r = await submit({ workflowType: "add-feature", workflowId: "plan", projectRoot: dir,
      stage: "08-roadmap", summary: longSummary, sections: { "交付范围": "形成可验收和回滚的纵向切片计划。" } })
    assert.ok(r.findings.some((f) => f.code === "PLANNED_SLICES_REQUIRED" && f.severity === "blocking"))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("final review stays behind implementation when planned slices are unknown", async () => {
  const dir = await freshProject()
  try {
    await initialize({ workflowType: "add-feature", workflowId: "progress", projectRoot: dir, title: "t", request: "r" })
    const stateFile = path.join(dir, "openspec", "changes", "progress", "ddd", ".ddd", "workflow-state.json")
    const state = JSON.parse(await readFile(stateFile, "utf8"))
    state.checkpoints.push({ checkpointId: 2, stage: "09-implementation", milestone: "VI", summary: longSummary,
      status: "completed", review: null, reviewChecklist: [], adviceRequired: false, document: "milestoneVI",
      completedAt: new Date().toISOString(), sliceId: "S1" })
    state.currentStage = "09-implementation"
    await writeFile(stateFile, JSON.stringify(state), "utf8")
    const r = await status({ workflowType: "add-feature", workflowId: "progress", projectRoot: dir })
    assert.equal(r.nextStage, "09-implementation")
    assert.ok(!r.allowedNextStages.includes("10-final-review"))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("implementation submission rejects an unverifiable commit", async () => {
  const dir = await freshProject()
  try {
    await initialize({ workflowType: "add-feature", workflowId: "evidence", projectRoot: dir, title: "t", request: "r" })
    const stateFile = path.join(dir, "openspec", "changes", "evidence", "ddd", ".ddd", "workflow-state.json")
    const state = JSON.parse(await readFile(stateFile, "utf8"))
    state.checkpoints.push({ checkpointId: 2, stage: "08-roadmap", milestone: "V", summary: longSummary,
      status: "approved", review: null, reviewChecklist: [], adviceRequired: false, document: "milestoneV",
      completedAt: new Date().toISOString(), plannedSlices: 1 })
    state.currentStage = "08-roadmap"
    state.implementationBaseline = { head: "1111111111111111111111111111111111111111", capturedAt: new Date().toISOString() }
    await writeFile(stateFile, JSON.stringify(state), "utf8")
    const r = await submit({ workflowType: "add-feature", workflowId: "evidence", projectRoot: dir,
      stage: "09-implementation", sliceId: "S1", summary: longSummary,
      sections: { "Git 与回滚证据": "Commit SHA: deadbeef；该提交可独立回滚。", "测试与运行证据": "全部验证通过。" } })
    assert.ok(r.findings.some((f) => f.code === "IMPLEMENTATION_COMMIT_INVALID" && f.severity === "blocking"))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("implementation verification distinguishes business failure paths from failed evidence", () => {
  assert.equal(hasFailedVerificationEvidence("记录失败不阻断店铺详情返回，端到端测试 7/7 通过。"), false)
  assert.equal(hasFailedVerificationEvidence("E2E 集成测试覆盖记录失败不阻断详情返回，7/7 通过。"), false)
  assert.equal(hasFailedVerificationEvidence("生产迁移待部署环境执行，验证命令全部通过。"), false)
  assert.equal(hasFailedVerificationEvidence("E2E 测试失败，尚未满足交付条件。"), true)
  assert.equal(hasFailedVerificationEvidence("测试未运行，环境不可用。"), true)
  assert.equal(hasFailedVerificationEvidence("Tests run: 25, Failures: 1, Errors: 0; BUILD FAILURE"), true)
})

test("tactical required-content gate accepts framework-equivalent signatures", () => {
  const text = "## 应用服务设计\nIPageViewService（recordView/queryTrail）。## 持久化\nPageViewMapper extends BaseMapper，SELECT WHERE。## 接口\nPageViewController GET /view-trail 返回 TrailDTO。"
  assert.equal(containsRequiredConcept(text, "应用服务签名"), true)
  assert.equal(containsRequiredConcept(text, "仓储语义签名"), true)
  assert.equal(containsRequiredConcept(text, "公开接口与 DTO 契约"), true)
})

test("tactical event semantics reject query-return events in Chinese and English", () => {
  const text = "QueryDailyTrail 命令 → 事件 DailyTrailReturned(userId, date) → 读模型。\n查询轨迹 → 领域事件：轨迹已返回。\n查询一日轨迹 → 🟧一日轨迹已生成 → 🟪轨迹列表。\n记录查看 → 事件 PageViewRecorded。"
  assert.deepEqual(queryPseudoEvents(text), ["轨迹已返回", "DailyTrailReturned", "一日轨迹已生成"])
})

test("tactical event storm rejects concrete database uniqueness mechanisms", () => {
  const findings = validateStageSemantics(
    { originalRequest: "新增用户一日光顾店铺轨迹", checkpoints: [], humanDecisions: [] },
    { id: "05-design-level-event-storm", scopeContract: { id: "context-discovery" } },
    {
      summary: "识别同日同店幂等规则和并发热点。",
      sections: {
        "战术事件风暴": "RecordVisit 命令触发光顾已记录。",
        "并发、事务与持久化热点": "同一用户同一商铺同一日只记一次，使用 (userId, shopId, visitDate) 唯一约束实现。",
      },
    },
  )
  assert.ok(findings.some((finding) => finding.code === "TACTICAL_EVENTSTORM_IMPLEMENTATION_LEAK"))
})

test("tactical design derives automatic-trigger constraints from approved human decisions", () => {
  const findings = validateStageSemantics(
    {
      originalRequest: "新增用户一日光顾店铺轨迹功能",
      checkpoints: [{
        status: "approved", summary: "仅商铺详情页访问触发记录。",
        review: { feedback: "批准候选A：仅详情页访问触发，同日同店去重。" },
      }],
      humanDecisions: [],
    },
    { id: "06-tactical-design", scopeContract: { id: "context-tactical-design" } },
    { summary: "战术设计", sections: { "公开接口与 DTO 契约": "详情成功后调用记录服务；另提供 POST /trail/visit 触发记录。" } },
  )
  assert.ok(findings.some((finding) => finding.code === "TACTICAL_DUPLICATE_EXTERNAL_TRIGGER"))
})

test("delivery milestone is deterministically compiled from plan and approved invariant statements", () => {
  const compiled = compileDeliveryMilestoneSections(normalizeStructuredPlan(validStructuredPlan), "daily-visit-trail", {
    modelElements: [{ id: "ME-01", name: "VisitTrail" }],
    invariants: [{ id: "INV-01", statement: "同一用户只能读取自己的访问轨迹" }],
    sourceSha256: "abc",
  })
  assert.match(compiled.sections["纵向交付切片"], /INV-01：同一用户只能读取自己的访问轨迹/u)
  assert.doesNotMatch(compiled.sections["纵向交付切片"], /索引idx/u)
  assert.match(compiled.sections["证据与追踪"], /确定性编译/u)
})

test("tactical design rejects a second public capture trigger for automatic recording", () => {
  const findings = validateStageSemantics(
    { originalRequest: "用户每次成功查看店铺详情时记录一次事实" },
    { id: "06-tactical-design", scopeContract: { id: "context-tactical-design" } },
    { summary: "战术设计", sections: { "模块与分层设计": "详情成功返回后调用记录服务；另提供 POST /shop/{id}/view 触发记录。" } },
  )
  assert.ok(findings.some((finding) => finding.code === "TACTICAL_DUPLICATE_EXTERNAL_TRIGGER"))
})

test("tactical design rejects an ORM aggregate and missing request-owned invariants", () => {
  const findings = validateStageSemantics(
    { originalRequest: "用户每次成功查看店铺详情时记录一次事实；同一店铺重复查看必须保留每一次；页面查看不表示实际到店" },
    { id: "06-tactical-design", scopeContract: { id: "context-tactical-design" } },
    { summary: "战术设计", sections: {
      "领域模型设计": "PageView 是聚合根 + MyBatis 实体。INV-01：字段非空。",
      "模块与分层设计": "详情成功返回后调用记录应用服务。",
    } },
  )
  const codes = new Set(findings.map((finding) => finding.code))
  assert.ok(codes.has("TACTICAL_AGGREGATE_INFRASTRUCTURE_MERGE"))
  assert.ok(codes.has("TACTICAL_INVARIANT_EXACTLY_ONE_MISSING"))
  assert.ok(codes.has("TACTICAL_INVARIANT_DUPLICATES_MISSING"))
  assert.ok(codes.has("TACTICAL_UBIQUITOUS_LANGUAGE_DISTINCTION_MISSING"))
})

test("tactical design rejects application-to-mapper coupling and layer-first scattering", () => {
  const findings = validateStageSemantics(
    { originalRequest: "新增查询能力" },
    { id: "06-tactical-design", scopeContract: { id: "context-tactical-design" } },
    { summary: "战术设计", sections: {
      "领域模型设计": "INV-01：查询只属于本人。",
      "模块与分层设计": "com.hmdp.entity.trail 放聚合；com.hmdp.service.trail 放应用服务；允许 appservice→mapper(interface)。",
    } },
  )
  const codes = new Set(findings.map((finding) => finding.code))
  assert.ok(codes.has("TACTICAL_APPLICATION_INFRASTRUCTURE_DEPENDENCY"))
  assert.ok(codes.has("TACTICAL_BOUNDED_CONTEXT_MODULE_INCOMPLETE"))
})

test("tactical module gate accepts slash-based context-first layer paths", () => {
  const findings = validateStageSemantics(
    { originalRequest: "新增查询能力" },
    { id: "06-tactical-design", scopeContract: { id: "context-tactical-design" } },
    { summary: "战术设计", sections: {
      "领域模型设计": "INV-01：查询只属于本人。",
      "模块与分层设计": "com.hmdp.trail/ 下包含 domain/、application/、infrastructure/、interfaces/；应用服务依赖 Repository 端口。",
    } },
  )
  assert.ok(!findings.some((finding) => finding.code === "TACTICAL_BOUNDED_CONTEXT_MODULE_INCOMPLETE"))
})

test("tactical module gate accepts layer names in a context-root package tree", () => {
  const findings = validateStageSemantics(
    { originalRequest: "新增查询能力" },
    { id: "06-tactical-design", scopeContract: { id: "context-tactical-design" } },
    { summary: "战术设计", sections: {
      "领域模型设计": "INV-01：查询只属于本人。",
      "模块与分层设计": "com.hmdp.trail 四层包含 domain、application、infrastructure、interfaces；应用服务依赖 Repository 端口。",
    } },
  )
  assert.ok(!findings.some((finding) => finding.code === "TACTICAL_BOUNDED_CONTEXT_MODULE_INCOMPLETE"))
})
