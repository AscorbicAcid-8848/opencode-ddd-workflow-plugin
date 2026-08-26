---
name: ddd-openspec-bridge
description: Translate approved DDD decisions into the same OpenSpec change's proposal, behavior specs, design, tasks, apply validation, and archive lifecycle without replacing domain modeling.
---

# DDD–OpenSpec bridge

DDD owns business discovery and model decisions. OpenSpec owns the executable change record: why behavior changes, what scenarios must hold, how implementation is designed, which tasks remain, and what was archived.

Use one workflow ID and one same-ID OpenSpec change. At the delivery-plan stage, send `proposal`, every `{capability, content}` delta spec, `design`, and checkbox-based `tasks` in one `ddd_lifecycle action=openspec-plan` call, then publish the stage with `complete-stage`. The runtime still writes the official `proposal.md`, `specs/<capability>/spec.md`, `design.md`, and `tasks.md` artifacts in dependency order. Behavior specs express approved Given/When/Then outcomes and trace to their bounded context/use case; design and tasks may not override approved boundaries or invariants. A behavior-preserving refactor may explicitly use `skipSpecs:true`; feature and greenfield workflows may not. Use the single-artifact `openspec` action only to query or recover an individual artifact.

Before implementation require strict validation and applicable behavior specs. Before completion require tasks complete, strict validation successful, and archive successful. Never maintain a shadow `docs/ddd` change history.
