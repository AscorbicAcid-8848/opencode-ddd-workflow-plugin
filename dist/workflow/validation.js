import { readFile } from "node:fs/promises";
import path from "node:path";
import { changedSections, scopeMarker, stageMarker, topLevelSections, validateFixedStructure, validateHumanOverview } from "./documents.js";
import { exists, readJson, sha256 } from "./fs.js";
import { intrinsicFor, intrinsics, stageIndex } from "./catalog.js";
import { documentPath, relative, stageBundle } from "./paths.js";
import { WorkflowError } from "./types.js";
const OUTPUT_SCHEMA = "ddd-stage-output/v3";
const REVIEW_SCHEMA = "ddd-scope-review/v3";
const itemFields = ["id", "kind", "statement", "ownerStage", "ownerContract", "decisionLevel", "maturity", "documentSection", "tracesTo", "evidenceRefs", "attributes"];
const relationFields = ["id", "type", "from", "to", "rationale"];
const deferredFields = ["id", "kind", "statement", "targetStage", "targetContract", "decisionLevel", "maturity", "documentSection", "reason", "tracesTo"];
const assessmentFields = ["quote", "actualOwnerStage", "actualOwnerContract", "actualDecisionLevel", "action", "severity", "rationale"];
function object(value, label) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw new WorkflowError(`${label} 必须是 JSON 对象`);
    return value;
}
function exact(value, fields, label) {
    const current = object(value, label);
    const a = Object.keys(current).sort(), b = [...fields].sort();
    if (JSON.stringify(a) !== JSON.stringify(b))
        throw new WorkflowError(`${label} 字段不符合合同；需要 ${b.join("、")}`);
    return current;
}
function strings(value, label, nonempty = false) {
    if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim()) || (nonempty && !value.length))
        throw new WorkflowError(`${label} 必须是${nonempty ? "非空" : ""}字符串数组`);
    if (new Set(value).size !== value.length)
        throw new WorkflowError(`${label} 不能包含重复项`);
    return value;
}
function text(value, label) {
    if (typeof value !== "string" || !value.trim())
        throw new WorkflowError(`${label} 不能为空`);
    return value;
}
export async function validateStageBundle(root, state, profile, stage) {
    const bundle = stageBundle(root, profile, stage);
    if (!await exists(bundle.candidate))
        throw new WorkflowError(`缺少阶段候选稿：${bundle.candidate}`);
    const candidateText = await readFile(bundle.candidate, "utf8");
    await validateFixedStructure(candidateText, stage.document);
    if (!candidateText.includes(stageMarker(stage.id)) || stage.scopeContract?.id && !candidateText.includes(scopeMarker(stage.scopeContract.id)))
        throw new WorkflowError(`候选文档缺少当前阶段或 Scope 隐藏标记：${stage.id}`);
    if (stage.humanGate)
        validateHumanOverview(candidateText);
    const [intrinsicId, intrinsic] = await intrinsicFor(state.workflowType, stage.id);
    const catalog = await intrinsics();
    const output = object(await readJson(bundle.output), "阶段内禀工件");
    exact(output, ["schemaVersion", "workflowType", "workflowId", "stageId", "intrinsicContract", "scopeId", "governingQuestion", "inputReferences", "items", "relations", "deferredItems", "soleOutput", "candidateDocument"], "阶段内禀工件");
    const identity = { schemaVersion: OUTPUT_SCHEMA, workflowType: state.workflowType, workflowId: state.workflowId, stageId: stage.id, intrinsicContract: intrinsicId, scopeId: intrinsic.scopeId, governingQuestion: intrinsic.governingQuestion };
    for (const [key, expected] of Object.entries(identity))
        if (output[key] !== expected)
            throw new WorkflowError(`阶段内禀工件 ${key} 与当前阶段契约不一致`);
    strings(output.inputReferences, "inputReferences", true);
    if (!Array.isArray(output.items))
        throw new WorkflowError("items 必须是数组");
    if (!Array.isArray(output.relations))
        throw new WorkflowError("relations 必须是数组");
    if (!Array.isArray(output.deferredItems))
        throw new WorkflowError("deferredItems 必须是数组");
    const ids = new Set();
    const kinds = new Set(catalog.itemKinds);
    const allowedKinds = new Set(intrinsic.allowedItemKinds);
    const maturities = new Set(catalog.scopePolicies[intrinsic.scopeId].allowedMaturities);
    const sections = new Set(intrinsic.ownedSections);
    const evidenceKinds = new Set(intrinsic.evidenceRequiredKinds ?? []);
    const evidencePrefixes = catalog.semanticGraph?.evidenceReferencePrefixes ?? [];
    const policy = catalog.semanticGraph?.policies?.[intrinsicId] ?? {};
    const scopeDispositions = new Set(catalog.semanticGraph?.scopeDispositions ?? []);
    const flowRoles = new Set(catalog.semanticGraph?.flowRoles ?? []);
    const byId = new Map();
    const capability = new Map();
    for (let i = 0; i < output.items.length; i++) {
        const item = exact(output.items[i], itemFields, `items[${i}]`);
        const id = text(item.id, `items[${i}].id`);
        if (ids.has(id))
            throw new WorkflowError(`阶段内禀工件存在重复 id：${id}`);
        ids.add(id);
        byId.set(id, item);
        if (!kinds.has(item.kind) || !allowedKinds.has(item.kind))
            throw new WorkflowError(`阶段越权：${stage.id} 不允许形成 ${item.kind}`);
        if (item.ownerStage !== stage.id || item.ownerContract !== intrinsicId || item.decisionLevel !== intrinsic.scopeId)
            throw new WorkflowError(`${id} 的责任阶段、合同或决策层级不属于当前阶段`);
        if (!maturities.has(item.maturity))
            throw new WorkflowError(`${id} 的 maturity=${item.maturity} 不允许出现在 ${intrinsic.scopeId}`);
        if (!sections.has(item.documentSection))
            throw new WorkflowError(`${id} 必须落入当前阶段拥有的业务章节`);
        text(item.statement, `${id}.statement`);
        strings(item.tracesTo, `${id}.tracesTo`, true);
        strings(item.evidenceRefs, `${id}.evidenceRefs`);
        if (evidenceKinds.has(item.kind) && !item.evidenceRefs.length)
            throw new WorkflowError(`${item.kind} 必须绑定可检查证据`);
        if (evidencePrefixes.length && item.evidenceRefs.some((ref) => !evidencePrefixes.some((prefix) => ref.startsWith(prefix))))
            throw new WorkflowError(`${id}.evidenceRefs 必须使用可解析前缀`);
        const attrs = object(item.attributes, `${id}.attributes`);
        const kindPolicy = policy.kindContracts?.[item.kind] ?? {};
        const required = [...(policy.commonRequiredAttributes ?? []), ...(kindPolicy.required ?? []), ...((policy.decisionKinds ?? []).includes(item.kind) ? ["decisionStatus"] : [])];
        for (const key of required)
            if (!(key in attrs))
                throw new WorkflowError(`${id} 缺少 ${intrinsicId} 语义属性：${key}`);
        if (policy.decisionPlane && attrs.decisionPlane !== policy.decisionPlane)
            throw new WorkflowError(`${id}.attributes.decisionPlane 必须为 ${policy.decisionPlane}`);
        if ((policy.decisionKinds ?? []).includes(item.kind) && attrs.decisionStatus !== policy.decisionStatus)
            throw new WorkflowError(`${id}.attributes.decisionStatus 必须为 ${policy.decisionStatus}`);
        for (const [key, choices] of Object.entries(kindPolicy.enums ?? {}))
            if (!choices.includes(attrs[key]))
                throw new WorkflowError(`${id}.attributes.${key} 非法`);
        if ("scopeDisposition" in attrs && !scopeDispositions.has(attrs.scopeDisposition))
            throw new WorkflowError(`${id}.attributes.scopeDisposition 非法`);
        if ("flowRole" in attrs && !flowRoles.has(attrs.flowRole))
            throw new WorkflowError(`${id}.attributes.flowRole 非法`);
        for (const key of ["authorityRefs", "inputItemRefs", "sourceFactRefs", "boundaryEvidenceRefs"])
            if (key in attrs)
                strings(attrs[key], `${id}.attributes.${key}`);
        for (const reference of attrs.authorityRefs ?? [])
            if (!/^(?:user-input|approval|upstream|openspec|runtime|test|code|schema|git):/.test(reference))
                throw new WorkflowError(`${id}.attributes.authorityRefs 使用了不可解析前缀`);
        if (attrs.scopeDisposition === "requested" && !(attrs.authorityRefs ?? []).some((x) => x.startsWith("user-input:")))
            throw new WorkflowError(`${id} 缺少 user-input 授权依据`);
        if (item.kind === "capability-status") {
            text(attrs.capabilityId, `${id}.attributes.capabilityId`);
            if (!["existing", "target", "future"].includes(attrs.status))
                throw new WorkflowError(`${id}.attributes.status 非法`);
            const old = capability.get(attrs.capabilityId);
            if (old && old !== attrs.status)
                throw new WorkflowError(`同一 capabilityId 不能同时具有 ${old}/${attrs.status}`);
            capability.set(attrs.capabilityId, attrs.status);
            const dispositions = {
                existing: ["existing", "approved-prior"],
                target: ["requested", "candidate"],
                future: ["future"],
            };
            if (dispositions[attrs.status] && !dispositions[attrs.status].includes(attrs.scopeDisposition))
                throw new WorkflowError(`${id} 的 capability status 与 scopeDisposition 不一致`);
        }
    }
    const relationIds = new Set();
    const allowedRelations = new Set(catalog.semanticGraph?.relationTypes ?? []);
    for (let i = 0; i < output.relations.length; i++) {
        const relation = exact(output.relations[i], relationFields, `relations[${i}]`);
        text(relation.id, `relations[${i}].id`);
        text(relation.rationale, `relations[${i}].rationale`);
        if (relationIds.has(relation.id))
            throw new WorkflowError(`relations 存在重复 id：${relation.id}`);
        relationIds.add(relation.id);
        if (!allowedRelations.has(relation.type) || !byId.has(relation.from) || !byId.has(relation.to) || relation.from === relation.to)
            throw new WorkflowError(`${relation.id} 的类型或端点非法`);
    }
    for (let i = 0; i < output.deferredItems.length; i++) {
        const item = exact(output.deferredItems[i], deferredFields, `deferredItems[${i}]`);
        if (item.maturity !== "deferred")
            throw new WorkflowError(`${item.id}.maturity 必须为 deferred`);
        if (stageIndex(profile, item.targetStage) <= stageIndex(profile, stage.id))
            throw new WorkflowError(`${item.id}.targetStage 必须位于当前步骤之后`);
        const [targetContract, targetIntrinsic] = await intrinsicFor(state.workflowType, item.targetStage);
        if (item.targetContract !== targetContract || item.decisionLevel !== targetIntrinsic.scopeId)
            throw new WorkflowError(`${item.id} 的延期责任合同不正确`);
    }
    const sole = exact(output.soleOutput, ["kind", "consumers", "statement", "itemRefs"], "soleOutput");
    if (sole.kind !== intrinsic.soleOutput.kind || JSON.stringify(sole.consumers) !== JSON.stringify(intrinsic.soleOutput.consumers))
        throw new WorkflowError("soleOutput 与阶段唯一输出合同不一致");
    text(sole.statement, "soleOutput.statement");
    strings(sole.itemRefs, "soleOutput.itemRefs");
    if (sole.itemRefs.some((id) => !byId.has(id)))
        throw new WorkflowError("soleOutput.itemRefs 只能引用 active item");
    const candidateRef = exact(output.candidateDocument, ["path", "sha256"], "candidateDocument");
    if (candidateRef.path !== relative(root, bundle.candidate) || candidateRef.sha256 !== await sha256(bundle.candidate))
        throw new WorkflowError("stage-output 没有冻结当前候选稿 hash");
    const formal = documentPath(root, profile, stage);
    const changed = await changedSections(formal, bundle.candidate);
    if (stage.id !== "00-request" && !Object.keys(changed).length)
        throw new WorkflowError(`${path.basename(bundle.candidate)} 没有形成新的业务增量`);
    const allowedChanged = new Set(intrinsic.ownedSections);
    if (stage.humanGate) {
        allowedChanged.add("一页结论");
        allowedChanged.add("本次请您确认");
    }
    for (const heading of Object.keys(changed))
        if (!allowedChanged.has(heading))
            throw new WorkflowError(`当前步骤不拥有“${heading}”`);
    const changedBusiness = Object.values(changed).join("\n").replace(/<!--.*?-->/gs, "").trim();
    const quality = stage.qualityContract;
    if (quality?.minSectionChars && changedBusiness.length < quality.minSectionChars)
        throw new WorkflowError(`${stage.id} 业务增量不足 ${quality.minSectionChars} 字符`);
    for (const required of quality?.requiredContent ?? [])
        if (!candidateText.includes(required))
            throw new WorkflowError(`${stage.id} 缺少必需业务内容：${required}`);
    const candidateSections = topLevelSections(candidateText);
    for (const item of output.items)
        if (!candidateSections[item.documentSection]?.includes(item.statement))
            throw new WorkflowError(`${item.id} 没有逐字映射到候选文档章节 ${item.documentSection}`);
    const review = object(await readJson(bundle.review), "Scope Review");
    exact(review, ["schemaVersion", "workflowType", "workflowId", "stageId", "intrinsicContract", "scopeId", "candidateDocumentSha256", "stageOutputSha256", "reviewerRole", "itemAssessments", "relationAssessments", "soleOutputAssessment", "sectionAssessments", "findings", "reviewedAt"], "Scope Review");
    if (review.schemaVersion !== REVIEW_SCHEMA || review.workflowType !== state.workflowType || review.workflowId !== state.workflowId || review.stageId !== stage.id || review.intrinsicContract !== intrinsicId || review.scopeId !== intrinsic.scopeId)
        throw new WorkflowError("Scope Review 身份与当前阶段不一致");
    if (review.candidateDocumentSha256 !== await sha256(bundle.candidate) || review.stageOutputSha256 !== await sha256(bundle.output))
        throw new WorkflowError("Scope Review hash 已过期");
    if (review.reviewerRole !== "deterministic-stage-scope-auditor" || !review.reviewedAt)
        throw new WorkflowError("Scope Review 必须由确定性阶段 Scope 审计器完成");
    const checkAssessments = (values, idKey, expectedIds) => {
        if (!Array.isArray(values))
            throw new WorkflowError(`${idKey}Assessments 必须是数组`);
        const actual = [];
        for (let i = 0; i < values.length; i++) {
            const assessment = exact(values[i], [idKey, ...assessmentFields], `${idKey}Assessments[${i}]`);
            actual.push(assessment[idKey]);
            if (!["retain", "defer", "remove", "return-upstream"].includes(assessment.action) || !["none", "advisory", "blocking"].includes(assessment.severity))
                throw new WorkflowError(`${idKey} assessment action/severity 非法`);
            for (const key of ["quote", "actualOwnerStage", "actualOwnerContract", "actualDecisionLevel", "rationale"])
                text(assessment[key], `${assessment[idKey]}.${key}`);
            if (assessment.action !== "retain" || assessment.severity === "blocking" || assessment.actualOwnerStage !== stage.id || assessment.actualOwnerContract !== intrinsicId || assessment.actualDecisionLevel !== intrinsic.scopeId)
                throw new WorkflowError(`阶段 Scope 准入失败：${assessment[idKey]}`);
        }
        if (JSON.stringify(actual.sort()) !== JSON.stringify([...expectedIds].sort()))
            throw new WorkflowError(`${idKey}Assessments 没有完整覆盖`);
    };
    checkAssessments(review.itemAssessments, "itemId", [...ids]);
    checkAssessments(review.relationAssessments, "relationId", [...relationIds]);
    checkAssessments(review.sectionAssessments, "section", Object.keys(changed));
    for (const assessment of review.itemAssessments)
        if (assessment.quote !== byId.get(assessment.itemId)?.statement)
            throw new WorkflowError(`${assessment.itemId} assessment 必须逐字引用 item.statement`);
    for (const assessment of review.relationAssessments) {
        const relation = output.relations.find((item) => item.id === assessment.relationId);
        if (!relation || !relation.rationale.includes(assessment.quote) && !assessment.quote.includes(relation.rationale))
            throw new WorkflowError(`${assessment.relationId} assessment quote 必须来自 relation.rationale`);
    }
    for (const assessment of review.sectionAssessments)
        if (!changed[assessment.section]?.includes(assessment.quote))
            throw new WorkflowError(`${assessment.section} assessment quote 必须来自本阶段变化章节`);
    const soleAssessment = exact(review.soleOutputAssessment, assessmentFields, "soleOutputAssessment");
    if (soleAssessment.quote !== sole.statement)
        throw new WorkflowError("soleOutputAssessment.quote 必须逐字引用 soleOutput.statement");
    if (soleAssessment.action !== "retain" || soleAssessment.severity === "blocking" || soleAssessment.actualOwnerStage !== stage.id || soleAssessment.actualOwnerContract !== intrinsicId || soleAssessment.actualDecisionLevel !== intrinsic.scopeId)
        throw new WorkflowError("阶段 Scope 准入失败：soleOutput");
    if (!Array.isArray(review.findings))
        throw new WorkflowError("findings 必须是数组");
    const blockers = review.findings.filter((finding) => finding.severity === "blocking" || finding.action !== "retain");
    if (blockers.length)
        throw new WorkflowError(`阶段 Scope 准入失败：${blockers.map((x) => x.id).join("、")}`);
    const deterministicFindings = deterministicGuards(catalog, intrinsicId, output, changed);
    if (deterministicFindings.length)
        throw new WorkflowError(`阶段 Scope 准入失败：${deterministicFindings.map((x) => x.id).join("、")}；${deterministicFindings[0].rationale}`);
    await semanticInvariants(root, state, output, byId);
    return { candidate: bundle.candidate, output, review: { ...review, computedGate: { schemaVersion: "ddd-scope-gate/v1", verdict: "pass", blockingFindingIds: [], assessedItemIds: [...ids].sort(), assessedRelationIds: [...relationIds].sort(), assessedSections: Object.keys(changed).sort(), deterministicFindings, computedAt: new Date().toISOString() } } };
}
function deterministicGuards(catalog, intrinsicId, output, changed) {
    const findings = [];
    const add = (id, source, quote, rationale) => findings.push({ id: `DET-${String(findings.length + 1).padStart(3, "0")}-${id}`, source, quote, severity: "blocking", action: "remove", rationale });
    const sources = [
        ...output.items.map((item) => ({ target: "items", source: `item:${item.id}`, text: item.statement, kind: item.kind })),
        { target: "soleOutput", source: "soleOutput", text: output.soleOutput.statement, kind: output.soleOutput.kind },
        ...Object.entries(changed).map(([section, body]) => ({ target: "sections", source: `section:${section}`, text: body, section })),
    ];
    for (const rule of catalog.preApprovalForbiddenPatterns ?? []) {
        const expression = new RegExp(rule.pattern, "iu");
        for (const source of sources) {
            const match = expression.exec(source.text);
            if (match)
                add(rule.id, source.source, match[0], "人工批准前不能宣称业务决定已经批准或最终确定");
        }
    }
    for (const rule of catalog.deterministicSemanticRules?.[intrinsicId] ?? []) {
        const expression = new RegExp(rule.pattern, "iu");
        for (const source of sources) {
            if (!(rule.targets ?? []).includes(source.target))
                continue;
            if (source.target === "items" && rule.includeKinds?.length && !rule.includeKinds.includes(source.kind))
                continue;
            if (source.target === "items" && rule.excludeKinds?.includes(source.kind))
                continue;
            if (source.target === "sections" && rule.sections?.length && !rule.sections.includes(source.section))
                continue;
            const match = expression.exec(source.text);
            if (match)
                add(rule.id, source.source, match[0], rule.message);
        }
    }
    for (const deferred of output.deferredItems) {
        if (output.soleOutput.statement.includes(deferred.statement) || output.items.some((item) => item.statement === deferred.statement))
            add("DEFERRED-AS-CURRENT", `deferred:${deferred.id}`, deferred.statement, "延期项不能同时成为当前结论或唯一输出");
    }
    return findings;
}
async function semanticInvariants(root, state, output, byId) {
    const edges = output.relations;
    const upstream = new Map();
    for (const checkpoint of state.checkpoints) {
        if (!checkpoint.stageOutput || !await exists(path.join(root, checkpoint.stageOutput)))
            continue;
        const prior = await readJson(path.join(root, checkpoint.stageOutput));
        for (const item of prior.items ?? [])
            upstream.set(`${checkpoint.stage}:${item.id}`, item);
    }
    for (const item of output.items) {
        const attrs = item.attributes ?? {};
        if (item.kind === "open-question" && attrs.state === "unresolved") {
            const blocked = edges.filter((edge) => edge.type === "blocks" && edge.from === item.id).map((edge) => byId.get(edge.to));
            if (!blocked.length)
                throw new WorkflowError(`未决问题 ${item.id} 必须 blocks 至少一个受影响结论`);
            for (const target of blocked) {
                const targetAttrs = target.attributes ?? {};
                const safelyDeferred = ["candidate", "future"].includes(targetAttrs.scopeDisposition)
                    && ["alternative", "exception", "supporting", "none"].includes(targetAttrs.flowRole);
                if (!safelyDeferred || output.soleOutput.itemRefs.includes(target.id))
                    throw new WorkflowError(`未决问题 ${item.id} 所阻塞的 ${target.id} 必须保持为非主流程候选或未来备选，且不得进入唯一输出`);
            }
        }
        if (["domain-event", "internal-domain-event"].includes(item.kind)) {
            const policyTarget = edges.some((edge) => edge.from === item.id && ["triggers", "governs"].includes(edge.type));
            if (!attrs.businessSideEffect && !attrs.changedState && !policyTarget)
                throw new WorkflowError(`${item.id} 不是具有业务状态变化或后续策略的领域事件`);
        }
        if (["business-command", "application-command"].includes(item.kind) && attrs.intent === "information-request") {
            const returns = edges.filter((edge) => edge.type === "returns" && edge.from === item.id);
            if (!returns.length || returns.some((edge) => byId.get(edge.to)?.kind !== "read-model"))
                throw new WorkflowError(`${item.id} 查询必须通过 returns 指向 read-model`);
        }
        if (item.kind === "external-party" && (attrs.boundary !== "external" || !attrs.boundaryEvidenceRefs?.length))
            throw new WorkflowError(`${item.id} 未以证据证明位于系统边界之外`);
        if (item.kind === "capability-status" && attrs.status === "existing") {
            if (!Array.isArray(attrs.sourceFactRefs) || !attrs.sourceFactRefs.length)
                throw new WorkflowError(`${item.id} 的 existing 状态必须引用现状事实`);
            for (const reference of attrs.sourceFactRefs) {
                const normalized = reference.replace(/^upstream:/, "");
                const fact = byId.get(normalized) ?? upstream.get(normalized);
                const factAttrs = fact?.attributes ?? {};
                const rank = { declared: 0, wired: 1, "statically-reachable": 2, "runtime-observed": 3, "test-verified": 4 };
                if (!fact || factAttrs.availability !== "operational" || (rank[factAttrs.observationLevel] ?? -1) < 2)
                    throw new WorkflowError(`${item.id} 的 existing 状态超过 sourceFactRefs 所能证明的能力`);
            }
        }
        if (item.kind === "capability-status" && attrs.status === "future" && output.soleOutput.itemRefs.includes(item.id))
            throw new WorkflowError(`${item.id} 是未来候选，不得进入 soleOutput`);
    }
}
//# sourceMappingURL=validation.js.map