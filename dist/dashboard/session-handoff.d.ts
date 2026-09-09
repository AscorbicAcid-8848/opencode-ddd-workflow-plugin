import type { TuiPluginApi } from "@opencode-ai/plugin/tui";
import { type WorkflowItem, type MilestoneView } from "./model.js";
export declare function reviewMessageId(workflowId: string, checkpointId: number, record: unknown): string;
/** Reconstruct panel context from its deterministic message ID and saved review. No sidecar state. */
export declare function resolvePanelReview(project: string, sessionID: string, messageID?: string): Promise<{
    workflowId: string;
    workflowType: import("../types.js").WorkflowType;
    decision: import("../types.js").ReviewDecision;
    milestone: string;
    checkpointId: number;
    stale: boolean;
} | undefined>;
/** Retry only message delivery; never calls the review transaction. */
export declare function sendPanelReview(item: WorkflowItem, previous: MilestoneView, client: TuiPluginApi["client"]): Promise<{
    sessionID: string;
    messageID: string;
    alreadySent: boolean;
}>;
