import path from "node:path"
import { createHash } from "node:crypto"
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises"
import { exists } from "./fs.js"

const sourceRoots = ["src", "app", "apps", "packages", "services"]
const extensions = new Set([".java", ".kt", ".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".cs", ".xml", ".yaml", ".yml", ".properties"])
const ignored = new Set([".git", "node_modules", "target", "build", "dist", ".idea", ".gradle"])
const conventionFiles = [
  "README.md", "README.MD", "readme.md", "package.json", "pom.xml",
  "build.gradle", "build.gradle.kts", "settings.gradle", "pyproject.toml", "go.mod",
]
const conventionPattern = /(?:必须|不得|禁止|应当|需要保持|现有行为|兼容|持久化|存储|身份|认证|测试|\bmust\b|\bmust not\b|\brequired\b|\bshall\b|compatib|persist|storage|auth|test)/iu
const mandatoryPattern = /(?:必须|不得|禁止|应当|需要保持|现有行为[^。\n]{0,20}保持|\bmust\b|\bmust not\b|\brequired\b|\bshall\b)/iu

async function walk(root: string, relative: string, output: string[], limit: number): Promise<void> {
  if (output.length >= limit) return
  const absolute = path.join(root, relative)
  if (!await exists(absolute)) return
  for (const entry of await readdir(absolute, { withFileTypes: true })) {
    if (output.length >= limit || ignored.has(entry.name)) continue
    const child = path.join(relative, entry.name)
    if (entry.isDirectory()) await walk(root, child, output, limit)
    else if (extensions.has(path.extname(entry.name).toLowerCase())) output.push(child)
  }
}

async function names(root: string): Promise<string[]> {
  if (!await exists(root)) return []
  return (await readdir(root, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()
}

async function projectConventionEvidence(root: string): Promise<Array<{ file: string; excerpts: Array<{ ref: string; text: string; mandatory: boolean }> }>> {
  const result: Array<{ file: string; excerpts: Array<{ ref: string; text: string; mandatory: boolean }> }> = []
  const seen = new Set<string>()
  for (const candidate of conventionFiles) {
    const file = candidate.replace(/\\/gu, "/")
    if (seen.has(file.toLocaleLowerCase())) continue
    const absolute = path.join(root, candidate)
    if (!await exists(absolute) || (await stat(absolute)).size > 160_000) continue
    seen.add(file.toLocaleLowerCase())
    const lines = (await readFile(absolute, "utf8").catch(() => "")).split(/\r?\n/u)
    const selected = lines.map((text, index) => ({ text: text.trim(), index }))
      .filter(({ text }) => text && conventionPattern.test(text)).slice(0, 10)
    const fallback = selected.length ? selected : lines.map((text, index) => ({ text: text.trim(), index }))
      .filter(({ text }) => text).slice(0, 4)
    if (!fallback.length) continue
    result.push({ file, excerpts: fallback.map(({ text, index }) => ({
      ref: `code:${file}#L${index + 1}-L${index + 1}`,
      text: `L${index + 1}: ${text}`,
      mandatory: mandatoryPattern.test(text),
    })) })
  }
  return result
}

export async function evidenceBundle(projectRoot: string, workflowId: string, rawTerms: unknown): Promise<Record<string, unknown>> {
  const terms = (Array.isArray(rawTerms) ? rawTerms : []).map(String).map((term) => term.trim()).filter(Boolean).slice(0, 6)
  if (terms.length < 2) throw new Error("evidence-bundle 需要 2-6 个稳定业务/代码关键词，例如 Shop、UserHolder、view、trail。")
  const searchTerms = [...new Set(terms.flatMap((term) => {
    const camelParts = term.match(/[A-Z]+(?=[A-Z][a-z]|\b)|[A-Z]?[a-z]+|\d+/gu) ?? []
    return [term, ...camelParts.filter((part) => part.length >= 4)]
  }).map((term) => term.toLocaleLowerCase()))].slice(0, 18)
  const files: string[] = []
  for (const root of sourceRoots) await walk(projectRoot, root, files, 500)
  const lowered = searchTerms
  const seenTerms = new Set<string>()
  const matches: Array<{ file: string; score: number; excerpts: Array<{ ref: string; text: string }> }> = []
  for (const file of files) {
    const absolute = path.join(projectRoot, file)
    if ((await stat(absolute)).size > 160_000) continue
    const content = await readFile(absolute, "utf8").catch(() => "")
    const contentLower = content.toLocaleLowerCase()
    for (const term of lowered) if (contentLower.includes(term)) seenTerms.add(term)
    const lines = content.split(/\r?\n/u)
    const fileLower = file.toLocaleLowerCase()
    let score = lowered.reduce((sum, term) => sum + (fileLower.includes(term) ? (term.length >= 6 ? 45 : 20) : 0), 0)
    const candidates: Array<{ index: number; score: number }> = []
    for (let index = 0; index < lines.length; index += 1) {
      const lower = lines[index].toLocaleLowerCase()
      const termHits = lowered.filter((term) => lower.includes(term)).length
      const codeAnchor = /(?:@(?:get|post|put|delete|request)mapping|\b(?:public|protected)\s+[^=;]+\(|\breturn\s+|\bclass\s+)/iu.test(lines[index])
      if (termHits === 0 && !codeAnchor) continue
      const lineScore = termHits * 4 + (codeAnchor ? 5 : 0) - (/^\s*import\s/u.test(lines[index]) ? 4 : 0)
      if (lineScore <= 0) continue
      candidates.push({ index, score: lineScore })
      score += termHits
    }
    const chosen: number[] = []
    for (const candidate of candidates.sort((a, b) => b.score - a.score || a.index - b.index)) {
      if (chosen.length >= 3) break
      if (chosen.some((index) => Math.abs(index - candidate.index) <= 2)) continue
      chosen.push(candidate.index)
    }
    const excerpts = chosen.sort((a, b) => a - b).map((index) => {
      // A three-line window routinely separated a load from the immediately
      // following branch outcome (for example `const shop = ...` on one line
      // and `shop_not_found` on the next). Five bounded lines preserve that
      // control-flow fact without reopening free repository exploration.
      const from = Math.max(0, index - 2)
      const to = Math.min(lines.length, index + 3)
      const fileRef = file.replace(/\\/gu, "/")
      return {
        ref: `code:${fileRef}#L${from + 1}-L${to}`,
        text: lines.slice(from, to).map((line, offset) => `L${from + offset + 1}: ${line.trim()}`).join("\n"),
      }
    })
    if (score > 0) matches.push({ file: file.replace(/\\/gu, "/"), score, excerpts })
  }
  matches.sort((a, b) => b.score - a.score || a.file.localeCompare(b.file))
  const topLevel = (await readdir(projectRoot, { withFileTypes: true })).map((entry) => entry.name).filter((name) => !ignored.has(name)).sort()
  const currentSpecs = await names(path.join(projectRoot, "openspec", "specs"))
  const priorChanges = (await names(path.join(projectRoot, "openspec", "changes"))).filter((name) => name !== "archive" && name !== workflowId)
  const conventions = await projectConventionEvidence(projectRoot)
  const mandatoryCompatibilityConstraints = conventions.flatMap(({ excerpts }) => excerpts)
    .filter(({ mandatory }) => mandatory).map(({ mandatory: _mandatory, ...item }) => item)
  const absentTerms = lowered.filter((term) => !seenTerms.has(term))
  const negativeSearchRef = `search:evidence-bundle:${createHash("sha256").update(`${workflowId}\0${files.length}\0${lowered.join("|")}`).digest("hex").slice(0, 12)}`
  const negativeSearchStatement = absentTerms.length
    ? `本次完整源码文件扫描未命中这些精确代码词：${absentTerms.map((term) => `\`${term}\``).join("、")}。`
    : ""
  const bundle = {
    schemaVersion: "ddd-evidence-bundle/v1", terms, expandedSearchTerms: searchTerms, repositoryShape: topLevel, sourceFileCount: files.length,
    matches: matches.slice(0, 8).map(({ file, excerpts }) => ({ file, excerpts })),
    projectConventionEvidence: conventions,
    mandatoryCompatibilityConstraints,
    openSpecIndex: { currentSpecs, priorChanges, citation: "search:openspec/specs-and-prior-changes" },
    negativeSearchEvidence: absentTerms.length ? {
      ref: negativeSearchRef,
      absentTerms,
      scope: sourceRoots,
      statement: negativeSearchStatement,
      rule: "该引用只证明 absentTerms 中的精确代码词在本次完整源码文件扫描中未命中；不得据此声称整个业务能力、模块或其他实体不存在。",
    } : null,
    citationRule: "事实的 evidence_refs 必须逐字复制 excerpt.ref（code:相对路径#Lx-Ly）；不得只写裸路径。使用负向搜索时，observation.statement 必须逐字复制 negativeSearchEvidence.statement，不得追加能力、模块或实体不存在的推论。mandatoryCompatibilityConstraints 必须逐项写为兼容性约束，后续设计不得降级为实施前可选核验。未出现的行为只写为 evidence-gap/open-question，不得在缺口中决定新增表、模型、接口或实现；不再扩大搜索。",
    requiredCoverage: ["事实、假设与待确认项", "工程约束与兼容性", "可执行验收约束", "现状代码证据索引", "验证基线", "OpenSpec历史战略基线"],
    responseBudget: { totalSectionChars: "900-1600", observations: "4-6" },
    nextAction: "依据本 bundle 直接调用 complete-stage；不要逐文件补读、不要先输出草稿或推理。",
  }
  // Keep one compact, deterministic snapshot for later design/coding stages.
  // This avoids asking the model to rediscover repository conventions while
  // keeping the stage card much smaller than replaying the complete evidence stage.
  const snapshot = {
    repositoryShape: topLevel,
    issuedCodeEvidence: [
      ...conventions.flatMap(({ excerpts }) => excerpts.map(({ ref, text }) => ({ ref, text }))),
      ...matches.flatMap(({ excerpts }) => excerpts.map(({ ref, text }) => ({ ref, text }))),
    ],
    codeEvidence: [
      ...mandatoryCompatibilityConstraints,
      ...matches.slice(0, 4).flatMap(({ excerpts }) => excerpts.slice(0, 1)).map(({ ref, text }) => ({ ref, text })),
    ].slice(0, 8),
    mandatoryCompatibilityConstraints,
    openSpecIndex: bundle.openSpecIndex,
    authorizedSearchEvidence: absentTerms.length ? [{ ref: negativeSearchRef, absentTerms, statement: negativeSearchStatement }] : [],
  }
  const workbench = path.join(projectRoot, "openspec", "changes", workflowId, "ddd", ".ddd", "workbench")
  await mkdir(workbench, { recursive: true })
  await writeFile(path.join(workbench, "evidence-snapshot.json"), `${JSON.stringify(snapshot, null, 2)}\n`, "utf8")
  return bundle
}
