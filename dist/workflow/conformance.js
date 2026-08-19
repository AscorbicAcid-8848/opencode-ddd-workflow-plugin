import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { exists, readJson, run, sha256, walkFiles } from "./fs.js";
import { WorkflowError } from "./types.js";
const SHA = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/i;
const nonempty = (value, label) => {
    if (!Array.isArray(value) || !value.length || value.some((x) => typeof x !== "string" || !x.trim()) || new Set(value).size !== value.length)
        throw new WorkflowError(`${label} 必须是非空且无重复的字符串数组`);
    return value;
};
const inside = (value, prefix) => value === prefix || value.startsWith(`${prefix.replace(/\/$/, "")}/`);
const safeRelative = (value, label) => {
    if (typeof value !== "string" || !value || path.isAbsolute(value) || value.split(/[\\/]/).includes(".."))
        throw new WorkflowError(`${label} 必须是工作流根目录内的相对路径`);
    return value.replace(/\\/g, "/").replace(/^\.\//, "");
};
export async function validateDeliveryAssets(root, state) {
    const delivery = path.join(root, ".ddd", "delivery");
    const manifestFile = path.join(delivery, "manifest.json");
    if (!await exists(manifestFile))
        throw new WorkflowError("缺少 DDD delivery manifest");
    const manifest = await readJson(manifestFile);
    if (manifest.schema !== "ddd-delivery-assets/v1" || manifest.workflowId !== state.workflowId || manifest.workflowType !== state.workflowType)
        throw new WorkflowError("DDD delivery manifest 身份或 schema 不一致");
    const keys = ["productBrief", "architecture", "roadmap"];
    const files = [manifestFile];
    for (const key of keys) {
        const relative = safeRelative(manifest[key], `manifest.${key}`);
        const absolute = path.join(delivery, relative);
        if (!await exists(absolute))
            throw new WorkflowError(`manifest.${key} 指向的文件不存在：${relative}`);
        files.push(absolute);
    }
    const specs = nonempty(manifest.featureSpecs, "manifest.featureSpecs");
    for (const spec of specs) {
        const relative = safeRelative(spec, "manifest.featureSpecs");
        if (!relative.startsWith("specs/"))
            throw new WorkflowError("featureSpecs 必须位于 change-owned delivery/specs/");
        const absolute = path.join(delivery, relative);
        if (!await exists(absolute))
            throw new WorkflowError(`feature spec 不存在：${relative}`);
        files.push(absolute);
    }
    const roadmap = await readJson(path.join(delivery, manifest.roadmap));
    if (roadmap.workflowId !== state.workflowId || !Array.isArray(roadmap.nodes) || !roadmap.nodes.length)
        throw new WorkflowError("roadmap.json 身份错误或没有交付节点");
    const ids = new Set();
    const itemIds = new Set();
    for (const node of roadmap.nodes) {
        if (!node.id || ids.has(node.id))
            throw new WorkflowError("roadmap 节点 id 缺失或重复");
        ids.add(node.id);
        if (node.kind === "item") {
            itemIds.add(node.id);
            nonempty(node.acceptanceCriteria, `${node.id}.acceptanceCriteria`);
            nonempty(node.consumers, `${node.id}.consumers`);
            nonempty(node.verificationCommands, `${node.id}.verificationCommands`);
            const spec = safeRelative(node.spec?.path, `${node.id}.spec.path`);
            if (!spec.startsWith("specs/"))
                throw new WorkflowError(`${node.id}.spec.path 必须位于 delivery/specs/`);
            const absolute = path.join(delivery, spec);
            if (!await exists(absolute) || node.spec.sha256 !== await sha256(absolute))
                throw new WorkflowError(`${node.id}.spec 绑定缺失或 hash 已过期`);
        }
    }
    for (const node of roadmap.nodes)
        for (const dependency of node.dependsOn ?? [])
            if (!ids.has(dependency))
                throw new WorkflowError(`${node.id} 引用了未知依赖 ${dependency}`);
    detectCycle(roadmap.nodes);
    let modelContract = null;
    if (manifest.modelContract) {
        const relative = safeRelative(manifest.modelContract, "manifest.modelContract");
        modelContract = await validateModelContract(root, state, path.join(delivery, relative));
        files.push(modelContract.path);
    }
    if (!modelContract)
        throw new WorkflowError("三类 DDD 工作流都必须提供 model-contract.json");
    return { schema: manifest.schema, items: itemIds.size, artifacts: await Promise.all(files.map(async (file) => ({ path: path.relative(root, file).replace(/\\/g, "/"), sha256: await sha256(file), bytes: (await stat(file)).size }))), modelContract: { path: path.relative(root, modelContract.path).replace(/\\/g, "/"), sha256: modelContract.sha256, elements: modelContract.elements.size, invariants: modelContract.invariants.size } };
}
export async function validateModelContract(root, state, file = path.join(root, ".ddd", "delivery", "model-contract.json")) {
    if (!await exists(file))
        throw new WorkflowError("缺少 model-contract.json");
    const data = await readJson(file);
    if (data.schema !== "ddd-model-conformance/v1" || data.workflowId !== state.workflowId || data.workflowType !== state.workflowType || data.status !== "approved")
        throw new WorkflowError("model-contract 身份、schema 或批准状态不正确");
    const expectedMode = state.workflowType === "refactor-system" ? "migration" : "strict";
    if (data.conformanceMode !== expectedMode)
        throw new WorkflowError(`${state.workflowType} 必须使用 ${expectedMode} conformanceMode`);
    const tactical = safeRelative(data.tacticalDesign?.path, "tacticalDesign.path");
    const tacticalFile = path.join(root, tactical);
    if (!await exists(tacticalFile) || data.tacticalDesign.sha256 !== await sha256(tacticalFile))
        throw new WorkflowError("model-contract 绑定的战术设计 hash 已过期");
    if (!data.architecture || !Array.isArray(data.architecture.modules) || !data.architecture.modules.length)
        throw new WorkflowError("model-contract 缺少 architecture.modules");
    const modules = new Map();
    const layers = new Set();
    for (const module of data.architecture.modules) {
        if (!module.id || modules.has(module.id))
            throw new WorkflowError("architecture module id 缺失或重复");
        modules.set(module.id, module);
        nonempty(module.sourceRoots, `${module.id}.sourceRoots`);
        if (!Array.isArray(module.layers) || !module.layers.length)
            throw new WorkflowError(`${module.id}.layers 必须是非空数组`);
        for (const layer of module.layers) {
            if (!layer.id || !Array.isArray(layer.pathPrefixes) || !layer.pathPrefixes.length)
                throw new WorkflowError(`${module.id} layer 合同不完整`);
            layers.add(`${module.id}:${layer.id}`);
        }
    }
    const elements = new Map();
    for (const element of data.elements ?? []) {
        if (!/^ME-/.test(element.id) || elements.has(element.id) || !modules.has(element.moduleId) || !layers.has(`${element.moduleId}:${element.layerId}`))
            throw new WorkflowError(`模型元素 ${element.id ?? "?"} 归属不合法`);
        nonempty(element.productionPaths, `${element.id}.productionPaths`);
        nonempty(element.testPaths, `${element.id}.testPaths`);
        const module = modules.get(element.moduleId);
        for (const value of element.productionPaths)
            if (!module.sourceRoots.some((prefix) => inside(value, prefix)))
                throw new WorkflowError(`${element.id} productionPath 不属于模块 ${element.moduleId}`);
        elements.set(element.id, element);
    }
    if (!elements.size)
        throw new WorkflowError("model-contract 必须登记至少一个 ME-* 模型元素");
    const invariants = new Map();
    for (const invariant of data.invariants ?? []) {
        if (!/^INV-/.test(invariant.id) || invariants.has(invariant.id) || !elements.has(invariant.ownerElementId))
            throw new WorkflowError(`不变量 ${invariant.id ?? "?"} owner 不合法`);
        nonempty(invariant.acceptanceCriteria, `${invariant.id}.acceptanceCriteria`);
        invariants.set(invariant.id, invariant);
    }
    return { path: file, sha256: await sha256(file), data, elements, invariants };
}
export async function validateImplementationEvidence(root, state, stageId, evidenceFile) {
    if (!evidenceFile)
        throw new WorkflowError("实现阶段必须提供 implementation evidence");
    const absolute = path.isAbsolute(evidenceFile) ? evidenceFile : path.resolve(state.projectRoot, evidenceFile);
    if (!await exists(absolute))
        throw new WorkflowError(`Implementation evidence does not exist: ${absolute}`);
    const evidence = await readJson(absolute);
    if (evidence.schema !== "ddd-implementation-evidence/v2" || evidence.workflowId !== state.workflowId || evidence.stage !== stageId)
        throw new WorkflowError("Implementation evidence 身份、stage 或 schema 不正确");
    for (const key of ["baselineSha", "implementationSha", "commitSha"])
        if (!SHA.test(evidence[key] ?? ""))
            throw new WorkflowError(`${key} 不是 Git SHA`);
    if (evidence.implementationSha !== evidence.commitSha)
        throw new WorkflowError("implementationSha 必须等于本切片 commitSha");
    const acceptance = nonempty(evidence.acceptanceCriteria, "acceptanceCriteria");
    const changed = nonempty(evidence.changedPaths, "changedPaths");
    const production = nonempty(evidence.productionPaths, "productionPaths");
    const tests = nonempty(evidence.testPaths, "testPaths");
    const consumers = nonempty(evidence.consumerPaths, "consumerPaths");
    for (const value of [...production, ...tests, ...consumers])
        if (!changed.includes(value))
            throw new WorkflowError(`${value} 必须属于 changedPaths`);
    for (const value of [...production, ...tests, ...consumers])
        if (!await exists(path.join(state.projectRoot, value)))
            throw new WorkflowError(`实现证据路径不存在：${value}`);
    await git(state.projectRoot, ["cat-file", "-e", `${evidence.baselineSha}^{commit}`]);
    await git(state.projectRoot, ["cat-file", "-e", `${evidence.implementationSha}^{commit}`]);
    const actualChanged = (await git(state.projectRoot, ["diff", "--name-only", evidence.baselineSha, evidence.implementationSha])).split(/\r?\n/).filter(Boolean).map((x) => x.replace(/\\/g, "/")).sort();
    if (JSON.stringify([...changed].sort()) !== JSON.stringify(actualChanged))
        throw new WorkflowError("changedPaths 必须精确等于 Git range 的变更文件");
    if (!Array.isArray(evidence.verification) || !evidence.verification.length || evidence.verification.some((x) => x.exitCode !== 0 || !x.command || !x.resultSummary))
        throw new WorkflowError("verification 必须记录成功命令");
    if (!Array.isArray(evidence.runtimeEvidence) || !evidence.runtimeEvidence.length || evidence.runtimeEvidence.some((x) => x.result !== "passed" || !x.reference))
        throw new WorkflowError("runtimeEvidence 必须提供通过的真实运行证据");
    if (typeof evidence.compatibility !== "string" || evidence.compatibility.length < 12 || typeof evidence.rollback !== "string" || evidence.rollback.length < 12)
        throw new WorkflowError("compatibility 与 rollback 必须可执行且具体");
    const model = await validateModelContract(root, state);
    const design = evidence.designConformance;
    if (!design || design.modelContractSha256 !== model.sha256 || !Array.isArray(design.deviations) || design.deviations.length)
        throw new WorkflowError("designConformance 必须绑定当前模型合同且 deviations 为空");
    const elementIds = nonempty(design.modelElementIds, "designConformance.modelElementIds");
    const invariantIds = Array.isArray(design.invariantIds) ? design.invariantIds : [];
    for (const id of elementIds)
        if (!model.elements.has(id))
            throw new WorkflowError(`未知模型元素：${id}`);
    for (const id of invariantIds)
        if (!model.invariants.has(id))
            throw new WorkflowError(`未知不变量：${id}`);
    for (const id of elementIds) {
        const element = model.elements.get(id);
        if (!element.productionPaths.some((x) => production.includes(x)))
            throw new WorkflowError(`${id} 没有由本切片批准的生产路径实现`);
    }
    validateTests(evidence, acceptance, invariantIds, consumers, state);
    const architecture = await architectureConformance(state, model, production, evidence.implementationSha);
    evidence.architectureConformance = architecture;
    return { ...evidence, evidencePath: path.relative(root, absolute).replace(/\\/g, "/"), evidenceSha256: await sha256(absolute) };
}
function validateTests(evidence, acceptance, invariants, consumers, state) {
    const tests = evidence.testEvidence;
    if (!tests?.coverage || !Array.isArray(tests.levels) || !tests.e2e)
        throw new WorkflowError("testEvidence 必须包含 coverage、levels 和 e2e");
    if (tests.coverage.uncovered?.length)
        throw new WorkflowError("testEvidence.coverage.uncovered 必须为空");
    const targets = new Set((tests.coverage.mappings ?? []).filter((x) => x.result === "passed").map((x) => x.targetId));
    for (const id of [...acceptance, ...invariants])
        if (!targets.has(id))
            throw new WorkflowError(`测试证据没有覆盖 ${id}`);
    const levels = new Set(tests.levels.filter((x) => x.result === "passed").map((x) => x.level));
    const required = ["domain", "application", "integration", "architecture", "e2e"];
    if (state.workflowType === "refactor-system")
        required.push("characterization");
    for (const level of required)
        if (!levels.has(level))
            throw new WorkflowError(`缺少通过的必需测试层级：${level}`);
    if (tests.e2e.result !== "passed" || tests.e2e.mockPolicy !== "no-business-path-mocks")
        throw new WorkflowError("E2E 必须通过真实业务链路且禁止业务路径 mock");
    for (const consumer of consumers)
        if (!(tests.e2e.realConsumerPaths ?? []).includes(consumer))
            throw new WorkflowError(`E2E 未覆盖真实 consumer：${consumer}`);
    if (state.workflowType === "refactor-system") {
        const compare = tests.behaviorComparison;
        if (!compare || compare.result !== "passed" || compare.baselineSha !== evidence.baselineSha || compare.implementationSha !== evidence.implementationSha || compare.differences?.length)
            throw new WorkflowError("重构必须提供前后行为一致且无未批准差异的比较证据");
    }
}
async function architectureConformance(state, model, productionPaths, revision) {
    const modules = model.data.architecture.modules;
    const checked = new Set();
    const edges = new Set();
    for (const module of modules)
        for (const root of module.sourceRoots)
            for (const file of await walkFiles(path.join(state.projectRoot, root)))
                checked.add(`${root}/${file}`.replace(/\\/g, "/"));
    for (const value of productionPaths)
        checked.add(value);
    for (const source of checked) {
        const owner = locate(modules, source);
        if (!owner)
            throw new WorkflowError(`生产源码未落入任何批准模块/层：${source}`);
        const content = await readFile(path.join(state.projectRoot, source), "utf8");
        for (const imported of imports(content)) {
            for (const forbidden of owner.layer.forbiddenImportPrefixes ?? [])
                if (imported.startsWith(forbidden))
                    throw new WorkflowError(`${source} 违反禁止依赖：${imported}`);
            const target = modules.find((module) => (module.namespacePrefixes ?? []).some((prefix) => imported.startsWith(prefix)));
            if (target && target.id !== owner.module.id) {
                if (!(target.publishedLanguagePrefixes ?? []).some((prefix) => imported.startsWith(prefix)))
                    throw new WorkflowError(`${source} 跨模块引用了非 Published Language：${imported}`);
                edges.add(`${owner.module.id}->${target.id}`);
            }
        }
    }
    detectEdgeCycle([...edges]);
    return { modelContractSha256: model.sha256, result: "passed", revision, checkedPaths: [...checked].sort(), moduleEdges: [...edges].sort(), legacyExceptions: 0 };
}
function locate(modules, source) {
    for (const module of modules)
        for (const layer of module.layers)
            if ((layer.pathPrefixes ?? []).some((prefix) => inside(source, prefix)))
                return { module, layer };
    return null;
}
function imports(content) {
    const values = [];
    for (const match of content.matchAll(/(?:import\s+(?:[^"']+?\s+from\s+)?|require\(|from\s+|using\s+)(?:["']?)([\w@./-]+)/g))
        values.push(match[1]);
    return values;
}
async function git(root, args) { try {
    return (await run("git", ["-C", root, ...args], root)).stdout;
}
catch (error) {
    throw new WorkflowError(`Git evidence validation failed: ${error.message}`);
} }
function detectCycle(nodes) {
    const graph = new Map(nodes.map((node) => [node.id, node.dependsOn ?? []]));
    const visiting = new Set(), done = new Set();
    const visit = (id) => { if (visiting.has(id))
        throw new WorkflowError(`roadmap 存在循环依赖：${id}`); if (done.has(id))
        return; visiting.add(id); for (const dep of graph.get(id) ?? [])
        visit(dep); visiting.delete(id); done.add(id); };
    for (const id of graph.keys())
        visit(id);
}
function detectEdgeCycle(edges) {
    const nodes = [...new Set(edges.flatMap((edge) => edge.split("->")))];
    detectCycle(nodes.map((id) => ({ id, dependsOn: edges.filter((edge) => edge.startsWith(`${id}->`)).map((edge) => edge.split("->")[1]) })));
}
//# sourceMappingURL=conformance.js.map