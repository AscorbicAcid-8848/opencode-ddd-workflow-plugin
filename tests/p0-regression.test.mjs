import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import {
  compileStructuredPlan,
  deliveryPlanSemanticEvidence,
  normalizeStructuredPlan,
  validateStructuredPlan,
} from "../dist/delivery-plan.js"
import { evidenceBundle } from "../dist/evidence.js"
import {
  BUSINESS_RULE_FAMILIES,
  invariantCoversClause,
  queryPseudoEvents,
  requestedInvariantClauses,
  requestedTermDistinctions,
  textCoversDistinction,
} from "../dist/domain-semantics.js"

const rollback = {
  trigger: "关键验收或兼容性验证失败",
  steps: ["revert 当前切片独立提交", "恢复旧入口委派"],
  verification: ["运行该切片基线场景与特征测试"],
}

const featurePlan = {
  title: "账户摘要",
  objective: "用户能够读取当前账户摘要。",
  nonGoals: ["不新增资金操作"],
  designDecisions: ["沿用批准的账户上下文。"],
  capabilities: [{
    id: "account-summary",
    requirements: [{
      name: "读取账户摘要",
      rule: "返回当前主体可见的账户摘要",
      scenarios: [{ name: "摘要存在", when: "主体请求摘要", then: "返回批准字段" }],
    }],
  }],
  slices: [{
    id: "S1",
    title: "接通摘要读取路径",
    outcome: "真实消费者能够读取摘要",
    consumer: "现有账户页面",
    dependsOn: [],
    acceptanceCriteria: ["批准字段与错误语义保持一致"],
    modelElementIds: ["ME-01"],
    invariantIds: ["INV-01"],
    productionPaths: ["Sources/AccountSummary.swift"],
    testPaths: ["Tests/AccountSummaryTests.swift"],
    verification: ["swift test --filter AccountSummaryTests"],
    compatibility: "保留现有页面调用与响应字段",
    rollback,
  }],
}

const refactorPlan = {
  ...featurePlan,
  title: "账户摘要路径行为保持重构",
  objective: "保持公开调用、错误语义和序列化格式，将规则迁入批准模型。",
  capabilities: featurePlan.capabilities.map((capability) => ({ ...capability, delta: "MODIFIED" })),
  slices: featurePlan.slices.map((slice) => ({
    ...slice,
    behaviorProtection: {
      baselineScenarioRefs: ["BASELINE-account-summary-success", "BASELINE-account-summary-denied"],
      characterizationTests: ["Tests/LegacyAccountSummaryCharacterizationTests.swift"],
      preservedSemantics: ["成功字段、拒绝语义和顺序保持不变"],
      coexistenceStrategy: "旧入口先委派到新用例，切片验收完成前不删除旧适配器",
    },
  })),
}

test("feature plans compile ADDED requirements", () => {
  const plan = normalizeStructuredPlan(featurePlan)
  assert.deepEqual(validateStructuredPlan(plan, { workflowType: "add-feature" }), [])
  const compiled = compileStructuredPlan(plan, "account-summary", { workflowType: "add-feature" })
  assert.match(compiled.specs[0].content, /^## ADDED Requirements/mu)
})

test("refactor plans compile MODIFIED requirements and never silently add behavior", () => {
  const plan = normalizeStructuredPlan(refactorPlan)
  assert.deepEqual(validateStructuredPlan(plan, { workflowType: "refactor-system" }), [])
  const compiled = compileStructuredPlan(plan, "account-summary-refactor", { workflowType: "refactor-system" })
  assert.match(compiled.specs[0].content, /^## MODIFIED Requirements/mu)
  assert.doesNotMatch(compiled.proposal, /新增账户摘要行为契约/u)
})

test("refactor plans reject ADDED capability deltas", () => {
  const plan = normalizeStructuredPlan({
    ...refactorPlan,
    capabilities: refactorPlan.capabilities.map((capability) => ({ ...capability, delta: "ADDED" })),
  })
  const findings = validateStructuredPlan(plan, { workflowType: "refactor-system" })
  assert.ok(findings.some((finding) => finding.code === "PLAN_REFACTOR_ADDED_CAPABILITY"))
})

test("structured planning fails closed for unsupported removal or rename deltas", () => {
  for (const delta of ["REMOVED", "RENAMED"]) {
    const plan = normalizeStructuredPlan({
      ...refactorPlan,
      capabilities: refactorPlan.capabilities.map((capability) => ({ ...capability, delta })),
    })
    const findings = validateStructuredPlan(plan, { workflowType: "refactor-system" })
    assert.ok(findings.some((finding) => finding.code === "PLAN_CAPABILITY_DELTA_INVALID"), delta)
  }
})

test("behavior-preserving refactors may omit specs only when skipSpecs is explicit", () => {
  const plan = normalizeStructuredPlan({ ...refactorPlan, capabilities: [] })
  assert.ok(validateStructuredPlan(plan, { workflowType: "refactor-system" })
    .some((finding) => finding.code === "PLAN_CAPABILITY_REQUIRED"))
  assert.ok(!validateStructuredPlan(plan, { workflowType: "refactor-system", skipSpecs: true })
    .some((finding) => finding.code === "PLAN_CAPABILITY_REQUIRED"))
})

test("skipSpecs cannot silently discard declared behavior deltas", () => {
  const plan = normalizeStructuredPlan(refactorPlan)
  const findings = validateStructuredPlan(plan, { workflowType: "refactor-system", skipSpecs: true })
  assert.ok(findings.some((finding) => finding.code === "PLAN_SKIP_SPECS_CAPABILITY_CONFLICT"))
})

test("legacy prose rollback cannot pass typed rollback validation", () => {
  const plan = normalizeStructuredPlan({
    ...featurePlan,
    slices: featurePlan.slices.map((slice) => ({ ...slice, rollback: "revert commit" })),
  })
  const findings = validateStructuredPlan(plan, { workflowType: "add-feature" })
  assert.ok(findings.some((finding) => finding.code === "PLAN_ROLLBACK_VERIFICATION_REQUIRED"))
})

test("refactor semantic evidence is derived from typed contracts", () => {
  const plan = normalizeStructuredPlan(refactorPlan)
  assert.deepEqual(deliveryPlanSemanticEvidence(plan, { workflowType: "refactor-system" }), {
    sliceCount: 1,
    migrationVerticalSlices: true,
    behaviorProtection: true,
    independentRollback: true,
  })
  const incomplete = normalizeStructuredPlan({
    ...refactorPlan,
    slices: refactorPlan.slices.map((slice) => ({
      ...slice,
      behaviorProtection: { ...slice.behaviorProtection, characterizationTests: [] },
    })),
  })
  assert.equal(deliveryPlanSemanticEvidence(incomplete, { workflowType: "refactor-system" }).behaviorProtection, false)
})

test("evidence bundle scans native mobile sources and signs bounded negative evidence", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "ddd-native-evidence-"))
  try {
    await mkdir(path.join(dir, "Sources", "Ledger"), { recursive: true })
    await writeFile(path.join(dir, "Sources", "Ledger", "PaymentLedger.swift"), [
      "struct PaymentLedger {",
      "  func summary() -> String { return \"ready\" }",
      "}",
    ].join("\n"), "utf8")
    const bundle = await evidenceBundle(dir, "native-evidence", ["PaymentLedger", "UnknownMarker"])
    assert.equal(bundle.searchCoverage.completeness, "complete")
    assert.ok(bundle.searchCoverage.supportedExtensions.includes(".swift"))
    assert.ok(bundle.matches.some((item) => item.file.endsWith("PaymentLedger.swift")))
    assert.ok(bundle.negativeSearchEvidence)
    assert.match(bundle.negativeSearchEvidence.statement, /受支持源码扫描/u)
    assert.doesNotMatch(bundle.negativeSearchEvidence.statement, /完整源码文件扫描/u)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("partial source scans refuse to sign absence evidence", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "ddd-partial-evidence-"))
  try {
    await mkdir(path.join(dir, "Sources"), { recursive: true })
    await writeFile(path.join(dir, "Sources", "A.swift"), "struct A {}\n", "utf8")
    await writeFile(path.join(dir, "Sources", "B.swift"), "struct B {}\n", "utf8")
    const bundle = await evidenceBundle(dir, "partial-evidence", ["MissingAlpha", "MissingBeta"], { fileLimit: 1 })
    assert.equal(bundle.searchCoverage.completeness, "partial")
    assert.equal(bundle.negativeSearchEvidence, null)
    assert.ok(bundle.negativeSearchGap)
    assert.match(bundle.negativeSearchGap.requiredDisposition, /evidence-gap\/open-question/u)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("pseudo-event detection is based on query shape rather than one domain noun", () => {
  const hits = queryPseudoEvents([
    "主体 → 查询账户摘要 → 领域事件：账户摘要已返回",
    "AccountSummaryLoaded",
    "主体 → 查询账户 → returns 账户读模型 → 发起冻结（命令）→ emits 资金已冻结",
  ].join("\n"))
  assert.ok(hits.includes("账户摘要已返回"))
  assert.ok(hits.includes("AccountSummaryLoaded"))
  assert.ok(!hits.includes("资金已冻结"))
  assert.ok(!queryPseudoEvents("CargoLoaded").includes("CargoLoaded"), "state-changing logistics events must not be treated as query results")
})

test("business rule families contain no shop-visit vocabulary", () => {
  const source = BUSINESS_RULE_FAMILIES.map((item) => String(item.pattern)).join("\n")
  assert.doesNotMatch(source, /店铺|轨迹|签到/u)
})

test("invariant and terminology protection works across domains", () => {
  const cardinality = requestedInvariantClauses("每次成功扣款必须恰好生成一条账务事实。", "cardinality")
  assert.equal(cardinality.length, 1)
  assert.equal(invariantCoversClause("INV-01 每次成功扣款恰好生成一条账务事实。", cardinality[0]), true)
  assert.equal(invariantCoversClause("INV-01 保存记录。", cardinality[0]), false)

  const distinctions = requestedTermDistinctions("资金冻结不等于实际扣款。")
  assert.deepEqual(distinctions.map(({ left, right }) => ({ left, right })), [{ left: "资金冻结", right: "实际扣款" }])
  assert.equal(textCoversDistinction("领域语言：资金冻结不等于实际扣款。", distinctions[0]), true)
  assert.equal(textCoversDistinction("领域语言只定义资金冻结。", distinctions[0]), false)
})
