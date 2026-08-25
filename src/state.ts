import path from "node:path"
import { exists, readJson, writeJson } from "./fs.js"
import type { WorkflowState } from "./types.js"
import { WorkflowError } from "./types.js"

export const internalRoot = (root: string) => path.join(root, ".ddd")
export const statePath = (root: string) => path.join(internalRoot(root), "workflow-state.json")
export const activeChange = (projectRoot: string, id: string) => path.join(projectRoot, "openspec", "changes", id)

export async function loadState(root: string): Promise<WorkflowState> {
  const canonical = statePath(root)
  if (!await exists(canonical)) throw new WorkflowError(`Missing workflow state: ${canonical}`)
  return readJson<WorkflowState>(canonical)
}

export async function saveState(root: string, state: WorkflowState): Promise<void> {
  state.updatedAt = new Date().toISOString().replace(/\.\d{3}Z$/, "+00:00")
  await writeJson(statePath(root), state)
}

export async function workflowRoot(projectRoot: string, profileArtifactBase: string, profileArtifactSubdir: string | undefined, id: string): Promise<string> {
  const active = path.join(projectRoot, profileArtifactBase, id)
  return profileArtifactSubdir ? path.join(active, profileArtifactSubdir) : active
}
