import { type Plugin } from "@opencode-ai/plugin";
import { environmentReport } from "./runtime.js";
import { openSpecRuntime } from "./workflow/openspec.js";
import { beginStage, checkpoint, migrateLayout } from "./workflow/engine.js";
export declare const dddWorkflowTools: Record<string, any>;
export declare const DddWorkflowProtectionPlugin: Plugin;
export declare const DddWorkflowPlugin: Plugin;
export default DddWorkflowPlugin;
export declare const dddWorkflowAdmin: {
    environmentReport: typeof environmentReport;
    beginStage: typeof beginStage;
    checkpoint: typeof checkpoint;
    migrateLayout: typeof migrateLayout;
};
export declare const bundledOpenSpec: typeof openSpecRuntime;
export { openSpecNodeExecutable } from "./workflow/openspec.js";
