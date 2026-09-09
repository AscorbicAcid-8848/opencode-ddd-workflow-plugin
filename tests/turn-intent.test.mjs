import {test} from 'node:test'
import assert from 'node:assert/strict'
import {turnIntents} from '../dist/turn-intent.js'
import {beginSemanticTurn,declareIntent,intentError,bindIntentWorkflow,finishIntentReview,reviewMustStop,clearSemanticTurn} from '../dist/semantic-turn.js'
import {DddWorkflowPlugin,dddLifecycleTool} from '../dist/index.js'
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {profileFor} from '../dist/catalog.js'

test('runtime validates declared intent, not the wording of approval',()=>{
  const s='intent-unit', text='按照最推荐的方案，批准，然后继续下一阶段'
  beginSemanticTurn(s,'u1',text)
  assert.match(intentError(s,'review'),/INTENT_REQUIRED/)
  assert.equal(intentError(s,'status'),undefined)
  assert.equal(declareIntent(s,{messageID:'u1',intent:'approve',quote:text,continueAfterReview:true}).accepted,true)
  assert.equal(intentError(s,'review','approve'),undefined)
  assert.match(intentError(s,'review','reject'),/MISMATCH/)
  bindIntentWorkflow(s,'workflow-A',1)
  assert.throws(()=>bindIntentWorkflow(s,'workflow-B',1),/WORKFLOW_MISMATCH/)
  assert.throws(()=>bindIntentWorkflow(s,'workflow-A',2),/CHECKPOINT_STALE/)
  finishIntentReview(s)
  assert.equal(intentError(s,'prepare'),undefined)
  assert.match(intentError(s,'review','approve'),/NOT_AUTHORIZED/)
  beginSemanticTurn(s,'u2','当前到哪里了')
  assert.match(intentError(s,'prepare'),/INTENT_REQUIRED/)
  assert.equal(declareIntent(s,{messageID:'u2',intent:'query',quote:'当前到哪里了',continueAfterReview:false}).accepted,true)
  assert.match(intentError(s,'prepare'),/READ_ONLY/)
  assert.ok(declareIntent(s,{messageID:'u2',intent:'continue',quote:'当前到哪里了',continueAfterReview:true}).error)
  clearSemanticTurn(s);turnIntents.delete(s)
})

test('stale, fabricated, explicit-readonly and review-only grants fail closed',()=>{
  const s='intent-scope'
  beginSemanticTurn(s,'u1','批准但先不执行')
  assert.ok(declareIntent(s,{messageID:'old',intent:'approve',quote:'批准',continueAfterReview:false}).error)
  assert.ok(declareIntent(s,{messageID:'u1',intent:'approve',quote:'继续全部',continueAfterReview:true}).error)
  declareIntent(s,{messageID:'u1',intent:'approve',quote:'批准但先不执行',continueAfterReview:false})
  finishIntentReview(s)
  assert.equal(reviewMustStop(s),true)
  assert.match(intentError(s,'prepare'),/REVIEW_SCOPE/)
  beginSemanticTurn(s,'u2','/ddd-status',true)
  assert.ok(declareIntent(s,{messageID:'u2',intent:'continue',quote:'/ddd-status',continueAfterReview:true}).error)
  assert.match(intentError(s,'prepare'),/READ_ONLY/)
  clearSemanticTurn(s);turnIntents.delete(s)
})

test('chat hook to intent tool: raw approval no longer blocked; new queries reset permission',async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'ddd-semantic-turn-'))
  const s='semantic-integration'
  t.after(()=>{clearSemanticTurn(s);turnIntents.delete(s);return rm(root,{recursive:true,force:true})})
  const p=await profileFor('refactor-system'), gate=p.stages.find(x=>x.humanGate&&x.document==='milestoneI')
  const file=path.join(root,'openspec/changes/example/ddd/.ddd/workflow-state.json')
  await mkdir(path.dirname(file),{recursive:true})
  await writeFile(file,JSON.stringify({workflowType:'refactor-system',workflowId:'example',status:'active',currentStage:gate.id,runtimeSessionId:s,checkpoints:[{checkpointId:1,stage:gate.id,document:'milestoneI',milestone:'I',status:'awaiting_review'}]}))
  const hooks=await DddWorkflowPlugin({directory:root,worktree:root},{})
  const ctx={sessionID:s,worktree:root}
  const chat=(id,text)=>hooks['chat.message']({sessionID:s,messageID:id,agent:'ddd-workflow'},{message:{id},parts:[{type:'text',text}]})
  const text='按照最推荐的方案，批准，然后继续下一阶段'
  await chat('u1',text)
  assert.equal(turnIntents.get(s),'pending')
  const before=await readFile(file,'utf8')
  const denied=JSON.parse(await dddLifecycleTool.execute({action:'review',input:{decision:'approve'}},ctx))
  assert.match(denied.error,/INTENT_REQUIRED/)
  const accepted=JSON.parse(await dddLifecycleTool.execute({action:'intent',input:{messageID:'u1',intent:'approve',quote:text,continueAfterReview:true}},ctx))
  assert.equal(accepted.accepted,true)
  assert.equal(await readFile(file,'utf8'),before,'intent does not write workflow state')
  await dddLifecycleTool.execute({action:'status'},ctx)
  assert.equal(turnIntents.get(s),'execute')
  await chat('u2','进度如何')
  const q=JSON.parse(await dddLifecycleTool.execute({action:'status'},ctx))
  assert.equal(q.requiredAction,'report-status')
  assert.equal(q.mustContinue,false)
  assert.match(JSON.parse(await dddLifecycleTool.execute({action:'prepare'},ctx)).error,/INTENT_REQUIRED/)
  await hooks['command.execute.before']({sessionID:s,command:'ddd-status',arguments:''},{parts:[]})
  await chat('u3','显式只读命令的消息')
  assert.equal(turnIntents.get(s),'read-only')
})
