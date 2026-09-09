import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DddWorkflowPlugin, dddLifecycleTool } from '../dist/index.js'

test('directory resume automatically binds without initializing or approving and preserves history', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ddd-resume-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const file = path.join(root, 'openspec/changes/shop-visits/ddd/.ddd/workflow-state.json')
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify({ workflowId: 'shop-visits', workflowType: 'add-feature', status: 'active', checkpoints: [], runtimeSessionId: 'original', title: 'Shop visits' }))
  const hooks = await DddWorkflowPlugin({ directory: root, worktree: root }, {})
  const output = { parts: [{ type: 'text', text: 'old init prompt' }] }
  await hooks['command.execute.before']({ command: 'ddd', arguments: 'shop-visits', sessionID: 'resume-session' }, output)
  const state = JSON.parse(await readFile(file, 'utf8'))
  assert.equal(state.runtimeSessionId, 'resume-session')
  assert.deepEqual(state.runtimeSessionIds, ['original', 'resume-session'])
  assert.deepEqual(state.checkpoints, [])
  assert.match(output.parts[0].text, /workflow_id="shop-visits"/)
  assert.match(output.parts[0].text, /不得自动批准/)
  const before = await readFile(file, 'utf8')
  await assert.rejects(hooks['command.execute.before']({ command: 'ddd', arguments: 'missing-workflow', sessionID: 'other' }, { parts: [] }), /Missing workflow/)
  assert.equal(await readFile(file, 'utf8'), before)
  const mismatch = JSON.parse(await dddLifecycleTool.execute({ action: 'status', workflow_id: 'shop-visits', workflow_type: 'create-system' }, { worktree: root }))
  assert.match(mismatch.error, /不一致/)
  const prose = { parts: [{ type: 'text', text: 'new request' }] }
  await hooks['command.execute.before']({ command: 'ddd', arguments: '新增店铺预约功能', sessionID: 'new' }, prose)
  assert.equal(prose.parts[0].text, 'new request')
})
