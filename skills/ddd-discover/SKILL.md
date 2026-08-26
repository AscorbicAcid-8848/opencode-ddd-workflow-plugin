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

## Design-Level mode

Use one approved implementation unit and bounded context plus its use-case package. Trace:

`acceptance result → command → rule/policy → domain event or rejection → read model/output`

Identify failure conditions, business errors, state effects, idempotency, retry/compensation, concurrency, invariant candidates, transaction hotspots, and storage needs. Aggregates, application services, domain services, and repositories remain candidates until tactical design.

If an invariant requires synchronous consistency across bounded contexts, stop and return to strategic design.
