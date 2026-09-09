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

For each relevant scenario, identify its initiating need, actor, trigger, business outcome and material alternative outcomes. “Manage users” or a list of CRUD endpoints is a capability label, not a scenario. Do not prescribe a fixed number of scenarios or combine unrelated goals into one journey.

For an existing project before evidence recovery, product conventions and repository names provide hypotheses, not verified capabilities. Mark inferred scenarios and pilot rankings explicitly as provisional; distinguish user-required preservation from behavior actually observed in the implementation.

Compare pilot candidates by business value, behavior coverage, ownership/cooperation dependencies, reversibility and the evidence available for those judgments. Unknown dependencies are not evidence of low coupling. Explain what would change the recommendation and what must be verified before selection. Do not finalize core/supporting/generic classifications here; those belong to strategic design.

Pass scenario-shaped evidence questions to the baseline stage: which entry starts the behavior, what state changes, what observable outcome follows, which failures matter, and where collaborating responsibilities live. Identify which unknowns could overturn pilot selection; distinguish them from implementation details that can safely wait. Maintain the distinction between a design-only request, completion of one pilot, and completion of the whole project. A design-only alternative is not inherently wrong because the default workflow supports coding; the user's requested outcome controls the recommendation.

Do not infer services, bounded contexts, aggregates, tables, APIs, or framework choices.
