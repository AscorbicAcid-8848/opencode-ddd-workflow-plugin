---
name: ddd-refactor-system
description: "Orchestrate bottom-up DDD refactoring of an existing production system by converging vague scope, recovering current OpenSpec specs and prior DDD strategic decisions, restoring behavior, running AS-IS Big Picture EventStorming, designing target boundaries and a pilot model, and delivering reversible migration slices."
---

# DDD Refactor System

Recover before redesigning. Migrate behavior in reversible vertical slices; never perform a layer-by-layer rewrite.

## Shared workflow gate

Use `ddd_workflow_init`, the milestone batch tools, `ddd_workflow_review`, `ddd_workflow_status`, and `ddd_openspec_action` with `workflow_type=refactor-system`. The TypeScript runtime owns the profile. Default to one `prepare_milestone` and one `submit_milestone` per linear analysis/design milestone; use stage-level tools only for an implementation slice, explicit backtrack, revision, or legacy recovery. Do not read the whole profile, invoke Python, or bypass these tools. On `runtime-contract-repair`, `retryableByModel: false`, or `OPENSPEC_*`, stop without shell-based recovery.

Read `../ddd-orchestrate/references/artifact-layout.md`. Store the complete DDD workflow inside its same-ID OpenSpec change:

```text
<project-root>/openspec/changes/<workflow-id>/ddd/
```

Maintain six independent Roman-numbered milestone documents at `<artifact-root>/`, one per human gate. A milestone batch contains one domain submission per ordered Arabic stage; each submission remains limited to that stage's intrinsic scope. The compiler independently generates and validates Markdown, typed output, Scope Review, hashes and checkpoint for every entry before reaching the gate. Never edit generated workbench or formal Roman files. Repair all findings together and stop on `runtime-contract-repair`. Before tactical design, planning, Coding, and final review, read the implementation conformance contract. Do not modify production code before milestone V is approved.

Read `../ddd-orchestrate/references/strategic-baseline-contract.md` before baseline recovery and target strategy. Maintain `.ddd/strategic-baseline.json`; the baseline checkpoint requires its `inventory` form and the strategic-design checkpoint requires its `decision-delta` form.

Initialization delegates the standard same-ID change scaffold to official `openspec new change`, then adds its `ddd/` package. Milestones I–IV update only `ddd/`; milestone V calls `openspec-action` for proposal, specs, design, and tasks before creating each artifact; Coding calls it with `--artifact apply` before starting or resuming a slice. A behavior-preserving refactor may set `skip_specs: true` only with characterization evidence; any behavior change requires a Delta Spec document. Milestone VI approval archives the entire migration change including all DDD documents and evidence. Never split one refactoring workflow across shadow changes.

After every step, obey the returned runtime `transition`. When `stopAllowed` is false, treat the Roman-numbered file as a cumulative working document, optionally emit only a non-terminal Chinese progress update, and continue the unique `nextStage`, or select only from `allowedNextStages` when `requiredAction` is `select-next-stage`, in the same invocation without asking for approval. Only `humanReviewRequired: true` turns it into a review packet. At that gate, show the actual responsibilities, rules, behavior-preservation result, migration risk, and review questions inline; never send only a file link. Hide stage IDs, hashes, CLI commands, checkpoint directories, and low-level mechanics unless requested.

## Workflow

1. **Request and route** — capture the refactoring objective, preservation contract, repository, route evidence, and non-goals.
2. **Refactoring scope convergence** — before broad discovery, use `ddd-scope` and repository evidence to turn vague or project-wide intent into one bounded current-round objective. Distinguish the project aspiration from this workflow, preserved behavior, non-goals, and measurable completion. Compare candidate end-to-end business seams and recommend one discovery/pilot seam in milestone I.
3. **Baseline evidence** — inspect code paths, schemas, tests, logs, runtime behavior, external contracts, data ownership, and operational risks for the converged scope. Add characterization tests when safe. Also scan `openspec/change-history.md`, inventory every current formal spec and prior DDD change, read relevant historical `ddd/II-strategic-design.md`, verify hashes, and extract stable `BASE-*` decisions. Mark unrelated history with reasons and keep strategic disposition `pending`.
4. **Recovered system scenarios and AS-IS Big Picture** — express preserved end-to-end behavior as system user scenarios, approve them, then use `ddd-discover` in `big-picture` mode to recover business events, system event flow, core processes, exceptional paths, language, responsibility candidates, and coupling hotspots. Show the board, competing responsibility clusters, risks, and recommendations for user approval before target strategic design; separate facts from hypotheses.
5. **Target strategy** — use `ddd-subdomains`, `ddd-contexts`, and `ddd-context-map` to decide target subdomains, subsystems, bounded contexts, service deployment mapping, service responsibilities, inter-service events, integration contracts, and migration ADRs.
6. **Service use-case handoff** — use `ddd-context-use-cases` to map preserved system scenarios and approved target responsibilities into self-contained per-microservice use cases with traceability. Compare target-boundary and migration alternatives and obtain strategic approval. Include a `战略基线继承矩阵` in `II-strategic-design.md`; map every `BASE-*` decision to explicit reuse or change, list `NEW-*` decisions and impacts, keep it synchronized with `.ddd/strategic-baseline.json`, and block unresolved historical conflicts.
7. **Pilot Design-Level EventStorming** — choose the approved valuable architectural seam and use `ddd-discover` in `design-level` mode inside one implementation unit and its owning context. Persist candidate-only discovery in `III-tactical-eventstorm.md`; do not finalize tactical model elements here.
8. **Pilot tactical design** — only after Design-Level approval, use `ddd-application-services`, `ddd-aggregates`, `ddd-domain-interactions`, and `ddd-persistence-design`. Show meaningful model and consistency alternatives, then freeze `ME-*`/`INV-*`, module/layer roots, dependency directions, Published Language, cycle policy, production/test paths, and project-native architecture tests. Never collapse steps 7 and 8 into one uncheckpointed action or default to the smallest migration regardless of long-term domain quality.
9. **Migration roadmap** — use `ddd-roadmap` and `ddd-openspec-bridge` to plan strangler seams, coexistence, compatibility, rollback, observability, independently testable slices, and the same-ID OpenSpec Spec/design/tasks. Immediately before writing each standard artifact, call `openspec-action` to obtain the official dependency state, dynamic instructions and output path; do not use `openspec-propose`. Generate `ddd/.ddd/delivery/model-contract.json` in migration mode. A legacy exception is valid only when the exact source/import violation is proven at the slice baseline and the exception names its removal slice; it may not authorize new or broader violations.
10. **Implementation iterations** — call `openspec-action --artifact apply`, then use `ddd-develop` and `ddd-git-delivery`; generic `openspec-apply-change` may provide task context but may not own the implementation. Establish a safe Git baseline, then move one real consumer path per verified local commit. Build Coding prompts from the selected roadmap item and current model contract. Keep old and new paths observable until cutover acceptance. Synchronize OpenSpec tasks with each slice. Require design and architecture conformance evidence plus `ddd-implementation-evidence/v2`: complete AC/INV coverage, all required test levels including characterization, real-consumer E2E, and the same acceptance scenarios passing at `baselineSha` and `implementationSha` with no unapproved differences. Block unmapped paths, new dependency violations, cross-module internal imports, actual cycles, incomplete tests, mock-only E2E, or failed behavior comparison. Record actual code/test/Git evidence only in `VI-final-acceptance.md`; never mix pre-existing user changes or push automatically. Final approval archives the change so approved behavior becomes the current Spec document and the migration rationale remains in history.
11. **Model and final review** — use `ddd-model-review`; verify behavior preservation, 100% approved-model coverage, target-boundary improvement, dependency direction, exception shrinkage, ownership, legacy retirement, operational handover, complete test coverage, passed required levels, real E2E, and passed before/after behavior comparison.

## Vague or oversized request handling

Treat requests such as “重构整个项目”, “把项目改成 DDD”, “完成重构”, or requests without a named business problem, preserved behavior, or completion measure as non-executable intent, not permission for a project-wide rewrite.

For a new vague or oversized request:

1. Inspect repository-level evidence only deeply enough to identify real entry points, consumers, business journeys, change hotspots, coupling, and operational risk.
2. Write `项目级愿景与本轮范围`, `保留行为与非目标`, `候选重构切面`, `推荐试点切面`, and `本轮完成与项目完成口径` into `I-strategic-eventstorm.md`.
3. Define candidate seams as end-to-end business journeys or real consumer paths, not packages, tables, layers, or speculative microservices.
4. Compare at least two meaningful candidates by business value, domain complexity, coupling exposure, behavior-protection evidence, migration risk, dependency order, observability, and rollback feasibility.
5. Recommend one bounded seam for this workflow. The recommendation is a discovery scope and pilot hypothesis; strategic design still owns final subdomains, contexts, ownership, and deployment mapping.
6. Continue to baseline recovery and Big Picture EventStorming for the recommended scope without adding another human gate. At milestone I, present the alternatives, recommendation, evidence, and scope boundary together; a revision returns to scope convergence in the same change.

If “完成重构” clearly refers to exactly one active refactoring change, resume that change instead of initializing another one. If it refers to no identifiable change or several active changes, resolve the intended change and completion level before proceeding. Never report project-wide completion when only the current workflow's approved seam and tasks are complete.

## Bottom-up evidence rules

- Treat packages, tables, and service names as evidence, not domain truth.
- Cite current code, tests, schema, messages, logs, or domain-owner confirmation for every AS-IS statement.
- Mark TO-BE boundaries separately from recovered facts.
- Preserve public behavior unless an approved artifact explicitly changes it.
- Stop and return to baseline discovery when the target model cannot explain an important current behavior.
- Use a new workflow instead of converting a refactor into a greenfield rewrite.
