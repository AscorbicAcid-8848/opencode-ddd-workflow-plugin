---
description: 查看当前 DDD 工作流状态，不推进阶段
---

加载 `ddd-orchestrate`，调用 `ddd_lifecycle(action="status", input={view:"compact"})`。用中文说明当前里程碑、requiredAction、nextStage/allowedNextStages、stopAllowed。只读，不提交、不审核、不归档。

$ARGUMENTS
