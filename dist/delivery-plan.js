import { createHash } from "node:crypto";
export function deliveryPlanSemanticEvidence(plan, context = {}) {
    const isRefactor = context.workflowType === "refactor-system";
    const hasSlices = plan.slices.length > 0;
    return {
        sliceCount: plan.slices.length,
        migrationVerticalSlices: !isRefactor || hasSlices,
        behaviorProtection: !isRefactor || (hasSlices && plan.slices.every((slice) => Boolean(slice.compatibility.trim()))),
        independentRollback: !isRefactor || (hasSlices && plan.slices.every((slice) => Boolean(slice.rollback.trim()))),
    };
}
const text = (value) => String(value ?? "").trim();
const list = (value) => Array.isArray(value) ? value.map(text).filter(Boolean) : [];
const decisionList = (value) => Array.isArray(value) ? value.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item))
        return text(item);
    const decision = text(item.decision);
    const rationale = text(item.rationale);
    const id = text(item.id);
    return [id, decision, rationale ? `理由：${rationale}` : ""].filter(Boolean).join("；");
}).filter(Boolean) : [];
function mergeById(current, patch) {
    const merged = new Map(current.map((item) => [item.id, item]));
    for (const item of patch)
        merged.set(item.id, { ...(merged.get(item.id) ?? {}), ...item });
    return [...merged.values()];
}
export function normalizeStructuredPlan(raw, current) {
    const currentCapabilities = new Map((current?.capabilities ?? []).map((item) => [item.id, item]));
    const capabilities = Array.isArray(raw?.capabilities) ? raw.capabilities.map((capability) => {
        const id = text(capability?.id);
        const prior = currentCapabilities.get(id);
        return {
            id,
            title: capability?.title === undefined ? prior?.title : (text(capability.title) || undefined),
            requirements: capability?.requirements === undefined ? (prior?.requirements ?? []) : capability.requirements.map((requirement) => ({
                name: text(requirement?.name),
                rule: text(requirement?.rule),
                scenarios: Array.isArray(requirement?.scenarios) ? requirement.scenarios.map((scenario) => ({
                    name: text(scenario?.name), given: text(scenario?.given) || undefined,
                    when: text(scenario?.when), then: text(scenario?.then),
                })) : [],
            })),
        };
    }) : [];
    const currentSlices = new Map((current?.slices ?? []).map((item) => [item.id, item]));
    const slices = Array.isArray(raw?.slices) ? raw.slices.map((slice) => {
        const id = text(slice?.id);
        const prior = currentSlices.get(id);
        const scalar = (field) => slice?.[field] === undefined ? text(prior?.[field]) : text(slice[field]);
        const array = (field) => slice?.[field] === undefined ? [...(prior?.[field] ?? [])] : list(slice[field]);
        return {
            id, title: scalar("title"), outcome: scalar("outcome"), consumer: scalar("consumer"),
            dependsOn: array("dependsOn"), acceptanceCriteria: array("acceptanceCriteria"),
            modelElementIds: array("modelElementIds"), invariantIds: array("invariantIds"),
            productionPaths: array("productionPaths"), testPaths: array("testPaths"), verification: array("verification"),
            compatibility: scalar("compatibility"), rollback: scalar("rollback"),
        };
    }) : [];
    return {
        title: text(raw?.title) || current?.title || "",
        objective: text(raw?.objective) || current?.objective || "",
        nonGoals: raw?.nonGoals === undefined ? (current?.nonGoals ?? []) : list(raw.nonGoals),
        designDecisions: raw?.designDecisions === undefined ? (current?.designDecisions ?? []) : decisionList(raw.designDecisions),
        capabilities: mergeById(current?.capabilities ?? [], capabilities),
        slices: mergeById(current?.slices ?? [], slices),
    };
}
export function validateStructuredPlan(plan) {
    const findings = [];
    const required = (value, path, label) => {
        if (!value)
            findings.push({ code: "PLAN_FIELD_REQUIRED", path, message: `${label}不能为空。` });
    };
    required(plan.title, "plan.title", "计划标题");
    required(plan.objective, "plan.objective", "业务目标");
    if (!plan.capabilities.length)
        findings.push({ code: "PLAN_CAPABILITY_REQUIRED", path: "plan.capabilities", message: "新增功能至少需要一个行为 capability。" });
    if (!plan.slices.length)
        findings.push({ code: "PLAN_SLICE_REQUIRED", path: "plan.slices", message: "至少需要一个可独立验收的纵向切片。" });
    const capabilityIds = new Set();
    plan.capabilities.forEach((capability, ci) => {
        if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(capability.id))
            findings.push({ code: "PLAN_CAPABILITY_ID_INVALID", path: `plan.capabilities[${ci}].id`, message: "capability id 必须是 kebab-case。" });
        if (capabilityIds.has(capability.id))
            findings.push({ code: "PLAN_CAPABILITY_DUPLICATE", path: `plan.capabilities[${ci}].id`, message: `capability ${capability.id} 重复。` });
        capabilityIds.add(capability.id);
        if (!capability.requirements.length)
            findings.push({ code: "PLAN_REQUIREMENT_REQUIRED", path: `plan.capabilities[${ci}].requirements`, message: "每个 capability 至少需要一个 Requirement。" });
        capability.requirements.forEach((requirement, ri) => {
            required(requirement.name, `plan.capabilities[${ci}].requirements[${ri}].name`, "Requirement 名称");
            required(requirement.rule, `plan.capabilities[${ci}].requirements[${ri}].rule`, "行为规则");
            if (!requirement.scenarios.length)
                findings.push({ code: "PLAN_SCENARIO_REQUIRED", path: `plan.capabilities[${ci}].requirements[${ri}].scenarios`, message: "每个 Requirement 至少需要一个 Given/When/Then Scenario。" });
            requirement.scenarios.forEach((scenario, si) => {
                required(scenario.name, `plan.capabilities[${ci}].requirements[${ri}].scenarios[${si}].name`, "Scenario 名称");
                required(scenario.when, `plan.capabilities[${ci}].requirements[${ri}].scenarios[${si}].when`, "WHEN");
                required(scenario.then, `plan.capabilities[${ci}].requirements[${ri}].scenarios[${si}].then`, "THEN");
            });
        });
    });
    const sliceIds = new Set();
    plan.slices.forEach((slice, index) => {
        if (!/^[A-Za-z][A-Za-z0-9_-]*$/u.test(slice.id))
            findings.push({ code: "PLAN_SLICE_ID_INVALID", path: `plan.slices[${index}].id`, message: "切片 ID 必须稳定且以字母开头。" });
        if (sliceIds.has(slice.id))
            findings.push({ code: "PLAN_SLICE_DUPLICATE", path: `plan.slices[${index}].id`, message: `切片 ${slice.id} 重复。` });
        sliceIds.add(slice.id);
        for (const [field, label] of [["title", "标题"], ["outcome", "可观察结果"], ["consumer", "真实消费者"], ["compatibility", "兼容策略"], ["rollback", "回滚策略"]])
            required(slice[field], `plan.slices[${index}].${field}`, `切片${label}`);
        for (const [field, label] of [["acceptanceCriteria", "验收标准"], ["modelElementIds", "ME 模型元素"], ["invariantIds", "INV 不变量"], ["productionPaths", "生产路径"], ["testPaths", "测试路径"], ["verification", "验证命令"]]) {
            if (!slice[field].length)
                findings.push({ code: "PLAN_SLICE_LIST_REQUIRED", path: `plan.slices[${index}].${field}`, message: `切片必须声明${label}。` });
        }
    });
    plan.slices.forEach((slice, index) => slice.dependsOn.forEach((dependency) => {
        if (!sliceIds.has(dependency))
            findings.push({ code: "PLAN_DEPENDENCY_UNKNOWN", path: `plan.slices[${index}].dependsOn`, message: `依赖切片 ${dependency} 不存在。` });
        if (dependency === slice.id)
            findings.push({ code: "PLAN_DEPENDENCY_SELF", path: `plan.slices[${index}].dependsOn`, message: "切片不能依赖自身。" });
    }));
    const visiting = new Set();
    const visited = new Set();
    const deps = new Map(plan.slices.map((slice) => [slice.id, slice.dependsOn]));
    const cycle = (id) => {
        if (visiting.has(id))
            return true;
        if (visited.has(id))
            return false;
        visiting.add(id);
        for (const dependency of deps.get(id) ?? [])
            if (cycle(dependency))
                return true;
        visiting.delete(id);
        visited.add(id);
        return false;
    };
    if ([...sliceIds].some(cycle))
        findings.push({ code: "PLAN_DEPENDENCY_CYCLE", path: "plan.slices", message: "纵向切片依赖图必须无环。" });
    return findings;
}
export function compileStructuredPlan(plan, workflowId) {
    const proposal = [`# ${plan.title}`, "", "## Why", plan.objective, "", "## What Changes",
        ...plan.capabilities.map((capability) => `- 新增 ${capability.title || capability.id} 行为能力。`),
        "", "## Non-goals", ...(plan.nonGoals.length ? plan.nonGoals.map((item) => `- ${item}`) : ["- 无额外范围。"]), ""].join("\n");
    const specs = plan.capabilities.map((capability) => ({
        capability: capability.id,
        content: ["## ADDED Requirements", ...capability.requirements.flatMap((requirement) => [
                "", `### Requirement: ${requirement.name}`, `系统 MUST ${requirement.rule.replace(/^系统\s+(?:MUST|SHALL)\s+/iu, "")}`,
                ...requirement.scenarios.flatMap((scenario) => ["", `#### Scenario: ${scenario.name}`,
                    ...(scenario.given ? [`- GIVEN ${scenario.given}`] : []), `- WHEN ${scenario.when}`, `- THEN ${scenario.then}`]),
            ]), ""].join("\n"),
    }));
    const design = [`# ${plan.title} 设计`, "", `OpenSpec change: ${workflowId}`, "", "## Approved design decisions",
        ...(plan.designDecisions.length ? plan.designDecisions.map((item) => `- ${item}`) : ["- 沿用里程碑 IV 已批准的领域模型与依赖方向。"]),
        "", "## Vertical slices", ...plan.slices.flatMap((slice) => [`### ${slice.id} ${slice.title}`, `- 结果：${slice.outcome}`, `- 消费者：${slice.consumer}`, `- 依赖：${slice.dependsOn.join("、") || "无"}`, `- 模型：${slice.modelElementIds.join("、")}`, `- 不变量：${slice.invariantIds.join("、")}`, `- 兼容：${slice.compatibility}`, `- 回滚：${slice.rollback}`]), ""].join("\n");
    const tasks = plan.slices.map((slice, index) => `- [ ] ${index + 1}.1 [${slice.id}] ${slice.title}；消费者：${slice.consumer}；验证：${slice.verification.join("；")}`).join("\n") + "\n";
    const roadmap = {
        schemaVersion: "ddd-delivery-roadmap/v2", workflowId, generatedAt: new Date().toISOString(),
        slices: plan.slices.map((slice, index) => ({ ...slice, order: index + 1, status: "planned" })),
        sourceHash: createHash("sha256").update(JSON.stringify(plan)).digest("hex"),
    };
    return { proposal, specs, design, tasks, roadmap };
}
export function compileDeliveryMilestoneSections(plan, workflowId, contract = {}, context = {}) {
    const isRefactor = context.workflowType === "refactor-system";
    const semanticEvidence = deliveryPlanSemanticEvidence(plan, context);
    const models = new Map((contract.modelElements ?? []).map((item) => [item.id, item]));
    const invariants = new Map((contract.invariants ?? []).map((item) => [item.id, item]));
    const modelLabel = (id) => {
        const item = models.get(id);
        return item ? `${id} ${item.name ?? ""}`.trim() : id;
    };
    const invariantLabel = (id) => {
        const item = invariants.get(id);
        return item?.statement ? `${id}：${item.statement}` : id;
    };
    const sliceDetails = [
        ...(isRefactor ? [
            `迁移纵向切片：以下 ${semanticEvidence.sliceCount} 个切片直接来自已校验的 plan.slices；迁移顺序由 dependsOn 决定。`,
            "",
        ] : []),
        ...plan.slices.flatMap((slice) => [
            `### ${slice.id}：${slice.title}`,
            `- 可观察业务结果：${slice.outcome}`,
            `- 真实消费者：${slice.consumer}`,
            `- 前置切片：${slice.dependsOn.join("、") || "无"}`,
            `- 验收标准：${slice.acceptanceCriteria.join("；")}`,
            `- 模型元素：${slice.modelElementIds.map(modelLabel).join("；")}`,
            `- 业务不变量：${slice.invariantIds.map(invariantLabel).join("；")}`,
            `- 生产文件：${slice.productionPaths.join("；")}`,
            `- 测试文件：${slice.testPaths.join("；")}`,
            `- 真实验证：${slice.verification.join("；")}`,
            `- ${isRefactor ? "行为保护" : "兼容策略"}：${slice.compatibility}`,
            `- 回滚策略：${slice.rollback}`,
            "",
        ]),
    ].join("\n").trim();
    const traceRows = plan.slices.map((slice) => `| ${slice.id} | ${slice.acceptanceCriteria.join("；")} | ${slice.modelElementIds.join("、")} | ${slice.invariantIds.join("、")} | ${slice.productionPaths.join("；")} | ${slice.testPaths.join("；")} |`);
    const requirementRows = plan.capabilities.flatMap((capability) => capability.requirements.flatMap((requirement) => requirement.scenarios.map((scenario) => `- ${capability.id} / ${requirement.name} / ${scenario.name}：WHEN ${scenario.when}；THEN ${scenario.then}`)));
    const summary = `${plan.title}将按 ${plan.slices.length} 个可独立验收和回滚的纵向切片交付；所有切片均绑定真实消费者、批准模型、不变量、生产与测试文件以及验证命令。`;
    const sections = {
        "一页结论": `${summary}\n\n业务目标：${plan.objective}\n\n当前状态：结构化 OpenSpec 计划已通过运行时编译，等待里程碑 V 人工批准后进入编码。`,
        "本次请您确认": [
            "请确认以下交付决策，而不是重新评审领域模型：",
            `- ${plan.slices.length} 个纵向切片的业务结果、顺序和依赖是否合理。`,
            "- 每个切片的真实消费者、验收标准、验证命令和回滚方式是否可执行。",
            `- 明确不做：${plan.nonGoals.join("；") || "无额外范围"}。`,
            "AI 建议：优先批准能贯通真实消费者的最小 Walking Skeleton，再按依赖顺序完成后续切片。",
        ].join("\n"),
        "交付范围": [`业务目标：${plan.objective}`, "", "批准设计决策：", ...(plan.designDecisions.length ? plan.designDecisions.map((item) => `- ${item}`) : ["- 沿用里程碑 IV 已批准设计。"]), "", "明确不做：", ...(plan.nonGoals.length ? plan.nonGoals.map((item) => `- ${item}`) : ["- 无额外范围。"])].join("\n"),
        "纵向交付切片": sliceDetails,
        "交付追踪矩阵": ["纵向切片—验收—文件映射：", "", "战术模型—切片—文件覆盖：", "| 切片 | 验收标准 | 模型元素 | 不变量 | 生产文件 | 测试文件 |", "|---|---|---|---|---|---|", ...traceRows, "", "模块—层—依赖机器合同：生产文件必须遵循里程碑 IV 已批准的上下文优先分层和依赖方向；编码阶段不得另建未批准入口或基础设施。"].join("\n"),
        "OpenSpec 变更映射": [`OpenSpec change 映射：${workflowId}`, "OpenSpec Requirement/Scenario 追踪：", ...requirementRows, `- 纵向切片：${plan.slices.map((slice) => slice.id).join("、")}`].join("\n"),
        "测试与验证计划": ["架构验证命令：复用下列每个切片已校验的工程验证命令，并在真实消费者链路中核验已批准的模块边界和依赖方向。", "", ...plan.slices.map((slice) => `### ${slice.id}\n- 验收：${slice.acceptanceCriteria.join("；")}\n- 测试文件：${slice.testPaths.join("；")}\n- 验证命令：${slice.verification.join("；")}`)].join("\n\n"),
        "Git 交付计划": [`Git 基线与回滚策略：编码开始前记录当前分支与 HEAD；每个切片形成一个独立提交。`, ...plan.slices.map((slice) => `- ${slice.id}：验证通过后独立提交；失败或回退时执行该切片批准的回滚策略：${slice.rollback}`), "- 禁止把多个未验证切片合并为一次提交；提交标识写入实现证据。"].join("\n"),
        "风险、迁移与上线": [
            ...(isRefactor ? [
                "### 行为保护与回滚",
                `结构化合同判定：行为保护字段${semanticEvidence.behaviorProtection ? "完整" : "不完整"}；独立回滚字段${semanticEvidence.independentRollback ? "完整" : "不完整"}。`,
                "",
            ] : []),
            ...plan.slices.map((slice) => `- ${slice.id} 兼容与迁移：${slice.compatibility}；回滚：${slice.rollback}`),
        ].join("\n"),
        "备选交付方案与建议": `推荐按当前 ${plan.slices.length} 个纵向切片渐进交付，每个切片都产生真实业务结果并可独立验证。若合并切片会扩大失败与回滚范围；若按技术层拆分则无法独立业务验收，因此均不推荐。`,
        "证据与追踪": [`- OpenSpec change：${workflowId}`, `- 结构化计划哈希：${createHash("sha256").update(JSON.stringify(plan)).digest("hex")}`, `- model-contract.json 哈希：${contract.sourceSha256 ?? "由当前批准模型合同提供"}`, `- 切片数量：${plan.slices.length}`, ...(isRefactor ? [`- 重构交付合同：迁移纵向切片=${semanticEvidence.migrationVerticalSlices ? "满足" : "不满足"}；行为保护与回滚=${semanticEvidence.behaviorProtection && semanticEvidence.independentRollback ? "满足" : "不满足"}。`] : []), "- 本文由运行时从已校验的结构化计划和批准模型合同确定性编译，未接受模型自由改写。"].join("\n"),
    };
    return { summary, sections };
}
//# sourceMappingURL=delivery-plan.js.map