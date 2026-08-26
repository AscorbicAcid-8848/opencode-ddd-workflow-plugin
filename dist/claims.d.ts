import type { StageClaimContract, ValidationFinding, WorkflowState } from "./types.js";
export declare function claimContractFor(scopeId?: string): StageClaimContract | null;
export declare function validateStageClaims(state: WorkflowState, scopeId: string | undefined, writableHeadings: string[], sections: Record<string, string>, rawClaims: unknown): Promise<ValidationFinding[]>;
