import type { WorkflowState, Checkpoint } from "../types.js";
import { type VisualCard } from "./views.js";
export interface ProjectionRef {
    roman: string;
    revision: number;
    file: string;
    checkpointId: number;
    status: string;
    signature: string;
}
export type ProjectedState = WorkflowState & {
    dashboard?: {
        version: 1;
        revisions: ProjectionRef[];
    };
};
export interface MilestoneProjection {
    version: 1;
    workflowId: string;
    milestoneRoman: string;
    revision: number;
    status: string;
    generatedAt: string;
    sourceCheckpointIds: number[];
    documentHash: string;
    documentBody: string;
    cards: VisualCard[];
    nodes: Array<{
        id: string;
        type: string;
        label: string;
        maturity: string;
        evidenceRefs: string[];
    }>;
    edges: Array<{
        source: string;
        target: string;
        relation: string;
        maturity: string;
        evidenceRefs: string[];
    }>;
    decisions: NonNullable<Checkpoint["decisionItems"]>;
    openQuestions: string[];
    evidenceSummary: string;
}
/** Compile once in the state-save transaction, after formal publication. Immutable revisions
 * are written first; the atomic state write publishes their pointers last. Orphans are not read. */
export declare function prepareDashboardProjections(root: string, state: WorkflowState): Promise<void>;
