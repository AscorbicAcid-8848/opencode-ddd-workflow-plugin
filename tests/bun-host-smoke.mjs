import assert from "node:assert/strict"
import { existsSync } from "node:fs"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
const pluginEntry = process.env.DDD_PLUGIN_ENTRY || new URL("../dist/index.js", import.meta.url).href
const { default: plugin, dddWorkflowAdmin } = await import(pluginEntry)

const project = await mkdtemp(path.join(os.tmpdir(), "ddd-bun-host-"))
try {
  const hooks = await plugin({})
  const doctor = await dddWorkflowAdmin.environmentReport(project)
  assert.match(doctor, /openspecCli=1\.7\.0/)
  assert.match(doctor, /pythonRequired=false/)
  const value = JSON.parse(await hooks.tool.ddd_workflow_init.execute({
    workflow_type: "create-system",
    workflow_id: "bun-host-smoke",
    title: "Bun host smoke",
    request: "Verify the bundled OpenSpec CLI under a non-Node plugin host.",
  }, { worktree: project, directory: project }))

  assert.equal(value.error, undefined)
  assert.equal(value.transition.stopAllowed, false)
  assert.equal(value.transition.nextStage, "01-system-scenarios")
  assert.ok(existsSync(path.join(project, "openspec", "changes", "bun-host-smoke", ".openspec.yaml")))
  process.stdout.write(`${JSON.stringify({
    hostExecutable: process.execPath,
    nextStage: value.transition.nextStage,
    stopAllowed: value.transition.stopAllowed,
  })}\n`)
} finally {
  await rm(project, { recursive: true, force: true })
}
