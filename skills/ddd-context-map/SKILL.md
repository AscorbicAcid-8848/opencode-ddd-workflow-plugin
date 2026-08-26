---
name: ddd-context-map
description: Define strategic relationships, upstream/downstream direction, translation, contract ownership, failure handling, and deployment mapping between approved bounded contexts.
---

# Context mapping

## Terms

- **Upstream**: owns the model or contract on which another context depends.
- **Downstream**: consumes an upstream contract and absorbs compatibility impact.
- **Published Language**: a versioned shared contract used for integration, not a shared internal model.
- **Open Host Service**: a stable integration service exposed to multiple consumers.
- **Anti-Corruption Layer**: translation protecting a context's model from another model's semantics.
- **Customer–Supplier**: upstream and downstream coordinate contract evolution.
- **Conformist**: downstream deliberately adopts upstream semantics without translation.
- **Shared Kernel**: a small jointly owned model with explicit coordination cost.

## Method

For every cross-context interaction, state business purpose, direction, exchanged meaning, chosen relationship pattern, contract owner, versioning, timeout/failure behavior, idempotency, and translation. Distinguish internal domain events from cross-context integration events.

Map contexts to existing or approved modules/applications/microservices separately. Do not introduce microservices merely because contexts exist.
