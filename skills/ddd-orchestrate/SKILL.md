---
name: ddd-orchestrate
description: "Route a DDD request to one of three human-gated workflows and drive it through six milestones with the ddd_lifecycle tool. Use when the user wants DDD-based feature delivery, system refactoring, or new-system creation."
---

# DDD Orchestrator (v2 — LLM-friendly)

You drive DDD workflows with **one tool**: `ddd_lifecycle`. It is a deterministic state machine. Always follow the `transition` it returns; never guess state from files.

## Step 1 — Route

Pick exactly one workflow type:

- `add-feature` — existing system, deliver **one** new user-visible capability, keep most boundaries.
- `refactor-system` — existing system, recover the domain model / migrate boundaries / split services.
- `create-system` — greenfield, design from system-level scenarios before any code.

If genuinely ambiguous, ask **one** question:
> 你的主要目标是先上线这个单一功能，还是借此迁移整个项目的领域边界？

## Step 2 — Init

Call `ddd_lifecycle` once:

```json
{
  "action": "init",
  "workflow_type": "<add-feature|refactor-system|create-system>",
  "workflow_id": "<kebab-case-id>",
  "input": { "title": "<短标题>", "request": "<用户的业务目标、规则、排除项、质量约束，原文复制，去掉工具名/JSON/里程碑导航>" }
}
```

`init` creates the OpenSpec change at `openspec/changes/<workflow-id>/ddd/` and auto-completes the `00-request` stage. The returned `transition.nextStage` tells you the first real stage.

**Never call `init` twice.** If the user says continue/resume/approve, or you already have a workflow id, skip init and use `status` then the action the transition requests.

## Step 3 — Advance (repeat until a human gate)

While `transition.requiredAction` is `continue` or `select-next-stage`:

1. **Prepare** the next stage:
   ```json
   { "action": "prepare", "input": { "stage": "<transition.nextStage or your selected stage>" } }
   ```
   Read the returned `stageCard`. It tells you: stage id/title, milestone, checklist, skills to load, quality contract, and the exact `submitFormat`.

2. **Do the work** described by the checklist. Load only the skills listed in `stageCard.skills`. For evidence stages, obey `stageCard.evidenceBudget`: combine related terms into one targeted search, then read only relevant files or line windows; never dump an entire large SQL/log/history file, spawn subagents, or create exploration todos. The host hard-stops repository call 9; never retry a denied call. Missing proof becomes an explicit evidence gap instead of wider exploration. Design freely for design stages.

3. **Submit** with the format from `stageCard.submitFormat`:
   ```json
   {
     "action": "submit",
     "input": {
       "stage": "<stageCard.stageId>",
       "summary": "<一句话阶段结论，>=20 字>",
       "sections": { "<里程碑文档章节标题>": "<该章节 Markdown 正文>" }
     }
   }
   ```
   - `sections` keys must come from `stageCard.allowedSectionHeadings` and match the milestone template's `## ` headings exactly (e.g. `一页结论`, `业务主题与分析范围`). Put `###` subsections inside the value; never repeat a `##` heading in the value.
   - If `findings` contains **blocking** items, fix and submit again. **warning** items are advisory.
   - The runtime writes your `sections` into the milestone document and records a checkpoint.
   - For implementation stages, also pass `sliceId`. For delivery-plan stages, pass `plannedSlices`.

4. Look at the new `transition`. Repeat until `requiredAction === "await-human-review"`.

## Step 4 — Human gate

When `transition.requiredAction === "await-human-review"`:
- Output the `transition.message` verbatim (it contains the review checklist).
- **Stop** and wait for the human to say 批准/修改/拒绝.
- Record the decision:
  ```json
  { "action": "review", "input": { "stage": "<transition.nextHumanGate>", "decision": "<approve|revise|reject>", "reviewer": "<name>", "feedback": "<optional>" } }
  ```

- `approve` → continue to the next milestone.
- `revise` → `transition.allowedNextStages` lists the stages that own the feedback; `prepare` one of them, fix, `submit` again.
- `reject` → workflow stops.

## Step 5 — Archive

After the final milestone (VI) is approved, `transition.requiredAction === "archive"`. Call:
```json
{ "action": "archive" }
```
It runs OpenSpec strict validation and archives the change. On success the workflow is `complete`.

## OpenSpec artifacts

At delivery-plan stages (`openspecArtifactGate`) and for explicit queries, use:
```json
{ "action": "openspec", "input": { "artifact": "<proposal|specs|design|tasks|apply>" } }
```
- `apply` validates the change strictly before implementation.
- Others report whether the artifact file is present.

## Scope discipline

Keep decisions in order: scenarios → Big Picture EventStorming → strategic design → Design-Level EventStorming → tactical design → delivery plan → implementation → final acceptance. Big Picture never decides APIs/aggregates; tactical design owns aggregates/services/persistence. The `stageCard.checklist` is your scope guard — answer every item.

## Rules

- Use **only** `ddd_lifecycle` to change workflow state. Never hand-edit `workflow-state.json` or milestone documents.
- Every tool call is valid machine JSON with ASCII `"` delimiters.
- `workflow_type` + `workflow_id` are required on `init`; later calls may omit them when the project has exactly one active change.
- Roman numerals (I–VI) are human labels; pass the exact internal stage id (e.g. `02-big-picture-event-storm`) returned by `status`/`transition`.
- If you only have a Roman label from the user, call `status` first with `view="compact"`, then use the returned `nextHumanGate` as the `review.stage`.
- Keep one stage transaction compact. Do not announce or attempt parallel exploration; the lifecycle already supplies the complete stage contract.
