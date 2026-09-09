# 模型空响应导致工作流停滞

最新实测会话 ses_f7bd1ce54ffeONRXm3BCcfa3pU 使用 opencode-go/glm-5.2。证据包已成功返回，01-baseline-evidence 尚未提交，里程碑 I 未形成。北京时间 11:22:06 开始下一次模型请求，11:27:24 记录 finish=unknown，无正文和工具调用；11:27:25 宿主退出循环。无明确上游错误，不能据此断言超时或网络原因，零用量记录不代表实际零消耗。

官方 OpenCode v1.18.18 的 session/prompt.ts（1054–1072 行）在有 finish、不是 tool-calls 且没有工具调用时退出，unknown 同样命中。宿主不读取插件的 stopAllowed。因此工具成功、工作流未完成与宿主会话结束可以同时发生。

源码依据：https://github.com/anomalyco/opencode/blob/v1.18.18/packages/opencode/src/session/prompt.ts

插件补偿：监听会话 idle，经绑定关系、最新回复和当前状态核验，仅在不允许停止且回复为空的情况下记录 execution-interruption.json（位于同一 change 的 ddd/.ddd）。用 TUI 警告说明中断和 /ddd <目录名> 恢复入口，status 同步报告。记录带状态指纹，状态前进后旧记录失效。重复事件不重复通知，不修改工作流状态，不自动请求模型或批准。取消、只读答复、正常审核停点和新用户消息不触发恢复操作。

这是插件侧的中断识别与安全恢复入口，不是对上游模型服务故障的修复，也不保证提供商永不返回空响应。现存会话不回写，不重放真实业务任务。自动测试验证检测、去重、状态保全及失效；真实服务端错误原因仍需提供商请求日志。
