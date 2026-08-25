import { execFile } from "node:child_process"
import { access, mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

export const now = () => new Date().toISOString().replace(/\.\d{3}Z$/, "+00:00")

export async function exists(file: string): Promise<boolean> {
  try { await access(file); return true } catch { return false }
}

export async function atomicText(file: string, content: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true })
  const temporary = `${file}.tmp`
  await writeFile(temporary, content.replace(/\r\n/g, "\n"), "utf8")
  await rename(temporary, file)
}

export async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(file, "utf8")) as T
}

export async function writeJson(file: string, value: unknown): Promise<void> {
  await atomicText(file, `${JSON.stringify(value, null, 2)}\n`)
}

export async function sha256Of(file: string): Promise<string> {
  const { createHash } = await import("node:crypto")
  return createHash("sha256").update(await readFile(file)).digest("hex")
}

export async function run(executable: string, args: string[], cwd: string, env = process.env) {
  try {
    const result = await execFileAsync(executable, args, {
      cwd, env, windowsHide: true, encoding: "utf8", maxBuffer: 16 * 1024 * 1024,
    })
    return { stdout: result.stdout.trim(), stderr: result.stderr.trim() }
  } catch (cause) {
    const error = cause as Error & { stdout?: string; stderr?: string }
    throw new Error(error.stderr?.trim() || error.stdout?.trim() || error.message)
  }
}

export async function walkFiles(root: string, rel = ""): Promise<string[]> {
  if (!await exists(root)) return []
  const out: string[] = []
  for (const entry of await readdir(path.join(root, rel), { withFileTypes: true })) {
    const child = path.join(rel, entry.name)
    if (entry.isDirectory()) out.push(...await walkFiles(root, child))
    else if (entry.isFile()) out.push(child.split(path.sep).join("/"))
  }
  return out.sort()
}

export const rel = (root: string, file: string) => path.relative(root, file).split(path.sep).join("/")
