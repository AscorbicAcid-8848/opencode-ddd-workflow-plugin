import { cp, mkdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { stageContract, stageIndex, stageTitle, profileFor, profiles, intrinsicFor, intrinsics } from "./catalog.js";
import { addHiddenStageMetadata, appendReview, documentName, ensureDocumentSet, replaceSubsection, validateHumanMilestoneDocument } from "./documents.js";
import { atomicBytes, atomicText, exists, fileEvidence, now, readJson, sha256, snapshot, writeJson } from "./fs.js";
import { action as openSpecAction, archive as archiveOpenSpec, ensureChange, updateStatus, validatePlanning, validateStrict } from "./openspec.js";
import { activeChange, archiveCandidates, canonicalRoot, documentPath, internalRoot, openSpecLinkPath, relative, stageBundle, statePath, workflowRoot } from "./paths.js";
import { loadState, saveState } from "./state.js";
import { workflowTransition } from "./transition.js";
import { WorkflowError, WorkflowRuntimeError } from "./types.js";
import { validateStageBundle } from "./validation.js";
import { applyStageSubmissionPatch, compileStageSubmission, preparationContract, validateStageSubmission } from "./stage-submission.js";
import { validateDeliveryAssets, validateImplementationEvidence } from "./conformance.js";
import { compileStrategicBaseline, validateStrategicBaseline } from "./strategic.js";
export const WORKFLOW_SCHEMA = "1.16";
export const LAYOUT_SCHEMA = "fixed-business-sections/v1";
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
async function assertIdentity(identity) {
    if (!ID.test(identity.workflowId))
        throw new WorkflowError("workflow-id must be lowercase kebab-case");
    await profileFor(identity.workflowType);
}
async function reconcile(root, state) {
    const catalog = await profiles();
    const profile = await profileFor(state.workflowType);
    const legacy = path.join(state.projectRoot, "docs", "ddd", state.workflowId);
    if (path.resolve(root) === path.resolve(legacy) && state.status !== "complete")
        throw new WorkflowError("该工作流仍位于旧 docs/ddd 布局；请先执行 migrate-layout");
    if (!await exists(openSpecLinkPath(root)) && state.status !== "complete")
        await ensureChange(root, state, `升级既有 DDD 工作流：${state.title}`);
    await ensureDocumentSet(root, profile, state.title);
    const policyUpgrade = state.schemaVersion !== WORKFLOW_SCHEMA;
    let changed = state.profileSchemaVersion !== catalog.schemaVersion || policyUpgrade;
    for (const checkpoint of state.checkpoints) {
        const contract = stageContract(profile, checkpoint.stage);
        if (!contract.humanGate && checkpoint.reviewStatus === "awaiting_review") {
            checkpoint.reviewStatus = "not_required";
            checkpoint.reviewPacket = null;
            changed = true;
        }
        if (policyUpgrade && contract.humanGate && checkpoint.reviewStatus === "awaiting_review") {
            checkpoint.reviewStatus = "revision_requested";
            checkpoint.policyInvalidation = {
                reason: "里程碑必须依据当前跨表示语义、一致性和完整性门禁重新发布。",
                previousWorkflowSchema: state.schemaVersion,
                requiredWorkflowSchema: WORKFLOW_SCHEMA,
                invalidatedAt: now(),
            };
            state.status = "revision_requested";
            changed = true;
        }
    }
    if (changed) {
        state.profileSchemaVersion = catalog.schemaVersion;
        state.schemaVersion = WORKFLOW_SCHEMA;
        state.updatedAt = now();
        await saveState(root, state);
        await writePortal(root, state, profile);
    }
    return state;
}
export async function initialize(input) {
    await assertIdentity(input);
    const profile = await profileFor(input.workflowType);
    const root = await canonicalRoot(input);
    if (await exists(statePath(root)) || await exists(path.join(root, "workflow-state.json")))
        throw new WorkflowError(`Workflow already exists: ${root}`);
    if (await exists(activeChange(input.projectRoot, input.workflowId)) || (await archiveCandidates(input.projectRoot, input.workflowId)).length)
        throw new WorkflowError(`workflow-id 必须与 OpenSpec change-id 一一对应且不可复用：${input.workflowId}`);
    if (profile.stages[0]?.id !== "00-request")
        throw new WorkflowError("Profile must begin with 00-request");
    const catalog = await profiles();
    const state = {
        schemaVersion: WORKFLOW_SCHEMA, profileSchemaVersion: catalog.schemaVersion,
        documentLayoutVersion: LAYOUT_SCHEMA, workflowType: input.workflowType, workflowId: input.workflowId,
        title: input.title, projectRoot: path.resolve(input.projectRoot), artifactRoot: root,
        status: "active", currentStage: "00-request", createdAt: now(), updatedAt: now(), checkpoints: [], snapshot: {},
    };
    await ensureChange(root, state, input.request);
    await ensureDocumentSet(root, profile, input.title);
    await saveState(root, state);
    await writePortal(root, state, profile);
    await bootstrap(root, state, profile, profile.stages[0]);
    const checkpoint = await submit(root, state, profile.stages[0].id, "已记录原始请求并完成工作流路由");
    return { artifactRoot: root, checkpoint, transition: checkpoint.transition };
}
export async function beginStage(input) {
    await assertIdentity(input);
    const root = await workflowRoot(input);
    const state = await reconcile(root, await loadState(root));
    const profile = await profileFor(input.workflowType);
    const transition = workflowTransition(profile, state);
    if (!transition.allowedNextStages.includes(input.stage))
        throw new WorkflowError(`当前状态不允许开始 ${input.stage}；合法后续阶段：${transition.allowedNextStages.join("、") || "无"}`);
    const stage = stageContract(profile, input.stage);
    const result = await initializeWorkbench(root, state, profile, stage);
    return { ...result, transition };
}
export async function prepareStage(input) {
    await assertIdentity(input);
    const root = await workflowRoot(input);
    const state = await reconcile(root, await loadState(root));
    const profile = await profileFor(input.workflowType);
    const transition = workflowTransition(profile, state);
    if (!transition.allowedNextStages.includes(input.stage))
        throw new WorkflowError(`Stage ${input.stage} is not allowed; allowed stages: ${transition.allowedNextStages.join(", ") || "none"}`);
    const stage = stageContract(profile, input.stage);
    const prepared = await prepareStageContract(root, state, profile, stage);
    return { artifactRoot: root, ...prepared, transition };
}
async function prepareStageContract(root, state, profile, stage) {
    await initializeWorkbench(root, state, profile, stage);
    const bundle = stageBundle(root, profile, stage);
    const attempt = (state.stageAttempts ?? {})[stage.id];
    const savedDraft = await exists(bundle.draft) ? await readJson(bundle.draft) : null;
    const currentValidation = savedDraft
        ? await validateStageSubmission(root, state, profile, stage, savedDraft)
        : null;
    return {
        contract: await preparationContract(root, state, profile, stage),
        repairContext: await exists(bundle.draft) ? {
            available: true,
            draftPath: relative(root, bundle.draft),
            attempt: attempt ?? null,
            findings: currentValidation?.findings ?? attempt?.lastFindings ?? [],
            instruction: "Use repair_patch against the saved draft. Do not reconstruct or resend the full submission.",
        } : { available: false },
    };
}
function milestoneBatchStages(profile, state) {
    const transition = workflowTransition(profile, state);
    if (transition.stopAllowed || transition.requiredAction === "archive" || transition.requiredAction === "complete")
        return [];
    if (transition.requiredAction === "select-next-stage" || transition.allowedNextStages.length !== 1) {
        throw new WorkflowError("当前处于可重复实现或回溯选择；请使用单阶段工具执行一个批准的纵向切片");
    }
    const firstId = transition.nextStage ?? transition.allowedNextStages[0];
    const start = stageIndex(profile, firstId);
    const stages = [];
    for (const stage of profile.stages.slice(start)) {
        if ((stage.repeatable || stage.cycleGroup) && !stage.humanGate) {
            if (!stages.length)
                throw new WorkflowError("当前阶段属于可重复实现循环；请使用 prepare_stage/submit_stage 保持逐切片验证与 Git 提交");
            break;
        }
        stages.push(stage);
        if (stage.humanGate)
            break;
    }
    if (!stages.length || !stages.at(-1)?.humanGate)
        throw new WorkflowError("当前线性路径在下一个人工里程碑前包含实现循环；请使用单阶段工具");
    return stages;
}
export async function prepareMilestone(input) {
    await assertIdentity(input);
    const root = await workflowRoot(input);
    const state = await reconcile(root, await loadState(root));
    const profile = await profileFor(input.workflowType);
    const transition = workflowTransition(profile, state);
    const stages = milestoneBatchStages(profile, state);
    const prepared = [];
    for (const stage of stages)
        prepared.push({ stage: stage.id, ...(await prepareStageContract(root, state, profile, stage)) });
    const firstContract = prepared[0]?.contract ?? {};
    const sharedContract = {
        evidenceReferencePrefixes: firstContract.evidenceReferencePrefixes ?? [],
        semanticEnums: firstContract.semanticEnums ?? {},
        repairProtocol: firstContract.repairProtocol,
        executionRule: "Use each stage contract only for its governing question. Submit all entries once in submissionOrder; generated artifacts remain stage-scoped.",
    };
    for (const item of prepared) {
        for (const key of ["schemaVersion", "workflowType", "workflowId", "evidenceReferencePrefixes", "semanticEnums", "repairProtocol", "executionRule"]) {
            delete item.contract[key];
        }
    }
    const gate = stages.at(-1);
    const milestone = profile.milestones.find((item) => item.document === gate.document);
    return {
        schemaVersion: "ddd-milestone-preparation/v1",
        artifactRoot: root,
        mode: "linear-to-human-gate",
        milestone: milestone ? { roman: milestone.roman, title: milestone.title, document: milestone.document } : null,
        submissionOrder: stages.map((stage) => stage.id),
        sharedContract,
        stages: prepared,
        executionRule: "Reason across this milestone once, then call submit_milestone once with one ordered entry per stage. The runtime still validates and persists every stage increment separately.",
        transition,
    };
}
export async function submitMilestone(input) {
    await assertIdentity(input);
    const root = await workflowRoot(input);
    const initialState = await reconcile(root, await loadState(root));
    const profile = await profileFor(input.workflowType);
    const expected = milestoneBatchStages(profile, initialState).map((stage) => stage.id);
    const actual = input.submissions.map((entry) => entry.stage);
    if (JSON.stringify(actual) !== JSON.stringify(expected))
        throw new WorkflowError(`里程碑批次必须按顺序完整提交：${expected.join("、")}`);
    const completedStages = [];
    const checkpoints = [];
    let finalTransition;
    let humanReviewDocument = null;
    for (const entry of input.submissions) {
        const result = await submitStage({
            workflowType: input.workflowType,
            workflowId: input.workflowId,
            projectRoot: input.projectRoot,
            stage: entry.stage,
            summary: entry.summary,
            submission: entry.submission,
            repairPatch: entry.repairPatch,
            evidenceFile: entry.evidenceFile,
        });
        if (!result.accepted)
            return {
                accepted: false,
                schemaVersion: "ddd-milestone-submission/v1",
                completedStages,
                failedStage: entry.stage,
                stageResult: result,
                transition: result.transition,
            };
        completedStages.push(entry.stage);
        finalTransition = result.transition;
        humanReviewDocument = result.checkpoint.reviewPacket ?? null;
        checkpoints.push({
            checkpointId: result.checkpoint.checkpointId,
            stage: result.checkpoint.stage,
            reviewStatus: result.checkpoint.reviewStatus,
            document: result.checkpoint.document,
            summary: result.checkpoint.summary,
        });
    }
    return {
        accepted: true,
        schemaVersion: "ddd-milestone-submission/v1",
        completedStages,
        checkpoints,
        humanReviewDocument,
        transition: finalTransition,
    };
}
export async function submitStage(input) {
    await assertIdentity(input);
    const root = await workflowRoot(input);
    const state = await reconcile(root, await loadState(root));
    if (state.status === "runtime_blocked") {
        throw new WorkflowRuntimeError("WORKFLOW_RUNTIME_BLOCKED", "submit-stage", "工作流已进入 runtime-contract-repair；禁止模型通过重新提交或 Bash bridge 绕过不可重试错误。请修复插件运行时后再恢复。");
    }
    const profile = await profileFor(input.workflowType);
    const transition = workflowTransition(profile, state);
    if (!transition.allowedNextStages.includes(input.stage))
        throw new WorkflowError(`Stage ${input.stage} is not allowed; allowed stages: ${transition.allowedNextStages.join(", ") || "none"}`);
    const stage = stageContract(profile, input.stage);
    const bundle = stageBundle(root, profile, stage);
    await mkdir(bundle.workbench, { recursive: true });
    const previousAttempt = state.stageAttempts?.[stage.id];
    if (input.submission && previousAttempt && await exists(bundle.draft)) {
        state.status = "runtime_blocked";
        state.runtimeBlockedStage = stage.id;
        state.updatedAt = now();
        await saveState(root, state);
        await writePortal(root, state, profile);
        throw new WorkflowRuntimeError("FULL_RESUBMISSION_FORBIDDEN", "submit-stage", "阶段失败后只能提交 repair_patch；重新构造完整 submission 会丢失服务器草稿的有效字段，工作流已停止以防止模型绕过修复合同。");
    }
    let submission;
    try {
        if (input.submission && input.repairPatch?.length)
            throw new Error("provide either submission or repair_patch, not both");
        if (input.repairPatch?.length) {
            if (!await exists(bundle.draft))
                throw new Error("no saved submission draft exists for repair_patch");
            submission = applyStageSubmissionPatch(await readJson(bundle.draft), input.repairPatch);
        }
        else if (input.submission)
            submission = input.submission;
        else
            throw new Error("submission is required for the first attempt; use repair_patch only after a failed attempt");
    }
    catch (error) {
        return recordStageFailure(root, state, profile, stage, [{
                code: "SUBMISSION-REPAIR-INVALID", path: "repair_patch",
                message: error instanceof Error ? error.message : String(error), severity: "blocking",
                suggestion: "Use JSON Patch against the saved draft; do not resend the complete submission.",
            }], await exists(bundle.draft) ? bundle.draft : undefined);
    }
    await writeJson(bundle.draft, submission);
    const preflight = await validateStageSubmission(root, state, profile, stage, submission, input.summary);
    if (preflight.findings.length || !preflight.submission)
        return recordStageFailure(root, state, profile, stage, preflight.findings, bundle.draft);
    try {
        await compileStageSubmission(root, state, profile, stage, preflight.submission);
        if (stage.strategicBaselineGate) {
            await compileStrategicBaseline(root, state, stage.strategicBaselineGate, preflight.submission.strategicBaseline);
        }
        // A failed compile must not erase the previous attempt history. Work on a
        // transactional copy and commit the cleared counters only after the whole
        // stage bundle has passed validation and publication.
        const successfulState = structuredClone(state);
        const attempts = (successfulState.stageAttempts ?? {});
        delete attempts[stage.id];
        successfulState.stageAttempts = attempts;
        delete successfulState.runtimeBlockedStage;
        if (successfulState.status === "runtime_blocked")
            successfulState.status = "active";
        const result = await submit(root, successfulState, stage.id, input.summary, input.evidenceFile);
        return { accepted: true, validation: { verdict: "pass", findings: [] }, checkpoint: result, transition: result.transition };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return recordCompilerFailure(root, state, profile, stage, message, bundle.draft);
    }
}
async function recordCompilerFailure(root, state, profile, stage, message, draft) {
    const finding = {
        code: "COMPILED-BUNDLE-INVALID", path: "$", message, severity: "blocking",
        suggestion: "The typed submission passed preflight, so this is a deterministic compiler-contract defect. Stop model retries and repair the plugin runtime.",
    };
    const fingerprint = createHash("sha256").update(JSON.stringify([[finding.code, finding.path, finding.message]])).digest("hex");
    const attempts = (state.stageAttempts ?? {});
    const previous = attempts[stage.id];
    const attempt = {
        stage: stage.id,
        count: (previous?.count ?? 0) + 1,
        lastFingerprint: fingerprint,
        identicalFailureCount: previous?.lastFingerprint === fingerprint ? previous.identicalFailureCount + 1 : 1,
        findingCount: 1,
        bestFindingCount: Math.min(previous?.bestFindingCount ?? previous?.findingCount ?? 1, 1),
        noProgressCount: (previous?.noProgressCount ?? 0) + 1,
        progress: previous ? "stalled" : "first-failure",
        lastFindings: [finding],
        blocked: true,
        updatedAt: now(),
    };
    attempts[stage.id] = attempt;
    state.stageAttempts = attempts;
    state.status = "runtime_blocked";
    state.runtimeBlockedStage = stage.id;
    state.updatedAt = now();
    await saveState(root, state);
    await writePortal(root, state, profile);
    const transition = workflowTransition(profile, state);
    return {
        accepted: false,
        error: {
            schemaVersion: "ddd-runtime-error/v1",
            code: finding.code,
            operation: "compile-stage-bundle",
            message,
            retryableByModel: false,
        },
        validation: { schemaVersion: "ddd-stage-validation/v1", verdict: "fail", findings: [finding], findingCount: 1, fingerprint },
        attempt,
        retryPolicy: "Stop. A post-preflight compiler failure is a plugin runtime defect; do not patch the domain draft or edit generated files.",
        repair: { mode: "runtime-contract-repair", draftPath: relative(root, draft), preserveUnmentionedFields: true },
        transition,
        requiredAction: "runtime-contract-repair",
        mustContinue: false,
        stopAllowed: true,
    };
}
async function recordStageFailure(root, state, profile, stage, findings, draft) {
    const fingerprint = createHash("sha256").update(JSON.stringify(findings.map((item) => [item.code, item.path, item.message]).sort())).digest("hex");
    const attempts = (state.stageAttempts ?? {});
    const previous = attempts[stage.id];
    const count = (previous?.count ?? 0) + 1;
    const identicalFailureCount = previous?.lastFingerprint === fingerprint ? previous.identicalFailureCount + 1 : 1;
    const previousBest = previous?.bestFindingCount ?? previous?.findingCount;
    const bestFindingCount = Math.min(previousBest ?? findings.length, findings.length);
    const progress = previousBest === undefined ? "first-failure"
        : findings.length < previousBest ? "improved"
            : previous?.findingCount === findings.length ? "stalled" : "regressed";
    const noProgressCount = progress === "improved" || progress === "first-failure" ? 0 : (previous?.noProgressCount ?? 0) + 1;
    const improvedAfterBlock = Boolean(previous?.blocked && previousBest !== undefined && findings.length < previousBest);
    const blocked = !improvedAfterBlock && (Boolean(previous?.blocked) || identicalFailureCount >= 2 || noProgressCount >= 2 || count >= 6);
    const attempt = {
        stage: stage.id, count, lastFingerprint: fingerprint, identicalFailureCount,
        findingCount: findings.length, bestFindingCount, noProgressCount, progress, blocked, updatedAt: now(),
        lastFindings: findings,
    };
    attempts[stage.id] = attempt;
    state.stageAttempts = attempts;
    if (blocked) {
        state.status = "runtime_blocked";
        state.runtimeBlockedStage = stage.id;
    }
    state.updatedAt = now();
    await saveState(root, state);
    await writePortal(root, state, profile);
    const transition = workflowTransition(profile, state);
    return {
        accepted: false,
        validation: { schemaVersion: "ddd-stage-validation/v1", verdict: "fail", findings, findingCount: findings.length, fingerprint },
        attempt,
        retryPolicy: blocked
            ? "Stop. The stage is fused because failures repeated or stopped improving; repair the workflow contract before resuming."
            : "Apply every finding as one repair_patch against the saved draft. Do not reconstruct or resend the full submission.",
        repair: draft ? {
            mode: "json-patch",
            draftPath: relative(root, draft),
            preserveUnmentionedFields: true,
            nextCall: "ddd_workflow_submit(mode=stage) with repair_patch and without submission",
            example: [{ op: "add", path: "/soleOutput/itemRefs", value: ["ITEM-001"] }],
        } : { mode: "full-submission-required", available: false },
        transition,
    };
}
export async function checkpoint(input) {
    await assertIdentity(input);
    const root = await workflowRoot(input);
    const state = await reconcile(root, await loadState(root));
    return submit(root, state, input.stage, input.summary, input.evidenceFile);
}
async function submit(root, state, stageId, summary, evidenceFile) {
    const profile = await profileFor(state.workflowType);
    const stage = stageContract(profile, stageId);
    if (state.status === "rejected")
        throw new WorkflowError("该工作流已被人工拒绝，不能重新启动");
    const transitionBefore = workflowTransition(profile, state);
    const bootstrapAllowed = !state.checkpoints.length && stageId === "00-request";
    if (!bootstrapAllowed && !transitionBefore.allowedNextStages.includes(stageId))
        throw new WorkflowError(`checkpoint 未经合法 transition 授权：${stageId}`);
    if (!summary.trim() || summary.trim().length < 8)
        throw new WorkflowError("summary 必须描述本阶段真实业务增量");
    if (state.checkpoints.some((item) => item.reviewStatus === "awaiting_review"))
        throw new WorkflowError("存在待人工验收的里程碑，不能继续提交");
    const currentIndex = stageIndex(profile, stageId);
    const previous = state.checkpoints.at(-1);
    if (previous) {
        const previousIndex = stageIndex(profile, previous.stage);
        const previousStage = stageContract(profile, previous.stage);
        if (currentIndex < previousIndex && stage.cycleGroup === previousStage.cycleGroup && previous.reviewStatus === "approved") {
            for (const item of state.checkpoints)
                if (stageIndex(profile, item.stage) > currentIndex && item.reviewStatus === "approved")
                    item.reviewStatus = "superseded";
        }
    }
    const bundle = await validateStageBundle(root, state, profile, stage);
    if (stage.humanGate)
        validateHumanMilestoneDocument(await readFile(bundle.candidate, "utf8"));
    const formal = documentPath(root, profile, stage);
    const formalRelative = relative(root, formal);
    const expected = state.snapshot[formalRelative];
    if (expected && await exists(formal) && expected.sha256 !== await sha256(formal))
        throw new WorkflowError(`正式里程碑文档 ${path.basename(formal)} 被绕过 workbench 直接修改`);
    let openSpecValidation;
    let deliveryValidation;
    let strategicBaseline;
    if (stage.strategicBaselineGate)
        strategicBaseline = await validateStrategicBaseline(root, state, stage.strategicBaselineGate);
    if (stage.deliveryAssetGate || stage.openspecArtifactGate || stage.openspecTaskTracking || stage.openspecArchiveGate) {
        deliveryValidation = await validateDeliveryAssets(root, state);
    }
    if (stage.openspecArtifactGate) {
        openSpecValidation = { ...(await validatePlanning(root, state, "plan")), cli: await validateStrict(state) };
        await updateStatus(root, state, "planned");
    }
    else if (stage.openspecTaskTracking) {
        openSpecValidation = await validatePlanning(root, state, "implementation");
        await updateStatus(root, state, "implementing");
    }
    else if (stage.openspecArchiveGate) {
        openSpecValidation = { ...(await validatePlanning(root, state, "archive")), cli: await validateStrict(state) };
        await updateStatus(root, state, "ready-to-archive");
    }
    let implementation;
    if (stage.implementationEvidence)
        implementation = await validateImplementationEvidence(root, state, stageId, evidenceFile);
    else if (evidenceFile)
        throw new WorkflowError("--evidence-file 只能用于实现阶段");
    if (stage.requiresCompletedImplementation)
        requireCompletedImplementation(state);
    await atomicBytes(formal, await readFile(bundle.candidate));
    const checkpointId = state.checkpoints.length + 1;
    const submission = path.join(internalRoot(root), "checkpoints", `checkpoint-${String(checkpointId).padStart(3, "0")}`);
    await mkdir(submission, { recursive: true });
    const documentSnapshot = path.join(submission, path.basename(formal));
    await cp(formal, documentSnapshot);
    const outputSnapshot = path.join(submission, "stage-output.json");
    const reviewSnapshot = path.join(submission, "scope-review.json");
    await writeJson(outputSnapshot, bundle.output);
    await writeJson(reviewSnapshot, bundle.review);
    const currentSnapshot = await snapshot(root);
    const delta = path.join(submission, "file-delta.md");
    await atomicText(delta, renderDelta(stageId, state.snapshot, currentSnapshot));
    const artifacts = await Promise.all([documentSnapshot, outputSnapshot, reviewSnapshot, delta].map((file) => fileEvidence(file, root)));
    const record = {
        checkpointId, stage: stageId, stepTitle: stageTitle(stage), status: "submitted",
        reviewStatus: stage.humanGate ? "awaiting_review" : "not_required", review: null,
        summary, completedAt: now(), reviewPacket: stage.humanGate ? formalRelative : null,
        reviewTitle: stage.reviewTitle, reviewChecklist: stage.humanGate ? stage.checklist ?? [] : [],
        criticalGate: stage.criticalGate, adviceRequired: Boolean(stage.adviceRequired),
        document: formalRelative, documentSnapshot: relative(root, documentSnapshot), fileDelta: relative(root, delta),
        intrinsicContract: stage.intrinsicContract.id, stageOutput: relative(root, outputSnapshot), scopeReview: relative(root, reviewSnapshot), artifacts,
    };
    if (openSpecValidation)
        record.openSpec = openSpecValidation;
    if (deliveryValidation)
        record.delivery = deliveryValidation;
    if (strategicBaseline) {
        record.strategicBaseline = strategicBaseline;
        state.strategicBaseline = strategicBaseline;
    }
    if (implementation)
        record.implementationEvidence = implementation;
    state.checkpoints.push(record);
    state.currentStage = stageId;
    state.status = stage.humanGate ? "awaiting_review" : "active";
    state.updatedAt = now();
    state.snapshot = currentSnapshot;
    const transition = workflowTransition(profile, state);
    await saveState(root, state);
    await appendIncrement(root, { ...record, transition });
    await writePortal(root, state, profile);
    return { ...record, transition };
}
export async function review(input) {
    await assertIdentity(input);
    const root = await workflowRoot(input);
    const state = await reconcile(root, await loadState(root));
    const profile = await profileFor(input.workflowType);
    const target = [...state.checkpoints].reverse().find((item) => item.stage === input.stage && item.reviewStatus === "awaiting_review");
    if (!target)
        throw new WorkflowError(`No pending review exists for stage: ${input.stage}`);
    const stage = stageContract(profile, input.stage);
    if (!stage.humanGate)
        throw new WorkflowError("当前阶段不是人工验收卡点");
    const feedback = input.feedback?.trim() || "无补充意见。";
    if (["revise", "reject"].includes(input.decision) && !input.feedback?.trim())
        throw new WorkflowError(`${input.decision} requires actionable feedback`);
    const finalApproval = input.decision === "approve" && input.stage === profile.stages.at(-1)?.id;
    if (finalApproval) {
        requireCompletedImplementation(state);
        await validatePlanning(root, state, "archive");
        await validateDeliveryAssets(root, state);
        await validateStrict(state);
    }
    else if (input.decision === "revise")
        await updateStatus(root, state, "revision-requested");
    else if (input.decision === "reject")
        await updateStatus(root, state, "rejected");
    const reviewedAt = now();
    const formal = documentPath(root, profile, stage);
    let content = await readFile(formal, "utf8");
    const labels = { approve: "批准", revise: "修改", reject: "拒绝" };
    content = replaceSubsection(content, "当前状态", input.decision === "approve" ? "- 已批准，可以进入下一里程碑。" : input.decision === "revise" ? "- 已要求修改，修订后需要重新验收。" : "- 已拒绝，本方案停止。");
    content = replaceSubsection(content, "是否需要人工决策", input.decision === "revise" ? "- 是，需要按照验收意见修订后重新提交。" : "- 否，本里程碑已经完成人工决策。");
    content = appendReview(content, stage, { time: reviewedAt, decision: labels[input.decision], reviewer: input.reviewer, feedback });
    await atomicText(formal, content);
    target.reviewStatus = input.decision === "approve" ? "approved" : input.decision === "revise" ? "revision_requested" : "rejected";
    target.review = { decision: input.decision, reviewer: input.reviewer, reviewedAt, feedback, path: target.document, sha256: await sha256(formal) };
    state.status = finalApproval ? "awaiting_archive" : input.decision === "approve" ? "active" : target.reviewStatus;
    state.updatedAt = reviewedAt;
    state.snapshot = await snapshot(root);
    await saveState(root, state);
    await appendReviewLog(root, target);
    await writePortal(root, state, profile);
    if (finalApproval) {
        const archivedRoot = await archiveOpenSpec(root, state);
        await saveState(archivedRoot, state);
        await writePortal(archivedRoot, state, profile);
    }
    return { review: target.review, transition: workflowTransition(profile, state) };
}
export async function status(input) {
    await assertIdentity(input);
    const root = await workflowRoot(input);
    const state = await reconcile(root, await loadState(root));
    const profile = await profileFor(input.workflowType);
    const latest = state.checkpoints.at(-1);
    const transition = workflowTransition(profile, state);
    return {
        workflowType: state.workflowType, workflowId: state.workflowId, status: state.status,
        currentStage: state.currentStage, currentStepTitle: latest?.stepTitle ?? null,
        artifactRoot: state.artifactRoot, openSpec: state.openSpec, checkpointCount: state.checkpoints.length,
        reviewStatus: latest?.reviewStatus ?? null,
        pendingCriticalReviews: state.checkpoints.filter((item) => item.criticalGate && item.reviewStatus === "awaiting_review").map((item) => ({ stage: item.stage, title: item.reviewTitle, document: item.document })),
        transition, ...transition, nextAction: transition.message,
        document: latest?.document, reviewTitle: latest?.reviewTitle, reviewChecklist: latest?.reviewChecklist ?? [], criticalGate: latest?.criticalGate, adviceRequired: latest?.adviceRequired ?? false,
    };
}
export async function retryArchive(input) {
    await assertIdentity(input);
    const root = await workflowRoot(input);
    const state = await reconcile(root, await loadState(root));
    if (state.status === "complete")
        return status(input);
    if (state.status !== "awaiting_archive")
        throw new WorkflowError("只有最终验收已批准且待归档的工作流可以执行 archive");
    const profile = await profileFor(input.workflowType);
    const archivedRoot = await archiveOpenSpec(root, state);
    await saveState(archivedRoot, state);
    await writePortal(archivedRoot, state, profile);
    return { artifactRoot: archivedRoot, transition: workflowTransition(profile, state) };
}
export async function getOpenSpecAction(input) {
    const root = await workflowRoot(input);
    const state = await reconcile(root, await loadState(root));
    const profile = await profileFor(state.workflowType);
    const planning = new Set(["proposal", "specs", "design", "tasks"]);
    if (planning.has(input.artifact) && !state.checkpoints.some((item) => item.criticalGate === "tactical-design" && item.reviewStatus === "approved"))
        throw new WorkflowError("OpenSpec planning artifacts 只能在里程碑 IV 批准后生成");
    if (input.artifact === "apply") {
        if (!state.checkpoints.some((item) => stageContract(profile, item.stage).openspecArtifactGate && item.reviewStatus === "approved"))
            throw new WorkflowError("OpenSpec apply instructions 只能在里程碑 V 批准后获取");
        await validatePlanning(root, state, "plan");
    }
    return openSpecAction(root, state, input.artifact);
}
export async function migrateLayout(input) {
    await assertIdentity(input);
    const source = path.resolve(input.legacyRoot);
    const target = await canonicalRoot(input);
    if (await exists(target) || (await archiveCandidates(input.projectRoot, input.workflowId)).length)
        throw new WorkflowError(`目标工作流已存在或 change 已归档：${target}`);
    const sourceStateFile = await exists(path.join(source, ".ddd", "workflow-state.json")) ? path.join(source, ".ddd", "workflow-state.json") : path.join(source, "workflow-state.json");
    if (!await exists(sourceStateFile))
        throw new WorkflowError(`Legacy workflow state is missing under: ${source}`);
    const state = await readJson(sourceStateFile);
    if (state.workflowType !== input.workflowType || state.workflowId !== input.workflowId)
        throw new WorkflowError("Legacy workflow identity does not match migration request");
    const profile = await profileFor(input.workflowType);
    state.projectRoot = path.resolve(input.projectRoot);
    state.artifactRoot = target;
    state.schemaVersion = WORKFLOW_SCHEMA;
    state.profileSchemaVersion = (await profiles()).schemaVersion;
    state.documentLayoutVersion ??= LAYOUT_SCHEMA;
    state.migratedFrom = source;
    state.migratedAt = now();
    state.updatedAt = now();
    await ensureChange(target, state, `从旧 DDD 工作流迁移：${source}`);
    await ensureDocumentSet(target, profile, state.title);
    for (const milestone of profile.milestones) {
        const writer = profile.stages.find((stage) => stage.document === milestone.document);
        const name = documentName(target, profile, writer);
        const candidates = [path.join(source, name), path.join(source, "docs", name)];
        const old = (await Promise.all(candidates.map(async (file) => await exists(file) ? file : null))).find(Boolean);
        if (old)
            await cp(old, path.join(target, name), { force: true });
    }
    const sourceInternal = await exists(path.join(source, ".ddd")) ? path.join(source, ".ddd") : source;
    const targetInternal = internalRoot(target);
    for (const name of ["checkpoints", "delivery", "implementation-evidence", "increment-log.md"]) {
        const old = path.join(sourceInternal, name);
        if (await exists(old))
            await cp(old, path.join(targetInternal, name), { recursive: true, force: true });
    }
    state.snapshot = await snapshot(target);
    await saveState(target, state);
    await writeJson(path.join(targetInternal, "migration-manifest.json"), { migratedAt: state.migratedAt, legacyRoot: source, targetRoot: target, checkpointCount: state.checkpoints.length });
    await writePortal(target, state, profile);
    return { artifactRoot: target, migratedFrom: source, checkpointCount: state.checkpoints.length, transition: workflowTransition(profile, state) };
}
async function initializeWorkbench(root, state, profile, stage) {
    const bundle = stageBundle(root, profile, stage);
    await mkdir(bundle.workbench, { recursive: true });
    const source = documentPath(root, profile, stage);
    const content = addHiddenStageMetadata(await readFile(source, "utf8"), stage);
    await atomicText(bundle.candidate, content);
    const [intrinsicId, intrinsic] = await intrinsicFor(state.workflowType, stage.id);
    const catalog = await intrinsics();
    const output = {
        schemaVersion: "ddd-stage-output/v3", workflowType: state.workflowType, workflowId: state.workflowId,
        stageId: stage.id, intrinsicContract: intrinsicId, scopeId: intrinsic.scopeId, governingQuestion: intrinsic.governingQuestion,
        inputReferences: ["待填写：仅列出本阶段获准消费的输入"], items: [], relations: [], deferredItems: [],
        soleOutput: { kind: intrinsic.soleOutput.kind, consumers: intrinsic.soleOutput.consumers, statement: "待填写：只描述本阶段交给下游的唯一输出", itemRefs: [] },
        candidateDocument: { path: relative(root, bundle.candidate), sha256: await sha256(bundle.candidate) },
    };
    const review = {
        schemaVersion: "ddd-scope-review/v3", workflowType: state.workflowType, workflowId: state.workflowId,
        stageId: stage.id, intrinsicContract: intrinsicId, scopeId: intrinsic.scopeId,
        candidateDocumentSha256: await sha256(bundle.candidate), stageOutputSha256: "待阶段工件冻结后填写其 SHA-256",
        reviewerRole: "deterministic-stage-scope-auditor", itemAssessments: [], relationAssessments: [],
        soleOutputAssessment: { quote: "待逐字引用 soleOutput.statement", actualOwnerStage: stage.id, actualOwnerContract: intrinsicId, actualDecisionLevel: intrinsic.scopeId, action: "remove", severity: "blocking", rationale: "待独立 Scope Review，不得由阶段作者自报通过。" },
        sectionAssessments: [], findings: [], reviewedAt: "",
    };
    await writeJson(bundle.output, output);
    await writeJson(bundle.review, review);
    return {
        candidateDocument: bundle.candidate, stageOutput: bundle.output, scopeReview: bundle.review,
        intrinsicContract: intrinsicId, governingQuestion: intrinsic.governingQuestion,
        allowedItemKinds: intrinsic.allowedItemKinds, allowedMaturities: catalog.scopePolicies[intrinsic.scopeId].allowedMaturities,
        ownedSections: intrinsic.ownedSections, soleOutput: intrinsic.soleOutput,
        semanticGraphContract: { schema: "ddd-stage-output/v3", policy: catalog.semanticGraph?.policies?.[intrinsicId] ?? {}, relationTypes: catalog.semanticGraph?.relationTypes ?? [] },
        scopeReviewRule: "冻结候选稿与 stage-output 后，以独立审查轮次逐条引用原文；最终 pass/fail 由程序计算。",
    };
}
async function bootstrap(root, state, profile, stage) {
    const result = await initializeWorkbench(root, state, profile, stage);
    const routeStatement = `请求互斥路由为 ${state.workflowType}`;
    let candidate = await readFile(result.candidateDocument, "utf8");
    candidate = replaceSubsection(candidate, "业务问题与目标", `- ${state.title}\n- ${routeStatement}`);
    await atomicText(result.candidateDocument, candidate);
    const output = await readJson(result.stageOutput);
    output.candidateDocument.sha256 = await sha256(result.candidateDocument);
    output.inputReferences = ["用户原始请求", "仓库状态"];
    output.items = [{ id: "ROUTE-001", kind: "route-decision", statement: routeStatement, ownerStage: stage.id, ownerContract: output.intrinsicContract, decisionLevel: output.scopeId, maturity: "fact", documentSection: (await intrinsicFor(state.workflowType, stage.id))[1].ownedSections[0], tracesTo: ["用户原始请求"], evidenceRefs: [], attributes: {} }];
    output.soleOutput.statement = `后续仅执行 ${state.workflowType} 工作流`;
    output.soleOutput.itemRefs = ["ROUTE-001"];
    await writeJson(result.stageOutput, output);
    const review = await readJson(result.scopeReview);
    review.candidateDocumentSha256 = await sha256(result.candidateDocument);
    review.stageOutputSha256 = await sha256(result.stageOutput);
    review.reviewedAt = now();
    review.itemAssessments = [{ itemId: "ROUTE-001", quote: output.items[0].statement, actualOwnerStage: stage.id, actualOwnerContract: output.intrinsicContract, actualDecisionLevel: output.scopeId, action: "retain", severity: "none", rationale: "路由只选择一条工作流。" }];
    review.soleOutputAssessment = { quote: output.soleOutput.statement, actualOwnerStage: stage.id, actualOwnerContract: output.intrinsicContract, actualDecisionLevel: output.scopeId, action: "retain", severity: "none", rationale: "唯一输出仅交给已选择工作流。" };
    review.sectionAssessments = [{ section: "业务主题与分析范围", quote: routeStatement, actualOwnerStage: stage.id, actualOwnerContract: output.intrinsicContract, actualDecisionLevel: output.scopeId, action: "retain", severity: "none", rationale: "请求路由属于工作流初始化责任。" }];
    await writeJson(result.scopeReview, review);
}
function requireCompletedImplementation(state) {
    const implementation = state.checkpoints.filter((item) => /implementation/.test(item.stage));
    if (!implementation.length || implementation.every((item) => !item.implementationEvidence))
        throw new WorkflowError("最终验收前必须存在通过验证的实现证据");
}
function renderDelta(stage, before, after) {
    const rows = [];
    for (const file of [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()) {
        if (!before[file])
            rows.push(`| added | \`${file}\` | \`${after[file].sha256}\` |`);
        else if (!after[file])
            rows.push(`| removed | \`${file}\` | - |`);
        else if (before[file].sha256 !== after[file].sha256)
            rows.push(`| modified | \`${file}\` | \`${after[file].sha256}\` |`);
    }
    return `# ${stage} 文件增量\n\n| 变化 | 文件 | SHA-256 |\n|---|---|---|\n${rows.join("\n") || "| unchanged | - | - |"}\n`;
}
async function writePortal(root, state, profile) {
    const rows = profile.milestones.map((milestone) => {
        const writers = profile.stages.filter((stage) => stage.document === milestone.document);
        const gate = writers.at(-1);
        const checkpoint = [...state.checkpoints].reverse().find((item) => item.stage === gate.id);
        const label = !checkpoint ? "未到达" : checkpoint.reviewStatus === "awaiting_review" ? "等待人工验收" : checkpoint.reviewStatus === "approved" ? "已批准" : checkpoint.reviewStatus;
        return `| ${milestone.roman} | ${milestone.title} | [${documentName(root, profile, gate)}](${documentName(root, profile, gate)}) | ${label} |`;
    });
    const transition = workflowTransition(profile, state);
    await atomicText(path.join(root, "README.md"), `# ${state.title}\n\n- 工作流：\`${state.workflowType}\`\n- Change：\`${state.workflowId}\`\n- 当前内部阶段：\`${state.currentStage}\`\n- 下一动作：${transition.message}\n\n| 里程碑 | 主题 | 文档 | 状态 |\n|---|---|---|---|\n${rows.join("\n")}\n`);
}
async function appendIncrement(root, value) {
    const file = path.join(internalRoot(root), "increment-log.md");
    const current = await exists(file) ? await readFile(file, "utf8") : "# DDD 增量日志\n";
    await atomicText(file, `${current}\n## Checkpoint ${value.checkpointId}: ${value.stage}\n\n- 时间：${value.completedAt}\n- 摘要：${value.summary}\n- 下一动作：${value.transition.message}\n`);
}
async function appendReviewLog(root, checkpoint) {
    const file = path.join(internalRoot(root), "increment-log.md");
    const current = await exists(file) ? await readFile(file, "utf8") : "# DDD 增量日志\n";
    await atomicText(file, `${current}\n### 人工验收：${checkpoint.stage}\n\n- 决定：${checkpoint.review?.decision}\n- 验收人：${checkpoint.review?.reviewer}\n- 反馈：${checkpoint.review?.feedback}\n`);
}
//# sourceMappingURL=engine.js.map