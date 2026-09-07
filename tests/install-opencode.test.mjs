import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { parse } from 'jsonc-parser'
import { installOpenCode } from '../scripts/install-opencode.mjs'

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ddd-install-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  return root
}
test('complete install preserves other plugins/comments and is idempotent', async t => {
  const root = await fixture(t)
  const original = '// retain settings\n{"plugin":["@mem9/opencode"],"model":"test/model"}\n'
  await fs.writeFile(path.join(root, 'opencode.jsonc'), original)
  await fs.writeFile(path.join(root, 'tui.jsonc'), '// retain TUI comment\n{"plugin":["@mem9/opencode"],"theme":"custom"}\n')
  const dry = await installOpenCode({ root, check: true })
  assert.ok(dry.changedFiles.includes('tui.jsonc'))
  assert.deepEqual((await fs.readdir(root)).sort(), ['opencode.jsonc', 'tui.jsonc'])
  const result = await installOpenCode({ root })
  assert.equal(result.skills, 17)
  assert.equal(await fs.readFile(path.join(root, 'opencode.jsonc'), 'utf8'), original)
  const text = await fs.readFile(path.join(root, 'tui.jsonc'), 'utf8')
  assert.ok(text.includes('// retain TUI comment'))
  assert.equal(parse(text).theme, 'custom')
  assert.deepEqual(parse(text).plugin, ['@mem9/opencode', result.tui])
  assert.match(await fs.readFile(path.join(root, 'plugins/ddd-workflow.js'), 'utf8'), /DddWorkflowPlugin as default/u)
  for (const cmd of ['ddd', 'ddd-code', 'ddd-status']) await fs.access(path.join(root, `commands/${cmd}.md`))
  await assert.rejects(fs.access(path.join(root, 'commands/ddd-workflow.md')))
  assert.deepEqual((await installOpenCode({ root })).changedFiles, [])
  assert.ok(await fs.readFile(path.join(result.backup, 'tui.jsonc'), 'utf8'))
})
test('invalid or ambiguous config fails before installing files', async t => {
  const root = await fixture(t)
  await fs.writeFile(path.join(root, 'tui.json'), '{broken')
  await assert.rejects(installOpenCode({ root }), /配置无效/u)
  assert.deepEqual(await fs.readdir(root), ['tui.json'])
  await fs.writeFile(path.join(root, 'tui.json'), '{}')
  await fs.writeFile(path.join(root, 'tui.jsonc'), '{}')
  await assert.rejects(installOpenCode({ root }), /同时存在/u)
})
test('migrates only managed server registration, retaining unrelated plugins and settings', async t => {
  const root = await fixture(t)
  await fs.writeFile(path.join(root, 'opencode.json'), JSON.stringify({ plugin: ['@mem9/opencode', 'file:///old/opencode-ddd-plugin-v2'], model: 'keep' }))
  await fs.writeFile(path.join(root, 'tui.json'), JSON.stringify({ plugin: ['file:///old/opencode-ddd-plugin-v2', '@mem9/opencode'] }))
  const result = await installOpenCode({ root })
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(root, 'opencode.json'), 'utf8')), { plugin: ['@mem9/opencode'], model: 'keep' })
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(root, 'tui.json'), 'utf8')).plugin, ['@mem9/opencode', result.tui])
})
