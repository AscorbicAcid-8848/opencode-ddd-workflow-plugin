import assert from "node:assert/strict"
import test from "node:test"
import os from "node:os"
import path from "node:path"
import { mkdtemp, rm } from "node:fs/promises"
import { withWorkflowLock, WorkflowLockError } from "../dist/workflow/lock.js"

test("workflow lock serializes writers and reports contention", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ddd-lock-"))
  try {
    let entered = false
    const first = withWorkflowLock(root, "first", async () => {
      entered = true
      await new Promise((resolve) => setTimeout(resolve, 100))
      return "first-done"
    })
    while (!entered) await new Promise((resolve) => setTimeout(resolve, 5))
    await assert.rejects(
      withWorkflowLock(root, "second", async () => "second-done", { timeoutMs: 20, retryMs: 5 }),
      (error) => error instanceof WorkflowLockError && error.code === "WORKFLOW_BUSY",
    )
    assert.equal(await first, "first-done")
    assert.equal(await withWorkflowLock(root, "third", async () => "third-done"), "third-done")
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
