import type { TuiPluginApi } from "@opencode-ai/plugin/tui";
import type { WorkflowItem } from "./model.js";
export declare function getLinkedSession(item: WorkflowItem, sessionID: string, client: TuiPluginApi["client"]): Promise<import("@opencode-ai/sdk/v2").Session>;
export declare function listLinkedSessions(item: WorkflowItem, client: TuiPluginApi["client"]): Promise<({
    id: string;
    title: string;
    updatedAt: number;
    current: boolean;
    archived: boolean;
    error: string;
} | {
    id: string;
    title: string;
    updatedAt: undefined;
    current: boolean;
    archived: boolean;
    error: string;
})[]>;
