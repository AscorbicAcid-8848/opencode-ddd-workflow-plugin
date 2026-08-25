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
        lines.push(`## ${h}`, "", "> _待填写_", "");
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
    let body = await readFile(file, "utf8");
    for (const [heading, content] of Object.entries(sections)) {
        body = replaceSection(body, heading, content);
    }
    await atomicText(file, body);
    return file;
}
function replaceSection(body, heading, content) {
    const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(##\\s+${escaped}\\s*\\n)([\\s\\S]*?)(?=\\n##\\s|$)`, "u");
    const replacement = `$1\n${content.trim()}\n`;
    if (re.test(body))
        return body.replace(re, replacement);
    return `${body.trimEnd()}\n\n## ${heading}\n\n${content.trim()}\n`;
}
//# sourceMappingURL=documents.js.map