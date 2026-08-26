---
description: 批准交付计划并实现 DDD 纵向切片
agent: ddd-coding
---

加载 `ddd-implementation`。$ARGUMENTS 是人工批准意见或实现要求。第一项工具调用必须是 `ddd_lifecycle`：若里程碑 V 待批准则调用 `action=review,input={}`，否则调用 `action=prepare,input={}`；在此之前禁止读取、搜索或执行 Git。运行时会自动绑定当前人工门并解析唯一下一阶段，不调用 status。严格按里程碑 V、model-contract.json 与纵向切片实现；每个切片必须真实测试、独立 Git commit、提交 implementation evidence，直到里程碑 VI 或真实阻塞。
