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
    const state = await readJson(canonical);
    let migrated = false;
    for (const checkpoint of state.checkpoints) {
        const decision = String(checkpoint.review?.decision ?? "").toLowerCase();
        if (decision === "approved") {
            ;
            checkpoint.review.decision = "approve";
            if (checkpoint.status === "rejected")
                checkpoint.status = "approved";
            migrated = true;
        }
        else if (decision === "rejected") {
            ;
            checkpoint.review.decision = "reject";
            migrated = true;
        }
        else if (decision === "revision" || decision === "revision_requested") {
            ;
            checkpoint.review.decision = "revise";
            if (checkpoint.status === "rejected")
                checkpoint.status = "revision_requested";
            migrated = true;
        }
    }
    const latest = state.checkpoints.at(-1);
    if (state.status === "rejected" && latest?.status === "approved") {
        state.status = "active";
        migrated = true;
    }
    if (migrated)
        await writeJson(canonical, state);
    return state;
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