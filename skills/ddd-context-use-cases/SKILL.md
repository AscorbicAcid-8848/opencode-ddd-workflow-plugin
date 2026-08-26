---
name: ddd-context-use-cases
description: Convert approved system scenarios and strategic responsibilities into self-contained business use-case packages for each implementation unit and bounded context.
---

# Implementation-unit use cases

An **implementation unit** is the existing or approved deployable/application boundary: it may be a monolith module, an application, or a microservice. A **use-case package** is the strategic handoff to tactical discovery.

For each selected unit define:

- owning bounded context and responsibility;
- actor and business trigger;
- command intent and required information;
- preconditions and authorization meaning;
- successful business outcome;
- rejection and failure outcomes;
- upstream/downstream interactions as business contracts;
- acceptance criteria and traceability to system scenario and strategic event.

Keep rules at business level. Do not design handlers, aggregates, repositories, DTOs, tables, transactions, or framework APIs.
