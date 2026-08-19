import path from "node:path";
import { exists, readJson, writeJson } from "./fs.js";
import { statePath } from "./paths.js";
import { WorkflowError } from "./types.js";
export async function loadState(root) {
    const canonical = statePath(root);
    const legacy = path.join(root, "workflow-state.json");
    const file = await exists(canonical) ? canonical : legacy;
    if (!await exists(file))
        throw new WorkflowError(`Missing workflow state: ${canonical}`);
    return readJson(file);
}
export async function saveState(root, state) {
    await writeJson(statePath(root), state);
}
//# sourceMappingURL=state.js.map