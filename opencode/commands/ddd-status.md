---
description: 查看当前 DDD 工作流状态，不推进阶段
---

加载 `ddd-orchestrate`，调用 `ddd_lifecycle(action="status", input={view:"compact"})`。有活动工作流时，用中文说明当前里程碑、requiredAction、nextStage/allowedNextStages、stopAllowed。若返回 status=empty，这是正常空状态，不是错误：简短说明“当前项目还没有进行中的 DDD 工作流”，引导用户输入 `/ddd <需求>`，例如 `/ddd 使用 DDD 重构这个项目`；也支持新增功能、从零创建项目。不要罗列空字段或让用户填写 action=init、workflow_type、workflow_id，不要自动初始化。只读，不提交、不审核、不归档。其他真实错误应如实报告，不得当成空状态。

$ARGUMENTS
