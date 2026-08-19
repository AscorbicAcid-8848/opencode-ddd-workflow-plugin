#!/usr/bin/env node

import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import {
  cp,
  mkdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises"
import { existsSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const packageRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const packageManifest = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"))
const OPEN_SPEC_VERSION = packageManifest.dependencies["@fission-ai/openspec"]
const OPENCODE_PLUGIN_VERSION = packageManifest.dependencies["@opencode-ai/plugin"]
const DDD_TOOL_NAMES = [
  "ddd_workflow_init",
  "ddd_workflow_prepare",
  "ddd_workflow_submit",
  "ddd_workflow_review",
  "ddd_workflow_status",
  "ddd_workflow_archive",
  "ddd_openspec_action",
]
const RETIRED_DDD_TOOL_NAMES = [
  "ddd_environment_doctor",
  "ddd_workflow_begin_stage",
  "ddd_workflow_prepare_milestone",
  "ddd_workflow_prepare_stage",
  "ddd_workflow_submit_milestone",
  "ddd_workflow_submit_stage",
  "ddd_workflow_checkpoint",
  "ddd_workflow_migrate_layout",
]
// OpenCode-compatible hosts enumerate every export from files in plugins/ and
// treat each value as a plugin initializer. Keep the host-facing shim to one
// default export; package-only admin/runtime exports remain available from the
// package entry point without being mistaken for plugins by mobile-coder.
const OPENCODE_PLUGIN_LOADER = `export { DddWorkflowPlugin as default } from "../ddd-workflow-plugin/dist/index.js"\n`
const MOBILE_PLUGIN_LOADER = `export { DddWorkflowProtectionPlugin as default } from "../ddd-workflow-plugin/dist/index.js"\n`
const mobileToolFiles = Object.fromEntries(DDD_TOOL_NAMES.map((name) => [
  `${name}.js`,
  `import { dddWorkflowTools } from "../ddd-workflow-plugin/dist/index.js"\nexport default dddWorkflowTools.${name}\n`,
]))

const legacyCommandFiles = {
  "ddd.md": `---
description: 持续执行一条 DDD 工作流，直到人工里程碑、完成或真实阻塞
---

把下面内容作为用户原始请求。先加载 \`ddd-orchestrate\`，根据当前仓库状态和用户意图互斥选择一条 DDD 工作流：

$ARGUMENTS

路由后加载被选工作流的总控 Skill，并完全按照当前安装的 \`ddd-*\` Skills、阶段内禀合同、六个人工里程碑和 OpenSpec 生命周期执行。不得添加 Skills 之外的工作流阶段、角色或工件。

这是持续执行命令，不是“完成一个阶段就返回”的命令。必须遵守以下停机合同：

1. 把每个 \`ddd_workflow_*\` 工具返回 JSON 中的 \`transition\` 以及 status 顶层同名字段作为唯一权威。不得依据罗马数字文档名、文档是否存在、\`currentStage\`、checkpoint 数量或自然语言摘要自行判断里程碑已经到达。
2. \`init\` 后以及每次 \`checkpoint\`、\`review\` 后，立即调用一次 \`ddd_workflow_status\`。每次得到 checkpoint 或 status 结果后都必须读取 \`stopAllowed\`、\`requiredAction\`、\`nextStage\` 和 \`humanReviewRequired\`。
3. 当 \`stopAllowed === false\` 时，禁止结束当前回复、禁止请求人工验收、禁止把累计构建文档称为已完成里程碑。普通阶段必须在当前调用中按照唯一合法的 \`nextStage\` 继续：先 \`begin-stage\`，完成对应 Skill 工作与候选工件，随后 \`checkpoint\`，刷新 status，再次判断。若 \`requiredAction === "select-next-stage"\` 且 \`nextStage\` 为空，必须依据已批准的完成条件从 \`allowedNextStages\` 中选择并继续，不得因需要选择而停下，也不得选择列表之外的阶段。即使阶段 01 已写入 \`I-*.md\` 也必须继续。
4. 当 \`requiredAction === "archive"\` 时立即调用 \`ddd_workflow_archive\` 并再次读取 status，不得停在待归档状态。只有以下情况可以停止：\`stopAllowed === true\` 且正在等待人工里程碑验收或人工关卡的新决定；\`requiredAction === "complete"\`；或者工具明确失败，并且在不越权、不猜测用户决定的前提下已无法安全恢复的真实阻塞。其他情况一律继续循环。
5. 若 status 缺少 \`stopAllowed\`，不得把缺失值当作允许停止；先重新读取 status。仍缺失时，将其作为运行时安装不一致的真实阻塞报告。
`,
  "ddd-status.md": `---
description: 查看并解释一个 DDD 工作流的当前状态和下一动作
---

加载 \`ddd-orchestrate\` skill。根据参数中的 workflow type 与 workflow id 调用 \`ddd_workflow_status\`，用中文说明已完成阶段、当前人类里程碑、OpenSpec change 状态和唯一合法下一动作；不要推进或修改工作流。

$ARGUMENTS
`,
}

const commandFiles = {
  "ddd.md": `---
description: 持续执行一条 DDD 工作流，直到人工里程碑、完成或真实阻塞
---

把下面内容作为用户原始请求。加载 \`ddd-orchestrate\`，根据仓库现状和用户意图互斥选择新增功能、遗留系统重构或新系统创建中的一条工作流：

$ARGUMENTS

使用当前安装的 \`ddd-*\` Skills、六个人工里程碑和同名 OpenSpec change，并遵守以下精简合同：

1. 只以工具返回的 \`transition\` 为准；\`stopAllowed === false\` 时按 \`nextStage\` 或 \`allowedNextStages\` 继续，不能因罗马文档存在或内部阶段完成而停止。
2. 分析与设计调用一次 \`ddd_workflow_prepare(mode=milestone)\`，在一次推理中完成其 \`submissionOrder\`，再调用一次 \`ddd_workflow_submit(mode=milestone)\`。以返回合同为完整输入，不要读取完整 profile、intrinsic catalog 或 legacy artifact contract，也不要为每个内部阶段重复读取仓库或回复用户。
3. 只有可重复实现、显式回溯选择或单阶段修订使用同一对工具的 \`mode=stage\`，且 Submit 只包含一个 entry。每个实现切片仍单独测试、Git 提交和记录证据，不得批量跳过。
4. 首次提交使用强类型 \`submission\`。失败后只按全部 findings 提交 \`repair_patch\`，由运行时保留未修改字段；不要重建完整 payload。批次部分成功时只重提返回的剩余 \`submissionOrder\`。
5. 不手工修改里程碑文档、机器工件、hash 或 OpenSpec change。\`runtime-contract-repair\`、\`OPENSPEC_*\` 或不可重试错误出现时立即停止，不用 Bash、npx 或全局安装猜测恢复。
6. 仅在人工里程碑等待决策、\`complete\`、真实运行时阻塞时停止；\`archive\` 必须立即执行。正常成功直接读取返回的 transition，不额外查询 status。
`,
  "ddd-status.md": `---
description: 查看并解释一条 DDD 工作流的当前状态和下一动作
---

加载 \`ddd-orchestrate\`，根据参数调用 \`ddd_workflow_status\`。用中文区分“内部阿拉伯数字阶段”和“罗马数字人工里程碑”，说明 OpenSpec change 状态、\`stopAllowed\`、\`requiredAction\` 和合法下一动作。只读展示，不要推进或修改工作流。

$ARGUMENTS
`,
}

function usage() {
  return `用法：
  ddd-opencode init [--host <opencode|mobile>] [--global] [--replace-legacy] [--project <目录>] [--force] [--skip-install]
  ddd-opencode doctor [--host <opencode|mobile>] [--global] [--project <目录>]

init 会安装兼容 OpenCode/mobile-coder 的 plugin、DDD skills、命令和本地 OpenSpec CLI。`
}

function parseArguments(argv) {
  if (!argv.length || argv[0] === "--help" || argv[0] === "-h") {
    return { command: "help", project: process.cwd(), host: "opencode", global: false, replaceLegacy: false, force: false, install: true }
  }
  const result = {
    command: argv[0],
    project: process.cwd(),
    host: "opencode",
    global: false,
    replaceLegacy: false,
    force: false,
    install: true,
  }
  for (let index = 1; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === "--project") result.project = path.resolve(argv[++index])
    else if (value === "--host") {
      result.host = argv[++index]
      if (!new Set(["opencode", "mobile"]).has(result.host)) {
        throw new Error(`不支持的 host：${result.host}`)
      }
    }
    else if (value === "--global") result.global = true
    else if (value === "--replace-legacy") result.replaceLegacy = true
    else if (value === "--force") result.force = true
    else if (value === "--skip-install") result.install = false
    else if (value === "--help" || value === "-h") result.command = "help"
    else throw new Error(`未知参数：${value}`)
  }
  return result
}

function configurationRoot(options) {
  const directory = options.host === "mobile" ? "mobile-coder" : "opencode"
  if (options.global) {
    const base = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config")
    return path.join(base, directory)
  }
  return path.join(options.project, options.host === "mobile" ? ".mobile-coder" : ".opencode")
}

function inside(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child))
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative)
}

async function safeRemove(configRoot, target) {
  if (!inside(configRoot, target)) throw new Error(`拒绝删除配置目录之外的路径：${target}`)
  await rm(target, { recursive: true, force: true })
}

async function sha256(file) {
  return createHash("sha256").update(await readFile(file)).digest("hex")
}

async function sameSkill(source, destination, entries) {
  if (!existsSync(destination)) return false
  for (const entry of entries) {
    const target = path.join(destination, ...entry.path.split("/").slice(1))
    if (!existsSync(target) || await sha256(target) !== entry.sha256) return false
  }
  return true
}

async function writeManagedFile(file, content, managedUpdate, force) {
  if (existsSync(file)) {
    const current = await readFile(file, "utf8")
    if (current !== content && !managedUpdate && !force) {
      throw new Error(`文件已存在且不属于本 plugin：${file}。如确认覆盖，请增加 --force。`)
    }
  }
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, content, "utf8")
}

async function ensureGitIgnore(file) {
  const current = existsSync(file) ? await readFile(file, "utf8") : ""
  const lines = current.split(/\r?\n/).filter(Boolean)
  if (!lines.includes("node_modules/")) lines.push("node_modules/")
  await writeFile(file, `${lines.join("\n")}\n`, "utf8")
}

async function removeLegacyPythonPermissions(configRoot, host) {
  const file = path.join(configRoot, host === "mobile" ? "mobile-coder.json" : "opencode.json")
  if (!existsSync(file)) return 0
  const parsed = JSON.parse(await readFile(file, "utf8"))
  let removed = 0
  const clean = (value) => {
    if (Array.isArray(value)) return value.filter((item) => {
      const legacy = typeof item === "string" && /ddd_workflow\.py/i.test(item)
      if (legacy) removed += 1
      return !legacy
    }).map(clean)
    if (value && typeof value === "object") {
      for (const [key, child] of Object.entries(value)) value[key] = clean(child)
    }
    return value
  }
  clean(parsed)
  if (removed) await writeFile(file, `${JSON.stringify(parsed, null, 2)}\n`, "utf8")
  return removed
}

async function reconcileWorkflowPermissions(configRoot, host) {
  const file = path.join(configRoot, host === "mobile" ? "mobile-coder.json" : "opencode.json")
  if (!existsSync(file)) return { added: 0, removed: 0 }
  const parsed = JSON.parse(await readFile(file, "utf8"))
  parsed.permission = parsed.permission && typeof parsed.permission === "object"
    ? parsed.permission
    : {}
  let added = 0
  let removed = 0
  for (const name of RETIRED_DDD_TOOL_NAMES) {
    if (name in parsed.permission) {
      delete parsed.permission[name]
      removed += 1
    }
  }
  for (const name of DDD_TOOL_NAMES) {
    if (parsed.permission[name] !== "allow") {
      parsed.permission[name] = "allow"
      added += 1
    }
  }
  if (added || removed) await writeFile(file, `${JSON.stringify(parsed, null, 2)}\n`, "utf8")
  return { added, removed }
}

function run(executable, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd, stdio: "inherit", windowsHide: true, shell: false })
    child.on("error", reject)
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`${executable} exited with ${code}`)))
  })
}

async function installDependencies(configRoot) {
  const nodeAdjacentNpm = path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js")
  const npmCli = process.env.npm_execpath && process.env.npm_execpath.endsWith(".js")
    ? process.env.npm_execpath
    : nodeAdjacentNpm
  if (existsSync(npmCli)) {
    await run(process.execPath, [npmCli, "install", "--no-audit", "--no-fund"], configRoot)
    return
  }
  if (process.platform === "win32") {
    await run(process.env.ComSpec || "cmd.exe", [
      "/d", "/s", "/c", "npm", "install", "--no-audit", "--no-fund",
    ], configRoot)
    return
  }
  await run("npm", ["install", "--no-audit", "--no-fund"], configRoot)
}

async function install(projectRoot, options) {
  const configRoot = configurationRoot(options)
  const vendorRoot = path.join(configRoot, "ddd-workflow-plugin")
  const installManifestPath = path.join(vendorRoot, "install-manifest.json")
  const managedUpdate = existsSync(installManifestPath)
  const bundleManifest = JSON.parse(
    await readFile(path.join(packageRoot, "resources", "workflow-manifest.json"), "utf8"),
  )

  let removedLegacy = null
  if (options.replaceLegacy) {
    if (options.host !== "mobile") throw new Error("--replace-legacy 只用于替换 mobile-coder 的旧 DDD plugin")
    const legacy = path.resolve(configRoot, "opencode-ddd-workflow")
    if (!inside(configRoot, legacy) || path.basename(legacy) !== "opencode-ddd-workflow") {
      throw new Error(`旧 plugin 路径校验失败：${legacy}`)
    }
    if (existsSync(legacy)) {
      await rm(legacy, { recursive: true, force: true })
      removedLegacy = legacy
    }
  }

  await mkdir(configRoot, { recursive: true })
  const removedPythonPermissions = await removeLegacyPythonPermissions(configRoot, options.host)
  const workflowPermissions = await reconcileWorkflowPermissions(configRoot, options.host)
  if (existsSync(vendorRoot) && !managedUpdate && !options.force) {
    throw new Error(`${vendorRoot} 已存在且没有 plugin 所有权清单；如确认覆盖，请增加 --force。`)
  }
  if (existsSync(vendorRoot)) await safeRemove(configRoot, vendorRoot)
  await mkdir(vendorRoot, { recursive: true })
  await cp(path.join(packageRoot, "dist"), path.join(vendorRoot, "dist"), { recursive: true })
  await cp(path.join(packageRoot, "resources"), path.join(vendorRoot, "resources"), { recursive: true })

  for (const skill of bundleManifest.skills) {
    const source = path.join(packageRoot, "resources", "skills", skill)
    const destination = path.join(configRoot, "skills", skill)
    const entries = bundleManifest.files.filter((entry) => entry.path.startsWith(`${skill}/`))
    const identical = await sameSkill(source, destination, entries)
    if (existsSync(destination) && !identical && !managedUpdate && !options.force) {
      throw new Error(`OpenCode skill 已存在且内容不同：${destination}。如确认覆盖，请增加 --force。`)
    }
    if (existsSync(destination)) await safeRemove(configRoot, destination)
    await mkdir(path.dirname(destination), { recursive: true })
    await cp(source, destination, { recursive: true })
  }

  await writeManagedFile(
    path.join(configRoot, "plugins", "ddd-workflow.js"),
    options.host === "mobile" ? MOBILE_PLUGIN_LOADER : OPENCODE_PLUGIN_LOADER,
    managedUpdate,
    options.force,
  )
  if (options.host === "mobile") {
    for (const [name, content] of Object.entries(mobileToolFiles)) {
      await writeManagedFile(path.join(configRoot, "tools", name), content, managedUpdate, options.force)
    }
  }
  for (const [name, content] of Object.entries(commandFiles)) {
    await writeManagedFile(path.join(configRoot, "commands", name), content, managedUpdate, options.force)
  }

  const dependencyManifestPath = path.join(configRoot, "package.json")
  const dependencyManifest = existsSync(dependencyManifestPath)
    ? JSON.parse(await readFile(dependencyManifestPath, "utf8"))
    : { private: true, type: "module" }
  dependencyManifest.private = true
  dependencyManifest.type = "module"
  dependencyManifest.dependencies = {
    ...(dependencyManifest.dependencies ?? {}),
    "@fission-ai/openspec": OPEN_SPEC_VERSION,
    "@opencode-ai/plugin": OPENCODE_PLUGIN_VERSION,
  }
  delete dependencyManifest.dependencies.zod
  await writeFile(dependencyManifestPath, `${JSON.stringify(dependencyManifest, null, 2)}\n`, "utf8")
  await ensureGitIgnore(path.join(configRoot, ".gitignore"))

  await writeFile(installManifestPath, `${JSON.stringify({
    schema: "ddd-opencode-plugin-install/v1",
    plugin: packageManifest.name,
    version: packageManifest.version,
    host: options.host,
    scope: options.global ? "global" : "project",
    installedAt: new Date().toISOString(),
    skills: bundleManifest.skills,
    openspec: OPEN_SPEC_VERSION,
    engine: "typescript",
    pythonRequired: false,
    openCodeSdk: OPENCODE_PLUGIN_VERSION,
    tools: DDD_TOOL_NAMES,
    toolRegistration: options.host === "mobile" ? "mobile-native-tools-directory" : "opencode-plugin-sdk",
  }, null, 2)}\n`, "utf8")

  if (options.install) await installDependencies(configRoot)
  process.stdout.write([
    removedLegacy ? `已卸载旧 DDD plugin：${removedLegacy}` : null,
    removedPythonPermissions ? `已移除 ${removedPythonPermissions} 条旧 Python 工作流权限。` : null,
    workflowPermissions.added ? `已同步 ${workflowPermissions.added} 条 DDD 工具权限。` : null,
    workflowPermissions.removed ? `已移除 ${workflowPermissions.removed} 条不再注入模型的旧 DDD 工具权限。` : null,
    `已安装 DDD workflow plugin：${vendorRoot}`,
    `目标宿主：${options.host}（${options.global ? "全局" : "项目级"}）`,
    `已安装 ${bundleManifest.skills.length} 个 DDD skills：${path.join(configRoot, "skills")}`,
    `已内置 OpenSpec CLI：@fission-ai/openspec@${OPEN_SPEC_VERSION}`,
    `工作流引擎：TypeScript + @opencode-ai/plugin@${OPENCODE_PLUGIN_VERSION}（无需 Python）`,
    options.install ? "配置目录依赖已安装。" : `已跳过依赖安装；${options.host === "mobile" ? "mobile-coder" : "OpenCode"} 首次启动时会用 Bun 安装。`,
    `启动 ${options.host === "mobile" ? "mobile-coder" : "OpenCode"} 后使用：/ddd <你的需求>`,
    `如果 ${options.host === "mobile" ? "mobile-coder" : "OpenCode"} 已在运行，请重启并新建会话以加载更新后的命令与工具。`,
  ].filter(Boolean).join("\n") + "\n")
}

async function doctor(projectRoot, options) {
  const configRoot = configurationRoot(options)
  const managedCommands = Object.entries(commandFiles).map(([name, content]) => ({
    file: path.join(configRoot, "commands", name),
    content,
  }))
  const required = [
    path.join(configRoot, "plugins", "ddd-workflow.js"),
    path.join(configRoot, "skills", "ddd-orchestrate", "SKILL.md"),
    path.join(configRoot, "ddd-workflow-plugin", "install-manifest.json"),
    path.join(configRoot, "ddd-workflow-plugin", "dist", "index.js"),
    ...managedCommands.map((command) => command.file),
    ...(options.host === "mobile" ? Object.keys(mobileToolFiles).map((name) => path.join(configRoot, "tools", name)) : []),
    path.join(configRoot, "node_modules", "@fission-ai", "openspec", "bin", "openspec.js"),
  ]
  const missing = required.filter((file) => !existsSync(file))
  if (missing.length) throw new Error(`安装不完整：\n${missing.join("\n")}`)
  const outdatedCommands = []
  for (const command of managedCommands) {
    if (await readFile(command.file, "utf8") !== command.content) {
      outdatedCommands.push(command.file)
    }
  }
  if (outdatedCommands.length) {
    throw new Error(`命令模板不是当前 plugin 版本，请重新运行 init：\n${outdatedCommands.join("\n")}`)
  }
  const pluginLoader = path.join(configRoot, "plugins", "ddd-workflow.js")
  const expectedLoader = options.host === "mobile" ? MOBILE_PLUGIN_LOADER : OPENCODE_PLUGIN_LOADER
  if (await readFile(pluginLoader, "utf8") !== expectedLoader) {
    throw new Error(`Plugin loader is not the current single-entry host shim; rerun init: ${pluginLoader}`)
  }
  if (options.host === "mobile") {
    for (const [name, content] of Object.entries(mobileToolFiles)) {
      const file = path.join(configRoot, "tools", name)
      if (await readFile(file, "utf8") !== content) throw new Error(`Mobile 原生工具 shim 不是当前版本：${file}`)
    }
  }
  const openspec = required.at(-1)
  await run(process.execPath, [openspec, "--version"], projectRoot)
  process.stdout.write("DDD plugin、skills、Slash 命令与项目本地 OpenSpec CLI 均可用。\n")
}

try {
  const options = parseArguments(process.argv.slice(2))
  if (options.command === "init") await install(options.project, options)
  else if (options.command === "doctor") await doctor(options.project, options)
  else if (options.command === "help" || !options.command) process.stdout.write(`${usage()}\n`)
  else throw new Error(`未知命令：${options.command}\n${usage()}`)
} catch (error) {
  process.stderr.write(`${error.message}\n`)
  process.exitCode = 1
}
