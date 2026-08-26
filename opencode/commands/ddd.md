---
description: 执行 DDD 建模工作流直到人工里程碑
agent: ddd-workflow
---

加载 `ddd-orchestrate`，把 $ARGUMENTS 作为本轮请求。只调用专业 Skill 与 `ddd_lifecycle`，严格按 transition 推进；不读取目录、不扫描仓库、不调用 shell。一个阶段只做 prepare、可选的 evidence-bundle/openspec-plan、complete-stage。到人工里程碑输出 message 并停止。
