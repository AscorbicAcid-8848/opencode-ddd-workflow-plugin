import { milestoneFor, nextHumanGateAfter, stageIndex, writersOf } from "./catalog.js";
function implementationProgress(state) {
    if (state.deliveryPlan) {
        const planned = state.deliveryPlan.sliceIds.length;
        const completed = new Set(state.deliveryPlan.completedSliceIds.filter((id) => state.deliveryPlan.sliceIds.includes(id))).size;
        return { known: planned > 0, complete: planned > 0 && completed === planned, completed, planned };
    }
    const planned = [...state.checkpoints].reverse()
        .map((c) => c.plannedSlices)
        .find((n) => typeof n === "number" && Number.isInteger(n) && n >= 0);
    const completed = new Set(state.checkpoints.map((c) => c.sliceId).filter((id) => id !== undefined).map(String)).size;
    return typeof planned === "number"
        ? { known: true, complete: completed >= planned, completed, planned }
        : { known: false, complete: false, completed, planned: 0 };
}
function cycleChoices(profile, latest) {
    const idx = stageIndex(profile, latest.stage);
    const current = profile.stages[idx];
    if (!current)
        return [];
    const choices = [];
    if (current.cycleGroup) {
        for (const s of profile.stages) {
            if (s.cycleGroup === current.cycleGroup && stageIndex(profile, s.id) <= idx)
                choices.push(s.id);
        }
    }
    if (current.repeatable && !choices.includes(current.id))
        choices.push(current.id);
    const next = profile.stages[idx + 1];
    if (next)
        choices.push(next.id);
    return [...new Set(choices)];
}
export function workflowTransition(profile, state) {
    const latest = state.checkpoints.at(-1) ?? null;
    const common = (extra) => ({
        schemaVersion: "ddd-workflow-transition/v1",
        workflowStatus: state.status,
        lastCompletedStage: latest?.stage ?? null,
        milestoneRoman: null, milestoneTitle: null, milestoneReady: false, milestoneStatus: "not-reached",
        stopReason: null, nextStage: null, allowedNextStages: [], nextHumanGate: null,
        message: "",
        ...extra,
    });
    if (state.status === "complete") {
        const last = profile.milestones.at(-1) ?? null;
        return common({ stageRole: "complete", documentRole: "human-review-document", humanReviewRequired: false,
            mustContinue: false, stopAllowed: true, stopReason: "workflow-complete", requiredAction: "complete",
            milestoneRoman: "VI", milestoneTitle: last?.title ?? null, milestoneReady: true, milestoneStatus: "approved",
            message: "工作流已经完成并归档。" });
    }
    if (!latest) {
        const first = profile.stages[0]?.id ?? null;
        return common({ stageRole: "not-started", documentRole: "none", humanReviewRequired: false,
            mustContinue: true, stopAllowed: false, requiredAction: "continue",
            nextStage: first, allowedNextStages: first ? [first] : [],
            nextHumanGate: nextHumanGateAfter(profile, -1),
            message: `工作流尚未开始；必须执行阶段：${first}` });
    }
    const idx = stageIndex(profile, latest.stage);
    const stage = profile.stages[idx];
    const milestone = milestoneFor(profile, stage?.document);
    const writers = writersOf(profile, stage?.document ?? "");
    const milestoneReady = Boolean(stage?.humanGate && writers.at(-1)?.id === stage.id);
    const humanReviewRequired = latest.status === "awaiting_review";
    const base = {
        milestoneRoman: milestone?.roman ?? null,
        milestoneTitle: milestone?.title ?? null,
        milestoneReady,
        milestoneStatus: humanReviewRequired ? "awaiting-review" : milestoneReady && latest.status === "approved" ? "approved" : "accumulating",
    };
    if (humanReviewRequired)
        return common({
            ...base, stageRole: "human-gate", documentRole: "human-review-document", humanReviewRequired: true,
            mustContinue: false, stopAllowed: true, stopReason: "await-human-review", requiredAction: "await-human-review",
            nextHumanGate: latest.stage,
            message: latest.humanReviewSummary
                ?? `里程碑 ${milestone?.roman ?? "?"} 已形成，请人工验收。验收清单：\n${(latest.reviewChecklist ?? []).map((c) => `- ${c}`).join("\n")}`,
        });
    if (state.status === "revision_requested") {
        // The model selects the responsible writer from legal stages; feedback wording is not a state transition.
        const revisionStages = writers.filter((w) => w.id !== "00-request" && !w.summaryStage && stageIndex(profile, w.id) <= idx).map((w) => w.id);
        const allowed = revisionStages.length ? revisionStages : [latest.stage];
        return common({
            ...base, milestoneReady: false, milestoneStatus: "revision-required",
            stageRole: "milestone-building", documentRole: "stage-artifact",
            humanReviewRequired: false, mustContinue: true, stopAllowed: false, requiredAction: "revise",
            nextStage: allowed.length === 1 ? allowed[0] : null, allowedNextStages: allowed, nextHumanGate: latest.stage,
            message: allowed.length === 1
                ? `必须根据验收反馈修订并重新提交决策归属阶段：${allowed[0]}`
                : `必须根据验收反馈选择且只选择一个决策归属阶段修订：${allowed.join("、")}`,
        });
    }
    if (state.status === "rejected")
        return common({
            ...base, stageRole: "blocked", documentRole: "human-review-document", humanReviewRequired: false,
            mustContinue: false, stopAllowed: true, stopReason: "human-rejected", requiredAction: "stop",
            message: "工作流已被人工拒绝；如需继续请创建新的明确请求。",
        });
    if (state.status === "runtime_blocked")
        return common({
            ...base, stageRole: "blocked", documentRole: "stage-artifact", humanReviewRequired: false,
            mustContinue: false, stopAllowed: true, stopReason: "runtime-blocked", requiredAction: "stop",
            nextStage: state.runtimeBlock?.stage ?? state.currentStage,
            allowedNextStages: [state.runtimeBlock?.stage ?? state.currentStage].filter(Boolean),
            message: `运行时证据不足，工作流已诚实阻塞在 ${state.runtimeBlock?.stage ?? state.currentStage}：${state.runtimeBlock?.reason ?? "未提供原因"}。外部条件修复后重新 prepare 同一阶段；不得伪造测试、E2E 或 Git 证据。`,
        });
    if (state.status === "awaiting_archive")
        return common({
            ...base, stageRole: "archive", documentRole: "human-review-document", humanReviewRequired: false,
            mustContinue: true, stopAllowed: false, requiredAction: "archive",
            message: "最终验收已批准，必须完成 OpenSpec 严格校验与归档。",
        });
    const choices = cycleChoices(profile, latest);
    let normalNextContract = profile.stages[idx + 1];
    // States created before summary stages existed may already contain an
    // approved former gate. Treat that approval as the equivalent summary
    // approval instead of forcing a duplicate human checkpoint.
    if (normalNextContract?.summaryStage && latest.status === "approved") {
        normalNextContract = profile.stages[idx + 2];
    }
    const normalNext = normalNextContract?.id ?? null;
    const progress = implementationProgress(state);
    let allowed = choices.length > 1 ? choices : normalNext ? [normalNext] : [];
    // Once every approved slice is complete, the implementation loop has no
    // remaining model decision. Advance deterministically to model review so a
    // weaker scheduler cannot mistake milestone VI "accumulating" for the
    // human gate or choose another unnecessary implementation pass.
    if (stage?.implementationEvidence && progress.known && progress.complete && normalNext) {
        allowed = [normalNext];
    }
    else if (normalNextContract?.requiresCompletedImplementation) {
        if (progress.known && progress.complete)
            allowed = [normalNextContract.id];
        else {
            const impl = nearestImplStage(profile, idx);
            allowed = impl ? [impl] : [];
        }
    }
    // prepare commits one legal choice into durable workflow state. Once set,
    // that stage is the only legal continuation until it is submitted, blocked,
    // or explicitly reset by a human transition.
    const prepared = state.preparedStage?.stage;
    if (prepared && allowed.includes(prepared))
        allowed = [prepared];
    const select = allowed.length > 1;
    const next = select ? null : (allowed[0] ?? null);
    const nextHumanGate = next && profile.stages.find((s) => s.id === next)?.humanGate ? next
        : select ? allowed.find((c) => profile.stages.find((s) => s.id === c)?.humanGate) ?? null : null;
    return common({
        ...base, stageRole: "milestone-building", documentRole: "stage-artifact",
        humanReviewRequired: false, mustContinue: true, stopAllowed: false, requiredAction: select ? "select-next-stage" : "continue",
        nextStage: next, allowedNextStages: allowed, nextHumanGate,
        message: select
            ? `当前循环可继续：${allowed.join("、")}；必须根据批准的完成条件选择一个合法阶段。`
            : normalNextContract?.requiresCompletedImplementation && (!progress.known || !progress.complete)
                ? `实现尚未完成（${progress.known ? `${progress.completed}/${progress.planned}` : "交付计划未声明切片数量"}）；只能继续执行阶段：${next}`
                : milestoneReady && latest.status === "approved"
                    ? `里程碑 ${milestone?.roman ?? "?"} 已批准；必须继续执行阶段：${next}`
                    : `里程碑 ${milestone?.roman ?? "?"} 尚未形成，无需人工验收；必须继续执行阶段：${next}`,
    });
}
function nearestImplStage(profile, beforeIndex) {
    for (let i = beforeIndex; i >= 0; i -= 1) {
        const s = profile.stages[i];
        if (s?.implementationEvidence || (s?.repeatable && /implementation/.test(s.id)))
            return s.id;
    }
    return null;
}
//# sourceMappingURL=transition.js.map