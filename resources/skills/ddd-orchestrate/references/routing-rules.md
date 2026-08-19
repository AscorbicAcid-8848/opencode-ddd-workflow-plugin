# DDD Workflow Routing Rules

## Decision table

| Evidence | Route | Reason |
|---|---|---|
| Existing system; primary goal is one new user-visible capability; existing behavior and most boundaries must remain | `add-feature` | Start from code/runtime evidence and deliver one vertical slice |
| Existing system; primary goal is domain recovery, architecture migration, boundary correction, modularization, or microservice extraction across multiple flows | `refactor-system` | Characterize AS-IS behavior before migrating toward target boundaries |
| No production system; primary goal is a new product/system from system-level user scenarios | `create-system` | Perform strategic design before any service-internal tactical design |

## Strong intent phrases

- `add-feature`: “新增功能”, “增加能力”, “实现一个需求”, “给现有项目加”.
- `refactor-system`: “DDD 重构”, “改造成 DDD”, “拆分子系统/微服务”, “恢复领域模型”, “迁移旧系统”.
- `create-system`: “从零创建”, “新建项目”, “绿地项目”, “先做领域设计再开发”.

Phrases are evidence, not the only criterion. Repository state and preservation intent take precedence.

## Ambiguity handling

Ask one question only when the answer changes the route:

> 你的主要交付目标是先上线这个单一功能，还是借此迁移整个项目的领域边界？

If the user chooses the feature, route `add-feature` and record broad refactoring as a non-goal. If the user chooses migration, route `refactor-system` and use the feature only as a pilot slice.

## Non-rules

- Existing repository does not always mean refactoring; a local feature belongs to `add-feature`.
- Microservice vocabulary does not automatically mean `refactor-system`; inspect whether the user requests broad boundary migration.
- A bounded context is a semantic and ownership boundary, not automatically a deployable service.
- Bottom-up means evidence begins with the current system; it does not mean deriving domain truth from tables or packages without human confirmation.
