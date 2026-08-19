# 已有系统的跨 Change 战略基线合同

`add-feature` 与 `refactor-system` 必须先恢复当前 OpenSpec 行为事实和历史 DDD 战略决策，再运行本次战略发现与设计。`create-system` 不使用该合同。

固定工件：

```text
<change>/ddd/.ddd/strategic-baseline.json
```

其 schema 为 `ddd-strategic-baseline/v1`，详细字段由同目录的 `strategic-baseline.schema.json` 定义。

该 JSON 是 TypeScript 工作流运行时拥有的机器工件。AI 在 `ddd_workflow_prepare(mode=stage)` 返回的 `strategicBaseline` 清单上逐项判断相关性，并通过 `ddd_workflow_submit(mode=stage)` 唯一 entry 的 `submission.strategicBaseline` 提交判断；运行时负责补齐来源元数据与哈希、校验完整性并原子写入固定工件。AI 不得直接创建或修改该文件。

## 两阶段状态

### 1. `inventory`

用于新增功能的“当前系统证据”或重构的“现状基线”阶段。必须：

1. 扫描 `openspec/change-history.md` 并记录当前哈希；
2. 完整列出 `openspec/specs/**/spec.md`，逐项标注 `relevant` 或 `not-relevant` 及理由；
3. 完整列出除当前 change 外、带 `ddd-workflow.json` 的活动和归档 change；
4. 对存在 `ddd/II-strategic-design.md` 的历史 change 记录路径与哈希；
5. 从所有相关正式 spec 或历史战略设计中提取稳定的 `BASE-*` 决策；
6. 将 `strategicDisposition.status` 保持为 `pending`，不得提前决定复用、变更或新增战略边界。

没有历史 DDD change 或正式 spec 时仍要生成工件，以空库存明确记录“已检查但不存在”，不能省略。

### 2. `decision-delta`

用于新增功能或重构的战略设计人工里程碑。必须：

1. 重新校验历史索引、正式 spec 和历史战略设计的当前哈希；
2. 将 `strategicDisposition.status` 改为 `proposed`；
3. 每个 `BASE-*` 决策必须且只能进入 `reused` 或 `changed`；
4. 本次新增战略决策使用稳定 `NEW-*` ID；
5. `unresolvedConflicts` 和 `strategicDisposition.conflicts` 必须为空；
6. 在 `II-strategic-design.md` 中形成与该 JSON 一致的“战略基线继承矩阵”，交给人类验收。

事件风暴阶段只能消费已恢复的事实与约束，不能在本合同的 `inventory` 阶段提前填写目标子域、限界上下文、部署或聚合决策。

## 最小示例

```json
{
  "schema": "ddd-strategic-baseline/v1",
  "workflowId": "order-refund",
  "workflowType": "add-feature",
  "historyScan": {
    "historyIndex": "openspec/change-history.md",
    "historyIndexSha256": "<sha256>",
    "currentSpecs": [
      {
        "path": "openspec/specs/order/spec.md",
        "sha256": "<sha256>",
        "relevance": "relevant",
        "reason": "退款修改订单生命周期"
      }
    ],
    "changes": [
      {
        "changeId": "mall-v1",
        "location": "archive",
        "path": "openspec/changes/archive/2026-07-30-mall-v1",
        "workflowType": "create-system",
        "status": "archived",
        "strategicDesignPath": "openspec/changes/archive/2026-07-30-mall-v1/ddd/II-strategic-design.md",
        "strategicDesignSha256": "<sha256>",
        "relevance": "relevant",
        "reason": "订单与支付上下文由该设计建立"
      }
    ]
  },
  "recoveredDecisions": [
    {
      "id": "BASE-001",
      "sourcePath": "openspec/changes/archive/2026-07-30-mall-v1/ddd/II-strategic-design.md",
      "sourceSha256": "<sha256>",
      "decision": "订单上下文拥有订单生命周期",
      "reason": "退款必须保持该所有权"
    }
  ],
  "unresolvedConflicts": [],
  "strategicDisposition": {
    "status": "proposed",
    "reused": [
      {
        "baselineDecisionId": "BASE-001",
        "rationale": "退款申请仍属于订单生命周期"
      }
    ],
    "changed": [],
    "new": [
      {
        "id": "NEW-001",
        "proposedDecision": "支付上下文执行退款并发布退款完成事件",
        "reason": "支付渠道与退款幂等由支付上下文拥有",
        "impact": "新增订单与支付之间的退款协作契约"
      }
    ],
    "conflicts": []
  }
}
```
