import type { TuiPluginApi } from "@opencode-ai/plugin/tui";
import { type WorkflowItem } from "./model.js";
export declare function projectSessions(project: string, client: TuiPluginApi["client"]): Promise<import("@opencode-ai/sdk/v2").Session[]>;
/** Dispatch only. Session history is recorded by the lifecycle tool, not browsing or selection. */
export declare function resumeInSession(item: WorkflowItem, target: string | null, client: TuiPluginApi["client"]): Promise<string>;
