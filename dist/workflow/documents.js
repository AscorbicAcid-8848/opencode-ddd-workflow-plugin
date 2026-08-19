import { readFile } from "node:fs/promises";
import path from "node:path";
import { atomicText, exists } from "./fs.js";
import { documents, stageTitle } from "./catalog.js";
import { documentPath } from "./paths.js";
import { WorkflowError } from "./types.js";
export const OVERVIEW_START = "<!-- ddd-overview:start -->";
export const OVERVIEW_END = "<!-- ddd-overview:end -->";
export const DETAIL_START = "<!-- ddd-details:start -->";
export const DETAIL_END = "<!-- ddd-details:end -->";
export const REVIEW_LOG = "<!-- ddd-review-log -->";
export const STAGE_MARKERS_START = "<!-- ddd-stage-markers:start -->";
export const STAGE_MARKERS_END = "<!-- ddd-stage-markers:end -->";
function section(item) {
    return [`## ${item.heading}`, ...item.subsections.map((heading) => `### ${heading}\n\n- 待本里程碑补充。`)].join("\n\n");
}
export async function documentTemplate(title, key) {
    const catalog = await documents();
    const contract = catalog.documents[key];
    if (!contract)
        throw new WorkflowError(`Unknown milestone document contract: ${key}`);
    const overview = catalog.commonOverview.map(section).join("\n\n");
    const details = contract.sections.map(section).join("\n\n");
    return `# ${title}：${contract.title}\n\n${OVERVIEW_START}\n${overview}\n${OVERVIEW_END}\n\n${DETAIL_START}\n${STAGE_MARKERS_START}\n${STAGE_MARKERS_END}\n\n${details}\n${DETAIL_END}\n\n## 业务验收记录\n\n${REVIEW_LOG}\n`;
}
export async function ensureDocumentSet(root, profile, title) {
    for (const milestone of profile.milestones) {
        const writer = profile.stages.find((stage) => stage.document === milestone.document);
        if (!writer)
            continue;
        const file = documentPath(root, profile, writer);
        if (!await exists(file))
            await atomicText(file, await documentTemplate(title, milestone.document));
    }
}
export function stageMarker(stageId) { return `<!-- ddd-stage:${stageId} -->`; }
export function scopeMarker(scopeId) { return `<!-- ddd-scope:${scopeId} -->`; }
export function addHiddenStageMetadata(content, stage) {
    const marker = stageMarker(stage.id);
    if (content.includes(marker))
        return content;
    const scope = stage.scopeContract?.id ? `\n${scopeMarker(stage.scopeContract.id)}` : "";
    const addition = `${marker}${scope}`;
    return content.replace(STAGE_MARKERS_END, `${addition}\n${STAGE_MARKERS_END}`);
}
export async function validateFixedStructure(content, documentKey) {
    const catalog = await documents();
    const contract = catalog.documents[documentKey];
    const expected = [
        ...catalog.commonOverview.flatMap((item) => [item.heading, ...item.subsections]),
        ...contract.sections.flatMap((item) => [item.heading, ...item.subsections]),
        "业务验收记录",
    ];
    const actual = [...content.matchAll(/^#{2,3} ([^\r\n]+)\s*$/gm)].map((match) => match[1].trim());
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new WorkflowError(`${documentKey} 固定目录结构被修改；不得增删、重排或重命名标题`);
    }
    for (const token of [OVERVIEW_START, OVERVIEW_END, DETAIL_START, DETAIL_END, REVIEW_LOG, STAGE_MARKERS_START, STAGE_MARKERS_END]) {
        if (!content.includes(token))
            throw new WorkflowError(`${documentKey} 缺少固定结构标记：${token}`);
    }
}
export function topLevelSections(content) {
    const matches = [...content.matchAll(/^## ([^\r\n]+)\s*$/gm)];
    const sections = {};
    matches.forEach((match, index) => {
        const start = (match.index ?? 0) + match[0].length;
        const end = matches[index + 1]?.index ?? content.length;
        sections[match[1].trim()] = content.slice(start, end).trim();
    });
    return sections;
}
const comparable = (value) => value.replace(/<!--\s*ddd-.*?-->/gs, "").trim();
export async function changedSections(formalFile, candidateFile) {
    const formal = topLevelSections(await readFile(formalFile, "utf8"));
    const candidate = topLevelSections(await readFile(candidateFile, "utf8"));
    return Object.fromEntries(Object.entries(candidate).filter(([heading, body]) => comparable(body) !== comparable(formal[heading] ?? "")));
}
export function replaceSubsection(content, heading, body) {
    const expression = new RegExp(`(^### ${escapeRegExp(heading)}[ \\t]*$)([\\s\\S]*?)(?=^### |^## |${escapeRegExp(OVERVIEW_END)}|${escapeRegExp(DETAIL_END)}|$(?![\\s\\S]))`, "m");
    if (!expression.test(content))
        throw new WorkflowError(`阶段文档缺少固定小节：${heading}`);
    return content.replace(expression, `$1\n\n${body.trim()}\n\n`);
}
export function replaceTopLevelSection(content, heading, body) {
    const expression = new RegExp(`(^## ${escapeRegExp(heading)}[ \\t]*$)([\\s\\S]*?)(?=^## |$(?![\\s\\S]))`, "m");
    if (!expression.test(content))
        throw new WorkflowError(`Stage document is missing fixed section: ${heading}`);
    return content.replace(expression, `$1\n\n${body.trim()}\n\n`);
}
export function validateHumanOverview(content) {
    for (const heading of ["当前结论", "最新业务增量", "当前状态", "是否需要人工决策", "验收清单", "未决问题", "AI 推荐意见"]) {
        const body = subsectionBody(content, heading);
        if (!body || /待本里程碑补充|待填写|参见正文|见正文/.test(body)) {
            throw new WorkflowError(`人工里程碑的一页结论尚未形成真实业务内容：${heading}`);
        }
    }
    if (!subsectionBody(content, "当前状态").includes("等待人工验收")) {
        throw new WorkflowError("人工里程碑的当前状态必须明确写出“等待人工验收”");
    }
    const recommendation = subsectionBody(content, "AI 推荐意见");
    if (!/(建议|推荐|判定)/.test(recommendation) || !/(因为|依据|基于|原因|考虑到)/.test(recommendation)) {
        throw new WorkflowError("AI 推荐意见必须给出明确建议及其证据或理由");
    }
}
export function validateHumanMilestoneDocument(content) {
    validateHumanOverview(content);
    const headings = [...content.matchAll(/^###\s+(.+?)\s*$/gm)].map((match) => match[1].trim());
    for (const heading of headings) {
        const body = subsectionBody(content, heading);
        if (!body || /待本里程碑补充|待填写|参见正文|见正文/.test(body)) {
            throw new WorkflowError(`人工里程碑仍有未完成的固定小节：${heading}`);
        }
    }
}
export function subsectionBody(content, heading) {
    // Do not use `\\s*$` or a bare `$` alternative with the multiline flag here.
    // `\\s` may consume newlines and multiline `$` also matches the heading line end,
    // causing the lazy body capture to succeed as an empty string for every section.
    const expression = new RegExp(`^### ${escapeRegExp(heading)}[ \\t]*$\\r?\\n([\\s\\S]*?)(?=^### |^## |${escapeRegExp(OVERVIEW_END)}|$(?![\\s\\S]))`, "m");
    return expression.exec(content)?.[1]?.trim() ?? "";
}
export function appendReview(content, stage, values) {
    if (!content.includes(REVIEW_LOG))
        throw new WorkflowError("阶段文档缺少业务验收记录区");
    const entry = `\n- **${stageTitle(stage)}**\n  - 时间：\`${values.time}\`\n  - 决定：${values.decision}\n  - 验收人：${values.reviewer}\n  - 反馈：${values.feedback}\n`;
    return content.replace(REVIEW_LOG, `${REVIEW_LOG}${entry}`);
}
function escapeRegExp(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
export async function readDocument(root, profile, stage) {
    return readFile(documentPath(root, profile, stage), "utf8");
}
export async function writeDocument(root, profile, stage, content) {
    await atomicText(documentPath(root, profile, stage), content);
}
export const documentName = (root, profile, stage) => path.basename(documentPath(root, profile, stage));
//# sourceMappingURL=documents.js.map