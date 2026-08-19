import type { OpenSpecArtifact, ReviewDecision, StageAttempt, StageSubmission, StageSubmissionPatchOperation, ValidationFinding, WorkflowIdentity, WorkflowType } from "./types.js";
export declare const WORKFLOW_SCHEMA = "1.16";
export declare const LAYOUT_SCHEMA = "fixed-business-sections/v1";
export interface InitInput extends WorkflowIdentity {
    title: string;
    request: string;
}
export interface CheckpointInput extends WorkflowIdentity {
    stage: string;
    summary: string;
    evidenceFile?: string;
}
export interface StageSubmissionInput extends WorkflowIdentity {
    stage: string;
    summary: string;
    submission?: StageSubmission;
    repairPatch?: StageSubmissionPatchOperation[];
    evidenceFile?: string;
}
export interface MilestoneSubmissionInput extends WorkflowIdentity {
    submissions: Array<{
        stage: string;
        summary: string;
        submission?: StageSubmission;
        repairPatch?: StageSubmissionPatchOperation[];
        evidenceFile?: string;
    }>;
}
export interface ReviewInput extends WorkflowIdentity {
    stage: string;
    decision: ReviewDecision;
    reviewer: string;
    feedback?: string;
}
export interface MigrateInput extends WorkflowIdentity {
    legacyRoot: string;
}
export interface StatusInput extends WorkflowIdentity {
    view?: "compact" | "full";
}
export declare function initialize(input: InitInput): Promise<{
    artifactRoot: string;
    checkpoint: any;
    transition: any;
}>;
export declare function beginStage(input: WorkflowIdentity & {
    stage: string;
}): Promise<{
    transition: import("./types.js").Transition;
    candidateDocument: string;
    stageOutput: string;
    scopeReview: string;
    intrinsicContract: string;
    governingQuestion: any;
    allowedItemKinds: any;
    allowedMaturities: any;
    ownedSections: any;
    soleOutput: any;
    semanticGraphContract: {
        schema: string;
        policy: any;
        relationTypes: any;
    };
    scopeReviewRule: string;
}>;
export declare function prepareStage(input: WorkflowIdentity & {
    stage: string;
}): Promise<{
    transition: import("./types.js").Transition;
    contract: {
        schemaVersion: string;
        workflowType: WorkflowType;
        workflowId: string;
        stage: string;
        stageRole: string;
        skills: string[];
        governingQuestion: any;
        consumes: any;
        ownedSections: any;
        sectionContract: any;
        ownedSubsections: any;
        requiredSubsections: any;
        allowedItemKinds: any;
        allowedMaturities: any;
        requiredAnyOf: any;
        evidenceRequiredKinds: any;
        qualityContract: Record<string, unknown>;
        soleOutput: any;
        semanticPolicy: any;
        semanticEnums: {
            scopeDispositions: any;
            flowRoles: any;
        };
        strategicBaseline: {
            phase: "inventory" | "decision-delta";
            artifact: string;
            runtimeOwned: boolean;
            instruction: string;
            currentSpecs: any[];
            changes: any[];
            previous: unknown;
        } | null;
        relationTypes: any;
        evidenceReferencePrefixes: any;
        validDeferredTargets: string[];
        outputContract: {
            required: string[];
            itemRequired: string[];
            relationRequired: string[];
            deferredItemRequired: string[];
            soleOutputRequired: string[];
            evidenceRefs: string;
            sections: string;
            overview: string[];
        };
        minimalShapeExample: {
            overview?: {
                currentConclusion: string;
                latestBusinessIncrement: string;
                acceptanceChecklist: string[];
                openQuestions: string[];
                recommendation: string;
            } | undefined;
            inputReferences: string[];
            items: {
                id: string;
                kind: any;
                statement: string;
                maturity: any;
                documentSection: any;
                tracesTo: string[];
                evidenceRefs: string[];
                attributes: {
                    [k: string]: any;
                };
            }[];
            relations: never[];
            deferredItems: never[];
            soleOutput: {
                statement: string;
                itemRefs: string[];
            };
            sections: {
                [x: number]: string;
            };
        };
        repairProtocol: string;
        executionRule: string;
    };
    repairContext: {
        available: boolean;
        draftPath: string;
        attempt: StageAttempt;
        findings: ValidationFinding[];
        instruction: string;
    } | {
        available: boolean;
        draftPath?: undefined;
        attempt?: undefined;
        findings?: undefined;
        instruction?: undefined;
    };
    artifactRoot: string;
}>;
export declare function prepareMilestone(input: WorkflowIdentity): Promise<{
    schemaVersion: string;
    artifactRoot: string;
    mode: string;
    milestone: {
        roman: string;
        title: string;
        document: string;
    } | null;
    submissionOrder: string[];
    sharedContract: {
        evidenceReferencePrefixes: any;
        semanticEnums: any;
        repairProtocol: any;
        executionRule: string;
    };
    stages: any[];
    executionRule: string;
    transition: import("./types.js").Transition;
}>;
export declare function submitMilestone(input: MilestoneSubmissionInput): Promise<{
    accepted: boolean;
    schemaVersion: string;
    completedStages: string[];
    failedStage: string;
    stageResult: any;
    transition: any;
    checkpoints?: undefined;
    humanReviewDocument?: undefined;
} | {
    accepted: boolean;
    schemaVersion: string;
    completedStages: string[];
    checkpoints: any[];
    humanReviewDocument: string | null;
    transition: unknown;
    failedStage?: undefined;
    stageResult?: undefined;
}>;
export declare function submitStage(input: StageSubmissionInput): Promise<{
    accepted: boolean;
    validation: {
        schemaVersion: string;
        verdict: string;
        findings: ValidationFinding[];
        findingCount: number;
        fingerprint: string;
    };
    attempt: StageAttempt;
    retryPolicy: string;
    repair: {
        mode: string;
        draftPath: string;
        preserveUnmentionedFields: boolean;
        nextCall: string;
        example: {
            op: string;
            path: string;
            value: string[];
        }[];
        available?: undefined;
    } | {
        mode: string;
        available: boolean;
        draftPath?: undefined;
        preserveUnmentionedFields?: undefined;
        nextCall?: undefined;
        example?: undefined;
    };
    transition: import("./types.js").Transition;
} | {
    accepted: boolean;
    error: {
        schemaVersion: string;
        code: string;
        operation: string;
        message: string;
        retryableByModel: boolean;
    };
    validation: {
        schemaVersion: string;
        verdict: string;
        findings: ValidationFinding[];
        findingCount: number;
        fingerprint: string;
    };
    attempt: StageAttempt;
    retryPolicy: string;
    repair: {
        mode: string;
        draftPath: string;
        preserveUnmentionedFields: boolean;
    };
    transition: import("./types.js").Transition;
    requiredAction: string;
    mustContinue: boolean;
    stopAllowed: boolean;
} | {
    accepted: boolean;
    validation: {
        verdict: string;
        findings: never[];
    };
    checkpoint: any;
    transition: any;
}>;
export declare function checkpoint(input: CheckpointInput): Promise<any>;
export declare function review(input: ReviewInput): Promise<{
    review: import("./types.js").ReviewRecord;
    transition: import("./types.js").Transition;
}>;
export declare function status(input: StatusInput): Promise<{
    schemaVersion: string;
    view: string;
    workflowType: WorkflowType;
    workflowId: string;
    status: string;
    currentStage: string;
    milestoneRoman: string | null;
    milestoneTitle: string | null;
    milestoneReady: boolean;
    milestoneStatus: string;
    requiredAction: "revise" | "complete" | "archive" | "continue" | "select-next-stage" | "await-human-review" | "stop" | "runtime-contract-repair";
    stopAllowed: boolean;
    mustContinue: boolean;
    nextStage: string | null;
    allowedNextStages: string[];
    nextHumanGate: string | null;
    openSpec: {
        changeId: unknown;
        traceStatus: unknown;
        sourceOfTruth: unknown;
    } | null;
    nextAction: string;
    readOnly: boolean;
    requiresReconcile: boolean;
} | {
    nextAction: string;
    document: string | undefined;
    reviewTitle: string | undefined;
    reviewChecklist: string[];
    criticalGate: string | undefined;
    adviceRequired: boolean;
    readOnly: boolean;
    requiresReconcile: boolean;
    schemaVersion: "ddd-workflow-transition/v1";
    workflowStatus: string;
    lastCompletedStage: string | null;
    stageRole: "not-started" | "milestone-building" | "human-gate" | "complete" | "blocked" | "archive";
    milestoneRoman: string | null;
    milestoneTitle: string | null;
    milestoneReady: boolean;
    milestoneStatus: string;
    documentRole: "cumulative-working-document" | "human-review-document" | "none";
    humanReviewRequired: boolean;
    mustContinue: boolean;
    stopAllowed: boolean;
    stopReason: string | null;
    nextStage: string | null;
    allowedNextStages: string[];
    nextHumanGate: string | null;
    requiredAction: "continue" | "select-next-stage" | "await-human-review" | "revise" | "stop" | "archive" | "complete" | "runtime-contract-repair";
    message: string;
    workflowType: WorkflowType;
    workflowId: string;
    status: string;
    currentStage: string;
    currentStepTitle: string | null;
    artifactRoot: string;
    openSpec: Record<string, unknown> | undefined;
    checkpointCount: number;
    reviewStatus: "awaiting_review" | "not_required" | "approved" | "revision_requested" | "rejected" | "superseded" | null;
    pendingCriticalReviews: {
        stage: string;
        title: string | undefined;
        document: string;
    }[];
    transition: import("./types.js").Transition;
    view?: undefined;
}>;
export declare function retryArchive(input: WorkflowIdentity): Promise<{
    schemaVersion: string;
    view: string;
    workflowType: WorkflowType;
    workflowId: string;
    status: string;
    currentStage: string;
    milestoneRoman: string | null;
    milestoneTitle: string | null;
    milestoneReady: boolean;
    milestoneStatus: string;
    requiredAction: "revise" | "complete" | "archive" | "continue" | "select-next-stage" | "await-human-review" | "stop" | "runtime-contract-repair";
    stopAllowed: boolean;
    mustContinue: boolean;
    nextStage: string | null;
    allowedNextStages: string[];
    nextHumanGate: string | null;
    openSpec: {
        changeId: unknown;
        traceStatus: unknown;
        sourceOfTruth: unknown;
    } | null;
    nextAction: string;
    readOnly: boolean;
    requiresReconcile: boolean;
} | {
    nextAction: string;
    document: string | undefined;
    reviewTitle: string | undefined;
    reviewChecklist: string[];
    criticalGate: string | undefined;
    adviceRequired: boolean;
    readOnly: boolean;
    requiresReconcile: boolean;
    schemaVersion: "ddd-workflow-transition/v1";
    workflowStatus: string;
    lastCompletedStage: string | null;
    stageRole: "not-started" | "milestone-building" | "human-gate" | "complete" | "blocked" | "archive";
    milestoneRoman: string | null;
    milestoneTitle: string | null;
    milestoneReady: boolean;
    milestoneStatus: string;
    documentRole: "cumulative-working-document" | "human-review-document" | "none";
    humanReviewRequired: boolean;
    mustContinue: boolean;
    stopAllowed: boolean;
    stopReason: string | null;
    nextStage: string | null;
    allowedNextStages: string[];
    nextHumanGate: string | null;
    requiredAction: "continue" | "select-next-stage" | "await-human-review" | "revise" | "stop" | "archive" | "complete" | "runtime-contract-repair";
    message: string;
    workflowType: WorkflowType;
    workflowId: string;
    status: string;
    currentStage: string;
    currentStepTitle: string | null;
    artifactRoot: string;
    openSpec: Record<string, unknown> | undefined;
    checkpointCount: number;
    reviewStatus: "awaiting_review" | "not_required" | "approved" | "revision_requested" | "rejected" | "superseded" | null;
    pendingCriticalReviews: {
        stage: string;
        title: string | undefined;
        document: string;
    }[];
    transition: import("./types.js").Transition;
    view?: undefined;
} | {
    artifactRoot: string;
    transition: import("./types.js").Transition;
}>;
export declare function getOpenSpecAction(input: WorkflowIdentity & {
    artifact: OpenSpecArtifact;
}): Promise<{
    schema: string;
    workflowId: string;
    workflowType: WorkflowType;
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
export declare function migrateLayout(input: MigrateInput): Promise<{
    artifactRoot: string;
    migratedFrom: string;
    checkpointCount: number;
    transition: import("./types.js").Transition;
}>;
