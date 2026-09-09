import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createTestRenderer } from '@opentui/core/testing'
import { RGBA } from '@opentui/core'
import { Keymap } from '@opentui/keymap'
import { registerDefaultKeys } from '@opentui/keymap/addons'
import { createDashboard, tui } from '../dist/tui.js'
import { profileFor } from '../dist/catalog.js'

const project = await mkdtemp(path.join(tmpdir(), 'ddd-tui-'))
const test = await createTestRenderer({ width: 120, height: 40 })
const values = new Map(), routes = [], errors = [], keyListeners = new Set()
let panel, hostTabs = 0, dialogContent
const keyEvent = (name) => ({ name, ctrl: false, shift: false, meta: false, propagationStopped: false,
  preventDefault() {}, stopPropagation() { this.propagationStopped = true } })
const keymap = new Keymap({
  metadata: { platform: 'windows', primaryModifier: 'ctrl', modifiers: {} }, rootTarget: test.renderer.root, isDestroyed: false,
  getFocusedTarget: () => panel?.root ?? test.renderer.root, getParentTarget: target => target.parent ?? null, isTargetDestroyed: () => false,
  onKeyPress: fn => { keyListeners.add(fn); return () => keyListeners.delete(fn) }, onKeyRelease: () => () => {},
  onFocusChange: () => () => {}, onTargetDestroy: () => () => {}, createCommandEvent: () => keyEvent(''),
})
const defaultKeys = registerDefaultKeys(keymap)
const hostBinding = keymap.registerLayer({ bindings: [{ key: 'tab', cmd: () => { hostTabs++ } }] })
const press = name => { const event = keyEvent(name); for (const fn of keyListeners) fn(event) }
let left = false, cleanup = () => {}, routeRemoved = false
const current = { name: 'session', params: { sessionID: 'existing' } }
const api = {
  renderer: test.renderer, theme: { current: new Proxy({}, { get: () => RGBA.fromHex('#d0d0d0') }) },
  state: { config: { language: 'zh-CN' }, path: { directory: project } },
  kv: { get: (k, fallback) => values.get(k) ?? fallback, set: (k,v) => values.set(k,v) },
  ui: { dialog: { open: false, clear() { this.open = false; dialogContent = undefined }, replace(render) { this.open = true; dialogContent = render() } },
    DialogSelect: props => ({ kind: 'select', ...props }), DialogConfirm: props => ({ kind: 'confirm', ...props }), DialogPrompt: props => ({ kind: 'prompt', ...props }),
    toast: e => errors.push(e.message) },
  event: { on: () => () => {} },
  route: { current, register: r => { routes.push(...r); return () => { routeRemoved = true } }, navigate: (name, params) => { api.route.current = { name, params } } },
  keymap,
  lifecycle: { onDispose: fn => { cleanup = fn } },
}
try {
  const root = path.join(project, 'openspec/changes/booking/ddd')
  await mkdir(path.join(root, '.ddd'), { recursive: true })
  const profile = await profileFor('add-feature')
  const stage = profile.stages.find(s => s.humanGate && s.document === 'milestoneI')
  await writeFile(path.join(root, '.ddd/workflow-state.json'), JSON.stringify({ workflowType: 'add-feature', workflowId: 'booking', title: '店铺预约', status: 'active', currentStage: stage.id, updatedAt: '2026-09-07', checkpoints: [{ checkpointId: 1, milestone: 'I', document: 'milestoneI', stage: stage.id, status: 'awaiting_review', summary: '预约业务', reviewChecklist: [] }] }))
  await writeFile(path.join(root, profile.documents.milestoneI), '# I\n\n## 战略事件风暴\n顾客提交预约，预约已受理。\n')
  await tui(api)
  // Use the same real keymap namespace/filter as OpenCode's slash menu.
  const commands = keymap.getCommands({ visibility: 'reachable', namespace: 'palette' }).filter(c => typeof c.slashName === 'string')
  assert.equal(commands.length, 1)
  assert.equal(commands[0].namespace, 'palette')
  assert.equal(commands[0].slashName, 'ddd-workflow')
  keymap.dispatchCommand(commands[0].name)
  assert.equal(api.route.current.name, 'ddd-workflow')
  panel = createDashboard(api, project, () => { left = true })
  test.renderer.root.add(panel.root)
  await panel.refresh(true)
  await test.waitFor(async () => { await Bun.sleep(5); return !!panel.getSelection().view }, { maxPasses: 200 })
  await test.renderOnce()
  const frame = test.captureCharFrame()
  assert.match(frame, /DDD Workflow/)
  assert.match(frame, /店铺预约/)
  assert.match(frame, /批准/)
  // Model the host backdrop: a release reaching it closes an already-open modal.
  test.renderer.root.onMouseUp = () => { if (api.ui.dialog.open) api.ui.dialog.clear() }
  for (const [label, kind] of [['批准 [a]', 'confirm'], ['要求修改 [e]', 'prompt'], ['拒绝 [x]', 'prompt']]) {
    await test.renderOnce()
    const rows = test.captureCharFrame().split('\n')
    const y = rows.findIndex(row => row.includes(label))
    assert.ok(y >= 0, `button is visible: ${label}`)
    const find = node => node.id === `ddd-button-${label}` ? node : node.getChildren().map(find).find(Boolean)
    const button = find(panel.root)
    assert.ok(button)
    const x = button.x + 2, mouseY = button.y + 1
    await test.mockMouse.pressDown(x, mouseY)
    assert.equal(api.ui.dialog.open, false, 'press must not mount a dialog before mouse release')
    await test.mockMouse.release(x, mouseY)
    await test.waitFor(() => api.ui.dialog.open)
    assert.equal(dialogContent.kind, kind)
    await test.renderOnce()
    assert.equal(api.ui.dialog.open, true, 'dialog survives release and subsequent frame')
    api.ui.dialog.clear()
  }
  const stateFile = path.join(root, '.ddd/workflow-state.json')
  const state = JSON.parse(await readFile(stateFile, 'utf8'))
  state.checkpoints[0].decisionItems = [{ id: 'booking-mode', status: 'open', question: '如何受理预约？', recommendationId: 'manual',
    options: [{ id: 'manual', label: '商家确认', impact: '商家确认后生效' }, { id: 'auto', label: '自动受理', impact: '提交后直接生效' }], blocks: [] }]
  state.runtimeSessionId = 'session-new'
  state.createdAt = '2026-09-07T00:00:00Z'
  state.runtimeSessionIds = ['session-old', 'session-new']
  api.client = { session: { get: async ({ sessionID }) => ({ data: { id: sessionID, title: sessionID, directory: project, time: { updated: 1 } } }) } }
  await writeFile(stateFile, JSON.stringify(state))
  await panel.refresh(true)
  await test.waitFor(async () => { await Bun.sleep(5); return !!panel.getSelection().view }, { maxPasses: 200 })
  press('a')
  assert.match(dialogContent.title, /批准前确认 1\/1/u)
  assert.equal(dialogContent.options[0].title, '商家确认（推荐）')
  assert.equal(dialogContent.options[0].description, '商家确认后生效')
  assert.equal(JSON.parse(await readFile(stateFile, 'utf8')).checkpoints[0].status, 'awaiting_review')
  dialogContent.onSelect(dialogContent.options[1])
  assert.equal(dialogContent.kind, 'confirm')
  assert.match(dialogContent.message, /如何受理预约？：自动受理/u)
  assert.doesNotMatch(dialogContent.message, /booking-mode = auto/u)
  api.ui.dialog.clear()
  const beforeNavigation = await readFile(stateFile, 'utf8')
  let chatCalls = 0
  api.client.session.messages = async () => { chatCalls++; return {data: []} }
  async function clickChat(label) {
    await test.renderOnce()
    const find = node => node.id === `ddd-button-${label}` ? node : node.getChildren().map(find).find(Boolean)
    const target = find(panel.root); assert.ok(target, label)
    await test.mockMouse.pressDown(target.x+2,target.y+1)
    await test.mockMouse.release(target.x+2,target.y+1)
    await Bun.sleep(20); await test.renderOnce()
  }
  await clickChat('▶ 展开聊天记录'); assert.ok(chatCalls > 0)
  const cachedCalls = chatCalls
  await clickChat('▼ 收起聊天记录'); assert.equal(chatCalls,cachedCalls)
  await clickChat('▶ 展开聊天记录'); assert.equal(chatCalls,cachedCalls)
  await clickChat('刷新聊天记录'); assert.ok(chatCalls > cachedCalls)
  await clickChat('▼ 收起聊天记录')
  panel.root.focus(); await test.renderOnce()
  press('s')
  await test.waitFor(async () => { await Bun.sleep(5); return api.ui.dialog.open }, { maxPasses: 200 })
  assert.equal(dialogContent.title, '选择关联会话')
  assert.equal(dialogContent.options.length, 2)
  assert.match(dialogContent.options[0].title, /当前执行会话/u)
  dialogContent.onSelect(dialogContent.options[1])
  await test.waitFor(async () => { await Bun.sleep(5); return api.route.current.params?.sessionID === 'session-old' }, { maxPasses: 200 })
  assert.equal(await readFile(stateFile, 'utf8'), beforeNavigation)
  press('c')
  assert.equal(dialogContent.title, '在哪里继续工作流')
  assert.deepEqual(dialogContent.options.map(o => o.value), ['current', 'last', 'new', 'other'])
  assert.equal(dialogContent.options[0].disabled, true, 'no origin session must not guess a target')
  api.ui.dialog.clear()
  api.state.config.language = 'en-US'
  await panel.refresh(true)
  await test.waitFor(async () => { await Bun.sleep(5); return !!panel.getSelection().view }, { maxPasses: 200 })
  await test.renderOnce()
  assert.match(test.captureCharFrame(), /Approve \[a\]/u)
  assert.match(test.captureCharFrame(), /店铺预约/u, 'business content stays in its original language')
  press('a')
  assert.match(dialogContent.title, /Decision before approval/u)
  assert.equal(dialogContent.options[0].title, '商家确认 (Recommended)')
  api.ui.dialog.clear()
  api.state.config.language = 'zh-CN'
  await panel.refresh(true)
  await test.waitFor(async () => { await Bun.sleep(5); return !!panel.getSelection().view }, { maxPasses: 200 })
  press('right')
  await test.waitFor(async () => { await Bun.sleep(5); return panel.getSelection().view?.roman === 'II' }, { maxPasses: 200 })
  await test.renderOnce()
  assert.match(test.captureCharFrame(), /执行中/)
  press('tab')
  assert.equal(hostTabs, 1, 'single-page reading no longer takes over Tab')
  assert.equal(values.get(`ddd-dashboard:${project}`).tab, undefined)
  panel.root.onKeyDown({ name: 'escape', preventDefault() {}, stopPropagation() {} })
  assert.equal(left, true)
  assert.equal(errors.length, 0)
  cleanup(); assert.equal(routeRemoved, true)
  panel.dispose(); panel = undefined
  press('tab'); assert.equal(hostTabs, 2, 'host Tab remains available after disposal')
  console.log('PASS: native command registration, OpenTUI rendered frame, workflow selection, milestone navigation and route disposal; zero SDK model calls.')
} finally { panel?.dispose(); hostBinding(); defaultKeys(); test.renderer.destroy(); await rm(project, { recursive: true, force: true }) }
