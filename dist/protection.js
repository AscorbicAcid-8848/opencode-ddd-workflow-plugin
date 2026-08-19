import path from "node:path";
import { documentFileNames } from "./workflow/paths.js";
const milestoneFiles = new Set(Object.values(documentFileNames).map((value) => value.toLowerCase()));
const mutationTools = new Set(["write", "edit", "apply_patch", "patch", "multiedit"]);
export const protectedMilestonePatterns = Object.values(documentFileNames).flatMap((file) => [
    `openspec/changes/*/ddd/*${file}`,
    `docs/ddd/*/*${file}`,
]);
function cleanCandidate(value) {
    return value.trim().replace(/^['"<]|['">]$/g, "");
}
function directPaths(args) {
    const result = [];
    for (const key of ["filePath", "file_path", "path", "target", "file"]) {
        if (typeof args[key] === "string")
            result.push(args[key]);
    }
    if (Array.isArray(args.edits)) {
        for (const edit of args.edits) {
            if (edit && typeof edit === "object")
                result.push(...directPaths(edit));
        }
    }
    return result;
}
function patchPaths(args) {
    const result = [];
    for (const key of ["patch", "patchText", "patch_text", "input"]) {
        const value = args[key];
        if (typeof value !== "string")
            continue;
        for (const match of value.matchAll(/^\*\*\* (?:Add|Update|Delete) File:\s*(.+?)\s*$/gm))
            result.push(match[1]);
        for (const match of value.matchAll(/^\+\+\+\s+(?:b\/)?(.+?)\s*$/gm))
            if (match[1] !== "/dev/null")
                result.push(match[1]);
    }
    return result;
}
export function isProtectedMilestonePath(projectRoot, candidate) {
    const cleaned = cleanCandidate(candidate);
    if (!cleaned || cleaned.includes("\n") || cleaned.includes("\r"))
        return false;
    const absolute = path.isAbsolute(cleaned) ? path.resolve(cleaned) : path.resolve(projectRoot, cleaned);
    const relative = path.relative(path.resolve(projectRoot), absolute).split(path.sep).join("/");
    if (!relative || relative === ".." || relative.startsWith("../"))
        return false;
    const segments = relative.toLowerCase().split("/");
    if (!milestoneFiles.has(segments.at(-1) ?? ""))
        return false;
    const openspec = segments.indexOf("openspec");
    const changes = openspec >= 0 ? segments.indexOf("changes", openspec + 1) : -1;
    const dddAfterChange = changes >= 0 ? segments.indexOf("ddd", changes + 1) : -1;
    if (openspec >= 0 && changes === openspec + 1 && dddAfterChange > changes)
        return true;
    return segments[0] === "docs" && segments[1] === "ddd" && segments.length >= 4;
}
export function protectedMutationTargets(toolName, args, projectRoot) {
    if (!mutationTools.has(toolName.toLowerCase()) || !args || typeof args !== "object")
        return [];
    const values = [...directPaths(args), ...patchPaths(args)];
    return [...new Set(values.map(cleanCandidate).filter((value) => isProtectedMilestonePath(projectRoot, value)))];
}
export function guardMilestoneMutation(toolName, args, projectRoot) {
    const blocked = protectedMutationTargets(toolName, args, projectRoot);
    if (!blocked.length)
        return;
    throw new Error(`DDD_MILESTONE_DOCUMENT_PROTECTED: 正式里程碑文档只能由 ddd_workflow_submit 或 ddd_workflow_review 在状态与语义校验通过后发布；禁止 ${toolName} 直接修改：${blocked.join("、")}`);
}
export function injectMilestoneEditProtection(config) {
    const current = config.permission;
    const permissions = current && typeof current === "object" && !Array.isArray(current)
        ? { ...current }
        : current
            ? { "*": current }
            : {};
    const edit = permissions.edit;
    const existingRules = edit && typeof edit === "object" && !Array.isArray(edit)
        ? edit
        : edit
            ? { "*": edit }
            : {};
    const protectedSet = new Set(protectedMilestonePatterns);
    const rules = Object.fromEntries(Object.entries(existingRules).filter(([pattern]) => !protectedSet.has(pattern)));
    for (const pattern of protectedMilestonePatterns)
        rules[pattern] = "deny";
    permissions.edit = rules;
    config.permission = permissions;
}
//# sourceMappingURL=protection.js.map