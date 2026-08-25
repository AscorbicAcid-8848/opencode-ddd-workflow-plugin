import path from "node:path";
import { exists, readJson, writeJson } from "./fs.js";
import { WorkflowError } from "./types.js";
export const internalRoot = (root) => path.join(root, ".ddd");
export const statePath = (root) => path.join(internalRoot(root), "workflow-state.json");
export const activeChange = (projectRoot, id) => path.join(projectRoot, "openspec", "changes", id);
export async function loadState(root) {
    const canonical = statePath(root);
    if (!await exists(canonical))
        throw new WorkflowError(`Missing workflow state: ${canonical}`);
    return readJson(canonical);
}
export async function saveState(root, state) {
    state.updatedAt = new Date().toISOString().replace(/\.\d{3}Z$/, "+00:00");
    await writeJson(statePath(root), state);
}
export async function workflowRoot(projectRoot, profileArtifactBase, profileArtifactSubdir, id) {
    const active = path.join(projectRoot, profileArtifactBase, id);
    return profileArtifactSubdir ? path.join(active, profileArtifactSubdir) : active;
}
//# sourceMappingURL=state.js.map