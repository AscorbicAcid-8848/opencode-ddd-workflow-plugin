---
name: ddd-orchestrate
description: "Route one DDD request into feature delivery, legacy refactoring, or greenfield creation and drive its six human-gated milestones with ddd_lifecycle."
---

# DDD Orchestrator v2

Use only `ddd_lifecycle` for workflow state. Follow its `transition`; never infer state from files. Give brief progress updates when useful; stop at human gates, not between routine stage operations.

Every `input` value is a native tool object. Never JSON-stringify `input`, `sections`, `observations`, or `resolution`; double encoding is a protocol error.

## Interpret each user turn

For ordinary conversation that requests mutation, interpret the complete current user message before any mutation. Call `ddd_lifecycle(action="intent", input={messageID, intent, quote, continueAfterReview})` once. The message ID is supplied by the host; `quote` is an exact excerpt from this turn, not system text, a historical approval, or a tool result. Intent is `query`, `clarify`, `start`, `continue`, `approve`, `revise`, or `reject`. Questions, explanations and hypotheticals are not permission. Use `clarify` and ask when ambiguity affects authorization; do not force a choice or reinterpret it repeatedly. `continueAfterReview` is a boolean recording whether the user wants execution after the review, not automatic approval of later gates.

Status is always readable and may be called before interpreting an ambiguous target. “按照最推荐的方案，批准，然后继续下一阶段” means approve the current gate and continue, regardless of word order. “如果我批准会怎样” is a question. Interpret semantically rather than requiring these exact phrases. Authorization lasts within the current turn and workflow; review is limited to its current checkpoint. Every new mutating user turn requires a new interpretation; status-only turns need no intent call. Explicit `/ddd-status` cannot be upgraded. Verified panel actions already have recorded decisions and do not need intent or duplicate review. No additional model is called by this protocol.

## Route and initialize

Choose exactly one:

- `add-feature`: one new user-visible capability in an existing system; preserve approved topology.
- `refactor-system`: recover or migrate domain boundaries in an existing system.
- `create-system`: greenfield design from system-level scenarios.

If truly ambiguous, ask one scope question. Otherwise initialize once:

```json
{"action":"init","workflow_type":"add-feature|refactor-system|create-system","workflow_id":"kebab-case-id","input":{"title":"短标题","request":"原始业务目标、规则、排除项和质量约束"}}
```

Never initialize a continuation. With one active change, call `prepare` directly and let the plugin resolve its identity. Use `status` only after an ambiguity/error says several changes are possible or when the user explicitly asks for status.

## Advance one stage

Repeat only while `requiredAction` is `continue` or `select-next-stage`:

1. Prepare exactly the returned/selected stage:

```json
{"action":"prepare","input":{"stage":"<nextStage>"}}
```

2. Respect `stageCard.stageBoundary`, answer its checklist and `phaseRequiredOutcomes`, use only its listed professional skills, and write only `allowedSectionHeadings`. Length targets and keyword checks are advisory, not quotas; use enough detail to explain the business and tradeoffs without padding. Equivalent wording, prose, tables and diagrams are allowed. Explain business reasons when an outcome is inapplicable; do not invent a model to fill a template. The immutable scope is `intentContract.originalRequest`. Do not make decisions owned by later stages.

For `system-discovery`, treat `baselineClaims` as the only AS-IS authority. In the `能力状态分类` subsection, every line labeled `现状已存在` cites its exact claim id. Do not transfer an existing query/interface outcome into a new target command, and describe boundaries only as candidate clues.

3. For `01-current-evidence` only, derive 2–6 stable business/code terms and obtain an initial evidence bundle:

```json
{"action":"evidence-bundle","input":{"stage":"01-current-evidence","terms":["Account","Principal","read","state"]}}
```

Use read/glob/grep to resolve material gaps in the bundle with targeted evidence. Copy `excerpt.ref` or a verifiable source location into `evidence_refs`; distinguish missing evidence from evidence not yet inspected. Do not design target tables/models/APIs here. Avoid repeated searches that add no evidence; fixed call counts are not completion criteria.

4. Submit every allowed section in one valid JSON call. Values may use `###` subsections; the runtime also normalizes accidental nested `##` headings. This transaction writes only the machine-facing `ddd/.ddd/stages/<stageId>.md`; never compose or repair a Roman milestone document. When `stageCard` contains `humanDecisionContract`, submit `decisionItems` for open, deferred, and out-of-scope decisions. Every block is `{id, statement, documentSection}`: `statement` is the exact conclusion that may enter that authoritative section only after approval, so before review it belongs only in alternatives. If authoritative prose mentions an open or deferred issue, keep one issue per line and cite both `DEC-ID/BLOCK-ID` on that line. An option that defers or excludes work must declare `resultStatus: "deferred" | "out-of-scope"`; a deferred option also declares `deferredToStage`.

```json
{"action":"complete-stage","input":{"stage":"<stageId>","summary":"至少20字的阶段结论","sections":{"<allowed heading>":"完整正文"},"observations":[{"heading":"<heading>","kind":"<allowed kind>","statement":"正文中的原句","evidence_refs":["code:relative/path#L1-L3"]}]}}
```

`observations` is required only when the stage card requests current-system claims. Its `heading` is an exact key from `allowedSectionHeadings`, never a nested `###` subtitle. Facts need cited evidence; unknowns do not invent evidence. For implementation include `sliceId`; for delivery-plan include `plannedSlices`. Submit the complete payload once. When a blocking result contains `draft.saved=true`, repair only the sections named by `findings.path`; the runtime retains all other valid content. Stop instead of retrying when `draft.retryableByModel=false`.

When a repair path targets `decisionItems[n]`, resend only the affected decision with the same stable `id`; the runtime patches that item and preserves sibling decisions. Never rename a decision during repair.

Before completing the delivery-plan stage, call `openspec-plan` once with business fields, not Markdown:

```json
{"action":"openspec-plan","plan":{"title":"...","objective":"...","nonGoals":[],"designDecisions":[],"capabilities":[{"id":"kebab-case","requirements":[{"name":"...","rule":"...","scenarios":[{"name":"...","given":"...","when":"...","then":"..."}]}]}],"slices":[{"id":"S1","title":"...","outcome":"...","consumer":"...","dependsOn":[],"acceptanceCriteria":["..."],"modelElementIds":["ME-01"],"invariantIds":["INV-01"],"productionPaths":["..."],"testPaths":["..."],"verification":["..."],"compatibility":"...","behaviorProtection":{"baselineScenarioRefs":["BASELINE-..."],"characterizationTests":["..."],"preservedSemantics":["..."],"coexistenceStrategy":"..."},"rollback":{"trigger":"...","steps":["..."],"verification":["..."]}}]}}
```

The runtime compiles proposal, Delta Specs, design, tasks, `plan.json`, and `roadmap.json`. `plan` is a top-level tool argument, never a JSON string in `input`. If it returns findings, resend only affected entries as top-level `plan` with `mode=repair`; the server draft preserves everything else. Do not call `section` or `finalize`. After `status=ready`, call only `complete-stage` with an empty input. The runtime deterministically compiles milestone V from the validated plan and approved model contract and sets `plannedSlices`; never resend or rewrite milestone-V sections. Only behavior-preserving refactoring may use `skipSpecs:true`.

## Human gate and completion

After the last Arabic business stage of each milestone succeeds, the runtime automatically executes a separate summary transaction. It reads all independent stage artifacts, generates the fixed Roman-numbered document, aggregates pending decisions, and creates the only human-review checkpoint. The model must not call or author this summary stage.

Write Arabic-stage content for reuse by a non-DDD business reviewer: lead each section with a concrete project conclusion, explain it through scenarios, then give reasons and alternatives. Explain unfamiliar terms using this project's business, not textbook definitions. Distinguish observed facts, proposed choices and unknowns; preserve evidence and decision IDs. Summaries report business findings, not tool activity or document counts. The runtime organizes Roman documents into conclusions, scope/evidence, stage analysis, decisions and supporting references. This presentation does not merge phase scopes or authorize later-stage design; VI reports actual evidence, V only the delivery plan.

When `requiredAction` is `await-human-review`, output `transition.message` verbatim and stop. On the next user turn record the decision:

```json
{"action":"review","input":{"decision":"approve|revise|reject","reviewer":"<name>","feedback":"<optional>","resolution":{"selectedCandidateId":"<required when unresolved candidates exist>"}}}
```

The plugin binds review to the current unique human gate; do not guess an internal stage ID and use status when needed to clarify the current target. For revise, interpret feedback using stage responsibilities and choose a stage from allowedNextStages in prepare; explain why it owns the correction. Keywords do not determine the owner. Follow the returned transition. After milestone VI approval, call `{"action":"archive"}`; success requires strict OpenSpec validation.

Use normal project setup and verification within host permissions. If prerequisites cannot safely be restored or require new authorization, record a real block rather than invent evidence:

```json
{"action":"block","input":{"stage":"09-implementation","reason":"真实阻塞原因（至少20字）","evidence":["失败证据"],"remediation":["恢复条件"]}}
```

## Invariants

- Order is scenarios → Big Picture EventStorming → strategic design → implementation-unit use cases → Design-Level EventStorming → tactical design → delivery plan → implementation → acceptance.
- Big Picture does not decide API, aggregate, table, or middleware. Tactical design owns application services, aggregates, domain interactions, and persistence.
- Arabic stage IDs own independent machine artifacts under `ddd/.ddd/stages/*.md`. Roman I–VI documents at the `ddd/` root are runtime-owned summaries and are the only human review documents.
- Prepare before stage work, gather sufficient relevant evidence, then publish with complete-stage. Do not repeat preparation just to reset guards.
- A Coding `sliceId` must exist in the approved roadmap and all its dependencies must already be complete.
- Never hand-edit formal milestone/OpenSpec artifacts or workflow state.
- Implement only the approved slice. Necessary reads, tests and project setup follow host permissions; no fixed repository or command quota. Domain quality warnings require professional review, not keyword padding.
