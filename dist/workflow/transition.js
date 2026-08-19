import { stageIndex } from "./catalog.js";
function milestoneFor(profile, document) {
    return profile.milestones.find((item) => item.document === document) ?? null;
}
function nextGate(profile, after) {
    return profile.stages.slice(after + 1).find((stage) => stage.humanGate)?.id ?? null;
}
function cycleChoices(profile, latest) {
    const current = profile.stages[stageIndex(profile, latest.stage)];
    if (!current)
        return [];
    const choices = [];
    if (current.cycleGroup) {
        for (const stage of profile.stages) {
            if (stage.cycleGroup === current.cycleGroup && stageIndex(profile, stage.id) <= stageIndex(profile, current.id)) {
                choices.push(stage.id);
            }
        }
    }
    if (current.repeatable && !choices.includes(current.id))
        choices.push(current.id);
    const next = profile.stages[stageIndex(profile, current.id) + 1];
    if (next)
        choices.push(next.id);
    return [...new Set(choices)];
}
export function workflowTransition(profile, state) {
    const latest = state.checkpoints.at(-1) ?? null;
    if (state.status === "runtime_blocked") {
        const failedStage = typeof state.runtimeBlockedStage === "string" ? state.runtimeBlockedStage : null;
        return {
            schemaVersion: "ddd-workflow-transition/v1", workflowStatus: state.status,
            lastCompletedStage: latest?.stage ?? null, stageRole: "blocked",
            milestoneRoman: null, milestoneTitle: null, milestoneReady: false,
            milestoneStatus: "runtime-contract-repair", documentRole: "none",
            humanReviewRequired: false, mustContinue: false, stopAllowed: true,
            stopReason: "runtime-contract-repair", nextStage: failedStage,
            allowedNextStages: failedStage ? [failedStage] : [], nextHumanGate: null,
            requiredAction: "runtime-contract-repair",
            message: `Stage ${failedStage ?? "unknown"} reached the validation retry limit. Repair the workflow contract or submission before resuming.`,
        };
    }
    if (state.status === "complete") {
        return {
            schemaVersion: "ddd-workflow-transition/v1", workflowStatus: state.status,
            lastCompletedStage: latest?.stage ?? null, stageRole: "complete",
            milestoneRoman: "VI", milestoneTitle: profile.milestones.at(-1)?.title ?? null,
            milestoneReady: true, milestoneStatus: "approved", documentRole: "human-review-document",
            humanReviewRequired: false, mustContinue: false, stopAllowed: true,
            stopReason: "workflow-complete", nextStage: null, allowedNextStages: [], nextHumanGate: null,
            requiredAction: "complete", message: "工作流已经完成并归档。",
        };
    }
    if (!latest) {
        const first = profile.stages[0]?.id ?? null;
        return {
            schemaVersion: "ddd-workflow-transition/v1", workflowStatus: state.status,
            lastCompletedStage: null, stageRole: "not-started", milestoneRoman: null,
            milestoneTitle: null, milestoneReady: false, milestoneStatus: "not-reached",
            documentRole: "none", humanReviewRequired: false, mustContinue: true,
            stopAllowed: false, stopReason: null, nextStage: first,
            allowedNextStages: first ? [first] : [], nextHumanGate: nextGate(profile, -1),
            requiredAction: "continue", message: `工作流尚未开始；必须执行阶段：${first}`,
        };
    }
    const index = stageIndex(profile, latest.stage);
    const stage = profile.stages[index];
    const milestone = milestoneFor(profile, stage?.document);
    const writers = profile.stages.filter((item) => item.document === stage?.document);
    const milestoneReady = Boolean(stage?.humanGate && writers.at(-1)?.id === stage.id);
    const humanReviewRequired = latest.reviewStatus === "awaiting_review";
    const common = {
        schemaVersion: "ddd-workflow-transition/v1",
        workflowStatus: state.status,
        lastCompletedStage: latest.stage,
        milestoneRoman: milestone?.roman ?? null,
        milestoneTitle: milestone?.title ?? null,
        milestoneReady,
        milestoneStatus: humanReviewRequired ? "awaiting-review" : milestoneReady && latest.reviewStatus === "approved" ? "approved" : "accumulating",
    };
    if (humanReviewRequired)
        return {
            ...common, stageRole: "human-gate", documentRole: "human-review-document",
            humanReviewRequired: true, mustContinue: false, stopAllowed: true,
            stopReason: "await-human-review", nextStage: null, allowedNextStages: [],
            nextHumanGate: latest.stage, requiredAction: "await-human-review",
            message: `里程碑 ${milestone?.roman ?? "?"} 已形成，请人工验收：${latest.document}`,
        };
    if (state.status === "revision_requested")
        return {
            ...common, milestoneReady: false, milestoneStatus: "revision-required",
            stageRole: "milestone-building", documentRole: "cumulative-working-document",
            humanReviewRequired: false, mustContinue: true, stopAllowed: false, stopReason: null,
            nextStage: latest.stage, allowedNextStages: [latest.stage], nextHumanGate: latest.stage,
            requiredAction: "revise", message: `必须根据验收反馈或当前验证策略修订并重新提交阶段：${latest.stage}`,
        };
    if (state.status === "rejected")
        return {
            ...common, stageRole: "blocked", documentRole: "human-review-document",
            humanReviewRequired: false, mustContinue: false, stopAllowed: true,
            stopReason: "human-rejected", nextStage: null, allowedNextStages: [], nextHumanGate: null,
            requiredAction: "stop", message: "工作流已被人工拒绝；如需继续请创建新的明确请求。",
        };
    if (state.status === "awaiting_archive")
        return {
            ...common, stageRole: "archive", documentRole: "human-review-document",
            humanReviewRequired: false, mustContinue: true, stopAllowed: false,
            stopReason: null, nextStage: null, allowedNextStages: [], nextHumanGate: null,
            requiredAction: "archive", message: "最终验收已批准，必须完成 OpenSpec 严格校验与归档。",
        };
    const choices = cycleChoices(profile, latest);
    const normalNext = profile.stages[index + 1]?.id ?? null;
    const allowed = choices.length > 1 ? choices : normalNext ? [normalNext] : [];
    const select = allowed.length > 1;
    const next = select ? null : (allowed[0] ?? null);
    return {
        ...common, stageRole: "milestone-building", documentRole: "cumulative-working-document",
        humanReviewRequired: false, mustContinue: true, stopAllowed: false, stopReason: null,
        nextStage: next, allowedNextStages: allowed, nextHumanGate: nextGate(profile, index),
        requiredAction: select ? "select-next-stage" : "continue",
        message: select
            ? `当前循环可以继续：${allowed.join("、")}；必须根据批准的完成条件选择一个合法阶段。`
            : `里程碑 ${milestone?.roman ?? "?"} 尚未形成，无需人工验收；必须继续执行阶段：${next}`,
    };
}
//# sourceMappingURL=transition.js.map