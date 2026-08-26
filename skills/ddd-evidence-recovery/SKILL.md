---
name: ddd-evidence-recovery
description: Recover an existing system's observable behavior, contracts, data ownership, tests, and compatibility constraints before DDD modeling. Use only for an existing-system evidence stage, not for target design.
---

# Existing-system evidence recovery

Treat code and data as evidence of current behavior, not automatically as the intended domain model.

## Terms

- **Fact**: directly supported by a reachable code path, public contract, schema, test, runtime observation, or approved current spec.
- **Hypothesis**: a plausible explanation not yet demonstrated by evidence.
- **Evidence gap**: a question whose proof is unavailable within the stage budget.
- **Behavior baseline**: observable inputs, outcomes, errors, side effects, ordering, and compatibility that later work must preserve or explicitly change.

## Method

1. Start from the requested user scenario and choose 2–6 stable code-search terms for the runtime `evidence-bundle`.
2. Consume that single bundle as the complete bounded view of the relevant path through behavior, state, integrations, tests and OpenSpec history. Do not issue repository or shell calls after it.
3. Separate facts, hypotheses, and gaps. Never turn a type, empty stub, or table name into runtime proof.
4. Record current success and failure behavior as executable Given/When/Then constraints.
5. Inspect relevant current OpenSpec specs and historical DDD decisions; state explicitly when none exist.
6. Stop at the evidence budget. Unknowns remain gaps rather than triggering a repository sweep.

## Submission contract

When the stage card requires typed claims, represent every asserted fact or compatibility constraint as a claim with its authority, evidence strength, availability, evidence subject, and exact destination section. Repeat each `claim.statement` verbatim in that section. An absence claim also needs `availability=absent` and a `search:` reference describing the searched scope. Target architecture, schema choices, read-only implementation, and rollback plans are not evidence; turn unresolved questions into `evidence-gap` or `open-question` claims.

Do not decide target bounded contexts, aggregates, services, persistence design, or implementation files.
