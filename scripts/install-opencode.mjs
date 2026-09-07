import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
import { parse, modify, applyEdits } from 'jsonc-parser'

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const managedPlugin = value => {
  const name = Array.isArray(value) ? value[0] : value
  return typeof name === 'string' && /(?:^|[/\\])(?:opencode-ddd-plugin-v2|opencode-ddd-workflow-plugin(?:-zzh-latest)?)(?:[/\\@]|$)/u.test(name)
}
async function readOptional(file) {
  try { return await fs.readFile(file, 'utf8') } catch (error) { if (error.code === 'ENOENT') return null; throw error }
}
async function configFile(root, name) {
  const json = path.join(root, `${name}.json`), jsonc = `${json}c`
  const a = await readOptional(json), b = await readOptional(jsonc)
  if (a !== null && b !== null) throw new Error(`同时存在 ${json} 与 ${jsonc}，请先明确唯一配置文件。`)
  const file = b !== null ? jsonc : json, text = b ?? a ?? '{}\n', errors = []
  const data = parse(text, errors, { allowTrailingComma: true })
  if (errors.length || !data || typeof data !== 'object' || Array.isArray(data)) throw new Error(`配置无效：${file}`)
  if (data.plugin !== undefined && !Array.isArray(data.plugin)) throw new Error(`plugin 必须是数组：${file}`)
  return { file, text, data }
}
function updatePlugins(config, plugins) {
  return applyEdits(config.text, modify(config.text, ['plugin'], plugins, { formattingOptions: { insertSpaces: true, tabSize: 2, eol: '\n' } }))
}
async function filesIn(directory) {
  const result = []
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name)
    if (entry.isSymbolicLink()) throw new Error(`安装源不允许符号链接：${file}`)
    if (entry.isDirectory()) result.push(...await filesIn(file))
    else if (entry.isFile()) result.push(file)
  }
  return result
}
async function safeTarget(root, file) {
  const relative = path.relative(root, file)
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`目标超出配置目录：${file}`)
  for (let cursor = file; ; cursor = path.dirname(cursor)) {
    try { if ((await fs.lstat(cursor)).isSymbolicLink()) throw new Error(`安装目标不允许符号链接：${cursor}`) }
    catch (error) { if (error.code !== 'ENOENT') throw error }
    if (cursor === path.dirname(cursor)) break
  }
}
async function atomicWrite(file, content) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  const temp = `${file}.${randomUUID()}.tmp`
  try { await fs.writeFile(temp, content); await fs.rename(temp, file) }
  finally { await fs.rm(temp, { force: true }) }
}

export async function installOpenCode({ root = path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'opencode'), source = sourceRoot, check = false } = {}) {
  root = path.resolve(root); source = path.resolve(source)
  for (const artifact of ['dist/index.js', 'dist/tui.js', 'package.json', 'node_modules/@fission-ai/openspec/package.json']) {
    await fs.access(path.join(source, artifact))
  }
  const server = await configFile(root, 'opencode'), tui = await configFile(root, 'tui')
  const plans = new Map()
  const entry = pathToFileURL(path.join(source, 'dist/index.js')).href
  const packageEntry = pathToFileURL(source).href
  plans.set(path.join(root, 'plugins/ddd-workflow.js'), `// Managed by DDD installer. Re-run npm run install:opencode to update.\nexport { DddWorkflowPlugin as default } from ${JSON.stringify(entry)}\n`)
  const serverPlugins = server.data.plugin || []
  if (serverPlugins.some(managedPlugin)) plans.set(server.file, updatePlugins(server, serverPlugins.filter(p => !managedPlugin(p))))
  plans.set(tui.file, updatePlugins(tui, [...(tui.data.plugin || []).filter(p => !managedPlugin(p) && p !== packageEntry), packageEntry]))
  for (const command of ['ddd', 'ddd-code', 'ddd-status']) plans.set(path.join(root, 'commands', `${command}.md`), await fs.readFile(path.join(source, 'opencode/commands', `${command}.md`), 'utf8'))
  const skills = await filesIn(path.join(source, 'skills'))
  for (const file of skills) plans.set(path.join(root, 'skills', path.relative(path.join(source, 'skills'), file)), await fs.readFile(file, 'utf8'))
  const changes = []
  for (const [file, content] of plans) {
    await safeTarget(root, file)
    const before = await readOptional(file)
    if (before !== content) changes.push({ file, content, before })
  }
  let backup = null
  if (!check && changes.length) {
    backup = path.join(root, '.ddd-install-backups', `${new Date().toISOString().replace(/[:.]/gu, '-')}-${randomUUID().slice(0, 8)}`)
    await safeTarget(root, path.join(backup, 'manifest.json'))
    // Finish backups before writing anything used by the host.
    for (const item of changes) if (item.before !== null) await atomicWrite(path.join(backup, path.relative(root, item.file)), item.before)
    await atomicWrite(path.join(backup, 'manifest.json'), JSON.stringify({ source, files: changes.map(i => ({ path: path.relative(root, i.file), existed: i.before !== null })) }, null, 2))
    const applied = []
    try {
      for (const item of changes) { await atomicWrite(item.file, item.content); applied.push(item) }
    } catch (error) {
      for (const item of applied.reverse()) {
        if (item.before === null) await fs.rm(item.file, { force: true })
        else await atomicWrite(item.file, item.before)
      }
      throw error
    }
  }
  return { mode: check ? 'check' : 'installed', root, source, changedFiles: changes.map(i => path.relative(root, i.file)), backup, server: entry, tui: packageEntry, commands: ['/ddd', '/ddd-code', '/ddd-status', '/ddd-workflow (native TUI)'], skills: skills.filter(f => path.basename(f) === 'SKILL.md').length, note: '本地路径安装。请保留此源码目录及依赖；重启 OpenCode 生效。' }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2), options = {}
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--check') options.check = true
      else if (args[i] === '--config-root' && args[i + 1] && !args[i + 1].startsWith('--')) options.root = args[++i]
      else throw new Error('用法：npm run install:opencode -- [--config-root <目录>] [--check]')
    }
    console.log(JSON.stringify(await installOpenCode(options), null, 2))
  } catch (error) { console.error(`安装失败：${error.message}`); process.exitCode = 1 }
}
