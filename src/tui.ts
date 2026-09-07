import { BoxRenderable, TextRenderable, ScrollBoxRenderable } from "@opentui/core"
import { createComponent, onCleanup } from "solid-js"
import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import { discoverWorkflows, filterWorkflows, loadMilestone, historicalMilestone, milestoneStatus, romans, typeLabels, type WorkflowItem, type MilestoneView } from "./dashboard/model.js"
import { visualCards, decisionText, clean } from "./dashboard/views.js"
import { canReview, reviewFromPanel } from "./dashboard/actions.js"
import type { ReviewDecision } from "./types.js"

const ROUTE = "ddd-workflow"
interface Preferences { key: string; milestone: number; tab: string; query: string; status: string; type: string }
const defaults: Preferences = { key: "", milestone: 0, tab: "可视化", query: "", status: "全部", type: "全部" }

/** The native route is independently exportable for real OpenTUI render tests. */
export function createDashboard(api: TuiPluginApi, project: string, leave: () => void) {
  const prefKey = `ddd-dashboard:${project}`
  const pref = { ...defaults, ...api.kv.get<Partial<Preferences>>(prefKey, {}) }
  if (!Number.isInteger(pref.milestone) || pref.milestone < 0 || pref.milestone > 5) pref.milestone = 0
  let items: WorkflowItem[] = [], selected: WorkflowItem | undefined, view: MilestoneView | undefined
  let disposed = false, loading = false, queued = false, generation = 0, signature = "", busy = false
  const theme = api.theme.current
  const root = new BoxRenderable(api.renderer, { width: "100%", height: "100%", flexDirection: "column", backgroundColor: theme.background, focusable: true })
  const header = new TextRenderable(api.renderer, { content: "DDD Workflow · 加载中", fg: theme.primary, height: 2, flexShrink: 0 })
  root.add(header)
  const filters = new BoxRenderable(api.renderer, { flexDirection: "row", height: 3, flexShrink: 0, gap: 1 })
  root.add(filters)
  const content = new BoxRenderable(api.renderer, { flexDirection: "row", flexGrow: 1, minHeight: 0 })
  root.add(content)
  const list = new ScrollBoxRenderable(api.renderer, { width: "28%", minWidth: 22, border: true, title: "项目 Workflow", scrollY: true })
  content.add(list)
  const main = new BoxRenderable(api.renderer, { flexDirection: "column", flexGrow: 1, minWidth: 0 })
  content.add(main)
  const timeline = new BoxRenderable(api.renderer, { height: 4, flexShrink: 0, flexDirection: "row" })
  main.add(timeline)
  const tabs = new BoxRenderable(api.renderer, { height: 3, flexShrink: 0, flexDirection: "row", gap: 1 })
  main.add(tabs)
  const body = new ScrollBoxRenderable(api.renderer, { flexGrow: 1, minHeight: 0, border: true, title: "当前结论", scrollY: true, scrollX: true })
  main.add(body)
  const controls = new BoxRenderable(api.renderer, { height: 3, flexShrink: 0, flexDirection: "row", gap: 1 })
  main.add(controls)
  root.add(new TextRenderable(api.renderer, { height: 2, flexShrink: 0, fg: theme.textMuted,
    content: "↑↓ Workflow  ←→ 里程碑  Tab 视图  / 搜索  f 状态  t 类型  r 刷新\nPgUp/PgDn 正文  a 批准  e 修改  x 拒绝  Esc 返回 · 浏览不调用模型" }))

  const save = () => api.kv.set(prefKey, { ...pref })
  const clear = (box: BoxRenderable) => { for (const child of [...box.getChildren()]) { box.remove(child); child.destroyRecursively() } }
  const notify = (message: string, variant: "error" | "success" | "info" = "info") => api.ui.toast({ message, variant })
  const color = (status: string) => /异常|阻塞|拒绝/.test(status) ? theme.error : /批准|完成/.test(status) ? theme.success : /审核|修改/.test(status) ? theme.warning : theme.info
  function button(parent: BoxRenderable, label: string, action: () => void, fg = theme.text) {
    const b = new BoxRenderable(api.renderer, { border: true, borderColor: fg, paddingX: 1, flexShrink: 0,
      onMouseDown: () => { if (!busy) action() } })
    b.add(new TextRenderable(api.renderer, { content: label, fg }))
    parent.add(b)
  }
  function card(title: string, text: string, fg = theme.text) {
    const b = new BoxRenderable(api.renderer, { width: "100%", flexShrink: 0, border: true, borderColor: fg, title: clean(title), padding: 1 })
    b.add(new TextRenderable(api.renderer, { content: clean(text) || "暂无内容", fg: theme.text, wrapMode: "word", width: "100%" }))
    body.add(b)
  }
  function choose(title: string, options: Array<{ title: string; value: string }>, onSelect: (value: string) => void) {
    api.ui.dialog.replace(() => createComponent(api.ui.DialogSelect<string>, { title, options, onSelect: option => {
      api.ui.dialog.clear(); onSelect(option.value); root.focus()
    } }))
  }
  function search() {
    api.ui.dialog.replace(() => createComponent(api.ui.DialogPrompt, { title: "搜索 Workflow", value: pref.query,
      placeholder: "标题、ID 或原始需求", onConfirm: value => { api.ui.dialog.clear(); pref.query = value; save(); redraw(); root.focus() } }))
  }
  function filterStatus() { choose("Workflow 状态", ["全部", "待审核", "进行中", "阻塞", "要求修改", "待归档", "已完成", "已拒绝", "一致性异常"].map(value => ({ title: value, value })), value => { pref.status = value; save(); redraw() }) }
  function filterType() { choose("Workflow 类型", ["全部", ...Object.values(typeLabels)].map(value => ({ title: value, value })), value => { pref.type = value; save(); redraw() }) }

  async function select(item?: WorkflowItem) {
    selected = item; view = undefined
    const seq = ++generation
    clear(body); clear(controls)
    if (!item) { card("没有匹配的 Workflow", "调整筛选；项目尚无流程时，可返回会话使用 /ddd <需求> 创建。"); return }
    pref.key = item.key; save()
    if (!item.profile) { card("状态损坏", item.issues.join("\n"), theme.error); return }
    try {
      const next = await loadMilestone(item, pref.milestone)
      if (disposed || seq !== generation) return
      view = next; renderDetail()
    } catch (error) { if (!disposed && seq === generation) card("读取失败", String(error), theme.error) }
  }
  function redraw() {
    if (disposed) return
    header.content = `DDD Workflow · ${project}\n${items.length} 个流程 · 待审核 ${items.filter(i => i.status === "待审核").length} · 阻塞 ${items.filter(i => i.status === "阻塞" || i.status === "一致性异常").length} · 已完成 ${items.filter(i => i.status === "已完成").length}`
    clear(filters)
    button(filters, `状态: ${pref.status}`, filterStatus)
    button(filters, `类型: ${pref.type}`, filterType)
    button(filters, pref.query ? `搜索: ${pref.query}` : "搜索", search)
    button(filters, "刷新", () => { void refresh(true) })
    button(filters, "返回", leave)
    const visible = filterWorkflows(items, pref.query, pref.status, pref.type)
    clear(list)
    const current = visible.find(i => i.key === pref.key) ?? visible[0]
    for (const item of visible) {
      const row = new BoxRenderable(api.renderer, { width: "100%", flexShrink: 0, border: true, paddingX: 1,
        borderColor: item.key === current?.key ? theme.primary : theme.border,
        onMouseDown: () => { if (!busy) { pref.key = item.key; redraw() } } })
      row.add(new TextRenderable(api.renderer, { content: clean(`${item.title}\n${typeLabels[item.state?.workflowType ?? ""] ?? "未知类型"} · ${item.status} ${item.approved}/6\n${item.archived ? "归档" : "活动"} · ${item.id}\n${item.updatedAt}`), fg: color(item.status), width: "100%", wrapMode: "word" }))
      list.add(row)
    }
    void select(current)
  }
  function renderDetail() {
    if (!selected || !view || disposed) return
    clear(timeline); clear(tabs); clear(body); clear(controls)
    const shortStatus = (value: string) => ({ "已批准": "已批", "待审核": "待审", "要求修改": "待改", "未开始": "未始", "已拒绝": "拒绝", "形成中": "生成" })[value] ?? value
    for (let i = 0; i < 6; i++) button(timeline, `${romans[i]}\n${shortStatus(milestoneStatus(selected, romans[i]))}`, () => {
      pref.milestone = i; save(); void select(selected)
    }, i === pref.milestone ? theme.primary : color(milestoneStatus(selected, romans[i])))
    for (const name of ["可视化", "结论", "决策", "正文", "历史"]) button(tabs, name, () => { pref.tab = name; save(); renderDetail() }, name === pref.tab ? theme.primary : theme.textMuted)
    body.title = `${view.roman} ${view.title} · ${view.status}`
    card("Workflow", `${selected.state?.originalRequest ?? selected.title}\n${selected.status} · 当前阶段 ${selected.state?.currentStage}\n下一步：${selected.transition?.requiredAction ?? "未知"}\n${selected.state?.runtimeBlock?.reason ?? ""}\n${selected.key}`, color(selected.status))
    for (const issue of [...selected.issues, ...view.issues]) card("一致性提示", issue, theme.error)
    if (selected.legacy) card("旧版记录 · 只读", "已兼容显示旧版文档与人工审核证据；不会通过面板迁移或修改旧版工作流。", theme.textMuted)
    if (pref.tab === "可视化") {
      card("阅读图例", "实线箭头表示原文明确关系；虚线表示原文候选关系。批准表示人类接受设计，并不等于已经实现或测试通过。", theme.textMuted)
      for (const c of visualCards(selected, view, pref.milestone)) {
        for (const edge of c.edges ?? []) {
          const row = new BoxRenderable(api.renderer, { flexDirection: "row", flexShrink: 0, width: "100%", paddingX: 1, gap: 1 })
          const fg = edge.candidate ? theme.textMuted : theme.primary
          for (const [i, label] of [edge.from, `${edge.candidate ? "┄▷" : "──▶"} ${edge.label}`, edge.to].entries()) {
            const node = new BoxRenderable(api.renderer, { border: i !== 1, borderColor: fg, width: i === 1 ? "24%" : "35%", padding: 1, flexShrink: 0 })
            node.add(new TextRenderable(api.renderer, { content: clean(label), fg, width: "100%", wrapMode: "word" }))
            row.add(node)
          }
          body.add(row)
        }
        card(c.title, c.body, c.kind === "warning" ? theme.warning : c.kind === "event" ? theme.warning : c.kind === "domain" ? theme.primary : c.kind === "model" ? theme.secondary : theme.info)
      }
    } else if (pref.tab === "决策") {
      card("待确认项与建议", decisionText(view), theme.warning)
      card("验收清单", (view.checkpoint?.reviewChecklist ?? []).map(s => `□ ${s}`).join("\n"))
    } else if (pref.tab === "正文") card("正式里程碑文档", `${view.file}\n\n${view.body || "本里程碑尚未形成正式文档。"}`)
    else if (pref.tab === "历史") {
      for (const ref of view.revisions ?? []) button(body, `查看投影版本 ${ref.revision} · ${ref.status}`, () => {
        const item = selected!, current = view!, seq = ++generation
        void historicalMilestone(item, current, ref).then(historical => {
          if (disposed || seq !== generation) return
          view = historical
          pref.tab = "可视化"; renderDetail()
        }).catch(error => notify(String(error), "error"))
      })
      for (const c of view.history) card(`${c.stage} · ${c.status}`, `${c.completedAt}\n${c.summary}\n${c.review ? `${c.review.reviewer} ${c.review.reviewedAt}\n${c.review.decision}：${c.review.feedback}` : ""}`)
      if (!view.history.length) card("历史", "尚无阶段提交记录")
    } else {
      card("当前结论", view.sections["一页结论"] ?? view.checkpoint?.summary ?? "尚未开始")
      card("本次请您确认", decisionText(view))
      card("证据与追踪", view.sections["证据与追踪"] ?? "未记录证据")
      if (view.tasks) card("OpenSpec Tasks", view.tasks)
    }
    if (canReview(selected, view)) {
      button(controls, "批准 [a]", () => startReview("approve"), theme.success)
      button(controls, "要求修改 [e]", () => startReview("revise"), theme.warning)
      button(controls, "拒绝 [x]", () => startReview("reject"), theme.error)
    } else button(controls, selected.archived ? "历史归档 · 只读" : "本里程碑当前不可审核", () => {}, theme.textMuted)
    button(controls, "正文", () => { pref.tab = "正文"; save(); renderDetail() })
  }

  function startReview(decision: ReviewDecision) {
    if (busy || !selected || !view || !canReview(selected, view)) return
    const item = selected, milestone = view
    const selections: Record<string, string> = {}
    const open = decision === "approve" ? (milestone.checkpoint?.decisionItems ?? []).filter(d => d.status === "open") : []
    const confirm = (feedback: string) => api.ui.dialog.replace(() => createComponent(api.ui.DialogConfirm, {
      title: `确认${decision === "approve" ? "批准" : decision === "revise" ? "要求修改" : "拒绝"} ${milestone.roman} ${milestone.title}`,
      message: clean(`${item.title}\n${milestone.checkpoint?.summary}\n${Object.entries(selections).map(([k,v]) => `${k} = ${v}`).join("\n")}\n${feedback}\n该操作只记录审核决定；后续建模、编码或归档需回到原会话继续。`),
      onCancel: () => { api.ui.dialog.clear(); root.focus() },
      onConfirm: () => {
        api.ui.dialog.clear(); busy = true
        void reviewFromPanel(item, milestone, decision, feedback, selections).then(() => notify("审核已记录。返回原会话继续工作流。", "success"))
          .catch(error => notify(String(error), "error")).finally(() => { busy = false; void refresh(true); if (!disposed) root.focus() })
      },
    }))
    function chooseNext(i: number) {
      if (i < open.length) {
        const d = open[i]
        choose(d.question, d.options.map(o => ({ title: `${o.label}${o.id === d.recommendationId ? "（推荐）" : ""} ${o.impact ?? ""}`, value: o.id })), id => { selections[d.id] = id; chooseNext(i + 1) })
      } else if (decision === "approve") confirm("批准当前正式里程碑方案")
      else api.ui.dialog.replace(() => createComponent(api.ui.DialogPrompt, { title: "请填写具体反馈", onConfirm: feedback => {
        if (!feedback.trim()) { notify("修改或拒绝必须填写原因", "error"); return }
        confirm(feedback)
      } }))
    }
    chooseNext(0)
  }
  async function refresh(force = false) {
    if (disposed) return
    if (loading) { queued ||= force; return }
    loading = true
    try {
      const next = await discoverWorkflows(project)
      const sig = JSON.stringify(next.map(i => [i.key, i.state, i.issues]))
      items = next
      if (force || sig !== signature) { signature = sig; redraw() }
    } catch (error) { if (!disposed) notify(String(error), "error") }
    finally { loading = false; if (queued) { queued = false; void refresh(true) } }
  }
  root.onKeyDown = event => {
    if (api.ui.dialog.open || busy) return
    const visible = filterWorkflows(items, pref.query, pref.status, pref.type)
    let handled = true
    if (event.name === "escape") leave()
    else if (event.name === "up" || event.name === "down") {
      const i = visible.findIndex(w => w.key === pref.key)
      const next = visible[Math.max(0, Math.min(visible.length - 1, i + (event.name === "down" ? 1 : -1)))]
      if (next) { pref.key = next.key; redraw() }
    } else if (event.name === "left" || event.name === "right") { pref.milestone = Math.max(0, Math.min(5, pref.milestone + (event.name === "right" ? 1 : -1))); save(); void select(selected) }
    else if (event.name === "tab") { const names = ["可视化", "结论", "决策", "正文", "历史"]; pref.tab = names[(names.indexOf(pref.tab) + 1) % names.length]; save(); renderDetail() }
    else if (event.name === "pagedown" || event.name === "pageup") body.scrollBy(event.name === "pagedown" ? 15 : -15)
    else if (event.name === "r") void refresh(true)
    else if (event.name === "/" || event.name === "slash") search()
    else if (event.name === "f") filterStatus()
    else if (event.name === "t") filterType()
    else if (event.name === "a") startReview("approve")
    else if (event.name === "e") startReview("revise")
    else if (event.name === "x") startReview("reject")
    else handled = false
    if (handled) { event.preventDefault(); event.stopPropagation() }
  }
  const unsubscribe = api.event.on("file.watcher.updated", () => { void refresh(true) })
  const timer = setInterval(() => { void refresh() }, 2000)
  const dispose = () => { if (disposed) return; disposed = true; generation++; clearInterval(timer); unsubscribe() }
  root.once("destroyed", dispose)
  root.focus()
  void refresh(true)
  return { root, dispose, refresh, getSelection: () => ({ item: selected, view }) }
}

export const tui: TuiPlugin = async (api) => {
  if (!api.route?.register || !api.keymap?.registerLayer || !api.ui?.dialog) {
    api.ui?.toast?.({ message: "当前宿主不支持 DDD TUI 控制面板", variant: "warning" }); return
  }
  let previous = api.route.current
  let panel: ReturnType<typeof createDashboard> | undefined
  const unregisterRoute = api.route.register([{ name: ROUTE, render: () => {
    panel?.dispose()
    const instance = createDashboard(api, api.state.path.directory, () => api.route.navigate(previous.name, "params" in previous ? previous.params : undefined))
    panel = instance
    onCleanup(instance.dispose)
    return instance.root as any
  } }])
  const unregisterCommand = api.keymap.registerLayer({ commands: [{ name: "ddd.workflow.panel", title: "DDD Workflow 控制面板", description: "查看当前项目的流程与六个人工里程碑", category: "DDD",
    slash: { name: ROUTE }, run: () => { if (api.route.current.name !== ROUTE) previous = api.route.current; api.route.navigate(ROUTE) } }] })
  api.lifecycle.onDispose(() => { panel?.dispose(); unregisterCommand(); unregisterRoute() })
}

export default { id: "ddd-workflow-dashboard", tui }
