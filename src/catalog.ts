import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import type { StageContract, WorkflowProfile, WorkflowType } from "./types.js"
import { WorkflowError } from "./types.js"

const packageRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const references = path.join(packageRoot, "resources", "references")

let profileCache: Record<string, WorkflowProfile> | undefined
let documentCache: any | undefined

async function loadJson(name: string): Promise<any> {
  return JSON.parse(await readFile(path.join(references, name), "utf8"))
}

export async function profiles(): Promise<Record<string, WorkflowProfile>> {
  if (profileCache) return profileCache
  const catalog = await loadJson("workflow-profiles.json")
  profileCache = catalog.profiles as Record<string, WorkflowProfile>
  return profileCache
}

export async function documents(): Promise<any> {
  return documentCache ??= await loadJson("milestone-document-contracts.json")
}

export async function profileFor(type: WorkflowType): Promise<WorkflowProfile> {
  const all = await profiles()
  const profile = all[type]
  if (!profile) throw new WorkflowError(`Unknown workflow type: ${type}`)
  return structuredClone(profile)
}

export function stageContract(profile: WorkflowProfile, stageId: string): StageContract {
  const stage = profile.stages.find((s) => s.id === stageId)
  if (!stage) throw new WorkflowError(`Unknown stage: ${stageId}`)
  return stage
}

export function stageIndex(profile: WorkflowProfile, stageId: string): number {
  const i = profile.stages.findIndex((s) => s.id === stageId)
  if (i < 0) throw new WorkflowError(`Unknown stage: ${stageId}`)
  return i
}

export function milestoneFor(profile: WorkflowProfile, document: string | undefined) {
  return profile.milestones.find((m) => m.document === document) ?? null
}

export function writersOf(profile: WorkflowProfile, document: string): StageContract[] {
  return profile.stages.filter((s) => s.document === document)
}

export function nextHumanGateAfter(profile: WorkflowProfile, afterIndex: number): string | null {
  return profile.stages.slice(afterIndex + 1).find((s) => s.humanGate)?.id ?? null
}

export function documentFileName(profile: WorkflowProfile, document: string): string {
  return profile.documents[document] ?? `${document}.md`
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
