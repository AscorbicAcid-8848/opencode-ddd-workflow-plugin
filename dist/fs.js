import { execFile } from "node:child_process";
import { access, mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
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
export async function readJson(file) {
    return JSON.parse(await readFile(file, "utf8"));
}
export async function writeJson(file, value) {
    await atomicText(file, `${JSON.stringify(value, null, 2)}\n`);
}
export async function sha256Of(file) {
    const { createHash } = await import("node:crypto");
    return createHash("sha256").update(await readFile(file)).digest("hex");
}
export async function run(executable, args, cwd, env = process.env) {
    try {
        const result = await execFileAsync(executable, args, {
            cwd, env, windowsHide: true, encoding: "utf8", maxBuffer: 16 * 1024 * 1024,
        });
        return { stdout: result.stdout.trim(), stderr: result.stderr.trim() };
    }
    catch (cause) {
        const error = cause;
        throw new Error(error.stderr?.trim() || error.stdout?.trim() || error.message);
    }
}
export async function walkFiles(root, rel = "") {
    if (!await exists(root))
        return [];
    const out = [];
    for (const entry of await readdir(path.join(root, rel), { withFileTypes: true })) {
        const child = path.join(rel, entry.name);
        if (entry.isDirectory())
            out.push(...await walkFiles(root, child));
        else if (entry.isFile())
            out.push(child.split(path.sep).join("/"));
    }
    return out.sort();
}
export const rel = (root, file) => path.relative(root, file).split(path.sep).join("/");
//# sourceMappingURL=fs.js.map