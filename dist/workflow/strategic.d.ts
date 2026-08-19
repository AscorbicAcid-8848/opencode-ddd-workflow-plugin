import type { StrategicBaselineSubmission, WorkflowState } from "./types.js";
export declare function strategicInventory(state: WorkflowState): Promise<{
    currentSpecs: any[];
    changes: any[];
}>;
export declare function strategicBaselinePreparation(root: string, state: WorkflowState, phase: "inventory" | "decision-delta"): Promise<{
    phase: "inventory" | "decision-delta";
    artifact: string;
    runtimeOwned: boolean;
    instruction: string;
    currentSpecs: any[];
    changes: any[];
    previous: unknown;
}>;
export declare function compileStrategicBaseline(root: string, state: WorkflowState, phase: "inventory" | "decision-delta", input: StrategicBaselineSubmission): Promise<{
    phase: "inventory" | "decision-delta";
    path: string;
    sha256: string;
    currentSpecs: number;
    priorChanges: number;
    recoveredDecisions: number;
}>;
export declare function validateStrategicBaseline(root: string, state: WorkflowState, phase: "inventory" | "decision-delta"): Promise<{
    phase: "inventory" | "decision-delta";
    path: string;
    sha256: string;
    currentSpecs: number;
    priorChanges: number;
    recoveredDecisions: number;
}>;
