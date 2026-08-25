import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { initialize, prepare, submit, review, status } from "../dist/engine.js"

async function freshProject() {
  return mkdtemp(path.join(tmpdir(), "ddd-v2-"))
}

const longSummary = "本阶段结论已完成并形成必要证据，可进入下一里程碑。"

test("init creates state and milestone skeletons", async () => {
  const dir = await freshProject()
  try {
    const t = await initialize({
      workflowType: "add-feature", workflowId: "test-feat-1",
      projectRoot: dir, title: "测试功能", request: "为现有系统新增测试功能",
    })
    assert.equal(t.workflowId, "test-feat-1")
    assert.equal(t.requiredAction, "continue")
    assert.equal(t.nextStage, "01-current-evidence")
    const stateFile = path.join(dir, "openspec", "changes", "test-feat-1", "ddd", ".ddd", "workflow-state.json")
    const state = JSON.parse(await readFile(stateFile, "utf8"))
    assert.equal(state.workflowType, "add-feature")
    assert.equal(state.status, "active")
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("init rejects duplicate workflow", async () => {
  const dir = await freshProject()
  try {
    await initialize({ workflowType: "add-feature", workflowId: "dup", projectRoot: dir, title: "t", request: "r" })
    await assert.rejects(
      initialize({ workflowType: "add-feature", workflowId: "dup", projectRoot: dir, title: "t", request: "r" }),
      /already exists/,
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("prepare returns a stage card for the next stage", async () => {
  const dir = await freshProject()
  try {
    await initialize({ workflowType: "add-feature", workflowId: "p1", projectRoot: dir, title: "t", request: "r" })
    const p = await prepare({ workflowType: "add-feature", workflowId: "p1", projectRoot: dir })
    assert.equal(p.stageCard.stageId, "01-current-evidence")
    assert.ok(p.stageCard.checklist.length > 0)
    assert.equal(p.stageCard.humanGate, false)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("submit advances to next stage and writes document sections", async () => {
  const dir = await freshProject()
  try {
    await initialize({ workflowType: "add-feature", workflowId: "s1", projectRoot: dir, title: "t", request: "r" })
    const r = await submit({
      workflowType: "add-feature", workflowId: "s1", projectRoot: dir,
      stage: "01-current-evidence",
      summary: "现状证据已收集并形成可执行验收约束基线，现状代码与历史战略已盘点。",
      sections: {
        "一页结论": "当前结论：现有系统具备订单能力，本功能在其上新增到店预约。最新业务增量：识别现状证据。",
        "业务主题与分析范围": "业务问题与目标：为现有系统新增测试功能。本轮范围：现状证据收集。",
      },
    })
    assert.equal(r.findings.filter((f) => f.severity === "blocking").length, 0)
    assert.equal(r.nextStage, "02-big-picture-event-storm")
    const doc = await readFile(path.join(dir, "openspec", "changes", "s1", "ddd", "I-strategic-eventstorm.md"), "utf8")
    assert.ok(doc.includes("现有系统具备订单能力"))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("human gate: submit then review approve advances", async () => {
  const dir = await freshProject()
  try {
    await initialize({ workflowType: "add-feature", workflowId: "g1", projectRoot: dir, title: "t", request: "r" })
    for (const stage of ["01-current-evidence", "02-big-picture-event-storm"]) {
      await submit({
        workflowType: "add-feature", workflowId: "g1", projectRoot: dir, stage,
        summary: longSummary,
        sections: {
          "一页结论": "当前结论：本阶段完成，已形成必要证据与结论。",
          "业务主题与分析范围": "业务问题与目标及本轮范围已明确，证据充分。",
        },
      })
    }
    const s = await status({ workflowType: "add-feature", workflowId: "g1", projectRoot: dir, view: "compact" })
    assert.equal(s.humanReviewRequired, true)
    assert.equal(s.requiredAction, "await-human-review")
    const r = await review({
      workflowType: "add-feature", workflowId: "g1", projectRoot: dir,
      stage: "02-big-picture-event-storm", decision: "approve", reviewer: "tester",
    })
    assert.equal(r.reviewRecord.decision, "approve")
    assert.notEqual(r.requiredAction, "await-human-review")
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("review revise routes back", async () => {
  const dir = await freshProject()
  try {
    await initialize({ workflowType: "add-feature", workflowId: "rv1", projectRoot: dir, title: "t", request: "r" })
    for (const stage of ["01-current-evidence", "02-big-picture-event-storm"]) {
      await submit({
        workflowType: "add-feature", workflowId: "rv1", projectRoot: dir, stage,
        summary: longSummary,
        sections: {
          "一页结论": "当前结论：本阶段完成，已形成必要证据与结论。",
          "业务主题与分析范围": "业务问题与目标及本轮范围已明确，证据充分。",
        },
      })
    }
    const r = await review({
      workflowType: "add-feature", workflowId: "rv1", projectRoot: dir,
      stage: "02-big-picture-event-storm", decision: "revise", reviewer: "tester",
      feedback: "战术事件风暴需要补充失败矩阵",
    })
    assert.equal(r.requiredAction, "revise")
    assert.ok(r.allowedNextStages.length > 0)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
