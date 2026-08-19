import assert from "node:assert/strict"
import test from "node:test"

import {
  documentTemplate,
  replaceSubsection,
  subsectionBody,
  validateHumanMilestoneDocument,
  validateHumanOverview,
} from "../dist/workflow/documents.js"

test("human milestone overview parser reads every populated subsection", async () => {
  let document = await documentTemplate("Parser regression", "milestoneI")
  const values = {
    "当前结论": "战略事件风暴已经形成候选业务事件主线。",
    "最新业务增量": "本轮识别了用户意图、业务命令、领域事件和未决问题。",
    "当前状态": "等待人工验收。",
    "是否需要人工决策": "是，需要确认业务语义和事件流是否正确。",
    "验收清单": "- 事件使用过去式\n- 未决问题未进入主流程",
    "未决问题": "- 是否将浏览商铺定义为到店仍待确认。",
    "AI 推荐意见": "建议修改，因为未决业务语义尚未获得授权。",
  }
  for (const [heading, body] of Object.entries(values)) {
    document = replaceSubsection(document, heading, body)
  }
  for (const [heading, body] of Object.entries(values)) {
    assert.equal(subsectionBody(document, heading), body)
  }
  assert.doesNotThrow(() => validateHumanOverview(document))
  assert.throws(() => validateHumanMilestoneDocument(document), /未完成的固定小节/)
})
