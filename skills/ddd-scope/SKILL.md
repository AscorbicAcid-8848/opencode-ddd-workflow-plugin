---
name: ddd-scope
description: Turn a vague business request into explicit system-level scenarios, goals, non-goals, preserved behavior, terminology seeds, and measurable outcomes before domain discovery.
---

# DDD scope

## Terms

- **System-level user scenario**: an actor's business goal and observable result across the whole system, independent of internal modules or APIs.
- **Goal**: a business outcome this change must create.
- **Non-goal**: an adjacent capability explicitly excluded from this change.
- **Preserved behavior**: an existing observable result that refactoring or extension may not alter without approval.
- **Ubiquitous-language seed**: a business noun, verb, state, or rule whose meaning must be clarified later.

## Method

1. State the business problem and desired value in business language.
2. Identify actors, triggers, main outcome, rejection outcomes, and time or quality constraints.
3. Separate project aspiration from this workflow's bounded objective.
4. Make goals, non-goals, assumptions, and preserved behavior explicit.
5. For broad refactoring, compare several end-to-end business seams and recommend one bounded pilot with a measurable completion condition.

Do not infer services, bounded contexts, aggregates, tables, APIs, or framework choices.
