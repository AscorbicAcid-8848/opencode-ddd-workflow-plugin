---
name: ddd-orchestrate
description: "Route one DDD request into feature delivery, legacy refactoring, or greenfield creation and drive its six human-gated milestones with ddd_lifecycle."
---

# DDD Orchestrator v2

Use only `ddd_lifecycle` for workflow state. Follow its `transition`; never infer state from files. Do not narrate between calls.

Every `input` value is a native tool object. Never JSON-stringify `input`, `sections`, `observations`, or `resolution`; double encoding is a protocol error.

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

2. Respect `stageCard.stageBoundary`, answer its checklist, use only its listed professional skills, and write only `allowedSectionHeadings`. Keep all section text between `qualityContract.minTotalChars` and `targetMaxTotalChars`. The immutable scope is `intentContract.originalRequest`. Do not make decisions owned by later stages.

For `system-discovery`, treat `baselineClaims` as the only AS-IS authority. In the `能力状态分类` subsection, every line labeled `现状已存在` cites its exact claim id. Do not transfer an existing query/interface outcome into a new target command, and describe boundaries only as candidate clues.

3. For `01-current-evidence` only, derive 2–6 stable business/code terms and call once:

```json
{"action":"evidence-bundle","input":{"stage":"01-current-evidence","terms":["Shop","UserHolder","view","trail"]}}
```

Use no repository/shell exploration in this stage. Copy `excerpt.ref` exactly into `evidence_refs`; cover `requiredCoverage`; packet-external knowledge is an `evidence-gap` or `open-question`, never a proposed table/model/API. Stay within `responseBudget`.

4. Submit every allowed section in one valid JSON call. Values may use `###` subsections; the runtime also normalizes accidental nested `##` headings. At a modeling human gate, submit `decisionItems` for open, deferred, and out-of-scope decisions. Every block is `{id, statement, documentSection}`: `statement` is the exact conclusion that may enter that authoritative section only after approval, so before review it belongs only in the runtime review area or alternatives. If authoritative prose mentions an open or deferred issue, keep one issue per line and cite both `DEC-ID/BLOCK-ID` on that line. An option that defers or excludes work must declare `resultStatus: "deferred" | "out-of-scope"`; a deferred option also declares `deferredToStage`.

```json
{"action":"complete-stage","input":{"stage":"<stageId>","summary":"至少20字的阶段结论","sections":{"<allowed heading>":"完整正文"},"observations":[{"heading":"<heading>","kind":"<allowed kind>","statement":"正文中的原句","evidence_refs":["code:relative/path#L1-L3"]}]}}
```

`observations` is required only when the stage card requests current-system claims. Its `heading` is an exact key from `allowedSectionHeadings`, never a nested `###` subtitle. Facts need cited evidence; unknowns do not invent evidence. For implementation include `sliceId`; for delivery-plan include `plannedSlices`. Submit the complete payload once. When a blocking result contains `draft.saved=true`, repair only the sections named by `findings.path`; the runtime retains all other valid content. Stop instead of retrying when `draft.retryableByModel=false`.

When a repair path targets `decisionItems[n]`, resend only the affected decision with the same stable `id`; the runtime patches that item and preserves sibling decisions. Never rename a decision during repair.

Before completing the delivery-plan stage, call `openspec-plan` once with business fields, not Markdown:

```json
{"action":"openspec-plan","plan":{"title":"...","objective":"...","nonGoals":[],"designDecisions":[],"capabilities":[{"id":"kebab-case","requirements":[{"name":"...","rule":"...","scenarios":[{"name":"...","given":"...","when":"...","then":"..."}]}]}],"slices":[{"id":"S1","title":"...","outcome":"...","consumer":"...","dependsOn":[],"acceptanceCriteria":["..."],"modelElementIds":["ME-01"],"invariantIds":["INV-01"],"productionPaths":["..."],"testPaths":["..."],"verification":["..."],"compatibility":"...","rollback":"..."}]}}
```

The runtime compiles proposal, Delta Specs, design, tasks, `plan.json`, and `roadmap.json`. `plan` is a top-level tool argument, never a JSON string in `input`. If it returns findings, resend only affected entries as top-level `plan` with `mode=repair`; the server draft preserves everything else. Do not call `section` or `finalize`. After `status=ready`, call only `complete-stage` with an empty input. The runtime deterministically compiles milestone V from the validated plan and approved model contract and sets `plannedSlices`; never resend or rewrite milestone-V sections. Only behavior-preserving refactoring may use `skipSpecs:true`.

## Human gate and completion

When `requiredAction` is `await-human-review`, output `transition.message` verbatim and stop. On the next user turn record the decision:

```json
{"action":"review","input":{"decision":"approve|revise|reject","reviewer":"<name>","feedback":"<optional>","resolution":{"selectedCandidateId":"<required when unresolved candidates exist>"}}}
```

The plugin binds review to the current unique human gate; do not guess an internal stage ID and do not call status first. Follow the returned transition. After milestone VI approval, call `{"action":"archive"}`; success requires strict OpenSpec validation.

If real build, test, E2E, database, cache, Git, or runtime evidence is unavailable, do not fake or install around it:

```json
{"action":"block","input":{"stage":"09-implementation","reason":"真实阻塞原因（至少20字）","evidence":["失败证据"],"remediation":["恢复条件"]}}
```

## Invariants

- Order is scenarios → Big Picture EventStorming → strategic design → implementation-unit use cases → Design-Level EventStorming → tactical design → delivery plan → implementation → acceptance.
- Big Picture does not decide API, aggregate, table, or middleware. Tactical design owns application services, aggregates, domain interactions, and persistence.
- Roman I–VI are human labels; tool calls use exact stage IDs.
- One stage transaction is one `prepare`, optional required packet/planning call, then one `complete-stage`.
- A Coding `sliceId` must exist in the approved roadmap and all its dependencies must already be complete.
- Never hand-edit formal milestone/OpenSpec artifacts or workflow state.
- During implementation do not spawn subagents or download build infrastructure; honor runtime repository and command budgets.
