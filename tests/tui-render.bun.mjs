import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
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
let panel, hostTabs = 0
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
  state: { path: { directory: project } },
  kv: { get: (k, fallback) => values.get(k) ?? fallback, set: (k,v) => values.set(k,v) },
  ui: { dialog: { open: false, clear() {} }, toast: e => errors.push(e.message) },
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
  await test.waitFor(() => !!panel.getSelection().view)
  await test.renderOnce()
  const frame = test.captureCharFrame()
  assert.match(frame, /DDD Workflow/)
  assert.match(frame, /店铺预约/)
  assert.match(frame, /批准/)
  press('right')
  await test.waitFor(() => panel.getSelection().view?.roman === 'II')
  await test.renderOnce()
  assert.match(test.captureCharFrame(), /未始/)
  press('tab')
  assert.equal(hostTabs, 0, 'page navigation must take precedence over the host Tab binding')
  assert.equal(values.get(`ddd-dashboard:${project}`).tab, '结论')
  panel.root.onKeyDown({ name: 'escape', preventDefault() {}, stopPropagation() {} })
  assert.equal(left, true)
  assert.equal(errors.length, 0)
  cleanup(); assert.equal(routeRemoved, true)
  panel.dispose(); panel = undefined
  press('tab'); assert.equal(hostTabs, 1, 'page keymap layer must be removed on disposal')
  console.log('PASS: native command registration, OpenTUI rendered frame, workflow selection, milestone navigation and route disposal; zero SDK model calls.')
} finally { panel?.dispose(); hostBinding(); defaultKeys(); test.renderer.destroy(); await rm(project, { recursive: true, force: true }) }
