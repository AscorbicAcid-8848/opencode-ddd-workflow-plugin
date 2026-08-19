---
name: ddd-openspec-bridge
description: "把新增功能、遗留系统重构和新系统创建三个 DDD 工作流适配到官方 OpenSpec 引擎：使用 CLI 创建同名 change、查询工件图、获取动态 instructions、校验任务并归档，同时保持六个 DDD 里程碑、领域决策、模型合同和实现证据的控制权。用于 DDD 与 OpenSpec 的统一生命周期衔接，不替代领域建模或编码。"
---

# DDD OpenSpec Bridge

把本 Skill 当作 DDD 与 OpenSpec 之间的适配层，不再自行模拟一套 OpenSpec。开始前完整阅读 [ddd-openspec-lifecycle.md](references/ddd-openspec-lifecycle.md)。始终保持：

```text
一个 DDD workflow-id = 一个 OpenSpec change-id = 一个 change 目录
```

## 职责边界

| 层 | 唯一职责 |
|---|---|
| DDD 工作流 | 用户场景、两级 EventStorming、战略与战术设计、六个人工里程碑、模型合同和回溯决策 |
| 本桥接层 | 把已批准的 DDD 输入翻译成 OpenSpec 工件，并阻止 OpenSpec 越权修改领域决策 |
| OpenSpec CLI | 标准 change 骨架、工件依赖图、动态 instructions、状态、严格校验、Spec 合并和 archive |
| `ddd-develop` / `ddd-git-delivery` | 纵向切片、代码、测试、Git commit、实现证据和回滚点 |

OpenSpec Skill 是 AI 操作适配器，不是确定性运行时 API。DDD 插件通过 OpenCode SDK 的 TypeScript 工具调用官方 OpenSpec CLI；只有在当前客户端已经安装相应官方 Skill 时，才把 `openspec-explore`、`openspec-update-change` 或 `openspec-verify-change` 作为辅助推理步骤。

## 统一底层动作

三个 DDD Profile 都必须使用下表，禁止分别实现 OpenSpec 生命周期：

| DDD 时点 | 底层动作 | 约束 |
|---|---|---|
| 模糊请求、尚未初始化 | 可选使用 `openspec-explore` | 只调查和比较，不创建 change、不写正式 DDD 工件 |
| 工作流初始化 | `openspec new change <id> --schema spec-driven --json` | 由 `ddd_workflow_init` 在 TypeScript 引擎内自动调用；禁止手写 `.openspec.yaml` |
| 里程碑 I–IV | change 只作为容器 | 不生成 proposal、Delta Spec 文档、design 或 tasks |
| 里程碑 IV 批准后、V 期间 | `openspec status` + `openspec instructions` | 每个工件生成前获取实时模板、依赖、规则和输出位置 |
| Coding 前及恢复时 | `openspec instructions apply` | 只提供任务上下文；实现仍受 DDD 路线图、模型合同和 Git 合同控制 |
| 规划文档修订 | 可选使用 `openspec-update-change` | 只协调现有 OpenSpec 工件；领域语义变化必须返回对应 DDD 里程碑 |
| 里程碑 VI 前 | 可选使用 `openspec-verify-change` | 作为补充检查；不能替代 DDD 强制实现证据 |
| 最终批准 | `openspec validate --strict` + `openspec archive` | 所有 DDD、代码、测试、Git 和任务门禁先通过 |

## 调用合同

### 1. 初始化

始终通过 OpenCode SDK 工具 `ddd_workflow_init` 初始化。TypeScript 引擎内部必须调用官方 `openspec new change`，并校验 change 目录与 `.openspec.yaml` 已真实生成。

内置 CLI 必须由插件解析出的真实 Node 可执行文件启动，不能使用宿主的 `process.execPath` 假定其为 Node。若返回 `OPENSPEC_*`、`retryableByModel: false` 或 `runtime-contract-repair`，立即熔断并报告插件运行时问题；禁止模型改用 Bash、`npx`、全局安装或手工目录操作恢复。

随后只补充 `ddd/`、`ddd-workflow.json`、六份里程碑和内部状态。不得用 `openspec-propose` 初始化，因为它会在 DDD 战略与战术设计批准前提前生成 planning artifacts。

### 2. 里程碑 V 生成 OpenSpec 工件

在写每个工件之前依次调用统一适配命令：

依次调用 `ddd_openspec_action`，并把 `artifact` 分别设为 `proposal`、`specs`、`design` 和 `tasks`。

命令组合官方 `openspec status --json` 与 `openspec instructions <artifact> --json`，并返回当前 DDD 允许消费的输入。严格按返回的 `outputPath` 写入；每完成一个工件后重新调用下一项，以刷新依赖图。

| OpenSpec 工件 | 仅允许消费的 DDD 决策 |
|---|---|
| `proposal.md` | 里程碑 I、II：业务动机、能力范围、边界与影响 |
| `specs/<capability>/spec.md` | 里程碑 II 实现单元用例与里程碑 IV 业务规则、不变量 |
| `design.md` | 里程碑 II、IV 与 `model-contract.json`：技术落位、集成、持久化、迁移和回滚 |
| `tasks.md` | 里程碑 V 路线图：按依赖排序、可验证的纵向切片 |

`design.md` 不得重新划分子域、限界上下文、部署边界、聚合或不变量。动态 instructions 与已批准 DDD 冲突时，以 DDD 决策为准并回到拥有该决策的里程碑，不得静默折中。

### 3. Coding

每次开始或恢复 Coding 前调用：

调用 `ddd_openspec_action` 并设置 `artifact=apply`。

只实现 `tasks.md`、`ddd/.ddd/delivery/roadmap.json` 和 `model-contract.json` 的交集。`openspec-apply-change` 不得取代 `ddd-develop` 与 `ddd-git-delivery`，也不得绕过一切片一提交、生产/测试路径、真实 consumer、架构一致性、兼容性和回滚证据。

### 4. 最终验证与归档

如果官方 `openspec-verify-change` 可用，在里程碑 VI 前运行并把问题交给 `ddd-model-review`；它的“可归档”结论不具有最终授权。最终仍必须满足：

- OpenSpec tasks 全部勾选；
- OpenSpec strict validate 成功；
- 至少一个真实实现检查点通过；
- 模型元素、不变量、模块路径与依赖方向符合 `model-contract.json`；
- 代码、测试、consumer、Git SHA、兼容性与回滚证据完整；
- 测试覆盖完整、必需测试层级全部通过、E2E 真实链路通过；重构工作流的前后行为对比通过且无未批准差异；
- 里程碑 VI 人工批准。

批准后由 TypeScript 工作流引擎调用 `openspec archive <workflow-id> --yes --json`。禁止手工移动目录或先把工作流标为 complete。

## 三个 Profile 的差异

- `add-feature`：默认保持现有部署形态；必须提交行为 Delta Spec 文档。
- `create-system`：首期交付必须提交行为 Delta Spec 文档，归档后形成当前正式 Spec 文档。
- `refactor-system`：如果外部行为确实不变，可以在 `.openspec.yaml` 设置 `skip_specs: true`，但必须由现状基线、行为保护测试和迁移计划证明；只要行为发生改变，就必须提交 Delta Spec 文档。

三个 Profile 只共享适配协议，不共享具体 DDD 工件、领域决策、Change 或实现证据。

## 事实源与目录

- `openspec/changes/<workflow-id>/ddd/`：六个 DDD 里程碑、审批、检查点和实现证据。
- `openspec/changes/<workflow-id>/ddd/.ddd/delivery/`：产品简报、架构约束、机器路线图、特性验收文档和模型合同。
- `openspec/changes/<workflow-id>/`：proposal、Delta Spec 文档、design、tasks 与同次 DDD 工作流的唯一活动容器。
- `openspec/specs/`：归档后已生效的当前 Spec 文档。
- `openspec/changes/archive/`：已完成 Change 的完整审计历史。
- `openspec/change-history.md`：活动与归档 Change 的浅层导航，不替代正式 Spec 文档或 archive。

## 回溯规则

- proposal 的能力归属不清 → 返回战略设计。
- Requirement/Scenario 无法表达业务规则 → 返回实现单元用例或战术设计。
- design 与聚合、不变量或边界冲突 → 返回对应 DDD 里程碑。
- Coding 需要未批准的行为变化 → 停止实现，修改同一 Change，并返回拥有该决策的里程碑。
- OpenSpec instructions 报告工件 blocked → 补齐依赖，不跳过、不手写状态。
- validate 或 archive 失败 → 保持 Change 活动，修复后重试。
- 人工要求修改或拒绝 → 保留同一活动 Change 和历史，不创建影子 Change、不复用归档 ID。
