import { execFileSync } from "node:child_process"

export type Language = "zh" | "en"
let systemLocale: string | undefined
function systemLanguage() {
  if (systemLocale) return systemLocale
  try {
    systemLocale = process.platform === "win32"
      ? execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "(Get-UICulture).Name"], { encoding: "utf8", windowsHide: true, timeout: 3000 }).trim()
      : Intl.DateTimeFormat().resolvedOptions().locale
  } catch { systemLocale = Intl.DateTimeFormat().resolvedOptions().locale }
  return systemLocale
}
export function resolveLanguage(host: unknown, env: NodeJS.ProcessEnv = process.env, fallback?: string): Language {
  // Current OpenCode SDK has no dedicated locale API. Feature-detect optional
  // host config fields without adding unsupported keys to its configuration.
  const config = host as { locale?: unknown; language?: unknown } | undefined
  for (const value of [config?.locale, config?.language, env.LC_ALL, env.LC_MESSAGES, env.LANGUAGE?.split(":")[0], env.LANG]) {
    if (typeof value !== "string" || !value || value === "auto" || /^(C|POSIX)(\.|$)/iu.test(value)) continue
    return /^zh(?:[-_]|$)/iu.test(value) ? "zh" : "en"
  }
  return /^zh(?:[-_]|$)/iu.test(fallback ?? systemLanguage()) ? "zh" : "en"
}
const en: Record<string, string> = {
  "▼ 收起聊天记录": "▼ Hide conversation", "▶ 展开聊天记录": "▶ Show conversation", "刷新聊天记录": "Refresh conversation",
  "按时间汇总关联会话，包含闲聊；不代表每条消息都针对本里程碑。": "Associated conversations in chronological order, including casual chat. Time attribution does not imply semantic relevance.",
  "未完成": "Incomplete", "待开始": "Not started", "执行中": "In progress", "当前处理事项": "Current action",
  "聊天记录": "Conversation", "用户": "User", "助手": "Assistant",
  "没有可准确归属的聊天记录；旧会话仍可通过执行会话查看。": "No reliably attributed messages. Open execution sessions to view legacy conversations.",
  "待执行": "Ready to run", "执行状态": "Execution status", "下一目标": "Next target", "执行下一阶段": "Run next stage",
  "审核已通过，下一阶段尚未准备。点击执行下一阶段选择会话；不需要重复批准。": "Review approved; the next stage is not prepared yet. Select Run next stage and choose a session. No repeated approval is needed.",
  "前置审核已通过，尚无本阶段产物。执行后将在这里显示。": "The preceding review is approved. This stage has no artifacts yet; they will appear after execution.",
  "执行会话": "History", "继续": "Continue", "在哪里继续工作流": "Continue workflow in",
  "当前会话（默认）": "Current session (default)", "上次执行会话": "Last execution session",
  "新建会话": "New session", "选择其他会话": "Choose another session", "选择续跑会话": "Select session to continue",
  "当前目录没有可用会话": "No available sessions in this directory",
  "无法读取项目会话": "Could not load project sessions", "工作流正在提交续跑请求": "A continuation request is being sent",
  "该工作流不可续跑，请刷新查看": "This workflow cannot continue. Refresh to check its state.",
  "无法确认会话是否空闲": "Could not verify session availability",
  "该工作流的执行会话正在运行，请等待完成": "An execution session for this workflow is busy. Please wait.",
  "目标会话不可用或不属于当前目录": "Target session is unavailable or belongs to another directory",
  "目标会话正在运行，请稍后再试": "Target session is busy. Try again later.", "新建会话失败": "Could not create session",
  "关联会话": "Sessions", "选择关联会话": "Choose a linked session", "当前执行会话": "Current execution session",
  "此工作流尚未记录关联会话。旧版未保存的历史无法自动恢复。": "No linked sessions recorded. Unrecorded legacy session history cannot be recovered automatically.",
  "会话未关联此工作流": "Session is not linked to this workflow", "关联会话不可访问或已删除": "Session is unavailable or deleted",
  "关联会话不属于当前项目": "Session belongs to a different project", "工作流已移动，请刷新": "Workflow moved. Please refresh.",
  "同步审核结果到原会话": "Sync review to original session",
  "审核已同步，正在返回原会话。": "Review synced. Returning to the original session.",
  "审核已保存，但未能同步原会话。请使用同步按钮重试，不要重复审核。": "Review saved, but session sync failed. Retry with the sync button; do not review again.",
  "保存拒绝原因并同步到原会话，不继续执行。": "Save and send the rejection to the original session without continuing.",
  "保存审核结果并发送到原会话，继续到下一个人工检查点或阻塞处。": "Save and send the review to the original session. Continue until the next human checkpoint or blocker.",
  "DDD Workflow 控制面板": "DDD Workflow Dashboard", "查看当前项目的流程与六个人工里程碑": "View project workflows and six milestones",
  "当前宿主不支持 DDD TUI 控制面板": "This host does not support the DDD TUI dashboard",
  "加载中": "Loading", "项目 Workflow": "Workflows", "当前结论": "Summary", "全部": "All", "状态": "Status", "类型": "Type",
  "搜索": "Search", "刷新": "Refresh", "返回": "Back", "搜索 Workflow": "Search workflows", "标题、ID 或原始需求": "Title, ID or request",
  "Workflow 状态": "Workflow status", "Workflow 类型": "Workflow type", "没有匹配的 Workflow": "No matching workflows",
  "调整筛选；项目尚无流程时，可返回会话使用 /ddd <需求> 创建。": "Adjust filters, or return to the session and use /ddd <request> to start.",
  "状态损坏": "Invalid state", "读取失败": "Read failed", "未知类型": "Unknown type", "未知": "Unknown",
  "新增功能": "Feature", "系统重构": "Refactor", "新建系统": "New system", "归档": "Archived", "活动": "Active",
  "待审核": "Review", "进行中": "Active", "阻塞": "Blocked", "要求修改": "Revise", "待归档": "Ready to archive", "已完成": "Done",
  "已拒绝": "Rejected", "一致性异常": "Inconsistent", "未开始": "Not started", "已批准": "Approved", "形成中": "Generating",
  "已批": "OK", "待审": "Review", "待改": "Revise", "未始": "—", "拒绝": "Reject", "生成": "…",
  "战略事件风暴": "Strategic EventStorming", "战略设计": "Strategic design", "战术事件风暴": "Tactical EventStorming",
  "战术设计": "Tactical design", "交付计划": "Delivery plan", "最终验收": "Final acceptance",
  "一致性提示": "Integrity notice", "旧版记录 · 只读": "Legacy record · Read-only",
  "已兼容显示旧版文档与人工审核证据；不会通过面板迁移或修改旧版工作流。": "Legacy documents are read-only. The panel does not migrate or modify legacy workflows.",
  "尚未开始": "Not started", "正在生成": "Generating",
  "工作流尚未进入这个里程碑。完成前置阶段后，这里会显示结果。": "This milestone has not started. Results will appear after the preceding stages.",
  "AI 正在整理本里程碑，正式文档尚未生成完成。完成后会自动更新，请稍候。": "AI is preparing this milestone. The document will appear here automatically when ready.",
  "请阅读下方里程碑内容": "Read the milestone below", "本次请您确认": "Decisions to confirm", "里程碑完整内容": "Milestone document",
  "文档暂不可用，请查看上方一致性提示。": "Document unavailable. See the integrity notice above.", "验收清单": "Review checklist", "交付任务": "Delivery tasks",
  "历史": "History", "尚无阶段提交记录": "No submissions yet", "批准 [a]": "Approve [a]", "要求修改 [e]": "Revise [e]", "拒绝 [x]": "Reject [x]",
  "历史归档 · 只读": "Archived · Read-only", "本里程碑当前不可审核": "Not ready for review", "收起审核记录": "Hide history", "展开审核记录": "History",
  "确认": "Confirm", "批准": "Approve", "未选择": "Not selected", "批准前确认": "Decision before approval",
  "（推荐）": " (Recommended)", "（已选）": " (Selected)", "（尚未标注推荐方案）": " (No recommendation recorded)",
  "该操作只记录审核决定；后续建模、编码或归档需回到原会话继续。": "This records your review only. Return to the session to continue modeling, coding or archiving.",
  "审核已记录。返回原会话继续工作流。": "Review saved. Return to the session to continue.", "批准当前正式里程碑方案": "Approve the current published milestone",
  "请填写具体反馈": "Enter your feedback", "修改或拒绝必须填写原因": "Feedback is required to revise or reject", "查看投影版本": "View revision",
}
export function translate(language: Language, text: string): string { return language === "en" ? en[text] ?? text : text }
