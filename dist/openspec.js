import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { exists, run, writeJson, atomicText } from "./fs.js";
import { activeChange } from "./state.js";
import { WorkflowError } from "./types.js";
const require = createRequire(import.meta.url);
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
function isNodeExecutable(exe) {
    return Boolean(exe && /^node(?:\.exe)?$/i.test(path.basename(exe)));
}
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
        throw new WorkflowError(`OpenSpec CLI failed (node=${node}): ${error.message}`);
    }
}
export async function runOpenSpecJson(projectRoot, args) {
    const out = await runOpenSpec(projectRoot, args);
    try {
        return JSON.parse(out);
    }
    catch {
        throw new WorkflowError(`OpenSpec CLI did not return JSON for: ${args.join(" ")}`);
    }
}
export async function ensureProject(projectRoot) {
    const root = path.join(projectRoot, "openspec");
    await mkdir(path.join(root, "specs"), { recursive: true });
    await mkdir(path.join(root, "changes", "archive"), { recursive: true });
    const config = path.join(root, "config.yaml");
    if (!await exists(config)) {
        await atomicText(config, "schema: spec-driven\n\ncontext: |\n  每个 DDD workflow-id 对应一个 OpenSpec change；六份 DDD 里程碑、工程计划和证据由同一个 change 托管。\n");
    }
    return root;
}
export async function newChange(projectRoot, id, title, request) {
    await ensureProject(projectRoot);
    const change = activeChange(projectRoot, id);
    await mkdir(change, { recursive: true });
    const yaml = path.join(change, ".openspec.yaml");
    if (!await exists(yaml)) {
        await atomicText(yaml, `id: ${id}\ntitle: ${title}\nstatus: in-progress\n`);
    }
    const readme = path.join(change, "README.md");
    if (!await exists(readme)) {
        await atomicText(readme, `# ${title}\n\n${request}\n\n本 change 托管一次 DDD 工作流的六份里程碑与交付证据。\n`);
    }
    return change;
}
export async function writeLink(root, state, status, changeId, archivedAt) {
    const link = {
        schema: "ddd-openspec-link/v2", changeId, workflowId: state.workflowId,
        status, archivedAt, updatedAt: new Date().toISOString(),
    };
    await writeJson(path.join(root, ".ddd", "openspec-link.json"), link);
}
export async function verifyArchive(projectRoot, id) {
    try {
        const list = await runOpenSpecJson(projectRoot, ["list", "changes", "--json"]);
        const active = Array.isArray(list) ? list : list?.changes ?? [];
        if (!active.some((c) => c.id === id)) {
            const archive = path.join(projectRoot, "openspec", "changes", "archive");
            const candidate = (await import("node:fs/promises").then(({ readdir }) => readdir(archive, { withFileTypes: true }).catch(() => [])))
                .filter((d) => d.isDirectory() && d.name.endsWith(`-${id}`));
            if (candidate.length)
                return { archived: true, target: path.join(archive, candidate[0].name) };
        }
        const out = await runOpenSpec(projectRoot, ["archive", id, "--strict"]);
        return { archived: true, target: path.join(projectRoot, "openspec", "changes", "archive", `${new Date().toISOString().slice(0, 10)}-${id}`), error: out };
    }
    catch (error) {
        return { archived: false, error: error.message };
    }
}
export async function openSpecAction(input) {
    const { projectRoot, artifact, state } = input;
    const id = state.workflowId;
    if (artifact === "apply") {
        try {
            const out = await runOpenSpec(projectRoot, ["validate", id, "--strict"]);
            return { status: "validated", detail: out };
        }
        catch (error) {
            return { status: "validation-failed", detail: error.message };
        }
    }
    if (artifact === "proposal" || artifact === "specs" || artifact === "design" || artifact === "tasks") {
        const change = activeChange(projectRoot, id);
        const file = path.join(change, `${artifact}.md`);
        const has = await exists(file);
        return { status: has ? "present" : "missing", detail: file };
    }
    if (artifact === "apply")
        return { status: "noop", detail: "apply handled above" };
    return { status: "unknown", detail: artifact };
}
//# sourceMappingURL=openspec.js.map