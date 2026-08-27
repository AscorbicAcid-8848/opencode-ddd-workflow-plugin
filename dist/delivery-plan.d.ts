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
    requirements: DeliveryRequirement[];
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
    rollback: string;
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
export declare function normalizeStructuredPlan(raw: any, current?: StructuredDeliveryPlan): StructuredDeliveryPlan;
export declare function validateStructuredPlan(plan: StructuredDeliveryPlan): PlanFinding[];
export declare function compileStructuredPlan(plan: StructuredDeliveryPlan, workflowId: string): {
    proposal: string;
    specs: {
        capability: string;
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
            rollback: string;
        }[];
        sourceHash: string;
    };
};
export declare function compileDeliveryMilestoneSections(plan: StructuredDeliveryPlan, workflowId: string, contract?: ApprovedModelContract): {
    summary: string;
    sections: Record<string, string>;
};
