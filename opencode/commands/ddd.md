---
description: 执行 DDD 建模工作流直到人工里程碑
agent: ddd-workflow
---

`/ddd <工作流目录名>` 续跑当前项目 openspec/changes 下已有工作流；插件自动解析类型、恢复进度并关联当前会话，不需手动绑定。续跑不代表批准，等待人工审核时必须停下。目录不存在时报告错误，不创建同名工作流。普通自然语言需求仍用于启动新工作流。

加载 `ddd-orchestrate`，把 $ARGUMENTS 作为本轮请求。只调用专业 Skill 与 `ddd_lifecycle`，严格按 transition 推进；不读取目录、不扫描仓库、不调用 shell。一个阶段只做 prepare、可选的 evidence-bundle/openspec-plan、complete-stage。里程碑 V 只提交结构化计划，由运行时编译 OpenSpec 工件。批准未决候选时必须提交 resolution.selectedCandidateId。到人工里程碑原样输出 message 并停止。
