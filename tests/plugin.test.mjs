import assert from "node:assert/strict"
import { existsSync } from "node:fs"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import { spawn } from "node:child_process"
import { tool } from "@opencode-ai/plugin"
import plugin, { bundledOpenSpec, dddWorkflowAdmin, openSpecNodeExecutable } from "../dist/index.js"

const packageRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

function run(executable, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd, windowsHide: true, shell: false })
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (chunk) => { stdout += chunk })
    child.stderr.on("data", (chunk) => { stderr += chunk })
    child.on("error", reject)
    child.on("close", (code) => code === 0
      ? resolve({ stdout, stderr })
      : reject(new Error(stderr || stdout || `exit ${code}`)))
  })
}

function prepareStageTool(hooks, args, context) {
  return hooks.tool.ddd_workflow_prepare.execute({ ...args, mode: "stage" }, context)
}

function prepareMilestoneTool(hooks, args, context) {
  return hooks.tool.ddd_workflow_prepare.execute({ ...args, mode: "milestone" }, context)
}

function submitStageTool(hooks, args, context) {
  const { workflow_type, workflow_id, project_root, ...entry } = args
  return hooks.tool.ddd_workflow_submit.execute({
    workflow_type, workflow_id, project_root, mode: "stage", submissions: [entry],
  }, context)
}

function submitMilestoneTool(hooks, args, context) {
  return hooks.tool.ddd_workflow_submit.execute({ ...args, mode: "milestone" }, context)
}

function completeHumanSections(contract, topLevelSections) {
  const result = { ...topLevelSections }
  for (const group of contract.sectionContract ?? []) {
    for (const [index, subsection] of group.subsections.entries()) {
      if (index === 0 && topLevelSections[group.heading]) continue
      result[subsection] = `本轮已完成“${subsection}”分析；未发现的事项明确记为无，后续新证据必须返回本里程碑修订。`
    }
  }
  return result
}

test("plugin exposes deterministic DDD workflow tools", async () => {
  const hooks = await plugin({})
  assert.deepEqual(Object.keys(hooks.tool).sort(), [
    "ddd_openspec_action",
    "ddd_workflow_archive",
    "ddd_workflow_init",
    "ddd_workflow_prepare",
    "ddd_workflow_review",
    "ddd_workflow_status",
    "ddd_workflow_submit",
  ])
  assert.equal(typeof hooks.config, "function")
  assert.equal(typeof hooks["tool.execute.before"], "function")
})

test("plugin denies direct milestone document edits while preserving normal code edits", async () => {
  const project = await mkdtemp(path.join(os.tmpdir(), "ddd-milestone-protection-"))
  try {
    const hooks = await plugin({ worktree: project, directory: project })
    const config = {
      permission: {
        edit: { "*": "allow", "src/generated/*": "ask" },
        bash: "allow",
      },
    }
    await hooks.config(config)
    assert.equal(config.permission.edit["*"], "allow")
    assert.equal(config.permission.edit["src/generated/*"], "ask")
    assert.equal(config.permission.edit["openspec/changes/*/ddd/*I-strategic-eventstorm.md"], "deny")
    assert.equal(config.permission.edit["openspec/changes/*/ddd/*VI-final-acceptance.md"], "deny")
    assert.equal(config.permission.edit["docs/ddd/*/*IV-tactical-design.md"], "deny")
    assert.equal(config.permission.bash, "allow")

    const before = hooks["tool.execute.before"]
    await assert.rejects(
      before(
        { tool: "write", sessionID: "session", callID: "call" },
        { args: { filePath: path.join(project, "openspec", "changes", "visit", "ddd", "I-strategic-eventstorm.md") } },
      ),
      /DDD_MILESTONE_DOCUMENT_PROTECTED.*ddd_workflow_submit/s,
    )
    await assert.rejects(
      before(
        { tool: "apply_patch", sessionID: "session", callID: "call" },
        { args: { patchText: "*** Begin Patch\n*** Update File: openspec/changes/archive/2026-08-17-visit/ddd/VI-final-acceptance.md\n@@\n-old\n+new\n*** End Patch" } },
      ),
      /DDD_MILESTONE_DOCUMENT_PROTECTED.*VI-final-acceptance\.md/s,
    )
    await assert.rejects(
      before(
        { tool: "edit", sessionID: "session", callID: "call" },
        { args: { filePath: "docs/ddd/legacy-change/IV-tactical-design.md" } },
      ),
      /DDD_MILESTONE_DOCUMENT_PROTECTED/,
    )

    await before(
      { tool: "write", sessionID: "session", callID: "call" },
      { args: { filePath: path.join(project, "src", "application", "VisitService.ts") } },
    )
    await before(
      { tool: "ddd_workflow_submit", sessionID: "session", callID: "call" },
      { args: { filePath: "openspec/changes/visit/ddd/I-strategic-eventstorm.md" } },
    )
  } finally {
    await rm(project, { recursive: true, force: true })
  }
})

test("model-visible DDD tool schemas stay within the reduced context budget", async () => {
  const hooks = await plugin({})
  const payloads = Object.entries(hooks.tool).map(([name, definition]) => JSON.stringify({
    name,
    description: definition.description,
    parameters: tool.schema.toJSONSchema(tool.schema.object(definition.args)),
  }))
  const totalCharacters = payloads.reduce((total, payload) => total + payload.length, 0)
  assert.equal(payloads.length, 7)
  assert.ok(totalCharacters <= 10_500, `tool schema budget exceeded: ${totalCharacters} characters`)
  assert.ok(Math.ceil(totalCharacters / 4) <= 2_625, `estimated tool token budget exceeded: ${Math.ceil(totalCharacters / 4)}`)
})

test("bundled OpenSpec CLI is the pinned package", async () => {
  const runtime = bundledOpenSpec()
  assert.equal(runtime.version, "1.7.0")
  assert.ok(existsSync(runtime.script))
  const result = await run(process.execPath, [runtime.script, "--version"], packageRoot)
  assert.match(result.stdout, /1\.7\.0/)
})

test("OpenSpec launcher never treats a standalone Mobile host as Node", () => {
  assert.equal(
    openSpecNodeExecutable("C:\\Users\\tester\\mobile-bin.exe", {}),
    "node",
  )
  assert.equal(
    openSpecNodeExecutable("C:\\runtime\\node.exe", {}),
    "C:\\runtime\\node.exe",
  )
  assert.equal(
    openSpecNodeExecutable("C:\\Users\\tester\\mobile-bin.exe", { DDD_NODE_EXECUTABLE: "D:\\node\\node.exe" }),
    "D:\\node\\node.exe",
  )
})

test("OpenSpec launcher failure returns a terminal structured runtime contract", async () => {
  const project = await mkdtemp(path.join(os.tmpdir(), "ddd-openspec-launch-failure-"))
  const previous = process.env.DDD_NODE_EXECUTABLE
  process.env.DDD_NODE_EXECUTABLE = path.join(project, "missing-node.exe")
  try {
    const hooks = await plugin({})
    const result = JSON.parse(await hooks.tool.ddd_workflow_init.execute({
      workflow_type: "create-system",
      workflow_id: "launcher-failure",
      title: "Launcher failure",
      request: "Verify deterministic runtime failure handling.",
    }, { worktree: project, directory: project }))
    assert.equal(result.accepted, false)
    assert.equal(result.error.code, "OPENSPEC_LAUNCH_FAILED")
    assert.equal(result.error.retryableByModel, false)
    assert.equal(result.requiredAction, "runtime-contract-repair")
    assert.equal(result.stopAllowed, true)
    assert.equal(result.transition.stopAllowed, true)
    assert.match(result.transition.message, /不得调用 Bash、npx、npm 全局安装/)
    assert.equal(existsSync(path.join(project, "openspec", "changes", "launcher-failure")), false)
  } finally {
    if (previous === undefined) delete process.env.DDD_NODE_EXECUTABLE
    else process.env.DDD_NODE_EXECUTABLE = previous
    await rm(project, { recursive: true, force: true })
  }
})

test("workflow bundle excludes transient test repositories", async () => {
  const manifest = JSON.parse(await readFile(
    path.join(packageRoot, "resources", "workflow-manifest.json"),
    "utf8",
  ))
  const transient = manifest.files
    .map((entry) => entry.path)
    .filter((entry) => /\/(?:\.git|tmp[a-z0-9_]+)(?:\/|$)/i.test(entry))
  assert.deepEqual(transient, [])
  assert.deepEqual(manifest.files.map((entry) => entry.path).filter((entry) => /\.pyc?$/.test(entry)), [])
})

test("installer creates a self-contained OpenCode project configuration", async () => {
  const project = await mkdtemp(path.join(os.tmpdir(), "ddd-opencode-plugin-"))
  try {
    await run(process.execPath, [
      path.join(packageRoot, "bin", "ddd-opencode.mjs"),
      "init",
      "--project", project,
      "--skip-install",
    ], packageRoot)
    assert.ok(existsSync(path.join(project, ".opencode", "plugins", "ddd-workflow.js")))
    assert.equal(
      await readFile(path.join(project, ".opencode", "plugins", "ddd-workflow.js"), "utf8"),
      `export { DddWorkflowPlugin as default } from "../ddd-workflow-plugin/dist/index.js"\n`,
    )
    assert.ok(existsSync(path.join(project, ".opencode", "skills", "ddd-orchestrate", "SKILL.md")))
    assert.ok(existsSync(path.join(project, ".opencode", "commands", "ddd.md")))
    assert.equal(existsSync(path.join(project, ".opencode", "commands", "ddd-team.md")), false)
    const manifest = JSON.parse(await readFile(path.join(project, ".opencode", "package.json"), "utf8"))
    assert.equal(manifest.dependencies["@fission-ai/openspec"], "1.7.0")
    assert.equal(manifest.dependencies.zod, undefined)
    assert.equal(manifest.dependencies["@opencode-ai/plugin"], "1.18.18")
    assert.ok(existsSync(path.join(project, ".opencode", "ddd-workflow-plugin", "dist", "index.js")))
    assert.equal(existsSync(path.join(project, ".opencode", "ddd-workflow-plugin", "src")), false)
  } finally {
    await rm(project, { recursive: true, force: true })
  }
})

test("installer supports mobile-coder project discovery paths", async () => {
  const project = await mkdtemp(path.join(os.tmpdir(), "ddd-mobile-plugin-"))
  try {
    const installer = path.join(packageRoot, "bin", "ddd-opencode.mjs")
    const installArguments = [
      installer,
      "init",
      "--host", "mobile",
      "--project", project,
      "--replace-legacy",
      "--skip-install",
    ]
    const legacy = path.join(project, ".mobile-coder", "opencode-ddd-workflow")
    await mkdir(legacy, { recursive: true })
    await writeFile(path.join(legacy, "legacy-marker.txt"), "legacy", "utf8")
    await writeFile(path.join(project, ".mobile-coder", "mobile-coder.json"), `${JSON.stringify({ permission: {
      bash: { whitelist: ["python scripts/ddd_workflow.py", "git status"] },
      ddd_workflow_prepare_stage: "allow",
      ddd_workflow_submit_stage: "allow",
    } }, null, 2)}\n`, "utf8")
    await run(process.execPath, installArguments, packageRoot)
    assert.ok(existsSync(path.join(project, ".mobile-coder", "plugins", "ddd-workflow.js")))
    assert.equal(
      await readFile(path.join(project, ".mobile-coder", "plugins", "ddd-workflow.js"), "utf8"),
      `export { DddWorkflowProtectionPlugin as default } from "../ddd-workflow-plugin/dist/index.js"\n`,
    )
    for (const name of [
      "ddd_workflow_init", "ddd_workflow_prepare", "ddd_workflow_submit", "ddd_workflow_review",
      "ddd_workflow_status", "ddd_workflow_archive", "ddd_openspec_action",
    ]) {
      const file = path.join(project, ".mobile-coder", "tools", `${name}.js`)
      assert.ok(existsSync(file), `missing Mobile native tool shim: ${name}`)
      assert.match(await readFile(file, "utf8"), new RegExp(`dddWorkflowTools\\.${name}`))
    }
    assert.ok(existsSync(path.join(project, ".mobile-coder", "skills", "ddd-orchestrate", "SKILL.md")))
    const dddCommandPath = path.join(project, ".mobile-coder", "commands", "ddd.md")
    const statusCommandPath = path.join(project, ".mobile-coder", "commands", "ddd-status.md")
    assert.ok(existsSync(dddCommandPath))
    assert.equal(existsSync(path.join(project, ".mobile-coder", "commands", "ddd-team.md")), false)
    assert.equal(existsSync(legacy), false)
    const hostConfig = JSON.parse(await readFile(path.join(project, ".mobile-coder", "mobile-coder.json"), "utf8"))
    assert.deepEqual(hostConfig.permission.bash.whitelist, ["git status"])
    for (const name of [
      "ddd_workflow_init",
      "ddd_workflow_prepare",
      "ddd_workflow_submit",
      "ddd_workflow_review",
      "ddd_workflow_status",
      "ddd_workflow_archive",
      "ddd_openspec_action",
    ]) assert.equal(hostConfig.permission[name], "allow")
    assert.equal(hostConfig.permission.ddd_workflow_prepare_stage, undefined)
    assert.equal(hostConfig.permission.ddd_workflow_submit_stage, undefined)
    const dddCommand = await readFile(dddCommandPath, "utf8")
    assert.match(dddCommand, /stopAllowed === false/)
    assert.match(dddCommand, /ddd_workflow_prepare\(mode=milestone\)/)
    assert.match(dddCommand, /ddd_workflow_submit\(mode=milestone\)/)
    assert.match(dddCommand, /同一对工具的 `mode=stage`/)
    assert.match(dddCommand, /Submit 只包含一个 entry/)
    assert.match(dddCommand, /每个内部阶段重复读取仓库/)
    assert.match(dddCommand, /可重复实现.*显式回溯选择.*单阶段修订/s)
    assert.match(dddCommand, /repair_patch/)
    assert.match(dddCommand, /不要重建完整 payload/)
    assert.match(dddCommand, /不要读取完整 profile.*intrinsic catalog.*legacy artifact contract/s)
    assert.match(dddCommand, /不用 Bash.*npx.*全局安装/s)
    assert.match(dddCommand, /不能因罗马文档存在.*停止/s)
    assert.match(dddCommand, /nextStage.*allowedNextStages/s)
    const statusCommand = await readFile(statusCommandPath, "utf8")
    assert.match(statusCommand, /只读展示，不要推进或修改工作流/)
    assert.doesNotMatch(statusCommand, /stopAllowed === false/)

    await writeFile(dddCommandPath, "旧版受管命令\n", "utf8")
    await run(process.execPath, installArguments, packageRoot)
    assert.equal(await readFile(dddCommandPath, "utf8"), dddCommand)

    const install = JSON.parse(await readFile(path.join(
      project,
      ".mobile-coder",
      "ddd-workflow-plugin",
      "install-manifest.json",
    ), "utf8"))
    assert.equal(install.host, "mobile")
    assert.equal(install.toolRegistration, "mobile-native-tools-directory")
    assert.equal(install.scope, "project")
    assert.equal(install.version, "3.0.3")
    assert.deepEqual(install.tools, [
      "ddd_workflow_init",
      "ddd_workflow_prepare",
      "ddd_workflow_submit",
      "ddd_workflow_review",
      "ddd_workflow_status",
      "ddd_workflow_archive",
      "ddd_openspec_action",
    ])
    assert.equal(install.engine, "typescript")
    assert.equal(install.pythonRequired, false)
    assert.equal(install.openCodeSdk, "1.18.18")

    const openspecScript = path.join(
      project,
      ".mobile-coder",
      "node_modules",
      "@fission-ai",
      "openspec",
      "bin",
      "openspec.js",
    )
    await mkdir(path.dirname(openspecScript), { recursive: true })
    await writeFile(openspecScript, 'process.stdout.write("1.7.0\\n")\n', "utf8")
    const doctorArguments = [
      installer,
      "doctor",
      "--host", "mobile",
      "--project", project,
    ]
    await run(process.execPath, doctorArguments, packageRoot)
    await writeFile(dddCommandPath, "过期命令\n", "utf8")
    await assert.rejects(
      run(process.execPath, doctorArguments, packageRoot),
      /命令模板不是当前 plugin 版本/,
    )
  } finally {
    await rm(project, { recursive: true, force: true })
  }
})

test("plugin initializes a real DDD workflow through the bundled OpenSpec CLI", async () => {
  const project = await mkdtemp(path.join(os.tmpdir(), "ddd-opencode-workflow-"))
  try {
    const hooks = await plugin({})
    const output = await hooks.tool.ddd_workflow_init.execute({
      workflow_type: "create-system",
      workflow_id: "plugin-smoke-system",
      title: "Plugin smoke system",
      request: "Create a small system to verify the packaged workflow runtime.",
    }, { worktree: project, directory: project })
    const initialized = JSON.parse(output)
    assert.equal(path.basename(initialized.artifactRoot), "ddd")
    assert.equal(path.basename(path.dirname(initialized.artifactRoot)), "plugin-smoke-system")
    assert.equal(path.basename(path.dirname(path.dirname(initialized.artifactRoot))), "changes")
    assert.equal(initialized.transition.stopAllowed, false)
    assert.equal(initialized.transition.requiredAction, "continue")
    assert.equal(initialized.transition.nextStage, "01-system-scenarios")
    const statusOutput = await hooks.tool.ddd_workflow_status.execute({
      workflow_type: "create-system",
      workflow_id: "plugin-smoke-system",
    }, { worktree: project, directory: project })
    const status = JSON.parse(statusOutput)
    assert.equal(status.stopAllowed, false)
    assert.equal(status.humanReviewRequired, false)
    assert.equal(status.nextStage, "01-system-scenarios")
    assert.ok(existsSync(path.join(
      project,
      "openspec",
      "changes",
      "plugin-smoke-system",
      ".openspec.yaml",
    )))
    assert.ok(existsSync(path.join(
      project,
      "openspec",
      "changes",
      "plugin-smoke-system",
      "ddd",
      "README.md",
    )))
  } finally {
    await rm(project, { recursive: true, force: true })
  }
})

test("milestone preparation groups the three profiles without removing their internal stages", async () => {
  const cases = [
    ["add-feature", "lean-add", ["01-current-evidence", "02-big-picture-event-storm"]],
    ["refactor-system", "lean-refactor", ["01-refactoring-scope-convergence", "01-baseline-evidence", "02-as-is-big-picture-event-storm"]],
    ["create-system", "lean-create", ["01-system-scenarios", "02-big-picture-event-storm"]],
  ]
  for (const [workflow_type, workflow_id, expected] of cases) {
    const project = await mkdtemp(path.join(os.tmpdir(), `ddd-${workflow_id}-`))
    try {
      const hooks = await plugin({})
      const context = { worktree: project, directory: project }
      await hooks.tool.ddd_workflow_init.execute({
        workflow_type, workflow_id, title: workflow_id, request: "Exercise the complete lean milestone path.",
      }, context)
      const prepared = JSON.parse(await prepareMilestoneTool(hooks, { workflow_type, workflow_id }, context))
      assert.deepEqual(prepared.submissionOrder, expected)
      assert.deepEqual(prepared.stages.map((stage) => stage.stage), expected)
      assert.equal(prepared.stages.at(-1).contract.stageRole, "human-gate")
    } finally {
      await rm(project, { recursive: true, force: true })
    }
  }
})

test("stage compiler returns all findings and blocks full-payload reconstruction after failure", async () => {
  const project = await mkdtemp(path.join(os.tmpdir(), "ddd-stage-compiler-"))
  try {
    const hooks = await plugin({})
    const context = { worktree: project, directory: project }
    const identity = { workflow_type: "create-system", workflow_id: "compiled-stage-system" }
    await hooks.tool.ddd_workflow_init.execute({
      ...identity,
      title: "Compiled stage system",
      request: "Create a system whose stage artifacts are compiled from domain submissions.",
    }, context)
    const prepared = JSON.parse(await prepareStageTool(hooks, {
      ...identity,
      stage: "01-system-scenarios",
    }, context))
    assert.equal(prepared.contract.stage, "01-system-scenarios")
    assert.match(prepared.contract.executionRule, /do not edit generated Markdown/i)
    assert.deepEqual(prepared.contract.skills, ["ddd-scope"])
    assert.ok(prepared.contract.evidenceReferencePrefixes.includes("code:"))
    assert.ok(prepared.contract.validDeferredTargets.includes("02-big-picture-event-storm"))
    assert.deepEqual(prepared.contract.outputContract.soleOutputRequired, ["statement", "itemRefs"])
    assert.deepEqual(Object.keys(prepared.contract.minimalShapeExample.soleOutput), ["statement", "itemRefs"])

    const invalidArgs = {
      ...identity,
      stage: "01-system-scenarios",
      summary: "Reject an incomplete system scenario payload.",
      submission: { inputReferences: [], items: [], sections: {}, soleOutput: {} },
    }
    const first = JSON.parse(await submitStageTool(hooks, invalidArgs, context))
    assert.equal(first.accepted, false)
    assert.ok(first.validation.findings.length >= 4)
    assert.equal(first.attempt.blocked, false)
    const second = JSON.parse(await submitStageTool(hooks, invalidArgs, context))
    assert.equal(second.accepted, false)
    assert.equal(second.error.code, "FULL_RESUBMISSION_FORBIDDEN")
    assert.equal(second.requiredAction, "runtime-contract-repair")
    assert.equal(second.stopAllowed, true)
  } finally {
    await rm(project, { recursive: true, force: true })
  }
})

test("typed stage submission preserves a draft across progressive JSON Patch repairs", async () => {
  const project = await mkdtemp(path.join(os.tmpdir(), "ddd-stage-patch-"))
  try {
    const hooks = await plugin({})
    const context = { worktree: project, directory: project }
    const identity = { workflow_type: "create-system", workflow_id: "patched-stage-system" }
    await hooks.tool.ddd_workflow_init.execute({
      ...identity,
      title: "Patched stage system",
      request: "Create a system and repair stage submissions without replacing valid fields.",
    }, context)
    await prepareStageTool(hooks, { ...identity, stage: "01-system-scenarios" }, context)

    const goal = {
      id: "GOAL-001",
      kind: "business-goal",
      statement: "Enable a user to complete and observe one valuable system-level business journey.",
      maturity: "proposed",
      documentSection: "业务主题与分析范围",
      attributes: {},
    }
    const item = {
      id: "SCENARIO-001",
      kind: "system-scenario",
      statement: "A user completes the primary system journey and observes its business result.",
      maturity: "proposed",
      documentSection: "输入场景与现状事实",
      attributes: {},
    }
    const baseSubmission = {
      inputReferences: ["user-input:initial-request"],
      items: [goal, item],
      relations: [],
      sections: {
        "业务主题与分析范围": "This stage defines only the actor goal and system-level business outcome.",
        "输入场景与现状事实": "The primary scenario covers the user intent and observable business result.",
      },
      soleOutput: { statement: "The approved system scenario is the sole input to Big Picture EventStorming." },
    }

    const first = JSON.parse(await submitStageTool(hooks, {
      ...identity,
      stage: "01-system-scenarios",
      summary: "Submit a nearly complete scenario while preserving the draft for repair.",
      submission: baseSubmission,
    }, context))
    assert.equal(first.accepted, false)
    assert.deepEqual(first.validation.findings.map((finding) => finding.code), ["SOLE-OUTPUT-REFS-REQUIRED"])
    assert.equal(first.attempt.progress, "first-failure")
    assert.equal(first.attempt.blocked, false)
    assert.equal(first.repair.mode, "json-patch")

    const resumed = JSON.parse(await prepareStageTool(hooks, {
      ...identity, stage: "01-system-scenarios",
    }, context))
    assert.equal(resumed.repairContext.available, true)
    assert.deepEqual(resumed.repairContext.findings.map((finding) => finding.code), ["SOLE-OUTPUT-REFS-REQUIRED"])

    const second = JSON.parse(await submitStageTool(hooks, {
      ...identity,
      stage: "01-system-scenarios",
      summary: "Exercise a different one-finding repair without triggering the progress fuse.",
      repair_patch: [
        { op: "remove", path: "/soleOutput/statement" },
        { op: "add", path: "/soleOutput/itemRefs", value: ["SCENARIO-001"] },
      ],
    }, context))
    assert.equal(second.accepted, false)
    assert.deepEqual(second.validation.findings.map((finding) => finding.code), ["SOLE-OUTPUT-STATEMENT-REQUIRED"])
    assert.equal(second.attempt.blocked, false)

    const third = JSON.parse(await submitStageTool(hooks, {
      ...identity,
      stage: "01-system-scenarios",
      summary: "Complete the saved draft with one additive repair.",
      repair_patch: [{
        op: "add",
        path: "/soleOutput/statement",
        value: "The approved system scenario is the sole input to Big Picture EventStorming.",
      }],
    }, context))
    assert.equal(third.accepted, true)
    assert.equal(third.validation.verdict, "pass")

    const workbench = path.join(project, "openspec", "changes", "patched-stage-system", "ddd", ".ddd", "workbench", "01-system-scenarios")
    const output = JSON.parse(await readFile(path.join(workbench, "stage-output.json"), "utf8"))
    assert.equal(output.soleOutput.statement, baseSubmission.soleOutput.statement)
    assert.deepEqual(output.soleOutput.itemRefs, ["SCENARIO-001"])

    const submissionSchema = hooks.tool.ddd_workflow_submit.args.submissions.element.shape.submission.unwrap()
    assert.equal(submissionSchema.safeParse(baseSubmission).success, false)
    assert.equal(submissionSchema.safeParse({
      ...baseSubmission,
      soleOutput: { statement: baseSubmission.soleOutput.statement, itemRefs: ["SCENARIO-001"] },
    }).success, true)
  } finally {
    await rm(project, { recursive: true, force: true })
  }
})

test("existing-system baseline is assessed through the typed submission and written by the runtime", async () => {
  const project = await mkdtemp(path.join(os.tmpdir(), "ddd-strategic-baseline-"))
  try {
    const hooks = await plugin({})
    const context = { worktree: project, directory: project }
    const identity = { workflow_type: "add-feature", workflow_id: "runtime-owned-baseline" }
    await hooks.tool.ddd_workflow_init.execute({
      ...identity,
      title: "Runtime-owned strategic baseline",
      request: "Add a small feature while preserving the existing system and its strategic history.",
    }, context)
    const prepared = JSON.parse(await prepareStageTool(hooks, {
      ...identity, stage: "01-current-evidence",
    }, context))
    assert.equal(prepared.contract.strategicBaseline.runtimeOwned, true)
    assert.equal(prepared.contract.strategicBaseline.phase, "inventory")
    assert.deepEqual(prepared.contract.semanticEnums.scopeDispositions, ["existing", "requested", "approved-prior", "candidate", "future"])
    assert.ok(prepared.contract.qualityContract.requiredContent.includes("OpenSpec历史战略基线"))

    const required = prepared.contract.qualityContract.requiredContent.join("；")
    const longEvidence = `${required}。` + "本轮只恢复已有行为、兼容约束和可检查证据，不在现状阶段设计目标边界、聚合或存储方案。".repeat(16)
    const result = JSON.parse(await submitStageTool(hooks, {
      ...identity,
      stage: "01-current-evidence",
      summary: "恢复现有行为事实、兼容约束与 OpenSpec 历史战略基线。",
      submission: {
        inputReferences: ["user-input:original-request"],
        items: [
          {
            id: "FACT-001", kind: "current-behavior-fact", statement: "当前系统可以启动并暴露既有业务入口。",
            maturity: "fact", documentSection: "输入场景与现状事实", evidenceRefs: ["runtime:startup"],
            attributes: {
              decisionPlane: "evidence", authorityRefs: ["runtime:startup"], observationLevel: "runtime-observed",
              availability: "operational", systemBoundary: "internal", evidenceSubject: "existing application startup",
            },
          },
          {
            id: "COMPAT-001", kind: "compatibility-constraint", statement: "新增功能不得破坏既有业务入口和启动行为。",
            maturity: "fact", documentSection: "证据与追踪", evidenceRefs: ["runtime:startup"],
            attributes: { decisionPlane: "evidence", authorityRefs: ["user-input:original-request"] },
          },
        ],
        relations: [],
        sections: { "输入场景与现状事实": longEvidence, "证据与追踪": longEvidence },
        soleOutput: { statement: "已验证的现状行为与兼容约束是战略事件风暴的唯一事实输入。", itemRefs: ["FACT-001", "COMPAT-001"] },
        strategicBaseline: {
          currentSpecs: prepared.contract.strategicBaseline.currentSpecs.map((item) => ({ path: item.path, relevance: "not-relevant", reason: "当前测试库存不影响该最小功能。" })),
          changes: prepared.contract.strategicBaseline.changes.map((item) => ({ path: item.path, relevance: "not-relevant", reason: "当前测试历史不影响该最小功能。" })),
          recoveredDecisions: [], unresolvedConflicts: [],
          strategicDisposition: { status: "pending", reused: [], changed: [], new: [], conflicts: [] },
        },
      },
    }, context))
    assert.equal(result.accepted, true, JSON.stringify(result, null, 2))
    const baseline = JSON.parse(await readFile(path.join(project, "openspec", "changes", "runtime-owned-baseline", "ddd", ".ddd", "strategic-baseline.json"), "utf8"))
    assert.equal(baseline.schema, "ddd-strategic-baseline/v1")
    assert.equal(baseline.strategicDisposition.status, "pending")
  } finally {
    await rm(project, { recursive: true, force: true })
  }
})

test("milestone batch preserves internal checkpoints and reaches the next human gate in two calls", async () => {
  const project = await mkdtemp(path.join(os.tmpdir(), "ddd-human-gate-"))
  try {
    const hooks = await plugin({})
    const context = { worktree: project, directory: project }
    const identity = { workflow_type: "create-system", workflow_id: "human-gate-regression" }
    await hooks.tool.ddd_workflow_init.execute({
      ...identity, title: "Human gate regression", request: "Create a system with one observable business journey.",
    }, context)
    const prepared = JSON.parse(await prepareMilestoneTool(hooks, identity, context))
    assert.deepEqual(prepared.submissionOrder, ["01-system-scenarios", "02-big-picture-event-storm"])
    assert.equal(prepared.stages.length, 2)
    assert.equal(prepared.milestone.roman, "I")

    const batch = JSON.parse(await submitMilestoneTool(hooks, {
      ...identity,
      submissions: [{
        stage: "01-system-scenarios", summary: "定义参与者目标和可验收的系统级业务场景。",
        submission: {
        inputReferences: ["user-input:original-request"],
        items: [
          { id: "GOAL-001", kind: "business-goal", statement: "让用户完成一次可观察的业务旅程。", maturity: "proposed", documentSection: "业务主题与分析范围", attributes: {} },
          { id: "SCENARIO-001", kind: "system-scenario", statement: "用户提交业务请求后看到成功结果。", maturity: "proposed", documentSection: "输入场景与现状事实", attributes: {} },
        ],
        relations: [],
        sections: { "业务主题与分析范围": "本阶段定义参与者目标与系统范围。", "输入场景与现状事实": "主场景包含用户意图和可观察结果。" },
        soleOutput: { statement: "批准后的系统场景是战略事件风暴的唯一业务输入。", itemRefs: ["SCENARIO-001"] },
        },
      }, {
        stage: "02-big-picture-event-storm", summary: "形成端到端业务事件主线、热点和职责线索。",
        submission: {
        inputReferences: ["upstream:01-system-scenarios:SCENARIO-001", "user-input:original-request"],
        items: [
          {
            id: "CMD-001", kind: "business-command", statement: "用户提交业务请求。", maturity: "candidate", documentSection: "战略事件风暴",
            attributes: { decisionPlane: "business", scopeDisposition: "requested", flowRole: "main", authorityRefs: ["user-input:original-request"], intent: "state-change", businessSideEffect: "创建业务结果" },
          },
          {
            id: "EVT-001", kind: "domain-event", statement: "业务请求已受理。", maturity: "candidate", documentSection: "战略事件风暴",
            attributes: { decisionPlane: "business", scopeDisposition: "requested", flowRole: "main", authorityRefs: ["user-input:original-request"], businessEffect: "state-transition", businessSubjectRef: "CMD-001", changedState: "请求从未受理变为已受理", businessSideEffect: "产生可观察业务结果" },
          },
          {
            id: "HOT-001", kind: "hotspot", statement: "受理规则需要在战略设计中明确职责归属。", maturity: "candidate", documentSection: "热点与边界线索",
            attributes: { decisionPlane: "business", scopeDisposition: "candidate", flowRole: "supporting", authorityRefs: ["user-input:original-request"] },
          },
          {
            id: "RESP-001", kind: "responsibility-clue", statement: "受理业务请求是一项独立业务职责线索。", maturity: "candidate", documentSection: "热点与边界线索",
            attributes: { decisionPlane: "business", scopeDisposition: "candidate", flowRole: "supporting", authorityRefs: ["user-input:original-request"] },
          },
        ],
        relations: [
          { id: "REL-001", type: "emits", from: "CMD-001", to: "EVT-001", rationale: "提交请求后发生已受理事件。" },
          { id: "REL-002", type: "supports", from: "EVT-001", to: "RESP-001", rationale: "事件流揭示受理职责。" },
        ],
        sections: completeHumanSections(prepared.stages.at(-1).contract, {
          "战略事件风暴": "用户提交请求，随后业务请求已受理，形成端到端事件主线。",
          "热点与边界线索": "受理规则形成业务热点，并提示独立职责边界。",
        }),
        soleOutput: { statement: "端到端事件流揭示受理职责线索，供战略设计继续划分边界。", itemRefs: ["RESP-001"] },
        overview: {
          currentConclusion: "已形成从用户命令到业务事件的战略事件主线。",
          latestBusinessIncrement: "识别了受理热点和职责边界线索。",
          acceptanceChecklist: ["确认事件采用业务过去式", "确认职责线索符合业务认知"],
          openQuestions: ["当前没有阻塞性未决问题。"],
          recommendation: "建议批准，因为事件流、热点和职责线索均可追溯到用户场景。",
        },
        },
      }],
    }, context))
    assert.equal(batch.accepted, true, JSON.stringify(batch, null, 2))
    assert.deepEqual(batch.completedStages, ["01-system-scenarios", "02-big-picture-event-storm"])
    assert.equal(batch.checkpoints.length, 2)
    assert.equal(batch.transition.milestoneRoman, "I")
    assert.equal(batch.transition.milestoneReady, true)
    assert.equal(batch.transition.humanReviewRequired, true)
    assert.equal(batch.transition.stopAllowed, true)
    assert.equal(batch.transition.requiredAction, "await-human-review")

    const reviewed = JSON.parse(await hooks.tool.ddd_workflow_review.execute({
      ...identity, stage: "02-big-picture-event-storm", decision: "approve", reviewer: "test-reviewer",
    }, context))
    assert.equal(reviewed.transition.stopAllowed, false)
    const strategy = JSON.parse(await prepareMilestoneTool(hooks, identity, context))
    assert.deepEqual(strategy.submissionOrder, ["03-subdomains", "04-bounded-contexts", "05-context-map", "06-service-use-cases"])
    assert.equal(strategy.milestone.roman, "II")
  } finally {
    await rm(project, { recursive: true, force: true })
  }
})
