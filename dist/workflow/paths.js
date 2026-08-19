import path from "node:path";
import { readdir } from "node:fs/promises";
import { exists } from "./fs.js";
import { profileFor } from "./catalog.js";
export const internalRoot = (root) => path.join(root, ".ddd");
export const statePath = (root) => path.join(internalRoot(root), "workflow-state.json");
export const activeChange = (projectRoot, id) => path.join(projectRoot, "openspec", "changes", id);
export const openSpecLinkPath = (root) => path.join(internalRoot(root), "openspec-link.json");
export async function archiveCandidates(projectRoot, id) {
    const archive = path.join(projectRoot, "openspec", "changes", "archive");
    if (!await exists(archive))
        return [];
    const names = await readdir(archive, { withFileTypes: true });
    return names.filter((item) => item.isDirectory() && item.name.endsWith(`-${id}`))
        .map((item) => path.join(archive, item.name)).sort();
}
export async function canonicalRoot(identity) {
    const profile = await profileFor(identity.workflowType);
    const change = path.join(path.resolve(identity.projectRoot), profile.artifactBase, identity.workflowId);
    return profile.artifactSubdir ? path.join(change, profile.artifactSubdir) : change;
}
export async function workflowRoot(identity) {
    const active = await canonicalRoot(identity);
    if (await exists(statePath(active)))
        return active;
    const profile = await profileFor(identity.workflowType);
    for (const archived of (await archiveCandidates(identity.projectRoot, identity.workflowId)).reverse()) {
        const candidate = profile.artifactSubdir ? path.join(archived, profile.artifactSubdir) : archived;
        if (await exists(statePath(candidate)))
            return candidate;
    }
    const legacy = path.join(path.resolve(identity.projectRoot), "docs", "ddd", identity.workflowId);
    if (await exists(statePath(legacy)) || await exists(path.join(legacy, "workflow-state.json")))
        return legacy;
    return active;
}
export const documentFileNames = {
    milestoneI: "I-strategic-eventstorm.md",
    milestoneII: "II-strategic-design.md",
    milestoneIII: "III-tactical-eventstorm.md",
    milestoneIV: "IV-tactical-design.md",
    milestoneV: "V-delivery-plan.md",
    milestoneVI: "VI-final-acceptance.md",
};
export function documentPath(root, _profile, stage) {
    return path.join(root, documentFileNames[stage.document] ?? `${stage.document}.md`);
}
export function stageWorkbench(root, stageId) {
    return path.join(internalRoot(root), "workbench", stageId);
}
export function stageBundle(root, profile, stage) {
    const workbench = stageWorkbench(root, stage.id);
    return {
        workbench,
        candidate: path.join(workbench, path.basename(documentPath(root, profile, stage))),
        output: path.join(workbench, "stage-output.json"),
        review: path.join(workbench, "scope-review.json"),
        draft: path.join(workbench, "submission-draft.json"),
    };
}
export const relative = (root, file) => path.relative(root, file).split(path.sep).join("/");
export const projectRelative = (state, file) => path.relative(state.projectRoot, file).split(path.sep).join("/");
//# sourceMappingURL=paths.js.map