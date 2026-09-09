import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { recordRuntimeSession } from '../dist/session-links.js'
import { listLinkedSessions, getLinkedSession } from '../dist/dashboard/session-links.js'

test('binding preserves previous sessions, deduplicates, and keeps current distinct', () => {
  const state = { runtimeSessionId: 'old' }
  assert.equal(recordRuntimeSession(state, 'new'), true)
  assert.deepEqual(state.runtimeSessionIds, ['old', 'new'])
  assert.equal(recordRuntimeSession(state, 'new'), false)
  recordRuntimeSession(state, 'old')
  assert.deepEqual(state.runtimeSessionIds, ['old', 'new'])
  assert.equal(state.runtimeSessionId, 'old')
})
test('linked sessions use explicit IDs, validate ownership and keep missing entries disabled', async t => {
  const project = await mkdtemp(path.join(tmpdir(), 'ddd-links-'))
  t.after(() => rm(project, { recursive: true, force: true }))
  const item = { project, state: { runtimeSessionId: 'new', runtimeSessionIds: ['old', 'new', 'deleted', 'wrong'] } }
  const before = JSON.stringify(item)
  const calls = []
  const client = { session: { get: async ({ sessionID }) => {
    calls.push(sessionID)
    return sessionID === 'deleted' ? { error: {} } : { data: { id: sessionID, title: `Title ${sessionID}`, directory: sessionID === 'wrong' ? tmpdir() : project, time: { updated: 1, archived: sessionID === 'old' ? 1 : undefined } } }
  } } }
  const sessions = await listLinkedSessions(item, client)
  assert.equal(sessions[0].id, 'new')
  assert.equal(sessions[0].current, true)
  assert.equal(sessions.find(s => s.id === 'old').archived, true)
  assert.ok(sessions.find(s => s.id === 'deleted').error)
  assert.ok(sessions.find(s => s.id === 'wrong').error)
  assert.equal(new Set(calls).size, calls.length)
  await assert.rejects(getLinkedSession(item, 'unrelated', client), /未关联/)
  assert.equal(JSON.stringify(item), before, 'browsing never changes binding')
})
test('legacy current ID works without fabricating unrecorded history', async () => {
  const client = { session: { get: async () => { throw new Error('should not scan sessions') } } }
  assert.deepEqual(await listLinkedSessions({ state: {} }, client), [])
})
