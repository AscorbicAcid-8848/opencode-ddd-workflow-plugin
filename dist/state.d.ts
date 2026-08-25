import type { WorkflowState } from "./types.js";
export declare const internalRoot: (root: string) => string;
export declare const statePath: (root: string) => string;
export declare const activeChange: (projectRoot: string, id: string) => string;
export declare function loadState(root: string): Promise<WorkflowState>;
export declare function saveState(root: string, state: WorkflowState): Promise<void>;
export declare function workflowRoot(projectRoot: string, profileArtifactBase: string, profileArtifactSubdir: string | undefined, id: string): Promise<string>;
