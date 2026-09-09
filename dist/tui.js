import { BoxRenderable, TextRenderable, ScrollBoxRenderable, MouseButton } from "@opentui/core";
import { createComponent, onCleanup, untrack } from "solid-js";
import { discoverWorkflows, filterWorkflows, loadMilestone, historicalMilestone, milestoneStatus, romans, typeLabels } from "./dashboard/model.js";
import { visualCards, decisionText, clean } from "./dashboard/views.js";
import { canReview, reviewFromPanel } from "./dashboard/actions.js";
import { resolveLanguage, translate } from "./dashboard/i18n.js";
import { sendPanelReview } from "./dashboard/session-handoff.js";
import { listLinkedSessions, getLinkedSession } from "./dashboard/session-links.js";
import { projectSessions, resumeInSession } from "./dashboard/resume.js";
import { progressState, milestoneChat } from "./dashboard/chat.js";
const ROUTE = "ddd-workflow";
const defaults = { key: "", milestone: 0, query: "", status: "全部", type: "全部" };
/** The native route is independently exportable for real OpenTUI render tests. */
export function createDashboard(api, project, leave, originSessionID) {
    let language = resolveLanguage(api.state.config);
    const t = (text) => translate(language, text);
    const prefKey = `ddd-dashboard:${project}`;
    const pref = { ...defaults, ...api.kv.get(prefKey, {}) };
    if (!Number.isInteger(pref.milestone) || pref.milestone < 0 || pref.milestone > 5)
        pref.milestone = 0;
    let items = [], selected, view;
    let disposed = false, loading = false, queued = false, generation = 0, signature = "", busy = false;
    let showHistory = false;
    let chatOpen = false, chatText = "", chatGeneration = 0, chatKey = "", chatLoading = false;
    let chatResult;
    const theme = api.theme.current;
    const root = new BoxRenderable(api.renderer, { width: "100%", height: "100%", flexDirection: "column", backgroundColor: theme.background, focusable: true });
    const header = new TextRenderable(api.renderer, { content: `DDD Workflow · ${t("加载中")}`, fg: theme.primary, height: 1, flexShrink: 0 });
    root.add(header);
    const filters = new BoxRenderable(api.renderer, { flexDirection: "row", height: 3, flexShrink: 0, gap: 1 });
    root.add(filters);
    const content = new BoxRenderable(api.renderer, { flexDirection: "row", flexGrow: 1, minHeight: 0 });
    root.add(content);
    const list = new ScrollBoxRenderable(api.renderer, { width: "28%", minWidth: 22, border: true, title: t("项目 Workflow"), scrollY: true });
    content.add(list);
    const main = new BoxRenderable(api.renderer, { flexDirection: "column", flexGrow: 1, minWidth: 0 });
    content.add(main);
    const timeline = new BoxRenderable(api.renderer, { height: 4, flexShrink: 0, flexDirection: "row" });
    main.add(timeline);
    const body = new ScrollBoxRenderable(api.renderer, { flexGrow: 1, minHeight: 0, border: true, title: "当前结论", scrollY: true, scrollX: true });
    main.add(body);
    const controls = new BoxRenderable(api.renderer, { height: 3, flexShrink: 0, flexDirection: "row", gap: 1 });
    main.add(controls);
    const footer = new TextRenderable(api.renderer, { height: 2, flexShrink: 0, fg: theme.textMuted });
    root.add(footer);
    const save = () => api.kv.set(prefKey, { ...pref });
    const clear = (box) => { for (const child of [...box.getChildren()]) {
        box.remove(child);
        child.destroyRecursively();
    } };
    const notify = (message, variant = "info") => api.ui.toast({ message: t(message), variant });
    const color = (status) => /异常|阻塞|拒绝/.test(status) ? theme.error : /批准|完成/.test(status) ? theme.success : /审核|修改/.test(status) ? theme.warning : theme.info;
    function button(parent, label, action, fg = theme.text) {
        let pressed = false;
        const b = new BoxRenderable(api.renderer, { id: `ddd-button-${label}`, border: true, borderColor: fg, paddingX: 1, flexShrink: 0,
            onMouseDown: event => {
                if (event.button !== MouseButton.LEFT || busy || api.ui.dialog.open)
                    return;
                pressed = true;
                event.stopPropagation();
            },
            onMouseUp: event => {
                if (event.button !== MouseButton.LEFT)
                    return;
                const activate = pressed && event.x >= b.x && event.x < b.x + b.width && event.y >= b.y && event.y < b.y + b.height;
                pressed = false;
                event.stopPropagation();
                // Open only after this click has finished dispatching. Otherwise the
                // release lands on the newly mounted modal's outside-click backdrop.
                if (activate)
                    queueMicrotask(() => { if (!disposed && !busy && !api.ui.dialog.open)
                        action(); });
            } });
        b.add(new TextRenderable(api.renderer, { content: t(label), fg }));
        parent.add(b);
    }
    function card(title, text, fg = theme.text) {
        const b = new BoxRenderable(api.renderer, { width: "100%", flexShrink: 0, border: false, title: clean(t(title)), padding: 0 });
        b.add(new TextRenderable(api.renderer, { content: clean(t(title)), fg, wrapMode: "word", width: "100%" }));
        b.add(new TextRenderable(api.renderer, { content: clean(text) || "暂无内容", fg: theme.text, wrapMode: "word", width: "100%" }));
        body.add(b);
    }
    function choose(title, options, onSelect) {
        api.ui.dialog.replace(() => createComponent((api.ui.DialogSelect), { title: t(title), options, onSelect: option => {
                api.ui.dialog.clear();
                onSelect(option.value);
                if (!api.ui.dialog.open)
                    root.focus();
            } }));
    }
    function search() {
        api.ui.dialog.replace(() => createComponent(api.ui.DialogPrompt, { title: t("搜索 Workflow"), value: pref.query,
            placeholder: t("标题、ID 或原始需求"), onConfirm: value => { api.ui.dialog.clear(); pref.query = value; save(); redraw(); root.focus(); } }));
    }
    function filterStatus() { choose("Workflow 状态", ["全部", "待审核", "待执行", "进行中", "阻塞", "要求修改", "待归档", "已完成", "已拒绝", "一致性异常"].map(value => ({ title: t(value), value })), value => { pref.status = value; save(); redraw(); }); }
    function filterType() { choose("Workflow 类型", ["全部", ...Object.values(typeLabels)].map(value => ({ title: t(value), value })), value => { pref.type = value; save(); redraw(); }); }
    async function openSessions() {
        if (busy || !selected)
            return;
        const selectedKey = selected.key;
        busy = true;
        try {
            const item = (await discoverWorkflows(project)).find(i => i.key === selectedKey);
            if (!item)
                throw new Error(t("工作流已移动，请刷新"));
            const sessions = await listLinkedSessions(item, api.client);
            if (disposed)
                return;
            if (!sessions.length) {
                notify("此工作流尚未记录关联会话。旧版未保存的历史无法自动恢复。", "info");
                return;
            }
            choose("选择关联会话", sessions.map(s => ({ value: s.id, title: `${s.title}${s.current ? ` · ${t("当前执行会话")}` : ""}${s.archived ? ` · ${t("归档")}` : ""}`,
                description: s.error ? t(s.error) : `${s.id}${s.updatedAt ? ` · ${new Date(s.updatedAt).toLocaleString(language === "zh" ? "zh-CN" : "en-US")}` : ""}`,
                disabled: !!s.error })), sessionID => {
                // Recheck immediately before navigation; selecting a session never rebinds it.
                void getLinkedSession(item, sessionID, api.client).then(() => {
                    if (!disposed)
                        api.route.navigate("session", { sessionID });
                }).catch(error => notify(error.message, "error"));
            });
        }
        catch (error) {
            notify(error.message, "error");
        }
        finally {
            busy = false;
        }
    }
    function continueWorkflow() {
        if (busy || !selected)
            return;
        const item = selected;
        if (item.archived || item.legacy || item.issues.length || ["complete", "rejected"].includes(item.state?.status ?? "")) {
            notify("该工作流不可续跑，请刷新查看", "error");
            return;
        }
        const launch = (target) => {
            if (busy || disposed)
                return;
            busy = true;
            void resumeInSession(item, target, api.client).then(sessionID => {
                if (!disposed)
                    api.route.navigate("session", { sessionID });
            }).catch(error => { if (!disposed)
                notify(error.message, "error"); })
                .finally(() => { busy = false; if (!disposed)
                void refresh(true); });
        };
        choose("在哪里继续工作流", [
            { title: t("当前会话（默认）"), value: "current", disabled: !originSessionID },
            { title: t("上次执行会话"), value: "last", disabled: !item.state?.runtimeSessionId },
            { title: t("新建会话"), value: "new" },
            { title: t("选择其他会话"), value: "other" },
        ], value => {
            if (value === "current" && originSessionID)
                launch(originSessionID);
            else if (value === "last" && item.state?.runtimeSessionId)
                launch(item.state.runtimeSessionId);
            else if (value === "new")
                launch(null);
            else if (value === "other") {
                busy = true;
                void projectSessions(project, api.client).then(sessions => {
                    if (disposed)
                        return;
                    if (!sessions.length) {
                        notify("当前目录没有可用会话");
                        return;
                    }
                    choose("选择续跑会话", sessions.map(s => ({ title: s.title || s.id, value: s.id, description: s.id })), launch);
                }).catch(error => notify(error.message, "error")).finally(() => { busy = false; });
            }
        });
    }
    async function select(item) {
        const nextChatKey = `${item?.key ?? ""}:${romans[pref.milestone]}`;
        if (chatKey !== nextChatKey) {
            chatOpen = false;
            chatGeneration++;
            chatResult = undefined;
            chatLoading = false;
            chatText = "";
            chatKey = nextChatKey;
        }
        selected = item;
        view = undefined;
        const seq = ++generation;
        clear(body);
        clear(controls);
        if (!item) {
            card("没有匹配的 Workflow", t("调整筛选；项目尚无流程时，可返回会话使用 /ddd <需求> 创建。"));
            return;
        }
        pref.key = item.key;
        save();
        if (!item.profile) {
            card("状态损坏", item.issues.join("\n"), theme.error);
            return;
        }
        try {
            const next = await loadMilestone(item, pref.milestone);
            if (disposed || seq !== generation)
                return;
            view = next;
            renderDetail();
        }
        catch (error) {
            if (!disposed && seq === generation)
                card("读取失败", String(error), theme.error);
        }
    }
    function redraw() {
        if (disposed)
            return;
        list.title = t("项目 Workflow");
        header.content = `DDD Workflow · ${items.length} · ${t("待审核")} ${items.filter(i => i.status === "待审核").length} · ${t("已完成")} ${items.filter(i => i.status === "已完成").length}`;
        footer.content = language === "zh" ? "↑↓ 工作流  ←→ 阶段  s 执行会话  c 继续  r 刷新\nPgUp/PgDn 阅读  / 搜索  a 批准  e 修改  x 拒绝  Esc 返回" : "↑↓ Workflow  ←→ Stage  s History  c Continue  r Refresh\nPgUp/PgDn Read  / Search  a Approve  e Revise  x Reject  Esc Back";
        clear(filters);
        button(filters, `${t("状态")}: ${t(pref.status)}`, filterStatus);
        button(filters, `${t("类型")}: ${t(pref.type)}`, filterType);
        const queryLabel = Array.from(pref.query).slice(0, 10).join("") + (Array.from(pref.query).length > 10 ? "…" : "");
        button(filters, pref.query ? `${t("搜索")}: ${queryLabel}` : "搜索", search);
        button(filters, "刷新", () => { void refresh(true); });
        button(filters, "返回", leave);
        button(filters, "执行会话", () => { void openSessions(); });
        button(filters, "继续", continueWorkflow);
        const visible = filterWorkflows(items, pref.query, pref.status, pref.type);
        clear(list);
        const current = visible.find(i => i.key === pref.key) ?? visible[0];
        for (const item of visible) {
            const row = new BoxRenderable(api.renderer, { width: "100%", flexShrink: 0, border: true, paddingX: 1,
                borderColor: item.key === current?.key ? theme.primary : theme.border,
                onMouseDown: () => { if (!busy) {
                    pref.key = item.key;
                    redraw();
                } } });
            row.add(new TextRenderable(api.renderer, { content: clean(`${item.title}\n${t(typeLabels[item.state?.workflowType ?? ""] ?? "未知类型")} · ${t(item.state?.status === "complete" ? "已完成" : "未完成")} ${item.approved}/6\n${item.id}`), fg: color(item.status), width: "100%", wrapMode: "word" }));
            list.add(row);
        }
        void select(current);
    }
    async function loadChat() {
        if (!selected || !view || chatLoading)
            return;
        const item = selected, roman = view.roman, key = chatKey, sequence = ++chatGeneration;
        chatLoading = true;
        chatText = "";
        renderDetail();
        try {
            const result = await milestoneChat(item, roman, api.client);
            if (!disposed && sequence === chatGeneration && chatKey === key)
                chatResult = result;
        }
        catch (error) {
            if (!disposed && sequence === chatGeneration && chatKey === key)
                chatText = String(error);
        }
        finally {
            if (!disposed && sequence === chatGeneration && chatKey === key) {
                chatLoading = false;
                renderDetail();
            }
        }
    }
    function renderDetail() {
        if (!selected || !view || disposed)
            return;
        clear(timeline);
        clear(body);
        clear(controls);
        for (let i = 0; i < 6; i++)
            button(timeline, `${romans[i]}\n${t(progressState(selected, romans[i]))}`, () => {
                pref.milestone = i;
                save();
                void select(selected);
            }, i === pref.milestone ? theme.primary : color(milestoneStatus(selected, romans[i])));
        body.title = `${view.roman} ${t(view.title)} · ${t(progressState(selected, view.roman))}`;
        card("当前处理事项", `${t(selected.status)}${selected.transition?.nextStage ? ` · ${selected.transition.nextStage}` : ""}`, theme.textMuted);
        button(body, chatOpen ? "▼ 收起聊天记录" : "▶ 展开聊天记录", () => {
            chatOpen = !chatOpen;
            if (chatOpen && !chatResult && !chatLoading)
                void loadChat();
            else
                renderDetail();
            root.focus();
        });
        if (chatOpen) {
            button(body, "刷新聊天记录", () => { if (!chatLoading)
                void loadChat(); });
            if (chatLoading)
                card("聊天记录", t("加载中"));
            else if (chatText)
                card("聊天记录", chatText, theme.error);
            if (chatResult) {
                card("聊天记录", t("按时间汇总关联会话，包含闲聊；不代表每条消息都针对本里程碑。"), theme.textMuted);
                for (const m of chatResult.messages)
                    card(`${t(m.role === "user" ? "用户" : "助手")} · ${new Date(m.time).toLocaleString()} · ${m.sessionID}`, m.text, m.role === "user" ? theme.primary : theme.success);
                if (!chatResult.messages.length)
                    card("聊天记录", t("没有可准确归属的聊天记录；旧会话仍可通过执行会话查看。"));
                for (const warning of chatResult.warnings)
                    card("一致性提示", warning, theme.warning);
            }
        }
        if (selected.status === "待执行") {
            const stage = selected.profile?.stages.find(s => s.id === selected.transition?.nextStage);
            const nextRoman = stage?.document.replace(/^milestone/u, "");
            const last = selected.state?.checkpoints.filter(c => c.status === "approved").at(-1);
            card("执行状态", `${t("待执行")} · ${last?.milestone ?? ""} ${t("已批准")}\n${t("下一目标")}：${nextRoman ?? ""} · ${stage?.id ?? ""}\n${t("审核已通过，下一阶段尚未准备。点击执行下一阶段选择会话；不需要重复批准。")}`, theme.warning);
        }
        for (const issue of [...selected.issues, ...view.issues])
            card("一致性提示", issue, theme.error);
        if (selected.legacy)
            card("旧版记录 · 只读", t("已兼容显示旧版文档与人工审核证据；不会通过面板迁移或修改旧版工作流。"), theme.textMuted);
        if (!view.body && !view.issues.length) {
            if (view.status === "待执行")
                card("待执行", t("前置审核已通过，尚无本阶段产物。执行后将在这里显示。"), theme.warning);
            else
                card(view.status === "未开始" ? "尚未开始" : "正在生成", t(view.status === "未开始"
                    ? "工作流尚未进入这个里程碑。完成前置阶段后，这里会显示结果。"
                    : "AI 正在整理本里程碑，正式文档尚未生成完成。完成后会自动更新，请稍候。"), theme.info);
        }
        else {
            card("当前结论", view.sections["一页结论"] ?? view.checkpoint?.summary ?? t("请阅读下方里程碑内容"));
            if (view.checkpoint?.decisionItems?.length)
                card("本次请您确认", decisionText(view, language), theme.warning);
            for (const c of visualCards(selected, view, pref.milestone)) {
                for (const edge of c.edges ?? []) {
                    const row = new BoxRenderable(api.renderer, { flexDirection: "row", flexShrink: 0, width: "100%", paddingX: 1, gap: 1 });
                    const fg = edge.candidate ? theme.textMuted : theme.primary;
                    for (const [i, label] of [edge.from, `${edge.candidate ? "┄▷" : "──▶"} ${edge.label}`, edge.to].entries()) {
                        const node = new BoxRenderable(api.renderer, { border: i !== 1, borderColor: fg, width: i === 1 ? "24%" : "35%", padding: 1, flexShrink: 0 });
                        node.add(new TextRenderable(api.renderer, { content: clean(label), fg, width: "100%", wrapMode: "word" }));
                        row.add(node);
                    }
                    body.add(row);
                }
                // Only show explicit relations here; the full source follows once below.
            }
            card("里程碑完整内容", view.body || t("文档暂不可用，请查看上方一致性提示。"));
            if (view.checkpoint?.reviewChecklist?.length)
                card("验收清单", view.checkpoint.reviewChecklist.map(s => `□ ${s}`).join("\n"));
            if (view.tasks)
                card("交付任务", view.tasks);
        }
        if (showHistory) {
            for (const ref of view.revisions ?? [])
                button(body, `${t("查看投影版本")} ${ref.revision} · ${ref.status}`, () => {
                    const item = selected, current = view, seq = ++generation;
                    void historicalMilestone(item, current, ref).then(historical => {
                        if (disposed || seq !== generation)
                            return;
                        view = historical;
                        renderDetail();
                    }).catch(error => notify(String(error), "error"));
                });
            for (const c of view.history)
                card(`${c.stage} · ${c.status}`, `${c.completedAt}\n${c.summary}\n${c.review ? `${c.review.reviewer} ${c.review.reviewedAt}\n${c.review.decision}：${c.review.feedback}` : ""}`);
            if (!view.history.length)
                card("历史", t("尚无阶段提交记录"));
        }
        if (canReview(selected, view)) {
            button(controls, "批准 [a]", () => startReview("approve"), theme.success);
            button(controls, "要求修改 [e]", () => startReview("revise"), theme.warning);
            button(controls, "拒绝 [x]", () => startReview("reject"), theme.error);
        }
        else if (selected.status === "待执行")
            button(controls, "执行下一阶段", continueWorkflow, theme.primary);
        else
            button(controls, selected.archived ? "历史归档 · 只读" : "本里程碑当前不可审核", () => { }, theme.textMuted);
        button(controls, showHistory ? "收起审核记录" : "展开审核记录", () => { showHistory = !showHistory; renderDetail(); });
        if (!view.historical && view.checkpoint?.review?.reviewer === "user:tui" && selected.state?.checkpoints.at(-1)?.checkpointId === view.checkpoint.checkpointId) {
            button(body, "同步审核结果到原会话", () => {
                const item = selected, milestone = view;
                busy = true;
                void syncReview(item, milestone).finally(() => { busy = false; void refresh(true); });
            });
        }
    }
    async function syncReview(item, milestone) {
        try {
            const sent = await sendPanelReview(item, milestone, api.client);
            notify("审核已同步，正在返回原会话。", "success");
            if (!disposed)
                api.route.navigate("session", { sessionID: sent.sessionID });
        }
        catch (error) {
            notify(`${t("审核已保存，但未能同步原会话。请使用同步按钮重试，不要重复审核。")}\n${String(error)}`, "error");
        }
    }
    function startReview(decision) {
        if (busy || !selected || !view || !canReview(selected, view))
            return;
        const item = selected, milestone = view;
        const selections = {};
        const open = decision === "approve" ? (milestone.checkpoint?.decisionItems ?? []).filter(d => d.status === "open") : [];
        const confirm = (feedback) => api.ui.dialog.replace(() => createComponent(api.ui.DialogConfirm, {
            title: `${t("确认")} ${t(decision === "approve" ? "批准" : decision === "revise" ? "要求修改" : "拒绝")} ${milestone.roman} ${t(milestone.title)}`,
            message: clean(`${item.title}\n${milestone.checkpoint?.summary}\n${open.map(d => `${d.question}：${d.options.find(o => o.id === selections[d.id])?.label ?? t("未选择")}`).join("\n")}\n${feedback}\n${t(decision === "reject" ? "保存拒绝原因并同步到原会话，不继续执行。" : "保存审核结果并发送到原会话，继续到下一个人工检查点或阻塞处。")}`),
            onCancel: () => { api.ui.dialog.clear(); root.focus(); },
            onConfirm: () => {
                api.ui.dialog.clear();
                busy = true;
                void reviewFromPanel(item, milestone, decision, feedback, selections).then(() => syncReview(item, milestone))
                    .catch(error => notify(String(error), "error")).finally(() => { busy = false; void refresh(true); if (!disposed)
                    root.focus(); });
            },
        }));
        function chooseNext(i) {
            if (i < open.length) {
                const d = open[i];
                choose(`${t("批准前确认")} ${i + 1}/${open.length}：${d.question}${d.recommendationId ? "" : t("（尚未标注推荐方案）")}`, d.options.map(o => ({ title: `${o.label}${o.id === d.recommendationId ? t("（推荐）") : ""}`, description: o.impact, value: o.id })), id => { selections[d.id] = id; chooseNext(i + 1); });
            }
            else if (decision === "approve")
                confirm(t("批准当前正式里程碑方案"));
            else
                api.ui.dialog.replace(() => createComponent(api.ui.DialogPrompt, { title: t("请填写具体反馈"), onConfirm: feedback => {
                        if (!feedback.trim()) {
                            notify("修改或拒绝必须填写原因", "error");
                            return;
                        }
                        confirm(feedback);
                    } }));
        }
        chooseNext(0);
    }
    async function refresh(force = false) {
        if (disposed)
            return;
        if (loading) {
            queued ||= force;
            return;
        }
        loading = true;
        try {
            const nextLanguage = resolveLanguage(api.state.config);
            if (language !== nextLanguage) {
                language = nextLanguage;
                force = true;
            }
            const next = await discoverWorkflows(project);
            const sig = JSON.stringify(next.map(i => [i.key, i.state, i.issues]));
            items = next;
            if (force || sig !== signature) {
                signature = sig;
                redraw();
            }
        }
        catch (error) {
            if (!disposed)
                notify(String(error), "error");
        }
        finally {
            loading = false;
            if (queued) {
                queued = false;
                void refresh(true);
            }
        }
    }
    root.onKeyDown = event => {
        if (api.ui.dialog.open || busy)
            return;
        const visible = filterWorkflows(items, pref.query, pref.status, pref.type);
        let handled = true;
        if (event.name === "escape")
            leave();
        else if (event.name === "up" || event.name === "down") {
            const i = visible.findIndex(w => w.key === pref.key);
            const next = visible[Math.max(0, Math.min(visible.length - 1, i + (event.name === "down" ? 1 : -1)))];
            if (next) {
                pref.key = next.key;
                redraw();
            }
        }
        else if (event.name === "left" || event.name === "right") {
            pref.milestone = Math.max(0, Math.min(5, pref.milestone + (event.name === "right" ? 1 : -1)));
            save();
            void select(selected);
        }
        else if (event.name === "pagedown" || event.name === "pageup")
            body.scrollBy(event.name === "pagedown" ? 15 : -15);
        else if (event.name === "r")
            void refresh(true);
        else if (event.name === "/" || event.name === "slash")
            search();
        else if (event.name === "f")
            filterStatus();
        else if (event.name === "t")
            filterType();
        else if (event.name === "s")
            void openSessions();
        else if (event.name === "c")
            continueWorkflow();
        else if (event.name === "a")
            startReview("approve");
        else if (event.name === "e")
            startReview("revise");
        else if (event.name === "x")
            startReview("reject");
        else
            handled = false;
        if (handled) {
            event.preventDefault();
            event.stopPropagation();
        }
    };
    const unsubscribe = api.event.on("file.watcher.updated", () => { void refresh(true); });
    // Claim panel navigation only while this page has focus; dialogs retain their keys.
    const unregisterKeys = api.keymap.registerLayer({ target: root, targetMode: "focus-within", priority: 100,
        bindings: ["up", "down", "left", "right", "pagedown", "pageup", "r", "/", "f", "t", "s", "c", "a", "e", "x", "escape"].map(key => ({ key,
            cmd: () => {
                if (api.ui.dialog.open || busy)
                    return false;
                root.onKeyDown?.({ name: key, preventDefault() { }, stopPropagation() { } });
            } })) });
    const timer = setInterval(() => { void refresh(); }, 2000);
    const dispose = () => { if (disposed)
        return; disposed = true; generation++; clearInterval(timer); unsubscribe(); unregisterKeys(); };
    root.once("destroyed", dispose);
    root.focus();
    void refresh(true);
    return { root, dispose, refresh, getSelection: () => ({ item: selected, view }) };
}
export const tui = async (api) => {
    const t = (text) => translate(resolveLanguage(api.state.config), text);
    if (!api.route?.register || !api.keymap?.registerLayer || !api.ui?.dialog) {
        api.ui?.toast?.({ message: t("当前宿主不支持 DDD TUI 控制面板"), variant: "warning" });
        return;
    }
    let previous = api.route.current;
    let panel;
    const unregisterRoute = api.route.register([{ name: ROUTE, render: () => {
                panel?.dispose();
                const originSessionID = previous.name === "session" && "params" in previous ? String(previous.params?.sessionID ?? "") || undefined : undefined;
                const instance = untrack(() => createDashboard(api, api.state.path.directory, () => api.route.navigate(previous.name, "params" in previous ? previous.params : undefined), originSessionID));
                panel = instance;
                onCleanup(instance.dispose);
                return instance.root;
            } }]);
    const unregisterCommand = api.keymap.registerLayer({ commands: [{ name: "ddd.workflow.panel", title: t("DDD Workflow 控制面板"), desc: t("查看当前项目的流程与六个人工里程碑"), category: "DDD",
                namespace: "palette", slashName: ROUTE, run: () => { if (api.route.current.name !== ROUTE)
                    previous = api.route.current; api.ui.dialog.clear(); api.route.navigate(ROUTE); } }] });
    api.lifecycle.onDispose(() => { panel?.dispose(); unregisterCommand(); unregisterRoute(); });
};
export default { id: "ddd-workflow-dashboard", tui };
//# sourceMappingURL=tui.js.map