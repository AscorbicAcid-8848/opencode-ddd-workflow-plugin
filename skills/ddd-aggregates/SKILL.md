---
name: ddd-aggregates
description: Design aggregate roots, entities, value objects, invariants, and consistency boundaries from approved use cases and Design-Level EventStorming.
---

# Aggregate design

## Terms

- **Invariant**: a business rule that must be true after every successful transaction.
- **Aggregate**: a consistency boundary protecting a set of business invariants.
- **Aggregate root**: the only external entry to mutate objects inside an aggregate; it controls lifecycle and invariants.
- **Entity**: an object defined by identity and lifecycle continuity.
- **Value object**: an immutable concept defined by its attributes and validated as a whole.

## Method

1. List invariants with triggering command, protected state, rejection result, and concurrency requirement.
2. Group only state that must change atomically to protect those invariants.
3. Choose the root that owns identity, lifecycle, and legal transitions.
4. Put behavior on domain objects; prevent external mutation of internals.
5. Reference another aggregate by identity, not by embedding its mutable object graph.
6. Compare at least two meaningful boundaries when consistency and scalability trade off.

Do not derive aggregates from tables, JSON shape, CRUD screens, or noun counting. Cross-aggregate consistency normally uses domain events, policies, or an explicit process, not one oversized transaction.
