import { documents } from "./catalog.js"
import { atomicText } from "./fs.js"
import path from "node:path"
import type { WorkflowProfile } from "./types.js"

export interface DocSection { heading: string; subsections: string[] }

const OVERVIEW_HEADINGS = ["一页结论", "本次请您确认"]
const REVIEW_HEADINGS = ["业务验收记录"]

export function overviewSubsections(): Record<string, string[]> {
  return {
    "一页结论": ["当前结论", "最新业务增量", "当前状态", "是否需要人工决策"],
    "本次请您确认": ["验收清单", "未决问题", "AI 推荐意见"],
  }
}

export async function sectionsFor(milestoneKey: string): Promise<DocSection[]> {
  const catalog = await documents()
  const doc = catalog.documents?.[milestoneKey]
  if (!doc) return []
  return doc.sections as DocSection[]
}

export function documentFileName(profile: WorkflowProfile, document: string): string {
  return profile.documents[document] ?? `${document}.md`
}

export function documentPath(root: string, profile: WorkflowProfile, document: string): string {
  return path.join(root, documentFileName(profile, document))
}

export async function generateSkeleton(profile: WorkflowProfile, milestoneKey: string, title: string): Promise<string> {
  const sections = await sectionsFor(milestoneKey)
  const ov = overviewSubsections()
  const lines: string[] = [`# ${title}`, ""]
  for (const h of OVERVIEW_HEADINGS) {
    lines.push(`## ${h}`)
    for (const sub of ov[h] ?? []) lines.push(`### ${sub}`, "", "> _待填写_", "")
    lines.push("")
  }
  for (const section of sections) {
    lines.push(`## ${section.heading}`)
    for (const sub of section.subsections) lines.push(`### ${sub}`, "", "> _待填写_", "")
    lines.push("")
  }
  for (const h of REVIEW_HEADINGS) {
    lines.push(`## ${h}`, "", "> _待填写_", "")
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n") + "\n"
}

export async function ensureSkeleton(root: string, profile: WorkflowProfile, milestoneKey: string): Promise<string> {
  const file = documentPath(root, profile, milestoneKey)
  const title = profile.documentTitles?.[milestoneKey] ?? milestoneKey
  const { exists } = await import("./fs.js")
  if (!await exists(file)) await atomicText(file, await generateSkeleton(profile, milestoneKey, title))
  return file
}

export async function publishSections(
  root: string,
  profile: WorkflowProfile,
  milestoneKey: string,
  sections: Record<string, string>,
): Promise<string> {
  const file = await ensureSkeleton(root, profile, milestoneKey)
  const { readFile } = await import("node:fs/promises")
  let body = await readFile(file, "utf8")
  for (const [heading, content] of Object.entries(sections)) {
    body = replaceSection(body, heading, content)
  }
  await atomicText(file, body)
  return file
}

function replaceSection(body: string, heading: string, content: string): string {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const re = new RegExp(`(##\\s+${escaped}\\s*\\n)([\\s\\S]*?)(?=\\n##\\s|$)`, "u")
  const replacement = `$1\n${content.trim()}\n`
  if (re.test(body)) return body.replace(re, replacement)
  return `${body.trimEnd()}\n\n## ${heading}\n\n${content.trim()}\n`
}
