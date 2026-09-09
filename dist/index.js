import path from "node:path";
import { createHash } from "node:crypto";
import { readFile, readdir, rm } from "node:fs/promises";
import { tool } from "@opencode-ai/plugin";
import { initialize, prepare, submit, review, status, block, archive, openspec, containsRequiredConcept, validateMandatoryCompatibilityConstraints } from "./engine.js";
import { profileFor } from "./catalog.js";
import { loadState, saveState } from "./state.js";
import { workflowRoot, statePath } from "./state.js";
import { exists, readJson, writeJson } from "./fs.js";
import { evidenceBundle } from "./evidence.js";
import { compileDeliveryMilestoneSections, compileStructuredPlan, normalizeStructuredPlan, validateStructuredPlan } from "./delivery-plan.js";
import { recordRuntimeSession } from "./session-links.js";
import { turnIntents } from "./turn-intent.js";
import { beginSemanticTurn, clearSemanticTurn, declareIntent, intentError, bindIntentWorkflow, finishIntentReview, reviewMustStop, pendingCommands } from "./semantic-turn.js";
import { resolvePanelReview } from "./dashboard/session-handoff.js";
import { createInterruptionMonitor, readExecutionInterruption } from "./execution-interruption.js";
const savedPanelReviewTurns = new Set();
const workflowType = tool.schema.enum(["add-feature", "refactor-system", "create-system"]);
const lifecycleAction = tool.schema.enum(["intent", "init", "prepare", "evidence-bundle", "complete-stage", "review", "status", "block", "archive", "openspec", "openspec-plan"]);
const reqText = () => tool.schema.string().min(1);
function projectRoot(args, ctx) {
    return path.resolve(args.project_root || ctx.worktree || ctx.directory || process.cwd());
}
function normalizeDeltaSpec(raw, workflow) {
    let content = String(raw ?? "");
    if (workflow !== "refactor-system")
        content = content.replace(/^##\s+Requirements\s*$/mu, "## ADDED Requirements");
    const requirement = /^###\s+Requirement:\s*(.+)$/gmu;
    const matches = [...content.matchAll(requirement)];
    for (let index = matches.length - 1; index >= 0; index -= 1) {
        const match = matches[index];
        const start = match.index ?? 0;
        const end = matches[index + 1]?.index ?? content.length;
        let block = content.slice(start, end);
        if (!/\b(?:MUST|SHALL)\b/u.test(block)) {
            const lines = block.split(/\r?\n/u);
            const prose = lines.findIndex((line, lineIndex) => lineIndex > 0 && line.trim() && !/^#{1,6}\s|^-\s/u.test(line.trim()));
            if (prose >= 0)
                lines[prose] = `系统 MUST ${lines[prose].trim()}`;
            block = lines.join("\n");
        }
        if (!/^####\s+Scenario:/mu.test(block) && /^-\s+WHEN\b/mu.test(block) && /^-\s+THEN\b/mu.test(block)) {
            block = block.replace(/^-\s+WHEN\b/mu, `#### Scenario: ${match[1].trim()}\n- WHEN`);
        }
        content = `${content.slice(0, start)}${block}${content.slice(end)}`;
    }
    return content;
}
function identity(args, ctx) {
    return { workflowType: args.workflow_type, workflowId: args.workflow_id, projectRoot: projectRoot(args, ctx) };
}
const sessionIdentities = new Map();
async function bindRuntimeSession(identity, sessionID) {
    if (!sessionID)
        return;
    const root = path.join(identity.projectRoot, "openspec", "changes", identity.workflowId, "ddd");
    if (!await exists(statePath(root)))
        return;
    const state = await loadState(root);
    if (!recordRuntimeSession(state, sessionID))
        return;
    await saveState(root, state);
}
const LIFECYCLE_ONLY_SENTINEL = "__ddd-lifecycle-only__";
function pluginProjectRoots(pluginInput) {
    const input = pluginInput;
    return [...new Set([input.directory, input.worktree, process.cwd()]
            .filter((candidate) => Boolean(candidate))
            .map((candidate) => path.resolve(candidate)))];
}
async function persistedStageForSession(projectRoots, sessionID) {
    for (const projectRoot of Array.isArray(projectRoots) ? projectRoots : [projectRoots]) {
        const changesDir = path.join(projectRoot, "openspec", "changes");
        if (!await exists(changesDir))
            continue;
        for (const entry of await readdir(changesDir, { withFileTypes: true })) {
            if (!entry.isDirectory() || entry.name === "archive")
                continue;
            const root = path.join(changesDir, entry.name, "ddd");
            if (!await exists(statePath(root)))
                continue;
            try {
                const state = await loadState(root);
                if (state.runtimeSessionId !== sessionID || ["complete", "rejected"].includes(state.status))
                    continue;
                // prepare is intentionally cleared when a stage is published and at a
                // human gate. A new Mobile process must still recover the owning DDD
                // session before its first Read/Bash call. Prefer the explicit prepared
                // or blocked stage, then the pending human gate, and finally the durable
                // current/checkpoint stage. The sentinel fails closed for older states
                // that have session ownership but no usable stage id.
                const pendingGate = [...state.checkpoints].reverse().find((checkpoint) => checkpoint.status === "awaiting_review" || checkpoint.status === "revision_requested");
                if (state.status === "runtime_blocked")
                    return LIFECYCLE_ONLY_SENTINEL;
                return [state.preparedStage?.stage, state.runtimeBlock?.stage, pendingGate?.stage,
                    state.currentStage, state.checkpoints.at(-1)?.stage]
                    .find((stage) => typeof stage === "string" && stage.trim().length > 0)
                    ?? LIFECYCLE_ONLY_SENTINEL;
            }
            catch {
                // A malformed unrelated change must not break tool dispatch.
            }
        }
    }
    return undefined;
}
class NoActiveWorkflowError extends Error {
}
async function resolveActiveIdentity(ctx, workflowType, workflowId) {
    const root = path.resolve(ctx.worktree || ctx.directory || process.cwd());
    if (workflowId) {
        if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/u.test(workflowId))
            throw new Error("workflow_id 必须是工作流目录名，而不是路径。");
        const state = await loadState(path.join(root, "openspec", "changes", workflowId, "ddd"));
        if (state.workflowId !== workflowId || (workflowType && state.workflowType !== workflowType))
            throw new Error("指定工作流与持久化状态不一致。");
        return { workflowType: state.workflowType, workflowId, projectRoot: root };
    }
    const bound = ctx.sessionID ? sessionIdentities.get(ctx.sessionID) : undefined;
    if (bound && bound.projectRoot === root && await exists(statePath(path.join(root, "openspec", "changes", bound.workflowId, "ddd")))) {
        return bound;
    }
    const { readdir } = await import("node:fs/promises");
    const changesDir = path.join(root, "openspec", "changes");
    const candidates = [];
    if (await exists(changesDir)) {
        for (const entry of await readdir(changesDir, { withFileTypes: true })) {
            if (!entry.isDirectory() || entry.name === "archive")
                continue;
            const ddd = path.join(changesDir, entry.name, "ddd");
            if (await exists(statePath(ddd)))
                candidates.push(entry.name);
        }
    }
    if (candidates.length === 1) {
        const state = await loadState(path.join(changesDir, candidates[0], "ddd"));
        return { workflowType: state.workflowType, workflowId: state.workflowId, projectRoot: root };
    }
    if (ctx.sessionID && candidates.length > 1) {
        const states = await Promise.all(candidates.map(name => loadState(path.join(changesDir, name, "ddd"))));
        const linked = states.filter(state => state.runtimeSessionId === ctx.sessionID);
        if (linked.length === 1)
            return { workflowType: linked[0].workflowType, workflowId: linked[0].workflowId, projectRoot: root };
    }
    if (candidates.length === 0)
        throw new NoActiveWorkflowError("当前项目没有活动的 DDD change；请先用 action=init 创建。");
    throw new Error(`当前项目有多个活动 DDD change（${candidates.join("、")}），请显式传 workflow_type 与 workflow_id。`);
}
const out = (v) => JSON.stringify(v, null, 2);
function lifecycleFailure(error, action) {
    const result = {
        error: error.message,
        errorType: error.name,
    };
    if (action === "review") {
        return {
            ...result,
            retryableByModel: false,
            mustStop: true,
            stopReason: "human-gate-contract-failed",
            repairContract: {
                boundary: "human-review",
                allowedTools: ["ddd_lifecycle"],
                forbiddenRecovery: ["read milestone files", "scan OpenSpec", "inspect plugin source", "run shell commands"],
                nextAction: "原样向用户报告本错误并停止。不得自行把批准改为退回；只有用户明确给出修改意见后，才可用 review(decision=revise) 返回拥有该决策的阶段。",
            },
        };
    }
    return result;
}
export function lifecycleFinalizeMetadata(input) {
    return {
        plannedSlices: input.plannedSlices ?? input.planned_slices,
        sliceId: input.sliceId ?? input.slice_id,
    };
}
export function normalizeReviewDecision(value) {
    const normalized = String(value ?? "").trim().toLowerCase().replace(/[_\s-]+/gu, "");
    if (["approve", "approved", "批准", "通过"].includes(normalized))
        return "approve";
    if (["revise", "revision", "revisionrequested", "修改", "退回"].includes(normalized))
        return "revise";
    if (["reject", "rejected", "拒绝"].includes(normalized))
        return "reject";
    return null;
}
function enrichRoadmapSections(sections) {
    const trace = sections["交付追踪矩阵"];
    if (trace && !containsRequiredConcept(trace, "战术模型—切片—文件覆盖")) {
        sections["交付追踪矩阵"] = `${trace.trim()}\n\n战术模型—切片—文件覆盖：以上 ME/INV、切片和生产/测试文件映射是实施约束。`;
    }
    if (trace && !containsRequiredConcept(sections["交付追踪矩阵"], "模块—层—依赖机器合同")) {
        sections["交付追踪矩阵"] += "\n\n模块—层—依赖机器合同：沿用已批准的上下文优先分层与依赖方向。";
    }
    const openSpec = sections["OpenSpec 变更映射"];
    if (openSpec && !containsRequiredConcept(openSpec, "OpenSpec change 映射")) {
        sections["OpenSpec 变更映射"] = `OpenSpec change 映射：${openSpec.trim()}`;
    }
    const git = sections["Git 交付计划"];
    if (git && !containsRequiredConcept(git, "Git 基线与回滚策略")) {
        sections["Git 交付计划"] = `Git 基线与回滚策略：${git.trim()}`;
    }
}
function endpointContracts(text) {
    const result = new Set();
    for (const match of text.matchAll(/\b(GET|POST|PUT|PATCH|DELETE)\s+(\/[A-Za-z0-9_{}\-/.?=&$()]+)/giu)) {
        const route = match[2].split("?")[0].replace(/\/$/u, "") || "/";
        result.add(`${match[1].toUpperCase()} ${route}`);
    }
    return result;
}
async function validatePlanAgainstApprovedDesign(projectRoot, root, profile, state, plan) {
    const findings = [];
    const tacticalStages = new Set(profile.stages.filter((stage) => stage.scopeContract?.id === "context-tactical-design").map((stage) => stage.id));
    const tacticalCheckpoint = [...state.checkpoints].reverse().find((checkpoint) => tacticalStages.has(checkpoint.stage) && ["completed", "approved"].includes(checkpoint.status));
    let approvedText = "";
    if (tacticalCheckpoint) {
        const fileName = profile.documents[tacticalCheckpoint.document];
        const file = fileName ? path.join(root, fileName) : "";
        if (file && await exists(file))
            approvedText = await readFile(file, "utf8");
    }
    const planText = JSON.stringify(plan);
    const approvedEndpoints = endpointContracts(approvedText);
    for (const endpoint of endpointContracts(planText)) {
        if (!approvedEndpoints.has(endpoint))
            findings.push({
                code: "PLAN_UNAPPROVED_INTERFACE",
                path: "plan.slices",
                message: `交付计划引入了战术设计未批准的接口 ${endpoint}；路线图只能映射里程碑 IV 已批准契约。`,
            });
    }
    const repositoryEvidenceParts = [approvedText];
    for (const file of ["pom.xml", "build.gradle", "build.gradle.kts", "package.json", "docker-compose.yml", "compose.yml"]) {
        const candidate = path.join(projectRoot, file);
        if (await exists(candidate))
            repositoryEvidenceParts.push(await readFile(candidate, "utf8"));
    }
    const repositoryEvidence = repositoryEvidenceParts.join("\n");
    const infrastructureChecks = [
        [/\bflyway\b/iu, /\bflyway\b/iu, "Flyway"],
        [/\bliquibase\b/iu, /\bliquibase\b/iu, "Liquibase"],
        [/\bdocker(?:-compose|\s+compose)\b/iu, /\bdocker(?:-compose|\s+compose)\b/iu, "Docker Compose"],
        [/\bkafka(?:-topics|-console)?\b/iu, /\bkafka\b/iu, "Kafka 工具链"],
        [/\bredis-cli\b/iu, /\bredis(?:-cli)?\b/iu, "redis-cli"],
    ];
    for (const [used, evidenced, label] of infrastructureChecks) {
        if (used.test(planText) && !evidenced.test(repositoryEvidence))
            findings.push({
                code: "PLAN_UNEVIDENCED_INFRASTRUCTURE",
                path: "plan.slices[].verification",
                message: `交付计划使用了 ${label}，但批准战术设计和仓库构建配置均无该工具证据；请改用现有工程能力或列为人工阻塞。`,
            });
    }
    return findings;
}
function atomicSectionEntries(raw) {
    if (Array.isArray(raw)) {
        const entries = [];
        for (const item of raw) {
            if (!item || typeof item !== "object" || Array.isArray(item))
                return null;
            const heading = String(item.heading ?? "").trim();
            if (!heading || !("content" in item))
                return null;
            entries.push([heading, item.content]);
        }
        return entries;
    }
    if (raw && typeof raw === "object")
        return Object.entries(raw);
    return null;
}
function normalizeAtomicSections(raw) {
    const entries = atomicSectionEntries(raw) ?? [];
    return Object.fromEntries(entries.map(([heading, value]) => {
        const escaped = heading.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
        const content = String(value ?? "")
            .replace(new RegExp(`^\\s*##\\s+${escaped}\\s*\\r?\\n+`, "u"), "")
            .replace(/^##\s+/gmu, "### ")
            .trim();
        return [heading, content];
    }));
}
const DDD_COMMAND_TEMPLATE = [
    "Load `ddd-orchestrate` and treat the text below as the immutable original request.",
    "Use only `ddd_lifecycle`. The input value must be a native object, sections may be either a heading-to-content object or a native [{heading,content}] array, and observations must be a native array; never JSON-encode them as strings. For an existing-system evidence stage call action=evidence-bundle once after prepare with 2-6 likely source identifiers; prefer short symbols copied from the original request or signed repository evidence over invented compound class names. Do not use repository or shell exploration. For every stage call action=complete-stage once with every allowed heading. Continue until human review, a real block, archive, or completion.",
    "complete-stage owns claim bookkeeping and atomically publishes only the current Arabic stage artifact. Submit the full stage once. If it returns draft.saved=true, obey draft.repairContract: repair only editablePaths; when replaceObservations=true resend one complete observations array; a decisionItems[n] repair resends only that stable id and the runtime preserves siblings. If draft.retryableByModel=false, stop. The runtime automatically summarizes completed stage artifacts into the fixed Roman human-review document; never author that summary. At milestone V submit one structured openspec-plan, then complete-stage with empty input.",
    "Length targets are advisory; answer the stage-owned phaseRequiredOutcomes without padding. Omit observations when stageCard has no claimContract. Do not narrate plans between tool calls. Treat the evidence bundle as the available bounded evidence, not proof of complete business coverage; record anything outside it as evidence-gap/open-question. At a human gate output transition.message and stop.",
    "",
    "$ARGUMENTS",
].join("\n");
const disabledDddAgentTools = {
    invalid: false,
    ddd_lifecycle: true,
    skill: true,
    pdf_parse: false, excel_parse: false, excel_write: false,
    subagent: false, task: false, workflow_run: false, todowrite: false,
    webfetch: false, websearch: false, codesearch: false,
    // Skill authoring/evaluation tools are host-management capabilities. DDD
    // stages consume professional guidance through `skill`; exposing the
    // management surface only adds schema tokens and escape routes.
    skill_run_script: false,
    skill_prepare_workspace: false, skill_validate: false, skill_parse: false,
    skill_add_gold_standard: false, skill_list_gold_standards: false,
    skill_remove_gold_standard: false, skill_get_gold_advice: false,
    skill_eval: false, skill_improve_description: false, skill_optimize_loop: false,
    skill_aggregate_benchmark: false, skill_generate_report: false,
    skill_serve_review: false, skill_stop_review: false,
    skill_export_static_review: false,
    CronCreate: false, CronList: false, CronDelete: false,
    question: false, plan_enter: false, plan_exit: false, lsp: false,
    ls: false, list: false, mcp: false, lingji_run: false, evolve_run: false,
};
const modelingOnlyTools = {
    ...disabledDddAgentTools,
    bash: false, shell: false,
    edit: false, write: false, apply_patch: false, patch: false, multiedit: false, multi_edit: false,
};
const DDD_CODE_COMMAND_TEMPLATE = [
    "Load `ddd-implementation`. This command is only for approving milestone V, implementing approved vertical slices, and producing milestone VI evidence.",
    "First interpret the current user request using action=intent (messageID, intent, quote, continueAfterReview). status is allowed to resolve the current gate. This coding command can approve milestone V only, never VI or another gate. Then review with an explicit decision and reviewer at V only if the user authorized approval, or prepare at an approved implementation step. Never read, glob, grep or run Git before authorization and prepare.",
    "Use ddd_lifecycle for review/prepare/complete-stage. Review binds automatically; use status when needed to resolve the current state. Read only the approved roadmap/model contract and mapped source files. Implement one slice, run real tests, create one Git commit, then complete-stage with sliceId. A milestoneRoman=VI response with milestoneStatus=accumulating is not a stop condition: obey requiredAction and continue through model review. Stop only when humanReviewRequired=true, a real block is returned, or the workflow is complete.",
    "Do not redesign or rename ME/INV contracts. Gather relevant evidence and run necessary verification within host permissions; use block for genuine unresolved prerequisites, not a fixed tool budget.",
    "",
    "$ARGUMENTS",
].join("\n");
const lifecycleTool = tool({
    description: "DDD 生命周期。普通对话先 intent：input={messageID,intent:query|clarify|start|continue|approve|revise|reject,quote,continueAfterReview:boolean}。再按状态 init/prepare/evidence-bundle/complete-stage/review/openspec-plan/archive。status 始终可查询。",
    args: {
        action: lifecycleAction,
        workflow_type: workflowType.optional().describe("init 必填；其余当项目仅有一个活动 change 时可省略。"),
        workflow_id: reqText().optional().describe("init 必填；其余当项目仅有一个活动 change 时可省略。"),
        project_root: tool.schema.string().optional().describe("项目根目录，默认取会话 worktree。"),
        input: tool.schema.record(tool.schema.string(), tool.schema.any()).optional()
            .describe("init/prepare/evidence-bundle/complete-stage/review 的原生对象载荷。必须直接传对象，禁止把 JSON 再编码成字符串。"),
        plan: tool.schema.record(tool.schema.string(), tool.schema.any()).optional()
            .describe("仅 openspec-plan 使用的顶层计划对象：title/objective/nonGoals/designDecisions/capabilities/slices。直接传对象，禁止 JSON 字符串。"),
        mode: tool.schema.enum(["replace", "repair"]).optional().describe("openspec-plan 模式；首次 replace，修复 findings 时 repair。"),
        skip_specs: tool.schema.boolean().optional().describe("仅行为保持型重构的 openspec-plan 可设 true。"),
    },
    async execute(args, context) {
        try {
            if (args.action === 'intent') {
                const declared = declareIntent(context.sessionID, args.input);
                const kind = args.input?.intent;
                if (declared.accepted && ['continue', 'approve', 'revise', 'reject'].includes(kind)) {
                    const root = projectRoot(args, context);
                    const id = await resolveActiveIdentity({ sessionID: context.sessionID, worktree: root }, args.workflow_type, args.workflow_id);
                    const p = await profileFor(id.workflowType);
                    const state = await loadState(await workflowRoot(id.projectRoot, p.artifactBase, p.artifactSubdir, id.workflowId));
                    bindIntentWorkflow(context.sessionID, JSON.stringify([id.projectRoot, id.workflowType, id.workflowId]), kind === 'continue' ? undefined : state.checkpoints.at(-1)?.checkpointId);
                }
                return out(declared);
            }
            const deniedIntent = intentError(context.sessionID, args.action, args.input?.decision);
            if (deniedIntent)
                return out({ error: deniedIntent, allowedActions: ['intent', 'status'], mustStop: !deniedIntent.startsWith('DDD_INTENT_REQUIRED') });
            if (args.action === "review" && savedPanelReviewTurns.has(context.sessionID))
                return out({
                    error: "DDD_REVIEW_ALREADY_SAVED: 面板已保存本轮审核，不得重复 review。请先查询 status，按已保存反馈修订或继续。",
                    retryableByModel: false, alreadySaved: true, allowedActions: ["status"],
                });
            if (turnIntents.get(context.sessionID) === "read-only" && args.action !== "status")
                return out({
                    error: "DDD_READ_ONLY_TURN: 本轮仅询问或讨论，未授权推进工作流。请回答用户问题并停止；等待明确的继续、修改或审核指令。",
                    retryableByModel: false, mustStop: true, readOnly: true, allowedActions: ["status"],
                });
            const ctx = { sessionID: context.sessionID, worktree: context.worktree, directory: context.directory };
            let payload;
            if (typeof args.input === "string") {
                try {
                    payload = JSON.parse(args.input);
                }
                catch {
                    return out({ error: "input 字符串不是有效 JSON 对象。" });
                }
            }
            else
                payload = args.input;
            if (args.action === "init") {
                const i = payload;
                if (!args.workflow_type || !args.workflow_id || !i?.title || !i?.request) {
                    return out({ error: "init 需要 workflow_type、workflow_id 和 input.{title,request}。" });
                }
                const root = projectRoot(args, ctx);
                bindIntentWorkflow(context.sessionID, JSON.stringify([root, args.workflow_type, args.workflow_id]));
                const result = await initialize({ workflowType: args.workflow_type, workflowId: args.workflow_id, projectRoot: root, title: i.title, request: i.request });
                const identity = { workflowType: args.workflow_type, workflowId: args.workflow_id, projectRoot: root };
                sessionIdentities.set(context.sessionID, identity);
                await bindRuntimeSession(identity, context.sessionID);
                return out(result);
            }
            let id;
            try {
                id = await resolveActiveIdentity({ ...ctx, worktree: projectRoot(args, ctx) }, args.workflow_type, args.workflow_id);
            }
            catch (error) {
                if (args.action !== "status" || !(error instanceof NoActiveWorkflowError))
                    throw error;
                return out({
                    status: "empty", currentMilestone: null, requiredAction: "none", nextStage: null,
                    allowedNextStages: [], stopAllowed: true,
                    message: "当前项目还没有进行中的 DDD 工作流。",
                    guidance: "想开始时，输入 /ddd 加上你的需求即可，例如：/ddd 使用 DDD 重构这个项目。也可以描述新增功能或从零创建项目的需求，工作流会自动选择对应流程。",
                    readOnly: true,
                });
            }
            // 状态查询不得为会话绑定而写回工作流状态或生成投影。
            if (args.action !== "status") {
                bindIntentWorkflow(context.sessionID, JSON.stringify([id.projectRoot, id.workflowType, id.workflowId]));
                await bindRuntimeSession(id, context.sessionID);
                sessionIdentities.set(context.sessionID, id);
            }
            if (args.action === "prepare") {
                const i = payload ?? {};
                const requestedStage = typeof i.stage === "string" && /^(?:0[0-9]|1[0-2])-[a-z0-9-]+$/u.test(i.stage) ? i.stage : undefined;
                const transition = requestedStage ? null : await status(id);
                const stage = requestedStage ?? transition?.nextStage;
                if (!stage)
                    return out({ error: `prepare 需要明确 stage；当前候选为：${transition?.allowedNextStages.join("、") || "无"}。` });
                return out(await prepare({ ...id, stage }));
            }
            if (args.action === "evidence-bundle") {
                const i = payload;
                if (!baselineStages.has(String(i?.stage ?? "")))
                    return out({ error: "evidence-bundle 仅属于已有系统基线阶段（01-current-evidence 或 01-baseline-evidence）。" });
                return out(await evidenceBundle(id.projectRoot, id.workflowId, i?.terms));
            }
            if (args.action === "complete-stage") {
                const i = payload ?? {};
                const requestedStage = typeof i.stage === "string" && /^(?:0[0-9]|1[0-2])-[a-z0-9-]+$/u.test(i.stage) ? i.stage : undefined;
                const transition = requestedStage ? null : await status(id);
                const stage = requestedStage ?? transition?.nextStage;
                if (!stage)
                    return out({ error: `complete-stage 无法解析唯一阶段；当前候选为：${transition?.allowedNextStages.join("、") || "无"}。` });
                const workflowProfile = await profileFor(id.workflowType);
                const stageContract = workflowProfile.stages.find((item) => item.id === stage);
                let summary = String(i.summary ?? "").trim();
                let rawSections = i.sections;
                if (stageContract?.deliveryAssetGate) {
                    const root = await workflowRoot(id.projectRoot, workflowProfile.artifactBase, workflowProfile.artifactSubdir, id.workflowId);
                    const state = await loadState(root);
                    const planFile = path.join(root, ".ddd", "delivery", "plan.json");
                    if (!state.deliveryPlan || !await exists(planFile))
                        return out({
                            error: "交付规划阶段必须先成功调用一次 openspec-plan；运行时随后会自动编译里程碑 V，无需模型再次手写全文。",
                        });
                    const plan = await readJson(planFile);
                    const contractFile = path.join(root, "model-contract.json");
                    const contract = await exists(contractFile) ? await readJson(contractFile) : {};
                    const compiledMilestone = compileDeliveryMilestoneSections(plan, id.workflowId, contract, {
                        workflowType: id.workflowType,
                    });
                    summary = compiledMilestone.summary;
                    rawSections = Object.fromEntries(Object.entries(compiledMilestone.sections)
                        .filter(([heading]) => !["一页结论", "本次请您确认", "业务验收记录"].includes(heading)));
                    i.plannedSlices = state.deliveryPlan.sliceIds.length;
                }
                else if (!summary && rawSections === undefined) {
                    return out({ error: "complete-stage 需要 input.summary 或 input.sections。若上次返回 draft.saved=true，可只提交 findings.path 涉及的 sections；运行时会合并候选稿。" });
                }
                else if (rawSections !== undefined && atomicSectionEntries(rawSections) === null) {
                    return out({ error: "input.sections 必须是 {\"章节标题\":\"正文\"} 对象，或 [{\"heading\":\"章节标题\",\"content\":\"正文\"}] 数组。" });
                }
                const sections = normalizeAtomicSections(rawSections ?? {});
                if (stageContract?.deliveryAssetGate)
                    enrichRoadmapSections(sections);
                const observations = (Array.isArray(i.observations) ? i.observations : []).map((item) => {
                    const heading = String(item?.heading ?? "").trim();
                    if (Object.hasOwn(sections, heading))
                        return item;
                    const statement = String(item?.statement ?? "").trim();
                    const owners = Object.entries(sections).filter(([, content]) => statement && content.includes(statement));
                    return owners.length === 1 ? { ...item, heading: owners[0][0] } : item;
                });
                if (stage === "01-current-evidence" && typeof sections["证据与追踪"] === "string") {
                    const evidenceText = sections["证据与追踪"];
                    if (!["事实", "假设", "待确认"].every((term) => evidenceText.includes(term))) {
                        const gaps = observations
                            .filter((item) => item?.kind === "evidence-gap" || item?.kind === "open-question")
                            .map((item) => String(item.statement ?? "").trim()).filter(Boolean);
                        sections["证据与追踪"] = `${evidenceText.trim()}\n\n### 事实、假设与待确认项\n- 事实：上文事实均有证据索引或结构化结论支持。\n- 假设：证据包之外的信息仍处于未证实状态。\n- 待确认：${gaps.length ? gaps.join("；") : "当前没有新增待确认项。"}`;
                    }
                }
                const missingByHeading = new Map();
                for (const item of observations) {
                    const heading = String(item?.heading ?? "").trim();
                    const statement = String(item?.statement ?? "").trim();
                    if (!heading || !Object.hasOwn(sections, heading) || !statement)
                        continue;
                    if (!sections[heading].includes(statement)) {
                        missingByHeading.set(heading, [...(missingByHeading.get(heading) ?? []), statement]);
                    }
                }
                for (const [heading, statements] of missingByHeading) {
                    sections[heading] = `${sections[heading].trim()}\n\n### 结构化结论\n${statements.map((statement) => `- ${statement}`).join("\n")}`;
                }
                const metadata = lifecycleFinalizeMetadata(i);
                return out(await submit({ ...id, stage, summary, sections,
                    claims: observations.map((item) => claimFromObservation(stage, String(item?.heading ?? ""), item)),
                    replaceClaims: Array.isArray(i.observations),
                    ambiguityResolution: i.ambiguityResolution,
                    decisionItems: i.decisionItems,
                    finalize: true,
                    runtimeCompiled: Boolean(stageContract?.deliveryAssetGate),
                    ...metadata }));
            }
            if (args.action === "review") {
                const transition = await status(id);
                const i = payload;
                const decision = normalizeReviewDecision(i?.decision);
                const deniedDecision = intentError(context.sessionID, 'review', decision ?? undefined);
                if (deniedDecision)
                    return out({ error: deniedDecision });
                if (!decision || !i?.reviewer) {
                    return out({ error: "review 需要 input.{decision,reviewer}；stage 可省略并自动绑定当前唯一人工检查点。" });
                }
                const stage = transition.nextHumanGate ?? i.stage;
                if (!stage)
                    return out({ error: "当前没有待人工验收的里程碑，不能执行 review。" });
                const reviewProfile = await profileFor(id.workflowType);
                const reviewRoot = await workflowRoot(id.projectRoot, reviewProfile.artifactBase, reviewProfile.artifactSubdir, id.workflowId);
                const checkpoint = (await loadState(reviewRoot)).checkpoints.at(-1)?.checkpointId;
                bindIntentWorkflow(context.sessionID, JSON.stringify([id.projectRoot, id.workflowType, id.workflowId]), checkpoint);
                const reviewed = await review({ ...id, stage, decision, reviewer: i.reviewer, feedback: i.feedback,
                    resolution: i.resolution ?? (i.selectedCandidateId ? { selectedCandidateId: i.selectedCandidateId } : undefined) });
                finishIntentReview(context.sessionID);
                if (reviewMustStop(context.sessionID))
                    return out({ ...reviewed, requiredAction: 'stop', mustContinue: false, stopAllowed: true, message: '已记录本次审核；用户未授权继续推进，等待下一条指令。' });
                return out(reviewed);
            }
            if (args.action === "status") {
                const i = payload ?? {};
                const result = await status({ ...id, view: i.view });
                const profile = await profileFor(id.workflowType);
                const root = await workflowRoot(id.projectRoot, profile.artifactBase, profile.artifactSubdir, id.workflowId);
                const interrupted = await readExecutionInterruption(root, await loadState(root));
                if (interrupted)
                    Object.assign(result, { executionInterruption: interrupted, message: interrupted.message });
                if (turnIntents.get(context.sessionID) === "read-only" || turnIntents.get(context.sessionID) === "pending" || reviewMustStop(context.sessionID))
                    return out({ ...result,
                        workflowRequiredAction: result.requiredAction, workflowMustContinue: result.mustContinue,
                        requiredAction: "report-status", mustContinue: false, stopAllowed: true, readOnly: true,
                        message: `${interrupted ? interrupted.message + '\n' : ''}当前里程碑：${result.milestoneRoman ?? "尚未形成"}；状态：${result.milestoneStatus}。下一候选阶段：${result.nextStage ?? "无"}。本轮只报告状态，不执行下一步；等待用户明确授权。`,
                    });
                return out(result);
            }
            if (args.action === "block") {
                const i = payload;
                if (!i?.stage || !i?.reason)
                    return out({ error: "block 需要 input.{stage,reason}。" });
                return out(await block({ ...id, stage: i.stage, reason: i.reason, evidence: i.evidence, remediation: i.remediation }));
            }
            if (args.action === "archive")
                return out(await archive(id));
            if (args.action === "openspec") {
                const i = payload;
                if (!i?.artifact)
                    return out({ error: "openspec 需要 input.artifact。" });
                return out(await openspec({ ...id, artifact: i.artifact,
                    content: i.content, capability: i.capability, skipSpecs: i.skipSpecs }));
            }
            if (args.action === "openspec-plan") {
                const i = { ...(payload ?? {}), ...(args.plan ? { plan: args.plan } : {}), ...(args.mode ? { mode: args.mode } : {}),
                    ...(args.skip_specs !== undefined ? { skipSpecs: args.skip_specs } : {}) };
                const planningTransition = await status(id);
                const planningStageId = planningTransition.nextStage ?? planningTransition.allowedNextStages[0];
                const workflowProfile = await profileFor(id.workflowType);
                const planningStage = workflowProfile.stages.find((stage) => stage.id === planningStageId);
                if (!planningStage?.deliveryAssetGate)
                    return out({
                        error: `openspec-plan 只允许在交付规划阶段调用；当前阶段为 ${planningStageId ?? "无"}。`,
                        retryableByModel: false,
                    });
                const root = await workflowRoot(id.projectRoot, workflowProfile.artifactBase, workflowProfile.artifactSubdir, id.workflowId);
                const currentState = await loadState(root);
                const roadmapFile = path.join(root, ".ddd", "delivery", "roadmap.json");
                if (currentState.deliveryPlan?.source === "structured-openspec-plan"
                    && currentState.deliveryPlan.sliceIds.length > 0 && await exists(roadmapFile)) {
                    return out({
                        status: "ready",
                        alreadyCompiled: true,
                        immutable: true,
                        plannedSlices: currentState.deliveryPlan.sliceIds.length,
                        sliceIds: currentState.deliveryPlan.sliceIds,
                        nextAction: `不要再次调用 openspec-plan；只调用 {"action":"complete-stage","input":{}}。运行时将从已编译计划生成 ${planningStageId}，并自动设置 plannedSlices=${currentState.deliveryPlan.sliceIds.length}。`,
                    });
                }
                if (!i?.plan || typeof i.plan !== "object" || Array.isArray(i.plan))
                    return out({
                        error: "openspec-plan 需要顶层 plan 对象；不要放入 input 字符串。运行时会编译 proposal/specs/design/tasks/roadmap。",
                        requiredPlanFields: ["title", "objective", "nonGoals", "designDecisions", "capabilities[].delta", "capabilities[].requirements[].scenarios[]", "slices[].behaviorProtection", "slices[].rollback"],
                        exampleShape: { action: "openspec-plan", plan: { title: "...", objective: "...", nonGoals: [], designDecisions: [], capabilities: [], slices: [] } },
                    });
                const draftFile = path.join(root, ".ddd", "workbench", "openspec-plan.draft.json");
                const currentDraft = i.mode === "repair" && await exists(draftFile)
                    ? await readJson(draftFile) : undefined;
                const plan = normalizeStructuredPlan(i.plan, currentDraft);
                await writeJson(draftFile, plan);
                const findings = [
                    ...validateStructuredPlan(plan, { workflowType: id.workflowType, skipSpecs: i.skipSpecs === true }),
                    ...await validatePlanAgainstApprovedDesign(id.projectRoot, root, workflowProfile, currentState, plan),
                    // Validate preservation constraints before the plan becomes the
                    // immutable source for generated OpenSpec and milestone-V artifacts.
                    // Previously this ran only after compilation, turning an ordinary
                    // repairable omission into a durable runtime block.
                    ...await validateMandatoryCompatibilityConstraints(root, "delivery-planning", JSON.stringify(plan)),
                ];
                if (findings.length)
                    return out({
                        status: "invalid", findings, draftSaved: true, retryableByModel: true,
                        nextAction: "用 mode=repair 只提交 findings 涉及的 capability 或 slice；运行时保留其余草稿字段。",
                    });
                const compiled = compileStructuredPlan(plan, id.workflowId, { workflowType: id.workflowType, skipSpecs: i.skipSpecs === true });
                const contractFile = path.join(id.projectRoot, "openspec", "changes", id.workflowId, "ddd", "model-contract.json");
                let design = compiled.design;
                if (await exists(contractFile)) {
                    const contract = await readJson(contractFile);
                    const approvedModels = new Set((contract.modelElements ?? []).map((item) => String(item.id)));
                    const approvedInvariants = new Set((contract.invariants ?? []).map((item) => String(item.id)));
                    const referencedModels = new Set(plan.slices.flatMap((slice) => slice.modelElementIds));
                    const referencedInvariants = new Set(plan.slices.flatMap((slice) => slice.invariantIds));
                    const modelFindings = [
                        ...[...referencedModels].filter((modelId) => !approvedModels.has(modelId)).map((modelId) => ({ code: "PLAN_MODEL_UNKNOWN", path: "plan.slices[].modelElementIds", message: `${modelId} 不在批准的 model-contract.json 中。` })),
                        ...[...referencedInvariants].filter((invariantId) => !approvedInvariants.has(invariantId)).map((invariantId) => ({ code: "PLAN_INVARIANT_UNKNOWN", path: "plan.slices[].invariantIds", message: `${invariantId} 不在批准的 model-contract.json 中。` })),
                        ...[...approvedModels].filter((modelId) => !referencedModels.has(modelId)).map((modelId) => ({ code: "PLAN_MODEL_UNCOVERED", path: "plan.slices", message: `批准模型 ${modelId} 未被任何纵向切片覆盖。` })),
                        ...[...approvedInvariants].filter((invariantId) => !referencedInvariants.has(invariantId)).map((invariantId) => ({ code: "PLAN_INVARIANT_UNCOVERED", path: "plan.slices", message: `批准不变量 ${invariantId} 未被任何纵向切片覆盖。` })),
                    ];
                    if (modelFindings.length)
                        return out({ status: "invalid", findings: modelFindings, draftSaved: true, retryableByModel: true,
                            nextAction: "用 mode=repair 修正切片的 modelElementIds/invariantIds，必须与批准模型合同完全覆盖。" });
                    const appendix = [
                        "## 批准模型合同（运行时注入，不可改写）",
                        ...(contract.modelElements ?? []).map((item) => `- ${item.id} ${item.name}`),
                        ...(contract.invariants ?? []).map((item) => `- ${item.id}：${item.statement}`),
                    ].join("\n");
                    design = `${design.trim()}\n\n${appendix}`;
                }
                const normalizedSpecs = compiled.specs.map((spec) => ({ ...spec, content: normalizeDeltaSpec(spec.content, id.workflowType) }));
                const malformed = normalizedSpecs.filter((spec) => {
                    if (!spec.capability || !/^##\s+(?:ADDED|MODIFIED|REMOVED|RENAMED)\s+Requirements\s*$/mu.test(spec.content))
                        return true;
                    const blocks = String(spec.content).split(/^###\s+Requirement:/mu).slice(1);
                    return blocks.length === 0 || blocks.some((block) => !/\b(?:MUST|SHALL)\b/u.test(block) || !/^####\s+Scenario:/mu.test(block));
                });
                if (i.skipSpecs !== true && malformed.length)
                    throw new Error("STRUCTURED_PLAN_COMPILER_DEFECT：运行时生成了非法 Delta Spec。");
                const specsRoot = path.join(id.projectRoot, "openspec", "changes", id.workflowId, "specs");
                if (await exists(specsRoot) && i.skipSpecs !== true) {
                    const keep = new Set(normalizedSpecs.map((spec) => String(spec.capability)));
                    for (const entry of await readdir(specsRoot, { withFileTypes: true })) {
                        if (entry.isDirectory() && !keep.has(entry.name))
                            await rm(path.join(specsRoot, entry.name), { recursive: true, force: true });
                    }
                }
                const results = [];
                results.push(await openspec({ ...id, artifact: "proposal", content: compiled.proposal }));
                if (i.skipSpecs === true) {
                    results.push(await openspec({ ...id, artifact: "specs", skipSpecs: true }));
                }
                else {
                    const specs = normalizedSpecs;
                    if (specs.length === 0)
                        return out({ error: "openspec-plan 的 specs 不能为空；仅行为保持型重构可用 skipSpecs:true。" });
                    for (const spec of specs) {
                        if (!spec?.capability || !spec?.content)
                            return out({ error: "每个 spec 需要 {capability,content}。" });
                        results.push(await openspec({ ...id, artifact: "specs", capability: String(spec.capability), content: String(spec.content) }));
                    }
                }
                results.push(await openspec({ ...id, artifact: "design", content: design }));
                results.push(await openspec({ ...id, artifact: "tasks", content: compiled.tasks }));
                const deliveryRoot = path.join(root, ".ddd", "delivery");
                await writeJson(path.join(deliveryRoot, "plan.json"), plan);
                await writeJson(path.join(deliveryRoot, "roadmap.json"), compiled.roadmap);
                const state = await loadState(root);
                state.deliveryPlan = {
                    source: "structured-openspec-plan",
                    sliceIds: plan.slices.map((slice) => slice.id),
                    dependencies: Object.fromEntries(plan.slices.map((slice) => [slice.id, slice.dependsOn])),
                    completedSliceIds: [],
                };
                await saveState(root, state);
                await rm(draftFile, { force: true });
                return out({ status: "ready", artifacts: results.map((result) => result.artifact),
                    plannedSlices: plan.slices.length, sliceIds: state.deliveryPlan.sliceIds,
                    nextAction: `只调用 {"action":"complete-stage","input":{}}；运行时将从已校验计划确定性编译里程碑 V，并自动设置 plannedSlices=${plan.slices.length}。` });
            }
            return out({ error: `未知 action：${args.action}` });
        }
        catch (error) {
            return out(lifecycleFailure(error, args.action));
        }
    },
});
function claimFromObservation(stage, heading, observation) {
    const rawRefs = (observation.evidence_refs ?? []).filter(Boolean).map((reference) => {
        const value = String(reference).trim().replace(/\\/gu, "/");
        if (/^(?:user-input|code|schema|test|runtime|openspec|git|search):/u.test(value))
            return value;
        if (/^openspec\//u.test(value))
            return `openspec:${value}`;
        if (/\.(?:sql|ddl)(?:#|$)/iu.test(value))
            return `schema:${value}`;
        if (/^(?:src|app|apps|packages|services|pom\.xml|build\.gradle)(?:\/|#|$)/u.test(value))
            return `code:${value}`;
        return value;
    });
    const authorityRefs = rawRefs.map((reference) => reference.startsWith("request:") ? "user-input:original-request"
        : reference === "openspec:index" ? "search:openspec/specs-and-prior-changes" : reference);
    const evidenceRefs = authorityRefs.filter((reference) => !reference.startsWith("user-input:"));
    const gap = observation.kind === "evidence-gap" || observation.kind === "open-question";
    const digest = createHash("sha256").update(`${stage}\0${heading}\0${observation.kind}\0${observation.statement}`).digest("hex").slice(0, 10);
    const absenceCandidate = observation.statement.replace(/[“"][^”"\n]{0,100}[”"]/gu, "").replace(/\s+/gu, "");
    const negative = /(?:^|(?:当前|现有|既有|代码|系统|仓库|能力|实现|定义|证据|路径|接口|表))[^。；]{0,18}(?:不存在|未发现|尚无|没有|无专门|无可执行)|(?:只有|仅有)[^。；]{0,30}(?:能力|实现|路径|接口|表|模块)/u.test(absenceCandidate);
    const absent = Boolean(observation.absent) || (negative && evidenceRefs.some((ref) => ref.startsWith("search:")));
    return {
        id: `${gap ? "OPEN" : "FACT"}-${digest}`,
        kind: observation.kind,
        statement: observation.statement.trim(),
        maturity: gap ? "hypothesis" : "fact",
        documentSection: heading,
        authorityRefs: authorityRefs.length ? authorityRefs : ["user-input:original-request"],
        evidenceRefs: gap ? evidenceRefs : evidenceRefs,
        attributes: {
            observationLevel: evidenceRefs.some((ref) => ref.startsWith("runtime:")) ? "runtime-observed"
                : evidenceRefs.some((ref) => ref.startsWith("test:")) ? "test-verified" : "statically-reachable",
            availability: absent ? "absent" : (gap ? "unknown" : "operational"),
            evidenceSubject: observation.statement.trim().slice(0, 160),
        },
    };
}
export const dddLifecycleTool = lifecycleTool;
// Mobile Coder may recreate the plugin hook object between model steps. Keep
// session guards at module scope so a stage prepared in one step still
// constrains repository and shell tools in the next step.
const dddSessions = new Set();
const codingSessions = new Set();
// The command hook is the only runtime boundary that sees the user's exact
// slash-command argument before the model can reinterpret it. Bind that text
// to the session and make init consume it as authoritative input.
const pendingOriginalRequests = new Map();
const activeStages = new Map();
const evidenceTools = new Set(["read", "glob", "grep"]);
const implementationStages = new Set(["08-implementation", "09-implementation", "11-implementation"]);
const baselineStages = new Set(["01-current-evidence", "01-baseline-evidence"]);
const lifecycleActions = new Set(["intent", "init", "prepare", "evidence-bundle", "complete-stage", "review", "status", "block", "archive", "openspec", "openspec-plan"]);
function dddRequestFromMessage(parts) {
    for (const part of parts) {
        if (part?.type !== "text")
            continue;
        const raw = String(part.text ?? "").trim().replace(/^(?:"|')|(?:"|')$/gu, "").trim();
        const match = raw.match(/^\/ddd(?:\s+)([\s\S]+)$/u);
        if (match?.[1]?.trim())
            return match[1].trim();
    }
    return undefined;
}
function applyModelingToolMask(message) {
    // UserMessage.tools is the Mobile/OpenCode boundary that controls the model
    // schema for the whole turn. Permission rules alone are insufficient in
    // YOLO mode, and in-memory Sets disappear between `mobile run` processes.
    // Reuse the same policy object used by the configured agent. Keeping one
    // source of truth prevents a host restart or slash-command expansion from
    // exposing a tool that the static agent configuration already denied.
    message.tools = { ...(message.tools ?? {}), ...modelingOnlyTools };
}
export const DddWorkflowPlugin = async (pluginInput, pluginOptions) => {
    const checkInterruption = createInterruptionMonitor(pluginInput.directory || pluginInput.worktree, pluginInput.client);
    // OpenCode and Mobile Coder 1.3+ both expose this definition directly from
    // the Plugin SDK. No MCP process, protocol adapter, or duplicated tool is
    // involved.
    const lifecycleToolId = "ddd_lifecycle";
    return {
        async event({ event }) {
            if (event.type !== 'session.idle' && !(event.type === 'session.status' && event.properties.status.type === 'idle'))
                return;
            try {
                await checkInterruption(event.properties.sessionID);
            }
            catch (error) {
                await pluginInput.client.app.log({ body: { service: 'ddd-workflow', level: 'warn', message: 'Interruption notification failed', extra: { error: String(error) } } }).catch(() => { });
            }
        },
        async "chat.message"(input, output) {
            savedPanelReviewTurns.delete(input.sessionID);
            const panel = await resolvePanelReview(path.resolve(pluginInput.directory || pluginInput.worktree || process.cwd()), input.sessionID, input.messageID ?? output.message.id);
            const text = output.parts.filter(p => p.type === "text").map(p => p.text ?? "").join("\n");
            const originalRequest = dddRequestFromMessage(output.parts);
            const persistedStage = await persistedStageForSession(pluginProjectRoots(pluginInput), input.sessionID);
            const command = pendingCommands.get(input.sessionID);
            pendingCommands.delete(input.sessionID);
            // Recognize legacy sessions for migration; never register or select these agents.
            const legacyDddSession = ['ddd-workflow', 'ddd-coding'].includes(input.agent ?? '');
            const codingAgent = command === 'ddd-code' || Boolean(persistedStage && implementationStages.has(persistedStage))
                || (command !== 'ddd' && codingSessions.has(input.sessionID));
            if (!command && !panel && !originalRequest && !persistedStage && !dddSessions.has(input.sessionID) && !legacyDddSession)
                return;
            if (panel) {
                clearSemanticTurn(input.sessionID);
                turnIntents.set(input.sessionID, panel.stale || panel.decision === 'reject' ? 'read-only' : 'execute');
            }
            else {
                const userText = originalRequest || (command === 'ddd' ? pendingOriginalRequests.get(input.sessionID) : undefined) || text;
                beginSemanticTurn(input.sessionID, input.messageID ?? output.message.id, userText, command === 'ddd-status');
                output.message.system = [output.message.system, `本轮 DDD 用户消息 ID：${input.messageID ?? output.message.id}。${command === 'ddd-status' ? '显式只读，只查询并报告状态。' : '由你理解用户语义，不使用关键词判断。首次写操作之前调用 ddd_lifecycle action=intent，input={messageID,intent:query|clarify|start|continue|approve|revise|reject,quote:本轮用户原话,continueAfterReview:boolean}。询问/讨论用query，含糊或冲突用clarify并提问；明确授权才声明相应操作。批准仅针对当前检查点；按用户是否要求继续决定continueAfterReview。状态查询可先执行。同一轮不需重复声明。'}`].filter(Boolean).join('\n');
            }
            if (panel) {
                savedPanelReviewTurns.add(input.sessionID);
                sessionIdentities.set(input.sessionID, { workflowType: panel.workflowType, workflowId: panel.workflowId, projectRoot: path.resolve(pluginInput.directory || pluginInput.worktree || process.cwd()) });
                output.message.system = [output.message.system, `DDD 面板上下文（已由消息 ID 核对持久化审核记录）：${JSON.stringify(panel)}。用户消息是原始反馈。审核已保存，禁止重复 review；先调用 ddd_lifecycle status。${panel.stale || panel.decision === "reject" ? "本轮只报告状态，不推进。" : "按已保存的审核和当前允许阶段修订或继续，停在下个人工检查点或真实阻塞；不自行批准。"}`].filter(Boolean).join("\n");
            }
            dddSessions.add(input.sessionID);
            if (persistedStage)
                activeStages.set(input.sessionID, persistedStage);
            if (originalRequest)
                pendingOriginalRequests.set(input.sessionID, originalRequest);
            if (codingAgent)
                codingSessions.add(input.sessionID);
            else
                codingSessions.delete(input.sessionID);
            // Mobile derives the visible tool table from UserMessage.tools. Put the
            // modeling policy at that boundary so disallowed tools are physically
            // absent from the model schema instead of relying only on a later hook.
            // The /ddd-code mode keeps engineering tools visible, but the
            // execute hook still requires lifecycle review/prepare before using them.
            if (!codingAgent)
                applyModelingToolMask(output.message);
        },
        async config(config) {
            config.command ??= {};
            config.command.ddd = {
                ...(config.command.ddd ?? {}),
                description: "启动或继续一个具有六个人工里程碑的 DDD 工作流",
                template: DDD_COMMAND_TEMPLATE,
            };
            config.command["ddd-code"] = {
                ...(config.command["ddd-code"] ?? {}),
                description: "批准交付计划并实现 DDD 纵向切片，形成真实测试与 Git 证据",
                template: DDD_CODE_COMMAND_TEMPLATE,
            };
            // Clear legacy command selection without touching unrelated user agents.
            delete config.command.ddd.agent;
            delete config.command['ddd-code'].agent;
        },
        async "command.execute.before"(input, output) {
            if (['ddd-status', 'ddd', 'ddd-code'].includes(input.command))
                pendingCommands.set(input.sessionID, input.command);
            if (input.command === "ddd-status")
                turnIntents.set(input.sessionID, "read-only");
            if (input.command === "ddd" || input.command === "ddd-code")
                dddSessions.add(input.sessionID);
            if (input.command === "ddd-code")
                codingSessions.add(input.sessionID);
            else if (input.command === "ddd")
                codingSessions.delete(input.sessionID);
            if (input.command === "ddd") {
                const originalRequest = String(input.arguments ?? "").trim();
                // An exact change directory name is a resume selector, never a new business request.
                if (/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/u.test(originalRequest)) {
                    const root = path.resolve(pluginInput.directory || pluginInput.worktree || process.cwd());
                    const id = await resolveActiveIdentity({ directory: root }, undefined, originalRequest);
                    const state = await loadState(path.join(root, "openspec", "changes", id.workflowId, "ddd"));
                    if (["complete", "rejected"].includes(state.status))
                        throw new Error("该工作流已结束，不能续跑；请通过 /ddd-workflow 查看历史。");
                    await bindRuntimeSession(id, input.sessionID);
                    sessionIdentities.set(input.sessionID, id);
                    pendingOriginalRequests.delete(input.sessionID);
                    output.parts = [{ type: "text", text: `继续已有 DDD 工作流 ${JSON.stringify(id.workflowId)}，类型 ${id.workflowType}。先调用 ddd_lifecycle(action="status", workflow_id=${JSON.stringify(id.workflowId)}, input={view:"compact"})，随后严格按返回的 requiredAction/allowedNextStages 续跑。禁止 init、重置状态或把目录名当成新需求。续跑不是批准：若等待人工审核，展示当前里程碑并等待明确审核；不得自动批准。若需要进入编码模式，提示使用 /ddd-code 继续，不在建模阶段编码。` }];
                    return;
                }
                if (originalRequest)
                    pendingOriginalRequests.set(input.sessionID, originalRequest);
            }
        },
        async "tool.execute.before"(input, hookOutput) {
            if (["edit", "write", "apply_patch", "patch", "multiedit", "multi_edit", "bash", "shell"].includes(input.tool.toLowerCase())) {
                const denied = intentError(input.sessionID, 'prepare');
                if (denied)
                    throw new Error(denied);
            }
            if (['read-only', 'pending'].includes(turnIntents.get(input.sessionID) ?? '') && ["edit", "write", "apply_patch", "patch", "multiedit", "multi_edit", "bash", "shell"].includes(input.tool.toLowerCase())) {
                throw new Error("DDD_READ_ONLY_TURN: 本轮未授权修改或执行，请仅报告当前状态。");
            }
            const args = hookOutput.args;
            // Mobile Coder may expose built-in tool ids with title casing (Read,
            // Glob, Edit). Normalize at the adapter boundary so policy cannot be
            // bypassed by host-specific capitalization.
            const toolName = String(input.tool ?? "").toLowerCase();
            const boundOriginalRequest = pendingOriginalRequests.get(input.sessionID);
            if (toolName === lifecycleToolId && args?.action === "init" && boundOriginalRequest) {
                let initPayload = {};
                if (typeof args.input === "string") {
                    try {
                        const parsed = JSON.parse(args.input);
                        if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
                            initPayload = parsed;
                    }
                    catch {
                        // Preserve the valid command request even when a weaker caller
                        // encoded the remaining init payload incorrectly. The lifecycle
                        // will still report any missing required field such as title.
                    }
                }
                else if (args.input && typeof args.input === "object" && !Array.isArray(args.input)) {
                    initPayload = args.input;
                }
                args.input = { ...initPayload, request: boundOriginalRequest };
            }
            if (toolName === "skill" && args?.name === "ddd-orchestrate")
                dddSessions.add(input.sessionID);
            const isDddLifecyclePayload = toolName === lifecycleToolId && typeof args?.action === "string" && lifecycleActions.has(args.action);
            if (isDddLifecyclePayload) {
                // Only the registered tool is a DDD boundary; matching payloads from
                // unrelated tools must not enroll or authorize a session.
                dddSessions.add(input.sessionID);
            }
            const activeStage = activeStages.get(input.sessionID)
                ?? await persistedStageForSession(pluginProjectRoots(pluginInput), input.sessionID);
            const sessionIsDdd = dddSessions.has(input.sessionID) || Boolean(activeStage);
            if (sessionIsDdd) {
                dddSessions.add(input.sessionID);
                if (activeStage)
                    activeStages.set(input.sessionID, activeStage);
            }
            const codingToolAccess = Boolean(activeStage && implementationStages.has(activeStage) && codingSessions.has(input.sessionID));
            // Read-only evidence gathering is allowed in prepared modeling stages.
            // The host retains shell/network/install permissions; call count and keywords are not authority.
            // Formal DDD/OpenSpec artifacts are transaction-owned. The model may
            // edit production code, but it must publish review documents and
            // planning artifacts through ddd_lifecycle so validation happens before
            // the atomic write. This also prevents a weaker scheduler from bypassing
            // the milestone-V artifact gate with a generic file tool.
            if (["edit", "write", "apply_patch", "patch", "multiedit", "multi_edit"].includes(toolName)) {
                const target = String(args?.filePath ?? args?.path ?? "").replace(/\\/gu, "/");
                const formalArtifact = /(?:^|\/)openspec\/changes\/[^/]+\/(?:ddd\/(?:(?:I|II|III|IV|V|VI)-[a-z-]+\.md|\.ddd\/stages\/(?:0[0-9]|1[0-2])-[a-z0-9-]+\.md)|proposal\.md|design\.md|tasks\.md|specs\/[^/]+\/spec\.md)$/iu;
                if (sessionIsDdd && target && formalArtifact.test(target)) {
                    throw new Error("DDD_FORMAL_ARTIFACT_WRITE_DENIED: 阶段产物、罗马数字里程碑和 OpenSpec 规划工件只能通过 ddd_lifecycle 事务写入；业务阶段无权直接修改人工验收文档。");
                }
            }
            if (sessionIsDdd && !codingToolAccess && !isDddLifecyclePayload && toolName !== "skill" && !(activeStage && evidenceTools.has(toolName))) {
                throw new Error("DDD_LIFECYCLE_ONLY: 当前阶段不允许工程写入或 Shell 执行。先通过 prepare 进入合法阶段；建模时可用只读工具补充证据，正式产物通过 ddd_lifecycle 发布。");
            }
        },
        async "tool.execute.after"(input, hookOutput) {
            const request = input.args ?? {};
            if (input.tool.toLowerCase() !== lifecycleToolId || request.action !== "prepare")
                return;
            try {
                const raw = hookOutput.output;
                const result = typeof raw === "string" ? JSON.parse(raw) : raw;
                if (result?.stageCard?.stageId) {
                    dddSessions.add(input.sessionID);
                    activeStages.set(input.sessionID, result.stageCard.stageId);
                }
            }
            catch {
                // Failed/unparseable results grant no stage access. Durable state
                // remains available to recover successful operations.
            }
        },
        tool: { [lifecycleToolId]: dddLifecycleTool },
    };
};
export default DddWorkflowPlugin;
//# sourceMappingURL=index.js.map