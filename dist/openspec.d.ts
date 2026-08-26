import type { OpenSpecArtifact, WorkflowState } from "./types.js";
export declare function openSpecRuntime(): {
    root: string;
    script: string;
    version: string;
};
export declare function openSpecNodeExecutable(execPath?: string, env?: NodeJS.ProcessEnv): string;
export declare function runOpenSpec(projectRoot: string, args: string[]): Promise<string>;
export declare function runOpenSpecJson(projectRoot: string, args: string[]): Promise<any>;
export declare function ensureProject(projectRoot: string): Promise<string>;
export declare function newChange(projectRoot: string, id: string, title: string, request: string): Promise<string>;
export declare function writeLink(root: string, state: WorkflowState, status: string, changeId: string, archiveTarget?: string): Promise<void>;
export declare function verifyArchive(projectRoot: string, id: string): Promise<{
    archived: boolean;
    target?: string;
    error?: string;
}>;
export interface OpenSpecActionInput {
    projectRoot: string;
    artifact: OpenSpecArtifact;
    state: WorkflowState;
    content?: string;
    capability?: string;
    skipSpecs?: boolean;
}
export declare function planningArtifacts(projectRoot: string, id: string): Promise<{
    complete: boolean;
    missing: string[];
    files: string[];
}>;
export declare function openSpecAction(input: OpenSpecActionInput): Promise<{
    status: string;
    detail: string;
}>;
