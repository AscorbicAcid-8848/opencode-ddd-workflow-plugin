import type { WorkflowState } from "./types.js";
export declare function loadState(root: string): Promise<WorkflowState>;
export declare function saveState(root: string, state: WorkflowState): Promise<void>;
