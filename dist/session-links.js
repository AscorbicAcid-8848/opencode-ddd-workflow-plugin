export function recordRuntimeSession(state, sessionID) {
    const ids = [...new Set([...(state.runtimeSessionIds ?? []), state.runtimeSessionId, sessionID].filter((id) => !!id))];
    const changed = state.runtimeSessionId !== sessionID || JSON.stringify(state.runtimeSessionIds) !== JSON.stringify(ids);
    state.runtimeSessionIds = ids;
    state.runtimeSessionId = sessionID;
    return changed;
}
//# sourceMappingURL=session-links.js.map