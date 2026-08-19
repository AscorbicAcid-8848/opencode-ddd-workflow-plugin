import type { StageContract, WorkflowProfile, WorkflowState } from "./types.js";
export declare function validateStageBundle(root: string, state: WorkflowState, profile: WorkflowProfile, stage: StageContract): Promise<{
    candidate: string;
    output: Record<string, any>;
    review: {
        computedGate: {
            schemaVersion: string;
            verdict: string;
            blockingFindingIds: never[];
            assessedItemIds: string[];
            assessedRelationIds: string[];
            assessedSections: string[];
            deterministicFindings: any[];
            computedAt: string;
        };
    };
}>;
