# 阶段语义准入合同

本合同适用于三条 DDD 工作流的每个 AI 步骤。它位于人类里程碑之前，负责阻止阶段越权、证据不足和未经批准的结论进入正式罗马数字文档。它不增加人工卡点，也不替代人类对业务方案的选择。

## 固定执行顺序

```text
冻结候选 Markdown
→ 冻结 stage-output.json
→ 新开独立 Scope Review 轮次
→ 逐条引用并填写 assessments/findings
→ checkpoint 由程序计算 scope-gate
→ 仅 pass 才原子发布正式里程碑
→ humanGate=true 时再请求人工业务验收
```

阶段作者不得兼任审查结论的裁决者。`scope-review.json` 不包含 `verdict`、布尔检查项或“无违规”的自我声明；它只保存可复查的引用、责任判断、处置和理由。程序校验覆盖率、哈希、所有权及确定性护栏后生成 `computedGate`。

## `stage-output.json`

使用 `ddd-stage-output/v3`。每个 `items[]` 必须声明：

- `ownerStage`：当前阿拉伯数字步骤；
- `ownerContract`：当前内禀契约；
- `decisionLevel`：当前 Scope ID；
- `maturity`：该 Scope 允许的事实、假设、候选、拟议、实现或证据状态；
- `documentSection`：结论写入的固定业务章节；
- `tracesTo`、`evidenceRefs` 和 `attributes`。

`relations[]` 是阶段结论之间的唯一机器关系源，至少区分 `emits`、`returns`、`triggers`、`blocks`、`governs`、`depends-on`、`supports` 和 `rejects`。`soleOutput.itemRefs` 必须引用当前 active item，不能用一段脱离 item 的自由文本偷偷提升候选结论。每个 item statement 必须逐字出现在其 `documentSection`，Markdown 可以组织解释，但不得另造一套未进入结构化工件的核心结论。

Big Picture 与 Design-Level EventStorming 还必须声明业务语义：命令的 `intent`、领域事件的业务主体与状态效果、读模型的查询目的、未决问题状态、外部参与方的系统边界证据和时间触发器的时间语义。未决问题通过 `blocks` 指向受影响 item；被阻塞内容不得进入主流程、目标能力或唯一输出。查询通过 `returns` 指向读模型；无业务副作用的查询不得通过 `emits` 产生领域事件。

不得把后续阶段内容伪装成当前阶段允许的 `kind`。有价值的后续想法放入 `deferredItems[]`，并声明实际 `targetStage`、`targetContract`、目标 `decisionLevel`、目标章节及 `maturity: deferred`。只能延期到后续步骤；上游输入错误必须形成 `return-upstream` 阻塞发现。

当前候选决策不得标为 `approved`。人工批准只由工作流状态和验收记录产生，AI 不得通过措辞或 JSON 字段自行批准。

`capability-status` 还必须在 `attributes` 中提供稳定 `capabilityId`、`status: existing|target|future`、`scopeDisposition`、`authorityRefs` 和 `sourceFactRefs`。`existing` 必须引用 availability 为 `operational` 且 observationLevel 至少为 `statically-reachable` 的原子现状事实；桩、空端点、类型声明和 TODO 不足以证明能力存在。`target` 必须来自 `user-input:` 或先前 `approval:`；同一 ID 不得状态冲突；`future` 只能进入演进建议或证据追踪，未经里程碑 I 扩大范围不得进入唯一输出。

## `scope-review.json`

使用 `ddd-scope-review/v3`，通过 `candidateDocumentSha256` 和 `stageOutputSha256` 同时绑定候选文档与 `stage-output.json`。审查轮次只读取已批准输入、当前内禀契约、冻结的阶段工件和候选稿。

必须提供：

- `itemAssessments`：每个 active item 恰好一条；
- `relationAssessments`：每条 semantic relation 恰好一条；
- `soleOutputAssessment`：唯一输出恰好一条；
- `sectionAssessments`：候选稿相对正式文档的每个变更章节恰好一条；
- `findings`：额外的语义越权、证据缺口、范围漂移或上游冲突。

每条 assessment 或 finding 都必须逐字引用原文，并声明：

- `actualOwnerStage`、`actualOwnerContract`、`actualDecisionLevel`；
- `action: retain|defer|remove|return-upstream`；
- `severity: none|advisory|blocking`；
- 可复查的 `rationale`。

不得为了通过而把实际属于后续步骤的内容标为当前步骤。若发现越权，保留真实责任步骤和处置，返回阶段作者修订后重新冻结、重新审查。

## 程序准入规则

`checkpoint` 仅在以下条件全部满足时计算 `pass`：

1. v2 字段完整且候选稿、阶段工件哈希未变化；
2. active item、唯一输出和每个变更章节均被恰好审查一次；
3. 所有保留内容的实际责任步骤、契约和层级均属于当前步骤，且关系图满足阶段语义；
4. 没有 `blocking`、`defer`、`remove` 或 `return-upstream` 结果；
5. 当前步骤只修改其 `ownedSections`，人工门禁步骤才可刷新一页结论；
6. 成熟度、证据义务、延期目标和能力状态合法；
7. 没有未决结论进入有效流程、查询结果冒充事件、内部能力冒充外部系统、现状结论超过证据等级或实现机制进入错误阶段；
8. 没有命中高置信度文本阶段语义护栏。

任一条件失败时，正式里程碑文档、状态和 checkpoint 数量保持不变。旧版 v1 workbench 不自动继承“通过”结论；重新执行 `begin-stage`，按 v2 重新生成和审查。历史 checkpoint 快照保持只读并可继续查询。

## 人工里程碑的职责

程序 `pass` 只表示“这份候选稿专业地完成了当前阶段，没有越级替其他阶段做决定”。人类验收继续决定业务范围、事件解释、战略边界、战术模型、交付计划和最终业务结果是否可接受。人工批准不能覆盖程序发现的结构、证据或阶段越权错误。
