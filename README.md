# OpenCode / mobile-coder DDD Slash Plugin

该插件是基于 OpenCode Plugin SDK 的原生 TypeScript DDD 工作流，不注册专家 Agent，也不调用 Codex。

安装包内置经过校验的 19 个 `ddd-*` Skills 快照。安装器会把这份快照复制到 OpenCode 或 Mobile Coder 自己的技能目录，由当前宿主的模型和 TypeScript 工作流引擎执行：

- `ddd-orchestrate` 在 `add-feature`、`refactor-system`、`create-system` 中互斥路由；
- 被选中的总控 Skill 按现有阶段合同执行；
- 进程内 TypeScript 引擎负责确定性的工作流状态、语义合同、checkpoint、人工审批、Git/测试证据和归档；
- `ddd-openspec-bridge` 通过插件内置的 OpenSpec CLI 管理同名 change。

插件提供：

- `/ddd`：加载 `ddd-orchestrate` 并执行用户请求；
- `/ddd-status`：读取工作流状态，不推进流程；
- 基于 `@opencode-ai/plugin` 的 7 个模型可见工具；Prepare/Submit 通过 `mode=milestone|stage` 复用同一协议；
- 诊断、底层 checkpoint 与布局迁移通过 `dddWorkflowAdmin` 管理 API 提供，不占用模型上下文；
- 正式里程碑文档对 LLM 的 `write/edit/apply_patch` 永久只读，只能由通过状态机与语义校验的 DDD 工具受控发布；
- 无 Python 子进程的 TypeScript 状态机、阶段语义图校验和工程证据门禁；
- `@fission-ai/openspec@1.7.0` 本地运行环境；
- 将包内 19 个 `ddd-*` Skills 安装到 OpenCode 或 Mobile Coder 的技能目录。

## 安装

Node.js 需要 20.19.0 或更高版本。

```powershell
cd <本仓库>\opencode-ddd-workflow-plugin
npm install
npm pack
npx --yes --package .\opencode-ddd-workflow-plugin-3.0.3.tgz ddd-opencode init --project E:\path\to\your-project
```

使用同一个本地 tgz 安装或更新 mobile-coder 全局配置：

```powershell
npx --yes --package .\opencode-ddd-workflow-plugin-3.0.3.tgz ddd-opencode init --host mobile --global --replace-legacy
```

已有受管安装会被原地更新，无需增加 `--force`。更新后重启 mobile-coder 并新建会话，使新的 Slash 命令和工具生效。

项目级安装使用 `--host mobile --project <项目目录>`，产物位于项目的 `.mobile-coder/`。

```text
.mobile-coder/
├── commands/
│   ├── ddd.md
│   └── ddd-status.md
├── ddd-workflow-plugin/
├── plugins/
│   └── ddd-workflow.js
├── skills/
│   └── ddd-*/
├── package.json
└── node_modules/
```

## 使用

```text
/ddd 为现有系统新增用户到店预约功能
```

查看状态：

```text
/ddd-status workflow-type=add-feature workflow-id=user-store-appointment
```
