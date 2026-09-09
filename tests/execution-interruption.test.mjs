import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import {isInterruptedReply,createInterruptionMonitor,readExecutionInterruption} from '../dist/execution-interruption.js'

const failed={info:{id:'msg_failure',role:'assistant',agent:'ddd-workflow',finish:'unknown',time:{created:1000,completed:2000}},parts:[]}
test('detects empty unknown response but not active, cancelled, useful or newer turns',()=>{
  assert.ok(isInterruptedReply([failed]))
  assert.ok(isInterruptedReply([{...failed,info:{...failed.info,agent:'build'}}]))
  for(const message of [
    {...failed,parts:[{type:'tool'}]}, {...failed,parts:[{type:'text',text:'等待审核'}]},
    {...failed,info:{...failed.info,time:{created:1000}}},
    {...failed,info:{...failed.info,error:{name:'MessageAbortedError'}}},
  ]) assert.equal(isInterruptedReply([message]),undefined)
  assert.equal(isInterruptedReply([failed,{info:{role:'user',time:{created:3000}},parts:[]}]),undefined)
})
test('idle persists one diagnostic without changing workflow or calling a model',async t=>{
  const project=await mkdtemp(path.join(os.tmpdir(),'ddd-interruption-'))
  t.after(()=>rm(project,{recursive:true,force:true}))
  const root=path.join(project,'openspec/changes/example/ddd')
  await mkdir(path.join(root,'.ddd'),{recursive:true})
  const state={workflowType:'refactor-system',workflowId:'example',status:'active',runtimeSessionId:'ses_1',updatedAt:'1970-01-01T00:00:01Z',currentStage:'00-request',checkpoints:[{checkpointId:1,stage:'00-request',document:'milestoneI',milestone:'I',status:'completed'}]}
  const file=path.join(root,'.ddd/workflow-state.json')
  await writeFile(file,JSON.stringify(state))
  const before=await readFile(file,'utf8'),toasts=[]
  const monitor=createInterruptionMonitor(project,{session:{messages:async()=>({data:[failed]})},tui:{showToast:async data=>toasts.push(data)}})
  await monitor('ses_other'); assert.equal(toasts.length,0)
  await monitor('ses_1'); await monitor('ses_1')
  assert.equal(toasts.length,1)
  assert.equal(await readFile(file,'utf8'),before)
  assert.match((await readExecutionInterruption(root,state)).message,/\/ddd example/)
  assert.equal(await readExecutionInterruption(root,{...state,updatedAt:'1970-01-01T00:00:03Z'}),undefined)
})
