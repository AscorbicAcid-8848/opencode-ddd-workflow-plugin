export type WorkflowType = "add-feature" | "refactor-system" | "create-system";
export type ReviewDecision = "approve" | "revise" | "reject";
export type OpenSpecArtifact = "proposal" | "specs" | "design" | "tasks" | "apply";
export interface StageContract {
    id: string;
    document: string;
    skills?: string[];
    required?: string[];
    checklist?: string[];
    humanGate?: boolean;
    criticalGate?: string;
    adviceRequired?: boolean;
    reviewTitle?: string;
    repeatable?: boolean;
    cycleGroup?: string;
    scopeContract?: {
        id: string;
    };
    intrinsicContract?: {
        id: string;
    };
    strategicBaselineGate?: string;
    openspecArtifactGate?: boolean;
    openspecTaskTracking?: boolean;
    openspecArchiveGate?: boolean;
    deliveryAssetGate?: boolean;
    implementationEvidence?: boolean;
    requiresCompletedImplementation?: boolean;
    openSpecAction?: string;
    qualityContract?: Record<string, unknown>;
    [key: string]: unknown;
}
export interface MilestoneContract {
    roman: string;
    document: string;
    title: string;
}
export interface WorkflowProfile {
    title: string;
    skill: string;
    artifactBase: string;
    artifactSubdir?: string;
    artifactLanguage?: string;
    stages: StageContract[];
    milestones: MilestoneContract[];
    strategicBaselineContract?: boolean;
    designConformanceContract?: boolean;
    [key: string]: unknown;
}
export interface ReviewRecord {
    decision: ReviewDecision;
    reviewer: string;
    reviewedAt: string;
    feedback: string;
    path: string;
    sha256: string;
}
export interface Checkpoint {
    checkpointId: number;
    stage: string;
    stepTitle: string;
    status: string;
    reviewStatus: "awaiting_review" | "not_required" | "approved" | "revision_requested" | "rejected" | "superseded";
    review: ReviewRecord | null;
    summary: string;
    completedAt: string;
    reviewPacket: string | null;
    reviewTitle?: string;
    reviewChecklist: string[];
    criticalGate?: string;
    adviceRequired: boolean;
    document: string;
    documentSnapshot: string;
    fileDelta: string;
    intrinsicContract: string;
    stageOutput: string;
    scopeReview: string;
    artifacts: Array<{
        path: string;
        sha256: string;
        bytes: number;
    }>;
    [key: string]: unknown;
}
export interface WorkflowState {
    schemaVersion: string;
    profileSchemaVersion: string;
    documentLayoutVersion: string;
    workflowType: WorkflowType;
    workflowId: string;
    title: string;
    projectRoot: string;
    artifactRoot: string;
    status: string;
    currentStage: string;
    createdAt: string;
    updatedAt: string;
    checkpoints: Checkpoint[];
    snapshot: Record<string, {
        sha256: string;
        bytes: number;
    }>;
    openSpec?: Record<string, unknown>;
    strategicBaseline?: Record<string, unknown>;
    [key: string]: unknown;
}
export interface Transition {
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
}
export interface WorkflowIdentity {
    workflowType: WorkflowType;
    workflowId: string;
    projectRoot: string;
}
export interface ValidationFinding {
    code: string;
    path: string;
    message: string;
    severity: "blocking" | "warning";
    suggestion?: string;
}
export interface StageSubmissionItem {
    id: string;
    kind: string;
    statement: string;
    maturity: string;
    documentSection: string;
    tracesTo?: string[];
    evidenceRefs?: string[];
    attributes?: Record<string, unknown>;
}
export interface StageSubmissionRelation {
    id: string;
    type: string;
    from: string;
    to: string;
    rationale: string;
}
export interface StageSubmissionDeferredItem {
    id: string;
    kind: string;
    statement: string;
    targetStage: string;
    documentSection: string;
    reason: string;
    tracesTo?: string[];
}
export interface StageSubmissionPatchOperation {
    op: "add" | "replace" | "remove";
    path: string;
    value?: unknown;
}
export interface StageSubmission {
    inputReferences: string[];
    items: StageSubmissionItem[];
    relations?: StageSubmissionRelation[];
    deferredItems?: StageSubmissionDeferredItem[];
    soleOutput: {
        statement: string;
        itemRefs: string[];
    };
    sections: Record<string, string>;
    overview?: {
        currentConclusion: string;
        latestBusinessIncrement: string;
        acceptanceChecklist: string[];
        openQuestions: string[];
        recommendation: string;
    };
    strategicBaseline?: StrategicBaselineSubmission;
}
export interface StrategicBaselineSubmission {
    currentSpecs: Array<{
        path: string;
        relevance: "relevant" | "not-relevant";
        reason: string;
    }>;
    changes: Array<{
        path: string;
        relevance: "relevant" | "not-relevant";
        reason: string;
    }>;
    recoveredDecisions: Array<{
        id: string;
        sourcePath: string;
        decision: string;
        reason: string;
    }>;
    unresolvedConflicts: string[];
    strategicDisposition: {
        status: "pending" | "proposed";
        reused: Array<{
            baselineDecisionId: string;
            rationale: string;
        }>;
        changed: Array<{
            baselineDecisionId: string;
            proposedDecision: string;
            reason: string;
            impact: string;
        }>;
        new: Array<{
            id: string;
            proposedDecision: string;
            reason: string;
            impact: string;
        }>;
        conflicts: string[];
    };
}
export interface StageAttempt {
    stage: string;
    count: number;
    lastFingerprint: string;
    identicalFailureCount: number;
    findingCount?: number;
    bestFindingCount?: number;
    noProgressCount?: number;
    progress?: "first-failure" | "improved" | "stalled" | "regressed";
    lastFindings?: ValidationFinding[];
    blocked: boolean;
    updatedAt: string;
}
export declare class WorkflowError extends Error {
    constructor(message: string);
}
export declare class WorkflowRuntimeError extends WorkflowError {
    readonly code: string;
    readonly operation: string;
    constructor(code: string, operation: string, message: string);
}
