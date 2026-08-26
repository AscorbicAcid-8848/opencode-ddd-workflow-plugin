---
name: ddd-roadmap
description: Turn approved strategic and tactical design into independently valuable, testable, reversible vertical slices and an OpenSpec-owned delivery plan.
---

# DDD delivery roadmap

## Terms

- **Vertical slice**: the smallest independently verifiable business outcome crossing every necessary layer and connected to a real consumer.
- **Walking skeleton**: an initial end-to-end slice proving architecture and integration with minimal but real behavior.
- **Acceptance binding**: explicit mapping from a slice to approved scenarios, model elements, invariants, tests, paths, and verification.

Build slices by business outcome, not controller/service/repository layers. Each slice needs stable ID, dependency, consumer, acceptance criteria, owned model/invariants, expected production and test paths, verification commands, compatibility/migration action, Git boundary, and rollback.

Reject layer-only batches, disconnected endpoints, TODO bodies, mock-only completion, empty ports, and “wire later”. The plan may choose a walking skeleton first but must not reduce the approved domain model to a CRUD shortcut.

Keep proposal, behavior specs, design, tasks, and DDD delivery decisions in the same OpenSpec change. Planning never claims implementation or test results.
