import { createRequire } from "node:module";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { atomicText, exists, now, readJson, run, writeJson } from "./fs.js";
import { activeChange, archiveCandidates, openSpecLinkPath, relative } from "./paths.js";
import { WorkflowError, WorkflowRuntimeError } from "./types.js";
const require = createRequire(import.meta.url);
const OPENSPEC_VERSION = "1.7.0";
function packageRoot(name) {
    let current = path.dirname(require.resolve(name));
    while (path.dirname(current) !== current) {
        try {
            const manifest = require(path.join(current, "package.json"));
            if (manifest.name === name)
                return current;
        }
        catch { /* keep walking */ }
        current = path.dirname(current);
    }
    throw new WorkflowError(`Cannot locate package root for ${name}`);
}
export function openSpecRuntime() {
    const root = packageRoot("@fission-ai/openspec");
    const manifest = require(path.join(root, "package.json"));
    const bin = typeof manifest.bin === "string" ? manifest.bin : manifest.bin?.openspec;
    if (!bin)
        throw new WorkflowError("Bundled OpenSpec package does not expose openspec");
    return { root, script: path.join(root, bin), version: manifest.version };
}
function isNodeExecutable(executable) {
    return Boolean(executable && /^node(?:\.exe)?$/i.test(path.basename(executable)));
}
/**
 * OpenCode plugins may run inside Node, Bun, or a standalone host executable.
 * OpenSpec 1.7 requires Node, so never assume process.execPath is Node.
 */
export function openSpecNodeExecutable(execPath = process.execPath, env = process.env) {
    const explicit = env.DDD_NODE_EXECUTABLE?.trim();
    if (explicit)
        return explicit;
    if (isNodeExecutable(execPath))
        return execPath;
    if (isNodeExecutable(env.npm_node_execpath))
        return env.npm_node_execpath;
    if (isNodeExecutable(env.NODE))
        return env.NODE;
    return "node";
}
export async function runOpenSpec(projectRoot, args) {
    const runtime = openSpecRuntime();
    const node = openSpecNodeExecutable();
    try {
        return (await run(node, [runtime.script, ...args], projectRoot, { ...process.env, OPENSPEC_TELEMETRY: "0" })).stdout;
    }
    catch (error) {
        throw new WorkflowRuntimeError("OPENSPEC_LAUNCH_FAILED", "openspec-cli", `无法用 Node 运行内置 OpenSpec CLI（node=${node}，host=${process.execPath}）：${error.message}`);
    }
}
export async function runOpenSpecJson(projectRoot, args) {
    const output = await runOpenSpec(projectRoot, args);
    try {
        return JSON.parse(output);
    }
    catch {
        throw new WorkflowRuntimeError("OPENSPEC_INVALID_JSON", "openspec-cli", `内置 OpenSpec CLI 没有返回有效 JSON：${args.join(" ")}；输出：${output}`);
    }
}
async function ensureProject(projectRoot) {
    const root = path.join(projectRoot, "openspec");
    await import("node:fs/promises").then(({ mkdir }) => Promise.all([
        mkdir(path.join(root, "specs"), { recursive: true }),
        mkdir(path.join(root, "changes", "archive"), { recursive: true }),
    ]));
    const config = path.join(root, "config.yaml");
    if (!await exists(config))
        await atomicText(config, "schema: spec-driven\n\ncontext: |\n  每个 DDD workflow-id 对应一个 OpenSpec change；六份 DDD 里程碑、工程计划和证据由同一个 change 托管。\n");
    return root;
}
async function writeTrace(root, state, status, change, archivedAt) {
    const trace = {
        schema: "ddd-openspec-link/v2", changeId: state.workflowId, workflowId: state.workflowId,
        workflowType: state.workflowType, storageMode: "openspec-change-owned",
        dddWorkflowPath: `${relative(state.projectRoot, root)}/README.md`, dddRoot: relative(state.projectRoot, root),
        status, createdAt: state.createdAt, updatedAt: now(),
    };
    if (archivedAt)
        trace.archivedAt = archivedAt;
    await writeJson(path.join(change, "ddd-workflow.json"), trace);
    const link = { ...trace, changePath: relative(state.projectRoot, change), historyIndex: "openspec/change-history.md", sourceOfTruth: "openspec/specs" };
    await writeJson(openSpecLinkPath(root), link);
    state.openSpec = link;
    await writeHistory(state.projectRoot);
    return link;
}
export async function ensureChange(root, state, request) {
    await ensureProject(state.projectRoot);
    const change = activeChange(state.projectRoot, state.workflowId);
    const archives = await archiveCandidates(state.projectRoot, state.workflowId);
    if (archives.length)
        throw new WorkflowError(`OpenSpec change 已归档，不能复用 workflow-id：${archives.at(-1)}`);
    let creation = null;
    if (!await exists(change))
        creation = await runOpenSpecJson(state.projectRoot, ["new", "change", state.workflowId, "--schema", "spec-driven", "--json"]);
    if (!await exists(path.join(change, ".openspec.yaml")))
        throw new WorkflowError(`OpenSpec new change 未生成标准骨架：${change}`);
    const readme = path.join(change, "README.md");
    if (!await exists(readme))
        await atomicText(readme, `# ${state.title}\n\n- DDD 里程碑：\`${relative(state.projectRoot, root)}/README.md\`\n- 原始请求：${request.trim()}\n- 状态：等待 DDD 战术设计批准后生成 OpenSpec planning artifacts。\n`);
    const link = await writeTrace(root, state, "reserved", change);
    if (creation)
        link.creation = { engine: `@fission-ai/openspec@${OPENSPEC_VERSION}`, action: "new change", schema: creation.schemaName ?? "spec-driven" };
    state.openSpec = link;
    await writeJson(openSpecLinkPath(root), link);
    return link;
}
export async function loadLink(root) {
    if (!await exists(openSpecLinkPath(root)))
        throw new WorkflowError("当前 DDD 工作流缺少 OpenSpec 双向链接");
    const link = await readJson(openSpecLinkPath(root));
    if (link.schema !== "ddd-openspec-link/v2")
        throw new WorkflowError(`Unsupported OpenSpec link schema: ${link.schema}`);
    return link;
}
export async function updateStatus(root, state, status) {
    const link = await loadLink(root);
    return writeTrace(root, state, status, path.join(state.projectRoot, link.changePath));
}
export async function status(state) {
    const value = await runOpenSpecJson(state.projectRoot, ["status", "--change", state.workflowId, "--json"]);
    if (value.changeName !== state.workflowId || value.schemaName !== "spec-driven")
        throw new WorkflowError("OpenSpec status 与当前 DDD change 不一致");
    return value;
}
export async function action(root, state, artifact) {
    const current = await status(state);
    const instructions = await runOpenSpecJson(state.projectRoot, ["instructions", artifact, "--change", state.workflowId, "--json"]);
    if (instructions.changeName !== state.workflowId || instructions.artifactId !== artifact)
        throw new WorkflowError("OpenSpec instructions 与当前请求不一致");
    const mapping = {
        proposal: ["I-strategic-eventstorm.md", "II-strategic-design.md"],
        specs: ["II-strategic-design.md", "IV-tactical-design.md"],
        design: ["II-strategic-design.md", "IV-tactical-design.md", ".ddd/delivery/model-contract.json"],
        tasks: ["V-delivery-plan.md", ".ddd/delivery/roadmap.json", ".ddd/delivery/model-contract.json"],
        apply: ["V-delivery-plan.md", ".ddd/delivery/roadmap.json", ".ddd/delivery/model-contract.json"],
    };
    const dddInputs = [];
    for (const file of mapping[artifact])
        if (await exists(path.join(root, file)))
            dddInputs.push(file);
    return {
        schema: "ddd-openspec-action/v1", workflowId: state.workflowId, workflowType: state.workflowType,
        artifact, status: current, instructions, dddInputs,
        authority: {
            openSpec: "change scaffold, artifact graph, templates, task state, validation and archive",
            ddd: "domain decisions, six human milestones, model contract and implementation evidence",
            bridge: "translate only approved DDD decisions; never redesign them in OpenSpec artifacts",
        },
    };
}
export async function validateStrict(state) {
    const current = await status(state);
    const output = await runOpenSpec(state.projectRoot, ["validate", state.workflowId, "--type", "change", "--strict", "--json", "--no-interactive"]);
    let validation;
    try {
        validation = JSON.parse(output);
    }
    catch {
        validation = { status: "passed", output };
    }
    return { status: current, validation };
}
export async function validatePlanning(root, state, phase) {
    const link = await loadLink(root);
    const change = path.join(state.projectRoot, link.changePath);
    const files = { proposal: path.join(change, "proposal.md"), design: path.join(change, "design.md"), tasks: path.join(change, "tasks.md") };
    const missing = [];
    for (const [name, file] of Object.entries(files))
        if (!await exists(file))
            missing.push(name);
    const specsRoot = path.join(change, "specs");
    const specs = [];
    if (await exists(specsRoot))
        for (const entry of await readdir(specsRoot, { withFileTypes: true })) {
            const file = path.join(specsRoot, entry.name, "spec.md");
            if (entry.isDirectory() && await exists(file))
                specs.push(file);
        }
    const metadata = await readFile(path.join(change, ".openspec.yaml"), "utf8");
    const skipSpecs = /^skip_specs\s*:\s*true\s*$/im.test(metadata);
    if (!skipSpecs && !specs.length)
        missing.push("specs/<capability>/spec.md");
    if (skipSpecs && state.workflowType !== "refactor-system")
        throw new WorkflowError("只有不改变外部行为的重构可以 skip_specs");
    if (missing.length)
        throw new WorkflowError(`OpenSpec planning artifacts 不完整：${missing.join("、")}`);
    const proposal = await readFile(files.proposal, "utf8");
    for (const heading of ["## Why", "## What Changes", "## Capabilities", "## Impact"])
        if (!proposal.includes(heading))
            throw new WorkflowError(`OpenSpec proposal 缺少：${heading}`);
    const tasks = await readFile(files.tasks, "utf8");
    const design = await readFile(files.design, "utf8");
    for (const heading of ["## Context", "## Goals / Non-Goals", "## Decisions", "## Risks / Trade-offs"])
        if (!design.includes(heading))
            throw new WorkflowError(`OpenSpec design 缺少：${heading}`);
    let requirements = 0, scenarios = 0;
    for (const file of specs) {
        const content = await readFile(file, "utf8");
        if (!/^## (?:ADDED|MODIFIED|REMOVED|RENAMED) Requirements\s*$/m.test(content))
            throw new WorkflowError(`OpenSpec delta spec 缺少操作区：${file}`);
        const currentRequirements = [...content.matchAll(/^### Requirement:\s*.+$/gm)].length;
        const currentScenarios = [...content.matchAll(/^#### Scenario:\s*.+$/gm)].length;
        if (!currentRequirements || currentScenarios < currentRequirements || !/\b(?:MUST|SHALL)\b/.test(content) || !/\*\*WHEN\*\*/.test(content) || !/\*\*THEN\*\*/.test(content))
            throw new WorkflowError(`OpenSpec Requirement/Scenario 合同不完整：${file}`);
        requirements += currentRequirements;
        scenarios += currentScenarios;
    }
    const checked = [...tasks.matchAll(/^- \[[xX]\] \d+\.\d+\s+.+$/gm)].length;
    const unchecked = [...tasks.matchAll(/^- \[ \] \d+\.\d+\s+.+$/gm)].length;
    if (!checked && !unchecked)
        throw new WorkflowError("OpenSpec tasks.md 没有可追踪任务");
    if (phase === "plan" && !unchecked)
        throw new WorkflowError("进入 Coding 前应有待实现任务");
    if (phase === "implementation" && !checked)
        throw new WorkflowError("实现检查点要求至少完成一个任务");
    if (phase === "archive" && unchecked)
        throw new WorkflowError(`OpenSpec 仍有 ${unchecked} 个未完成任务`);
    return { changeId: state.workflowId, phase, requirements, scenarios, tasksCompleted: checked, tasksRemaining: unchecked, skipSpecs };
}
export async function archive(root, state) {
    const existingArchives = await archiveCandidates(state.projectRoot, state.workflowId);
    if (!await exists(activeChange(state.projectRoot, state.workflowId)) && existingArchives.length) {
        const archived = existingArchives.at(-1);
        const archivedRoot = path.join(archived, "ddd");
        if (!await exists(archivedRoot))
            throw new WorkflowError("OpenSpec 已移动 change，但归档中缺少 DDD 包");
        state.artifactRoot = archivedRoot;
        state.status = "complete";
        state.updatedAt = now();
        state.openSpec = await writeTrace(archivedRoot, state, "archived", archived, now());
        return archivedRoot;
    }
    await validatePlanning(root, state, "archive");
    const strict = await validateStrict(state);
    await runOpenSpecJson(state.projectRoot, ["archive", state.workflowId, "--yes", "--json"]);
    const candidates = await archiveCandidates(state.projectRoot, state.workflowId);
    if (await exists(activeChange(state.projectRoot, state.workflowId)) || !candidates.length)
        throw new WorkflowError("OpenSpec archive 后置条件失败");
    const archived = candidates.at(-1);
    const archivedRoot = path.join(archived, "ddd");
    state.artifactRoot = archivedRoot;
    state.status = "complete";
    state.updatedAt = now();
    state.openSpec = await writeTrace(archivedRoot, state, "archived", archived, now());
    state.openSpec.validation = strict;
    return archivedRoot;
}
async function writeHistory(projectRoot) {
    const openSpec = await ensureProject(projectRoot);
    const changes = path.join(openSpec, "changes");
    const rows = [];
    for (const item of await readdir(changes, { withFileTypes: true })) {
        if (!item.isDirectory() || item.name === "archive")
            continue;
        const traceFile = path.join(changes, item.name, "ddd-workflow.json");
        const trace = await exists(traceFile) ? await readJson(traceFile) : {};
        rows.push(`| \`${item.name}\` | ${trace.status ?? "活动"} | [OpenSpec](changes/${item.name}/) | ${trace.dddWorkflowPath ? `[DDD](${trace.dddWorkflowPath})` : "-"} | ${trace.workflowType ?? "-"} |`);
    }
    const archiveRoot = path.join(changes, "archive");
    for (const item of await readdir(archiveRoot, { withFileTypes: true })) {
        if (!item.isDirectory())
            continue;
        const traceFile = path.join(archiveRoot, item.name, "ddd-workflow.json");
        const trace = await exists(traceFile) ? await readJson(traceFile) : {};
        rows.push(`| \`${trace.changeId ?? item.name}\` | 已归档 | [OpenSpec](changes/archive/${item.name}/) | ${trace.dddWorkflowPath ? `[DDD](${trace.dddWorkflowPath})` : "-"} | ${trace.workflowType ?? "-"} |`);
    }
    if (!rows.length)
        rows.push("| - | 暂无 change | - | - | - |");
    await atomicText(path.join(openSpec, "change-history.md"), `# OpenSpec Change 历史\n\n| Change | 状态 | OpenSpec 工件 | DDD 工作流 | 类型 |\n|---|---|---|---|---|\n${rows.join("\n")}\n`);
}
//# sourceMappingURL=openspec.js.map