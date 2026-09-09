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
2. Consume that single bundle as the available bounded view, not proof that the business journey is fully covered. Do not issue repository or shell calls after it. Runtime limits remain authoritative.
3. Separate facts, hypotheses, and gaps. Never turn a type, empty stub, or table name into runtime proof.
4. Record current success and failure behavior as executable Given/When/Then constraints.
5. Inspect relevant current OpenSpec specs and historical DDD decisions; state explicitly when none exist.
6. Stop at the evidence budget. Unknowns remain gaps rather than triggering a repository sweep.

## Recover behavior along the proposed journey

Choose search terms from the candidate pilot and its collaborating responsibilities, not only the application's most prominent entity. Trace the available evidence from entry/trigger through rule, state change and observable result, including tested rejection paths. Separate code-supported behavior, contract declarations and tests actually executed; a test's existence or a success status assertion does not prove complete behavior coverage.

Within the existing baseline sections, assess coverage for the scenario's trigger, main result, material alternatives, ownership/dependencies and compatibility. Preserve all relevant available facts in the typed claims consumed downstream; prose-only evidence must not disappear simply because its claim was omitted. A claim should express the evidenced behavior, not a stronger interpretation of a framework class or schema.

When a recommended pilot is less evidenced than another capability, say so explicitly. For each material gap, state the missing behavior, affected decision, bounded source/terms that could resolve it, and latest safe resolution stage. Selection-critical gaps must precede approval of the affected pilot/boundary; implementation-only details may wait until their owning implementation step. Carry the same distinction into downstream handoff. Do not describe the baseline as complete, substitute a better-evidenced but unrelated capability, or defer a decision-critical unknown to coding merely to keep the workflow moving.

Unavailable evidence may be reported within the runtime budget; it must not turn into an unsupported positive recommendation. These instructions do not permit additional tool calls beyond the runtime contract or require every project to have compensation, messaging or complex exceptions.

## Submission contract

When the stage card requires typed claims, represent every asserted fact or compatibility constraint as a claim with its authority, evidence strength, availability, evidence subject, and exact destination section. Repeat each `claim.statement` verbatim in that section. An absence claim also needs `availability=absent` and a `search:` reference describing the searched scope. Target architecture, schema choices, read-only implementation, and rollback plans are not evidence; turn unresolved questions into `evidence-gap` or `open-question` claims.

Do not decide target bounded contexts, aggregates, services, persistence design, or implementation files.
