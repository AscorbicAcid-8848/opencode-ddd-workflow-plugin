# opencode-ddd-plugin-v2

A lightweight OpenCode SDK plugin for DDD/OpenSpec workflows, redesigned for LLM
follow-ability. It keeps the six-milestone DDD process (Big Picture EventStorming →
strategic design → Design-Level EventStorming → tactical design → delivery plan →
implementation → final acceptance) and OpenSpec change integration, but replaces the
~450 KB runtime of the previous version with a small deterministic state machine and
one model-facing tool.

## Why v2

The previous `opencode-ddd-workflow-plugin` was hard for models to follow: enormous
semantic-graph contracts, aggressive hard-stop protection, context budgets, and a 9-step
typed submission envelope. v2 keeps the parts that matter and drops the parts that trip
models up:

- **One tool**: `ddd_lifecycle` with a compact lifecycle action set.
- **One-call stage submit**: `complete-stage` accepts `{ stage, summary, sections }` — Markdown section content, no
  items/relations/deferredItems graph.
- **One-call OpenSpec plan**: `openspec-plan` writes proposal, delta specs, design and tasks without four extra model turns.
- **Focused hard gates**: legal stage order, complete human documents, intent preservation,
  intrinsic stage scope, real implementation Commit and honest runtime blocking.
- **Bounded execution**: evidence and implementation stages reject subagent fan-out,
  repeated exploration, command churn and temporary tool downloads.
- **Small runtime**: ~1.5k lines of TypeScript vs ~450 KB.

## Install

Requires Node.js ≥ 20.19.0.

```powershell
cd opencode-ddd-plugin-v2
npm install
npm test
```

Register with OpenCode by pointing a plugin entry at the built `dist/index.js`, e.g. in
your global config `~/.config/opencode/plugins/ddd-workflow.js`:

```js
export { DddWorkflowPlugin as default } from "<path>/opencode-ddd-plugin-v2/dist/index.js"
```

Copy `skills/ddd-orchestrate/SKILL.md` into your skills directory, or load it via the
`skill` tool when starting a workflow.

## Usage

```
/ddd 为现有系统新增用户到店预约功能
```

The model routes the request, calls `ddd_lifecycle(init)`, then loops
`prepare → bounded work → complete-stage` until a human gate, where it presents the review checklist and
waits for 批准/修改/拒绝.

### Example tool calls

Init:
```json
{ "action": "init", "workflow_type": "add-feature", "workflow_id": "store-visit-reservation",
  "input": { "title": "用户到店预约", "request": "为现有系统新增用户到店预约功能，保留现有订单行为" } }
```

Prepare next stage:
```json
{ "action": "prepare", "input": {} }
```

Complete one stage atomically:
```json
{ "action": "complete-stage", "input": { "stage": "01-current-evidence",
  "summary": "现状证据已盘点并形成可执行验收约束基线。",
  "sections": { "输入场景与现状事实": "...", "证据与追踪": "..." },
  "observations": [{ "heading": "输入场景与现状事实", "kind": "current-behavior-fact",
    "statement": "...", "evidence_refs": ["test:..."] }] } }
```

Review:
```json
{ "action": "review", "input": { "stage": "02-big-picture-event-storm",
  "decision": "approve", "reviewer": "pm" } }
```

## Architecture

```
src/
  index.ts      Native SDK tools, commands, agents, and guards
  engine.ts     init/prepare/submit/review/status/archive/openspec
  transition.ts state-machine transition logic (linear + human gates + repeatable + backtrack)
  catalog.ts    loads workflow-profiles.json
  documents.ts  milestone skeleton + section publishing
  openspec.ts   OpenSpec CLI integration
  state.ts      workflow-state.json load/save
  fs.ts         filesystem helpers
  types.ts      core types
resources/references/
  workflow-profiles.json          three workflow stage sequences (reused from v1)
  milestone-document-contracts.json fixed milestone section layout (reused from v1)
skills/ddd-orchestrate/SKILL.md   LLM instructions
tests/engine.test.mjs             state-machine tests
```

## Three workflows

| Type | First real stage | Human gates |
|---|---|---|
| `add-feature` | `01-current-evidence` | I, II, III, IV, V, VI |
| `refactor-system` | `01-refactoring-scope-convergence` | I, II, III, IV, V, VI |
| `create-system` | `01-system-scenarios` | I, II, III, IV, V, VI |

Each workflow = one OpenSpec change at `openspec/changes/<workflow-id>/ddd/` with six
milestone documents (I–VI), a `.ddd/workflow-state.json`, and standard OpenSpec
proposal/specs/design/tasks generated at milestone V.
