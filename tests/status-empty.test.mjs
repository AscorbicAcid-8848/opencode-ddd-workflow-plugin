import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readdir, mkdir, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { dddLifecycleTool } from '../dist/index.js'

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ddd-empty-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  return root
}
test('empty status is normal, guides /ddd and performs no filesystem writes', async t => {
  const root = await fixture(t)
  const result = JSON.parse(await dddLifecycleTool.execute({ action: 'status', input: { view: 'compact' } }, { sessionID: 'empty', worktree: root }))
  assert.equal(result.status, 'empty')
  assert.equal(result.error, undefined)
  assert.equal(result.currentMilestone, null)
  assert.equal(result.requiredAction, 'none')
  assert.equal(result.nextStage, null)
  assert.deepEqual(result.allowedNextStages, [])
  assert.equal(result.stopAllowed, true)
  assert.match(result.guidance, /\/ddd/u)
  assert.deepEqual(await readdir(root), [])
})
test('status respects explicit project root and does not confuse archived history with active work', async t => {
  const root = await fixture(t)
  await mkdir(path.join(root, 'openspec/changes/archive/old/ddd/.ddd'), { recursive: true })
  const before = await readdir(root, { recursive: true })
  const result = JSON.parse(await dddLifecycleTool.execute({ action: 'status', project_root: root }, { sessionID: 'archive', worktree: '/not-the-requested-project' }))
  assert.equal(result.status, 'empty')
  assert.deepEqual(await readdir(root, { recursive: true }), before)
})
test('damaged active state remains an error, not empty; mutating actions do not auto-init', async t => {
  const root = await fixture(t)
  const context = { sessionID: 'broken', worktree: root }
  const prepare = JSON.parse(await dddLifecycleTool.execute({ action: 'prepare' }, context))
  assert.ok(prepare.error)
  assert.deepEqual(await readdir(root), [])
  const state = path.join(root, 'openspec/changes/broken/ddd/.ddd')
  await mkdir(state, { recursive: true })
  await writeFile(path.join(state, 'workflow-state.json'), '{broken')
  const result = JSON.parse(await dddLifecycleTool.execute({ action: 'status' }, context))
  assert.ok(result.error)
  assert.notEqual(result.status, 'empty')
})
