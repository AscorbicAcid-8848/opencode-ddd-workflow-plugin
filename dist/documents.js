import { documents } from "./catalog.js";
import { atomicText } from "./fs.js";
import path from "node:path";
const OVERVIEW_HEADINGS = ["一页结论", "本次请您确认"];
const REVIEW_HEADINGS = ["业务验收记录"];
export function overviewSubsections() {
    return {
        "一页结论": ["当前结论", "最新业务增量", "当前状态", "是否需要人工决策"],
        "本次请您确认": ["验收清单", "未决问题", "AI 推荐意见"],
    };
}
const OVERVIEW = ["一页结论", "本次请您确认"];
const EVENT_STORM = ["本次分析边界", "战术事件风暴", "失败矩阵", "业务规则与不变量候选", "模型与边界候选", "持久化与运行热点", "战略回溯检查", "备选模型方向与建议", "证据与追踪"];
const TACTICAL_DESIGN = ["战术设计范围与输入", "应用服务设计", "领域模型设计", "领域交互设计", "持久化与集成设计", "模块与分层设计", "测试设计", "设计与实现一致性清单", "领域模型一致性审查", "备选战术方案与建议", "证据与追踪"];
const DELIVERY_PLAN = ["交付范围", "纵向交付切片", "交付追踪矩阵", "OpenSpec 变更映射", "测试与验证计划", "Git 交付计划", "风险、迁移与上线", "备选交付方案与建议", "证据与追踪"];
/**
 * Orchestration-owned write policy. It deliberately lives outside all child
 * skill prompts: a stage can only replace the milestone sections for which it
 * is the decision owner.
 */
export function writableHeadingsForStage(stage) {
    const byStage = {
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
    };
    const explicit = byStage[stage.id];
    if (explicit)
        return [...new Set(explicit)];
    // Unknown stages fail closed instead of silently gaining write access to a
    // complete milestone document.
    return [];
}
export async function sectionsFor(milestoneKey) {
    const catalog = await documents();
    const doc = catalog.documents?.[milestoneKey];
    if (!doc)
        return [];
    return doc.sections;
}
export function documentFileName(profile, document) {
    return profile.documents[document] ?? `${document}.md`;
}
export function documentPath(root, profile, document) {
    return path.join(root, documentFileName(profile, document));
}
export async function generateSkeleton(profile, milestoneKey, title) {
    const sections = await sectionsFor(milestoneKey);
    const ov = overviewSubsections();
    const lines = [`# ${title}`, ""];
    for (const h of OVERVIEW_HEADINGS) {
        lines.push(`## ${h}`);
        for (const sub of ov[h] ?? [])
            lines.push(`### ${sub}`, "", "> _待填写_", "");
        lines.push("");
    }
    for (const section of sections) {
        lines.push(`## ${section.heading}`);
        for (const sub of section.subsections)
            lines.push(`### ${sub}`, "", "> _待填写_", "");
        lines.push("");
    }
    for (const h of REVIEW_HEADINGS) {
        lines.push(`## ${h}`, "", "> 等待本里程碑人工验收。", "");
    }
    return lines.join("\n").replace(/\n{3,}/g, "\n\n") + "\n";
}
export async function ensureSkeleton(root, profile, milestoneKey) {
    const file = documentPath(root, profile, milestoneKey);
    const title = profile.documentTitles?.[milestoneKey] ?? milestoneKey;
    const { exists } = await import("./fs.js");
    if (!await exists(file))
        await atomicText(file, await generateSkeleton(profile, milestoneKey, title));
    return file;
}
export async function publishSections(root, profile, milestoneKey, sections) {
    const file = await ensureSkeleton(root, profile, milestoneKey);
    const { readFile } = await import("node:fs/promises");
    const body = renderSections(await readFile(file, "utf8"), sections);
    await atomicText(file, body);
    return file;
}
export function renderSections(body, sections) {
    let candidate = body;
    for (const [heading, content] of Object.entries(sections))
        candidate = replaceSection(candidate, heading, normalizeSectionContent(content));
    return candidate;
}
export function normalizeSectionContent(content) {
    return content
        .replace(/\r\n?/gu, "\n")
        .replace(/\\r\\n|\\n|\\r/gu, "\n")
        .replace(/\n{3,}/gu, "\n\n")
        .trim();
}
export function unfilledHeadings(body) {
    const result = [];
    const matches = [...body.matchAll(/^##\s+(.+?)\s*$/gmu)];
    for (let i = 0; i < matches.length; i += 1) {
        const heading = matches[i][1];
        const start = (matches[i].index ?? 0) + matches[i][0].length;
        const end = i + 1 < matches.length ? (matches[i + 1].index ?? body.length) : body.length;
        const content = body.slice(start, end);
        if (heading !== "业务验收记录" && /_待填写_|待本里程碑补充/u.test(content))
            result.push(heading);
    }
    return result;
}
export function documentSections(body) {
    const result = {};
    const matches = [...body.matchAll(/^##\s+(.+?)\s*$/gmu)];
    for (let i = 0; i < matches.length; i += 1) {
        const heading = matches[i][1];
        const start = (matches[i].index ?? 0) + matches[i][0].length;
        const end = i + 1 < matches.length ? (matches[i + 1].index ?? body.length) : body.length;
        result[heading] = body.slice(start, end).trim();
    }
    return result;
}
export async function candidateDocument(root, profile, milestoneKey, sections) {
    const file = documentPath(root, profile, milestoneKey);
    const { readFile } = await import("node:fs/promises");
    const { exists } = await import("./fs.js");
    const title = profile.documentTitles?.[milestoneKey] ?? milestoneKey;
    const body = await exists(file) ? await readFile(file, "utf8") : await generateSkeleton(profile, milestoneKey, title);
    return renderSections(body, sections);
}
function replaceSection(body, heading, content) {
    const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Require an actual level-two heading at the start of a line. Without the
    // boundary, a subsection such as `### 模型与边界候选` also contains the
    // substring `## 模型与边界候选`; the old expression replaced that nested
    // subsection and left the real milestone section's placeholder untouched.
    const re = new RegExp(`(^|\\n)(##[ \\t]+${escaped}[ \\t]*\\r?\\n)([\\s\\S]*?)(?=\\n##[ \\t]|$)`, "u");
    const replacement = `$1$2\n${content.trim()}\n`;
    if (re.test(body))
        return body.replace(re, replacement);
    return `${body.trimEnd()}\n\n## ${heading}\n\n${content.trim()}\n`;
}
//# sourceMappingURL=documents.js.map