---
name: ddd-git-delivery
description: Manage local Git history during the coding phase of a DDD feature, refactoring, or greenfield workflow. Use after an approved tactical model and delivery roadmap, when ddd-develop implements vertical slices and each verified slice must have an isolated baseline, reviewable commit, traceable domain intent, and reversible delivery history without absorbing unrelated user changes or pushing automatically.
---

# DDD Git Delivery

Treat `openspec/changes/<workflow-id>/` and task checkbox updates as slice-owned delivery files when they correspond to the implemented slice. Include them in the same reviewable local commit or an immediately adjacent spec-only commit with explicit traceability. Never archive the OpenSpec change during Coding; final DDD approval owns archive.

Own Git version management for the coding phase. Let `ddd-develop` own implementation and tests; use this skill before, during, and after each vertical slice.

## 1. Establish a safe baseline

Before modifying production code:

1. Locate the actual repository root and confirm `git rev-parse --show-toplevel`.
2. Record the current branch, `HEAD`, remotes, and `git status --short`.
3. Treat every pre-existing modification and untracked file as user-owned. Never reset, discard, stash, amend, or include it merely to obtain a clean tree.
4. Compare the approved roadmap slice with the dirty paths. If they overlap and cannot be separated safely, stop and ask the human how to preserve them.
5. Use a dedicated workflow branch such as `ddd/<workflow-id>` when it can be created without disturbing user work. Never switch branches through a dirty overlap.
6. If no Git repository exists, ask before `git init`; record the initial baseline after repository initialization.

Write the baseline branch, SHA, dirty-path ownership, selected slice, and rollback point into the `证据与追踪` section of `VI-final-acceptance.md`. Do not create another human-facing Git document.

## 2. Commit one verified vertical slice

For every slice selected by `ddd-roadmap` and implemented by `ddd-develop`:

1. Bind the slice to its service use case, acceptance criteria, bounded context, and roadmap item.
2. Implement and verify the real consumer path before committing.
3. Inspect `git diff`, stage only explicit slice-owned paths, then inspect `git diff --cached`.
4. Never use broad staging such as `git add -A` when the worktree contains unrelated changes.
5. Refuse the commit when required focused or integration tests fail. Do not create automatic WIP commits.
6. Create one cohesive local commit for the complete slice. Prefer:

```text
<type>(<bounded-context>): <business outcome>
```

Use `feat` for a capability, `refactor` for behavior-preserving migration, `fix` for a correction, and `test` only for a test-only slice. In the commit body, include the workflow ID, roadmap item, acceptance criteria, verification commands, and compatibility or rollback note.

7. Record the resulting commit SHA, changed business behavior, tests, and rollback command in the same delivery document.
8. Generate the workflow's `ddd-implementation-evidence/v2` JSON from the reviewed Git range. `productionPaths` and `testPaths` must be actual members of `git diff --name-only <baselineSha>..<implementationSha>`; `consumerPaths` must identify real repository entry points. Preserve the passed test commands, AC/INV coverage mappings, required-level results, real E2E reference, and refactoring comparison references in the same immutable evidence. Do not claim a commit, path, or test result that Git and the executed verification cannot verify.

Do not push, merge, rebase, force-update, amend, delete branches, or create tags unless the human explicitly requests that operation.

## 3. Review the exact Git range

At the end of each implementation checkpoint:

1. Review `baseline..implementation` rather than only the final files.
2. Confirm every commit maps to one approved vertical slice and contains no unrelated paths.
3. Trace the changed production flow and verify domain invariants, contracts, migrations, events, compatibility, and rollback.
4. If the review finds a blocking defect, fix it in a new traceable commit. Do not rewrite already-reviewed history unless the human explicitly requests history cleanup.
5. Feed the exact baseline and implementation SHAs into `ddd-model-review` or the roadmap controller evidence.

An implementation checkpoint is complete only when its tests pass, its commit is locally present, its SHA is linked from the delivery document, and the workflow script accepts its implementation-evidence JSON.

## 4. Close the coding phase

Before final business acceptance:

- show the baseline-to-final commit list in business-slice order;
- report remaining user-owned dirty paths separately;
- confirm required tests and migrations;
- provide a rollback point for every released slice;
- update the `一页结论` and `证据与追踪` sections of `VI-final-acceptance.md`;
- ask separately before push, merge, release tag, deployment, or any remote write.

The Git history is an engineering audit trail, not a replacement for the six Roman-numbered progressive-disclosure DDD milestone documents or the OpenSpec change archive.

## Failure rules

- Dirty overlap with user work → stop before editing or staging.
- Test failure → keep the working change visible, report it, and do not commit.
- Wrong files staged → unstage only the files staged by this workflow; never discard their contents.
- Commit hook failure → fix the cause or report it; never bypass hooks automatically.
- Remote or credential requirement → ask before any network action.
- Destructive or history-rewriting command → require explicit human authorization.
