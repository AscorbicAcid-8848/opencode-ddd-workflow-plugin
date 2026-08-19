import path from "node:path"
import { fileURLToPath } from "node:url"
import { openSpecNodeExecutable, openSpecRuntime, runOpenSpec } from "./workflow/openspec.js"

export const pluginRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

export async function environmentReport(projectRoot: string): Promise<string> {
  const openspec = openSpecRuntime()
  const cliVersion = await runOpenSpec(projectRoot, ["--version"])
  return [
    "engine=TypeScript (in-process)",
    `pluginRoot=${pluginRoot}`,
    `projectRoot=${path.resolve(projectRoot)}`,
    `node=${process.version}`,
    `nodeExecutable=${openSpecNodeExecutable()}`,
    `hostExecutable=${process.execPath}`,
    `openspecPackage=${openspec.version}`,
    `openspecCli=${cliVersion}`,
    "pythonRequired=false",
  ].join("\n")
}
