---
name: ddd-persistence-design
description: Map approved aggregates, repositories, events, and query needs to schemas, indexes, migrations, caches, projections, and reliable messaging without letting storage redefine the domain model.
---

# Persistence design

## Terms

- **Persistence mapping**: translation between a domain model and stored representation.
- **Projection**: read-optimized state derived from authoritative facts.
- **Outbox/Inbox**: atomic publication and idempotent consumption patterns for reliable integration messages.
- **Optimistic concurrency**: detecting conflicting updates with a version rather than locking all readers.

For each aggregate define repository operations, atomic write set, concurrency strategy, mapping ownership, and transaction limits. For each query define predicates, ordering, pagination semantics, projection ownership, and index intent. For migrations define forward steps, backfill/dual-operation rules, verification, compatibility window, and rollback.

Caches and projections are not authoritative unless explicitly decided. Reject shared-table ownership across contexts, cross-context writes, ORM-driven aggregate boundaries, and migrations without verification and rollback.
