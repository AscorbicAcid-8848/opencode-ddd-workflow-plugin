import path from "node:path";
import { exists, now } from "./fs.js";
import { profileFor, stageContract, stageIndex, milestoneFor, stageTitle } from "./catalog.js";
import { loadState, saveState, workflowRoot, statePath } from "./state.js";
import { workflowTransition } from "./transition.js";
import { ensureSkeleton, publishSections, documentPath, documentFileName } from "./documents.js";
import { newChange, writeLink, verifyArchive, openSpecAction } from "./openspec.js";
import { WorkflowError } from "./types.js";
async function resolveRoot(id) {
    const profile = await profileFor(id.workflowType);
    const root = await workflowRoot(id.projectRoot, profile.artifactBase, profile.artifactSubdir, id.workflowId);
    return { root, profile };
}
export async function initialize(input) {
    const profile = await profileFor(input.workflowType);
    const root = await workflowRoot(input.projectRoot, profile.artifactBase, profile.artifactSubdir, input.workflowId);
    if (await exists(statePath(root)))
        throw new WorkflowError(`Workflow already exists: ${input.workflowId} at ${root}`);
    await newChange(input.projectRoot, input.workflowId, input.title, input.request);
    const firstStage = profile.stages[0];
    const rootMkdir = path.join(root, ".ddd", "workbench");
    await import("node:fs/promises").then(({ mkdir }) => mkdir(rootMkdir, { recursive: true }));
    const state = {
        schemaVersion: "ddd-workflow-state/v1",
        workflowType: input.workflowType,
        workflowId: input.workflowId,
        title: input.title,
        originalRequest: input.request,
        projectRoot: path.resolve(input.projectRoot),
        artifactRoot: root,
        status: "active",
        currentStage: firstStage?.id ?? "",
        createdAt: now(),
        updatedAt: now(),
        checkpoints: [],
        openSpec: { changeId: input.workflowId, status: "created" },
    };
    await saveState(root, state);
    await writeLink(root, state, "created", input.workflowId);
    for (const m of profile.milestones)
        await ensureSkeleton(root, profile, m.document);
    // Auto-complete the 00-request routing stage: init already captured the request.
    if (firstStage && firstStage.id === "00-request" && !firstStage.humanGate) {
        const firstMilestone = milestoneFor(profile, firstStage.document);
        state.checkpoints.push({
            checkpointId: 1, stage: firstStage.id, milestone: firstMilestone?.roman ?? "",
            summary: `${input.title}：${input.request}`,
            status: "completed", review: null, reviewChecklist: [],
            adviceRequired: false, document: firstStage.document, completedAt: now(),
        });
        state.currentStage = firstStage.id;
        await saveState(root, state);
    }
    const t = workflowTransition(profile, state);
    return { ...t, workflowId: input.workflowId };
}
export async function prepare(input) {
    const { root, profile } = await resolveRoot(input);
    const state = await loadState(root);
    const transition = workflowTransition(profile, state);
    let stageId = input.stage;
    if (!stageId) {
        if (transition.nextStage)
            stageId = transition.nextStage;
        else if (transition.allowedNextStages.length === 1)
            stageId = transition.allowedNextStages[0];
        else
            throw new WorkflowError(`必须显式指定 stage。当前可选：${transition.allowedNextStages.join("、") || "无"}。`);
    }
    const stage = stageContract(profile, stageId);
    const milestone = milestoneFor(profile, stage.document);
    const upstream = collectUpstream(state, stage.document);
    const stageCard = {
        stageId: stage.id,
        stageTitle: stageTitle(stage),
        milestone: milestone?.roman ?? null,
        milestoneTitle: milestone?.title ?? null,
        document: stage.document,
        documentFile: documentFileName(profile, stage.document),
        humanGate: Boolean(stage.humanGate),
        adviceRequired: Boolean(stage.adviceRequired),
        repeatable: Boolean(stage.repeatable),
        cycleGroup: stage.cycleGroup ?? null,
        skills: stage.skills ?? [],
        checklist: stage.checklist ?? [],
        reviewTitle: stage.reviewTitle ?? null,
        reviewChecklist: stage.humanGate ? (stage.checklist ?? []) : [],
        upstreamSummary: upstream,
        qualityContract: stage.qualityContract ?? null,
        scopeContractId: stage.scopeContract?.id ?? null,
        submitFormat: {
            stage: stage.id,
            summary: "本阶段一句话结论（>=20 字）",
            sections: { "章节标题": "对应里程碑文档的 ## 章节 Markdown 正文" },
            ...(stage.implementationEvidence ? { sliceId: "当前切片稳定 ID" } : {}),
            ...(stage.deliveryAssetGate ? { plannedSlices: "计划切片数量" } : {}),
        },
        nextActionHint: stage.humanGate
            ? "提交后形成人工里程碑，等待人工 review(approve/revise/reject)。"
            : "提交后继续下一阶段，无需人工验收。",
    };
    return { ...transition, stageCard };
}
function collectUpstream(state, document) {
    return state.checkpoints
        .filter((c) => c.document === document && c.status === "completed")
        .map((c) => `[${c.stage}] ${c.summary}`);
}
export async function submit(input) {
    const { root, profile } = await resolveRoot(input);
    const state = await loadState(root);
    const stage = stageContract(profile, input.stage);
    const findings = validateSubmission(profile, stage, input);
    if (findings.some((f) => f.severity === "blocking")) {
        return { ...workflowTransition(profile, state), findings, documentPath: documentPath(root, profile, stage.document) };
    }
    await publishSections(root, profile, stage.document, input.sections);
    const milestone = milestoneFor(profile, stage.document);
    const writers = profile.stages.filter((s) => s.document === stage.document);
    const isLastWriter = writers.at(-1)?.id === stage.id;
    const checkpoint = {
        checkpointId: (state.checkpoints.at(-1)?.checkpointId ?? 0) + 1,
        stage: stage.id,
        milestone: milestone?.roman ?? "",
        summary: input.summary,
        status: (stage.humanGate && isLastWriter ? "awaiting_review" : "completed"),
        review: null,
        reviewTitle: stage.reviewTitle,
        reviewChecklist: stage.humanGate ? (stage.checklist ?? []) : [],
        adviceRequired: Boolean(stage.adviceRequired),
        document: stage.document,
        completedAt: now(),
        plannedSlices: input.plannedSlices,
        sliceId: input.sliceId,
    };
    state.checkpoints.push(checkpoint);
    state.currentStage = stage.id;
    if (stage.humanGate && isLastWriter) {
        // milestone ready, awaiting review; status stays active but transition reflects gate
    }
    await saveState(root, state);
    const transition = workflowTransition(profile, state);
    return { ...transition, findings, documentPath: documentPath(root, profile, stage.document) };
}
function validateSubmission(profile, stage, input) {
    const findings = [];
    if (!input.summary || input.summary.trim().length < (stage.qualityContract?.minSummaryChars ?? 20)) {
        findings.push({ code: "SUMMARY_TOO_SHORT", path: "summary", severity: "blocking",
            message: `summary 至少 ${stage.qualityContract?.minSummaryChars ?? 20} 字，当前 ${input.summary?.trim().length ?? 0} 字。` });
    }
    if (!input.sections || Object.keys(input.sections).length === 0) {
        findings.push({ code: "SECTIONS_EMPTY", path: "sections", severity: "blocking", message: "sections 不能为空。" });
    }
    const minChars = stage.qualityContract?.minSectionChars;
    if (minChars) {
        for (const [heading, content] of Object.entries(input.sections)) {
            if (content.trim().length < minChars) {
                findings.push({ code: "SECTION_TOO_SHORT", path: `sections.${heading}`, severity: "warning",
                    message: `章节「${heading}」正文仅 ${content.trim().length} 字，建议 >= ${minChars} 字。` });
            }
        }
    }
    const required = stage.qualityContract?.requiredContent;
    if (required) {
        const allText = Object.values(input.sections).join("\n");
        for (const kw of required) {
            if (!allText.includes(kw)) {
                findings.push({ code: "REQUIRED_CONTENT_MISSING", path: "sections", severity: "warning",
                    message: `建议包含关键字：「${kw}」。` });
            }
        }
    }
    return findings;
}
export async function review(input) {
    const { root, profile } = await resolveRoot(input);
    const state = await loadState(root);
    const idx = state.checkpoints.map((c) => c.stage).lastIndexOf(input.stage);
    if (idx < 0)
        throw new WorkflowError(`未找到阶段 ${input.stage} 的 checkpoint。`);
    const checkpoint = state.checkpoints[idx];
    if (checkpoint.status !== "awaiting_review")
        throw new WorkflowError(`阶段 ${input.stage} 不在待验收状态。`);
    const record = { decision: input.decision, reviewer: input.reviewer, reviewedAt: now(), feedback: input.feedback ?? "" };
    checkpoint.review = record;
    if (input.decision === "approve") {
        checkpoint.status = "approved";
        const stage = stageContract(profile, input.stage);
        if (stage.openspecArchiveGate)
            state.status = "awaiting_archive";
        else if (stageIndex(profile, input.stage) === profile.stages.length - 1)
            state.status = "complete";
    }
    else if (input.decision === "revise") {
        checkpoint.status = "revision_requested";
        state.status = "revision_requested";
    }
    else {
        checkpoint.status = "rejected";
        state.status = "rejected";
    }
    state.checkpoints[idx] = checkpoint;
    await saveState(root, state);
    const transition = workflowTransition(profile, state);
    return { ...transition, reviewRecord: record };
}
export async function status(input) {
    const { root, profile } = await resolveRoot(input);
    const state = await loadState(root);
    const transition = workflowTransition(profile, state);
    if (input.view === "full")
        return { ...transition, state };
    return { ...transition };
}
export async function archive(input) {
    const { root, profile } = await resolveRoot(input);
    const state = await loadState(root);
    if (state.status !== "awaiting_archive")
        throw new WorkflowError("仅最终验收批准后可归档。");
    const result = await verifyArchive(state.projectRoot, input.workflowId);
    if (result.archived) {
        state.status = "complete";
        state.openSpec = { ...state.openSpec, status: "archived", archivedAt: now() };
        await saveState(root, state);
        await writeLink(root, state, "archived", input.workflowId, result.target);
    }
    const transition = workflowTransition(profile, state);
    return { ...transition, archiveResult: result };
}
export async function openspec(input) {
    const { root, profile } = await resolveRoot(input);
    const state = await loadState(root);
    const result = await openSpecAction({ projectRoot: state.projectRoot, artifact: input.artifact, state });
    return { ...result, artifact: input.artifact };
}
export { workflowTransition };
//# sourceMappingURL=engine.js.map