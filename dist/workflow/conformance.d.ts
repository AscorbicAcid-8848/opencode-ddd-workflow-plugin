import type { WorkflowState } from "./types.js";
export interface ModelContractResult {
    path: string;
    sha256: string;
    data: any;
    elements: Map<string, any>;
    invariants: Map<string, any>;
}
export declare function validateDeliveryAssets(root: string, state: WorkflowState): Promise<{
    schema: any;
    items: number;
    artifacts: {
        path: string;
        sha256: string;
        bytes: number;
    }[];
    modelContract: {
        path: string;
        sha256: string;
        elements: number;
        invariants: number;
    };
}>;
export declare function validateModelContract(root: string, state: WorkflowState, file?: string): Promise<ModelContractResult>;
export declare function validateImplementationEvidence(root: string, state: WorkflowState, stageId: string, evidenceFile?: string): Promise<any>;
