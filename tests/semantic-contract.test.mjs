import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import { profileFor, stageContract } from "../dist/workflow/catalog.js"
import { validateStageSubmission } from "../dist/workflow/stage-submission.js"

test("Big Picture preflight rejects invalid global semantics and unresolved main-flow conclusions", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ddd-semantic-preflight-"))
  try {
    const profile = await profileFor("create-system")
    const stage = stageContract(profile, "02-big-picture-event-storm")
    const state = {
      workflowType: "create-system", workflowId: "semantic-preflight", projectRoot: root,
      artifactRoot: root, title: "Semantic preflight", status: "active", currentStage: "01-system-scenarios",
      schemaVersion: "test", profileSchemaVersion: "test", documentLayoutVersion: "test",
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), checkpoints: [], snapshot: {},
    }
    const result = await validateStageSubmission(root, state, profile, stage, {
      inputReferences: ["user-input:original-request"],
      items: [
        {
          id: "CMD-001", kind: "business-command", statement: "用户声明自己已经到店。",
          maturity: "candidate", documentSection: "战略事件风暴",
          attributes: {
            decisionPlane: "business", scopeDisposition: "target", flowRole: "command",
            authorityRefs: ["user-input:original-request"], intent: "state-change", businessSideEffect: "记录一次到店",
          },
        },
        {
          id: "EVT-001", kind: "domain-event", statement: "用户到店已记录。",
          maturity: "candidate", documentSection: "战略事件风暴",
          attributes: {
            decisionPlane: "business", scopeDisposition: "requested", flowRole: "main",
            authorityRefs: ["user-input:original-request"], businessEffect: "state-transition",
            businessSubjectRef: "CMD-001", changedState: "到店记录从无到有",
          },
        },
        {
          id: "OQ-001", kind: "open-question", statement: "浏览详情是否等于真实到店仍未确认。",
          maturity: "candidate", documentSection: "热点与边界线索",
          attributes: {
            decisionPlane: "business", scopeDisposition: "candidate", flowRole: "none",
            authorityRefs: ["user-input:original-request"], decisionId: "VISIT-DEFINITION", state: "unresolved",
          },
        },
        {
          id: "CAP-001", kind: "capability-status", statement: "轨迹能力仅是未来候选。",
          maturity: "candidate", documentSection: "热点与边界线索",
          attributes: {
            decisionPlane: "business", scopeDisposition: "existing", flowRole: "supporting",
            authorityRefs: ["user-input:original-request"], capabilityId: "visit-trajectory", status: "future", sourceFactRefs: [],
          },
        },
        {
          id: "QUERY-001", kind: "business-command", statement: "用户查询当日轨迹。",
          maturity: "candidate", documentSection: "战略事件风暴",
          attributes: {
            decisionPlane: "business", scopeDisposition: "requested", flowRole: "main",
            authorityRefs: ["user-input:original-request"], intent: "information-request", businessSideEffect: "返回轨迹视图",
          },
        },
        {
          id: "READ-001", kind: "read-model", statement: "当日轨迹视图展示用户到访序列。",
          maturity: "candidate", documentSection: "战略事件风暴",
          attributes: {
            decisionPlane: "business", scopeDisposition: "requested", flowRole: "main",
            authorityRefs: ["user-input:original-request"], queryPurpose: "查看当日到访序列",
          },
        },
        {
          id: "CAP-002", kind: "capability-status", statement: "新增认证作为轨迹功能的支撑目标。",
          maturity: "candidate", documentSection: "热点与边界线索",
          attributes: {
            decisionPlane: "business", scopeDisposition: "requested", flowRole: "supporting",
            authorityRefs: ["user-input:original-request"], capabilityId: "authentication", status: "target", sourceFactRefs: [],
          },
        },
        {
          id: "HOT-001", kind: "hotspot", statement: "到店定义是当前业务热点。",
          maturity: "candidate", documentSection: "热点与边界线索",
          attributes: {
            decisionPlane: "business", scopeDisposition: "candidate", flowRole: "supporting",
            authorityRefs: ["user-input:original-request"],
          },
        },
      ],
      relations: [
        { id: "REL-001", type: "emits", from: "CMD-001", to: "EVT-001", rationale: "命令产生业务状态变化。" },
        { id: "REL-002", type: "blocks", from: "OQ-001", to: "EVT-001", rationale: "定义未决时不能确认主流程事件。" },
      ],
      sections: { "战略事件风暴": "围绕用户到店意图形成候选事件主线。", "热点与边界线索": "到店语义仍需业务人员确认。" },
      soleOutput: { statement: "候选职责线索等待业务语义澄清。", itemRefs: ["EVT-001"] },
      overview: {
        currentConclusion: "形成候选事件流。", latestBusinessIncrement: "识别到店命令与事件。",
        acceptanceChecklist: ["确认业务语义"], openQuestions: ["浏览是否等于到店"],
        recommendation: "建议修改，因为到店定义仍未确认。",
      },
    }, "形成战略事件风暴候选事件流并暴露未决业务语义。")
    const codes = new Set(result.findings.map((finding) => finding.code))
    assert.ok(codes.has("SCOPE-DISPOSITION-INVALID"))
    assert.ok(codes.has("FLOW-ROLE-INVALID"))
    assert.ok(codes.has("BLOCKED-CONCLUSION-ACTIVE"))
    assert.ok(codes.has("CAPABILITY-DISPOSITION-MISMATCH"))
    assert.ok(codes.has("OVERVIEW-QUESTION-NOT-MODELED"))
    assert.ok(codes.has("MODELED-QUESTION-NOT-IN-OVERVIEW"))
    assert.ok(codes.has("QUERY-RESULT-AS-EVENT"))
    assert.ok(codes.has("READ-MODEL-WITHOUT-QUERY"))
    assert.ok(codes.has("SUPPORTING-TARGET-REQUIRES-DECISION"))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
