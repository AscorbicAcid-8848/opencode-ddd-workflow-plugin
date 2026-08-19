import assert from "node:assert/strict"
import test from "node:test"
import { profileFor } from "../dist/workflow/catalog.js"
import { workflowTransition } from "../dist/workflow/transition.js"

const types = ["add-feature", "refactor-system", "create-system"]
const state = (type, checkpoints, status = "active") => ({
  schemaVersion: "1.16", profileSchemaVersion: "1.20", documentLayoutVersion: "fixed-business-sections/v1",
  workflowType: type, workflowId: "sample", title: "sample", projectRoot: "/tmp", artifactRoot: "/tmp/change",
  status, currentStage: checkpoints.at(-1)?.stage ?? "00-request", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
  checkpoints, snapshot: {},
})
const checkpoint = (stage, reviewStatus) => ({ stage, reviewStatus, document: "I-strategic-eventstorm.md" })

test("all three profiles continue after stage 01 instead of claiming milestone I", async () => {
  const matrix = {
    "add-feature": ["01-current-evidence", "02-big-picture-event-storm"],
    "refactor-system": ["01-baseline-evidence", "02-as-is-big-picture-event-storm"],
    "create-system": ["01-system-scenarios", "02-big-picture-event-storm"],
  }
  for (const type of types) {
    const profile = await profileFor(type)
    const [last, next] = matrix[type]
    const result = workflowTransition(profile, state(type, [checkpoint(last, "not_required")]))
    assert.equal(result.milestoneRoman, "I")
    assert.equal(result.milestoneReady, false)
    assert.equal(result.stopAllowed, false)
    assert.equal(result.mustContinue, true)
    assert.equal(result.nextStage, next)
  }
})

test("only the final writer of every Roman milestone becomes a human gate", async () => {
  for (const type of types) {
    const profile = await profileFor(type)
    for (const milestone of profile.milestones) {
      const writers = profile.stages.filter((stage) => stage.document === milestone.document)
      const gate = writers.at(-1)
      const result = workflowTransition(profile, state(type, [checkpoint(gate.id, "awaiting_review")], "awaiting_review"))
      assert.equal(result.milestoneRoman, milestone.roman)
      assert.equal(result.milestoneReady, true)
      assert.equal(result.humanReviewRequired, true)
      assert.equal(result.stopAllowed, true)
      assert.equal(result.requiredAction, "await-human-review")
    }
  }
})

test("a milestone requiring revision is never projected as ready", async () => {
  for (const type of types) {
    const profile = await profileFor(type)
    const gate = profile.stages.find((stage) => stage.humanGate)
    const result = workflowTransition(profile, state(type, [checkpoint(gate.id, "revision_requested")], "revision_requested"))
    assert.equal(result.milestoneRoman, "I")
    assert.equal(result.milestoneReady, false)
    assert.equal(result.milestoneStatus, "revision-required")
    assert.equal(result.requiredAction, "revise")
    assert.equal(result.stopAllowed, false)
    assert.equal(result.nextStage, gate.id)
  }
})

test("repeatable implementation stages expose choices without inventing one next stage", async () => {
  for (const type of types) {
    const profile = await profileFor(type)
    const repeated = profile.stages.find((stage) => stage.repeatable)
    const result = workflowTransition(profile, state(type, [checkpoint(repeated.id, "not_required")]))
    assert.equal(result.requiredAction, "select-next-stage")
    assert.equal(result.nextStage, null)
    assert.equal(result.stopAllowed, false)
    assert.ok(result.allowedNextStages.includes(repeated.id))
  }
})

test("archive retry remains observable and completion is terminal", async () => {
  const profile = await profileFor("add-feature")
  const last = checkpoint("10-final-review", "approved")
  const retry = workflowTransition(profile, state("add-feature", [last], "awaiting_archive"))
  assert.equal(retry.requiredAction, "archive")
  assert.equal(retry.stopAllowed, false)
  const complete = workflowTransition(profile, state("add-feature", [last], "complete"))
  assert.equal(complete.requiredAction, "complete")
  assert.equal(complete.stopAllowed, true)
})
