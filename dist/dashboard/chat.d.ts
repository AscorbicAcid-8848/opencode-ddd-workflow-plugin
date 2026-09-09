import { type WorkflowItem } from "./model.js";
import type { TuiPluginApi } from "@opencode-ai/plugin/tui";
export declare function progressState(item: WorkflowItem, roman: string): string;
export declare function milestoneChat(item: WorkflowItem, roman: string, client: TuiPluginApi["client"]): Promise<{
    messages: {
        id: string;
        sessionID: string;
        role: string;
        text: string;
        time: number;
    }[];
    missing: boolean;
    warnings: string[];
}>;
/** Half-open time windows. Time attribution is not a claim of semantic relevance. */
export declare function milestoneWindows(item: WorkflowItem, roman: string): {
    start: number;
    end: number;
}[];
