# DDD 设计—实现一致性合同

三类工作流都必须把已批准战术设计转换为机器可读的 `model-contract.json`。合同不仅锁定模型元素和不变量，还锁定模块目录、层级归属、依赖方向和跨上下文发布语言；Coding 只能忠实实现，不能静默简化。

## 里程碑 IV：冻结实现意图

在 `IV-tactical-design.md` 中同时批准：

1. `ME-*` 模型元素：正式名称、职责、实现形态、所属模块和层、生产/测试路径、切片归属；
2. `INV-*` 不变量：陈述、唯一 Owner、验收标准；
3. 模块目录：限界上下文、实现单元、源码/测试根、命名空间；
4. 层级规则：每层目录、命名空间、允许依赖的层、禁止 import 前缀；
5. 跨上下文依赖：只允许经目标模块的 Published Language；
6. 延期项：业务理由、不得承担本次 AC/INV；
7. 重构例外：只允许登记基线中已存在且本切片尚未消除的精确 `sourcePath + importPrefix`，并绑定移除切片。

目录风格可以是 `package-by-layer`、`package-by-feature`、`hexagonal`、`clean` 或 `custom`。DDD 不强制统一文件夹名称，但合同必须让每个必做元素只有一个明确模块和层，并能机械判断依赖方向。

## 里程碑 V：生成机器合同

在同名 change 的 `ddd/.ddd/delivery/model-contract.json` 生成 `ddd-model-conformance/v1`，并由 `manifest.json` 的 `modelContract` 指向它。三类工作流都必须生成，`workflowType` 使用当前真实类型。

最小结构：

```json
{
  "schema": "ddd-model-conformance/v1",
  "workflowId": "sample-change",
  "workflowType": "add-feature",
  "status": "approved",
  "conformanceMode": "strict",
  "tacticalDesign": {
    "path": "IV-tactical-design.md",
    "sha256": "<批准文档哈希>"
  },
  "architecture": {
    "layoutStrategy": "package-by-feature",
    "cyclePolicy": "forbid",
    "modules": [
      {
        "id": "identity",
        "boundedContexts": ["Identity & Qualification"],
        "sourceRoots": ["src/main/java/example/identity"],
        "testRoots": ["src/test/java/example/identity"],
        "namespacePrefixes": ["example.identity"],
        "publishedLanguagePrefixes": ["example.identity.contract"],
        "layers": [
          {
            "id": "domain",
            "kind": "domain",
            "pathPrefixes": ["src/main/java/example/identity/domain"],
            "namespacePrefixes": ["example.identity.domain"],
            "allowedLayerIds": ["domain"],
            "forbiddenImportPrefixes": [
              "org.springframework",
              "example.identity.infrastructure"
            ]
          }
        ]
      }
    ],
    "moduleDependencies": [],
    "approvedLegacyExceptions": [],
    "verification": {
      "requiredCommands": ["./gradlew architectureTest"]
    }
  },
  "elements": [
    {
      "id": "ME-AGG-001",
      "kind": "aggregate",
      "name": "UserIdentity",
      "responsibility": "维护身份生命周期不变量",
      "implementationForm": "dedicated-type",
      "moduleId": "identity",
      "layerId": "domain",
      "productionPaths": [
        "src/main/java/example/identity/domain/UserIdentity.java"
      ],
      "testPaths": [
        "src/test/java/example/identity/domain/UserIdentityTest.java"
      ],
      "coveredByItems": ["P1.1.1"]
    }
  ],
  "invariants": [
    {
      "id": "INV-001",
      "statement": "同一规范化标识最多建立一个身份",
      "ownerElementId": "ME-AGG-001",
      "acceptanceCriteria": ["AC-P1.1-001"]
    }
  ],
  "deferredElements": []
}
```

`strict` 用于 Add 和 Create：不允许架构例外。`migration` 用于 Refactor：只允许基线已有、精确登记且绑定移除切片的例外；不得新增或扩大例外。

## Coding

实现提示词必须来自已批准切片、feature spec 和模型合同，并明确列出：

- 本切片的 `ME-*`、`INV-*`；
- 每个元素的模块、层、生产/测试路径；
- 允许和禁止的层间依赖；
- 允许的跨模块 Published Language；
- 必须通过的架构测试、行为测试和运行验证。

禁止：

- 把聚合、值对象、领域服务或事件降级到 Controller、ORM Mapper 或脚本式 Service；
- 让 application 依赖 infrastructure，或让 domain 依赖 application/infrastructure/interface；
- 跨上下文引用目标模块内部类型、仓储、表或适配器；
- 形成模块循环依赖；
- 未回到里程碑 IV/V 就更名、合并、删除或改变已批准职责。

若代码事实证明合同不可实现，停止 Coding 并回到拥有该决定的阶段。

## 实现与最终验收

每份 `ddd-implementation-evidence/v2` 必须包含 `designConformance`，绑定当前合同哈希、该切片实现的 `ME-*`/`INV-*`，且 `deviations` 为空。工作流脚本还会从提交内容重新计算 `architectureConformance`：

- 生产路径必须落入合同中的唯一模块和层；
- dedicated type 必须真实存在；
- import 必须满足层间和跨模块规则；
- 跨模块 import 必须属于目标 Published Language；
- 实际模块依赖图不得成环；
- Refactor 的遗留例外必须在 baseline 已存在，不能由本切片新增。

每份 v2 证据还必须提供 `testEvidence`：逐项映射全部 AC/INV 与通过的测试路径和命令；记录并通过必需测试层级；证明 E2E 覆盖全部真实 consumer 且不以 mock 替代业务路径。Refactor 还必须以精确 `baselineSha` 和 `implementationSha` 对相同 AC 做前后行为比较，两个结果都通过且差异为空。

每个实现检查点和最终验收都会扫描合同中全部模块 `sourceRoots` 下的受支持源码，并额外核对切片声明的生产路径；因此没有登记为 `ME-*` 的辅助类也不能绕过目录与依赖规则。最终验收还要求模型覆盖率 100%、架构偏离为零、测试覆盖完整、必需测试层级通过和 E2E 真实链路通过；重构还要求前后行为对比通过。文档声明、文件存在和接口测试通过都不能替代该检查。
