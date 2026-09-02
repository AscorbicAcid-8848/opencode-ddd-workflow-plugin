import { workflowTransition } from "./transition.js";
import type { Identity, WorkflowState, Transition, ReviewDecision, OpenSpecArtifact, ValidationFinding, HumanDecisionResolution, DecisionItem } from "./types.js";
export { queryPseudoEvents } from "./domain-semantics.js";
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
    ambiguityResolution?: unknown;
    decisionItems?: unknown;
    plannedSlices?: number;
    sliceId?: string;
    finalize?: boolean;
    /** A lifecycle observations payload is a complete claim set, not a patch. */
    replaceClaims?: boolean;
}
export interface ReviewInput extends Identity {
    stage: string;
    decision: ReviewDecision;
    reviewer: string;
    feedback?: string;
    resolution?: HumanDecisionResolution;
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
export declare function requiresScenarioClarification(request: string): boolean;
export declare function renderDecisionReviewSection(items: DecisionItem[]): string;
export declare function validateHumanDecisionContract(state: WorkflowState, stage: any, sections: Record<string, string>, decisionItems: unknown, summary?: string): ValidationFinding[];
export declare function validateExternalPartyEvidence(state: WorkflowState, stage: any, sections: Record<string, string>): ValidationFinding[];
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
export declare function validateMandatoryCompatibilityConstraints(root: string, scopeId: string | undefined, candidate: string): Promise<ValidationFinding[]>;
export declare function containsRequiredConcept(text: string, concept: string): boolean;
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
