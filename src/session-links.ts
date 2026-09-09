import type { WorkflowState } from "./types.js"

export function recordRuntimeSession(state: Pick<WorkflowState, "runtimeSessionId" | "runtimeSessionIds">, sessionID: string): boolean {
  const ids = [...new Set([...(state.runtimeSessionIds ?? []), state.runtimeSessionId, sessionID].filter((id): id is string => !!id))]
  const changed = state.runtimeSessionId !== sessionID || JSON.stringify(state.runtimeSessionIds) !== JSON.stringify(ids)
  state.runtimeSessionIds = ids
  state.runtimeSessionId = sessionID
  return changed
}
