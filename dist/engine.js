import path from "node:path";
import { createHash } from "node:crypto";
import { exists, readJson, writeJson, now } from "./fs.js";
import { profileFor, stageContract, stageIndex, milestoneFor, stageTitle } from "./catalog.js";
import { loadState, saveState, workflowRoot, statePath } from "./state.js";
import { workflowTransition } from "./transition.js";
import { candidateDocument, documentSections, publishSections, documentPath, writableHeadingsForStage, unfilledHeadings } from "./documents.js";
import { newChange, writeLink, verifyArchive, runOpenSpec, openSpecAction, planningArtifacts } from "./openspec.js";
import { WorkflowError } from "./types.js";
import { claimContractFor, validateStageClaims } from "./claims.js";
export function requiresScenarioClarification(request) {
    const text = String(request ?? "").trim();
    if (!text)
        return true;
    const hasScenarioStructure = /(?:当|如果|若|每次|一旦|成功|失败|返回|展示|查询|记录|允许|禁止|必须|不得|仅限|通过)[^。；\n]{1,80}/u.test(text)
        || /(?:when|if|after|before|must|shall|return|record|query|display)\b/iu.test(text);
    return !hasScenarioStructure && text.length < 48;
}
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
    let transition = workflowTransition(profile, state);
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
    const allowed = state.status === "runtime_blocked"
        ? [state.runtimeBlock?.stage].filter(Boolean)
        : transition.allowedNextStages;
    if (!allowed.includes(stage.id))
        throw new WorkflowError(`阶段 ${stage.id} 不是当前合法阶段；只允许：${allowed.join("、") || "无"}。必须按 transition 推进。`);
    // The runtime-block transition explicitly tells the caller to resume by
    // preparing the same stage after remediation. Make that prepare call the
    // atomic resume point; otherwise the returned stage card still says
    // requiredAction=stop and weaker schedulers stop again even though work may
    // legally continue. Final submission still has to pass every evidence gate.
    if (state.status === "runtime_blocked" && state.runtimeBlock?.stage === stage.id) {
        state.status = "active";
        state.currentStage = stage.id;
        delete state.runtimeBlock;
        await saveState(root, state);
        transition = workflowTransition(profile, state);
    }
    const upstream = collectUpstream(state, stage.document);
    const currentArchitectureEvidence = await compactArchitectureEvidence(root, stage.scopeContract?.id);
    const approvedModelContract = await compactApprovedModelContract(root, stage.scopeContract?.id);
    const currentCandidate = await candidateDocument(root, profile, stage.document, {});
    const allowedSectionHeadings = writableHeadingsForStage(stage);
    const milestoneMissing = unfilledHeadings(currentCandidate);
    const stageCard = {
        stageId: stage.id,
        stageTitle: stageTitle(stage),
        humanGate: Boolean(stage.humanGate),
        ...(stage.adviceRequired ? { adviceRequired: true } : {}),
        ...(stage.repeatable ? { repeatable: true } : {}),
        ...(stage.cycleGroup ? { cycleGroup: stage.cycleGroup } : {}),
        // The scheduler owns lifecycle and permissions; compact professional
        // skills own the DDD method used inside this one stage.
        skills: stage.skills ?? [],
        checklist: stage.checklist ?? [],
        upstreamSummary: upstream,
        ...(currentArchitectureEvidence ? { currentArchitectureEvidence } : {}),
        ...(approvedModelContract ? { approvedModelContract } : {}),
        ...(stage.scopeContract?.id === "delivery-planning" ? { openSpecChangeId: state.workflowId } : {}),
        intentContract: {
            originalRequest: state.originalRequest ?? "",
            rule: "本阶段只能细化原始请求与已批准上游决策；新增可观察业务能力必须先回到相应人工里程碑批准，禁止从 workflow_id、代码命名或技术可能性推断需求。",
        },
        ...(stage.scopeContract?.id === "system-discovery" && requiresScenarioClarification(state.originalRequest ?? "") ? {
            ambiguityContract: {
                requiresHumanChoice: true,
                reason: "原始请求只给出能力名称，未明确触发条件、业务结果或异常语义。",
                presentation: "至少给出两套候选业务解释；每套分别画候选事件流并说明取舍。明确写出：人工批准前，任何候选均不进入本次目标、唯一主流程或已确认规则。",
                submitField: "complete-stage.input.ambiguityResolution={status:'unresolved',candidates:[{id,label},{id,label}],affectedDecisions:['触发条件',...]}；候选 id 与自然语言标题自由命名，不要求固定措辞。",
                forbids: ["把代码中的现有入口自动解释为新能力触发点", "把候选查询、记录、时间或权限规则写成已批准需求"],
            },
        } : {}),
        unfilledSectionHeadings: milestoneMissing.filter((heading) => allowedSectionHeadings.includes(heading)),
        ...(stage.qualityContract ? { qualityContract: {
                minTotalChars: stage.qualityContract.minSectionChars,
                targetMaxTotalChars: (stage.qualityContract.minSectionChars ?? 600) * 2,
                minSummaryChars: stage.qualityContract.minSummaryChars,
                requiredContent: stage.qualityContract.requiredContent,
            } } : {}),
        ...(claimContractFor(stage.scopeContract?.id) ? { claimContract: {
                required: true,
                allowedKinds: claimContractFor(stage.scopeContract?.id).allowedKinds,
                instruction: "complete-stage.observations: heading 使用 allowedSectionHeadings 的精确顶层标题，不用正文中的 ### 小标题；事实需 evidence_refs；未知项用 evidence-gap/open-question。",
            } } : {}),
        stageBoundary: stageBoundary(stage.scopeContract?.id),
        ...(stage.implementationEvidence ? { requiredSubmitMetadata: { sliceId: "当前切片稳定 ID" } } : {}),
        ...(stage.deliveryAssetGate ? { requiredSubmitMetadata: { plannedSlices: "计划切片数量" } } : {}),
        allowedSectionHeadings,
    };
    return { ...transition, stageCard };
}
function stageBoundary(scopeId) {
    const contracts = {
        "existing-system-baseline": {
            owns: ["当前代码、接口、数据、测试和运行行为事实", "兼容性约束与证据缺口"],
            forbids: ["目标边界设计", "聚合与持久化方案", "编码"],
            exit: "用有限证据形成可核验的 AS-IS 基线，未知项明确标记为 evidence gap。",
        },
        "system-discovery": {
            owns: ["系统级场景", "业务事件时间线", "参与者、规则、异常、热点和边界线索"],
            forbids: ["API、类、表、数据库和中间件选型", "聚合、应用服务与事务设计"],
            exit: "形成纯业务语言的 Big Picture EventStorming，技术事实只进入证据章节。",
        },
        "system-strategy": {
            owns: ["子域与限界上下文", "职责、数据所有权、上下文协作", "实现单元业务用例包"],
            forbids: ["聚合根、值对象、领域/应用服务", "DTO、仓储、SQL、表和文件设计"],
            exit: "输出可供一个实现单元直接消费的业务用例包，不扩大原始需求。",
        },
        "context-discovery": {
            owns: ["单一限界上下文内的命令、事件、策略、失败和不变量候选", "事务与持久化热点"],
            forbids: ["最终类、接口、表结构和代码文件", "跨上下文战略重划"],
            exit: "形成 Design-Level EventStorming，足以驱动战术设计但不提前编码。",
        },
        "context-tactical-design": {
            owns: ["应用服务、聚合、领域交互、持久化与测试设计", "ME/INV 实现合同"],
            forbids: ["修改已批准战略边界", "实际编码和伪造运行证据"],
            exit: "模型职责、签名、不变量、依赖和测试归属全部达到实施就绪。",
        },
        "delivery-planning": {
            owns: ["OpenSpec 工件", "纵向切片、文件映射、验证、Git 与回滚计划"],
            forbids: ["新增领域能力或改变批准模型", "实际生产代码"],
            exit: "每个切片可独立验收、提交和回滚，并声明 plannedSlices。",
        },
        "approved-slice-implementation": {
            owns: ["一个批准纵向切片的真实代码、测试、E2E 和 Git 证据"],
            forbids: ["重新做战略或战术设计", "临时下载工具、伪造或跳过验证"],
            exit: "真实 Commit 可验证、含代码增量，所有验证通过；否则 action=block。",
        },
        "acceptance-evidence": {
            owns: ["全部切片、模型覆盖、测试、E2E、Git、回滚和上线证据的最终审计"],
            forbids: ["补写实现", "用计划代替运行证据"],
            exit: "只有全部证据真实通过，才形成里程碑 VI 人工验收。",
        },
    };
    return contracts[scopeId ?? ""] ?? { owns: [], forbids: [], exit: "只完成 stageCard.checklist 指定的当前阶段。" };
}
function collectUpstream(state, document) {
    const latestByStage = new Map();
    for (const checkpoint of state.checkpoints) {
        const currentDocumentIncrement = checkpoint.document === document && checkpoint.status === "completed";
        const approvedMilestoneInput = checkpoint.document !== document && checkpoint.status === "approved";
        if (currentDocumentIncrement || approvedMilestoneInput)
            latestByStage.set(checkpoint.stage, checkpoint);
    }
    return [...latestByStage.values()].slice(-8).map((checkpoint) => {
        const decision = checkpoint.review?.feedback?.trim()
            ? `；人工批准决策：${checkpoint.review.feedback.trim()}`
            : "";
        return `[${checkpoint.stage}] ${(checkpoint.summary + decision).slice(0, 520)}`;
    });
}
function stageDraftPath(root, stageId) {
    return path.join(root, ".ddd", "workbench", `${stageId}.draft.json`);
}
function mergeClaims(current, increment) {
    if (!Array.isArray(current) && !Array.isArray(increment))
        return increment ?? current;
    const merged = new Map();
    for (const claim of [...(Array.isArray(current) ? current : []), ...(Array.isArray(increment) ? increment : [])]) {
        const key = typeof claim?.id === "string" && claim.id.trim() ? claim.id : `anonymous-${merged.size}`;
        merged.set(key, claim);
    }
    return [...merged.values()];
}
async function mergeStageDraft(root, input) {
    const file = stageDraftPath(root, input.stage);
    const draft = await exists(file) ? await readJson(file) : undefined;
    return {
        ...input,
        summary: input.summary || draft?.summary || "",
        sections: { ...(draft?.sections ?? {}), ...(input.sections ?? {}) },
        claims: mergeClaims(draft?.claims, input.claims),
        ambiguityResolution: input.ambiguityResolution ?? draft?.ambiguityResolution,
        plannedSlices: input.plannedSlices ?? draft?.plannedSlices,
        sliceId: input.sliceId ?? draft?.sliceId,
    };
}
export async function submit(input) {
    const { root, profile } = await resolveRoot(input);
    const state = await loadState(root);
    const stage = stageContract(profile, input.stage);
    const merged = await mergeStageDraft(root, input);
    const partial = input.finalize === false;
    const findings = await validateSubmission(root, profile, state, stage, merged, { partial });
    if (findings.some((f) => f.severity === "blocking")) {
        return { ...workflowTransition(profile, state), findings, documentPath: documentPath(root, profile, stage.document) };
    }
    if (partial) {
        await writeJson(stageDraftPath(root, stage.id), {
            summary: merged.summary, sections: merged.sections, claims: merged.claims,
            ambiguityResolution: merged.ambiguityResolution,
            plannedSlices: merged.plannedSlices, sliceId: merged.sliceId,
        });
        const allowed = writableHeadingsForStage(stage);
        return {
            ...workflowTransition(profile, state), findings,
            documentPath: documentPath(root, profile, stage.document),
            draft: {
                saved: true, stage: stage.id,
                completedSections: Object.keys(merged.sections),
                remainingSections: allowed.filter((heading) => !Object.hasOwn(merged.sections, heading)),
                claimCount: Array.isArray(merged.claims) ? merged.claims.length : 0,
                nextAction: "继续用 finalize=false 添加剩余章节；完成后调用 finalize=true 且 sections={}。",
            },
        };
    }
    await publishSections(root, profile, stage.document, merged.sections);
    const milestone = milestoneFor(profile, stage.document);
    const writers = profile.stages.filter((s) => s.document === stage.document);
    const isLastWriter = writers.at(-1)?.id === stage.id;
    if (stage.humanGate && isLastWriter) {
        await publishSections(root, profile, stage.document, {
            "业务验收记录": "- 验收状态：待人工验收\n- 上一次退回意见已完成修订，请以当前文档为准。",
        });
    }
    const checkpoint = {
        checkpointId: (state.checkpoints.at(-1)?.checkpointId ?? 0) + 1,
        stage: stage.id,
        milestone: milestone?.roman ?? "",
        summary: merged.summary,
        status: (stage.humanGate && isLastWriter ? "awaiting_review" : "completed"),
        review: null,
        reviewTitle: stage.reviewTitle,
        reviewChecklist: stage.humanGate ? (stage.checklist ?? []) : [],
        adviceRequired: Boolean(stage.adviceRequired),
        document: stage.document,
        completedAt: now(),
        plannedSlices: merged.plannedSlices,
        sliceId: merged.sliceId,
        ambiguityResolution: merged.ambiguityResolution,
    };
    state.checkpoints.push(checkpoint);
    if (state.status === "runtime_blocked") {
        state.status = "active";
        delete state.runtimeBlock;
    }
    if (state.status === "revision_requested")
        state.status = "active";
    state.currentStage = stage.id;
    if (stage.humanGate && isLastWriter) {
        // milestone ready, awaiting review; status stays active but transition reflects gate
    }
    await saveState(root, state);
    await import("node:fs/promises").then(({ rm }) => rm(stageDraftPath(root, stage.id), { force: true }));
    const transition = workflowTransition(profile, state);
    return { ...transition, findings, documentPath: documentPath(root, profile, stage.document) };
}
async function validateSubmission(root, profile, state, stage, input, options = {}) {
    const findings = [];
    const transition = workflowTransition(profile, state);
    const allowed = state.status === "runtime_blocked"
        ? [state.runtimeBlock?.stage].filter(Boolean)
        : transition.allowedNextStages;
    if (!allowed.includes(input.stage)) {
        findings.push({ code: "STAGE_NOT_ALLOWED", path: "stage", severity: "blocking",
            message: `阶段 ${input.stage} 不是当前合法阶段；只允许：${allowed.join("、") || "无"}。必须按 transition 推进。` });
    }
    if (!input.summary || input.summary.trim().length < (stage.qualityContract?.minSummaryChars ?? 20)) {
        findings.push({ code: "SUMMARY_TOO_SHORT", path: "summary", severity: "blocking",
            message: `summary 至少 ${stage.qualityContract?.minSummaryChars ?? 20} 字，当前 ${input.summary?.trim().length ?? 0} 字。` });
    }
    if (!input.sections || Object.keys(input.sections).length === 0) {
        findings.push({ code: "SECTIONS_EMPTY", path: "sections", severity: "blocking", message: "sections 不能为空。" });
    }
    if (!options.partial && stage.deliveryAssetGate && (!Number.isInteger(input.plannedSlices) || Number(input.plannedSlices) <= 0)) {
        findings.push({ code: "PLANNED_SLICES_REQUIRED", path: "plannedSlices", severity: "blocking",
            message: "交付计划必须声明大于 0 的 plannedSlices，最终验收门禁以此判断全部纵向切片是否完成。" });
    }
    if (!options.partial && stage.openspecArtifactGate) {
        const artifacts = await planningArtifacts(state.projectRoot, state.workflowId);
        if (!artifacts.complete)
            findings.push({
                code: "OPENSPEC_PLANNING_ARTIFACTS_MISSING", path: "openspec", severity: "blocking",
                message: `里程碑 V 发布前必须在同一 change 中生成 OpenSpec 工件；当前缺少：${artifacts.missing.join("、")}。`,
            });
        else {
            try {
                await runOpenSpec(state.projectRoot, ["validate", state.workflowId, "--strict"]);
            }
            catch (error) {
                findings.push({
                    code: "OPENSPEC_STRICT_VALIDATION_FAILED", path: "openspec", severity: "blocking",
                    message: `里程碑 V 发布前 OpenSpec strict validate 必须通过：${error.message}`,
                });
            }
        }
    }
    if (!options.partial && stage.implementationEvidence && !input.sliceId?.trim()) {
        findings.push({ code: "SLICE_ID_REQUIRED", path: "sliceId", severity: "blocking",
            message: "实现阶段必须提供稳定 sliceId，并为每个纵向切片形成独立实现证据。" });
    }
    if (!options.partial && stage.implementationEvidence && state.checkpoints.some((checkpoint) => checkpoint.stage === stage.id && checkpoint.sliceId === input.sliceId)) {
        findings.push({ code: "SLICE_ALREADY_COMPLETED", path: "sliceId", severity: "blocking",
            message: `切片 ${input.sliceId} 已提交，禁止用重复 sliceId 虚增完成数量。` });
    }
    const writableHeadings = writableHeadingsForStage(stage);
    const allowedHeadings = new Set(writableHeadings);
    for (const [heading, content] of Object.entries(input.sections ?? {})) {
        if (!allowedHeadings.has(heading)) {
            findings.push({
                code: "SECTION_HEADING_NOT_IN_TEMPLATE", path: `sections.${heading}`, severity: "blocking",
                message: `阶段 ${stage.id} 不拥有章节「${heading}」。本阶段只能写：${[...allowedHeadings].join("、") || "无"}。`,
            });
        }
        if (/^##\s+/mu.test(content)) {
            findings.push({
                code: "NESTED_LEVEL_TWO_HEADING", path: `sections.${heading}`, severity: "blocking",
                message: `章节「${heading}」正文不得再次包含 ## 标题；运行时会生成二级标题，正文只可使用 ### 或更低级标题。`,
            });
        }
    }
    const minChars = options.partial ? undefined : stage.qualityContract?.minSectionChars;
    if (minChars) {
        const total = Object.values(input.sections ?? {}).join("\n").trim().length;
        if (total < minChars) {
            findings.push({ code: "SECTIONS_TOTAL_TOO_SHORT", path: "sections", severity: "warning",
                message: `本阶段全部章节正文共 ${total} 字，建议总计 >= ${minChars} 字。` });
        }
    }
    findings.push(...await validateStageClaims(state, stage.scopeContract?.id, writableHeadings, input.sections, input.claims));
    findings.push(...validateStageSemantics(state, stage, input));
    if (!options.partial && stage.implementationEvidence)
        findings.push(...await validateImplementationEvidence(state, input));
    const candidate = await candidateDocument(root, profile, stage.document, input.sections);
    const required = stage.qualityContract?.requiredContent;
    if (!options.partial && required) {
        for (const concept of required) {
            if (!containsRequiredConcept(candidate, concept)) {
                findings.push({ code: "REQUIRED_CONTENT_MISSING", path: "sections", severity: "blocking",
                    message: `候选里程碑缺少必需业务概念：「${concept}」。` });
            }
        }
    }
    const ownMissing = unfilledHeadings(candidate).filter((heading) => writableHeadings.includes(heading));
    if (!options.partial && ownMissing.length) {
        findings.push({ code: "STAGE_OWNED_SECTIONS_INCOMPLETE", path: "sections", severity: "blocking",
            message: `阶段 ${stage.id} 尚未完成自己拥有的章节：${ownMissing.join("、")}。不得把缺口留给后续阶段。` });
    }
    const writers = profile.stages.filter((item) => item.document === stage.document);
    if (!options.partial && stage.humanGate && writers.at(-1)?.id === stage.id) {
        const missing = unfilledHeadings(candidate);
        if (missing.length) {
            findings.push({ code: "MILESTONE_DOCUMENT_INCOMPLETE", path: "sections", severity: "blocking",
                message: `人工里程碑文档仍有未完成章节：${missing.join("、")}。请在本次 submit 一并补齐，禁止把占位内容提交给用户验收。` });
        }
    }
    return findings;
}
export function containsRequiredConcept(text, concept) {
    const normalized = (value) => value.toLowerCase().replace(/[\s、，,：:；;（）()\-_/]/gu, "");
    if (normalized(text).includes(normalized(concept)))
        return true;
    if (concept === "事实、假设与待确认项")
        return ["事实", "假设", "待确认"].every((part) => text.includes(part));
    if (concept === "异常与补偿")
        return ["异常", "补偿"].every((part) => text.includes(part));
    if (concept === "热点与未决问题")
        return ["热点", "未决问题"].every((part) => text.includes(part));
    if (concept === "业务验收标准")
        return ["业务", "验收标准"].every((part) => text.includes(part));
    if (concept === "事务边界与并发热点")
        return ["事务边界", "并发", "热点"].every((part) => text.includes(part));
    const semanticGroups = {
        "公开接口与 DTO 契约": [["公开接口", "接口契约", "API", "Controller", "GET /", "POST /"], ["DTO"]],
        "应用服务签名": [["应用服务"], ["签名", "Command(", "Query(", "Handler", "Service（", "Service("]],
        "聚合行为与不变量": [["聚合行为", "聚合根"], ["不变量", "INV-"]],
        "仓储语义签名": [["仓储", "Repository", "Mapper"], ["签名", "save(", "findBy", "BaseMapper", "SELECT", "WHERE"]],
        "持久化查询与迁移": [["持久化"], ["查询", "索引"], ["迁移", "新增表"]],
        "测试场景与实现文件映射": [["测试", "T-"], ["生产路径", "实现文件", "路径"]],
        "模块目录与层级归属": [["模块", "目录"], ["层", "application", "domain", "infrastructure"]],
        "允许与禁止依赖矩阵": [["依赖"], ["允许"], ["禁止"]],
        "Published Language 与循环依赖约束": [["Published Language"], ["循环依赖"]],
        "批准战术模型实现清单": [["ME-"], ["清单", "职责"]],
        "不变量—模型—测试归属": [["INV-", "不变量"], ["模型", "ME-"], ["测试", "T-"]],
        "禁止实现降级": [["禁止实现降级", "不得用", "禁止用"]],
        "纵向切片—验收—文件映射": [["切片"], ["验收"], ["文件"]],
        "战术模型—切片—文件覆盖": [["战术模型", "ME-"], ["切片"], ["文件"]],
        "模块—层—依赖机器合同": [["模块"], ["层"], ["依赖"], ["合同", "矩阵"]],
        "Git 基线与回滚策略": [["Git"], ["基线"], ["回滚"]],
        "OpenSpec change 映射": [["OpenSpec"], ["change"], ["映射", "capability"]],
        "OpenSpec Requirement/Scenario 追踪": [["Requirement"], ["Scenario"], ["追踪", "映射"]],
    };
    const groups = semanticGroups[concept];
    if (groups)
        return groups.every((alternatives) => alternatives.some((term) => text.includes(term)));
    return false;
}
export function queryPseudoEvents(text) {
    const chinese = /(?:事件|领域事件|\bemits\b)\s*[：:]?\s*([^→\n。；]{0,40}(?:查询|详情|列表|轨迹|结果|页面)[^→\n。；]{0,16}(?:已查询|已返回|已展示|已读取|查询已完成))/giu;
    const english = /(?:事件|领域事件|\bemits\b)\s*[：:]?\s*([A-Za-z]*(?:Query|Trail|List|Result|View)[A-Za-z]*(?:Returned|Queried|Loaded|Displayed)\b)/giu;
    return [...text.matchAll(chinese), ...text.matchAll(english)].map((match) => match[1].trim());
}
async function compactArchitectureEvidence(root, scopeId) {
    if (!["context-tactical-design", "delivery-planning", "implementation"].includes(scopeId ?? ""))
        return undefined;
    const file = path.join(root, ".ddd", "workbench", "evidence-snapshot.json");
    if (!await exists(file))
        return undefined;
    const snapshot = await readJson(file);
    return {
        instruction: "沿用这些现状证据中的工程约定；不得臆造不同框架、模块系统或目录。信息不足时显式列为实施前核验项。",
        ...snapshot,
    };
}
async function compactApprovedModelContract(root, scopeId) {
    if (!["delivery-planning", "implementation", "acceptance-evidence"].includes(scopeId ?? ""))
        return undefined;
    const file = path.join(root, "model-contract.json");
    if (!await exists(file)) {
        const milestone = path.join(root, "IV-tactical-design.md");
        if (!await exists(milestone))
            return undefined;
        const text = await import("node:fs/promises").then(({ readFile }) => readFile(milestone, "utf8"));
        await writeApprovedModelContract(root, text);
    }
    let contract = await readJson(file);
    if (!Array.isArray(contract.invariants) || contract.invariants.some((item) => typeof item === "string")) {
        const milestone = path.join(root, "IV-tactical-design.md");
        const text = await import("node:fs/promises").then(({ readFile }) => readFile(milestone, "utf8"));
        await writeApprovedModelContract(root, text);
        contract = await readJson(file);
    }
    return {
        sourceSha256: contract.sourceSha256,
        modelElements: contract.modelElements ?? [],
        invariants: contract.invariants ?? [],
        instruction: "OpenSpec、切片、代码与测试必须使用这些已批准名称和职责；禁止重命名、替换或新增战术模型。发现缺口应回里程碑 IV 修订。",
    };
}
export function extractApprovedModelContract(document) {
    const text = String(document);
    const modelElements = [...text.matchAll(/\b(ME-\d+)\s+(?:聚合根\s+|读模型\s+)?([A-Za-z][A-Za-z0-9_]*)/gu)]
        .map((match) => ({ id: match[1], name: match[2] }));
    const uniqueModels = [...new Map(modelElements.map((item) => [item.id, item])).values()];
    const invariantMatches = [...text.matchAll(/\b(INV-\d+)(?:\s*[：:]\s*|\s+)([^|\n。；]{3,180})/gu)]
        .map((match) => ({ id: match[1], statement: match[2].trim() }));
    const invariants = [...new Map(invariantMatches.map((item) => [item.id, item])).values()].sort((a, b) => a.id.localeCompare(b.id));
    return { modelElements: uniqueModels, invariants };
}
async function writeApprovedModelContract(root, document) {
    const text = String(document);
    const { modelElements: uniqueModels, invariants } = extractApprovedModelContract(text);
    if (uniqueModels.length === 0 || invariants.length === 0) {
        throw new WorkflowError("里程碑 IV 缺少可提取的 ME/INV 稳定标识，无法生成 model-contract.json。");
    }
    await writeJson(path.join(root, "model-contract.json"), {
        schemaVersion: "ddd-model-contract/v1",
        sourceMilestone: "IV",
        sourceDocument: "IV-tactical-design.md",
        sourceSha256: createHash("sha256").update(text).digest("hex"),
        modelElements: uniqueModels,
        invariants,
        generatedAt: now(),
    });
}
async function validateImplementationEvidence(state, input) {
    const findings = [];
    const text = Object.values(input.sections ?? {}).join("\n");
    const sha = text.match(/(?:Commit SHA|commit|提交)[：:`\s]*([0-9a-f]{7,40})/iu)?.[1];
    if (!sha) {
        findings.push({ code: "IMPLEMENTATION_COMMIT_MISSING", path: "sections", severity: "blocking",
            message: "实现证据必须包含真实 Git Commit SHA。" });
        return findings;
    }
    const { execFile } = await import("node:child_process");
    const runGit = (args) => new Promise((resolve, reject) => execFile("git", args, { cwd: state.projectRoot, windowsHide: true }, (error, stdout) => error ? reject(error) : resolve(stdout.trim())));
    try {
        await runGit(["cat-file", "-e", `${sha}^{commit}`]);
        const fullSha = await runGit(["rev-parse", sha]);
        if (state.implementationBaseline?.head && fullSha === state.implementationBaseline.head) {
            findings.push({ code: "IMPLEMENTATION_COMMIT_EQUALS_BASELINE", path: "sections", severity: "blocking",
                message: "实现 Commit 与里程碑 V 批准时的 Git 基线相同，没有代码增量。" });
        }
        const files = (await runGit(["diff-tree", "--no-commit-id", "--name-only", "-r", fullSha])).split(/\r?\n/u).filter(Boolean);
        if (!files.some((file) => !file.startsWith("openspec/") && !file.endsWith(".md"))) {
            findings.push({ code: "IMPLEMENTATION_COMMIT_NO_PRODUCTION_CHANGE", path: "sections", severity: "blocking",
                message: "该 Commit 未包含 OpenSpec/Markdown 之外的生产或测试代码变更。" });
        }
    }
    catch {
        findings.push({ code: "IMPLEMENTATION_COMMIT_INVALID", path: "sections", severity: "blocking",
            message: `Git 中不存在可验证的实现 Commit：${sha}。` });
    }
    if (hasFailedVerificationEvidence(text)) {
        findings.push({ code: "IMPLEMENTATION_VERIFICATION_NOT_PASSED", path: "sections", severity: "blocking",
            message: "实现证据包含未运行、跳过、环境不可用或失败状态；应调用 action=block，而不是提交完成切片。" });
    }
    return findings;
}
export function hasFailedVerificationEvidence(text) {
    const evidenceSubject = String.raw `(?:测试|验证|构建|build|e2e|端到端|集成测试|运行结果|验证命令|检查)`;
    const failedState = String.raw `(?:未运行|未执行|无法验证|环境不可用|跳过|待验证|失败|未通过|不通过)`;
    const separator = String.raw `\s*(?:结果|状态)?\s*[：:,，]?\s*`;
    return new RegExp(`${evidenceSubject}${separator}${failedState}`, "iu").test(text)
        || new RegExp(`${failedState}${separator}${evidenceSubject}`, "iu").test(text)
        || /BUILD\s+FAILURE/iu.test(text)
        || /(?:Failures|Errors)\s*:\s*[1-9]\d*/iu.test(text);
}
export function validateStageSemantics(state, stage, input) {
    const findings = [];
    const entries = Object.entries(input.sections ?? {});
    const addFinding = (code, heading, terms, message) => findings.push({
        code, path: `sections.${heading}`, severity: "blocking", message: `${message}：${terms.join("、")}。`,
    });
    if (stage.scopeContract?.id === "system-discovery") {
        const allowedEvidenceHeadings = new Set(["输入场景与现状事实", "证据与追踪"]);
        const forbidden = ["MySQL", "Redis", "API", "queryById", "Controller", "Mapper", "DTO", "SQL", "事务内", "表结构", "接口路径"];
        for (const [heading, text] of entries) {
            if (allowedEvidenceHeadings.has(heading))
                continue;
            const hits = forbidden.filter((term) => hasAffirmativeOccurrence(text, term));
            if (hits.length)
                addFinding("STRATEGIC_EVENTSTORM_TECHNICAL_LEAK", heading, hits, "战略事件风暴只表达业务事件流、参与者、规则、异常和边界线索；技术证据只能放入证据章节");
        }
        const eventStorm = String(input.sections?.["战略事件风暴"] ?? "");
        const eventMarker = /(?:领域事件|事件\s*[：:]|[（(]\s*事件\s*[）)]|⚡|\bemits\b)/iu;
        const pseudoQuery = /(?:查询|详情|列表|轨迹|结果|页面)[^。；\n]{0,16}(?:已查询|已返回|已展示|已读取|查询已完成)/u;
        const queryPseudoEvents = eventStorm.split(/\r?\n/u).flatMap((line) => {
            const declaredList = /(?:领域事件|事件)\s*[：:]/u.test(line);
            return line.split(/[；;]/u)
                .map((segment) => segment.trim())
                .filter((segment) => pseudoQuery.test(segment)
                && (declaredList || eventMarker.test(segment))
                && !/(?:读模型|非领域事件)/u.test(segment));
        });
        if (queryPseudoEvents.length)
            addFinding("STRATEGIC_EVENT_NOT_STATE_CHANGE", "战略事件风暴", queryPseudoEvents, "查询、返回、展示或读取完成属于读模型结果，不是领域主体状态变化，不能列为过去时领域事件");
        if (requiresScenarioClarification(state.originalRequest ?? "")) {
            const resolution = input.ambiguityResolution;
            const candidates = Array.isArray(resolution?.candidates) ? resolution.candidates : [];
            const ids = new Set(candidates.map((item) => String(item?.id ?? "").trim()).filter(Boolean));
            const labelsComplete = candidates.every((item) => String(item?.label ?? "").trim());
            const affected = Array.isArray(resolution?.affectedDecisions)
                ? resolution.affectedDecisions.map((item) => String(item).trim()).filter(Boolean) : [];
            if (resolution?.status !== "unresolved" || ids.size < 2 || !labelsComplete || affected.length === 0) {
                addFinding("AMBIGUOUS_SCENARIO_PREMATURE_COMMITMENT", "战略事件风暴", ["status=unresolved", "至少两项有稳定 id/label 的候选", "affectedDecisions"], "原始请求只有能力名称，尚不足以唯一确定触发、结果与规则；请用 stageCard.ambiguityContract.submitField 结构化声明候选与受影响决策，再把候选事件流并列交给人选择");
            }
        }
    }
    if (stage.scopeContract?.id === "system-strategy") {
        const forbidden = ["聚合根", "值对象", "应用服务", "领域服务", "仓储接口", "DTO", "Mapper", "Controller", "SQL", "表结构", "类名", "方法名"];
        for (const [heading, text] of entries) {
            if (heading === "证据与追踪")
                continue;
            const hits = forbidden.filter((term) => hasAffirmativeOccurrence(text, term));
            if (hits.length)
                addFinding("STRATEGIC_DESIGN_TACTICAL_LEAK", heading, hits, "战略设计只能决定子域、限界上下文、职责、协作和实现单元用例，禁止提前完成战术设计");
        }
    }
    if (stage.scopeContract?.id === "context-discovery") {
        const forbidden = ["复合索引", "索引设计", "分桶键", "分库", "分表", "表名", "字段类型", "数据库选型", "Redis", "Kafka", "SQL"];
        for (const [heading, text] of entries) {
            if (heading === "证据与追踪")
                continue;
            const hits = forbidden.filter((term) => hasAffirmativeOccurrence(text, term));
            if (hits.length)
                addFinding("TACTICAL_EVENTSTORM_IMPLEMENTATION_LEAK", heading, hits, "战术事件风暴只能识别访问模式、事务/并发与持久化热点，具体索引、分片、表和中间件方案归战术设计");
        }
        const pseudoEvents = queryPseudoEvents(String(input.sections?.["战术事件风暴"] ?? ""));
        if (pseudoEvents.length)
            addFinding("TACTICAL_EVENT_NOT_STATE_CHANGE", "战术事件风暴", pseudoEvents, "查询命令只返回读模型；只有改变领域状态或触发真实领域策略的事实才能标为领域事件");
    }
    if (stage.scopeContract?.id === "context-tactical-design" && stage.id === "06-tactical-design") {
        const designText = entries.map(([, text]) => text).join("\n");
        const domainText = String(input.sections?.["领域模型设计"] ?? "");
        const automaticCapture = /(?:每次|当).{0,30}成功.{0,30}(?:记录|保存)|成功.{0,20}(?:时|后).{0,20}(?:记录|保存)/u.test(state.originalRequest ?? "");
        const explicitCaptureEndpoint = /POST\s+\/[\w{}\-/?=]*(?:view|record|track|trail|history)/iu.test(designText);
        const existingSuccessHook = /(?:成功路径|成功返回|查询成功|详情成功).{0,50}(?:调用|触发|记录)/u.test(designText);
        if (automaticCapture && explicitCaptureEndpoint && existingSuccessHook) {
            addFinding("TACTICAL_DUPLICATE_EXTERNAL_TRIGGER", "公开接口与 DTO 契约", ["POST capture endpoint"], "原始场景要求由既有业务成功自动记录，设计又暴露独立写入端点会形成第二个未授权触发入口；只保留既有成功路径内的应用服务调用");
        }
        const aggregateOrmMerge = [...designText.matchAll(/[^。；\n]{0,30}(?:聚合根\s*[+＋/]\s*(?:MyBatis|JPA|ORM|数据库实体)|(?:MyBatis|JPA|ORM)\s*(?:实体)?\s*[+＋/]\s*聚合根)[^。；\n]{0,30}/giu)].map((match) => match[0].trim());
        if (aggregateOrmMerge.length)
            addFinding("TACTICAL_AGGREGATE_INFRASTRUCTURE_MERGE", "领域模型设计", aggregateOrmMerge, "聚合根是领域模型，不能同时充当 MyBatis/JPA/ORM 持久化实体；请分别定义领域模型与基础设施映射模型/适配器");
        const original = state.originalRequest ?? "";
        if (automaticCapture && !/INV-\d+[^。\n]{0,120}(?:每次|每一)[^。\n]{0,80}成功[^。\n]{0,80}(?:恰好|一条|一次)/u.test(domainText)) {
            addFinding("TACTICAL_INVARIANT_EXACTLY_ONE_MISSING", "领域模型设计", ["每次成功查看恰好一条记录"], "原始请求的强业务约束必须成为拥有该行为的聚合不变量，不能只写在阶段输入或应用服务说明中");
        }
        const repeatedViews = /(?:重复|同一[^。；]{0,20}多次)[^。；]{0,30}(?:保留|不去重)/u.test(original);
        if (repeatedViews && !/INV-\d+[^。\n]{0,120}(?:重复|多次)[^。\n]{0,100}(?:保留|不去重|独立)/u.test(domainText)) {
            addFinding("TACTICAL_INVARIANT_DUPLICATES_MISSING", "领域模型设计", ["重复查看逐条保留"], "重复行为的保留/去重语义必须由聚合不变量明确拥有");
        }
        const viewNotVisit = /页面查看[^。；]{0,20}(?:不表示|不等于)[^。；]{0,20}(?:到店|实际到店)/u.test(original);
        if (viewNotVisit && !/页面查看[^。；\n]{0,30}(?:不表示|不等于)[^。；\n]{0,30}(?:到店|实际到店)/u.test(domainText)) {
            addFinding("TACTICAL_UBIQUITOUS_LANGUAGE_DISTINCTION_MISSING", "领域模型设计", ["页面查看不等于实际到店"], "原始请求明确的业务术语边界必须进入领域模型，防止实现把两个概念合并");
        }
        const moduleText = String(input.sections?.["模块与分层设计"] ?? "");
        const directMapperDependency = [...moduleText.matchAll(/[^。；\n]{0,40}(?:app(?:lication)?service|应用服务)[^。；\n]{0,20}(?:→|依赖)[^。；\n]{0,20}mapper[^。；\n]{0,30}/giu)].map((match) => match[0].trim());
        if (directMapperDependency.length)
            addFinding("TACTICAL_APPLICATION_INFRASTRUCTURE_DEPENDENCY", "模块与分层设计", directMapperDependency, "应用服务只能依赖仓储端口；MyBatis Mapper 属于基础设施适配器，不得成为应用服务的直接依赖");
        const contextFirstLayers = [/(?:\bdomain\b|领域层)/iu, /(?:\bapplication\b|应用层)/iu,
            /(?:\binfrastructure\b|基础设施层)/iu, /(?:\binterfaces?\b|接口层|适配层)/iu];
        if (moduleText && !contextFirstLayers.every((pattern) => pattern.test(moduleText))) {
            addFinding("TACTICAL_BOUNDED_CONTEXT_MODULE_INCOMPLETE", "模块与分层设计", ["domain/application/infrastructure/interfaces"], "新增限界上下文必须在同一 context-first 模块根下明确领域层、应用层、基础设施层和接口适配层，不能继续散落到全局 entity/service/mapper 包");
        }
    }
    if (stage.scopeContract?.id === "delivery-planning") {
        const text = entries.map(([, value]) => value).join("\n");
        const declared = [...text.matchAll(/\bchange\s*[=:：]\s*[`"']?([a-z0-9][a-z0-9-]*)/giu)].map((match) => match[1]);
        const mismatches = [...new Set(declared.filter((value) => value !== state.workflowId))];
        if (mismatches.length)
            addFinding("OPENSPEC_CHANGE_ID_MISMATCH", "OpenSpec 变更映射", mismatches, `交付文档中的 OpenSpec change 必须使用当前真实 changeId ${state.workflowId}；capability 名不能冒充 changeId`);
    }
    if (["system-discovery", "system-strategy"].includes(stage.scopeContract?.id)) {
        const original = state.originalRequest ?? "";
        const advisoryHeadings = new Set(["证据与追踪", "备选解释与建议", "备选战略方案与建议", "本次请您确认"]);
        const onlyAdvisory = entries.length > 0 && entries.every(([heading]) => advisoryHeadings.has(heading));
        const businessText = [...(onlyAdvisory ? [] : [input.summary]), ...entries
                .filter(([heading]) => !advisoryHeadings.has(heading))
                .map(([, text]) => text)].join("\n");
        const capabilityTerms = ["计数", "统计", "排行", "区间查询", "支付", "推荐", "导出", "审批", "核销"];
        const expanded = capabilityTerms.filter((term) => !original.includes(term) && hasAffirmativeOccurrence(businessText, term));
        if (expanded.length)
            addFinding("INTENT_CAPABILITY_EXPANSION", "originalRequest", expanded, "提交内容把原始需求未授权的能力写入了主流程、用例或验收结果");
    }
    return findings;
}
function hasAffirmativeOccurrence(text, term) {
    let offset = text.indexOf(term);
    while (offset >= 0) {
        const sentenceStart = Math.max(text.lastIndexOf("。", offset - 1), text.lastIndexOf("；", offset - 1), text.lastIndexOf("\n", offset - 1)) + 1;
        const ends = [text.indexOf("。", offset), text.indexOf("；", offset), text.indexOf("\n", offset)].filter((i) => i >= 0);
        const sentenceEnd = ends.length ? Math.min(...ends) : text.length;
        const headingStart = Math.max(text.lastIndexOf("\n###", offset), text.lastIndexOf("\n##", offset));
        const sentence = text.slice(headingStart >= 0 ? headingStart : sentenceStart, sentenceEnd);
        const excluded = /(?:不|禁止|不得|不得提前|排除|范围外|非目标|暂不|无需|不做|推迟|留待|待后续|归(?:战术|后续)[^。；\n]{0,8}设计|未授权|未(?:设计|指定|决定|引入|新增|包含)|没有|不恢复|未来候选|后续候选|不纳入|不触碰)/u.test(sentence);
        if (!excluded)
            return true;
        offset = text.indexOf(term, offset + term.length);
    }
    return false;
}
export async function review(input) {
    if (!["approve", "revise", "reject"].includes(input.decision)) {
        throw new WorkflowError(`非法验收决定：${String(input.decision)}；只允许 approve、revise、reject。`);
    }
    const { root, profile } = await resolveRoot(input);
    const state = await loadState(root);
    const idx = state.checkpoints.map((c) => c.stage).lastIndexOf(input.stage);
    if (idx < 0)
        throw new WorkflowError(`未找到阶段 ${input.stage} 的 checkpoint。`);
    const checkpoint = state.checkpoints[idx];
    if (checkpoint.status === "revision_requested" && input.decision === "revise") {
        return { ...workflowTransition(profile, state), reviewRecord: checkpoint.review };
    }
    if (checkpoint.status !== "awaiting_review")
        throw new WorkflowError(`阶段 ${input.stage} 不在待验收状态。`);
    const stage = stageContract(profile, input.stage);
    const document = await import("node:fs/promises").then(({ readFile }) => readFile(documentPath(root, profile, checkpoint.document), "utf8"));
    const record = { decision: input.decision, reviewer: input.reviewer, reviewedAt: now(), feedback: input.feedback ?? "" };
    if (input.decision === "approve") {
        const missing = unfilledHeadings(document);
        if (missing.length)
            throw new WorkflowError(`正式里程碑文档仍有未完成章节，禁止人工批准：${missing.join("、")}。`);
        const allSections = documentSections(document);
        const owned = new Set(writableHeadingsForStage(stage));
        const semanticBlockers = validateStageSemantics(state, stage, {
            ...input,
            summary: checkpoint.summary,
            sections: Object.fromEntries(Object.entries(allSections).filter(([heading]) => owned.has(heading))),
            ambiguityResolution: checkpoint.ambiguityResolution,
        }).filter((finding) => finding.severity === "blocking");
        if (semanticBlockers.length)
            throw new WorkflowError(`正式里程碑文档未通过阶段语义复核，禁止人工批准：${semanticBlockers.map((finding) => finding.message).join("；")}`);
        if (checkpoint.document === "milestoneIV")
            await writeApprovedModelContract(root, String(document));
    }
    checkpoint.review = record;
    if (input.decision === "approve") {
        checkpoint.status = "approved";
        if (stage.deliveryAssetGate) {
            const { execFile } = await import("node:child_process");
            const head = await new Promise((resolve, reject) => execFile("git", ["rev-parse", "HEAD"], { cwd: state.projectRoot, windowsHide: true }, (error, stdout) => error ? reject(new WorkflowError("里程碑 V 批准前必须存在可读取的 Git 基线。")) : resolve(stdout.trim())));
            state.implementationBaseline = { head, capturedAt: now() };
        }
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
    await publishSections(root, profile, checkpoint.document, {
        "业务验收记录": `- 验收决定：${input.decision}\n- 验收人：${input.reviewer}\n- 验收时间：${record.reviewedAt}\n- 反馈：${record.feedback || "无"}`,
    });
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
export async function block(input) {
    const { root, profile } = await resolveRoot(input);
    const state = await loadState(root);
    const transition = workflowTransition(profile, state);
    if (!transition.allowedNextStages.includes(input.stage) && state.runtimeBlock?.stage !== input.stage) {
        throw new WorkflowError(`只能阻塞当前合法阶段：${transition.allowedNextStages.join("、") || "无"}。`);
    }
    if (!input.reason || input.reason.trim().length < 20)
        throw new WorkflowError("block.reason 至少 20 字，必须说明真实阻塞原因。");
    const record = {
        stage: input.stage,
        reason: input.reason.trim(),
        evidence: (input.evidence ?? []).filter(Boolean),
        remediation: (input.remediation ?? []).filter(Boolean),
        blockedAt: now(),
    };
    state.status = "runtime_blocked";
    state.currentStage = input.stage;
    state.runtimeBlock = record;
    await saveState(root, state);
    return { ...workflowTransition(profile, state), runtimeBlock: record };
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
        const archivedRoot = result.target ? path.join(result.target, profile.artifactSubdir ?? "") : root;
        state.artifactRoot = archivedRoot;
        await saveState(archivedRoot, state);
        await writeLink(archivedRoot, state, "archived", input.workflowId, result.target);
    }
    const transition = workflowTransition(profile, state);
    return { ...transition, archiveResult: result };
}
export async function openspec(input) {
    const { root, profile } = await resolveRoot(input);
    const state = await loadState(root);
    const transition = workflowTransition(profile, state);
    const writing = input.content !== undefined || input.skipSpecs !== undefined;
    if (writing) {
        const atPlanningGate = transition.allowedNextStages.some((id) => Boolean(stageContract(profile, id).openspecArtifactGate));
        if (!atPlanningGate && state.status !== "awaiting_archive") {
            throw new WorkflowError("OpenSpec 规划工件只能在交付计划阶段写入；awaiting_archive 仅允许修复缺失工件后重新严格校验。");
        }
    }
    const result = await openSpecAction({ projectRoot: state.projectRoot, artifact: input.artifact, state,
        content: input.content, capability: input.capability, skipSpecs: input.skipSpecs });
    return { ...result, artifact: input.artifact };
}
export { workflowTransition };
//# sourceMappingURL=engine.js.map