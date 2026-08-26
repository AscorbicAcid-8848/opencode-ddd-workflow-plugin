import { type Plugin, type ToolDefinition } from "@opencode-ai/plugin";
import type { ReviewDecision } from "./types.js";
export declare function lifecycleFinalizeMetadata(input: Record<string, any>): {
    plannedSlices: any;
    sliceId: any;
};
export declare function normalizeReviewDecision(value: unknown): ReviewDecision | null;
export declare const dddLifecycleTool: ToolDefinition;
export declare const DddWorkflowPlugin: Plugin;
export default DddWorkflowPlugin;
