import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import type { StageContract, WorkflowProfile, WorkflowType } from "./types.js"
import { WorkflowError } from "./types.js"

const packageRoot = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))))
const references = path.join(packageRoot, "resources", "skills", "ddd-orchestrate", "references")

let profileCatalog: any
let intrinsicCatalog: any
let documentCatalog: any

async function json(name: string): Promise<any> {
  return JSON.parse(await readFile(path.join(references, name), "utf8"))
}

export async function profiles(): Promise<any> {
  return profileCatalog ??= await json("workflow-profiles.json")
}

export async function intrinsics(): Promise<any> {
  return intrinsicCatalog ??= await json("stage-intrinsic-contracts.json")
}

export async function documents(): Promise<any> {
  return documentCatalog ??= await json("milestone-document-contracts.json")
}

export async function profileFor(type: WorkflowType): Promise<WorkflowProfile> {
  const catalog = await profiles()
  const source = catalog.profiles[type]
  if (!source) throw new WorkflowError(`Unknown workflow type: ${type}`)
  const profile = structuredClone(source) as WorkflowProfile
  const intrinsic = await intrinsics()
  for (const stage of profile.stages) {
    const contractId = intrinsic.stageBindings?.[type]?.[stage.id]
    const contract = intrinsic.contracts?.[contractId]
    if (!contractId || !contract) throw new WorkflowError(`阶段缺少内禀属性契约：${type}/${stage.id}`)
    stage.intrinsicContract = { id: contractId }
    stage.scopeContract ??= { id: contract.scopeId }
    if (stage.scopeContract.id !== contract.scopeId) {
      throw new WorkflowError(`阶段 Scope 与内禀契约不一致：${type}/${stage.id}`)
    }
  }
  validateTopology(profile)
  return profile
}

export async function intrinsicFor(type: WorkflowType, stageId: string): Promise<[string, any]> {
  const catalog = await intrinsics()
  const id = catalog.stageBindings?.[type]?.[stageId]
  const contract = catalog.contracts?.[id]
  if (!id || !contract) throw new WorkflowError(`阶段缺少内禀属性契约：${type}/${stageId}`)
  return [id, contract]
}

export function stageContract(profile: WorkflowProfile, stageId: string): StageContract {
  const stage = profile.stages.find((item) => item.id === stageId)
  if (!stage) throw new WorkflowError(`Unknown stage: ${stageId}`)
  return stage
}

export function stageIndex(profile: WorkflowProfile, stageId: string): number {
  const index = profile.stages.findIndex((item) => item.id === stageId)
  if (index < 0) throw new WorkflowError(`Unknown stage: ${stageId}`)
  return index
}

export function validateTopology(profile: WorkflowProfile): void {
  for (const milestone of profile.milestones) {
    const writers = profile.stages.filter((stage) => stage.document === milestone.document)
    const gates = writers.filter((stage) => stage.humanGate)
    if (!writers.length || gates.length !== 1 || writers.at(-1)?.id !== gates[0]?.id) {
      throw new WorkflowError(`里程碑 ${milestone.roman} 必须恰有一个位于最后 writer 的人工关卡`)
    }
  }
}

export const stageTitles: Record<string, string> = {
  "00-request": "用户目标与工作流选择",
  "01-current-evidence": "当前业务行为与系统证据",
  "01-refactoring-scope-convergence": "重构目标收敛与试点切面建议",
  "01-baseline-evidence": "现状基线与行为保护",
  "01-system-scenarios": "系统级用户场景",
  "02-big-picture-event-storm": "系统场景与大图事件风暴",
  "02-as-is-big-picture-event-storm": "现状大图事件风暴与领域恢复",
  "03-strategic-impact": "新增功能的战略影响",
  "03-target-strategy": "目标战略设计",
  "03-subdomains": "子域识别与分类",
  "04-service-use-cases": "服务职责与用例交接",
  "04-bounded-contexts": "限界上下文与通用语言",
  "05-design-level-event-storm": "服务级事件风暴",
  "05-pilot-design-level-event-storm": "试点服务事件风暴",
  "05-context-map": "上下文映射与服务协作",
  "06-tactical-design": "战术领域设计",
  "06-pilot-tactical-design": "试点战术领域设计",
  "06-service-use-cases": "微服务职责与用例交接",
  "07-model-review": "领域模型一致性评审",
  "07-migration-roadmap": "渐进式迁移计划",
  "07-design-level-event-storm": "微服务级事件风暴",
  "08-roadmap": "功能交付路线图",
  "08-implementation": "重构实现增量",
  "08-tactical-design": "微服务战术设计",
  "09-implementation": "功能实现增量",
  "09-model-review": "迁移模型评审",
  "09-architecture-review": "整体领域模型评审",
  "10-final-review": "最终业务验收",
  "10-roadmap": "首期交付路线图",
  "11-implementation": "系统实现增量",
  "12-final-review": "系统首期验收",
}

export const stageTitle = (stage: StageContract) => stageTitles[stage.id] ?? stage.id
