// Explicit live SDK smoke test. Uses a disposable rejected fixture; never runs a model.
import { createOpencodeClient } from '@opencode-ai/sdk/v2'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { profileFor } from '../dist/catalog.js'
import { discoverWorkflows, loadMilestone } from '../dist/dashboard/model.js'
import { sendPanelReview } from '../dist/dashboard/session-handoff.js'
const baseUrl = process.argv[2]
if (!baseUrl) throw new Error('Pass the URL of an explicitly started local OpenCode server')
const client = createOpencodeClient({ baseUrl })
const project = await mkdtemp(path.join(tmpdir(), 'ddd-handoff-live-'))
let sessionID
try {
  const created = await client.session.create({ directory: project, title: 'DDD panel notification smoke (no model)' })
  assert.ok(created.data, JSON.stringify(created.error))
  sessionID = created.data.id
  const root = path.join(project, 'openspec/changes/smoke/ddd')
  await mkdir(path.join(root, '.ddd'), { recursive: true })
  const profile = await profileFor('add-feature')
  const stage = profile.stages.find(s => s.humanGate && s.document === 'milestoneI')
  await writeFile(path.join(root, '.ddd/workflow-state.json'), JSON.stringify({ workflowType: 'add-feature', workflowId: 'smoke', title: '非业务测试夹具',
    status: 'active', runtimeSessionId: sessionID, currentStage: stage.id, updatedAt: '2026-09-08',
    checkpoints: [{ checkpointId: 1, milestone: 'I', document: 'milestoneI', stage: stage.id, status: 'rejected', summary: '非业务测试',
      review: { decision: 'reject', reviewer: 'user:tui', reviewedAt: '2026-09-08T00:00:00Z', feedback: 'SDK noReply test only' } }] }))
  await writeFile(path.join(root, profile.documents.milestoneI), '# I\n\n非业务夹具，仅测试消息同步。')
  const [item] = await discoverWorkflows(project), view = await loadMilestone(item, 0)
  const sent = await sendPanelReview(item, view, client)
  let message
  for (let i = 0; i < 30; i++) {
    message = await client.session.message({ sessionID, messageID: sent.messageID, directory: project })
    if (message.data) break
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  assert.equal(message.data?.info.role, 'user', JSON.stringify(message.error))
  assert.ok(message.data.parts.some(p => p.type === 'text' && p.text.includes('SDK noReply test only')))
  assert.equal((await sendPanelReview(item, view, client)).alreadySent, true)
  const messages = await client.session.messages({ sessionID, directory: project })
  assert.equal(messages.data.length, 1, 'one user message and no assistant/model response')
  console.log('PASS: real OpenCode SDK persisted one review message; retry deduplicated; noReply produced no model response.')
} finally {
  if (sessionID) await client.session.delete({ sessionID, directory: project })
  await rm(project, { recursive: true, force: true })
}
