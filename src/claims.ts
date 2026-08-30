import path from "node:path"
import { exists, readJson } from "./fs.js"
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
const absencePattern = /(?:^|(?:当前|现有|既有|代码|系统|仓库|能力|实现|定义|证据|路径|接口|表))[^。；]{0,18}(?:不存在|未发现|尚无|没有|无专门)|(?:只有|仅有)[^。；]{0,30}(?:能力|实现|路径|接口|表|模块)|(?:属于|为|视为)全新(?:业务)?(?:能力|功能)/u
const capabilityAbsencePattern = /(?:当前|现有|既有|代码|源码|仓库|系统|能力|功能|模块)[^。；]{0,18}无(?:任何)?[^。；]{0,18}(?:实现|功能|能力|模块|接口|端点|路由|定义)/u
const absenceMetaPattern = /(?:不存在|未发现|尚无|没有|无专门)[^。；]{0,20}(?:待确认|开放问题|问题|证据|信息|结论|决定|说明)/u
const currentFactKinds = new Set(["current-behavior-fact", "current-topology-fact"])
const currentAuthorityKinds = new Set([
  ...currentFactKinds,
  "current-spec-decision",
  "compatibility-constraint",
])

function isDomainAbsenceAssertion(text: string): boolean {
  const compact = text.replace(/\s+/gu, "")
  return (absencePattern.test(compact) || capabilityAbsencePattern.test(compact)) && !absenceMetaPattern.test(compact)
}

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
  // A constraint on a hypothetical new artifact is still target design even
  // when phrased negatively ("the new table must not...").
  if (/(?:新增|新建)[^。；\n]{0,24}(?:表|接口|缓存|Redis|模块)[^。；\n]{0,36}(?:不得|不应|不能|避免)/iu.test(compact)) return true
  if (/(?:Redis|缓存|新增接口)[^。；\n]{0,30}(?:需|须|必须|应当|应该)[^。；\n]{0,20}(?:避免|采用|使用|遵循)/iu.test(compact)) return true
  if (/(?:新增[^。；\n]{0,16}|新功能[^。；\n]{0,16}|轨迹记录[^。；\n]{0,16})(?:应|需|须|必须)[^。；\n]{0,36}(?:异步|低延迟|Redis|缓存|接口路径|数据表|持久化)/iu.test(compact)) return true
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

function normalizedClaimText(value: string): string {
  return value.normalize("NFKC")
    .replace(/^\s*(?:#{1,6}\s*|[-*+]\s*|\d+[.)、]\s*)/u, "")
    .replace(/[\p{P}\p{S}\s]+/gu, "")
    .toLowerCase()
}

function evidenceAnchors(value: string): Set<string> {
  const matches = value.normalize("NFKC").toLowerCase()
    .match(/[a-z_][a-z0-9_.:/-]*|\b\d{3}\b/gu) ?? []
  return new Set(matches.filter((item) => item.length >= 3 || /^\d{3}$/u.test(item)))
}

function isTargetScopedBehavior(value: string): boolean {
  const compact = value.replace(/\s+/gu, "")
  return /(?:新增|新建|新功能|目标态|目标行为|本次(?:功能|变更)|未来|后续将|计划|拟定|候选方案)/u.test(compact)
}

function claimBacksCurrentSentence(sentence: string, claim: StageClaim): boolean {
  if (!currentAuthorityKinds.has(claim.kind) || claim.maturity !== "fact"
    || !Array.isArray(claim.evidenceRefs) || claim.evidenceRefs.length === 0
    || !nonEmpty(claim.statement)) return false

  // A sentence that appends a target proposal to a legitimate AS-IS quote is
  // still target-scoped as a whole. Check this before exact/containment
  // matching so `<fact>, therefore the new command must ...` cannot inherit
  // the fact's authority.
  if (isTargetScopedBehavior(sentence)) return false

  const normalizedSentence = normalizedClaimText(sentence)
  const normalizedStatement = normalizedClaimText(claim.statement)
  if (normalizedSentence.length >= 8 && normalizedStatement.length >= 8
    && (normalizedSentence.includes(normalizedStatement) || normalizedStatement.includes(normalizedSentence))) return true

  // A paraphrased AS-IS sentence may omit response labels such as
  // `authentication_required`, but it must retain multiple concrete anchors
  // from one typed fact. One shared status code is deliberately insufficient:
  // an existing GET 404 must never authorize a new command's 404 outcome.
  const sentenceAnchors = evidenceAnchors(sentence)
  const claimAnchors = evidenceAnchors(claim.statement)
  if (sentenceAnchors.size < 2 || claimAnchors.size < 2) return false
  const shared = [...sentenceAnchors].filter((anchor) => claimAnchors.has(anchor)).length
  return shared >= 2 && shared / Math.min(sentenceAnchors.size, claimAnchors.size) >= 0.6
}

function isProvenCurrentDecision(sentence: string, claims: StageClaim[]): boolean {
  if (claims.some((claim) => claimBacksCurrentSentence(sentence, claim))) return true

  // An exact evidence reference may authorize an explicitly AS-IS sentence.
  // Requiring the complete reference avoids the former basename-only match,
  // which let an unrelated line in the same file leak into target behavior.
  const compact = sentence.replace(/\s+/gu, "")
  const currentScoped = /(?:当前|现有|既有|已经|运行中|生产中|AS-IS|兼容|保持)/iu.test(compact)
  if (!currentScoped || isTargetScopedBehavior(sentence)) return false
  return claims.some((claim) => currentAuthorityKinds.has(claim.kind) && claim.maturity === "fact"
    && Array.isArray(claim.evidenceRefs) && claim.evidenceRefs.some((reference) => {
      const visibleReference = reference.replace(/^(?:code|schema|test|runtime|openspec|git):/u, "")
      return sentence.includes(reference) || (visibleReference.includes("#") && sentence.includes(visibleReference))
    }))
}

function isDeclaredUncertainty(sentence: string, claims: StageClaim[]): boolean {
  const disguisedDecision = /(?:需|须|必须|应当|应该|将|计划|决定)(?:采用|使用|引入|新增|新建|设计|实现|拆分|迁移)/u.test(sentence.replace(/\s+/gu, ""))
  if (disguisedDecision) return false
  return claims.some((claim) =>
    ["evidence-gap", "open-question"].includes(claim.kind)
    && (sentence.includes(claim.statement) || claim.statement.includes(sentence)))
}

function isUnprovenTargetBehavior(sentence: string, claims: StageClaim[]): boolean {
  const compact = sentence.replace(/\s+/gu, "")
  const behaviorContract = /(?:\bGiven\b[\s\S]{0,160}\bWhen\b[\s\S]{0,160}\bThen\b)|(?:应|应该|应当|必须|须|需要|将)(?:返回|包含|记录|产生|创建|支持|允许|拒绝|报错|写入|保存|展示)|(?:返回|记录|写入|保存)[^。；\n]{0,50}(?:401|403|错误|轨迹|列表)/iu.test(sentence)
  if (!behaviorContract) return false
  if (/(?:待确认|未明确|尚未决定|是否|候选|开放问题|evidence-gap|open-question)/iu.test(compact)) return false
  if (isProvenCurrentDecision(sentence, claims)) return false
  return true
}

export async function validateStageClaims(
  state: WorkflowState,
  scopeId: string | undefined,
  writableHeadings: string[],
  sections: Record<string, string>,
  rawClaims: unknown,
  summary = "",
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
  const snapshotFile = path.join(state.artifactRoot, ".ddd", "workbench", "evidence-snapshot.json")
  const snapshot = await exists(snapshotFile) ? await readJson<any>(snapshotFile) : {}
  const authorizedSearch = new Map<string, { absentTerms: string[]; statement: string }>((Array.isArray(snapshot.authorizedSearchEvidence)
    ? snapshot.authorizedSearchEvidence : []).map((item: any) => {
      const absentTerms = Array.isArray(item?.absentTerms) ? item.absentTerms.map(String) : []
      const fallback = `本次完整源码文件扫描未命中这些精确代码词：${absentTerms.map((term: string) => `\`${term}\``).join("、")}。`
      return [String(item?.ref ?? ""), { absentTerms, statement: String(item?.statement ?? fallback).trim() }]
    }))
  const issuedCodeRefs = new Set((Array.isArray(snapshot.issuedCodeEvidence) ? snapshot.issuedCodeEvidence : [])
    .map((item: any) => String(item?.ref ?? "").trim()).filter(Boolean))
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
      if (reference.startsWith("search:") && reference !== "search:openspec/specs-and-prior-changes") {
        const authorization = authorizedSearch.get(reference)
        if (!authorization) {
          findings.push(finding("SEARCH_EVIDENCE_NOT_ISSUED", `${base}.evidenceRefs`,
            `负向搜索引用不是 evidence-bundle 签发的证据：${reference}。`))
        } else if (claim.statement.trim() !== authorization.statement) {
          findings.push(finding("SEARCH_EVIDENCE_SUBJECT_MISMATCH", `${base}.statement`,
            `该负向搜索 claim 必须逐字使用签发语句“${authorization.statement}”；不能追加能力、模块或实体不存在的推论。`))
        } else {
          if (claim.kind !== "evidence-gap" || claim.maturity !== "hypothesis") {
            findings.push(finding("SEARCH_EVIDENCE_CLAIM_TYPE_INVALID", base,
              "精确代码词未命中只是一条 evidence-gap/hypothesis，不能登记为当前行为事实或 operational 能力。"))
          }
          if (!Array.isArray(claim.authorityRefs) || !claim.authorityRefs.includes(reference)) {
            findings.push(finding("SEARCH_EVIDENCE_AUTHORITY_MISMATCH", `${base}.authorityRefs`,
              `负向搜索 claim 的 authorityRefs 必须包含同一个签发引用：${reference}。`))
          }
        }
      }
      if (reference.startsWith("code:") && !issuedCodeRefs.has(reference)) {
        findings.push(finding("CODE_EVIDENCE_NOT_ISSUED", `${base}.evidenceRefs`,
          `代码证据必须逐字使用 evidence-bundle 签发的 excerpt.ref，禁止扩大行范围或补读未签发位置：${reference}。`))
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
    const signedSearchClaim = claim.evidenceRefs.some((reference) => authorizedSearch.has(reference))
    if (signedSearchClaim && attributes.availability !== "unknown") {
      findings.push(finding("SEARCH_EVIDENCE_AVAILABILITY_INVALID", `${base}.attributes.availability`,
        "精确代码词未命中不能证明业务能力 absent；availability 必须保持 unknown。"))
    }
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
    if (isDomainAbsenceAssertion(absenceCandidate)) {
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

  const narrativeParts = [
    ...(summary ? [{ path: "summary", text: summary }] : []),
    ...Object.entries(sections).map(([heading, text]) => ({ path: `sections.${heading}`, text })),
  ]
  for (const part of narrativeParts) {
    const signedSearchRefs = [...part.text.matchAll(/search:evidence-bundle:[A-Za-z0-9_-]+/gu)].map((match) => match[0])
    const signedSearchStatements = [...authorizedSearch.entries()]
      .filter(([, authorization]) => part.text.includes(authorization.statement)).map(([reference]) => reference)
    const unmapped = [...new Set([...signedSearchRefs, ...signedSearchStatements].filter((reference) =>
      !claims.some((claim) => claim.kind === "evidence-gap" && claim.maturity === "hypothesis"
        && claim.evidenceRefs.includes(reference))))]
    if (unmapped.length) findings.push(finding(
      "UNMAPPED_SIGNED_SEARCH_EVIDENCE",
      part.path,
      `正文引用了 evidence-bundle 签发的负向搜索证据，但完整 claims 中没有对应 evidence-gap：${unmapped.join("、")}。`,
      "保留该证据的 typed claim 并逐字使用签发 statement，或同时删除正文中的该引用；不得只删 claim。",
    ))
    const proseCodeRefs = [...part.text.matchAll(/code:[A-Za-z0-9_./\\-]+#L\d+-L\d+/gu)].map((match) => match[0])
    const unissuedCodeRefs = [...new Set(proseCodeRefs.filter((reference) => !issuedCodeRefs.has(reference)))]
    if (unissuedCodeRefs.length) findings.push(finding(
      "PROSE_CODE_EVIDENCE_NOT_ISSUED",
      part.path,
      `正文使用了 evidence-bundle 未签发或自行扩大的代码范围：${unissuedCodeRefs.join("、")}。`,
      "逐字使用 evidence-bundle 返回的 excerpt.ref；正文和 typed claim 适用同一证据边界。",
    ))
  }
  for (const part of narrativeParts) for (const sentence of sentences(part.text)) {
    const absenceCandidate = sentence.replace(/[“"][^”"\n]{0,100}[”"]/gu, "").replace(/\s+/gu, "")
    const mappedAbsence = claims.some((claim) =>
      sentence.includes(claim.statement) || claim.statement.includes(sentence))
    if (isDomainAbsenceAssertion(absenceCandidate) && !mappedAbsence) findings.push(finding(
      "UNMAPPED_ABSENCE_ASSERTION",
      part.path,
      `正文或摘要包含未登记为 claim 的不存在性结论：${sentence.slice(0, 120)}`,
      "不存在性结论必须由 evidence-bundle 签发的精确负向搜索 statement 支持；否则改写为证据范围或开放问题。",
    ))
    if (isUnprovenTargetBehavior(sentence, claims)) {
      findings.push(finding(
        "EVIDENCE_STAGE_TARGET_BEHAVIOR_LEAK",
        part.path,
        `现状证据阶段把尚未批准的新功能行为写成了验收规则：${sentence.slice(0, 120)}`,
        "本阶段只记录 AS-IS 行为与兼容约束；新功能触发、结果、授权和异常语义请改为 open-question，交由战略事件风暴和人工里程碑决定。",
      ))
    }
    if (hasUnnegatedDesignDecision(sentence) && !isProvenCurrentDecision(sentence, claims) && !isDeclaredUncertainty(sentence, claims)) {
      findings.push(finding(
        "EVIDENCE_STAGE_TARGET_DESIGN_LEAK",
        part.path,
        `现状证据阶段包含未经当前事实证明的目标设计或交付决定：${sentence.slice(0, 120)}`,
        "删除该决定，或改为 evidence-gap/open-question；目标方案留给战略、战术或交付阶段。",
      ))
    }
  }
  return findings
}
