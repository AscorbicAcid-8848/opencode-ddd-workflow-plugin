import {test} from 'node:test'
import assert from 'node:assert/strict'
import {profiles} from '../dist/catalog.js'
import {writableHeadingsForStage} from '../dist/documents.js'
import {phaseContentFor} from '../dist/phase-content.js'

test('all workflow branches receive outcomes only for stage-owned sections',async()=>{
  for(const profile of Object.values(await profiles())) {
    const groups={}
    for(const stage of profile.stages.filter(s=>!s.summaryStage)) {
      const owns=writableHeadingsForStage(stage), content=phaseContentFor(owns)
      assert.ok(Object.keys(content).every(h=>owns.includes(h)))
      Object.assign(groups[stage.document]??={},content)
    }
    assert.ok(groups.milestoneI['战略事件风暴'])
    assert.equal(groups.milestoneI['领域模型设计'],undefined)
    assert.ok(groups.milestoneII['子域划分'] && groups.milestoneII['限界上下文'])
    assert.equal(groups.milestoneII['领域模型设计'],undefined)
    assert.match(groups.milestoneIII['模型与边界候选'],/候选/)
    assert.match(groups.milestoneIV['领域模型设计'],/聚合根.*实体.*值对象.*不变量/)
    assert.ok(groups.milestoneV['纵向交付切片'])
    assert.ok(groups.milestoneVI['测试与运行证据'])
  }
})
