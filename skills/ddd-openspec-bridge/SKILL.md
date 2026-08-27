---
name: ddd-openspec-bridge
description: Translate approved DDD decisions into the same OpenSpec change's proposal, behavior specs, design, tasks, apply validation, and archive lifecycle without replacing domain modeling.
---

# DDD–OpenSpec bridge

DDD owns business discovery and model decisions. OpenSpec owns the executable change record: why behavior changes, what scenarios must hold, how implementation is designed, which tasks remain, and what was archived.

Use one workflow ID and one same-ID OpenSpec change. At delivery planning, send a structured business plan to `ddd_lifecycle action=openspec-plan` with a top-level `plan` object, never a JSON string in `input`: objective, non-goals, capabilities, requirements, Given/When/Then scenarios, and vertical slices with consumers, dependencies, paths, verification, compatibility, and rollback. Do not author proposal/spec/design/tasks Markdown. The runtime validates the graph and compiles the official `proposal.md`, `specs/<capability>/spec.md`, `design.md`, `tasks.md`, and `roadmap.json`. On findings, use top-level `mode=repair` and `plan` with only affected entries; the runtime retains the draft. A behavior-preserving refactor may explicitly use `skipSpecs:true`; feature and greenfield workflows may not. Use single-artifact `openspec` only to query or recover an individual artifact.

Before implementation require strict validation and applicable behavior specs. Before completion require tasks complete, strict validation successful, and archive successful. Never maintain a shadow `docs/ddd` change history.
