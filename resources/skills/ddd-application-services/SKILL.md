---
name: ddd-application-services
description: "Design DDD application services from an approved microservice use-case package and Design-Level EventStorming results, defining command/query handlers, orchestration, transaction demarcation, authorization, repository usage, event publication, errors, and idempotency while keeping business rules in the domain model. Use before implementation or when reviewing service-layer responsibilities."
---

# DDD Application Services

本 Skill 只在 `III-tactical-eventstorm.md` 已批准后执行，属于 `context-tactical-design`。先读 `../ddd-orchestrate/references/phase-scope-contracts.md` 与 `../ddd-orchestrate/references/milestone-document-contracts.json`，在 `IV-tactical-design.md` 的隐藏标记区持久化 `<!-- ddd-scope:context-tactical-design -->`，并只更新固定的应用服务及相关业务章节。可以最终确定应用服务、命令/查询处理器、事务、授权、幂等、仓储调用和事件发布设计；不得重新划分子域/限界上下文/部署边界，也不得直接编辑生产代码。

Design use-case orchestration, not domain logic.

## Required inputs

Require one approved microservice use-case package, its owning bounded context, Design-Level commands/events/policies/read models, aggregate candidates, integration contracts, and transaction/consistency constraints.

## Method

1. Map each service use case to one application operation or an explicit coordinated process.
2. Define input command/query, caller, authorization, validation boundary, output, and public errors.
3. List repository loads, aggregate behaviors, domain-service calls, saves, and event publication in order.
4. Mark the transaction boundary and behavior after commit.
5. Define idempotency, concurrency conflict, retry, timeout, and compensation handling.
6. Keep business decisions in aggregates, value objects, specifications, policies, or domain services.
7. Separate reads that need projections from aggregate repositories.
8. Trace every operation to acceptance criteria and Design-Level events.
9. Express implementation-facing signatures for every operation: operation name, typed input fields, output fields, public errors, repository methods, transaction boundary, and post-commit behavior. Reuse existing project conventions where compatible.

## Outputs

Produce:

- an application-service/use-case catalog;
- command and query handler contracts;
- orchestration sequence tables;
- transaction and post-commit rules;
- authorization, idempotency, error, and retry policies;
- acceptance-criteria traceability.
- concrete operation/handler signatures and request/response/error DTO contracts;
- an implementation map to the existing entry point, service, adapter, and test locations.

## Gate

Reject god services, CRUD-only orchestration that bypasses invariants, transactions spanning bounded contexts, direct infrastructure leakage, business rules implemented only as application-layer conditionals, or conceptual catalogs that omit signatures and executable acceptance/test mapping.
