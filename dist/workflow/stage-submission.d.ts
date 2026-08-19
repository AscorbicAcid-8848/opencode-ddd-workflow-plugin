import type { StageContract, StageSubmission, StageSubmissionPatchOperation, ValidationFinding, WorkflowProfile, WorkflowState } from "./types.js";
export declare function preparationContract(root: string, state: WorkflowState, profile: WorkflowProfile, stage: StageContract): Promise<{
    schemaVersion: string;
    workflowType: import("./types.js").WorkflowType;
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
}>;
export declare function applyStageSubmissionPatch(base: StageSubmission, operations: StageSubmissionPatchOperation[]): StageSubmission;
export declare function validateStageSubmission(root: string, state: WorkflowState, profile: WorkflowProfile, stage: StageContract, value: unknown, summary?: string): Promise<{
    submission: StageSubmission | null;
    findings: ValidationFinding[];
}>;
export declare function compileStageSubmission(root: string, state: WorkflowState, profile: WorkflowProfile, stage: StageContract, submission: StageSubmission): Promise<{
    candidateDocument: string;
    stageOutput: string;
    scopeReview: string;
}>;
