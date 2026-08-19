---
name: ddd-deliver-feature
description: "Orchestrate bottom-up delivery of one new DDD feature in an existing system by recovering current OpenSpec specs and prior DDD strategic decisions, then using evidence and two-level EventStorming through approved design, machine-readable design-to-code conformance, vertical-slice implementation, and final model coverage review."
---

# DDD Deliver Feature

Deliver one independently valuable feature in an existing system. Preserve current behavior, deployment style, and approved boundaries unless evidence and human approval authorize change.

## Guard and runtime

Use only for an existing production-capable system whose primary outcome is a new capability. If broad boundary migration becomes the main deliverable, stop and route a separate `refactor-system` workflow.

Use the TypeScript tools with `workflow_type=add-feature`. Do not invoke Python. Use `ddd_workflow_prepare` and `ddd_workflow_submit` with `mode=milestone` as the normal analysis/design path; they batch only the linear internal stages before the next human gate while preserving each stage contract and checkpoint. Use `mode=stage` for implementation slices, revision, or recovery. Administrative begin/checkpoint compatibility remains inside the runtime and is not model-visible. Never read the entire profile: preparation supplies each stage's governing question, approved inputs, owned sections, result kinds, semantic rules, required Skills and sole output.

Treat the preparation response as the complete submission contract. The first call supplies a strongly typed `submission`. If it fails, apply all findings through one `repair_patch` against the saved draft; never rebuild the full payload or read `workflow-profiles.json`, `stage-intrinsic-contracts.json`, or the legacy artifact contract to guess fields.

If any tool returns `runtime-contract-repair`, `retryableByModel: false`, or `OPENSPEC_*`, stop. Do not use Bash, `npx`, global installation, or manual OpenSpec filesystem operations as fallback.

## Required chain

Follow only the stage order and transitions returned by the runtime:

```text
current behavior and approved history
→ whole-system feature scenario
→ Big Picture EventStorming
→ strategic impact and implementation-unit use cases
→ Design-Level EventStorming
→ tactical application/domain/persistence design
→ model review and delivery slices
→ production-wired implementation, tests and Git evidence
→ final model coverage and business acceptance
```

Continue while `stopAllowed` is false. A Roman document is not reviewable until `milestoneReady`, `humanReviewRequired`, and `await-human-review` are all present. At a gate, report the actual business conclusion and recommendation, not internal stage mechanics.

## Existing-system evidence

Inspect only evidence relevant to the feature: entry point and consumer call paths, observable API behavior, tests, schema, persistence, messages, cache, external contracts and runtime behavior. Use CodeGraph first when `.codegraph/` exists. Separate facts, hypotheses and unresolved business decisions.

Inventory current `openspec/specs/`, `openspec/change-history.md`, and relevant approved or archived DDD strategic decisions through the strategic-baseline contract. Record hashes and relevance; do not reinterpret all historical changes. Existing capability requires operational evidence, not a class, endpoint shell or TODO.

## Discovery and strategy

Use `ddd-scope`, then `ddd-discover` in Big Picture mode. Preserve the original request as the only unapproved target. Classify material capabilities as `existing`, `target`, or `future`; only repository/approved evidence can prove existing, and only user input or prior approval can authorize target. Unresolved questions must block their affected conclusions instead of being silently guessed.

Big Picture results stay at business-system scale. Queries return read models; a domain event requires a business state change or real downstream policy. Internal modules are not external parties. Do not introduce aggregates, repositories, databases, indexes, DTOs or source files here.

Use `ddd-subdomains`, `ddd-contexts`, `ddd-context-map`, and `ddd-context-use-cases` for strategic impact. Preserve a monolith as one deployable application and express boundaries as modules/packages. Preserve an existing microservice topology unless an explicit approved architecture decision says otherwise. Convert approved strategic decisions into self-contained use cases for the selected implementation unit; these are the sole input to tactical discovery.

## Tactics

Use `ddd-discover` in Design-Level mode inside one approved implementation unit and context. Discover commands, events, policies, failures, invariants, read models and transaction/storage hotspots. Keep aggregate, service, repository and storage shapes as candidates until milestone IV.

After milestone III approval, use in order:

1. `ddd-application-services`
2. `ddd-aggregates`
3. `ddd-domain-interactions`
4. `ddd-persistence-design`

Milestone IV must remove candidate language from required elements and freeze stable `ME-*` model elements, `INV-*` invariants, ownership, module/layer paths, dependency directions, test obligations and architecture commands. Read the implementation conformance contract only at this point.

## Delivery

Use `ddd-model-review`, `ddd-roadmap`, and `ddd-openspec-bridge` at milestone V. Create proposal, delta specs, design, tasks, roadmap and `model-contract.json` in the same OpenSpec change only after milestone IV approval. Each vertical slice names its acceptance criteria, real consumer, production/test paths, verification, compatibility and rollback.

Before each coding slice, obtain OpenSpec apply instructions, establish a safe Git baseline with `ddd-git-delivery`, implement with `ddd-develop`, run required tests including a real E2E path, and create one isolated local commit. Produce `ddd-implementation-evidence/v2` bound to exact Git SHAs and the approved model contract. Never implement from the original prompt alone and never silently redesign during coding.

Final review traces every accepted scenario and required `ME-*`/`INV-*` to code, tests, runtime and Git evidence. Require 100% approved model coverage, complete required test levels, real E2E evidence, compatibility and rollback; mark refactoring behavior comparison as not applicable. After human approval, strictly validate and archive the same OpenSpec change.
