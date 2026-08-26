---
name: ddd-application-services
description: Design application-service command/query handling and use-case orchestration from an approved use-case package and Design-Level EventStorming, while keeping business rules in the domain model.
---

# Application services

## Terms

- **Application service**: coordinates one use case across authorization, domain objects, repositories, transactions, and event publication. It does not own business invariants.
- **Command handler**: application entry for an intention that may change business state.
- **Query handler**: produces a read result without pretending the read itself is a domain event.
- **Transaction boundary**: the atomic consistency scope required by the use case.

For each use case specify input, output/error contract, authorization, idempotency key, loaded aggregates, domain operation invoked, repository calls, transaction demarcation, event publication, and external interaction timing.

Reject an anemic design where the application service calculates domain eligibility, state transitions, pricing, conflicts, or other invariants itself.
