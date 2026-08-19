import type { WorkflowIdentity, WorkflowProfile, WorkflowState } from "./types.js";
export declare const internalRoot: (root: string) => string;
export declare const statePath: (root: string) => string;
export declare const activeChange: (projectRoot: string, id: string) => string;
export declare const openSpecLinkPath: (root: string) => string;
export declare function archiveCandidates(projectRoot: string, id: string): Promise<string[]>;
export declare function canonicalRoot(identity: WorkflowIdentity): Promise<string>;
export declare function workflowRoot(identity: WorkflowIdentity): Promise<string>;
export declare const documentFileNames: Record<string, string>;
export declare function documentPath(root: string, _profile: WorkflowProfile, stage: {
    document: string;
}): string;
export declare function stageWorkbench(root: string, stageId: string): string;
export declare function stageBundle(root: string, profile: WorkflowProfile, stage: {
    id: string;
    document: string;
}): {
    workbench: string;
    candidate: string;
    output: string;
    review: string;
    draft: string;
};
export declare const relative: (root: string, file: string) => string;
export declare const projectRelative: (state: WorkflowState, file: string) => string;
