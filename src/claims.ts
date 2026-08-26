import path from "node:path"
import { exists } from "./fs.js"
import type { StageClaim, StageClaimContract, ValidationFinding, WorkflowState } from "./types.js"

const evidenceBaselineContract: StageClaimContract = {
  required: true,
  allowedKinds: [
    "current-behavior-fact",
    "current-topology-fact",
    "current-spec-decision",
    "compatibility-constraint",
    "evidence-gap",
    "open-question",
  ],
  allowedMaturities: ["fact", "hypothesis"],
  evidenceRequiredKinds: [
    "current-behavior-fact",
    "current-topology-fact",
    "current-spec-decision",
  ],
  authorityPrefixes: ["user-input:", "code:", "schema:", "test:", "runtime:", "openspec:", "git:", "search:"],
  evidencePrefixes: ["code:", "schema:", "test:", "runtime:", "openspec:", "git:", "search:"],
  rules: [
    "每条事实、兼容约束和不存在性结论都必须成为 claim；正文必须逐字包含 claim.statement。",
    "fact 必须绑定可检查证据；证据不足只能使用 hypothesis、evidence-gap 或 open-question。",
    "本阶段不能提交目标设计、只读实现、Schema 选择、回滚方案、聚合、服务或持久化决策。",
    "声称不存在、只有或仅有某能力时，必须提供 search: 负向搜索范围，并标明 availability=absent。",
  ],
}

export function claimContractFor(scopeId?: string): StageClaimContract | null {
  return scopeId === "existing-system-baseline" ? structuredClone(evidenceBaselineContract) : null
}

const finding = (code: string, pathValue: string, message: string, suggestion?: string): ValidationFinding => ({
  code, path: pathValue, message, severity: "blocking", ...(suggestion ? { suggestion } : {}),
})

const nonEmpty = (value: unknown): value is string => typeof value === "string" && Boolean(value.trim())
const observationLevels = new Set(["declared", "wired", "statically-reachable", "runtime-observed", "test-verified"])
const availabilities = new Set(["operational", "partial", "stub", "absent", "unknown"])
const absencePattern = /(?:^|(?:当前|现有|既有|代码|系统|仓库|能力|实现|定义|证据|路径|接口|表))[^。；]{0,18}(?:不存在|未发现|尚无|没有|无专门)|(?:只有|仅有)[^。；]{0,30}(?:能力|实现|路径|接口|表|模块)/u
const currentFactKinds = new Set(["current-behavior-fact", "current-topology-fact"])

function normalizeReferencePath(reference: string): string | null {
  const match = /^(?:code|schema|openspec):([^#]+)(?:#.*)?$/u.exec(reference)
  return match?.[1]?.trim() || null
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate)
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
}

function sentences(text: string): string[] {
  return text.split(/(?<=[。！？；])|\r?\n/u).map((item) => item.trim()).filter(Boolean)
}

function hasUnnegatedDesignDecision(text: string): boolean {
  // Some providers insert whitespace inside CJK words when serialising tool
  // arguments (for example `回滚 即移除`). Scope checks must be semantic, not
  // dependent on that transport formatting.
  const compact = text.replace(/\s+/gu, "")
  // Restating the immutable demand as input is not a target-design decision.
  // The stage must be allowed to name what the user asked for while keeping
  // the solution and model deliberately undecided.
  if (/^(?:原始)?(?:请求|需求)(?:要求|提及|是|为|包含|明确)/u.test(compact)) return false
  if (/(?:假设|待确认|未证实|尚未证实|证据缺口|evidence-gap|open-question)/iu.test(compact)) return false
  if (/(?:不|未|无需|禁止|不得|不应|不能)(?:引入|新增|新建|拆分|迁移|采用|使用|改变|修改)/u.test(compact)) return false
  const patterns = [
    /(?:回滚即|回滚通过|回滚方案|回滚方式|移除(?:新)?入口)/u,
    /不(?:改动|修改|新增)(?:既有)?(?:表结构|字段|索引)/u,
    /(?:只读|纯查询)(?:能力|查询|接口|实现)?/u,
    /(?:采用|使用|引入|新增|新建|设计|实现|拆分|迁移)[^。；\n]{0,28}(?:数据表|表结构|建表|表字段|表名|字段|索引|数据库|缓存|Redis|消息|API|接口|DTO|微服务|模块|领域模型|数据模型|持久化模型|领域服务|应用服务|聚合|仓储)/iu,
  ]
  if (!patterns.some((pattern) => pattern.test(compact))) return false
  return !/(?:不在本阶段|本阶段不|尚未|未决定|不得|禁止|不应|不能|无需|不代表|不意味着|是否)[^。；\n]{0,60}$/u.test(compact)
}

function isProvenCurrentDecision(sentence: string, claims: StageClaim[]): boolean {
  const exactFact = claims.some((claim) =>
    currentFactKinds.has(claim.kind) && claim.maturity === "fact" && claim.evidenceRefs.length > 0
    && (sentence.includes(claim.statement) || claim.statement.includes(sentence)))
  if (exactFact) return true
  const citedCurrentFact = claims.some((claim) => {
    if (!currentFactKinds.has(claim.kind) || claim.maturity !== "fact") return false
    return claim.evidenceRefs.some((reference) => {
      const relative = normalizeReferencePath(reference)
      if (!relative) return false
      const normalized = relative.replace(/\\/gu, "/")
      return sentence.includes(normalized) || sentence.includes(path.basename(normalized))
    })
  })
  const futureDecision = /(?:将|应当|应该|须|必须|计划|拟|候选|建议|决定)(?:采用|使用|引入|新增|新建|设计|实现|拆分|迁移)/u.test(sentence.replace(/\s+/gu, ""))
  if (citedCurrentFact && !futureDecision) return true
  const currentMarker = /(?:当前|现有|既有|已经|运行中|生产中)/u.test(sentence)
  if (!currentMarker) return false
  return claims.some((claim) =>
    claim.maturity === "fact" && claim.evidenceRefs.length > 0
    && (sentence.includes(claim.statement) || claim.statement.includes(sentence)))
}

function isDeclaredUncertainty(sentence: string, claims: StageClaim[]): boolean {
  const disguisedDecision = /(?:需|须|必须|应当|应该|将|计划|决定)(?:采用|使用|引入|新增|新建|设计|实现|拆分|迁移)/u.test(sentence.replace(/\s+/gu, ""))
  if (disguisedDecision) return false
  return claims.some((claim) =>
    ["evidence-gap", "open-question"].includes(claim.kind)
    && (sentence.includes(claim.statement) || claim.statement.includes(sentence)))
}

export async function validateStageClaims(
  state: WorkflowState,
  scopeId: string | undefined,
  writableHeadings: string[],
  sections: Record<string, string>,
  rawClaims: unknown,
): Promise<ValidationFinding[]> {
  const contract = claimContractFor(scopeId)
  if (!contract) return []
  const findings: ValidationFinding[] = []
  if (!Array.isArray(rawClaims) || rawClaims.length === 0) {
    return [finding(
      "STAGE_CLAIMS_REQUIRED",
      "claims",
      "现状证据阶段必须提交类型化 claims，不能只提交自由 Markdown。",
      "按 stageCard.claimContract 提交事实、兼容约束、证据缺口或未决问题。",
    )]
  }

  const claims = rawClaims as StageClaim[]
  const ids = new Set<string>()
  const allowedKinds = new Set(contract.allowedKinds)
  const allowedMaturities = new Set(contract.allowedMaturities)
  const allowedSections = new Set(writableHeadings)

  for (let index = 0; index < claims.length; index += 1) {
    const claim = claims[index] as StageClaim
    const base = `claims[${index}]`
    if (!claim || typeof claim !== "object" || Array.isArray(claim)) {
      findings.push(finding("CLAIM_NOT_OBJECT", base, "claim 必须是对象。")); continue
    }
    for (const key of ["id", "kind", "statement", "maturity", "documentSection"] as const) {
      if (!nonEmpty(claim[key])) findings.push(finding("CLAIM_FIELD_REQUIRED", `${base}.${key}`, `${key} 不能为空。`))
    }
    if (nonEmpty(claim.id)) {
      if (ids.has(claim.id)) findings.push(finding("CLAIM_ID_DUPLICATED", `${base}.id`, `claim id 重复：${claim.id}。`))
      ids.add(claim.id)
    }
    if (nonEmpty(claim.kind) && !allowedKinds.has(claim.kind)) {
      findings.push(finding("CLAIM_KIND_OUT_OF_STAGE", `${base}.kind`, `阶段 ${scopeId} 不拥有结论类型 ${claim.kind}。`))
    }
    if (nonEmpty(claim.maturity) && !allowedMaturities.has(claim.maturity)) {
      findings.push(finding("CLAIM_MATURITY_OUT_OF_STAGE", `${base}.maturity`, `阶段 ${scopeId} 不允许成熟度 ${claim.maturity}。`))
    }
    if (nonEmpty(claim.documentSection) && !allowedSections.has(claim.documentSection)) {
      findings.push(finding("CLAIM_SECTION_OUT_OF_STAGE", `${base}.documentSection`, `claim 必须落入当前阶段拥有的章节。`))
    }
    if (!Array.isArray(claim.authorityRefs) || claim.authorityRefs.length === 0) {
      findings.push(finding("CLAIM_AUTHORITY_REQUIRED", `${base}.authorityRefs`, "每条 claim 必须声明事实或需求授权来源。"))
    } else for (const reference of claim.authorityRefs) {
      if (!nonEmpty(reference) || !contract.authorityPrefixes.some((prefix) => reference.startsWith(prefix))) {
        findings.push(finding("CLAIM_AUTHORITY_INVALID", `${base}.authorityRefs`, `不可解析的授权来源：${String(reference)}。`))
      }
    }
    if (!Array.isArray(claim.evidenceRefs)) {
      findings.push(finding("CLAIM_EVIDENCE_ARRAY_REQUIRED", `${base}.evidenceRefs`, "evidenceRefs 必须是数组。"))
      claim.evidenceRefs = []
    }
    if (contract.evidenceRequiredKinds.includes(claim.kind) && claim.evidenceRefs.length === 0) {
      findings.push(finding("CLAIM_EVIDENCE_REQUIRED", `${base}.evidenceRefs`, `${claim.kind} 必须绑定可检查证据。`))
    }
    for (const reference of claim.evidenceRefs) {
      if (!nonEmpty(reference) || /[<>]/u.test(reference) || !contract.evidencePrefixes.some((prefix) => reference.startsWith(prefix))) {
        findings.push(finding("CLAIM_EVIDENCE_INVALID", `${base}.evidenceRefs`, `不可解析或仍为占位符的证据：${String(reference)}。`))
        continue
      }
      const relativePath = normalizeReferencePath(reference)
      if (relativePath) {
        const absolute = path.resolve(state.projectRoot, relativePath)
        if (!isWithin(state.projectRoot, absolute) || !await exists(absolute)) {
          findings.push(finding("CLAIM_EVIDENCE_PATH_MISSING", `${base}.evidenceRefs`, `证据路径不存在或越出项目：${relativePath}。`))
        }
      }
    }
    const attributes = claim.attributes && typeof claim.attributes === "object" && !Array.isArray(claim.attributes)
      ? claim.attributes : {}
    if (currentFactKinds.has(claim.kind)) {
      if (!observationLevels.has(String(attributes.observationLevel ?? ""))) {
        findings.push(finding("CLAIM_OBSERVATION_LEVEL_REQUIRED", `${base}.attributes.observationLevel`, "现状事实必须说明证据强度。"))
      }
      if (!availabilities.has(String(attributes.availability ?? ""))) {
        findings.push(finding("CLAIM_AVAILABILITY_REQUIRED", `${base}.attributes.availability`, "现状事实必须说明 operational/partial/stub/absent/unknown。"))
      }
      if (!nonEmpty(attributes.evidenceSubject)) {
        findings.push(finding("CLAIM_EVIDENCE_SUBJECT_REQUIRED", `${base}.attributes.evidenceSubject`, "现状事实必须说明证据所证明的对象。"))
      }
    }
    const absenceCandidate = claim.statement.replace(/[“"][^”"\n]{0,100}[”"]/gu, "").replace(/\s+/gu, "")
    if (absencePattern.test(absenceCandidate)) {
      if (attributes.availability !== "absent" || !claim.evidenceRefs.some((reference) => reference.startsWith("search:"))) {
        findings.push(finding(
          "ABSENCE_CLAIM_NOT_PROVEN",
          base,
          "“不存在、只有或仅有”属于负向事实，必须标记 availability=absent 并提供 search:范围 证据。",
        ))
      }
    }
    const section = sections[claim.documentSection] ?? ""
    if (nonEmpty(claim.statement) && !section.includes(claim.statement)) {
      findings.push(finding("CLAIM_NOT_MAPPED_TO_DOCUMENT", `${base}.statement`, `正文章节「${claim.documentSection}」必须逐字包含该 claim。`))
    }
  }

  const narrative = Object.values(sections).join("\n")
  for (const sentence of sentences(narrative)) {
    if (hasUnnegatedDesignDecision(sentence) && !isProvenCurrentDecision(sentence, claims) && !isDeclaredUncertainty(sentence, claims)) {
      findings.push(finding(
        "EVIDENCE_STAGE_TARGET_DESIGN_LEAK",
        "sections",
        `现状证据阶段包含未经当前事实证明的目标设计或交付决定：${sentence.slice(0, 120)}`,
        "删除该决定，或改为 evidence-gap/open-question；目标方案留给战略、战术或交付阶段。",
      ))
    }
  }
  return findings
}
