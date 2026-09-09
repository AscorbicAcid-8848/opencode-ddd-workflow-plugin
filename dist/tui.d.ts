import { BoxRenderable } from "@opentui/core";
import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui";
import { type WorkflowItem, type MilestoneView } from "./dashboard/model.js";
/** The native route is independently exportable for real OpenTUI render tests. */
export declare function createDashboard(api: TuiPluginApi, project: string, leave: () => void, originSessionID?: string): {
    root: BoxRenderable;
    dispose: () => void;
    refresh: (force?: boolean) => Promise<void>;
    getSelection: () => {
        item: WorkflowItem | undefined;
        view: MilestoneView | undefined;
    };
};
export declare const tui: TuiPlugin;
declare const _default: {
    id: string;
    tui: TuiPlugin;
};
export default _default;
