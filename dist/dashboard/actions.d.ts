import { review } from "../engine.js";
import { type WorkflowItem, type MilestoneView } from "./model.js";
import type { ReviewDecision } from "../types.js";
export declare function canReview(item: WorkflowItem, view: MilestoneView): boolean;
/** UI uses the same review transaction as the tool; it cannot set workflow state or approve an archive. */
export declare function reviewFromPanel(item: WorkflowItem, view: MilestoneView, decision: ReviewDecision, feedback: string, selections?: Record<string, string>, runReview?: typeof review): Promise<import("../types.js").Transition & {
    reviewRecord: any;
}>;
