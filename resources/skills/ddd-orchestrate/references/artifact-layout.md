# DDD 工作流产物目录约定

把一次 DDD 工作流作为同名 OpenSpec change 的完整业务设计与交付历史。新工作流只创建一个 change 根目录，不再创建平行的 `docs/ddd/<workflow-id>/`。

```text
一个 DDD workflow-id = 一个 OpenSpec change-id = 一个 change 目录
```

## 统一目录

```text
<project-root>/openspec/
├── config.yaml
├── change-history.md                    # 所有活动与归档 change 的统一入口
├── specs/                               # 已归档 delta 合并后的当前行为事实源
└── changes/
    ├── <workflow-id>/                   # 一次活动 DDD/OpenSpec change
    │   ├── .openspec.yaml
    │   ├── README.md                    # change 入口
    │   ├── ddd-workflow.json            # workflow 身份与状态
    │   ├── proposal.md                  # 里程碑 V 才生成
    │   ├── design.md                    # 里程碑 V 才生成
    │   ├── tasks.md                     # 里程碑 V 才生成
    │   ├── specs/
    │   │   └── <capability>/spec.md     # 里程碑 V 才生成的 delta spec
    │   └── ddd/                         # 同 change 内的人类 DDD 验收包
    │       ├── README.md
    │       ├── I-strategic-eventstorm.md
    │       ├── II-strategic-design.md
    │       ├── III-tactical-eventstorm.md
    │       ├── IV-tactical-design.md
    │       ├── V-delivery-plan.md
    │       ├── VI-final-acceptance.md
    │       └── .ddd/
    │           ├── workflow-state.json
    │           ├── increment-log.md
    │           ├── openspec-link.json
    │           ├── strategic-baseline.json       # add/refactor 的历史战略继承合同
    │           ├── workbench/                    # AI 阶段候选，不是人类入口
    │           │   └── <stage-id>/
    │           │       ├── <对应里程碑候选稿>.md
│           │       ├── stage-output.json     # v3 阶段所有权、语义关系、成熟度与类型化结果
    │           │       └── scope-review.json     # v2 独立审查证据，不含自报 verdict
    │           ├── delivery/
    │           │   ├── manifest.json
    │           │   ├── product-brief.md
    │           │   ├── architecture.md
    │           │   ├── roadmap.json
    │           │   ├── model-contract.json       # 三条工作流共同的模型/目录/依赖机器合同
    │           │   └── specs/
    │           │       └── <feature-id>-<slug>.json
    │           ├── implementation-evidence/
    │           │   └── <slice-id>.json
    │           └── checkpoints/
    │               └── checkpoint-<NNN>/
    │                   ├── <对应里程碑文档快照>.md
    │                   ├── stage-output.json
    │                   ├── scope-review.json     # 连同程序计算的 computedGate
    │                   ├── file-delta.md
    │                   └── implementation-evidence.json
    └── archive/
        └── YYYY-MM-DD-<workflow-id>/    # archive 移动整个 change
            ├── <完整 OpenSpec 工件>
            └── ddd/<完整 DDD 工件与证据>
```

OpenSpec 仍使用兼容的 `spec-driven` schema：标准 proposal、delta specs、design、tasks 继续由 OpenSpec CLI 校验和合并；`ddd/` 是 change 自己拥有的扩展工件包，随整个 change 一起归档。不要把里程碑 I–IV 伪装成 proposal 或 spec。

## 编号规则

- 人工验收里程碑只用罗马数字 `I`～`VI`，一个里程碑只链接一份独立文档。
- AI 内部小步骤仍使用阿拉伯数字阶段 ID，如 `02-big-picture-event-storm`，但只写入隐藏的 `ddd-stage` 标记、增量日志和 checkpoint，不显示为人类文档标题。
- 人类文档目录只使用 `milestone-document-contracts.json` 固定的业务标题，不把内部阶段编号或阶段 ID 暴露为目录项。

## 人类文档目录合同

六份里程碑文档统一使用 `milestone-document-contracts.json` 的 `fixed-business-sections/v1` 合同。初始化时一次性生成全部固定 `##` 与 `###` 标题；后续步骤只能填写或修订章节正文，不得删除、改名、重排固定标题，也不得新增“步骤 07”一类 AI 导航标题。

```text
一页结论
→ 本次请您确认
→ 当前里程碑专属业务章节
→ 备选方案与建议
→ 证据与追踪
→ 业务验收记录
```

不适用的固定章节保留标题，并填写 `不适用：<业务原因>`。AI 增量通过隐藏的 `ddd-stage`、`ddd-scope`、`.ddd/increment-log.md` 和 checkpoint 快照留痕。

## 放置规则

1. 六个人工卡点与 `ddd/` 内六份里程碑文档一一对应。
2. 每个人工卡点必须挂在最后一个写入对应里程碑文档的 AI 步骤上；同一里程碑不得在批准后由后续自动步骤继续修改。战术设计与模型一致性审查必须全部完成后，才能提交里程碑 IV 人工验收。
3. 每个小步骤先写入 `.ddd/workbench/<stage-id>/` 的候选稿；类型工件和独立 Scope 审查通过后，由 checkpoint 原子发布到所属里程碑文档，并用 `ddd-stage` 标记形成渐进增量。AI 不得直接改正式里程碑。
4. `openspec/change-history.md` 是项目级唯一历史入口；活动 change 链接到 `changes/<id>/ddd/README.md`，归档后链接到 archive 内同一入口。
5. `ddd/.ddd/` 只保存状态、快照、文件变化和实现证据，不作为人类验收入口。
6. 里程碑 I–IV 只更新 `ddd/`；proposal、delta specs、design、tasks 在里程碑 V 才生成。
7. Coding 同时更新生产代码、测试、`tasks.md`、`ddd/VI-final-acceptance.md` 与 `ddd/.ddd/implementation-evidence/`。
8. 最终批准必须使用 OpenSpec archive；不得手工移动 change。archive 成功后，整个 `ddd/` 包与标准 OpenSpec 工件一起进入历史。
9. 本 change 的产品简报、架构约束、机器路线图和特性验收规格只写入 `ddd/.ddd/delivery/`，不得在项目根 `docs/` 建立平行副本。
10. 项目根 `docs/` 仅用于真正跨越多个 change 的产品或系统级长期说明；单次 change 不得把它当作 canonical 交付状态。
11. 项目根 `.ddd/` 是可删除的本地工具临时区；正式状态、交付资产与证据只能位于 change 的 `ddd/.ddd/`。
12. `add-feature` 与 `refactor-system` 必须在现状阶段建立 `strategic-baseline.json`，并在战略设计阶段更新继承处置；`create-system` 不生成该文件。
13. 三条工作流都必须在里程碑 V 生成 `model-contract.json`；其中 `add-feature`、`create-system` 使用严格模式，`refactor-system` 使用迁移模式并只允许登记有基线证据和移除切片的遗留架构例外。

## 可达性

活动工作流的人类入口为：

```text
openspec/change-history.md
→ openspec/changes/<workflow-id>/ddd/README.md
→ 当前罗马数字里程碑文档
```

归档后入口自动改为：

```text
openspec/change-history.md
→ openspec/changes/archive/YYYY-MM-DD-<workflow-id>/ddd/README.md
```

对话中的人工验收应直接链接当前里程碑文档，用户不需要先理解 OpenSpec 内部状态或 checkpoint。

## 兼容与迁移

- 旧 `docs/ddd/<workflow-id>/` 与更早的 `docs/ddd/changes/`、`features/`、`refactors/`、`system-designs/` 都是 legacy 布局。
- 不在旧目录继续推进活动工作流；使用插件提供的 TypeScript 布局迁移工具将其复制到同名活动 change 的 `ddd/`。
- 迁移必须保留来源、checkpoint、审批、哈希和 migration manifest；旧目录保持只读，确认新 change 完整后再由人类决定是否清理。
- 已归档 change-id 不得迁移、复用或重新创建。
