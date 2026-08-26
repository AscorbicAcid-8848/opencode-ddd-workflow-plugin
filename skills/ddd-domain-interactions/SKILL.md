---
name: ddd-domain-interactions
description: Design domain services, domain events, policies, factories, repository abstractions, and cross-aggregate collaboration inside one bounded context.
---

# Domain interactions

## Terms

- **Domain service**: stateless domain logic that genuinely spans concepts and does not naturally belong to one entity or value object.
- **Domain event**: a past-tense business fact produced by the domain model after a valid state transition.
- **Policy**: reacts to a fact and decides a subsequent business command.
- **Repository**: a domain-facing abstraction for loading and saving aggregate roots as conceptual collections.
- **Factory**: creates a valid aggregate when construction requires domain rules or multiple inputs.
- **Integration event**: a stable cross-context message derived from internal facts; it is not automatically identical to the internal domain event.

Specify event meaning, producer, payload limited to stable business facts, consumers, ordering/idempotency, and publication timing. Use a domain service only when placing the rule on an aggregate would distort ownership. Repositories expose domain intent, not arbitrary table access.
