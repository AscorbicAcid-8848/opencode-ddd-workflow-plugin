import type { WorkflowState } from "./types.js";
export declare function recordRuntimeSession(state: Pick<WorkflowState, "runtimeSessionId" | "runtimeSessionIds">, sessionID: string): boolean;
