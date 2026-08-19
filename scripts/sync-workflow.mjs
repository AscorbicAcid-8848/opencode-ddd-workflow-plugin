import { createHash } from "node:crypto"
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const packageRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const repositoryRoot = path.dirname(packageRoot)
const sourceRoot = path.join(repositoryRoot, ".agents", "skills")
const targetRoot = path.join(packageRoot, "resources", "skills")
const manifestPath = path.join(packageRoot, "resources", "workflow-manifest.json")
const checkOnly = process.argv.includes("--check")
const ignored = new Set(["__pycache__", ".pytest_cache", ".DS_Store", ".git"])

function ignoredName(name) {
  return ignored.has(name) || /^tmp[a-z0-9_]+$/i.test(name) || name.endsWith(".pyc")
}

async function skillNames() {
  return (await readdir(sourceRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("ddd-"))
    .map((entry) => entry.name)
    .sort()
}

async function filesUnder(root, relative = "") {
  const directory = path.join(root, relative)
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (ignoredName(entry.name)) continue
    const child = path.join(relative, entry.name)
    if (entry.isDirectory()) files.push(...await filesUnder(root, child))
    else if (entry.isFile()) files.push(child.split(path.sep).join("/"))
  }
  return files
}

async function manifestFor(root, skills) {
  const files = []
  for (const skill of skills) {
    for (const relative of await filesUnder(path.join(root, skill))) {
      const absolute = path.join(root, skill, ...relative.split("/"))
      const content = await readFile(absolute)
      files.push({
        path: `${skill}/${relative}`,
        bytes: (await stat(absolute)).size,
        sha256: createHash("sha256").update(content).digest("hex"),
      })
    }
  }
  return { schema: "ddd-opencode-workflow-bundle/v1", skills, files }
}

const skills = await skillNames()
const expected = await manifestFor(sourceRoot, skills)

if (checkOnly) {
  const actual = JSON.parse(await readFile(manifestPath, "utf8"))
  const bundled = await manifestFor(targetRoot, skills)
  if (JSON.stringify(actual) !== JSON.stringify(expected) || JSON.stringify(bundled) !== JSON.stringify(expected)) {
    throw new Error("Bundled workflow differs from .agents/skills; run npm run sync:workflow")
  }
  process.stdout.write(`workflow bundle is current (${skills.length} skills, ${expected.files.length} files)\n`)
} else {
  await rm(targetRoot, { recursive: true, force: true })
  await mkdir(targetRoot, { recursive: true })
  for (const skill of skills) {
    await cp(path.join(sourceRoot, skill), path.join(targetRoot, skill), {
      recursive: true,
      filter: (source) => !ignoredName(path.basename(source)),
    })
  }
  await mkdir(path.dirname(manifestPath), { recursive: true })
  await writeFile(manifestPath, `${JSON.stringify(expected, null, 2)}\n`, "utf8")
  process.stdout.write(`synced ${skills.length} skills and ${expected.files.length} files\n`)
}
