---
name: ddd-create-system
description: "Orchestrate top-down creation of a new DDD system from system-level user scenarios through pre-strategic Big Picture EventStorming, strategic subsystem/bounded-context/microservice decisions, per-service use cases, Design-Level EventStorming, tactical application/domain/persistence design, roadmap, implementation, and final review. Use for greenfield products or empty scaffolds without production behavior."
---

# DDD Create System

Run Big Picture discovery before deciding strategic boundaries. Start implementation only after system scenarios and strategic responsibilities have been decomposed into approved microservice use cases.

## Shared workflow gate

Use `ddd_workflow_init`, the milestone batch tools, `ddd_workflow_review`, `ddd_workflow_status`, and `ddd_openspec_action` with `workflow_type=create-system`. The TypeScript runtime owns the profile. Default to one `prepare_milestone` and one `submit_milestone` per linear analysis/design milestone; use stage-level tools only for a per-context tactical cycle, implementation slice, revision, or legacy recovery. Do not read the whole profile, invoke Python, or bypass these tools. On `runtime-contract-repair`, `retryableByModel: false`, or `OPENSPEC_*`, stop without shell-based recovery.

Read `../ddd-orchestrate/references/artifact-layout.md`. Store the complete DDD workflow inside its same-ID OpenSpec change:

```text
<project-root>/openspec/changes/<workflow-id>/ddd/
```

Maintain six independent Roman-numbered milestone documents at `<artifact-root>/`, one per human gate. A milestone batch contains one domain submission per ordered Arabic stage; every entry still has a separate intrinsic scope, compiler validation, Scope Review and checkpoint. It does not combine strategic and tactical decisions or cross an artificial human gate. Never edit generated workbench or formal Roman files directly. Repair all findings together and stop on `runtime-contract-repair`. Use the OpenSpec history and change-owned portal for navigation. Before tactical design, planning, Coding, and final review, read the implementation conformance contract.

Initialization delegates the standard same-ID change scaffold to official `openspec new change`, then adds its `ddd/` package. Milestones I–IV update only `ddd/`; milestone V calls `openspec-action` for proposal, specs, design, and tasks before creating each artifact, and Coding calls it with `--artifact apply` before starting or resuming a slice. The first delivery must contain behavior Delta Spec documents. Milestone VI approval archives the entire change including all DDD documents and evidence. Later product capabilities use new workflow/change IDs rather than rewriting archived history.

After every step, obey the returned runtime `transition`. When `stopAllowed` is false, treat the Roman-numbered file as a cumulative working document, optionally emit only a non-terminal Chinese progress update, and continue the unique `nextStage`, or select only from `allowedNextStages` when `requiredAction` is `select-next-stage`, in the same invocation without asking for approval. Only `humanReviewRequired: true` turns it into a review packet. At that gate, show the actual scenarios, responsibilities, rules, service collaboration, scope, and review questions inline; never send only a file link. Hide stage IDs, hashes, CLI commands, checkpoint directories, and infrastructure mechanics unless requested.

## Strategic workflow

1. **System scenarios** — use `ddd-scope` to describe actors, goals, system-level use cases, main and exceptional outcomes, priorities, quality constraints, non-goals, and success measures.
2. **Pre-strategic Big Picture EventStorming** — after system scenarios are approved, use `ddd-discover` in `big-picture` mode to expose the whole-system event timeline, core processes, external systems, responsibility candidates, and hotspots. Present missing scenarios, alternative capability clusters, trade-offs, and a recommendation for approval before subdomain, context, or service decisions.
3. **Subdomains** — use `ddd-subdomains` to classify capabilities as Core, Supporting, or Generic.
4. **Bounded contexts** — use `ddd-contexts` to define responsibility, non-responsibility, language, data ownership, team ownership, and boundary ADRs.
5. **Subsystem and context map** — use `ddd-context-map` to define subsystems, upstream/downstream relations, inter-service events, core-process ownership, responsibility boundaries, translations, failure handling, and versioning.
6. **Microservice deployment decisions** — decide which bounded contexts are hosted by each module or independently deployable microservice. Never apply a mechanical one-context-one-microservice rule.
7. **Strategic-to-tactical handoff** — use `ddd-context-use-cases` to decompose every approved system scenario and strategic responsibility into ordered, self-contained per-microservice use cases and contracts. Compare viable context and deployment mappings and obtain strategic approval.

## Tactical workflow per microservice

For each priority bounded context:

1. Select one microservice, its owned context, and its approved service use cases.
2. Use `ddd-discover` in `design-level` mode inside that service/context. Persist candidate-only discovery in `III-tactical-eventstorm.md`, compare invariants/boundaries/consistency candidates, and obtain user approval without finalizing aggregates, services, repositories or storage.
3. Only after that independent human-approved checkpoint, use `ddd-application-services` to design use-case orchestration and transaction control.
4. Use `ddd-aggregates` to design invariants, aggregates, entities, and value objects.
5. Use `ddd-domain-interactions` to design domain services, domain/integration events, repositories, factories, and policies.
6. Use `ddd-persistence-design` to design storage mappings, migrations, concurrency, cache ownership, and reliable messaging.
7. Freeze each approved `ME-*`/`INV-*` together with its implementation unit, module, layer, production/test paths, allowed dependency directions, Published Language, cycle policy, and project-native architecture test. The tactical design must choose a concrete directory strategy; “按 DDD 分层实现” is not a sufficient landing decision.
8. Present the complete tactical result, meaningful alternatives, trade-offs, recommendation, and evolution path for approval. Never combine step 2 with steps 3–7 in one uncheckpointed action. Return to strategic design if tactical invariants cross context boundaries.

After priority contexts are ready, use `ddd-model-review`, `ddd-roadmap`, `ddd-openspec-bridge`, and `ddd-develop` to deliver a walking skeleton followed by observable vertical slices. Milestone V must generate the strict `ddd/.ddd/delivery/model-contract.json` from approved milestone IV, then obtain official OpenSpec status/instructions through `openspec-action` immediately before writing proposal, Spec documents, design and tasks; do not use `openspec-propose`. Before Coding, call `openspec-action --artifact apply`; Coding prompts must consume the returned task context plus the model contract, and each slice must produce design and architecture conformance plus `ddd-implementation-evidence/v2` proving complete AC/INV coverage, passed required test levels, and real-consumer E2E. Put the approved plan in `V-delivery-plan.md` and the same-ID OpenSpec change; write actual code/test/Git evidence only to `VI-final-acceptance.md`. Milestone VI must state `测试覆盖完整`, `必需测试层级通过`, `E2E 真实链路通过`, and `重构前后行为对比：不适用`. Keep tasks synchronized and archive only after final acceptance so `openspec/specs/` becomes the current behavior source of truth. Invoke `ddd-git-delivery` before coding, do not let generic `openspec-apply-change` bypass it, and never push automatically.

## Top-down safeguards

- Require scenario-to-context-to-use-case-to-code traceability.
- Keep strategic integration events distinct from context-internal domain events.
- Postpone low-priority context internals until a vertical slice needs them.
- Do not invent technical services before responsibility and language boundaries exist.
- Revisit strategy when tactical modeling reveals split ownership or cross-context invariants.
- Block source files outside approved module/layer roots, inward dependency violations, cross-module internal imports, and actual module cycles.
