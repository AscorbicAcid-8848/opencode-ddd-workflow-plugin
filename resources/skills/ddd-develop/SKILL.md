---
name: ddd-develop
description: Develop production-compatible DDD vertical slices, either as one bounded ad-hoc change or by continuously executing an approved roadmap selector. Use for implementation, TDD, roadmap execution/resume, exact-range review, or explicit cancellation without disconnected stubs.
---

# DDD Develop

In an orchestrated workflow, first call the OpenCode SDK tool `ddd_openspec_action` with `artifact=apply` for the active same-ID change. Consume its official task instructions together with `tasks.md`, `<artifact-root>/.ddd/delivery/roadmap.json`, approved feature specs, and `model-contract.json`. Implement only their intersection, mark each verified task `- [x]`, and keep Requirement/Scenario/acceptance/Git evidence traceable. Do not create a replacement change when implementation exposes a design problem; return to the owning DDD stage and update the same change.

This is the single implementation entry point. It owns one-slice development, dependency-ordered roadmap execution, recovery, exact-range audit, and explicit cancellation. Use `ddd-git-delivery` for the Git baseline, slice commits, exact-range history, and delivery SHA traceability. The same OpenSpec change owns the approved plan, task progress, implementation evidence, and final acceptance; do not create project-root `docs/roadmap`, `docs/specs`, `docs/runs`, or a persistent project-root `.ddd` controller state.

## Choose the mode

- **Roadmap:** an exact roadmap item or approved OpenSpec task is selected, or the user asks to resume the active change. Execute approved leaves in dependency order.
- **Ad-hoc:** a bounded behavior request has no formal DDD/OpenSpec workflow. Implement one complete vertical slice without inventing workflow assets.
- **Cancel:** the user explicitly asks to stop/abort. Show the active change, unfinished tasks, commits, and consequences; require confirmation, then preserve the change as incomplete. Never delete evidence or Git history.

Do not reinterpret a feature heading or prose as leaf IDs.

## Roadmap start and continuity

1. Resolve the active same-ID OpenSpec change and read its `tasks.md`.
2. Call `ddd_openspec_action` with `artifact=apply` before the first slice and every resume. Reject a blocked OpenSpec artifact graph, a wrong change identity, or task instructions that are inconsistent with the approved DDD plan. Do not let generic `openspec-apply-change` own the implementation or bypass DDD/Git gates.
3. Read `<artifact-root>/.ddd/delivery/manifest.json`, `roadmap.json`, and only the selected item’s feature spec. For every orchestrated profile with `designConformanceContract`, also read the registered `model-contract.json` and `../ddd-orchestrate/references/implementation-conformance-contract.md`; reject a missing or stale tactical-design hash, unknown module/layer, or external path.
4. Resume only the same workflow ID. If the requested selector belongs to another change, report the conflict and stop; never hijack either change.
5. Select the next incomplete item whose `dependsOn` items are complete and whose mapped OpenSpec task is still unchecked. Show the compact item, acceptance criteria, consumers, and verification commands.
6. After verification and the local slice commit, mark only the corresponding OpenSpec task complete and append immutable implementation evidence. Unknown selectors, dependency violations, or stale plan/spec hashes fail closed.

When no eligible item remains, do not implement anything. If unchecked tasks remain, report the blocked dependencies or plan contradiction; if none remain, proceed to final review without creating a separate run report.

## Implement each vertical slice

1. Map every assigned AC or ad-hoc outcome to observable tests through the real consumer.
2. Inspect current bounded contexts, call paths, public models/contracts, persistence/delivery adapters, sibling modules, and failure behavior before designing.
   When `.codegraph/` exists, use CodeGraph first for symbol and call-path recovery; fall back explicitly if unavailable.
3. Write or identify a failing behavior test, then implement the approved vertical slice as a complete cohesive end-to-end behavior. In every orchestrated workflow, generate the implementation prompt from the selected item, feature spec, and model contract together; explicitly list required `ME-*`/`INV-*`, module/layer IDs, paths, allowed/forbidden imports, Published Language, cycle policy, and required verification commands. Never implement from the original user prompt or acceptance criteria alone. Do not shrink it below approved domain invariants, failure handling, observability, compatibility, or operational safety merely to minimize code.
4. Preserve ubiquitous language, invariants, aggregate/transaction boundaries, dependency direction, authorization, errors, events, and backward compatibility. Put each production type in its approved module/layer. Application and domain code may depend only on approved inward abstractions; cross-module dependencies must use the target Published Language, and actual module cycles are forbidden. Extend existing concepts; do not create parallel models, duplicate ports, or shadow adapters.
5. Wire the actual consumer in the same slice. Empty ports, TODO bodies, fake repositories, mock-only success, unused endpoints, and deferred wiring are incomplete.
6. Run focused tests while working, then relevant integration, consumer, and E2E checks. Review security, cleanup, concurrency, idempotency, query/resource behavior, observability, and compatibility.

When implementation choices remain open, compare meaningful alternatives and recommend one based on domain clarity, maintainability, risk, performance, expected evolution, and delivery cost. “Fewest classes,” “fewest files,” and “smallest diff” are not sufficient decision criteria.

In both roadmap and ad-hoc DDD coding, invoke `ddd-git-delivery` before the first edit. Preserve pre-existing dirty paths as user-owned, establish the baseline, and commit only explicit slice-owned files after verification. In roadmap mode, create one local commit containing only the leaf and never push. Record the exact AC IDs, verification commands, baseline SHA, and implementation SHA in the same change’s implementation evidence before checking the mapped task.

Before submitting a DDD workflow implementation stage, create `.ddd/implementation-evidence/<slice-id>.json` under that workflow root using schema `ddd-implementation-evidence/v2`. Include the exact Git range, commit, acceptance criteria, changed production/test paths, real consumer paths, successful verification commands, compatibility, rollback, and `designConformance` with the current model-contract hash, the `ME-*`/`INV-*` implemented by this slice, zero deviations, and a concrete summary. Add `testEvidence` that maps every slice AC and delivered INV to an actual passed command and test path, records the required domain/application/integration/architecture/E2E levels (plus contract when cross-module contracts exist), and proves E2E exercised every declared consumer with `no-business-path-mocks`. For refactoring also record the same scenarios at `baselineSha` and `implementationSha`, both passed, with no unapproved differences and a `characterization` level. The workflow generates `architectureConformance` only after inspecting the committed source paths and imports. A dedicated model type must exist in its approved production path; passing API tests through a script-style Controller/Service does not count. For refactoring, an approved legacy exception must already exist at `baselineSha` and must not expand. Pass the evidence path in the sole `ddd_workflow_submit(mode=stage)` entry. If the TypeScript contract engine rejects it, keep the implementation stage active and fix the code, tests, dependency direction, commit boundary, or evidence; never replace the missing implementation with prose.

Review the baseline-to-implementation range directly: inspect every changed file and trace the real consuming flow. Record blocking and non-blocking findings in the implementation evidence and `VI-final-acceptance.md`; CRIT/HIGH findings block task completion and final acceptance.

Only a verified commit, accepted implementation-evidence record, and checked OpenSpec task together make a roadmap leaf complete. The workflow succeeds only when every approved task is complete and milestone VI passes; preserve blocked, failed, or cancelled states in the same change. Never retry a failed or cancelled slice without user approval.

## Communication

Report scope, current outcome, changed production flow, local commit SHA, remaining user-owned dirty paths, gate failures, and blockers. Persist implementation and Git evidence in `VI-final-acceptance.md` and the same change’s `.ddd/implementation-evidence/`; do not create another human-facing Git or run report. Coding may make local engineering choices but must not silently redefine strategic boundaries, ubiquitous language, aggregates, invariants, or approved contracts. Route contradictions back to the owning stage.
