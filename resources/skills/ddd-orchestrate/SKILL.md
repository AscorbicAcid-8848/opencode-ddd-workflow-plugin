---
name: ddd-orchestrate
description: "Route a DDD request to exactly one human-gated workflow: bottom-up feature delivery in an existing system, bottom-up refactoring of an existing system, or top-down creation of a new system. Existing-system routes recover current OpenSpec specs and prior DDD strategic decisions before new discovery. Use when the correct workflow must be inferred from repository state, change intent, scope, and preservation requirements."
---

# DDD Orchestrate

Select exactly one workflow, initialize it, and continuously execute it until the runtime permits stopping.

## Route

Use repository evidence and the user's primary outcome:

- existing production system plus one new capability: `add-feature` with `ddd-deliver-feature`;
- existing production system plus boundary or model migration: `refactor-system` with `ddd-refactor-system`;
- greenfield product or empty scaffold: `create-system` with `ddd-create-system`.

Read [routing-rules.md](references/routing-rules.md) only when the route is genuinely ambiguous. Ask at most one decisive question. Never blend profiles in one artifact root. A vague refactoring request must enter the refactoring scope-convergence stage; it is not permission to refactor the whole repository at once.

## Start cheaply

Load only the selected controller Skill. Do not read the complete `workflow-profiles.json`, every DDD Skill, or the whole repository up front. The TypeScript runtime owns topology and returns the current stage's minimal contract.

Call `ddd_workflow_init` once with the selected `workflow_type`, stable kebab-case `workflow_id`, title, original request, and project root. The same ID owns one OpenSpec change at:

```text
openspec/changes/<workflow-id>/ddd/
```

Never create a new workflow under `docs/ddd/`. Read [artifact-layout.md](references/artifact-layout.md) only for migration or storage questions.

If initialization returns `requiredAction: runtime-contract-repair`, `retryableByModel: false`, or an `OPENSPEC_*` error code, stop immediately. Do not call Bash, `npx`, global `npm install`, or manually create, move, or delete an OpenSpec change.

## Execute one milestone at a time

Treat the returned `transition` as the sole authority. While `stopAllowed` is false:

1. For a linear analysis or design path, call `ddd_workflow_prepare` once with `mode=milestone`. It returns the ordered internal stages through the next human gate.
2. Inspect shared evidence once, apply the named specialist Skills to their owning stage, and build one ordered submission per stage without mixing their decision scopes.
3. Call `ddd_workflow_submit` once with `mode=milestone`. The runtime still validates, checkpoints, and persists every internal stage independently, then stops only at the human gate.
4. If a batch partially succeeds, preserve its checkpoints and prepare only the remaining stages; do not replay completed work.
5. Use the same tools with `mode=stage` only for repeatable implementation slices, an explicit cycle/backtrack choice, or a one-stage revision; submit exactly one entry.

Treat each returned stage contract as complete. Never read the full profile, intrinsic catalog, or legacy artifact contract to guess fields. Do not manually edit Roman milestone documents, generated workbench files, hashes, owner fields, `stage-output.json`, or `scope-review.json`. Do not call status after a normal successful submission; use it only for recovery or an explicit status request.

On first submission, send `submission`. If validation fails, do not reconstruct or resend it: apply every finding in one `repair_patch` call against the runtime-owned draft. A patch must preserve unrelated valid fields. The runtime fuses identical or non-improving failures; a decreasing finding count remains repairable. When it returns `runtime-contract-repair`, stop instead of probing with more tools.

For existing-system stages with `strategicBaseline` in the preparation contract, assess every returned source inside `submission.strategicBaseline`. The TypeScript runtime adds hashes and writes `.ddd/strategic-baseline.json`; never create or edit that machine artifact yourself. A `COMPILED-BUNDLE-INVALID` after preflight is a non-retryable runtime defect, not another domain-content repair.

## Six human gates

The profiles contain exactly six independent human review documents:

1. `I-strategic-eventstorm.md`
2. `II-strategic-design.md`
3. `III-tactical-eventstorm.md`
4. `IV-tactical-design.md`
5. `V-delivery-plan.md`
6. `VI-final-acceptance.md`

A Roman file is a cumulative container until all three conditions are true: `milestoneReady`, `humanReviewRequired`, and `requiredAction: await-human-review`. A completed Arabic stage or an existing Roman file never proves milestone completion.

At a gate, summarize the actual business conclusion, unresolved decisions, alternatives, recommendation, and checklist in Chinese, then link only the self-contained milestone document. Accept `批准`, `修改：...`, or `拒绝：...` through `ddd_workflow_review`.

## Stage boundaries

Preserve this causal chain:

```text
system scenarios or recovered behavior
→ Big Picture EventStorming
→ strategic design and implementation-unit use cases
→ Design-Level EventStorming inside one approved context/unit
→ tactical design
→ delivery plan
→ vertical-slice coding, tests and Git evidence
→ final acceptance
```

Use [phase-scope-contracts.md](references/phase-scope-contracts.md) only when a stage ownership question remains after `ddd_workflow_prepare(mode=stage)`. Use [implementation-conformance-contract.md](references/implementation-conformance-contract.md) only from tactical design onward. Existing-system profiles must recover [strategic-baseline-contract.md](references/strategic-baseline-contract.md) before strategic decisions.

Big Picture EventStorming cannot decide aggregates, repositories, storage, endpoints, or source files. Strategic design cannot finalize tactical objects. Design-Level EventStorming produces candidates, not final models. Tactical design owns application services, aggregates, domain interactions, persistence and model contracts. Coding may implement only approved slices and may not silently redesign them.

At every human gate, keep the Markdown overview and the typed semantic graph consistent. Every substantive unresolved question must be an `open-question` item with the same `decisionId` and a `blocks` relation; never delete the structured question merely to make a target conclusion pass. Fill every `requiredSubsections` entry returned by prepare. A supporting capability absent from prior approval remains a candidate behind a visible scope decision, not an implicitly requested target.

## OpenSpec and completion

Use `ddd-openspec-bridge` only at the lifecycle points returned by the profile. Milestones I–IV remain DDD analysis. Milestone V creates proposal, delta specs, design and tasks in the same change. Coding uses approved tasks and one verified local Git commit per slice. Milestone VI requires model coverage, required test levels, real E2E evidence, Git/rollback evidence, and behavior comparison for refactoring.

When `requiredAction: archive`, call `ddd_workflow_archive`. Stop normally only for a human gate, human rejection, `runtime-contract-repair`, or `complete`.
