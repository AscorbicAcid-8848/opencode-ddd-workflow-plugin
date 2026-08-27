---
name: ddd-implementation
description: Implement exactly one approved DDD vertical slice using the approved model, paths, tests, and contracts, producing real consumer, runtime, and Git evidence.
---

# Approved-slice implementation

Implement one planned slice, not a new design session.

1. Select only a slice ID returned as approved and dependency-ready by the lifecycle; read its acceptance criteria, model elements, invariants, consumers, paths, and verification commands.
2. Implement domain behavior first, then application orchestration, adapters, persistence, and the real delivery entry point needed by that slice.
3. Add tests at the layers required by risk: domain, application, integration/contract, architecture, and real-consumer E2E as applicable.
4. Run declared verification. If infrastructure is unavailable, report a runtime block rather than inventing evidence or downloading substitute tools.
5. Commit only the coherent slice and record the exact SHA and rollback command.

Do not change approved strategic or tactical decisions during coding. A necessary deviation returns to its owning milestone.
