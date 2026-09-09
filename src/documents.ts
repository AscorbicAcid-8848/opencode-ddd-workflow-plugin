import { documents } from "./catalog.js"
import { atomicText } from "./fs.js"
import path from "node:path"
import type { StageContract, WorkflowProfile } from "./types.js"

export interface DocSection { heading: string; subsections: string[] }

const OVERVIEW_HEADINGS = ["一页结论", "本次请您确认"]
const REVIEW_HEADINGS = ["业务验收记录"]

const READER_PARTS = ["一、本阶段结论", "二、分析范围与依据", "三、阶段分析", "四、需要你确认的事项", "五、补充依据"]
const READER_LABELS: Record<string, string> = {
  "一页结论": "关键结论与当前状态", "本次请您确认": "待确认的问题与推荐意见",
  "战略事件风暴": "业务从触发到结果如何流转", "异常、补偿与时间约束": "流程中断、补救与时间限制",
  "热点与边界线索": "哪些职责可能需要分开", "子域划分": "业务能力如何分组",
  "限界上下文": "各部分负责什么、不负责什么", "上下文映射": "各部分怎样交接与协作",
  "工程承载关系": "这些职责由哪些模块或服务承载", "实现单元用例包": "本轮详细设计的业务场景",
  "战术事件风暴": "一个具体场景怎样完成", "失败矩阵": "失败情况分别怎样处理",
  "业务规则与不变量候选": "哪些规则必须始终成立", "模型与边界候选": "哪些业务对象可能负责这些规则",
  "应用服务设计": "一次业务操作如何协调完成", "领域模型设计": "核心业务对象及其职责",
  "领域交互设计": "业务对象之间如何协作", "持久化与集成设计": "数据如何保存、外部系统如何连接",
  "模块与分层设计": "代码职责如何分工", "纵向交付切片": "分几批交付，每批带来什么价值",
  "最终业务验收矩阵": "逐项核对业务是否达成", "测试与运行证据": "实际验证了什么，结果如何",
  "设计与实现一致性清单": "实现必须遵守哪些设计约定", "领域模型一致性审查": "业务规则与设计是否一致",
  "证据与追踪": "结论依据与来源", "业务验收记录": "审核与修订记录",
}
function readerLabel(heading: string): string {
  return READER_LABELS[heading] ? `${READER_LABELS[heading]}（${heading}）` : heading
}
function canonicalLabel(label: string): string {
  return Object.keys(READER_LABELS).find(key => readerLabel(key) === label) ?? label
}
function readerSections(body: string) {
  let offset = 0, fence = ""
  const headings: Array<{level:number; label:string; start:number; content:number}> = []
  for (const line of body.split(/(?<=\n)/u)) {
    const marker = line.match(/^\s*(`{3,}|~{3,})/u)?.[1]
    if (marker) {
      if (!fence) fence = marker
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = ""
    } else if (!fence) {
      const heading = line.match(/^(#{2,3}) (.+?)\s*$/u)
      if (heading) headings.push({level:heading[1].length,label:heading[2],start:offset,content:offset+line.length})
    }
    offset += line.length
  }
  return headings.flatMap((h, i) => h.level === 3 ? [{...h,end:headings[i+1]?.start ?? body.length}] : [])
}
const PURPOSES: Record<string, string> = {
  milestoneI: "梳理业务从触发到结果的全貌，确认现状、异常和边界线索；本阶段不决定服务拆分或代码模型。",
  milestoneII: "确定业务分组、职责边界和协作方式，明确进入详细设计的用例；本阶段不设计聚合、类或数据表。",
  milestoneIII: "细化选定范围内的正常与失败流程，发现必须守住的规则和模型候选；本阶段不定稿代码与存储设计。",
  milestoneIV: "确定业务对象、规则归属、应用协调及持久化设计，为实现提供依据；设计方案不等于已实现结果。",
  milestoneV: "安排可独立验收的交付批次、依赖、验证与回滚；计划执行的测试不代表已经通过。",
  milestoneVI: "核对实际交付、测试和运行证据，说明差异与限制；重构还需核对修改前后行为是否一致。",
}
const READER_CHECKS: Record<string, string[]> = {
  milestoneI: ["从业务触发到最终结果是否说清楚，事件之间为什么会衔接？", "参与者、失败分支和时间限制是否有遗漏？", "哪些是现有事实、哪些是新建议或未知，是否区分清楚？"],
  milestoneII: ["业务分组及各部分负责、不负责的事项是否合理？", "协作交接、现有架构的沿用与调整是否明确？", "本轮进入详细设计的用例范围是否符合预期？"],
  milestoneIII: ["具体用例的正常与失败流程是否完整？", "必须始终成立的规则、重复操作和状态变化是否清楚？", "模型候选是否有业务依据，而非提前定下实现方案？"],
  milestoneIV: ["核心业务对象能否承担相应规则，职责是否清晰？", "业务操作的协调、数据保存和外部协作是否完整？", "设计的理由、代价以及与已批准用例的对应关系是否明确？"],
  milestoneV: ["每批交付的价值、范围、顺序和依赖是否合理？", "每批怎样验收，迁移失败怎样回滚，是否可执行？", "是否明确区分交付计划与尚未执行的验证？"],
  milestoneVI: ["实际交付是否满足批准的范围，如何体验和验收？", "测试和真实链路证据是否支持交付结论，重构前后行为是否一致？", "未完成事项、风险、限制和回滚办法是否如实说明？"],
}

/** Presentation only: preserve canonical sections for validators and dashboard consumers. */
export function renderReaderDocument(title: string, milestone: string, sections: Record<string, string>): string {
  const buckets: string[][] = READER_PARTS.map(() => [])
  for (const [heading, content] of Object.entries(sections)) {
    const bucket = heading === "一页结论" ? 0 : heading === "本次请您确认" ? 3
      : ["证据与追踪", "业务验收记录"].includes(heading) ? 4
      : /范围|输入场景与现状事实|历史战略决策处理/u.test(heading) ? 1 : 2
    // Lower Markdown headings, but never rewrite code/Mermaid fenced content.
    let fenced = false
    const nested = content.split("\n").map(line => {
      if (/^\s*(```|~~~)/u.test(line)) { fenced = !fenced; return line }
      return !fenced && /^#{3,5} /u.test(line) ? `#${line}` : line
    }).join("\n")
    buckets[bucket].push(`### ${readerLabel(heading)}\n\n${nested}`)
  }
  return [`# ${title}`, `> 本阶段目的：${PURPOSES[milestone] ?? "核对当前阶段的业务结论与依据。"}`,
    ...READER_PARTS.map((heading, i) => `## ${heading}\n\n${buckets[i].join("\n\n")}`)].join("\n\n") + "\n"
}

export function overviewSubsections(): Record<string, string[]> {
  return {
    "一页结论": ["当前结论", "最新业务增量", "当前状态", "是否需要人工决策"],
    "本次请您确认": ["验收清单", "未决问题", "AI 推荐意见"],
  }
}

const OVERVIEW = ["一页结论", "本次请您确认"]
const EVENT_STORM = ["本次分析边界", "战术事件风暴", "失败矩阵", "业务规则与不变量候选", "模型与边界候选", "持久化与运行热点", "战略回溯检查", "备选模型方向与建议", "证据与追踪"]
const TACTICAL_DESIGN = ["战术设计范围与输入", "应用服务设计", "领域模型设计", "领域交互设计", "持久化与集成设计", "模块与分层设计", "测试设计", "设计与实现一致性清单", "领域模型一致性审查", "备选战术方案与建议", "证据与追踪"]
const DELIVERY_PLAN = ["交付范围", "纵向交付切片", "交付追踪矩阵", "OpenSpec 变更映射", "测试与验证计划", "Git 交付计划", "风险、迁移与上线", "备选交付方案与建议", "证据与追踪"]

/**
 * Orchestration-owned write policy. It deliberately lives outside all child
 * skill prompts: a stage can only replace the milestone sections for which it
 * is the decision owner.
 */
export function writableHeadingsForStage(stage: StageContract): string[] {
  const byStage: Record<string, string[]> = {
    "00-request": [],
    "01-current-evidence": ["输入场景与现状事实", "证据与追踪"],
    "01-baseline-evidence": ["输入场景与现状事实", "证据与追踪"],
    "01-refactoring-scope-convergence": ["业务主题与分析范围", "输入场景与现状事实", "备选解释与建议", "证据与追踪"],
    "01-system-scenarios": ["业务主题与分析范围", "输入场景与现状事实", "备选解释与建议", "证据与追踪"],
    "02-big-picture-event-storm": [...OVERVIEW, "业务主题与分析范围", "战略事件风暴", "异常、补偿与时间约束", "热点与边界线索", "备选解释与建议", "证据与追踪"],
    "02-as-is-big-picture-event-storm": [...OVERVIEW, "业务主题与分析范围", "战略事件风暴", "异常、补偿与时间约束", "热点与边界线索", "备选解释与建议", "证据与追踪"],
    "03-strategic-impact": ["战略设计范围与输入", "子域划分", "限界上下文", "上下文映射", "工程承载关系", "历史战略决策处理", "备选战略方案与建议", "证据与追踪"],
    "03-target-strategy": ["战略设计范围与输入", "子域划分", "限界上下文", "上下文映射", "工程承载关系", "历史战略决策处理", "备选战略方案与建议", "证据与追踪"],
    "03-subdomains": ["战略设计范围与输入", "子域划分", "证据与追踪"],
    "04-bounded-contexts": ["限界上下文", "历史战略决策处理", "证据与追踪"],
    "05-context-map": ["上下文映射", "工程承载关系", "历史战略决策处理", "备选战略方案与建议", "证据与追踪"],
    "04-service-use-cases": [...OVERVIEW, "实现单元用例包", "备选战略方案与建议", "证据与追踪"],
    "06-service-use-cases": [...OVERVIEW, "实现单元用例包", "备选战略方案与建议", "证据与追踪"],
    "05-design-level-event-storm": [...OVERVIEW, ...EVENT_STORM],
    "05-pilot-design-level-event-storm": [...OVERVIEW, ...EVENT_STORM],
    "07-design-level-event-storm": [...OVERVIEW, ...EVENT_STORM],
    "06-tactical-design": ["战术设计范围与输入", "应用服务设计", "领域模型设计", "领域交互设计", "持久化与集成设计", "模块与分层设计", "测试设计", "设计与实现一致性清单", "备选战术方案与建议", "证据与追踪"],
    "06-pilot-tactical-design": [...OVERVIEW, ...TACTICAL_DESIGN],
    "07-model-review": [...OVERVIEW, "设计与实现一致性清单", "领域模型一致性审查", "备选战术方案与建议", "证据与追踪"],
    "08-tactical-design": ["战术设计范围与输入", "应用服务设计", "领域模型设计", "领域交互设计", "持久化与集成设计", "模块与分层设计", "测试设计", "设计与实现一致性清单", "备选战术方案与建议", "证据与追踪"],
    "09-architecture-review": [...OVERVIEW, "设计与实现一致性清单", "领域模型一致性审查", "备选战术方案与建议", "证据与追踪"],
    "09-model-review": ["最终业务验收矩阵", "设计与代码一致性", "架构一致性", "兼容性、上线与遗留问题", "证据与追踪"],
    "08-roadmap": [...OVERVIEW, ...DELIVERY_PLAN],
    "07-migration-roadmap": [...OVERVIEW, ...DELIVERY_PLAN],
    "10-roadmap": [...OVERVIEW, ...DELIVERY_PLAN],
    "09-implementation": ["已交付范围", "设计与代码一致性", "架构一致性", "测试与运行证据", "Git 与回滚证据", "兼容性、上线与遗留问题", "OpenSpec 完成状态", "证据与追踪"],
    "08-implementation": ["已交付范围", "设计与代码一致性", "架构一致性", "测试与运行证据", "Git 与回滚证据", "兼容性、上线与遗留问题", "OpenSpec 完成状态", "证据与追踪"],
    "11-implementation": ["已交付范围", "设计与代码一致性", "架构一致性", "测试与运行证据", "Git 与回滚证据", "兼容性、上线与遗留问题", "OpenSpec 完成状态", "证据与追踪"],
    "10-final-review": [...OVERVIEW, "最终业务验收矩阵", "最终验收决定", "兼容性、上线与遗留问题", "OpenSpec 完成状态", "证据与追踪"],
    "12-final-review": [...OVERVIEW, "最终业务验收矩阵", "最终验收决定", "兼容性、上线与遗留问题", "OpenSpec 完成状态", "证据与追踪"],
  }
  const explicit = byStage[stage.id]
  if (explicit) return [...new Set(explicit)].filter((heading) =>
    !OVERVIEW_HEADINGS.includes(heading) && !REVIEW_HEADINGS.includes(heading))
  // Unknown stages fail closed instead of silently gaining write access to a
  // complete milestone document.
  return []
}

export function stageArtifactPath(root: string, stage: StageContract): string {
  return path.join(root, ".ddd", "stages", `${stage.id}.md`)
}

async function generateStageSkeleton(profile: WorkflowProfile, stage: StageContract): Promise<string> {
  const allowed = writableHeadingsForStage(stage)
  const contracts = new Map((await sectionsFor(stage.document)).map((section) => [section.heading, section.subsections]))
  const lines: string[] = [`# 阶段 ${stage.id}：${String(stage.artifactTitle ?? stage.id)}`, ""]
  for (const heading of allowed) {
    lines.push(`## ${heading}`, "")
    for (const subsection of contracts.get(heading) ?? []) lines.push(`### ${subsection}`, "", "> _待填写_", "")
  }
  return lines.join("\n").replace(/\n{3,}/gu, "\n\n").trimEnd() + "\n"
}

export async function candidateStageDocument(
  root: string,
  profile: WorkflowProfile,
  stage: StageContract,
  sections: Record<string, string>,
): Promise<string> {
  const file = stageArtifactPath(root, stage)
  const { readFile } = await import("node:fs/promises")
  const { exists } = await import("./fs.js")
  const body = await exists(file) ? await readFile(file, "utf8") : await generateStageSkeleton(profile, stage)
  return renderSections(body, sections)
}

export async function publishStageSections(
  root: string,
  profile: WorkflowProfile,
  stage: StageContract,
  sections: Record<string, string>,
): Promise<string> {
  const file = stageArtifactPath(root, stage)
  await atomicText(file, await candidateStageDocument(root, profile, stage, sections))
  return file
}

export async function compileMilestoneDocument(
  root: string,
  profile: WorkflowProfile,
  summaryStage: StageContract,
  summaries: Array<{ stage: StageContract; summary: string; sections: Record<string, string> }>,
  decisionReview: string,
): Promise<{ file: string; body: string; sections: Record<string, string> }> {
  const title = profile.documentTitles?.[summaryStage.document] ?? summaryStage.document
  let body = await generateSkeleton(profile, summaryStage.document, title)
  const merged: Record<string, string[]> = {}
  const milestoneHeadings = new Set((await sectionsFor(summaryStage.document)).map((section) => section.heading))
  for (const item of summaries) {
    for (const [heading, content] of Object.entries(item.sections)) {
      if (!milestoneHeadings.has(heading) || !content.trim()) continue
      ;(merged[heading] ??= []).push(content.trim())
    }
  }
  const conclusions = [...new Set(summaries.map((item) => item.summary.trim()))].map(text => `- ${text}`).join("\n")
  const reviewChecklist = (READER_CHECKS[summaryStage.document] ?? summaryStage.checklist ?? []).map((item) => `- ${item}`).join("\n") || "- 核对正文是否符合业务认知。"
  const decisionCount = (decisionReview.match(/^###\s+DEC-/gmu) ?? []).length
  const overview = [
    "### 当前结论", "", conclusions || "- 本里程碑的阶段产物已经完成汇总。", "",
    "### 当前状态", "", "等待人工验收。", "",
    "### 是否需要人工决策", "", decisionCount ? `存在 ${decisionCount} 项待人工选择的业务决策。` : "没有待选择的业务决策；仍需确认整体结论。",
  ].join("\n")
  const review = [
    "### 验收清单", "", reviewChecklist, "",
    "### 未决问题", "", decisionReview, "",
    "### AI 推荐意见", "", decisionCount ? "请优先核对每项标注为“推荐”的选项及其业务影响。" : "建议批准前重点核对阶段结论、职责边界和验收标准。",
  ].join("\n")
  body = renderSections(body, {
    ...Object.fromEntries(Object.entries(merged).map(([heading, values]) => [heading, values.join("\n\n")])),
    "一页结论": overview,
    "本次请您确认": review,
    "业务验收记录": "- 验收状态：待人工验收\n- 请以当前罗马数字文档为准。",
  })
  const canonical = documentSections(body)
  canonical["证据与追踪"] = [canonical["证据与追踪"] ?? "", "### 分析来源", "",
    ...summaries.map(item => `- [${String(item.stage.artifactTitle ?? item.stage.id)}](.ddd/stages/${item.stage.id}.md)`) ].join("\n")
  body = renderReaderDocument(title, summaryStage.document, canonical)
  const file = documentPath(root, profile, summaryStage.document)
  await atomicText(file, body)
  return { file, body, sections: documentSections(body) }
}

export async function sectionsFor(milestoneKey: string): Promise<DocSection[]> {
  const catalog = await documents()
  const doc = catalog.documents?.[milestoneKey]
  if (!doc) return []
  return doc.sections as DocSection[]
}

export function documentFileName(profile: WorkflowProfile, document: string): string {
  return profile.documents[document] ?? `${document}.md`
}

export function documentPath(root: string, profile: WorkflowProfile, document: string): string {
  return path.join(root, documentFileName(profile, document))
}

export async function generateSkeleton(profile: WorkflowProfile, milestoneKey: string, title: string): Promise<string> {
  const sections = await sectionsFor(milestoneKey)
  const ov = overviewSubsections()
  const lines: string[] = [`# ${title}`, ""]
  for (const h of OVERVIEW_HEADINGS) {
    lines.push(`## ${h}`)
    for (const sub of ov[h] ?? []) lines.push(`### ${sub}`, "", "> _待填写_", "")
    lines.push("")
  }
  for (const section of sections) {
    lines.push(`## ${section.heading}`)
    for (const sub of section.subsections) lines.push(`### ${sub}`, "", "> _待填写_", "")
    lines.push("")
  }
  for (const h of REVIEW_HEADINGS) {
    lines.push(`## ${h}`, "", "> 等待本里程碑人工验收。", "")
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n") + "\n"
}

export async function ensureSkeleton(root: string, profile: WorkflowProfile, milestoneKey: string): Promise<string> {
  const file = documentPath(root, profile, milestoneKey)
  const title = profile.documentTitles?.[milestoneKey] ?? milestoneKey
  const { exists } = await import("./fs.js")
  if (!await exists(file)) await atomicText(file, await generateSkeleton(profile, milestoneKey, title))
  return file
}

export async function publishSections(
  root: string,
  profile: WorkflowProfile,
  milestoneKey: string,
  sections: Record<string, string>,
): Promise<string> {
  const file = await ensureSkeleton(root, profile, milestoneKey)
  const { readFile } = await import("node:fs/promises")
  const body = renderSections(await readFile(file, "utf8"), sections)
  await atomicText(file, body)
  return file
}

export function renderSections(body: string, sections: Record<string, string>): string {
  let candidate = body
  for (const [heading, content] of Object.entries(sections)) candidate = replaceSection(candidate, heading, normalizeSectionContent(content))
  return candidate
}

export function normalizeSectionContent(content: string): string {
  return content
    .replace(/\r\n?/gu, "\n")
    .replace(/\\r\\n|\\n|\\r/gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim()
}

export function unfilledHeadings(body: string): string[] {
  const result: string[] = []
  const matches = [...body.matchAll(/^##\s+(.+?)\s*$/gmu)]
  for (let i = 0; i < matches.length; i += 1) {
    const heading = matches[i][1]
    const start = (matches[i].index ?? 0) + matches[i][0].length
    const end = i + 1 < matches.length ? (matches[i + 1].index ?? body.length) : body.length
    const content = body.slice(start, end)
    if (heading !== "业务验收记录" && /_待填写_|待本里程碑补充/u.test(content)) result.push(heading)
  }
  return result
}

export function documentSections(body: string): Record<string, string> {
  if (body.includes(`\n## ${READER_PARTS[0]}\n`)) {
    const result: Record<string, string> = {}
    for (const section of readerSections(body)) {
      let fenced = false
      result[canonicalLabel(section.label)] = body.slice(section.content, section.end).trim().split("\n").map(line => {
        if (/^\s*(```|~~~)/u.test(line)) { fenced = !fenced; return line }
        return !fenced && /^#{4,6} /u.test(line) ? line.slice(1) : line
      }).join("\n")
    }
    return result
  }
  const result: Record<string, string> = {}
  const matches = [...body.matchAll(/^##\s+(.+?)\s*$/gmu)]
  for (let i = 0; i < matches.length; i += 1) {
    const heading = matches[i][1]
    const start = (matches[i].index ?? 0) + matches[i][0].length
    const end = i + 1 < matches.length ? (matches[i + 1].index ?? body.length) : body.length
    result[heading] = body.slice(start, end).trim()
  }
  return result
}

export async function candidateDocument(
  root: string,
  profile: WorkflowProfile,
  milestoneKey: string,
  sections: Record<string, string>,
): Promise<string> {
  const file = documentPath(root, profile, milestoneKey)
  const { readFile } = await import("node:fs/promises")
  const { exists } = await import("./fs.js")
  const title = profile.documentTitles?.[milestoneKey] ?? milestoneKey
  const body = await exists(file) ? await readFile(file, "utf8") : await generateSkeleton(profile, milestoneKey, title)
  return renderSections(body, sections)
}

function replaceSection(body: string, heading: string, content: string): string {
  if (body.includes(`\n## ${READER_PARTS[0]}\n`)) {
    const section = readerSections(body).find(s => canonicalLabel(s.label) === heading)
    if (section) return body.slice(0, section.content) + `\n${content.replace(/^### /gmu, "#### ").trim()}\n\n` + body.slice(section.end)
    throw new Error(`Unknown reader document section: ${heading}`)
  }
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  // Require an actual level-two heading at the start of a line. Without the
  // boundary, a subsection such as `### 模型与边界候选` also contains the
  // substring `## 模型与边界候选`; the old expression replaced that nested
  // subsection and left the real milestone section's placeholder untouched.
  const re = new RegExp(`(^|\\n)(##[ \\t]+${escaped}[ \\t]*\\r?\\n)([\\s\\S]*?)(?=\\n##[ \\t]|$)`, "u")
  // Use a callback rather than a replacement template. Domain text commonly
  // contains regexes such as `^u-[a-z0-9-]+$`; when followed by Markdown's
  // closing backtick that forms JavaScript's special `$`` replacement token
  // and injects the complete document prefix into the section.
  if (re.test(body)) return body.replace(re, (_match, prefix: string, headingLine: string) =>
    `${prefix}${headingLine}\n${content.trim()}\n`)
  return `${body.trimEnd()}\n\n## ${heading}\n\n${content.trim()}\n`
}
