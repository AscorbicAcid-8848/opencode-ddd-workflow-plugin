import type { WorkflowType } from "./types.js";
export type RequirementDelta = "ADDED" | "MODIFIED";
export interface DeliveryScenario {
    name: string;
    given?: string;
    when: string;
    then: string;
}
export interface DeliveryRequirement {
    name: string;
    rule: string;
    scenarios: DeliveryScenario[];
}
export interface DeliveryCapability {
    id: string;
    title?: string;
    /**
     * OpenSpec requirement delta. Feature/greenfield plans default to ADDED;
     * refactoring plans default to MODIFIED and may not silently widen scope.
     */
    delta?: RequirementDelta;
    requirements: DeliveryRequirement[];
}
export interface RefactorBehaviorProtection {
    /** Stable IDs for approved or recovered AS-IS scenarios. */
    baselineScenarioRefs: string[];
    /** Real characterization tests that execute the preserved behavior. */
    characterizationTests: string[];
    /** Observable semantics that must remain equivalent before and after. */
    preservedSemantics: string[];
    /** How legacy and target paths coexist while this slice is deployed. */
    coexistenceStrategy: string;
}
export interface RollbackContract {
    /** Observable condition that requires rollback. */
    trigger: string;
    /** Ordered, executable rollback actions. */
    steps: string[];
    /** Commands or observations proving rollback restored the approved state. */
    verification: string[];
}
export interface DeliverySlice {
    id: string;
    title: string;
    outcome: string;
    consumer: string;
    dependsOn: string[];
    acceptanceCriteria: string[];
    modelElementIds: string[];
    invariantIds: string[];
    productionPaths: string[];
    testPaths: string[];
    verification: string[];
    compatibility: string;
    /** Required for refactor-system. */
    behaviorProtection?: RefactorBehaviorProtection;
    rollback: RollbackContract;
}
export interface StructuredDeliveryPlan {
    title: string;
    objective: string;
    nonGoals: string[];
    designDecisions: string[];
    capabilities: DeliveryCapability[];
    slices: DeliverySlice[];
}
export interface PlanFinding {
    code: string;
    path: string;
    message: string;
}
export interface ApprovedModelContract {
    modelElements?: Array<{
        id: string;
        name?: string;
        type?: string;
        responsibility?: string;
    }>;
    invariants?: Array<{
        id: string;
        statement?: string;
    }>;
    sourceSha256?: string;
}
export interface DeliveryCompilationContext {
    workflowType?: WorkflowType;
    /** Only behavior-preserving refactors may omit Delta Specs. */
    skipSpecs?: boolean;
}
/** Machine-readable evidence for workflow-specific delivery obligations. */
export interface DeliveryPlanSemanticEvidence {
    sliceCount: number;
    migrationVerticalSlices: boolean;
    behaviorProtection: boolean;
    independentRollback: boolean;
}
export declare function normalizeStructuredPlan(raw: any, current?: StructuredDeliveryPlan): StructuredDeliveryPlan;
export declare function deliveryPlanSemanticEvidence(plan: StructuredDeliveryPlan, context?: DeliveryCompilationContext): DeliveryPlanSemanticEvidence;
export declare function validateStructuredPlan(plan: StructuredDeliveryPlan, context?: DeliveryCompilationContext): PlanFinding[];
export declare function compileStructuredPlan(plan: StructuredDeliveryPlan, workflowId: string, context?: DeliveryCompilationContext): {
    proposal: string;
    specs: {
        capability: string;
        delta: RequirementDelta;
        content: string;
    }[];
    design: string;
    tasks: string;
    roadmap: {
        schemaVersion: string;
        workflowId: string;
        generatedAt: string;
        slices: {
            order: number;
            status: string;
            id: string;
            title: string;
            outcome: string;
            consumer: string;
            dependsOn: string[];
            acceptanceCriteria: string[];
            modelElementIds: string[];
            invariantIds: string[];
            productionPaths: string[];
            testPaths: string[];
            verification: string[];
            compatibility: string;
            /** Required for refactor-system. */
            behaviorProtection?: RefactorBehaviorProtection;
            rollback: RollbackContract;
        }[];
        sourceHash: string;
    };
};
export declare function compileDeliveryMilestoneSections(plan: StructuredDeliveryPlan, workflowId: string, contract?: ApprovedModelContract, context?: DeliveryCompilationContext): {
    summary: string;
    sections: Record<string, string>;
};
