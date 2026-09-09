import { realpath } from "node:fs/promises";
export async function getLinkedSession(item, sessionID, client) {
    const known = new Set([...(item.state?.runtimeSessionIds ?? []), item.state?.runtimeSessionId]);
    if (!known.has(sessionID))
        throw new Error("会话未关联此工作流");
    const result = await client.session.get({ sessionID, directory: item.project });
    if (result.error || !result.data)
        throw new Error("关联会话不可访问或已删除");
    const actual = await realpath(result.data.directory), expected = await realpath(item.project);
    if (process.platform === "win32" ? actual.toLowerCase() !== expected.toLowerCase() : actual !== expected)
        throw new Error("关联会话不属于当前项目");
    return result.data;
}
export async function listLinkedSessions(item, client) {
    const ids = [...new Set([item.state?.runtimeSessionId, ...(item.state?.runtimeSessionIds ?? []).slice().reverse()].filter((id) => !!id))];
    return Promise.all(ids.map(async (id) => {
        try {
            const session = await getLinkedSession(item, id, client);
            return { id, title: session.title || id, updatedAt: session.time.updated, current: id === item.state?.runtimeSessionId, archived: !!session.time.archived, error: "" };
        }
        catch (error) {
            return { id, title: id, updatedAt: undefined, current: id === item.state?.runtimeSessionId, archived: false, error: error.message };
        }
    }));
}
//# sourceMappingURL=session-links.js.map