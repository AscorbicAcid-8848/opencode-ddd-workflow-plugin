import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { access, mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
const execFileAsync = promisify(execFile);
export const now = () => new Date().toISOString().replace(/\.\d{3}Z$/, "+00:00");
export async function exists(file) {
    try {
        await access(file);
        return true;
    }
    catch {
        return false;
    }
}
export async function atomicText(file, content) {
    await mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.tmp`;
    await writeFile(temporary, content.replace(/\r\n/g, "\n"), "utf8");
    await rename(temporary, file);
}
export async function atomicBytes(file, content) {
    await mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.tmp`;
    await writeFile(temporary, content);
    await rename(temporary, file);
}
export async function readJson(file) {
    return JSON.parse(await readFile(file, "utf8"));
}
export async function writeJson(file, value) {
    await atomicText(file, `${JSON.stringify(value, null, 2)}\n`);
}
export async function sha256(file) {
    return createHash("sha256").update(await readFile(file)).digest("hex");
}
export async function fileEvidence(file, relativeTo) {
    return {
        path: path.relative(relativeTo, file).split(path.sep).join("/"),
        sha256: await sha256(file),
        bytes: (await stat(file)).size,
    };
}
export async function walkFiles(root, relative = "") {
    if (!await exists(root))
        return [];
    const output = [];
    for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) {
        const child = path.join(relative, entry.name);
        if (entry.isDirectory())
            output.push(...await walkFiles(root, child));
        else if (entry.isFile())
            output.push(child.split(path.sep).join("/"));
    }
    return output.sort();
}
export async function snapshot(root) {
    const output = {};
    for (const relative of await walkFiles(root)) {
        if (relative.includes("/.ddd/workbench/") || relative.startsWith(".ddd/workbench/"))
            continue;
        const absolute = path.join(root, ...relative.split("/"));
        output[relative] = { sha256: await sha256(absolute), bytes: (await stat(absolute)).size };
    }
    return output;
}
export async function run(executable, args, cwd, env = process.env) {
    try {
        const result = await execFileAsync(executable, args, {
            cwd,
            env,
            windowsHide: true,
            encoding: "utf8",
            maxBuffer: 16 * 1024 * 1024,
        });
        return { stdout: result.stdout.trim(), stderr: result.stderr.trim() };
    }
    catch (cause) {
        const error = cause;
        throw new Error(error.stderr?.trim() || error.stdout?.trim() || error.message);
    }
}
//# sourceMappingURL=fs.js.map