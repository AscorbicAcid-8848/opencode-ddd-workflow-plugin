import type { OpenSpecArtifact, WorkflowState } from "./types.js";
export declare function openSpecRuntime(): {
    root: string;
    script: string;
    version: string;
};
/**
 * OpenCode plugins may run inside Node, Bun, or a standalone host executable.
 * OpenSpec 1.7 requires Node, so never assume process.execPath is Node.
 */
export declare function openSpecNodeExecutable(execPath?: string, env?: NodeJS.ProcessEnv): string;
export declare function runOpenSpec(projectRoot: string, args: string[]): Promise<string>;
export declare function runOpenSpecJson(projectRoot: string, args: string[]): Promise<any>;
export declare function ensureChange(root: string, state: WorkflowState, request: string): Promise<any>;
export declare function loadLink(root: string): Promise<any>;
export declare function updateStatus(root: string, state: WorkflowState, status: string): Promise<any>;
export declare function status(state: WorkflowState): Promise<any>;
export declare function action(root: string, state: WorkflowState, artifact: OpenSpecArtifact): Promise<{
    schema: string;
    workflowId: string;
    workflowType: import("./types.js").WorkflowType;
    artifact: OpenSpecArtifact;
    status: any;
    instructions: any;
    dddInputs: string[];
    authority: {
        openSpec: string;
        ddd: string;
        bridge: string;
    };
}>;
export declare function validateStrict(state: WorkflowState): Promise<{
    status: any;
    validation: any;
}>;
export declare function validatePlanning(root: string, state: WorkflowState, phase: "plan" | "implementation" | "archive"): Promise<{
    changeId: string;
    phase: "archive" | "plan" | "implementation";
    requirements: number;
    scenarios: number;
    tasksCompleted: number;
    tasksRemaining: number;
    skipSpecs: boolean;
}>;
export declare function archive(root: string, state: WorkflowState): Promise<string>;
