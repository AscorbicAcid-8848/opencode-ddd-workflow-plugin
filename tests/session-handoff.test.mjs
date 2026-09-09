import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { profileFor } from '../dist/catalog.js'
import { discoverWorkflows, loadMilestone } from '../dist/dashboard/model.js'
import { sendPanelReview, resolvePanelReview, reviewMessageId } from '../dist/dashboard/session-handoff.js'
import { DddWorkflowPlugin, dddLifecycleTool } from '../dist/index.js'
import { turnIntents } from '../dist/turn-intent.js'

async function fixture(t, decision = 'approve') {
  const project = await mkdtemp(path.join(tmpdir(), 'ddd-handoff-'))
  t.after(() => rm(project, { recursive: true, force: true }))
  const root = path.join(project, 'openspec/changes/example/ddd')
  await mkdir(path.join(root, '.ddd'), { recursive: true })
  const profile = await profileFor('add-feature')
  const stage = profile.stages.find(s => s.humanGate && s.document === 'milestoneI')
  const state = { workflowType: 'add-feature', workflowId: 'example', title: '审核测试', status: 'active', runtimeSessionId: 'ses_original',
    currentStage: stage.id, updatedAt: '2026-09-08', checkpoints: [{ checkpointId: 1, milestone: 'I', document: 'milestoneI', stage: stage.id,
      summary: '测试', status: { approve: 'approved', revise: 'revision_requested', reject: 'rejected' }[decision],
      review: { decision, reviewer: 'user:tui', reviewedAt: '2026-09-08T00:00:00Z', feedback: '补充异常流程' } }] }
  const file = path.join(root, '.ddd/workflow-state.json')
  await writeFile(file, JSON.stringify(state))
  await writeFile(path.join(root, profile.documents.milestoneI), '# I\n\n测试业务内容。')
  const [item] = await discoverWorkflows(project)
  const view = await loadMilestone(item, 0)
  const sent = [], messages = new Map()
  const client = { session: {
    get: async () => ({ data: { directory: project, time: {} } }),
    message: async ({ messageID }) => messages.has(messageID) ? { data: messages.get(messageID) } : { error: {}, response: { status: 404 } },
    status: async () => ({ data: {} }),
    promptAsync: async input => { sent.push(input); messages.set(input.messageID, input); return { response: { status: 204 } } },
  } }
  return { item, view, state, file, client, sent, messages }
}
for (const decision of ['approve', 'revise', 'reject']) test(`panel ${decision} sends to bound session and retry does not re-send`, async t => {
  const f = await fixture(t, decision), before = await readFile(f.file, 'utf8')
  await sendPanelReview(f.item, f.view, f.client)
  const result = await sendPanelReview(f.item, f.view, f.client)
  assert.equal(result.alreadySent, true)
  assert.equal(f.sent.length, 1)
  assert.equal(f.sent[0].sessionID, 'ses_original')
  assert.equal(f.sent[0].agent, undefined)
  assert.equal(f.sent[0].noReply, decision === 'reject')
  assert.equal(f.sent[0].parts[0].text, `${{approve:'批准',revise:'修改',reject:'拒绝'}[decision]}里程碑 I：补充异常流程`)
  assert.doesNotMatch(f.sent[0].parts[0].text, /workflowId|decisions|ddd_lifecycle|review/)
  assert.equal(await readFile(f.file, 'utf8'), before, 'handoff never rewrites review state')
})

test('panel context is recovered only from saved review and bound session', async t => {
  const f = await fixture(t, 'revise')
  const id = reviewMessageId('example', 1, f.state.checkpoints[0].review)
  const resolve = (session, message) => resolvePanelReview(f.item.project, session, message)
  assert.equal((await resolve('ses_original', id)).workflowId, 'example')
  assert.equal((await resolve('ses_original', id)).stale, false)
  assert.equal(await resolve('ses_other', id), undefined)
  assert.equal(await resolve('ses_original', 'msg_unrelated'), undefined)
  f.state.checkpoints.push({...f.state.checkpoints[0], checkpointId:2, review:undefined})
  await writeFile(f.file, JSON.stringify(f.state))
  assert.equal((await resolve('ses_original', id)).stale, true)
})

test('chat hook preserves feedback, attaches private context and prevents duplicate review', async t => {
  const f = await fixture(t, 'revise')
  const before = await readFile(f.file, 'utf8')
  const hooks = await DddWorkflowPlugin({directory:f.item.project, worktree:f.item.project}, {})
  const id = reviewMessageId('example', 1, f.state.checkpoints[0].review)
  const output = {message:{id}, parts:[{type:'text', text:'修改里程碑 I：补充异常流程'}]}
  await hooks['chat.message']({sessionID:'ses_original', messageID:id, agent:'ddd-workflow'}, output)
  assert.equal(output.parts[0].text, '修改里程碑 I：补充异常流程')
  assert.match(output.message.system, /禁止重复 review/)
  assert.match(output.message.system, /"workflowId":"example"/)
  assert.equal(turnIntents.get('ses_original'), 'execute')
  const result = JSON.parse(await dddLifecycleTool.execute({action:'review'}, {sessionID:'ses_original',worktree:f.item.project}))
  assert.match(result.error, /DDD_REVIEW_ALREADY_SAVED/)
  assert.equal(await readFile(f.file, 'utf8'), before)
  await hooks['chat.message']({sessionID:'ses_original',agent:'ddd-workflow'}, {message:{id:'msg_query'},parts:[{type:'text',text:'当前到哪个检查点了'}]})
  assert.equal(turnIntents.get('ses_original'), 'pending')
  turnIntents.delete('ses_original')
})
test('busy session preserves review and allows delivery-only retry', async t => {
  const f = await fixture(t)
  f.client.session.status = async () => ({ data: { ses_original: { type: 'busy' } } })
  await assert.rejects(sendPanelReview(f.item, f.view, f.client), /正在运行/)
  assert.equal(f.sent.length, 0)
  f.client.session.status = async () => ({ data: {} })
  await sendPanelReview(f.item, f.view, f.client)
  assert.equal(f.sent.length, 1)
})
test('missing binding, wrong project and missing session fail closed', async t => {
  const f = await fixture(t)
  delete f.state.runtimeSessionId
  await writeFile(f.file, JSON.stringify(f.state))
  await assert.rejects(sendPanelReview(f.item, f.view, f.client), /没有绑定/)
  f.state.runtimeSessionId = 'ses_original'
  await writeFile(f.file, JSON.stringify(f.state))
  f.client.session.get = async () => ({ data: { directory: tmpdir(), time: {} } })
  await assert.rejects(sendPanelReview(f.item, f.view, f.client), /不属于/)
  f.client.session.get = async () => ({ error: {} })
  await assert.rejects(sendPanelReview(f.item, f.view, f.client), /不存在/)
  assert.equal(f.sent.length, 0)
})
test('uncertain response is reconciled by message ID rather than blind resubmission', async t => {
  const f = await fixture(t)
  f.client.session.promptAsync = async input => { f.sent.push(input); f.messages.set(input.messageID, input); throw new Error('connection lost') }
  await assert.rejects(sendPanelReview(f.item, f.view, f.client), /connection lost/)
  assert.equal((await sendPanelReview(f.item, f.view, f.client)).alreadySent, true)
  assert.equal(f.sent.length, 1)
})
