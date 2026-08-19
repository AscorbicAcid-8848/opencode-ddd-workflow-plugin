---
name: ddd-roadmap
description: "Build an OpenSpec-change-owned DDD delivery plan from approved strategic and tactical design: product brief, architecture constraints, executable vertical slices, feature acceptance specifications, OpenSpec planning artifacts, compatibility, verification, and rollback. Use at milestone V for feature delivery, refactoring, or greenfield workflows."
---

# DDD Roadmap

Produce one coherent design-to-execution contract under the hidden marker `<!-- ddd-scope:delivery-planning -->`. Read `../ddd-orchestrate/references/phase-scope-contracts.md`, `../ddd-orchestrate/references/artifact-layout.md`, `../ddd-orchestrate/references/milestone-document-contracts.json`, and `../ddd-orchestrate/references/implementation-conformance-contract.md`. Consume approved strategic and tactical decisions and update the fixed business sections in `V-delivery-plan.md`.

This stage owns vertical-slice order, acceptance binding, expected production/test paths, verification, compatibility, migration, rollback, Git baseline planning, and the OpenSpec planning-artifact gate. Use `ddd-openspec-bridge` to obtain official OpenSpec status and dynamic instructions before creating proposal, Delta Spec documents, design, and tasks for the same workflow/change ID. It does not write production code, execute implementation, claim test results, or redesign subdomains, contexts, aggregates, or services.

Treat the same OpenSpec change as the only per-workflow container. Do not use project-root `docs/roadmap/`, `docs/specs/`, `docs/runs/`, feature-specific `docs/architecture/`, or a root `.ddd/` as canonical state.

## Preflight

1. Resolve the active same-ID OpenSpec change and its `ddd/` root.
2. Inspect the stack, entry points, source/test layout, public contracts, approved milestone II/IV decisions, and existing same-change delivery assets.
3. Refuse a second project-root or sibling change copy of the same roadmap/specification.
4. Read `references/product-brief-format.md` before creating or materially revising product intent.

## Establish architecture and intent

For an existing system, preserve proven boundaries and record migration constraints; do not move production code merely to make a textbook folder layout. For a new system, establish the architecture foundation justified by approved near-term capabilities and evolution needs; do not default automatically to either the smallest possible scaffold or a speculative full platform.

Define or refine:

- bounded contexts, ubiquitous language, ownership, and dependency direction;
- approved microservice use cases, owning bounded contexts, and their traceability to system-level scenarios and strategic responsibilities;
- aggregate and transaction boundaries supported by actual behavior;
- real delivery, persistence, and integration entry points;
- public model/API/event compatibility rules;
- product outcomes, users, non-goals, constraints, and success measures.

Keep change-specific architecture guidance in `<artifact-root>/.ddd/delivery/architecture.md`. Project-root architecture documentation is allowed only when it describes the current system across multiple changes; do not create it for a single workflow.

## Build the executable roadmap

1. Decompose phase → feature → item. Each item is a coherent, independently testable vertical slice with one observable outcome and at least one real consumer. Size it by business completeness, domain invariants, operational safety, and delivery value—not by the fewest files or lines.
2. Present at least a baseline, balanced, and evolvable roadmap option when scope permits. Explain value, cost, risk, dependencies, and future flexibility; recommend one based on evidence.
3. Put the walking skeleton first when it reduces delivery risk, then deepen behavior. Dependencies express only genuine execution prerequisites and must remain acyclic.
4. Reject layer-only batches, empty ports, fake repositories, disconnected endpoints, TODO bodies, mock-only completion, and “wire later” items.
5. Give every item stable IDs, dependencies, consumers, required gates, `planned` status, and a delivery-root-relative feature-spec reference. Preserve existing IDs.
6. Write exactly these change-owned assets:

   ```text
   <artifact-root>/.ddd/delivery/
   ├── manifest.json
   ├── product-brief.md
   ├── architecture.md
   ├── roadmap.json
   ├── model-contract.json       # all three orchestrated workflows
   └── specs/
       └── <feature-id>-<slug>.json
   ```

   `manifest.json` uses schema `ddd-delivery-assets/v1`, records the workflow identity, and points to every other asset with paths relative to the delivery root. Do not generate Markdown mirrors of roadmap or feature-spec JSON; `V-delivery-plan.md` is the only human review view.
7. For every profile with `designConformanceContract`, generate `model-contract.json` with schema `ddd-model-conformance/v1`, register it as `manifest.modelContract`, hash the current approved `IV-tactical-design.md`, and bind every required `ME-*`/`INV-*` to roadmap items, module/layer IDs, production/test paths, and acceptance criteria. Serialize the approved directory strategy, module source/test roots, namespace ownership, layer dependency matrix, Published Language, cross-module rules, cycle policy, and required architecture verification commands. Use `strict` mode for add/create and `migration` mode for refactor; migration exceptions require exact baseline evidence and a removal item.
8. Bind every item to concrete expected production paths, changed test paths, verification commands, compatibility checks, migration action, and rollback strategy. Treat the path list as an auditable implementation boundary; update it explicitly when coding evidence justifies a deviation.

## Generate standard OpenSpec artifacts

After the DDD delivery assets and `V-delivery-plan.md` are coherent, use the same workflow identity to call `ddd_openspec_action` in this exact order: `proposal`, `specs`, `design`, `tasks`. Call it immediately before writing each artifact so OpenSpec recalculates the dependency graph and injects the current schema template, project context, artifact rules, dependencies, and output path. Write only to the returned path.

Do not call `openspec-propose`, copy a static OpenSpec template, or generate all four artifacts from the original request. Translate only the DDD inputs named by the bridge response. If an instruction conflicts with an approved boundary, use case, aggregate, invariant, or model contract, return to the owning DDD milestone instead of resolving the conflict inside an OpenSpec document.

`add-feature` and `create-system` require behavior Delta Spec documents. `refactor-system` may set `skip_specs: true` only when the approved scope preserves external behavior and characterization evidence proves it; any behavior change requires a Delta Spec document.

Each spec defines stable Given/When/Then ACs with exact item coverage, traceability to an approved microservice use case, owning bounded context, strategic responsibility, and system scenario, domain models and invariants, public contracts and errors, shared-contract hashes, real consumers, expected production/test paths, and verification/rollback commands. Use `hash-file` for shared contracts. No `TBD`, `any`, placeholder fields, uncovered items, documentation-only delivery, or internal-only behavior may be approved.

## Review and bind

Present one concise review surface: architecture decisions, vertical slices, dependency order, AC-to-item coverage, public compatibility changes, consumers, unresolved choices, alternative roadmap options, and the recommendation. Do not dump full JSON.

Before requesting milestone V approval:

1. Re-check model names/fields, invariants, contract inputs/outputs/errors, consumer compatibility, AC coverage, shared hashes, module/layer ownership, and dependency rules across features. Prove every required `ME-*`/`INV-*` is in the model contract and no required model remains phrased as a candidate.
2. Set every reviewed feature spec to `approved`.
3. Call `ddd_workflow_submit(mode=stage)` with one roadmap-stage entry; its TypeScript delivery-asset gate validates the manifest, paths, roadmap topology, feature-spec status, AC coverage, consumers, and workflow identity together with OpenSpec strict validation.
4. Treat any validation failure as blocking; correct the same change instead of bypassing it or writing a project-root shadow copy.

After explicit approval, use `ddd-git-delivery` to create the clean local planning-baseline commit containing the same change-owned planning assets. Never push.

Completion means the same OpenSpec change contains coherent architecture guidance, an executable dependency graph of real vertical slices, approved feature specs, proposal, required Delta Spec documents (or an approved behavior-preserving refactor opt-out), design, tasks, and the approved `V-delivery-plan.md`. Hand implementation to `ddd-develop` with the exact item or slice selector.

Do not maintain an independent controller journal for an orchestrated workflow. OpenSpec `tasks.md` is mutable implementation progress; `roadmap.json` is the approved milestone-V plan snapshot; implementation evidence and milestone VI record actual completion.
