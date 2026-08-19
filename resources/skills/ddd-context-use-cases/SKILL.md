---
name: ddd-context-use-cases
description: "Convert approved strategic DDD artifacts and system-level scenarios into self-contained use-case requirement packages for each selected implementation unit and its bounded contexts, where the unit follows the existing or approved topology and may be a monolith module/application or a microservice. Include commands, outcomes, interactions, failures, acceptance criteria, and traceability. Use as the mandatory bridge from strategic design to Design-Level EventStorming and tactical implementation."
---

# DDD Context Use Cases

Translate whole-system intent into implementation-unit-owned **business use-case requirements**. This is the last part of `system-strategy`, not an early tactical-design step. Read `../ddd-orchestrate/references/phase-scope-contracts.md` and `../ddd-orchestrate/references/milestone-document-contracts.json`, persist `<!-- ddd-scope:system-strategy -->` in the hidden marker block, and update only the fixed strategic-design business sections.

Do not design aggregates, entities, value objects, application/domain services, repository methods, DTO/controller methods, tables, indexes, source files, or test files here.

## Required inputs

Require:

- approved system/user scenarios or recovered AS-IS flows;
- Big Picture EventStorming results;
- subdomains, subsystems, bounded-context responsibilities, and deployment mapping;
- context map, implementation-unit ownership, data ownership, and cross-boundary event direction;
- ubiquitous language and unresolved decisions.

Stop if a scenario step has no owning implementation unit, if two units claim the same behavior/data, or if the context-to-deployment mapping is undecided.

For an existing monolith, treat an internal module/application boundary as the implementation unit and do not invent a microservice. For an existing microservice system, preserve that style and use the newly added feature service; using an existing service instead requires an explicit architecture decision.

## Method

1. Number every system-scenario step, including exceptional and compensation paths.
2. Assign each step to exactly one owning bounded context and one owning implementation unit.
3. Group adjacent owned steps into independently meaningful implementation use cases; retain the owning context for language and model scope.
4. Define each use case's actor/upstream trigger, input command, preconditions, business outcome, failures, and observable acceptance criteria.
5. Define consumed and published integration contracts without leaking internal aggregates.
6. Record required consistency, latency, idempotency, authorization, and audit constraints.
7. Build bidirectional traceability: system scenario → Big Picture event → strategic responsibility → service use case → contract, and back.
8. Record, but do not silently change, the approved context-to-deployment-unit mapping.
9. Express input, outcome, and failure as business semantics. Field-level API shapes belong to tactical design.
10. Hand off only constraints that the next phase must honor: owner, vocabulary, interaction semantics, consistency expectation, compatibility promise, and acceptance observation.

## Outputs

Produce:

- a use-case catalog grouped by implementation unit and owning bounded context;
- per-use-case main, exception, and compensation paths;
- integration-contract handoffs;
- a scenario-to-strategy-to-implementation traceability matrix;
- open ownership or contract questions;
- one self-contained input package per selected implementation unit for Design-Level EventStorming.
- stable business acceptance criteria with IDs and concrete observable results;
- business command, outcome, and failure semantics;
- an allowed-change/protected-behavior matrix;
- a strategy-to-tactical input package that does not prescribe internal models or engineering files.

Consolidate the human-facing output into the assigned large-stage document. Put the summary first, followed by use cases, boundary interactions, traceability, open questions, and the acceptance checklist. Do not require the human to open separate use-case, contract, traceability, and delta files. Separate internal artifacts are allowed only as evidence for agents and must not become the review navigation.

## Gate

Approve only when every in-scope scenario step has one implementation-unit/context owner, every cross-boundary handoff has a business contract, and the tactical team can model one unit without reinterpreting system-level intent. Reject vague acceptance statements such as “返回成功” when status, data, ordering, visibility, authorization, error, or idempotency semantics affect the scenario. Also reject any output that prematurely names aggregates, service classes, repositories, DTOs, schemas, source paths, or tests.
