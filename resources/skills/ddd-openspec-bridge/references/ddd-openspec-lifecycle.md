# DDD 与 OpenSpec 生命周期映射

## 目录

1. 事实源分工
2. 三个工作流的统一适配协议
3. OpenSpec 标准结构
4. 阶段边界
5. OpenSpec 底层动作
6. 历史与归档
7. 校验合同
8. Legacy 迁移

## 1. 事实源分工

- `openspec/changes/<workflow-id>/ddd/`：人类验收 DDD 发现、边界、模型、计划和交付证据。
- `openspec/changes/<workflow-id>/ddd/.ddd/delivery/`：同一次 change 的产品简报、架构约束、机器路线图和特性验收规格。
- `openspec/changes/<workflow-id>/`：同一次 change 的完整容器；根目录标准工件负责 why、行为 delta、how 和实现任务，`ddd/` 负责领域发现、设计、审批与证据。
- `openspec/specs/`：所有已归档 change 合并后的当前行为事实源。
- `openspec/changes/archive/`：已完成 change 的完整历史。
- `openspec/change-history.md`：活动与归档 change 的浅层导航索引，不替代 archive 内容。

## 2. 三个工作流的统一适配协议

`add-feature`、`refactor-system`、`create-system` 都遵循同一生命周期：

```text
可选 OpenSpec Explore（只处理模糊性，不创建工件）
→ DDD init
→ OpenSpec CLI 创建同名活动 change，DDD 补充 change/ddd
→ 里程碑 I：战略事件风暴（只写 change/ddd）
→ 里程碑 II：战略设计（只写 change/ddd）
→ 里程碑 III：战术事件风暴（只写 change/ddd）
→ 里程碑 IV：战术设计（只写 change/ddd）
→ 里程碑 V：通过 status/instructions 生成并批准 planning artifacts 与 change-owned delivery assets
→ Coding：通过 apply instructions 恢复任务上下文，由 DDD 开发与 Git Skill 实现并勾选 tasks
→ OpenSpec Verify（若官方 Skill 可用）与 DDD 强制证据检查
→ 里程碑 VI：最终证据验收
→ OpenSpec strict validate
→ archive：delta specs 合并到主 specs，包含 ddd/ 的整个 change 进入历史目录
```

OpenSpec 不新增人工里程碑，也不把三个 DDD 工作流汇聚成一个 change。

## 3. OpenSpec 标准结构

```text
openspec/
├── config.yaml
├── change-history.md
├── specs/
│   └── <capability>/
│       └── spec.md
└── changes/
    ├── <workflow-id>/
    │   ├── .openspec.yaml
    │   ├── ddd-workflow.json
    │   ├── ddd/
    │   │   ├── README.md
    │   │   ├── I-strategic-eventstorm.md
    │   │   ├── II-strategic-design.md
    │   │   ├── III-tactical-eventstorm.md
    │   │   ├── IV-tactical-design.md
    │   │   ├── V-delivery-plan.md
    │   │   ├── VI-final-acceptance.md
    │   │   └── .ddd/
    │   │       ├── workflow-state.json
    │   │       ├── checkpoints/
    │   │       ├── implementation-evidence/
    │   │       └── delivery/
    │   │           ├── manifest.json
    │   │           ├── product-brief.md
    │   │           ├── architecture.md
    │   │           ├── roadmap.json
    │   │           └── specs/
    │   │               └── <feature-id>-<slug>.json
    │   ├── proposal.md
    │   ├── design.md
    │   ├── tasks.md
    │   └── specs/
    │       └── <capability>/
    │           └── spec.md
    └── archive/
        └── YYYY-MM-DD-<workflow-id>/
            └── <完整 OpenSpec 工件 + ddd/ 工件>
```

`.openspec.yaml` 至少包含：

```yaml
schema: spec-driven
created: YYYY-MM-DD
```

## 4. 阶段边界

| DDD 阶段 | 可以影响 OpenSpec 的内容 | 禁止 |
|---|---|---|
| 模糊性探索 | 可选调用 OpenSpec Explore，形成路由输入，不持久化正式工件 | 创建 change、替代用户场景或事件风暴 |
| 工作流初始化 | 通过 `openspec new change` 创建标准骨架，再补充 `ddd/` | 手写 `.openspec.yaml`、调用 propose 提前生成 planning artifacts |
| 战略事件风暴 | 更新 `ddd/I-strategic-eventstorm.md`，形成后续 proposal 的业务动机证据 | 创建 Requirement、design 或 tasks |
| 战略设计 | 更新 `ddd/II-strategic-design.md`，确定 proposal 范围与 capability 所有权 | 聚合、类、表、技术任务 |
| 战术事件风暴 | 更新 `ddd/III-tactical-eventstorm.md`，形成 Requirement/Scenario 候选线索 | 把候选直接当最终规范 |
| 战术设计 | 更新 `ddd/IV-tactical-design.md`，批准最终 Requirement/Scenario 与 design 的输入合同 | 编辑生产代码 |
| 交付计划 | 逐项调用 status/instructions，完成 proposal/Spec/design/tasks 与 `ddd/.ddd/delivery/` | 跳过工件依赖图；声称代码或测试已经完成；向项目根 `docs/` 写 change 专属资产 |
| Coding | 调用 apply instructions 恢复上下文，由 DDD Coding 链实现、勾选 tasks 并补充真实追踪 | 让通用 apply 绕过模型合同、Git 或证据合同；静默改变 DDD 语义 |
| 最终验收 | 可选 OpenSpec Verify，加上 DDD 强校验、归档和历史索引 | 把非阻断的 Verify 结论当成最终授权；隐藏设计或用文档替代代码证据 |

## 5. OpenSpec 底层动作

统一脚本固定调用以下官方 CLI 动作：

```text
openspec new change <id> --schema spec-driven --json
openspec status --change <id> --json
openspec instructions <proposal|specs|design|tasks|apply> --change <id> --json
openspec validate <id> --type change --strict --json --no-interactive
openspec archive <id> --yes --json
```

DDD Skill 不复制 OpenSpec 的模板和工件依赖算法。OpenCode SDK 工具 `ddd_openspec_action` 由 TypeScript 引擎组合 status 与 instructions，并增加当前阶段允许读取的 DDD 输入路径和权威边界。三个 Profile 使用同一个适配接口：

| Profile 阶段 | OpenSpec action |
|---|---|
| `00-request` | `new change` |
| 交付/迁移路线图 | `proposal` → `specs` → `design` → `tasks` |
| 实现 | `apply` |
| 最终验收 | status + validate + archive；官方 Verify 仅作补充 |

`add-feature` 与 `create-system` 必须产生行为 Delta Spec 文档。`refactor-system` 只有在外部行为严格不变且行为保护证据充分时才允许 `skip_specs: true`；否则同样必须产生 Delta Spec 文档。

## 6. 历史与归档

OpenSpec archive 同时完成三件事：

1. 将 delta specs 合并进 `openspec/specs/`；
2. 将 change 移动到 `openspec/changes/archive/YYYY-MM-DD-<id>/`；
3. 保留 proposal、design、tasks、delta specs、六份 DDD 文档、审批、checkpoints、change 专属交付资产、实现证据和工作流状态。

因此：

- 活动 change 不能被当作历史；
- 只在 `docs/ddd/` 保存 DDD 文档不构成统一 OpenSpec 历史；
- archive 目录不能删除或被测试夹具当成临时结果清理；
- `ddd/.ddd/delivery/` 不能留在项目根 `docs/` 的影子副本中；归档 change 是其唯一历史容器；
- `change-history.md` 必须由活动目录和 archive 重新扫描生成，不能手写状态。
- 尚未完成的 change 也必须出现在索引中，并显示已预留、进行中、待修订、已拒绝、已规划、实现中或待最终归档等真实状态。
- “拒绝”保留原 change 及其 DDD 反馈，以便审计或在原 id 上修订；只有最终批准且规格成功合并后才标记为“已归档”。
- 工作流状态变化必须同步刷新索引：初始化为“已预留”，修订为“待修订”，重新提交为“进行中”，规划完成后为“已规划”，Coding 为“实现中”，最终验收前为“待最终归档”。

## 7. 校验合同

进入 Coding 前必须满足：

- proposal、design、tasks 都存在；新增功能和新系统至少存在一份 Delta Spec 文档；行为不变的重构允许经过证明的 `skip_specs: true`；
- `ddd/.ddd/delivery/manifest.json`、产品简报、架构约束、路线图和至少一份特性规格都存在并相互可追踪；
- proposal 能追踪到 DDD workflow；
- Requirement 使用 MUST/SHALL；
- 每个 Requirement 至少一个四级 Scenario；
- tasks 至少一项未完成任务。

实现检查点必须满足：

- tasks 至少一项已勾选；
- 已勾选任务可追踪到实现证据。

最终批准前必须满足：

- tasks 全部勾选；
- DDD implementation evidence 有效；
- `openspec validate <change-id> --type change --strict --json --no-interactive` 成功；
- archive 成功后活动 change 不再存在，归档目录存在。
- 归档目录内 `ddd/.ddd/workflow-state.json`、六份里程碑文档和实现证据仍然存在，状态为 `complete`。
- 归档目录内 `ddd/.ddd/delivery/` 仍然存在，且不存在同一 workflow 的项目根 `docs/roadmap`、`docs/specs` 影子事实源。

## 8. Legacy 迁移

已有 `docs/ddd/<workflow-id>/` 不自动移动或删除。继续推进前：

1. 确认同名 OpenSpec change 尚未归档；
2. 使用插件提供的 TypeScript 布局迁移工具把旧工作流复制到 `openspec/changes/<workflow-id>/ddd/`；
3. 保留 checkpoint、审批、哈希、实现证据和 `migration-manifest.json`；
4. 更新 proposal 与 change history 指向新 `ddd/README.md`；
5. 把旧目录视为只读来源，确认迁移完整后再由人类决定是否删除。
