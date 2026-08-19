import { readFile } from "node:fs/promises";
import { intrinsicFor, intrinsics, documents, stageIndex } from "./catalog.js";
import { addHiddenStageMetadata, changedSections, replaceSubsection, subsectionBody } from "./documents.js";
import { atomicText, exists, now, sha256, writeJson } from "./fs.js";
import { documentPath, relative, stageBundle } from "./paths.js";
import { strategicBaselinePreparation } from "./strategic.js";
const nonEmpty = (value) => typeof value === "string" && Boolean(value.trim());
const object = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : null;
const submissionFields = ["inputReferences", "items", "relations", "deferredItems", "soleOutput", "sections", "overview", "strategicBaseline"];
function finding(code, path, message, suggestion) {
    return { code, path, message, severity: "blocking", ...(suggestion ? { suggestion } : {}) };
}
export async function preparationContract(root, state, profile, stage) {
    const [intrinsicId, intrinsic] = await intrinsicFor(state.workflowType, stage.id);
    const catalog = await intrinsics();
    const policy = catalog.semanticGraph?.policies?.[intrinsicId] ?? {};
    const documentContract = (await documents()).documents[stage.document];
    const sectionContract = (documentContract?.sections ?? [])
        .filter((section) => intrinsic.ownedSections.includes(section.heading));
    const ownedSubsections = sectionContract
        .flatMap((section) => section.subsections ?? []);
    const laterStages = profile.stages.slice(stageIndex(profile, stage.id) + 1).map((item) => item.id);
    const sampleKind = intrinsic.requiredAnyOf?.[0]?.[0] ?? intrinsic.allowedItemKinds[0];
    const kindPolicy = policy.kindContracts?.[sampleKind] ?? {};
    const attributeKeys = [...(policy.commonRequiredAttributes ?? []), ...(kindPolicy.required ?? [])]
        .filter((key) => key !== "decisionStatus");
    const sampleAttributes = Object.fromEntries(attributeKeys.map((key) => {
        const choices = kindPolicy.enums?.[key];
        if (Array.isArray(choices) && choices.length)
            return [key, choices[0]];
        if (/Refs$/.test(key))
            return [key, key === "authorityRefs" ? ["user-input:original-request"] : []];
        if (key === "decisionPlane")
            return [key, policy.decisionPlane ?? intrinsic.scopeId];
        if (key === "scopeDisposition")
            return [key, policy.decisionPlane === "evidence" ? "existing" : "requested"];
        if (key === "flowRole")
            return [key, "main"];
        return [key, `<${key}>`];
    }));
    const sampleSection = intrinsic.ownedSections[0];
    const sampleItem = {
        id: "ITEM-001", kind: sampleKind, statement: "<本阶段业务事实或决策>",
        maturity: catalog.scopePolicies[intrinsic.scopeId].allowedMaturities[0],
        documentSection: sampleSection,
        tracesTo: ["user-input:original-request"],
        evidenceRefs: (intrinsic.evidenceRequiredKinds ?? []).includes(sampleKind)
            ? [`${catalog.semanticGraph?.evidenceReferencePrefixes?.[0] ?? "code:"}<可检查位置>`]
            : [],
        attributes: sampleAttributes,
    };
    return {
        schemaVersion: "ddd-stage-preparation/v1",
        workflowType: state.workflowType,
        workflowId: state.workflowId,
        stage: stage.id,
        stageRole: stage.humanGate ? "human-gate" : "milestone-building",
        skills: stage.skills ?? [],
        governingQuestion: intrinsic.governingQuestion,
        consumes: intrinsic.consumes,
        ownedSections: intrinsic.ownedSections,
        sectionContract,
        ownedSubsections,
        requiredSubsections: stage.humanGate ? ownedSubsections : [],
        allowedItemKinds: intrinsic.allowedItemKinds,
        allowedMaturities: catalog.scopePolicies[intrinsic.scopeId].allowedMaturities,
        requiredAnyOf: intrinsic.requiredAnyOf,
        evidenceRequiredKinds: intrinsic.evidenceRequiredKinds ?? [],
        qualityContract: stage.qualityContract ?? {},
        soleOutput: intrinsic.soleOutput,
        semanticPolicy: policy,
        semanticEnums: {
            scopeDispositions: catalog.semanticGraph?.scopeDispositions ?? [],
            flowRoles: catalog.semanticGraph?.flowRoles ?? [],
        },
        strategicBaseline: stage.strategicBaselineGate
            ? await strategicBaselinePreparation(root, state, stage.strategicBaselineGate)
            : null,
        relationTypes: catalog.semanticGraph?.relationTypes ?? [],
        evidenceReferencePrefixes: catalog.semanticGraph?.evidenceReferencePrefixes ?? [],
        validDeferredTargets: laterStages,
        outputContract: {
            required: ["inputReferences", "items", "soleOutput", "sections"],
            itemRequired: ["id", "kind", "statement", "maturity", "documentSection"],
            relationRequired: ["id", "type", "from", "to", "rationale"],
            deferredItemRequired: ["id", "kind", "statement", "targetStage", "documentSection", "reason"],
            soleOutputRequired: ["statement", "itemRefs"],
            evidenceRefs: "Use only evidenceReferencePrefixes; the engine supplies ownerStage, ownerContract, and decisionLevel.",
            sections: "Map ownedSections or ownedSubsections headings to business Markdown. At a human gate every requiredSubsections entry must contain real content; do not add ##/### headings or introduce a decision absent from items.",
            overview: stage.humanGate ? ["currentConclusion", "latestBusinessIncrement", "acceptanceChecklist", "openQuestions", "recommendation"] : [],
        },
        minimalShapeExample: {
            inputReferences: ["user-input:original-request"], items: [sampleItem], relations: [], deferredItems: [],
            soleOutput: { statement: "<交给下游的唯一业务输出>", itemRefs: ["ITEM-001"] },
            sections: { [sampleSection]: "<只陈述由 items 支撑的本阶段增量>" },
            ...(stage.humanGate ? { overview: {
                    currentConclusion: "<当前结论>", latestBusinessIncrement: "<本阶段增量>",
                    acceptanceChecklist: ["<业务验收项>"], openQuestions: ["<未决问题或无>"],
                    recommendation: "建议批准，因为当前结论满足本阶段问题。",
                } } : {}),
        },
        repairProtocol: "首次提交使用 submission。失败后保留服务器端草稿，只提交 repair_patch（JSON Patch）修复全部 findings；不要重发或重建完整 payload。",
        executionRule: "Submit once with ddd_workflow_submit(mode=stage). Do not read full profile/artifact contracts, and do not edit generated Markdown, hashes, stage-output.json, or scope-review.json.",
    };
}
function pointerParts(pointer) {
    if (!pointer.startsWith("/") || pointer === "/")
        throw new Error("patch path must address a submission field");
    const parts = pointer.slice(1).split("/").map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"));
    if (!submissionFields.includes(parts[0]) || parts.some((part) => ["__proto__", "prototype", "constructor"].includes(part))) {
        throw new Error(`patch path is not allowed: ${pointer}`);
    }
    return parts;
}
export function applyStageSubmissionPatch(base, operations) {
    if (!Array.isArray(operations) || !operations.length || operations.length > 64)
        throw new Error("repair_patch must contain 1 to 64 operations");
    const result = structuredClone(base);
    for (const operation of operations) {
        const parts = pointerParts(operation.path);
        let parent = result;
        for (const part of parts.slice(0, -1)) {
            if (parent === null || typeof parent !== "object" || !(part in parent))
                throw new Error(`patch parent does not exist: ${operation.path}`);
            parent = parent[part];
        }
        const key = parts.at(-1);
        if (operation.op === "remove") {
            if (Array.isArray(parent)) {
                const index = Number(key);
                if (!Number.isInteger(index) || index < 0 || index >= parent.length)
                    throw new Error(`invalid array index: ${operation.path}`);
                parent.splice(index, 1);
            }
            else {
                if (!(key in parent))
                    throw new Error(`patch target does not exist: ${operation.path}`);
                delete parent[key];
            }
            continue;
        }
        if (!("value" in operation))
            throw new Error(`${operation.op} requires value: ${operation.path}`);
        if (Array.isArray(parent)) {
            if (operation.op === "add" && key === "-")
                parent.push(structuredClone(operation.value));
            else {
                const index = Number(key);
                const upper = operation.op === "add" ? parent.length : parent.length - 1;
                if (!Number.isInteger(index) || index < 0 || index > upper)
                    throw new Error(`invalid array index: ${operation.path}`);
                if (operation.op === "add")
                    parent.splice(index, 0, structuredClone(operation.value));
                else
                    parent[index] = structuredClone(operation.value);
            }
        }
        else {
            if (operation.op === "replace" && !(key in parent))
                throw new Error(`patch target does not exist: ${operation.path}`);
            parent[key] = structuredClone(operation.value);
        }
    }
    return result;
}
export async function validateStageSubmission(root, state, profile, stage, value, summary) {
    const findings = [];
    const input = object(value);
    if (!input)
        return { submission: null, findings: [finding("SUBMISSION-NOT-OBJECT", "$", "submission must be a JSON object")] };
    const [intrinsicId, intrinsic] = await intrinsicFor(state.workflowType, stage.id);
    const catalog = await intrinsics();
    const documentCatalog = await documents();
    const policy = catalog.semanticGraph?.policies?.[intrinsicId] ?? {};
    const allowedKinds = new Set(intrinsic.allowedItemKinds);
    const allowedMaturities = new Set(catalog.scopePolicies[intrinsic.scopeId].allowedMaturities);
    const allowedSections = new Set(intrinsic.ownedSections);
    const documentContract = documentCatalog.documents?.[stage.document];
    const ownedSubsections = (documentContract?.sections ?? [])
        .filter((section) => intrinsic.ownedSections.includes(section.heading))
        .flatMap((section) => section.subsections ?? []);
    const allowedNarrativeSections = new Set([...allowedSections, ...ownedSubsections]);
    const allowedRelations = new Set(catalog.semanticGraph?.relationTypes ?? []);
    const evidenceRequired = new Set(intrinsic.evidenceRequiredKinds ?? []);
    const referencePrefixes = catalog.semanticGraph?.evidenceReferencePrefixes ?? [];
    const scopeDispositions = new Set(catalog.semanticGraph?.scopeDispositions ?? []);
    const flowRoles = new Set(catalog.semanticGraph?.flowRoles ?? []);
    const quality = stage.qualityContract;
    if (summary !== undefined && quality?.minSummaryChars && summary.trim().length < quality.minSummaryChars) {
        findings.push(finding("SUMMARY-TOO-SHORT", "summary", `summary must contain at least ${quality.minSummaryChars} characters of real business increment`));
    }
    if (stage.strategicBaselineGate) {
        const baseline = object(input.strategicBaseline);
        const phase = stage.strategicBaselineGate;
        if (!baseline)
            findings.push(finding("STRATEGIC-BASELINE-ASSESSMENT-REQUIRED", "strategicBaseline", "this existing-system stage must assess the runtime-provided OpenSpec strategic inventory"));
        else {
            const prepared = await strategicBaselinePreparation(root, state, phase);
            for (const key of ["currentSpecs", "changes", "recoveredDecisions", "unresolvedConflicts"]) {
                if (!Array.isArray(baseline[key]))
                    findings.push(finding("STRATEGIC-BASELINE-FIELD-REQUIRED", `strategicBaseline.${key}`, `${key} must be an array`));
            }
            const checkSources = (key, expected) => {
                const declared = Array.isArray(baseline[key]) ? baseline[key] : [];
                const paths = declared.map((item) => item?.path);
                const expectedPaths = expected.map((item) => item.path);
                if (JSON.stringify([...paths].sort()) !== JSON.stringify([...expectedPaths].sort()))
                    findings.push(finding("STRATEGIC-SOURCE-INVENTORY-MISMATCH", `strategicBaseline.${key}`, `${key} must assess every and only source returned by prepare_stage`));
                declared.forEach((item, index) => {
                    if (!item || !nonEmpty(item.path) || !["relevant", "not-relevant"].includes(item.relevance) || !nonEmpty(item.reason))
                        findings.push(finding("STRATEGIC-SOURCE-ASSESSMENT-INVALID", `strategicBaseline.${key}[${index}]`, "each source requires path, relevance, and reason"));
                });
            };
            checkSources("currentSpecs", prepared.currentSpecs);
            checkSources("changes", prepared.changes);
            const disposition = object(baseline.strategicDisposition);
            const expectedStatus = phase === "inventory" ? "pending" : "proposed";
            if (!disposition || disposition.status !== expectedStatus)
                findings.push(finding("STRATEGIC-DISPOSITION-INVALID", "strategicBaseline.strategicDisposition.status", `${phase} requires status ${expectedStatus}`));
            for (const key of ["reused", "changed", "new", "conflicts"])
                if (!Array.isArray(disposition?.[key]))
                    findings.push(finding("STRATEGIC-DISPOSITION-FIELD-REQUIRED", `strategicBaseline.strategicDisposition.${key}`, `${key} must be an array`));
            if ((baseline.unresolvedConflicts ?? []).length || (disposition?.conflicts ?? []).length)
                findings.push(finding("STRATEGIC-CONFLICT-UNRESOLVED", "strategicBaseline", "unresolved strategic conflicts must be returned to their owning stage before checkpoint publication"));
        }
    }
    const inputReferences = Array.isArray(input.inputReferences) ? input.inputReferences : [];
    if (!inputReferences.length || inputReferences.some((item) => !nonEmpty(item))) {
        findings.push(finding("INPUT-REFERENCES-REQUIRED", "inputReferences", "inputReferences must contain the approved inputs consumed by this stage"));
    }
    if (!Array.isArray(input.items) || !input.items.length)
        findings.push(finding("ITEMS-REQUIRED", "items", "items must be a non-empty array"));
    if (!object(input.sections) || !Object.keys(input.sections ?? {}).length)
        findings.push(finding("SECTIONS-REQUIRED", "sections", "at least one owned business section must be supplied"));
    if (!object(input.soleOutput))
        findings.push(finding("SOLE-OUTPUT-REQUIRED", "soleOutput", "soleOutput must be supplied", "Use soleOutput: { statement: string, itemRefs: string[] }."));
    const ids = new Set();
    const byId = new Map();
    const items = Array.isArray(input.items) ? input.items : [];
    items.forEach((raw, index) => {
        const item = object(raw);
        const base = `items[${index}]`;
        if (!item) {
            findings.push(finding("ITEM-NOT-OBJECT", base, "item must be an object"));
            return;
        }
        for (const key of ["id", "kind", "statement", "maturity", "documentSection"]) {
            if (!nonEmpty(item[key]))
                findings.push(finding("ITEM-FIELD-REQUIRED", `${base}.${key}`, `${key} is required`));
        }
        if (nonEmpty(item.id)) {
            if (ids.has(item.id))
                findings.push(finding("DUPLICATE-ITEM-ID", `${base}.id`, `duplicate item id: ${item.id}`));
            ids.add(item.id);
            byId.set(item.id, item);
        }
        if (nonEmpty(item.kind) && !allowedKinds.has(item.kind))
            findings.push(finding("ITEM-KIND-OUT-OF-SCOPE", `${base}.kind`, `${item.kind} is not owned by stage ${stage.id}`));
        if (nonEmpty(item.maturity) && !allowedMaturities.has(item.maturity))
            findings.push(finding("MATURITY-OUT-OF-SCOPE", `${base}.maturity`, `${item.maturity} is not allowed in ${intrinsic.scopeId}`));
        if (nonEmpty(item.documentSection) && !allowedSections.has(item.documentSection))
            findings.push(finding("SECTION-NOT-OWNED", `${base}.documentSection`, `${item.documentSection} is not owned by stage ${stage.id}`));
        const evidenceRefs = Array.isArray(item.evidenceRefs) ? item.evidenceRefs : [];
        if (evidenceRequired.has(item.kind) && !evidenceRefs.length)
            findings.push(finding("EVIDENCE-REQUIRED", `${base}.evidenceRefs`, `${item.kind} requires inspectable evidence`));
        for (const ref of evidenceRefs)
            if (!nonEmpty(ref) || referencePrefixes.length && !referencePrefixes.some((prefix) => ref.startsWith(prefix))) {
                findings.push(finding("EVIDENCE-REFERENCE-INVALID", `${base}.evidenceRefs`, `unresolvable evidence reference: ${String(ref)}`));
            }
        const attrs = object(item.attributes) ?? {};
        const kindPolicy = policy.kindContracts?.[item.kind] ?? {};
        const required = [...(policy.commonRequiredAttributes ?? []), ...(kindPolicy.required ?? [])]
            .filter((key) => key !== "decisionPlane" && key !== "decisionStatus");
        for (const key of required)
            if (!(key in attrs))
                findings.push(finding("SEMANTIC-ATTRIBUTE-REQUIRED", `${base}.attributes.${key}`, `${item.kind} requires semantic attribute ${key}`));
        for (const [key, choices] of Object.entries(kindPolicy.enums ?? {})) {
            if (key in attrs && !choices.includes(attrs[key]))
                findings.push(finding("SEMANTIC-ATTRIBUTE-INVALID", `${base}.attributes.${key}`, `${String(attrs[key])} is not an allowed value`));
        }
        if ("scopeDisposition" in attrs && !scopeDispositions.has(attrs.scopeDisposition)) {
            findings.push(finding("SCOPE-DISPOSITION-INVALID", `${base}.attributes.scopeDisposition`, `${String(attrs.scopeDisposition)} is not one of: ${[...scopeDispositions].join(", ")}`));
        }
        if ("flowRole" in attrs && !flowRoles.has(attrs.flowRole)) {
            findings.push(finding("FLOW-ROLE-INVALID", `${base}.attributes.flowRole`, `${String(attrs.flowRole)} is not one of: ${[...flowRoles].join(", ")}`));
        }
        if (attrs.scopeDisposition === "requested" && !(Array.isArray(attrs.authorityRefs) && attrs.authorityRefs.some((ref) => nonEmpty(ref) && ref.startsWith("user-input:")))) {
            findings.push(finding("REQUEST-AUTHORITY-REQUIRED", `${base}.attributes.authorityRefs`, "requested scope requires a user-input authority reference"));
        }
        if (item.kind === "capability-status") {
            const dispositions = {
                existing: ["existing", "approved-prior"],
                target: ["requested", "candidate"],
                future: ["future"],
            };
            if (nonEmpty(attrs.status) && dispositions[attrs.status] && !dispositions[attrs.status].includes(attrs.scopeDisposition)) {
                findings.push(finding("CAPABILITY-DISPOSITION-MISMATCH", `${base}.attributes.scopeDisposition`, `capability status ${attrs.status} requires scopeDisposition ${dispositions[attrs.status].join(" or ")}`));
            }
        }
    });
    const relations = Array.isArray(input.relations) ? input.relations : [];
    const relationIds = new Set();
    relations.forEach((raw, index) => {
        const relation = object(raw);
        const base = `relations[${index}]`;
        if (!relation) {
            findings.push(finding("RELATION-NOT-OBJECT", base, "relation must be an object"));
            return;
        }
        for (const key of ["id", "type", "from", "to", "rationale"])
            if (!nonEmpty(relation[key]))
                findings.push(finding("RELATION-FIELD-REQUIRED", `${base}.${key}`, `${key} is required`));
        if (nonEmpty(relation.id)) {
            if (relationIds.has(relation.id))
                findings.push(finding("DUPLICATE-RELATION-ID", `${base}.id`, `duplicate relation id: ${relation.id}`));
            relationIds.add(relation.id);
        }
        if (nonEmpty(relation.type) && !allowedRelations.has(relation.type))
            findings.push(finding("RELATION-TYPE-INVALID", `${base}.type`, `${relation.type} is not allowed`));
        if (nonEmpty(relation.from) && !byId.has(relation.from))
            findings.push(finding("RELATION-ENDPOINT-MISSING", `${base}.from`, `${relation.from} is not a submitted item`));
        if (nonEmpty(relation.to) && !byId.has(relation.to))
            findings.push(finding("RELATION-ENDPOINT-MISSING", `${base}.to`, `${relation.to} is not a submitted item`));
        if (relation.from && relation.from === relation.to)
            findings.push(finding("RELATION-SELF-LOOP", base, "relation endpoints must differ"));
    });
    const deferredItems = Array.isArray(input.deferredItems) ? input.deferredItems : [];
    for (let index = 0; index < deferredItems.length; index += 1) {
        const deferred = object(deferredItems[index]);
        const base = `deferredItems[${index}]`;
        if (!deferred) {
            findings.push(finding("DEFERRED-NOT-OBJECT", base, "deferred item must be an object"));
            continue;
        }
        for (const key of ["id", "kind", "statement", "targetStage", "documentSection", "reason"])
            if (!nonEmpty(deferred[key]))
                findings.push(finding("DEFERRED-FIELD-REQUIRED", `${base}.${key}`, `${key} is required`));
        if (nonEmpty(deferred.targetStage)) {
            try {
                if (stageIndex(profile, deferred.targetStage) <= stageIndex(profile, stage.id))
                    findings.push(finding("DEFERRED-TARGET-NOT-LATER", `${base}.targetStage`, "deferred target must be a later workflow stage"));
                await intrinsicFor(state.workflowType, deferred.targetStage);
            }
            catch {
                findings.push(finding("DEFERRED-TARGET-UNKNOWN", `${base}.targetStage`, `${deferred.targetStage} is not a workflow stage`));
            }
        }
    }
    for (const requiredKinds of intrinsic.requiredAnyOf ?? []) {
        if (!items.some((item) => requiredKinds.includes(item?.kind)))
            findings.push(finding("REQUIRED-KIND-MISSING", "items", `stage requires at least one of: ${requiredKinds.join(", ")}`));
    }
    for (const [heading, body] of Object.entries(object(input.sections) ?? {})) {
        if (!allowedNarrativeSections.has(heading))
            findings.push(finding("SECTION-NOT-OWNED", `sections.${heading}`, `${heading} is not owned by stage ${stage.id}`));
        if (!nonEmpty(body))
            findings.push(finding("SECTION-BODY-EMPTY", `sections.${heading}`, "section body must contain a business increment"));
        else if (/^#{2,3}\s+/m.test(String(body)))
            findings.push(finding("SECTION-CONTAINS-HEADING", `sections.${heading}`, "section bodies cannot introduce Markdown level-2 or level-3 headings because the milestone directory is fixed"));
    }
    const sole = object(input.soleOutput);
    if (sole) {
        if (!nonEmpty(sole.statement))
            findings.push(finding("SOLE-OUTPUT-STATEMENT-REQUIRED", "soleOutput.statement", "soleOutput.statement is required", "Patch /soleOutput/statement without replacing the existing soleOutput object."));
        if (!Array.isArray(sole.itemRefs))
            findings.push(finding("SOLE-OUTPUT-REFS-REQUIRED", "soleOutput.itemRefs", "soleOutput.itemRefs must be an array", "Patch /soleOutput/itemRefs with active item ids; preserve soleOutput.statement."));
        else
            for (const ref of sole.itemRefs)
                if (!byId.has(ref))
                    findings.push(finding("SOLE-OUTPUT-REF-INVALID", "soleOutput.itemRefs", `${String(ref)} is not an active item`));
    }
    if (stage.humanGate) {
        const overview = object(input.overview);
        if (!overview)
            findings.push(finding("HUMAN-OVERVIEW-REQUIRED", "overview", "human-gate stages require a one-page overview"));
        else {
            for (const key of ["currentConclusion", "latestBusinessIncrement", "recommendation"])
                if (!nonEmpty(overview[key]))
                    findings.push(finding("OVERVIEW-FIELD-REQUIRED", `overview.${key}`, `${key} is required`));
            for (const key of ["acceptanceChecklist", "openQuestions"])
                if (!Array.isArray(overview[key]) || !overview[key].length || overview[key].some((entry) => !nonEmpty(entry)))
                    findings.push(finding("OVERVIEW-LIST-REQUIRED", `overview.${key}`, `${key} must be a non-empty string array`));
            if (nonEmpty(overview.recommendation) && !/(建议|推荐|判定)/.test(overview.recommendation))
                findings.push(finding("RECOMMENDATION-NOT-ACTIONABLE", "overview.recommendation", "recommendation must state an explicit recommendation"));
            if (nonEmpty(overview.recommendation) && !/(因为|依据|基于|原因|考虑到)/.test(overview.recommendation))
                findings.push(finding("RECOMMENDATION-MISSING-RATIONALE", "overview.recommendation", "recommendation must include its rationale"));
            const unresolved = items.filter((item) => item?.kind === "open-question" && object(item.attributes)?.state === "unresolved");
            const questions = Array.isArray(overview.openQuestions) ? overview.openQuestions.filter(nonEmpty) : [];
            const substantive = questions.filter((question) => !/(?:当前)?(?:没有|无)(?:阻塞性)?未决问题/.test(question));
            for (const question of substantive) {
                if (!unresolved.some((item) => question.includes(String(object(item.attributes)?.decisionId ?? "")))) {
                    findings.push(finding("OVERVIEW-QUESTION-NOT-MODELED", "overview.openQuestions", `overview question is absent from the semantic graph: ${question}`, "Add an open-question item with an explicit decisionId and blocks relation, or remove the prose-only question."));
                }
            }
            for (const item of unresolved) {
                const decisionId = String(object(item.attributes)?.decisionId ?? "");
                if (!decisionId || !questions.some((question) => question.includes(decisionId))) {
                    findings.push(finding("MODELED-QUESTION-NOT-IN-OVERVIEW", `items.${item.id}`, `${item.id} must be visible in overview.openQuestions using decisionId ${decisionId || "<missing>"}`));
                }
            }
        }
        const formalPath = documentPath(root, profile, stage);
        const formal = await exists(formalPath) ? await readFile(formalPath, "utf8") : "";
        const suppliedSections = object(input.sections) ?? {};
        for (const subsection of ownedSubsections) {
            const direct = suppliedSections[subsection];
            const parent = (documentContract?.sections ?? []).find((section) => (section.subsections ?? []).includes(subsection));
            const parentSuppliesFirst = parent?.subsections?.[0] === subsection ? suppliedSections[parent.heading] : undefined;
            const effective = nonEmpty(direct) ? direct : nonEmpty(parentSuppliesFirst) ? parentSuppliesFirst : subsectionBody(formal, subsection);
            if (!nonEmpty(effective) || /待本里程碑补充|待填写|参见正文|见正文/.test(effective)) {
                findings.push(finding("HUMAN-MILESTONE-SUBSECTION-INCOMPLETE", `sections.${subsection}`, `human milestone subsection must contain reviewable business content: ${subsection}`));
            }
        }
    }
    const edges = relations.map((relation) => relation).filter(Boolean);
    for (const item of items) {
        if (!item || !nonEmpty(item.id))
            continue;
        const attrs = object(item.attributes) ?? {};
        if (item.kind === "open-question" && attrs.state === "unresolved") {
            const blocked = edges.filter((edge) => edge.type === "blocks" && edge.from === item.id);
            if (!blocked.length)
                findings.push(finding("UNRESOLVED-QUESTION-NOT-BLOCKING", `items.${item.id}`, "an unresolved question must block at least one candidate conclusion"));
            for (const edge of blocked) {
                const target = byId.get(edge.to);
                const targetAttrs = object(target?.attributes) ?? {};
                const safelyDeferred = ["candidate", "future"].includes(targetAttrs.scopeDisposition)
                    && ["alternative", "exception", "supporting", "none"].includes(targetAttrs.flowRole);
                if (!safelyDeferred || sole?.itemRefs?.includes(target?.id))
                    findings.push(finding("BLOCKED-CONCLUSION-ACTIVE", `relations.${edge.id}`, `${target?.id} is blocked by an unresolved question and must remain a non-main candidate/future alternative outside soleOutput`));
            }
        }
        if (["business-command", "application-command"].includes(item.kind) && attrs.intent === "information-request") {
            const returns = edges.filter((edge) => edge.type === "returns" && edge.from === item.id);
            if (!returns.length || returns.some((edge) => byId.get(edge.to)?.kind !== "read-model"))
                findings.push(finding("QUERY-RESULT-AS-EVENT", `items.${item.id}`, "an information request must return a read-model, not a domain event"));
        }
        if (["domain-event", "internal-domain-event"].includes(item.kind)) {
            const policyTarget = edges.some((edge) => edge.type === "triggers" && edge.from === item.id && byId.get(edge.to)?.kind === "business-policy");
            if (!attrs.businessSideEffect && !attrs.changedState && !policyTarget)
                findings.push(finding("EVENT-WITHOUT-BUSINESS-EFFECT", `items.${item.id}`, "a domain event must express a state transition or trigger a business policy"));
        }
        if (item.kind === "external-party" && (attrs.boundary !== "external" || !Array.isArray(attrs.boundaryEvidenceRefs) || !attrs.boundaryEvidenceRefs.length))
            findings.push(finding("EXTERNAL-BOUNDARY-UNPROVEN", `items.${item.id}`, "external-party requires external boundary evidence"));
        if (item.kind === "read-model" && ["main", "supporting"].includes(attrs.flowRole)) {
            const returnedByQuery = edges.some((edge) => edge.type === "returns" && edge.to === item.id
                && ["business-command", "application-command"].includes(byId.get(edge.from)?.kind)
                && object(byId.get(edge.from)?.attributes)?.intent === "information-request");
            if (!returnedByQuery)
                findings.push(finding("READ-MODEL-WITHOUT-QUERY", `items.${item.id}`, "an active read-model must be returned by an explicit information-request command"));
        }
        if (item.kind === "capability-status" && attrs.status === "target" && attrs.flowRole === "supporting" && attrs.scopeDisposition === "requested") {
            const priorApproval = Array.isArray(attrs.authorityRefs) && attrs.authorityRefs.some((ref) => nonEmpty(ref) && ref.startsWith("approval:"));
            const blockedForDecision = edges.some((edge) => edge.type === "blocks" && edge.to === item.id
                && byId.get(edge.from)?.kind === "open-question" && object(byId.get(edge.from)?.attributes)?.state === "unresolved");
            if (!priorApproval && !blockedForDecision)
                findings.push(finding("SUPPORTING-TARGET-REQUIRES-DECISION", `items.${item.id}`, "a newly added supporting capability is not implied by the primary feature request; keep it candidate and expose an unresolved scope decision, or cite prior human approval"));
        }
    }
    const sources = [
        ...items.map((item) => ({ path: `items.${item?.id ?? "?"}`, text: item?.statement ?? "", kind: item?.kind })),
        { path: "soleOutput.statement", text: sole?.statement ?? "", kind: intrinsic.soleOutput.kind },
        ...Object.entries(object(input.sections) ?? {}).map(([heading, body]) => ({ path: `sections.${heading}`, text: String(body), section: heading })),
    ];
    const businessIncrement = sources.map((source) => source.text).join("\n");
    if (quality?.minSectionChars && businessIncrement.length < quality.minSectionChars) {
        findings.push(finding("BUSINESS-INCREMENT-TOO-SHORT", "sections", `the stage business increment must contain at least ${quality.minSectionChars} characters`));
    }
    const fixedDocumentTerms = (documentCatalog.documents?.[stage.document]?.sections ?? [])
        .flatMap((section) => [section.heading, ...(section.subsections ?? [])])
        .join("\n");
    for (const required of quality?.requiredContent ?? []) {
        if (!businessIncrement.includes(required) && !fixedDocumentTerms.includes(required))
            findings.push(finding("REQUIRED-BUSINESS-CONTENT-MISSING", "sections", `missing required business content: ${required}`));
    }
    for (const rule of catalog.preApprovalForbiddenPatterns ?? []) {
        let expression;
        try {
            expression = new RegExp(rule.pattern, "iu");
        }
        catch {
            continue;
        }
        for (const source of sources) {
            const match = expression.exec(source.text);
            if (match)
                findings.push(finding(rule.id, source.path, "a pre-approval stage cannot claim that a new decision is already approved or final", `Use candidate/proposed language instead of: ${match[0]}`));
        }
    }
    for (const rule of catalog.deterministicSemanticRules?.[intrinsicId] ?? []) {
        let expression;
        try {
            expression = new RegExp(rule.pattern, "iu");
        }
        catch {
            continue;
        }
        for (const source of sources) {
            if (rule.targets && !rule.targets.some((target) => source.path.startsWith(target === "items" ? "items." : target === "sections" ? "sections." : "soleOutput")))
                continue;
            if (rule.includeKinds && !rule.includeKinds.includes(source.kind))
                continue;
            if (rule.excludeKinds && rule.excludeKinds.includes(source.kind))
                continue;
            if (rule.sections && source.section && !rule.sections.includes(source.section))
                continue;
            const match = expression.exec(source.text);
            if (match)
                findings.push(finding(rule.id, source.path, rule.message, `Remove or defer: ${match[0]}`));
        }
    }
    return { submission: input, findings };
}
function bulletList(values) {
    return values.map((value) => `- ${value}`).join("\n");
}
export async function compileStageSubmission(root, state, profile, stage, submission) {
    const [intrinsicId, intrinsic] = await intrinsicFor(state.workflowType, stage.id);
    const catalog = await intrinsics();
    const documentCatalog = await documents();
    const policy = catalog.semanticGraph?.policies?.[intrinsicId] ?? {};
    const bundle = stageBundle(root, profile, stage);
    let candidate = addHiddenStageMetadata(await readFile(documentPath(root, profile, stage), "utf8"), stage);
    const documentContract = documentCatalog.documents[stage.document];
    const ownedSubsections = (documentContract?.sections ?? [])
        .filter((section) => intrinsic.ownedSections.includes(section.heading))
        .flatMap((section) => section.subsections ?? []);
    for (const heading of intrinsic.ownedSections) {
        const supplied = submission.sections[heading];
        const sectionItems = submission.items.filter((item) => item.documentSection === heading);
        if (!nonEmpty(supplied) && !sectionItems.length)
            continue;
        const section = documentContract.sections.find((entry) => entry.heading === heading);
        if (!section?.subsections?.length)
            throw new Error(`No fixed subsection is available for owned section: ${heading}`);
        let body = nonEmpty(supplied) ? supplied.trim() : "";
        for (const item of sectionItems)
            if (!body.includes(item.statement))
                body += `${body ? "\n\n" : ""}- ${item.statement}`;
        candidate = replaceSubsection(candidate, section.subsections[0], body);
    }
    for (const subsection of ownedSubsections) {
        const supplied = submission.sections[subsection];
        if (nonEmpty(supplied))
            candidate = replaceSubsection(candidate, subsection, supplied);
    }
    if (stage.humanGate && submission.overview) {
        const common = documentCatalog.commonOverview.flatMap((entry) => entry.subsections);
        const overviewBodies = [
            submission.overview.currentConclusion,
            submission.overview.latestBusinessIncrement,
            "等待人工验收",
            "是。请依据本页结论、验收清单和 AI 建议作出批准、修改或拒绝决定。",
            bulletList(submission.overview.acceptanceChecklist),
            bulletList(submission.overview.openQuestions),
            submission.overview.recommendation,
        ];
        common.forEach((heading, index) => { candidate = replaceSubsection(candidate, heading, overviewBodies[index]); });
    }
    await atomicText(bundle.candidate, candidate);
    const items = submission.items.map((item) => {
        const attributes = { ...(item.attributes ?? {}) };
        if (policy.decisionPlane && !("decisionPlane" in attributes))
            attributes.decisionPlane = policy.decisionPlane;
        if ((policy.decisionKinds ?? []).includes(item.kind) && !("decisionStatus" in attributes))
            attributes.decisionStatus = policy.decisionStatus;
        return {
            id: item.id, kind: item.kind, statement: item.statement,
            ownerStage: stage.id, ownerContract: intrinsicId, decisionLevel: intrinsic.scopeId,
            maturity: item.maturity, documentSection: item.documentSection,
            tracesTo: item.tracesTo?.length ? item.tracesTo : submission.inputReferences,
            evidenceRefs: item.evidenceRefs ?? [], attributes,
        };
    });
    const deferredItems = [];
    for (const raw of submission.deferredItems ?? []) {
        const item = raw;
        const [targetContract, targetIntrinsic] = await intrinsicFor(state.workflowType, item.targetStage);
        deferredItems.push({
            id: item.id, kind: item.kind, statement: item.statement, targetStage: item.targetStage,
            targetContract, decisionLevel: targetIntrinsic.scopeId, maturity: "deferred",
            documentSection: item.documentSection, reason: item.reason,
            tracesTo: Array.isArray(item.tracesTo) && item.tracesTo.length ? item.tracesTo : submission.inputReferences,
        });
    }
    const output = {
        schemaVersion: "ddd-stage-output/v3", workflowType: state.workflowType, workflowId: state.workflowId,
        stageId: stage.id, intrinsicContract: intrinsicId, scopeId: intrinsic.scopeId,
        governingQuestion: intrinsic.governingQuestion, inputReferences: submission.inputReferences,
        items, relations: submission.relations ?? [], deferredItems,
        soleOutput: { kind: intrinsic.soleOutput.kind, consumers: intrinsic.soleOutput.consumers, statement: submission.soleOutput.statement, itemRefs: submission.soleOutput.itemRefs },
        candidateDocument: { path: relative(root, bundle.candidate), sha256: await sha256(bundle.candidate) },
    };
    await writeJson(bundle.output, output);
    const changed = await changedSections(documentPath(root, profile, stage), bundle.candidate);
    const assessment = (quote) => ({
        quote, actualOwnerStage: stage.id, actualOwnerContract: intrinsicId,
        actualDecisionLevel: intrinsic.scopeId, action: "retain", severity: "none",
        rationale: "Computed by the deterministic stage scope auditor after structural, graph, cross-representation, and semantic validation.",
    });
    const review = {
        schemaVersion: "ddd-scope-review/v3", workflowType: state.workflowType, workflowId: state.workflowId,
        stageId: stage.id, intrinsicContract: intrinsicId, scopeId: intrinsic.scopeId,
        candidateDocumentSha256: await sha256(bundle.candidate), stageOutputSha256: await sha256(bundle.output),
        reviewerRole: "deterministic-stage-scope-auditor",
        itemAssessments: items.map((item) => ({ itemId: item.id, ...assessment(item.statement) })),
        relationAssessments: (submission.relations ?? []).map((relation) => ({ relationId: relation.id, ...assessment(relation.rationale) })),
        soleOutputAssessment: assessment(submission.soleOutput.statement),
        sectionAssessments: Object.entries(changed).map(([section, body]) => ({ section, ...assessment(body.trim().slice(0, Math.min(body.trim().length, 240))) })),
        findings: [], reviewedAt: now(),
    };
    await writeJson(bundle.review, review);
    return { candidateDocument: bundle.candidate, stageOutput: bundle.output, scopeReview: bundle.review };
}
//# sourceMappingURL=stage-submission.js.map