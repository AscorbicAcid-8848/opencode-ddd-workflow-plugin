const targets = [
  ["opencode", "file:///C:/Users/80512/.config/opencode/plugins/ddd-workflow.js"],
  ["mobile", "file:///C:/Users/80512/.config/mobile-coder/plugins/ddd-workflow.js"],
]

for (const [host, target] of targets) {
  const module = await import(`${target}?smoke=${Date.now()}`)
  const hooks = await module.default({})
  const doctor = await module.dddWorkflowAdmin.environmentReport(process.cwd())
  const config = { permission: { edit: "allow" } }
  await hooks.config(config)
  let milestoneProtected = false
  try {
    await hooks["tool.execute.before"](
      { tool: "write", sessionID: "installed-smoke", callID: "milestone-protection" },
      { args: { filePath: "openspec/changes/smoke/ddd/I-strategic-eventstorm.md" } },
    )
  } catch (error) {
    milestoneProtected = /DDD_MILESTONE_DOCUMENT_PROTECTED/.test(String(error))
  }
  await hooks["tool.execute.before"](
    { tool: "write", sessionID: "installed-smoke", callID: "normal-code" },
    { args: { filePath: "src/Smoke.ts" } },
  )
  process.stdout.write(`${host}: tools=${Object.keys(hooks.tool).length}, typescript=${/engine=TypeScript/.test(doctor)}, pythonRequired=${!/pythonRequired=false/.test(doctor)}, milestoneProtected=${milestoneProtected}\n`)
}
