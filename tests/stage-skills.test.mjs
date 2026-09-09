import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { profiles } from '../dist/catalog.js'
import { loadStageSkills } from '../dist/stage-skills.js'
import { prepare } from '../dist/engine.js'

test('every Arabic stage in all three workflows loads complete mapped skill source', async () => {
  let count = 0
  for (const profile of Object.values(await profiles())) for (const stage of profile.stages) {
    const loaded = await loadStageSkills(stage)
    if (stage.summaryStage) { assert.deepEqual(loaded, []); continue }
    count++
    assert.deepEqual(loaded.map(s=>s.name), [...new Set(stage.skills)])
    for (const skill of loaded) {
      assert.equal(skill.instructions, await readFile(new URL(`../${skill.source}`,import.meta.url),'utf8'))
      assert.match(skill.sha256,/^[0-9a-f]{64}$/)
    }
  }
  assert.equal(count,36)
})
test('missing, empty and unsafe skills fail closed', async t => {
  const root=await mkdtemp(path.join(os.tmpdir(),'ddd-skill-missing-'))
  t.after(()=>rm(root,{recursive:true,force:true}))
  await assert.rejects(loadStageSkills({id:'01-test',skills:[]},root),/MISSING/)
  await assert.rejects(loadStageSkills({id:'01-test',skills:['ddd-absent']},root),/LOAD_FAILED/)
  await mkdir(path.join(root,'ddd-empty'))
  await writeFile(path.join(root,'ddd-empty/SKILL.md'),' ')
  await assert.rejects(loadStageSkills({id:'01-test',skills:['ddd-empty']},root),/empty/)
  await assert.rejects(loadStageSkills({id:'01-test',skills:['../escape']},root),/INVALID/)
})
test('prepare delivers full professional instructions and persists a loading receipt', async t => {
  const projectRoot=await mkdtemp(path.join(os.tmpdir(),'ddd-skill-prepare-'))
  t.after(()=>rm(projectRoot,{recursive:true,force:true}))
  const file=path.join(projectRoot,'openspec/changes/example/ddd/.ddd/workflow-state.json')
  await mkdir(path.dirname(file),{recursive:true})
  await writeFile(file,JSON.stringify({workflowType:'refactor-system',workflowId:'example',status:'active',currentStage:'00-request',checkpoints:[{stage:'00-request',document:'milestoneI',milestone:'I',status:'completed',summary:'request'}]}))
  const result=await prepare({projectRoot,workflowType:'refactor-system',workflowId:'example',stage:'01-refactoring-scope-convergence'})
  assert.equal(result.stageCard.professionalSkills[0].name,'ddd-scope')
  assert.ok(result.stageCard.professionalSkills[0].instructions.length>100)
  const state=JSON.parse(await readFile(file,'utf8'))
  assert.equal(state.preparedStage.loadedSkills[0].sha256,result.stageCard.professionalSkills[0].sha256)
})
