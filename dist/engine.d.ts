import { workflowTransition } from "./transition.js";
import type { Identity, WorkflowState, Transition, ReviewDecision, OpenSpecArtifact, ValidationFinding } from "./types.js";
export interface InitInput extends Identity {
    title: string;
    request: string;
}
export interface PrepareInput extends Identity {
    stage?: string;
}
export interface SubmitInput extends Identity {
    stage: string;
    summary: string;
    sections: Record<string, string>;
    claims?: unknown;
    plannedSlices?: number;
    sliceId?: string;
    finalize?: boolean;
}
export interface ReviewInput extends Identity {
    stage: string;
    decision: ReviewDecision;
    reviewer: string;
    feedback?: string;
}
export interface StatusInput extends Identity {
    view?: "compact" | "full";
}
export interface BlockInput extends Identity {
    stage: string;
    reason: string;
    evidence?: string[];
    remediation?: string[];
}
export interface ArchiveInput extends Identity {
}
export interface OpenSpecInput extends Identity {
    artifact: OpenSpecArtifact;
    content?: string;
    capability?: string;
    skipSpecs?: boolean;
}
export declare function initialize(input: InitInput): Promise<Transition & {
    workflowId: string;
}>;
export declare function prepare(input: PrepareInput): Promise<Transition & {
    stageCard: any;
}>;
export declare function submit(input: SubmitInput): Promise<Transition & {
    findings: ValidationFinding[];
    documentPath: string;
    draft?: Record<string, unknown>;
}>;
export declare function containsRequiredConcept(text: string, concept: string): boolean;
export declare function queryPseudoEvents(text: string): string[];
export declare function extractApprovedModelContract(document: string): {
    modelElements: {
        id: string;
        name: string;
    }[];
    invariants: {
        id: string;
        statement: string;
    }[];
};
export declare function hasFailedVerificationEvidence(text: string): boolean;
export declare function validateStageSemantics(state: WorkflowState, stage: any, input: SubmitInput): ValidationFinding[];
export declare function review(input: ReviewInput): Promise<Transition & {
    reviewRecord: any;
}>;
export declare function status(input: StatusInput): Promise<Transition & {
    state?: any;
}>;
export declare function block(input: BlockInput): Promise<Transition & {
    runtimeBlock: NonNullable<WorkflowState["runtimeBlock"]>;
}>;
export declare function archive(input: ArchiveInput): Promise<Transition & {
    archiveResult: any;
}>;
export declare function openspec(input: OpenSpecInput): Promise<{
    status: string;
    detail: string;
    artifact: string;
}>;
export { workflowTransition };
