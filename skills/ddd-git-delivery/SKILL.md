---
name: ddd-git-delivery
description: Create auditable local Git boundaries for approved plans and implemented vertical slices, with clean diffs, verification linkage, and rollback evidence.
---

# Git delivery evidence

Before committing, inspect the exact diff and exclude unrelated user changes. A slice commit must contain its real production/test increment, identify the slice and business outcome, and correspond to recorded verification results. Record full commit SHA, changed paths, verification commands/results, and a safe rollback command.

Do not amend or rewrite unrelated history, push without explicit authorization, or use a documentation-only commit as implementation evidence.
