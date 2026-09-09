import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { discoverWorkflows } from '../dist/dashboard/model.js'
import { projectSessions, resumeInSession } from '../dist/dashboard/resume.js'

async function fixture(t) {
  const project = await mkdtemp(path.join(os.tmpdir(), 'ddd-resume-panel-'))
  t.after(() => rm(project, { recursive: true, force: true }))
  const file = path.join(project, 'openspec/changes/example/ddd/.ddd/workflow-state.json')
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify({ workflowId: 'example', workflowType: 'add-feature', title: 'Example', status: 'active', checkpoints: [], runtimeSessionId: 'old', runtimeSessionIds: ['old'] }))
  const [item] = await discoverWorkflows(project)
  const calls = []
  const session = id => ({ id, directory: project, title: id, time: { updated: 1 } })
  const client = { session: {
    status: async () => ({ data: {} }), get: async ({sessionID}) => ({data: session(sessionID)}),
    create: async () => { calls.push('create'); return { data: session('new') } },
    promptAsync: async p => { calls.push(p); return {} },
    list: async () => ({ data: [session('old'), session('other'), {...session('archived'), time: {archived: 1}}, {...session('child'), parentID: 'parent'}, {...session('wrong'), directory: os.tmpdir()}] }),
  } }
  return { project, file, item, calls, client }
}
test('lists only same-directory main sessions without binding', async t => {
  const f = await fixture(t), before = await readFile(f.file, 'utf8')
  assert.deepEqual((await projectSessions(f.project, f.client)).map(s => s.id), ['old', 'other'])
  assert.equal(await readFile(f.file, 'utf8'), before)
})
test('continue existing or new session sends explicit workflow intent, never approves or writes history', async t => {
  const f = await fixture(t), before = await readFile(f.file, 'utf8')
  assert.equal(await resumeInSession(f.item, 'other', f.client), 'other')
  assert.match(f.calls[0].parts[0].text, /workflow_id="example"/)
  assert.match(f.calls[0].parts[0].text, /不得自行 review/)
  assert.equal(await resumeInSession(f.item, null, f.client), 'new')
  assert.equal(f.calls[1], 'create')
  assert.equal(await readFile(f.file, 'utf8'), before)
})
test('busy owner, busy target, wrong project and archived workflow prevent dispatch', async t => {
  const f = await fixture(t)
  for (const busy of ['old','other']) {
    f.client.session.status = async () => ({data: {[busy]: {type: 'busy'}}})
    await assert.rejects(resumeInSession(f.item, 'other', f.client), /正在运行/)
  }
  f.client.session.status = async () => ({data: {}})
  f.client.session.get = async () => ({data: {directory: os.tmpdir(), time: {}}})
  await assert.rejects(resumeInSession(f.item, 'wrong', f.client), /不属于/)
  const state = JSON.parse(await readFile(f.file, 'utf8')); state.status = 'complete'
  await writeFile(f.file, JSON.stringify(state))
  await assert.rejects(resumeInSession(f.item, null, f.client), /不可续跑/)
  assert.equal(f.calls.length, 0)
})
