---
name: ddd-model-review
description: Review end-to-end consistency from scenarios and strategic boundaries through tactical models and, at final acceptance, real code, tests, runtime, Git, and OpenSpec evidence.
---

# DDD model review

Review; do not silently redesign. Route every defect to the stage that owns the decision.

## Design review

Check bidirectional traceability:

`system scenario → Big Picture event → strategic responsibility → implementation-unit use case → Design-Level command/event → application service → aggregate/invariant → persistence/test`

Verify ubiquitous-language consistency, context ownership, aggregate/invariant fit, event completeness, application/domain responsibility separation, integration-contract direction, persistence alignment, and executable test mapping. A candidate model, unresolved invariant, or missing consumer is `Not Ready`.

## Final acceptance

Require real production changes, all planned slices, AC/invariant test coverage, required test layers, real-consumer E2E, architecture checks, Git commit and rollback evidence, compatibility results, and OpenSpec task/strict-validation status. Refactoring additionally requires the same characterization scenarios before and after with no unapproved behavioral difference.

Documents, workflow status, mocks, empty adapters, and unexecuted commands are not implementation evidence.
