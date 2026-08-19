import { readdir } from "node:fs/promises"
import path from "node:path"
import { exists, readJson, sha256, walkFiles, writeJson } from "./fs.js"
import type { StrategicBaselineSubmission, WorkflowState } from "./types.js"
import { WorkflowError } from "./types.js"

export async function strategicInventory(state: WorkflowState) {
  const openSpec = path.join(state.projectRoot, "openspec")
  const specsRoot = path.join(openSpec, "specs")
  const currentSpecs: any[] = []
  for (const relative of await walkFiles(specsRoot)) if (relative.endsWith("/spec.md") || relative === "spec.md") {
    const file = path.join(specsRoot, ...relative.split("/"))
    currentSpecs.push({ path: path.relative(state.projectRoot, file).replace(/\\/g, "/"), sha256: await sha256(file) })
  }
  const changesRoot = path.join(openSpec, "changes")
  const changes: any[] = []
  const scan = async (directory: string, location: "active" | "archive") => {
    if (!await exists(directory)) return
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === "archive") continue
      const change = path.join(directory, entry.name)
      const traceFile = path.join(change, "ddd-workflow.json")
      if (!await exists(traceFile)) continue
      const trace = await readJson<any>(traceFile)
      const changeId = trace.changeId ?? trace.workflowId
      if (!changeId || changeId === state.workflowId) continue
      const strategic = path.join(change, "ddd", "II-strategic-design.md")
      changes.push({
        changeId, location, path: path.relative(state.projectRoot, change).replace(/\\/g, "/"),
        workflowType: String(trace.workflowType ?? "unknown"), status: String(trace.status ?? "unknown"),
        strategicDesignPath: await exists(strategic) ? path.relative(state.projectRoot, strategic).replace(/\\/g, "/") : null,
        strategicDesignSha256: await exists(strategic) ? await sha256(strategic) : null,
      })
    }
  }
  await scan(changesRoot, "active")
  await scan(path.join(changesRoot, "archive"), "archive")
  return { currentSpecs: currentSpecs.sort((a, b) => a.path.localeCompare(b.path)), changes: changes.sort((a, b) => a.path.localeCompare(b.path)) }
}

export async function strategicBaselinePreparation(root: string, state: WorkflowState, phase: "inventory" | "decision-delta") {
  const sources = await strategicInventory(state)
  const file = path.join(root, ".ddd", "strategic-baseline.json")
  return {
    phase,
    artifact: ".ddd/strategic-baseline.json",
    runtimeOwned: true,
    instruction: "Assess every listed source in submission.strategicBaseline. The engine owns hashes and writes the artifact; never edit it manually.",
    currentSpecs: sources.currentSpecs,
    changes: sources.changes,
    previous: await exists(file) ? await readJson(file) : null,
  }
}

export async function compileStrategicBaseline(root: string, state: WorkflowState, phase: "inventory" | "decision-delta", input: StrategicBaselineSubmission) {
  if (state.workflowType === "create-system") throw new WorkflowError("create-system 不消费历史战略基线")
  const actual = await strategicInventory(state)
  const assess = (declared: Array<{ path: string; relevance: string; reason: string }>, expected: any[], label: string) => {
    if (!Array.isArray(declared) || declared.length !== expected.length) throw new WorkflowError(`${label} 必须逐项评估 prepare_stage 返回的全部来源`)
    const duplicate = new Set<string>()
    return expected.map((source) => {
      const assessment = declared.find((item) => item.path === source.path)
      if (!assessment || duplicate.has(source.path) || !["relevant", "not-relevant"].includes(assessment.relevance) || !assessment.reason?.trim()) {
        throw new WorkflowError(`${label} 来源缺少唯一 relevance/reason 评估：${source.path}`)
      }
      duplicate.add(source.path)
      return { ...source, relevance: assessment.relevance, reason: assessment.reason.trim() }
    })
  }
  const currentSpecs = assess(input.currentSpecs, actual.currentSpecs, "currentSpecs")
  const changes = assess(input.changes, actual.changes, "changes")
  const relevantPaths = new Set([...currentSpecs, ...changes]
    .filter((item: any) => item.relevance === "relevant")
    .map((item: any) => item.strategicDesignPath ?? item.path))
  const recoveredDecisions = []
  const decisionIds = new Set<string>()
  for (const decision of input.recoveredDecisions ?? []) {
    if (!/^BASE-[0-9]{3,}$/.test(decision.id) || decisionIds.has(decision.id) || !relevantPaths.has(decision.sourcePath) || !decision.decision?.trim() || !decision.reason?.trim()) {
      throw new WorkflowError(`恢复的战略决策不合法：${decision.id ?? "?"}`)
    }
    const source = path.join(state.projectRoot, ...decision.sourcePath.split("/"))
    if (!await exists(source)) throw new WorkflowError(`战略决策来源不存在：${decision.sourcePath}`)
    decisionIds.add(decision.id)
    recoveredDecisions.push({ ...decision, sourceSha256: await sha256(source) })
  }
  if (input.unresolvedConflicts?.length || input.strategicDisposition?.conflicts?.length) throw new WorkflowError("战略基线仍有未解决冲突")
  if (phase === "inventory" && input.strategicDisposition?.status !== "pending") throw new WorkflowError("inventory 阶段的 strategicDisposition.status 必须为 pending")
  if (phase === "decision-delta" && input.strategicDisposition?.status !== "proposed") throw new WorkflowError("decision-delta 阶段的 strategicDisposition.status 必须为 proposed")
  const historyIndex = path.join(state.projectRoot, "openspec", "change-history.md")
  if (!await exists(historyIndex)) throw new WorkflowError("缺少 openspec/change-history.md，无法冻结战略历史索引")
  const data = {
    schema: "ddd-strategic-baseline/v1",
    workflowId: state.workflowId,
    workflowType: state.workflowType,
    historyScan: {
      historyIndex: "openspec/change-history.md",
      historyIndexSha256: await sha256(historyIndex),
      currentSpecs,
      changes,
    },
    recoveredDecisions,
    unresolvedConflicts: input.unresolvedConflicts ?? [],
    strategicDisposition: input.strategicDisposition,
  }
  const file = path.join(root, ".ddd", "strategic-baseline.json")
  await writeJson(file, data)
  return validateStrategicBaseline(root, state, phase)
}

export async function validateStrategicBaseline(root: string, state: WorkflowState, phase: "inventory" | "decision-delta") {
  if (state.workflowType === "create-system") throw new WorkflowError("create-system 不消费历史战略基线")
  const file = path.join(root, ".ddd", "strategic-baseline.json")
  if (!await exists(file)) throw new WorkflowError("现有系统工作流缺少 .ddd/strategic-baseline.json")
  const data = await readJson<any>(file)
  if (data.schema !== "ddd-strategic-baseline/v1" || data.workflowId !== state.workflowId || data.workflowType !== state.workflowType) throw new WorkflowError("战略基线身份或 schema 不正确")
  const historyIndex = path.join(state.projectRoot, "openspec", "change-history.md")
  if (!await exists(historyIndex) || data.historyScan?.historyIndex !== "openspec/change-history.md" || data.historyScan.historyIndexSha256 !== await sha256(historyIndex)) throw new WorkflowError("战略基线的 change-history hash 缺失或已过期")
  const actual = await strategicInventory(state)
  const assertSources = (declared: any[], expected: any[], label: string) => {
    if (!Array.isArray(declared) || declared.length !== expected.length) throw new WorkflowError(`${label} 未完整扫描当前 OpenSpec 历史`)
    for (const source of declared) {
      const match = expected.find((item) => item.path === source.path)
      if (!match || match.sha256 && source.sha256 !== match.sha256 || match.strategicDesignSha256 !== undefined && source.strategicDesignSha256 !== match.strategicDesignSha256) throw new WorkflowError(`${label} 来源不存在或 hash 已过期：${source.path}`)
      if (!["relevant", "not-relevant"].includes(source.relevance) || !source.reason) throw new WorkflowError(`${label} 每个来源必须判断 relevance 并说明理由`)
    }
  }
  assertSources(data.historyScan.currentSpecs, actual.currentSpecs, "currentSpecs")
  assertSources(data.historyScan.changes, actual.changes, "changes")
  const relevantPaths = new Set([...data.historyScan.currentSpecs, ...data.historyScan.changes].filter((item: any) => item.relevance === "relevant").map((item: any) => item.strategicDesignPath ?? item.path))
  const recovered = new Map<string, any>()
  for (const decision of data.recoveredDecisions ?? []) {
    if (!/^BASE-[0-9]{3,}$/.test(decision.id) || recovered.has(decision.id) || !relevantPaths.has(decision.sourcePath) || !decision.decision || !decision.reason) throw new WorkflowError(`恢复的战略决策不合法：${decision.id ?? "?"}`)
    const absolute = path.join(state.projectRoot, decision.sourcePath)
    if (!await exists(absolute) || decision.sourceSha256 !== await sha256(absolute)) throw new WorkflowError(`${decision.id} 的来源 hash 已过期`)
    recovered.set(decision.id, decision)
  }
  if ((data.unresolvedConflicts ?? []).length) throw new WorkflowError("战略基线仍有未解决冲突")
  const disposition = data.strategicDisposition
  if (!disposition || (disposition.conflicts ?? []).length) throw new WorkflowError("战略决策处理仍有冲突")
  if (phase === "inventory" && disposition.status !== "pending") throw new WorkflowError("战略基线盘点阶段的 disposition.status 必须为 pending")
  if (phase === "decision-delta") {
    if (disposition.status !== "proposed") throw new WorkflowError("战略设计阶段的 disposition.status 必须为 proposed")
    const handled = [...(disposition.reused ?? []), ...(disposition.changed ?? [])].map((item: any) => item.baselineDecisionId)
    for (const id of recovered.keys()) if (!handled.includes(id)) throw new WorkflowError(`历史战略决策尚未明确复用或变更：${id}`)
    if (new Set(handled).size !== handled.length) throw new WorkflowError("同一 BASE 决策不能同时复用和变更")
  }
  return { phase, path: path.relative(root, file).replace(/\\/g, "/"), sha256: await sha256(file), currentSpecs: actual.currentSpecs.length, priorChanges: actual.changes.length, recoveredDecisions: recovered.size }
}
