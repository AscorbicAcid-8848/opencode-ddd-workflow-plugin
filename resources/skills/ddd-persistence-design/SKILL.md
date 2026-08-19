---
name: ddd-persistence-design
description: "Map an approved microservice use-case package, Design-Level EventStorming storage hotspots, aggregates, repositories, events, and query needs to infrastructure persistence designs covering schemas, mapping boundaries, migrations, concurrency, caching, projections, Outbox/Inbox reliability, and data ownership. Use after domain modeling and before production implementation."
---

# DDD Persistence Design

本 Skill 只属于 `context-tactical-design`：消费已批准的战术事件风暴和领域模型，在 `IV-tactical-design.md` 确定持久化映射、迁移、并发、缓存、投影与可靠消息设计。Schema 服务于领域模型，不得反向决定战略或聚合边界；此阶段不执行迁移、不编辑代码。

Preserve the domain model while designing infrastructure. Do not reshape aggregates merely to mirror tables.

## Required inputs

Require one approved microservice use-case package, Design-Level persistence hotspots, approved aggregates and invariants, repository semantics, application transaction boundaries, domain/integration events, query use cases, existing schema constraints when applicable, and service/context data ownership.

## Method

1. Map each aggregate root, entity, and value object to storage structures with explicit reconstruction rules.
2. Define repository adapter operations and separate projection/query stores where needed.
3. Define identifiers, uniqueness, foreign-reference-by-ID, indexes, retention, and audit fields.
4. Select optimistic/pessimistic concurrency and explain conflict behavior.
5. Define transaction boundaries and reliable event publication with Outbox/Inbox or an equivalent mechanism.
6. Assign cache and projection ownership, invalidation, staleness, rebuild, and fallback behavior.
7. For existing systems, define expand/migrate/contract steps, backfill, dual-read/write constraints, verification, and rollback.
8. Check that no storage relation silently creates a cross-aggregate or cross-context transaction.
9. Express implementation-facing repository signatures, query predicates, ordering/pagination semantics, SQL/index intent, migration steps, and verification queries precisely enough to implement without rediscovering persistence decisions.

## Outputs

Produce:

- aggregate-to-storage mappings;
- repository adapter designs;
- schema/index and migration decisions;
- concurrency and transaction rules;
- cache/projection ownership;
- Outbox/Inbox and replay/idempotency rules;
- data migration, verification, and rollback plans.
- concrete repository/query signatures and a mapping to expected schema/migration and test paths.

## Gate

Reject shared tables with ambiguous ownership, cross-context database writes, ORM-driven aggregate boundaries, unversioned event persistence, migrations without rollback/verification, or caches treated as authoritative without an explicit decision.
