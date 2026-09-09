import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import {DddWorkflowPlugin} from '../dist/index.js'
import {validateStageSemantics} from '../dist/engine.js'
import {validateStageClaims} from '../dist/claims.js'

const plugin = () => DddWorkflowPlugin({directory:process.cwd(),worktree:process.cwd()})
// SDK hook unit tests: successful host responses are simulated; no model or shell is executed.
async function prepared(hooks, sessionID, stage) {
  await hooks['tool.execute.after']({tool:'ddd_lifecycle',sessionID,args:{action:'prepare'}},
    {output:JSON.stringify({stageCard:{stageId:stage}})})
}
test('targeted evidence reads have no fixed quota and survive hook recreation', async()=>{
  let hooks=await plugin(); const sessionID='scoped-evidence'
  await prepared(hooks,sessionID,'01-current-evidence')
  hooks=await plugin()
  for(let i=0;i<25;i++) await assert.doesNotReject(hooks['tool.execute.before'](
    {tool:'read',sessionID,callID:String(i)},{args:{filePath:`src/file${i}.ts`}}))
  await assert.rejects(hooks['tool.execute.before']({tool:'write',sessionID,callID:'write'},
    {args:{filePath:'src/new.ts'}}),/DDD_LIFECYCLE_ONLY/)
})
test('coding permits needed verification without command keyword or call-count bans', async()=>{
  const hooks=await plugin(), sessionID='scoped-coding'
  await hooks['command.execute.before']({command:'ddd-code',sessionID},{})
  await prepared(hooks,sessionID,'09-implementation')
  for(let i=0;i<25;i++) {
    await assert.doesNotReject(hooks['tool.execute.before']({tool:'read',sessionID,callID:`r${i}`},{args:{filePath:'src/App.ts'}}))
    await assert.doesNotReject(hooks['tool.execute.before']({tool:'bash',sessionID,callID:`b${i}`},
      {args:{command:i%2?'npm install --ignore-scripts':'curl http://localhost:8080/health'}}))
  }
})
test('failed prepare and lookalike tools cannot grant coding access', async()=>{
  const hooks=await plugin(), sessionID='failed-stage-selection'
  await hooks['command.execute.before']({command:'ddd-code',sessionID},{})
  await hooks['tool.execute.before']({tool:'ddd_lifecycle',sessionID,callID:'prepare'},
    {args:{action:'prepare',input:{stage:'09-implementation'}}})
  await hooks['tool.execute.after']({tool:'ddd_lifecycle',sessionID,args:{action:'prepare'}},{output:JSON.stringify({error:'not allowed'})})
  await hooks['tool.execute.after']({tool:'other',sessionID,args:{action:'prepare'}},
    {output:JSON.stringify({stageCard:{stageId:'09-implementation'}})})
  await assert.rejects(hooks['tool.execute.before']({tool:'bash',sessionID,callID:'shell'},{args:{command:'npm test'}}),/DDD_LIFECYCLE_ONLY/)
})
test('unrelated init payload is neither rewritten nor enrolled in DDD', async()=>{
  const hooks=await plugin(), sessionID='unrelated-init'
  const args={action:'init',input:{request:'unrelated'}}
  await hooks['tool.execute.before']({tool:'another_tool',sessionID,callID:'init'},{args})
  assert.equal(args.input.request,'unrelated')
  await assert.doesNotReject(hooks['tool.execute.before']({tool:'another_tool',sessionID,callID:'next'},{args:{}}))
})
test('architecture expressions are advice, while wrong change identity remains blocking',()=>{
  for(const text of ['聚合根 + ORM；按项目约定采用 ports/adapters。','领域对象独立映射；domain/application/infrastructure/interfaces']) {
    const findings=validateStageSemantics({workflowType:'add-feature',workflowId:'c',originalRequest:''},
      {id:'06-tactical-design',scopeContract:{id:'context-tactical-design'}},
      {summary:'模型职责已说明',sections:{'领域模型设计':text,'模块与分层设计':text}})
    assert.equal(findings.some(f=>f.severity==='blocking'),false)
  }
  const findings=validateStageSemantics({workflowType:'add-feature',workflowId:'c'},
    {scopeContract:{id:'delivery-planning'}},{summary:'',sections:{'OpenSpec 变更映射':'change=wrong'}})
  assert.ok(findings.some(f=>f.code==='OPENSPEC_CHANGE_ID_MISMATCH'&&f.severity==='blocking'))
})
test('directly inspected code is valid evidence without bundle issuance; invented lines fail',async t=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'ddd-direct-evidence-'));t.after(()=>rm(dir,{recursive:true,force:true}))
  await mkdir(path.join(dir,'src'));await writeFile(path.join(dir,'src/app.js'),'export const app = true\n')
  async function check(ref){const statement='当前源码导出 app 常量。';return validateStageClaims(
    {projectRoot:dir,artifactRoot:dir},'existing-system-baseline',['证据与追踪'],{'证据与追踪':statement},
    [{id:'FACT-APP',kind:'current-behavior-fact',statement,maturity:'fact',documentSection:'证据与追踪',
      authorityRefs:[ref],evidenceRefs:[ref],attributes:{observationLevel:'statically-reachable',availability:'operational',evidenceSubject:'app'}}])}
  assert.deepEqual(await check('code:src/app.js#L1-L1'),[])
  assert.ok((await check('code:src/app.js#L1-L999')).some(f=>f.code==='CODE_EVIDENCE_INVALID'&&f.severity==='blocking'))
})
