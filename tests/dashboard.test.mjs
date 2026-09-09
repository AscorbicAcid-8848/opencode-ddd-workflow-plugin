import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { discoverWorkflows, loadMilestone, historicalMilestone, filterWorkflows, milestoneStatus, safeRead } from '../dist/dashboard/model.js'
import { reviewFromPanel, canReview } from '../dist/dashboard/actions.js'
import { visualCards, diagramText } from '../dist/dashboard/views.js'
import { profileFor } from '../dist/catalog.js'
import { saveState } from '../dist/state.js'

async function fixture(t, type = 'refactor-system') {
  const project = await mkdtemp(path.join(tmpdir(), 'ddd-panel-'))
  t.after(() => rm(project, { recursive: true, force: true }))
  const root = path.join(project, 'openspec/changes/example/ddd')
  await mkdir(path.join(root, '.ddd'), { recursive: true })
  const profile = await profileFor(type)
  const gate = profile.stages.find(s => s.document === 'milestoneI' && s.humanGate)
  const state = { schemaVersion: 'ddd-workflow-state/v1', workflowType: type, workflowId: 'example', title: '到店流程',
    originalRequest: '保持原有行为', projectRoot: project, artifactRoot: root, status: 'active', currentStage: gate.id,
    createdAt: '2026-09-07', updatedAt: '2026-09-07', checkpoints: [{ checkpointId: 1, stage: gate.id, milestone: 'I',
      summary: '业务结论', status: 'awaiting_review', review: null, reviewChecklist: [], completedAt: '2026-09-07', document: 'milestoneI', decisionItems: [] }] }
  const stateFile = path.join(root, '.ddd/workflow-state.json')
  const docFile = path.join(root, profile.documents.milestoneI)
  await writeFile(stateFile, JSON.stringify(state))
  await writeFile(docFile, '# 里程碑 I\n\n## 一页结论\n已形成事件流\n\n## 战略事件风暴\n```mermaid\nflowchart LR\nA[顾客] --> B[预约已提交]\n```\n')
  return { project, root, state, stateFile, docFile }
}

for (const type of ['add-feature', 'refactor-system', 'create-system']) test(`approved gate exposes ready-to-run without repeating review: ${type}`, async t => {
  const f = await fixture(t, type)
  f.state.checkpoints[0].status = 'approved'
  await writeFile(f.stateFile, JSON.stringify(f.state))
  const before = await readFile(f.stateFile, 'utf8')
  let [item] = await discoverWorkflows(f.project)
  assert.equal(item.status, '待执行')
  assert.equal(milestoneStatus(item, 'I'), '已批准')
  assert.equal(milestoneStatus(item, 'II'), '待执行')
  const view = await loadMilestone(item, 1)
  assert.equal(view.status, '待执行')
  assert.deepEqual(view.issues, [])
  assert.equal(canReview(item, view), false)
  assert.equal(filterWorkflows([item], '', '待执行').length, 1)
  assert.equal(await readFile(f.stateFile, 'utf8'), before)
  f.state.preparedStage = { stage: item.transition.nextStage }
  f.state.currentStage = item.transition.nextStage
  await writeFile(f.stateFile, JSON.stringify(f.state))
  ;[item] = await discoverWorkflows(f.project)
  assert.equal(item.status, '进行中')
  assert.equal(milestoneStatus(item, 'II'), '形成中')
})

for (const type of ['add-feature', 'refactor-system', 'create-system']) test(`missing unpublished document is generating, not an error: ${type}`, async t => {
  const f = await fixture(t, type)
  f.state.checkpoints[0].status = 'completed'
  await writeFile(f.stateFile, JSON.stringify(f.state))
  await rm(f.docFile)
  let [item] = await discoverWorkflows(f.project)
  let view = await loadMilestone(item, 0)
  assert.equal(view.status, '形成中')
  assert.deepEqual(view.issues, [])
  assert.equal(canReview(item, view), false)
  // A published/awaiting-review document disappearing is still a real error.
  f.state.checkpoints[0].status = 'awaiting_review'
  await writeFile(f.stateFile, JSON.stringify(f.state))
  ;[item] = await discoverWorkflows(f.project)
  view = await loadMilestone(item, 0)
  assert.ok(view.issues.some(i => i.includes('正式文档不可读取')))
  assert.equal(canReview(item, view), false)
})

for (const type of ['add-feature', 'refactor-system', 'create-system']) test(`dashboard discovers ${type} without mutating source state`, async t => {
  const f = await fixture(t, type)
  const before = await readFile(f.stateFile, 'utf8')
  const items = await discoverWorkflows(f.project)
  assert.equal(items.length, 1); assert.equal(items[0].status, '待审核')
  assert.equal(milestoneStatus(items[0], 'II'), '未开始')
  assert.equal(filterWorkflows(items, '保持原有', '待审核').length, 1)
  const view = await loadMilestone(items[0], 0)
  assert.match(visualCards(items[0], view, 0)[0].body, /顾客 ──▶ 预约已提交/)
  assert.equal(await readFile(f.stateFile, 'utf8'), before)
})

test('archive conflicts and malformed states are visible without hiding healthy workflows', async t => {
  const f = await fixture(t)
  const archive = path.join(f.project, 'openspec/changes/archive/2026-09-07-example/ddd/.ddd')
  await mkdir(archive, { recursive: true }); await writeFile(path.join(archive, 'workflow-state.json'), JSON.stringify(f.state))
  const bad = path.join(f.project, 'openspec/changes/broken/ddd/.ddd')
  await mkdir(bad, { recursive: true }); await writeFile(path.join(bad, 'workflow-state.json'), '{broken')
  const items = await discoverWorkflows(f.project)
  assert.equal(items.length, 3)
  assert.ok(items.every(i => i.status === '一致性异常'))
  assert.ok(items.find(i => i.archived).issues.includes('目录已归档，但状态未完成'))
})

test('review uses lifecycle transaction with exact workflow and stage; stale document never reaches writer', async t => {
  const f = await fixture(t)
  const [item] = await discoverWorkflows(f.project); const view = await loadMilestone(item, 0)
  let called = 0
  const writer = async input => { called++; assert.equal(input.workflowId, 'example'); assert.equal(input.stage, f.state.currentStage); return {} }
  await reviewFromPanel(item, view, 'approve', '同意', {}, writer)
  assert.equal(called, 1)
  await writeFile(f.docFile, 'changed')
  await assert.rejects(reviewFromPanel(item, view, 'approve', '同意', {}, writer), /发生变化/)
  assert.equal(called, 1)
})

test('review requires feedback, explicit option choice and rejects noncurrent and archived gates', async t => {
  const f = await fixture(t)
  const [item] = await discoverWorkflows(f.project); const view = await loadMilestone(item, 0)
  assert.equal(canReview({ ...item, archived: true }, view), false)
  assert.equal(canReview(item, await loadMilestone(item, 1)), false)
  await assert.rejects(reviewFromPanel(item, view, 'revise', ''), /填写/)
  f.state.checkpoints[0].decisionItems = [{ id: 'DEC-1', status: 'open', options: [{ id: 'A', label: '方案A' }], blocks: [] }]
  await writeFile(f.stateFile, JSON.stringify(f.state))
  const [fresh] = await discoverWorkflows(f.project); const next = await loadMilestone(fresh, 0)
  await assert.rejects(reviewFromPanel(fresh, next, 'approve', '同意', {}, async () => { throw new Error('should not execute') }), /请选择/)
})

test('safe reads reject traversal; unrecognized diagrams remain literal instead of invented relationships', async t => {
  const f = await fixture(t)
  await writeFile(path.join(f.project, 'secret.txt'), 'secret')
  await assert.rejects(safeRead(f.root, '../../../secret.txt'), /超出/)
  assert.match(diagramText('sequenceDiagram\nA->>B: hello'), /原始图/)
  assert.match(diagramText('A[请求] -.-> B[候选结果]'), /候选/)
})

test('all six milestone visualizers retain source content and do not promote plan to verified evidence', async t => {
  const f = await fixture(t); const [item] = await discoverWorkflows(f.project)
  const groups = ['战略事件风暴', '子域划分', '战术事件风暴', '领域模型设计', '纵向交付切片', '最终业务验收矩阵']
  for (let index = 0; index < 6; index++) {
    const view = { ...(await loadMilestone(item, 0)), status: '待审核', sections: { [groups[index]]: '该阶段原始结论' } }
    assert.match(visualCards(item, view, index)[0].body, /原始结论/)
  }
})

test('legacy archive reviews are projected read-only from actual review evidence', async t => {
  const f = await fixture(t)
  const profile = await profileFor('refactor-system')
  f.state.status = 'complete'
  f.state.checkpoints = ['I', 'II', 'III', 'IV', 'V', 'VI'].map((roman, i) => ({
    checkpointId: i + 1, stage: profile.stages.find(s => s.document === `milestone${roman}` && s.humanGate).id,
    document: profile.documents[`milestone${roman}`], status: 'submitted', review: { decision: 'approve', reviewer: 'user' },
  }))
  f.state.checkpoints.push({ stage: '07-model-review', document: profile.documents.milestoneIV, status: 'submitted', reviewStatus: 'not_required' })
  const archive = path.join(f.project, 'openspec/changes/archive/2026-09-07-example/ddd')
  await mkdir(path.join(archive, '.ddd'), { recursive: true })
  const stateFile = path.join(archive, '.ddd/workflow-state.json')
  const before = JSON.stringify(f.state)
  await writeFile(stateFile, before)
  await rm(path.dirname(f.root), { recursive: true })
  const [item] = await discoverWorkflows(f.project)
  assert.equal(item.status, '已完成'); assert.equal(item.approved, 6); assert.equal(item.legacy, true)
  assert.equal(milestoneStatus(item, 'I'), '已批准')
  assert.equal(canReview(item, await loadMilestone(item, 0)), false)
  assert.equal(await readFile(stateFile, 'utf8'), before)
})

test('state transaction publishes immutable visualization revisions; browsing reads no inferred graph', async t => {
  const f = await fixture(t)
  await saveState(f.root, f.state)
  const first = JSON.parse(await readFile(f.stateFile, 'utf8'))
  assert.equal(first.dashboard.revisions.length, 1)
  const ref = first.dashboard.revisions[0]
  const immutable = await readFile(path.join(f.root, ref.file), 'utf8')
  const projection = JSON.parse(immutable)
  assert.equal(projection.edges.length, 1)
  assert.equal(projection.edges[0].maturity, 'Proposed')
  assert.ok(projection.nodes.every(n => n.evidenceRefs.length))
  const [item] = await discoverWorkflows(f.project); const view = await loadMilestone(item, 0)
  assert.deepEqual(visualCards(item, view, 0), projection.cards)
  await saveState(f.root, f.state)
  assert.equal(f.state.dashboard.revisions.length, 1, 'unrelated state saves do not recompile or append projections')
  f.state.checkpoints[0].status = 'approved'
  f.state.checkpoints[0].review = { decision: 'approve', reviewer: 'user', reviewedAt: '2026-09-07' }
  await saveState(f.root, f.state)
  assert.equal(f.state.dashboard.revisions.length, 2)
  assert.equal(await readFile(path.join(f.root, ref.file), 'utf8'), immutable)
  const old = await historicalMilestone(item, { ...view, sections: { '一页结论': 'newer content' } }, ref)
  assert.equal(old.sections['一页结论'], '已形成事件流')
  assert.equal(old.historical, true)
  await writeFile(f.docFile, 'outside edit')
  const [fresh] = await discoverWorkflows(f.project); const conflicted = await loadMilestone(fresh, 0)
  assert.match(conflicted.issues.join(' '), /不一致/)
  assert.equal(visualCards(fresh, conflicted, 0)[0].kind, 'warning')
  assert.equal(canReview(fresh, { ...view, historical: true }), false)
})
