import { createRequire } from "node:module"
import { readFile, mkdir, readdir } from "node:fs/promises"
import path from "node:path"
import { exists, run, writeJson, atomicText } from "./fs.js"
import { activeChange } from "./state.js"
import type { OpenSpecArtifact, WorkflowState } from "./types.js"
import { WorkflowError } from "./types.js"

const require = createRequire(import.meta.url)

function packageRoot(name: string): string {
  let current = path.dirname(require.resolve(name))
  while (path.dirname(current) !== current) {
    try {
      const manifest = require(path.join(current, "package.json"))
      if (manifest.name === name) return current
    } catch { /* keep walking */ }
    current = path.dirname(current)
  }
  throw new WorkflowError(`Cannot locate package root for ${name}`)
}

export function openSpecRuntime() {
  const root = packageRoot("@fission-ai/openspec")
  const manifest = require(path.join(root, "package.json"))
  const bin = typeof manifest.bin === "string" ? manifest.bin : manifest.bin?.openspec
  if (!bin) throw new WorkflowError("Bundled OpenSpec package does not expose openspec")
  return { root, script: path.join(root, bin), version: manifest.version as string }
}

function isNodeExecutable(exe?: string): boolean {
  return Boolean(exe && /^node(?:\.exe)?$/i.test(path.basename(exe)))
}

export function openSpecNodeExecutable(
  execPath = process.execPath,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const explicit = env.DDD_NODE_EXECUTABLE?.trim()
  if (explicit) return explicit
  if (isNodeExecutable(execPath)) return execPath
  if (isNodeExecutable(env.npm_node_execpath)) return env.npm_node_execpath!
  if (isNodeExecutable(env.NODE)) return env.NODE!
  return "node"
}

export async function runOpenSpec(projectRoot: string, args: string[]): Promise<string> {
  const runtime = openSpecRuntime()
  const node = openSpecNodeExecutable()
  try {
    return (await run(node, [runtime.script, ...args], projectRoot, { ...process.env, OPENSPEC_TELEMETRY: "0" })).stdout
  } catch (error) {
    throw new WorkflowError(`OpenSpec CLI failed (node=${node}): ${(error as Error).message}`)
  }
}

export async function runOpenSpecJson(projectRoot: string, args: string[]): Promise<any> {
  const out = await runOpenSpec(projectRoot, args)
  try { return JSON.parse(out) } catch {
    throw new WorkflowError(`OpenSpec CLI did not return JSON for: ${args.join(" ")}`)
  }
}

export async function ensureProject(projectRoot: string): Promise<string> {
  const root = path.join(projectRoot, "openspec")
  await mkdir(path.join(root, "specs"), { recursive: true })
  await mkdir(path.join(root, "changes", "archive"), { recursive: true })
  const config = path.join(root, "config.yaml")
  if (!await exists(config)) {
    await atomicText(config, "schema: spec-driven\n\ncontext: |\n  每个 DDD workflow-id 对应一个 OpenSpec change；六份 DDD 里程碑、工程计划和证据由同一个 change 托管。\n")
  }
  return root
}

export async function newChange(projectRoot: string, id: string, title: string, request: string): Promise<string> {
  await ensureProject(projectRoot)
  const change = activeChange(projectRoot, id)
  await mkdir(change, { recursive: true })
  const yaml = path.join(change, ".openspec.yaml")
  if (!await exists(yaml)) {
    await atomicText(yaml, `schema: spec-driven\ncreated: ${new Date().toISOString().slice(0, 10)}\n`)
  }
  const readme = path.join(change, "README.md")
  if (!await exists(readme)) {
    await atomicText(readme, `# ${title}\n\n${request}\n\n本 change 托管一次 DDD 工作流的六份里程碑与交付证据。\n`)
  }
  return change
}

export async function writeLink(root: string, state: WorkflowState, status: string, changeId: string, archiveTarget?: string): Promise<void> {
  const link = {
    schema: "ddd-openspec-link/v2", changeId, workflowId: state.workflowId,
    status, archivedAt: state.openSpec?.archivedAt, archiveTarget, updatedAt: new Date().toISOString(),
  }
  await writeJson(path.join(root, ".ddd", "openspec-link.json"), link)
}

export async function verifyArchive(projectRoot: string, id: string): Promise<{ archived: boolean; target?: string; error?: string }> {
  try {
    const change = activeChange(projectRoot, id)
    const archive = path.join(projectRoot, "openspec", "changes", "archive")
    const archived = (await readdir(archive, { withFileTypes: true }).catch(() => []))
      .filter((entry) => entry.isDirectory() && entry.name.endsWith(`-${id}`))
    if (!await exists(change) && archived.length) {
      return { archived: true, target: path.join(archive, archived[0].name) }
    }
    if (!await exists(change)) return { archived: false, error: `OpenSpec active change not found: ${id}` }
    await runOpenSpec(projectRoot, ["validate", id, "--strict"])
    const out = await runOpenSpec(projectRoot, ["archive", id, "--yes", "--json"])
    const after = (await readdir(archive, { withFileTypes: true }).catch(() => []))
      .filter((entry) => entry.isDirectory() && entry.name.endsWith(`-${id}`))
    if (!after.length || await exists(change)) {
      return { archived: false, error: `OpenSpec archive command returned without moving change: ${out}` }
    }
    return { archived: true, target: path.join(archive, after[0].name), error: out }
  } catch (error) {
    return { archived: false, error: (error as Error).message }
  }
}

export interface OpenSpecActionInput {
  projectRoot: string
  artifact: OpenSpecArtifact
  state: WorkflowState
  content?: string
  capability?: string
  skipSpecs?: boolean
}

async function ensureChangeMetadata(projectRoot: string, id: string, skipSpecs?: boolean): Promise<void> {
  const file = path.join(activeChange(projectRoot, id), ".openspec.yaml")
  let created = new Date().toISOString().slice(0, 10)
  if (await exists(file)) {
    const current = await readFile(file, "utf8")
    created = current.match(/^created:\s*(\d{4}-\d{2}-\d{2})\s*$/mu)?.[1] ?? created
  }
  await atomicText(file, `schema: spec-driven\ncreated: ${created}\n${skipSpecs ? "skip_specs: true\n" : ""}`)
}

async function specFiles(change: string): Promise<string[]> {
  const root = path.join(change, "specs")
  if (!await exists(root)) return []
  const entries = await readdir(root, { recursive: true, withFileTypes: true })
  return entries.filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => path.join(entry.parentPath, entry.name))
}

export async function planningArtifacts(projectRoot: string, id: string): Promise<{ complete: boolean; missing: string[]; files: string[] }> {
  const change = activeChange(projectRoot, id)
  const files = ["proposal.md", "design.md", "tasks.md"]
  const missing: string[] = []
  for (const file of files) if (!await exists(path.join(change, file))) missing.push(file)
  const metadata = await readFile(path.join(change, ".openspec.yaml"), "utf8").catch(() => "")
  const skipSpecs = /^skip_specs:\s*true\s*$/mu.test(metadata)
  const deltas = await specFiles(change)
  if (!skipSpecs && deltas.length === 0) missing.push("specs/<capability>/spec.md")
  return { complete: missing.length === 0, missing, files: [...files.filter((file) => !missing.includes(file)), ...deltas] }
}

export async function openSpecAction(input: OpenSpecActionInput): Promise<{ status: string; detail: string }> {
  const { projectRoot, artifact, state, content, capability, skipSpecs } = input
  const id = state.workflowId
  const change = activeChange(projectRoot, id)
  await ensureChangeMetadata(projectRoot, id, skipSpecs)
  if (content !== undefined || skipSpecs !== undefined) {
    if (artifact === "apply") throw new WorkflowError("apply 只用于严格校验，不能写入内容。")
    if (skipSpecs) {
      if (artifact !== "specs" || state.workflowType !== "refactor-system") {
        throw new WorkflowError("skipSpecs 只允许无行为变化的 refactor-system 在 specs 工件上使用。")
      }
      return { status: "written", detail: path.join(change, ".openspec.yaml") }
    }
    if (!content?.trim()) throw new WorkflowError(`${artifact} 工件内容不能为空。`)
    let file: string
    if (artifact === "specs") {
      if (!capability || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(capability)) {
        throw new WorkflowError("specs 工件必须提供 kebab-case capability。")
      }
      if (!/^##\s+(?:ADDED|MODIFIED|REMOVED|RENAMED) Requirements\s*$/mu.test(content)
        || !/^####\s+Scenario:\s+\S+/mu.test(content)) {
        throw new WorkflowError("spec delta 必须包含合法的 Requirements delta 标题和至少一个 #### Scenario。")
      }
      file = path.join(change, "specs", capability, "spec.md")
      await mkdir(path.dirname(file), { recursive: true })
    } else {
      file = path.join(change, `${artifact}.md`)
    }
    if (artifact === "tasks" && !/^- \[[ xX]\]\s+\d+\.\d+\s+/mu.test(content)) {
      throw new WorkflowError("tasks.md 必须包含 OpenSpec 可追踪的 '- [ ] X.Y ...' 任务。")
    }
    await atomicText(file, `${content.trim()}\n`)
    return { status: "written", detail: file }
  }
  if (artifact === "apply") {
    try {
      const out = await runOpenSpec(projectRoot, ["validate", id, "--strict"])
      return { status: "validated", detail: out }
    } catch (error) {
      return { status: "validation-failed", detail: (error as Error).message }
    }
  }
  if (artifact === "proposal" || artifact === "specs" || artifact === "design" || artifact === "tasks") {
    if (artifact === "specs") {
      const files = await specFiles(change)
      return { status: files.length ? "present" : "missing", detail: files.join("\n") || path.join(change, "specs", "<capability>", "spec.md") }
    }
    const file = path.join(change, `${artifact}.md`)
    return { status: await exists(file) ? "present" : "missing", detail: file }
  }
  if (artifact === "apply") return { status: "noop", detail: "apply handled above" }
  return { status: "unknown", detail: artifact }
}
