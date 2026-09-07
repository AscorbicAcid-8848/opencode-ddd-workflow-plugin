import path from "node:path";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { profileFor } from "../catalog.js";
import { documentSections } from "../documents.js";
import { writeJson } from "../fs.js";
import { visualCards } from "./views.js";
const hash = (value) => createHash("sha256").update(value).digest("hex");
const statusLabel = (status) => ({ approved: "已批准", awaiting_review: "待审核", revision_requested: "要求修改", rejected: "已拒绝" })[status] ?? status;
/** Compile once in the state-save transaction, after formal publication. Immutable revisions
 * are written first; the atomic state write publishes their pointers last. Orphans are not read. */
export async function prepareDashboardProjections(root, state) {
    const target = state;
    const profile = await profileFor(state.workflowType);
    const refs = [...(target.dashboard?.revisions ?? [])];
    const latest = new Map();
    for (const c of state.checkpoints) {
        if (c.milestone && ["awaiting_review", "approved", "revision_requested", "rejected"].includes(c.status))
            latest.set(c.milestone, c);
    }
    for (const [roman, checkpoint] of latest) {
        const index = ["I", "II", "III", "IV", "V", "VI"].indexOf(roman);
        if (index < 0)
            continue;
        const signature = hash(JSON.stringify({ checkpoint, archived: state.status === "complete",
            completedSlices: index >= 4 ? state.deliveryPlan?.completedSliceIds : undefined }));
        if (refs.filter(r => r.roman === roman).at(-1)?.signature === signature)
            continue;
        const file = profile.documents[`milestone${roman}`];
        let body;
        try {
            body = await readFile(path.join(root, file), "utf8");
        }
        catch (error) {
            if (error.code === "ENOENT")
                continue;
            throw error;
        }
        const sections = documentSections(body);
        const view = { roman, status: statusLabel(checkpoint.status), checkpoint, body, sections };
        for (const [key, artifact, since] of [["model", "model-contract.json", 3], ["plan", ".ddd/delivery/plan.json", 4]]) {
            if (index < since)
                continue;
            try {
                view[key] = JSON.parse(await readFile(path.join(root, artifact), "utf8"));
            }
            catch (error) {
                if (error.code !== "ENOENT")
                    throw error;
            }
        }
        const cards = visualCards({ state }, view, index);
        const evidence = [`${file}#checkpoint-${checkpoint.checkpointId}`];
        const id = (type, label) => hash(`${state.workflowId}|${type}|${label}`).slice(0, 20);
        const nodes = [];
        const edges = [];
        const defaultMaturity = checkpoint.status === "approved" ? "Approved" : checkpoint.status === "awaiting_review" ? "Proposed" : "Blocked";
        for (const card of cards) {
            const maturity = /候选|线索|热点/u.test(card.title) ? "Candidate" : defaultMaturity;
            nodes.push({ id: id(card.kind, card.title.replace(/ · .+$/u, "")), type: card.kind, label: card.title, maturity, evidenceRefs: evidence });
            for (const edge of card.edges ?? []) {
                const from = id("relationship-node", edge.from), to = id("relationship-node", edge.to);
                const m = edge.candidate ? "Candidate" : defaultMaturity;
                nodes.push({ id: from, type: "relationship-node", label: edge.from, maturity: m, evidenceRefs: evidence }, { id: to, type: "relationship-node", label: edge.to, maturity: m, evidenceRefs: evidence });
                edges.push({ source: from, target: to, relation: edge.label || "flow", maturity: m, evidenceRefs: evidence });
            }
        }
        const revision = refs.filter(r => r.roman === roman).length + 1;
        const projection = { version: 1, workflowId: state.workflowId, milestoneRoman: roman, revision,
            status: checkpoint.status, generatedAt: new Date().toISOString(), sourceCheckpointIds: state.checkpoints.filter(c => c.milestone === roman && c.status !== "superseded").map(c => c.checkpointId),
            documentHash: hash(body), documentBody: body, cards, nodes: [...new Map(nodes.map(n => [n.id, n])).values()], edges,
            decisions: checkpoint.decisionItems ?? [], openQuestions: (checkpoint.decisionItems ?? []).filter(d => d.status === "open").map(d => d.question),
            evidenceSummary: sections["证据与追踪"] ?? "未记录结构化证据摘要" };
        const relative = `.ddd/dashboard/${roman}/${revision}-${signature.slice(0, 12)}.json`;
        await writeJson(path.join(root, relative), projection);
        refs.push({ roman, revision, file: relative, checkpointId: checkpoint.checkpointId, status: checkpoint.status, signature });
    }
    if (refs.length)
        target.dashboard = { version: 1, revisions: refs };
}
//# sourceMappingURL=projections.js.map