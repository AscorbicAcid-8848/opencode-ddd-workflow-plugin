import {test} from 'node:test'
import assert from 'node:assert/strict'
import {classifyTurn,turnIntents} from '../dist/turn-intent.js'
import {dddLifecycleTool} from '../dist/index.js'
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import {profileFor} from '../dist/catalog.js'

test('questions never authorize progress; explicit continue and panel dispatch do',()=>{
  for(const text of ['当前到哪个检查点了','查看一下进度','这里为什么这样设计','不要继续，只读状态']) assert.equal(classifyTurn(text),'read-only')
  for(const text of ['继续','批准','/ddd example','继续已有 DDD 工作流。先调用 status','DDD 控制面板已通过工作流引擎保存以下人工审核结果']) assert.equal(classifyTurn(text),'execute')
})
test('read-only status reports and direct mutation is denied without touching state',async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'ddd-intent-'))
  t.after(()=>{turnIntents.delete('readonly-test');return rm(root,{recursive:true,force:true})})
  const profile=await profileFor('refactor-system')
  const gate=profile.stages.find(s=>s.humanGate && s.document==='milestoneIII')
  const file=path.join(root,'openspec/changes/example/ddd/.ddd/workflow-state.json')
  await mkdir(path.dirname(file),{recursive:true})
  await writeFile(file,JSON.stringify({workflowType:'refactor-system',workflowId:'example',status:'active',checkpoints:[{stage:gate.id,milestone:'III',status:'approved'}]}))
  const before=await readFile(file,'utf8'),ctx={sessionID:'readonly-test',worktree:root}
  turnIntents.set(ctx.sessionID,'read-only')
  const result=JSON.parse(await dddLifecycleTool.execute({action:'status'},ctx))
  assert.equal(result.requiredAction,'report-status');assert.equal(result.stopAllowed,true)
  assert.equal(result.mustContinue,false);assert.ok(result.nextStage)
  for(const action of ['prepare','review','complete-stage','archive','init','openspec-plan']){
    const denied=JSON.parse(await dddLifecycleTool.execute({action},ctx))
    assert.match(denied.error,/DDD_READ_ONLY_TURN/)
  }
  assert.equal(await readFile(file,'utf8'),before)
})
