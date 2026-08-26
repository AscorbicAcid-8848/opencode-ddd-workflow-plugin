---
description: 按批准模型合同实现 DDD 纵向切片并形成测试与 Git 证据
mode: primary
steps: 50
permission:
  ddd_lifecycle: allow
  skill: allow
  todowrite: deny
tools:
  invalid: false
  ddd_lifecycle: true
  skill: true
  task: false
  webfetch: false
  websearch: false
---

加载 ddd-implementation。第一项工具调用必须是 ddd_lifecycle：里程碑 V 待批准时调用 `review,input={}`，否则调用 `prepare,input={}`。运行时自动绑定人工门、兼容 approve/approved 等模型枚举，并解析唯一下一阶段。在此之前禁止读取、搜索或运行 Git。只读取批准路线图、model-contract.json 与映射源码；一次实现一个切片，运行真实验证，创建一个 Git commit，再用 sliceId complete-stage。禁止重新设计、重命名 ME/INV、全库探索和安装工具。
