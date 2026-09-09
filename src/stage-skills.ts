import path from "node:path"
import { fileURLToPath } from "node:url"
import { readFile, realpath } from "node:fs/promises"
import { createHash } from "node:crypto"
import type { StageContract } from "./types.js"

const bundledSkills = fileURLToPath(new URL("../skills/", import.meta.url))

/** Load actual bundled instructions, not just skill names. No model-driven discovery required. */
export async function loadStageSkills(stage: StageContract, skillsRoot = bundledSkills) {
  if (stage.summaryStage) return []
  if (!stage.skills?.length) throw new Error(`DDD_STAGE_SKILL_MISSING: ${stage.id} 未配置专业 Skill`)
  const root = await realpath(skillsRoot)
  return Promise.all([...new Set(stage.skills)].map(async name => {
    if (!/^ddd-[a-z0-9-]+$/u.test(name)) throw new Error(`DDD_STAGE_SKILL_INVALID: ${name}`)
    const source = `skills/${name}/SKILL.md`
    try {
      const file = await realpath(path.join(root, name, "SKILL.md"))
      const relative = path.relative(root, file)
      if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Skill path escapes package")
      const instructions = await readFile(file, "utf8")
      if (!instructions.trim()) throw new Error("Skill is empty")
      return { name, source, sha256: createHash("sha256").update(instructions).digest("hex"), instructions }
    } catch (error) { throw new Error(`DDD_STAGE_SKILL_LOAD_FAILED: ${stage.id}/${name}: ${(error as Error).message}`) }
  }))
}
