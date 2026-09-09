import { milestoneStatus, romans } from "./model.js";
import { getLinkedSession } from "./session-links.js";
export function progressState(item, roman) {
    if (milestoneStatus(item, roman) === "已批准")
        return "已完成";
    const first = romans.find(r => milestoneStatus(item, r) !== "已批准");
    if (roman !== first)
        return "";
    const started = item.state?.checkpoints.some(c => c.milestone === roman && c.status !== "superseded")
        || item.profile?.stages.find(s => s.id === item.state?.preparedStage?.stage)?.document === `milestone${roman}`;
    return started ? "执行中" : "待开始";
}
export async function milestoneChat(item, roman, client) {
    const windows = milestoneWindows(item, roman);
    if (!windows.length)
        return { messages: [], missing: true, warnings: ["没有可用的里程碑时间范围"] };
    const messages = [];
    const warnings = [];
    const sessions = [...new Set([item.state?.runtimeSessionId, ...(item.state?.runtimeSessionIds ?? [])].filter((id) => !!id))];
    for (const sessionID of sessions) {
        try {
            await getLinkedSession(item, sessionID, client);
            const all = [];
            const cursors = new Set();
            let before;
            for (;;) {
                const result = await client.session.messages({ directory: item.project, sessionID, limit: 100, before });
                if (result.error || !result.data)
                    throw new Error("无法读取会话聊天记录");
                const page = result.data;
                all.push(...page);
                if (page.length < 100)
                    break;
                const oldest = [...page].sort((a, b) => a.info.time.created - b.info.time.created)[0]?.info.id;
                if (!oldest || cursors.has(oldest))
                    throw new Error("会话分页未前进");
                cursors.add(oldest);
                before = oldest;
            }
            const insideWindow = (m) => windows.some(w => m.info.time.created >= w.start && m.info.time.created < w.end);
            // Include the actual initiating prompt, even if init/prepare happened later.
            // Do not widen the time window or guess the nearest preceding user message.
            const parentPrompts = new Set(all.filter(m => m.info.role === "assistant" && insideWindow(m))
                .map(m => m.info.parentID).filter(Boolean));
            const seen = new Set();
            for (const m of all) {
                if (seen.has(m.info.id) || !["user", "assistant"].includes(m.info.role)
                    || !(insideWindow(m) || (m.info.role === "user" && parentPrompts.has(m.info.id))))
                    continue;
                seen.add(m.info.id);
                const text = m.parts.filter((p) => p.type === "text" && !p.ignored).map((p) => p.text).join("\n");
                if (text)
                    messages.push({ id: m.info.id, sessionID, role: m.info.role, text, time: m.info.time.created });
            }
        }
        catch (error) {
            warnings.push(`${sessionID}: ${error.message}`);
        }
    }
    return { messages: messages.sort((a, b) => a.time - b.time || a.sessionID.localeCompare(b.sessionID) || a.id.localeCompare(b.id)), missing: !sessions.length, warnings };
}
/** Half-open time windows. Time attribution is not a claim of semantic relevance. */
export function milestoneWindows(item, roman) {
    const state = item.state;
    if (!state)
        return [];
    const events = [];
    const add = (time, r, priority) => {
        const timestamp = Date.parse(time ?? "");
        if (Number.isFinite(timestamp) && r)
            events.push({ time: timestamp, roman: r, priority });
    };
    add(state.createdAt, "I", 0);
    // Preserve superseded checkpoint timestamps: a reopened milestone may have several windows.
    for (const c of state.checkpoints) {
        add(c.completedAt, c.milestone, 1);
        const review = c.review;
        if (review) {
            const index = romans.indexOf(c.milestone);
            add(review.reviewedAt, review.decision === "approve" && index >= 0 && index < 5 ? romans[index + 1] : c.milestone, 2);
        }
    }
    const prepared = state.preparedStage;
    add(prepared?.preparedAt, item.profile?.stages.find(s => s.id === prepared?.stage)?.document.replace(/^milestone/u, ""), 3);
    events.sort((a, b) => a.time - b.time || a.priority - b.priority);
    const end = ["complete", "rejected"].includes(state.status) ? Date.parse(state.updatedAt) + 1 : Infinity;
    if (!Number.isFinite(end) && end !== Infinity)
        return [];
    return events.flatMap((event, index) => {
        const stop = Math.min(events[index + 1]?.time ?? end, end);
        return event.roman === roman && stop > event.time ? [{ start: event.time, end: stop }] : [];
    });
}
//# sourceMappingURL=chat.js.map