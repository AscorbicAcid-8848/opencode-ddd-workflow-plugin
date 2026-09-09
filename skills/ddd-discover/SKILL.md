---
name: ddd-discover
description: Run either Big Picture EventStorming before strategic design or Design-Level EventStorming inside one approved bounded context before tactical design. Keep the two granularities separate.
---

# EventStorming discovery

EventStorming discovers business knowledge. It does not itself approve strategic boundaries or finalize tactical models.

## Core notation

- **Actor**: a person, role, time trigger, or external system initiating behavior.
- **Command**: an intention to make the business do something, phrased imperatively.
- **Domain event**: a business-significant fact that has already happened, phrased in past tense. “API called”, “row inserted”, and “list returned” are technical facts, not domain events.
- **Policy**: “whenever event X occurs, issue command Y if rule Z holds”.
- **Read model**: information needed to decide or display; a query result is not automatically a domain event.
- **Hotspot**: disagreement, ambiguity, risk, missing rule, or coordination pain requiring a decision.

## Big Picture mode

Use system-level scenarios. Build the end-to-end business timeline across candidate responsibilities. Capture actors, commands, past-tense events, policies, external systems, exceptions, compensation, time constraints, and hotspots. Event clusters are only **boundary clues**; do not name them as approved subdomains, bounded contexts, or microservices.

Classify each capability as existing, current target, or future candidate. An excluded or unsupported adjacent capability may appear only as a hotspot or recommendation, never in the main flow or acceptance result.

### Build journeys, not an operation inventory

An end-to-end journey starts with an actor's business trigger and ends with an observable business outcome or terminal rejection. Its boundary is the selected business goal, not necessarily the entire product or every available operation.

1. Name the goal, initiating actor, trigger, preconditions, and completion outcome. Use the requested scope; do not invent adjacent journeys to fill a quota.
2. Connect relevant commands and past-tense events in business order. Explain each connection: causation, a business policy, a handoff to another actor, or merely a possible later action. Time order alone does not prove causation. Independent goals belong in separate journeys; do not force registration, publishing, following and commenting into one mandatory chain.
3. Mark responsibility handoffs, information needed for decisions, and rules that change the outcome. Describe business responsibility candidates, not final bounded contexts, aggregates or deployments.
4. Attach evidenced exceptions to the step they affect and show the resulting business state. If failure or compensation behavior is unknown, state the exact question and its effect on the journey; do not invent compensations or silently omit the branch.
5. For existing systems, trace each asserted behavior and connection to baseline claims. A CRUD superclass, table or route alone does not establish publication semantics or an entire lifecycle. Distinguish evidence available but not yet represented as a claim from evidence genuinely absent.

Present each journey separately inside the existing event-storm section: a short business-goal label followed by a compact sequence, table or diagram and the material evidence/uncertainty. Do not pack several journeys into one paragraph or add new top-level headings. A simple single-action capability may legitimately have a short journey; completeness concerns its goal and outcomes, not node count or diagram size.

### Discovery completion criteria

- A reviewer can explain how the selected business goal is achieved, where responsibility changes, and where the result can differ. A list of isolated `command → event` pairs is not sufficient for a multi-step journey.
- Every recommendation separates observation, interpretation and expected benefit. A framework base class proves neither the absence of business rules nor that a proposed extraction will remove coupling. Support comparative risk and benefit claims with observed responsibilities/dependencies; otherwise label them hypotheses and identify the evidence that would change the recommendation.
- When evidence cannot support the proposed journey, expose its missing segments and recommend bounded evidence recovery before approving the affected boundary or pilot. Do not promote uncertain events into the confirmed main flow. Obey the runtime budget; this instruction does not authorize extra tools or bypass a gate.
- Summaries state concrete business discoveries, consequences and remaining decisions, not “analysis completed” or artifact counts. Keep them in the existing stage sections; the runtime still owns the Roman review document.

### Consistent decisions and evidence deadlines

For each consequential unknown, identify the decision it could change and the latest safe time to resolve it. Unknown ownership or dependencies that may invalidate pilot selection must be resolved before approving that selection, or the affected selection must explicitly remain unresolved. Implementation-only details may be deferred to their owning stage if they cannot overturn approved boundaries. Use that same deadline in recommendations, decision options and evidence handoff; do not alternate between “before boundary approval” and “before coding” for the same question.

When the stage card requires decisionItems, keep question, option label, impact, resultStatus and blocked proposition consistent. The status describes the chosen outcome, not whether the option is recommended: adopting a capability now is not out-of-scope; explicitly excluding it is. If an option adopts one capability but defers another, name the affected subject unambiguously and split decisions when one status cannot represent both. A deferred option must name a real destination allowed by the current workflow contract, not an invented stage. Before submission, read each option as if selected and check that its resulting business statement matches what the user would understand. Do not write or edit the runtime-owned review section.

## Design-Level mode

Use one approved implementation unit and bounded context plus its use-case package. Trace:

`acceptance result → command → rule/policy → domain event or rejection → read model/output`

Identify failure conditions, business errors, state effects, idempotency, retry/compensation, concurrency, invariant candidates, transaction hotspots, and storage needs. Aggregates, application services, domain services, and repositories remain candidates until tactical design.

If an invariant requires synchronous consistency across bounded contexts, stop and return to strategic design.
