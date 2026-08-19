import path from "node:path";
import { tool } from "@opencode-ai/plugin";
import { environmentReport } from "./runtime.js";
import { openSpecRuntime } from "./workflow/openspec.js";
import { beginStage, checkpoint, getOpenSpecAction, initialize, migrateLayout, prepareMilestone, prepareStage, retryArchive, review, status, submitMilestone, submitStage } from "./workflow/engine.js";
import { WorkflowRuntimeError } from "./workflow/types.js";
import { guardMilestoneMutation, injectMilestoneEditProtection } from "./protection.js";
const workflowType = tool.schema.enum(["add-feature", "refactor-system", "create-system"]);
const executionMode = tool.schema.enum(["milestone", "stage"]);
const requiredText = () => tool.schema.string().min(1);
const stringList = () => tool.schema.array(requiredText());
const stageItem = tool.schema.object({
    id: requiredText().describe("Stable item id unique within this submission."),
    kind: requiredText().describe("One allowedItemKinds value returned by ddd_workflow_prepare."),
    statement: requiredText().describe("Business fact, candidate, decision, rule, or result owned by this stage."),
    maturity: requiredText().describe("One allowedMaturities value returned by ddd_workflow_prepare."),
    documentSection: requiredText().describe("One ownedSections heading returned by ddd_workflow_prepare."),
    tracesTo: stringList().optional(),
    evidenceRefs: stringList().optional(),
    attributes: tool.schema.record(tool.schema.string(), tool.schema.any()).optional(),
}).strict();
const stageRelation = tool.schema.object({
    id: requiredText(), type: requiredText(), from: requiredText(), to: requiredText(), rationale: requiredText(),
}).strict();
const deferredItem = tool.schema.object({
    id: requiredText(), kind: requiredText(), statement: requiredText(), targetStage: requiredText(),
    documentSection: requiredText(), reason: requiredText(), tracesTo: stringList().optional(),
}).strict();
const stageOverview = tool.schema.object({
    currentConclusion: requiredText(), latestBusinessIncrement: requiredText(),
    acceptanceChecklist: stringList().min(1), openQuestions: stringList().min(1), recommendation: requiredText(),
}).strict();
const relevanceAssessment = tool.schema.object({
    path: requiredText(), relevance: tool.schema.enum(["relevant", "not-relevant"]), reason: requiredText(),
}).strict();
const strategicBaseline = tool.schema.object({
    currentSpecs: tool.schema.array(relevanceAssessment),
    changes: tool.schema.array(relevanceAssessment),
    recoveredDecisions: tool.schema.array(tool.schema.object({
        id: requiredText(), sourcePath: requiredText(), decision: requiredText(), reason: requiredText(),
    }).strict()),
    unresolvedConflicts: tool.schema.array(requiredText()),
    strategicDisposition: tool.schema.object({
        status: tool.schema.enum(["pending", "proposed"]),
        reused: tool.schema.array(tool.schema.object({ baselineDecisionId: requiredText(), rationale: requiredText() }).strict()),
        changed: tool.schema.array(tool.schema.object({
            baselineDecisionId: requiredText(), proposedDecision: requiredText(), reason: requiredText(), impact: requiredText(),
        }).strict()),
        new: tool.schema.array(tool.schema.object({ id: requiredText(), proposedDecision: requiredText(), reason: requiredText(), impact: requiredText() }).strict()),
        conflicts: tool.schema.array(requiredText()),
    }).strict(),
}).strict();
const stageSubmission = tool.schema.object({
    inputReferences: stringList().min(1),
    items: tool.schema.array(stageItem).min(1),
    relations: tool.schema.array(stageRelation).optional(),
    deferredItems: tool.schema.array(deferredItem).optional(),
    soleOutput: tool.schema.object({ statement: requiredText(), itemRefs: stringList() }).strict(),
    sections: tool.schema.record(requiredText(), requiredText()),
    overview: stageOverview.optional(),
    strategicBaseline: strategicBaseline.optional(),
}).strict();
const submissionPatch = tool.schema.object({
    op: tool.schema.enum(["add", "replace", "remove"]),
    path: requiredText().describe("JSON Pointer under inputReferences/items/relations/deferredItems/soleOutput/sections/overview/strategicBaseline."),
    value: tool.schema.any().optional(),
}).strict();
const milestoneSubmission = tool.schema.object({
    stage: requiredText(),
    summary: requiredText(),
    submission: stageSubmission.optional(),
    repair_patch: tool.schema.array(submissionPatch).min(1).optional(),
    evidence_file: tool.schema.string().optional(),
}).strict();
const output = (value) => JSON.stringify(value, null, 2);
function runtimeFailure(error) {
    return {
        accepted: false,
        error: {
            schemaVersion: "ddd-runtime-error/v1",
            code: error.code,
            operation: error.operation,
            message: error.message,
            retryableByModel: false,
        },
        transition: {
            schemaVersion: "ddd-workflow-transition/v1",
            workflowStatus: "runtime_blocked",
            lastCompletedStage: null,
            stageRole: "blocked",
            milestoneRoman: null,
            milestoneTitle: null,
            milestoneReady: false,
            milestoneStatus: "runtime-contract-repair",
            documentRole: "none",
            humanReviewRequired: false,
            mustContinue: false,
            stopAllowed: true,
            stopReason: "runtime-contract-repair",
            nextStage: null,
            allowedNextStages: [],
            nextHumanGate: null,
            requiredAction: "runtime-contract-repair",
            message: "插件运行时合同失败。停止自动恢复，不得调用 Bash、npx、npm 全局安装或手工创建/删除 OpenSpec change。",
        },
        requiredAction: "runtime-contract-repair",
        mustContinue: false,
        stopAllowed: true,
    };
}
async function executeTool(operation, action) {
    void operation;
    try {
        return output(await action());
    }
    catch (error) {
        if (error instanceof WorkflowRuntimeError)
            return output(runtimeFailure(error));
        throw error;
    }
}
function projectRoot(args, context) {
    return path.resolve(args.project_root || context.worktree || context.directory || process.cwd());
}
function identity(args, context) {
    return { workflowType: args.workflow_type, workflowId: args.workflow_id, projectRoot: projectRoot(args, context) };
}
export const dddWorkflowTools = {
    ddd_workflow_init: tool({
        description: "Initialize exactly one routed DDD workflow in the in-process TypeScript engine and return its authoritative transition.",
        args: { workflow_type: workflowType, workflow_id: requiredText(), title: requiredText(), request: requiredText(), project_root: tool.schema.string().optional() },
        async execute(args, context) { return executeTool("workflow-init", () => initialize({ ...identity(args, context), title: args.title, request: args.request })); },
    }),
    ddd_workflow_prepare: tool({
        description: "Prepare the next DDD contract. Use mode=milestone for a linear path through the next human gate; use mode=stage with an explicit stage only for implementation loops, backtracking, or revision.",
        args: {
            workflow_type: workflowType,
            workflow_id: requiredText(),
            mode: executionMode,
            stage: requiredText().optional().describe("Required only when mode=stage; omit when mode=milestone."),
            project_root: tool.schema.string().optional(),
        },
        async execute(args, context) {
            if (args.mode === "stage" && !args.stage)
                throw new Error("stage is required when mode=stage");
            if (args.mode === "milestone" && args.stage)
                throw new Error("stage must be omitted when mode=milestone");
            return executeTool("workflow-prepare", () => args.mode === "stage"
                ? prepareStage({ ...identity(args, context), stage: args.stage })
                : prepareMilestone(identity(args, context)));
        },
    }),
    ddd_workflow_submit: tool({
        description: "Submit typed DDD payloads prepared by ddd_workflow_prepare. Use mode=milestone with the complete ordered batch, or mode=stage with exactly one entry; repairs use repair_patch instead of rebuilding submission.",
        args: {
            workflow_type: workflowType,
            workflow_id: requiredText(),
            mode: executionMode,
            submissions: tool.schema.array(milestoneSubmission).min(1),
            project_root: tool.schema.string().optional(),
        },
        async execute(args, context) {
            if (args.mode === "stage" && args.submissions.length !== 1)
                throw new Error("mode=stage requires exactly one submission entry");
            const submissions = args.submissions.map((entry) => ({
                stage: entry.stage,
                summary: entry.summary,
                submission: entry.submission,
                repairPatch: entry.repair_patch,
                evidenceFile: entry.evidence_file,
            }));
            return executeTool("workflow-submit", () => args.mode === "stage"
                ? submitStage({ ...identity(args, context), ...submissions[0] })
                : submitMilestone({ ...identity(args, context), submissions }));
        },
    }),
    ddd_workflow_review: tool({
        description: "Record a human milestone decision and return the deterministic next transition.",
        args: { workflow_type: workflowType, workflow_id: requiredText(), stage: requiredText(), decision: tool.schema.enum(["approve", "revise", "reject"]), reviewer: requiredText(), feedback: tool.schema.string().optional(), project_root: tool.schema.string().optional() },
        async execute(args, context) { return executeTool("review", () => review({ ...identity(args, context), stage: args.stage, decision: args.decision, reviewer: args.reviewer, feedback: args.feedback })); },
    }),
    ddd_workflow_status: tool({
        description: "Read the authoritative in-process TypeScript workflow transition; stopAllowed is the only normal stop authority.",
        args: { workflow_type: workflowType, workflow_id: requiredText(), project_root: tool.schema.string().optional() },
        async execute(args, context) { return executeTool("status", () => status(identity(args, context))); },
    }),
    ddd_workflow_archive: tool({
        description: "Retry or finalize OpenSpec archive after milestone VI approval using the native TypeScript engine.",
        args: { workflow_type: workflowType, workflow_id: requiredText(), project_root: tool.schema.string().optional() },
        async execute(args, context) { return executeTool("archive", () => retryArchive(identity(args, context))); },
    }),
    ddd_openspec_action: tool({
        description: "Get official OpenSpec status and dynamic artifact instructions within approved DDD gates.",
        args: { workflow_type: workflowType, workflow_id: requiredText(), artifact: tool.schema.enum(["proposal", "specs", "design", "tasks", "apply"]), project_root: tool.schema.string().optional() },
        async execute(args, context) { return executeTool("openspec-action", () => getOpenSpecAction({ ...identity(args, context), artifact: args.artifact })); },
    }),
};
export const DddWorkflowProtectionPlugin = async (pluginInput) => ({
    async config(config) {
        injectMilestoneEditProtection(config);
    },
    async "tool.execute.before"(input, hookOutput) {
        const root = path.resolve(pluginInput.worktree || pluginInput.directory || process.cwd());
        guardMilestoneMutation(input.tool, hookOutput.args, root);
    },
});
export const DddWorkflowPlugin = async (pluginInput) => ({
    ...(await DddWorkflowProtectionPlugin(pluginInput)),
    tool: dddWorkflowTools,
});
export default DddWorkflowPlugin;
export const dddWorkflowAdmin = { environmentReport, beginStage, checkpoint, migrateLayout };
export const bundledOpenSpec = openSpecRuntime;
export { openSpecNodeExecutable } from "./workflow/openspec.js";
//# sourceMappingURL=index.js.map