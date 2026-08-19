# DDD Feature Artifact Contract (legacy compatibility only)

> Do not use this contract to initialize or advance new workflows. New work follows `ddd-orchestrate/references/artifact-layout.md` and the OpenCode SDK `ddd_workflow_*` tools; this document remains only to interpret historical `docs/ddd/features/` evidence.

## Contents

1. Directory contract
2. Stage ownership and required artifacts
3. Semantic delta format
4. Generated file delta
5. Canonical artifact rules
6. Gate and feedback rules

## 1. Directory contract

Use one folder per feature:

```text
docs/ddd/features/<feature-id>/
├── workflow-state.json
├── artifact-index.md
├── increment-log.md
├── 00-request/
│   ├── request.md
│   ├── delta.md
│   └── file-delta.md
├── 01-scope/
│   ├── scope.md
│   ├── delta.md
│   └── file-delta.md
├── 02-discovery/
│   ├── event-flow.md
│   ├── commands-events.md
│   ├── hotspots-ambiguities.md
│   ├── delta.md
│   └── file-delta.md
├── 03-strategic/
│   ├── subdomain-impact.md
│   ├── bounded-context-impact.md
│   ├── context-map-impact.md
│   ├── glossary-delta.md
│   ├── decisions.md
│   ├── delta.md
│   └── file-delta.md
├── 04-tactical/
│   ├── aggregates.md
│   ├── invariants.md
│   ├── domain-interactions.md
│   ├── delta.md
│   └── file-delta.md
├── 05-model-review/
│   ├── pre-implementation-review.md
│   ├── feedback-actions.md
│   ├── delta.md
│   └── file-delta.md
├── 06-roadmap/
│   ├── vertical-slices.md
│   ├── canonical-artifacts.md
│   ├── delta.md
│   └── file-delta.md
├── 07-specification/
│   ├── openspec-links.md
│   ├── delta.md
│   └── file-delta.md
├── 08-implementation/
│   └── iteration-NNN/
│       ├── change-summary.md
│       ├── tests.md
│       ├── runtime-evidence.md
│       ├── delta.md
│       └── file-delta.md
└── 09-final-review/
    ├── model-review.md
    ├── acceptance.md
    ├── delta.md
    └── file-delta.md
```

Create a stage directory only when work on that stage begins. Omit `07-specification` when OpenSpec is not used.

Add a generated `review.md`, immutable `submissions/checkpoint-NNN/` snapshots, and immutable `reviews/review-NNN.md` decisions to every stage and implementation iteration. Each submission snapshot contains `review.md`, `file-delta.md`, and `artifacts/` with the exact substantive stage files reviewed. The compact tree above omits these repeated review entries only for readability.

## 2. Stage ownership and required artifacts

| Stage | Skills | Required artifacts | What changes at this stage |
|---|---|---|---|
| `00-request` | Orchestrator | `request.md`, `delta.md` | Capture the exact request, repository, feature identity, and initial assumptions |
| `01-scope` | `ddd-scope` | `scope.md`, `delta.md` | Add problem/value, goals, non-goals, constraints, success measures, risks |
| `02-discovery` | `ddd-discover` | `event-flow.md`, `commands-events.md`, `hotspots-ambiguities.md`, `delta.md` | Add evidence-backed AS-IS and proposed TO-BE flows |
| `03-strategic` | `ddd-subdomains`, `ddd-contexts`, `ddd-context-map` | Five model files plus `delta.md` | Add feature placement and only the strategic model changes caused by the feature |
| `04-tactical` | `ddd-aggregates`, `ddd-domain-interactions` | Three model files plus `delta.md` | Add or change aggregates, invariants, commands, events, repositories, reliability rules |
| `05-model-review` | `ddd-model-review` | `pre-implementation-review.md`, `feedback-actions.md`, `delta.md` | Add scored review, blocking findings, and feedback destinations |
| `06-roadmap` | `ddd-roadmap` | `vertical-slices.md`, `canonical-artifacts.md`, `delta.md` | Add executable slices and pointers/hashes for canonical roadmap/spec artifacts |
| `07-specification` | `ddd-openspec-bridge` | `openspec-links.md`, `delta.md` | Add pointers/hashes for canonical OpenSpec artifacts |
| `08-implementation/iteration-NNN` | `ddd-develop` | `change-summary.md`, `tests.md`, `runtime-evidence.md`, `delta.md` | Add one production-wired behavior increment and its evidence |
| `09-final-review` | `ddd-model-review`, repository gates | `model-review.md`, `acceptance.md`, `delta.md` | Add final model assessment, acceptance evidence, operational and rollback result |

## 3. Semantic delta format

Every `delta.md` must use these headings:

```markdown
# Stage Delta

Baseline: <previous checkpoint or Git SHA>

## Added

- New business behavior, rule, model, contract, test, or decision.

## Changed

- Existing behavior or artifact whose meaning changed, with before → after.

## Removed

- Removed behavior, assumption, model, contract, or `None`.

## Unchanged

- Important compatibility boundary deliberately preserved.

## Evidence

- Code, test, schema, log, domain-owner confirmation, or artifact link.

## Open Questions

- Question, impact, owner, and decision deadline, or `None`.

## Next Input

- Exact artifacts and decisions the next stage may consume.
```

Do not write “updated model” without identifying the actual semantic change. An empty category must say `None`.

## 4. Generated file delta

The historical feature-artifact workflow generated `file-delta.md` with added, modified, and removed files plus SHA-256 values. The native TypeScript workflow preserves this evidence when migrating historical changes and updates:

- `workflow-state.json` for machine recovery;
- `artifact-index.md` for browsing;
- `increment-log.md` for chronological review.

Do not hand-edit these generated files. Semantic change belongs in `delta.md`; byte-level change belongs in `file-delta.md`.

## 5. Canonical artifact rules

The feature folder is an audit view, not a replacement for tool-owned canonical state.

- `ddd-roadmap` owns `docs/product-brief.md`, `docs/architecture/`, `docs/roadmap/roadmap.json`, `docs/specs/*.json`, and controller state/evidence. Record links and hashes in `06-roadmap/canonical-artifacts.md`.
- `ddd-openspec-bridge` owns `openspec/changes/<change-id>/` and context-organized specifications. Record links and hashes in `07-specification/openspec-links.md`.
- `ddd-develop` owns roadmap run transitions and its designated evidence. Do not copy, edit, or fake controller journals in the feature folder.

## 6. Gate and feedback rules

- Every checkpoint enters `awaiting_review`; checkpoint completion is not human acceptance.
- Every stage and implementation iteration must be explicitly approved before the next stage or iteration begins.
- `approve` permits the next stage; `revise` permits only a corrected checkpoint of the reviewed stage; `reject` stops progression pending replacement direction.
- Record reviewer, timestamp, decision, feedback, reviewed checkpoint, and reviewed artifact hashes in immutable `reviews/review-NNN.md` files.
- Never infer approval from silence or from the human merely continuing the conversation.
- Do not enter strategic design until current behavior contains one main and two exceptional paths.
- Do not enter tactical design until ownership, terminology, and dependency direction are explicit.
- Do not plan implementation while the pre-implementation model review is `Not Ready`.
- Do not code until the user approves roadmap/spec decisions that change public behavior or architecture.
- Do not call an implementation iteration complete without a real consumer, real adapter, observable test, and runtime/operational evidence appropriate to risk.
- Route review findings back to their owning skill and checkpoint the corrected stage again.
- Execute one identical feedback path at most three times; then request an explicit architecture decision.
- Never mark the workflow complete while required artifacts, tests, bindings, or blocking findings remain.

## 7. Human review packet

Generate `<stage>/review.md` at checkpoint time. Make it the single entry point for a human reviewer and include:

- checkpoint identity and `awaiting_review` status;
- one-sentence semantic increment;
- links to all substantive artifacts, `delta.md`, and `file-delta.md`;
- stage-specific acceptance questions written in business-readable language;
- unresolved questions referenced from `delta.md`;
- exact commands for `approve`, `revise`, and `reject`;
- a warning that the next stage is blocked until approval.

Keep every submitted snapshot under `<stage>/submissions/checkpoint-NNN/` while `<stage>/review.md` points to the latest packet. Write each decision to `<stage>/reviews/review-NNN.md`. Never overwrite an earlier submission or review. After `revise`, generate a new checkpoint and a new review decision number so reviewers can compare exact artifacts through `increment-log.md`, archived deltas, and artifact hashes.
