---
description: 批准交付计划并实现 DDD 纵向切片
---

加载 `ddd-implementation`。根据本轮用户意图先完成授权；可用 `ddd_lifecycle(action=status)` 确认当前阶段。只有用户明确批准时，才提交包含 decision 与 reviewer 的 review，不因调用编码命令自动批准。已批准则 prepare 对应实现阶段，按里程碑 V 和纵向切片实现。允许必要的读取、测试和宿主权限内的项目准备；每个切片提供真实测试、Git commit 和实现证据，停在里程碑 VI 或真实阻塞。
