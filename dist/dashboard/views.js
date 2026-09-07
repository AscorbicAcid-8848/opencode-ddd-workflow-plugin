export const viewGroups = [
    ["战略事件风暴", "异常、补偿与时间约束", "热点与边界线索"],
    ["子域划分", "限界上下文", "上下文映射", "工程承载关系", "实现单元用例包"],
    ["战术事件风暴", "失败矩阵", "业务规则与不变量候选", "模型与边界候选"],
    ["领域模型设计", "应用服务设计", "领域交互设计", "模块与分层设计", "设计与实现一致性清单"],
    ["纵向交付切片", "交付追踪矩阵", "测试与验证计划", "Git 交付计划"],
    ["最终业务验收矩阵", "设计与代码一致性", "测试与运行证据", "Git 与回滚证据", "OpenSpec 完成状态"],
];
export const clean = (text) => text.replace(/<!--[\s\S]*?-->/gu, "").replace(/\x1b\[[0-9;]*[A-Za-z]/gu, "").replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/gu, "").trim();
export function explicitEdges(source) {
    const labels = new Map();
    for (const match of source.matchAll(/([\w-]+)\s*\[\s*["']?([^\]\n]+?)["']?\s*\]/gu))
        labels.set(match[1], match[2].replace(/<br\s*\/?\s*>/giu, " "));
    const node = "([\\w-]+)(?:\\s*\\[[^\\]\\n]*\\])?";
    const pattern = new RegExp(`(?=${node}\\s*(-->|-\\.->|==>)\\s*(?:\\|([^|]*)\\|\\s*)?${node})`, "gu");
    return [...source.matchAll(pattern)].filter(m => !m.index || !/[\w-]/u.test(source[m.index - 1])).map(m => ({
        from: labels.get(m[1]) ?? m[1], to: labels.get(m[4]) ?? m[4], label: m[3] ?? "", candidate: m[2] === "-.->",
    }));
}
/** Interpret only explicit Mermaid edges. Unsupported notation remains visible as source, never inferred. */
export function diagramText(source) {
    const lines = explicitEdges(source).map(e => `${e.from} ${e.candidate ? "┄候选┄▷" : "──▶"} ${e.label ? `[${e.label}] ` : ""}${e.to}`);
    return lines.length ? `${lines.join("\n")}\n\n原始图（保留全部分组、节点和连线）：\n${source}` : `原始图（当前图语法以文本展示）：\n${source}`;
}
export function visualCards(item, view, index) {
    if (view.projection)
        return view.projection.cards;
    if (view.revisions?.length)
        return [{ title: "投影一致性异常", body: "请核对正式文档与当前投影；不会从冲突内容重新推测图。", kind: "warning" }];
    if (!view.checkpoint)
        return [{ title: "尚未开始", body: "本里程碑尚无已提交产物。请按工作流顺序完成前置阶段。", kind: "info" }];
    const cards = [];
    for (const heading of viewGroups[index]) {
        const text = clean(view.sections[heading] ?? "");
        if (!text)
            continue;
        let body = text.replace(/```mermaid\s*\n([\s\S]*?)```/gu, (_all, source) => diagramText(source));
        const edges = [...text.matchAll(/```mermaid\s*\n([\s\S]*?)```/gu)].flatMap(m => explicitEdges(m[1]));
        const kind = index === 0 || index === 2 ? "event" : index === 1 ? "domain" : index === 3 ? "model" : "evidence";
        cards.push({ title: `${heading} · ${view.status}`, body, kind, edges });
        // Markdown tables are already structured: retain the author's column names and row values.
        const tableLines = text.split("\n").filter(line => /^\s*\|.+\|\s*$/u.test(line));
        if (tableLines.length > 2 && index !== 0 && index !== 2) {
            const columns = tableLines[0].split("|").slice(1, -1).map(s => s.trim());
            for (const line of tableLines.slice(2)) {
                const cells = line.split("|").slice(1, -1).map(s => s.trim());
                if (cells.every(s => /^[:\s-]+$/u.test(s)))
                    continue;
                cards.push({ title: `${heading} / ${cells[0]}`, body: columns.map((c, i) => `${c}：${cells[i] ?? ""}`).join("\n"), kind });
            }
        }
    }
    if (index >= 3 && Array.isArray(view.model?.modelElements)) {
        for (const m of view.model.modelElements)
            cards.push({ title: `${m.id} ${m.name ?? ""} · 模型合同记录`,
                body: [m.type, m.responsibility, ...(m.productionPaths ?? []), ...(m.testPaths ?? [])].filter(Boolean).join("\n"), kind: "model" });
        for (const inv of view.model.invariants ?? [])
            cards.push({ title: inv.id, body: inv.statement ?? "", kind: "model" });
    }
    if (index >= 4 && Array.isArray(view.plan?.slices)) {
        for (const s of view.plan.slices) {
            const done = item.state?.deliveryPlan?.completedSliceIds?.includes(s.id);
            cards.push({ title: `${done ? "✓ 已实施" : "○ 计划"} ${s.id} ${s.title}`, kind: "evidence", body: `${(s.dependsOn ?? []).join(" + ") || "起点"} ──▶ ${s.id}\n业务结果：${s.outcome}\n消费者：${s.consumer}\n验收：${(s.acceptanceCriteria ?? []).join("；")}\n测试：${(s.testPaths ?? []).join("；")}\n回滚：${(s.rollback?.steps ?? []).join("；")}`,
                edges: (s.dependsOn ?? []).map((dep) => ({ from: dep, to: s.id, label: "依赖", candidate: false })) });
        }
    }
    if (!cards.length)
        cards.push({ title: "历史产物", body: "该里程碑缺少可识别的结构化章节，请切换到「正文」阅读原始结论。未推测业务关系。", kind: "warning" });
    return cards;
}
export function decisionText(view) {
    const items = view.checkpoint?.decisionItems ?? [];
    return items.length ? items.map(d => `${d.id} [${d.status}] ${d.question}\n${d.options.map(o => `  ${o.id} ${o.label}${o.id === d.recommendationId ? "（推荐）" : ""}${o.id === d.selectedOptionId ? "（已选）" : ""}${o.impact ? `：${o.impact}` : ""}`).join("\n")}\n影响：${d.blocks.map(b => b.statement).join("；")}`).join("\n\n") : clean(view.sections["本次请您确认"] ?? "没有记录结构化待决事项；请阅读当前正文与验收清单。");
}
//# sourceMappingURL=views.js.map