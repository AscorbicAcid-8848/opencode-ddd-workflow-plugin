import { workflowTransition } from "./transition.js";
import type { Identity, Transition, ReviewDecision, OpenSpecArtifact, ValidationFinding } from "./types.js";
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
    plannedSlices?: number;
    sliceId?: string;
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
export interface ArchiveInput extends Identity {
}
export interface OpenSpecInput extends Identity {
    artifact: OpenSpecArtifact;
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
}>;
export declare function review(input: ReviewInput): Promise<Transition & {
    reviewRecord: any;
}>;
export declare function status(input: StatusInput): Promise<Transition & {
    state?: any;
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
