import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { progressState, milestoneChat, milestoneWindows } from '../dist/dashboard/chat.js'

test('completed milestones and only first unfinished milestone get a progress label', () => {
  const item = {state: {checkpoints: [{milestone:'I', status:'approved'}]}, profile:{stages:[]}}
  assert.equal(progressState(item,'I'), '已完成')
  assert.equal(progressState(item,'II'), '待开始')
  assert.equal(progressState(item,'III'), '')
  item.state.checkpoints.push({milestone:'II',status:'awaiting_review'})
  assert.equal(progressState(item,'II'),'执行中')
})
test('chat merges all associated sessions by time, including casual chat without tools', async t => {
  const project = await mkdtemp(path.join(os.tmpdir(),'ddd-chat-'))
  t.after(() => rm(project,{recursive:true,force:true}))
  const root = path.join(project,'ddd'); await mkdir(path.join(root,'.ddd'),{recursive:true})
  const item = {root,project,state:{runtimeSessionId:'s',runtimeSessionIds:['s','s2'],checkpoints:[],status:'active'}}
  assert.equal((await milestoneChat(item,'I',{})).missing,true)
  item.state.createdAt = new Date(1).toISOString()
  item.state.checkpoints = [{milestone:'I',completedAt:new Date(2).toISOString(),review:{decision:'approve',reviewedAt:new Date(3).toISOString()}}]
  const client = {session:{get:async()=>({data:{directory:project}}),messages:async({sessionID})=>({data: sessionID === 's2' ? [
    {info:{id:'casual',role:'user',time:{created:2}},parts:[{type:'text',text:'另一个会话的闲聊'}]},
  ] : [
    {info:{id:'u',role:'user',time:{created:1}},parts:[{type:'text',text:'用户原话'}]},
    {info:{id:'a',parentID:'u',role:'assistant',time:{created:2}},parts:[{type:'tool',callID:'call'},{type:'text',text:'真实答复'},{type:'reasoning',text:'private'}]},
    {info:{id:'other',role:'user',time:{created:3}},parts:[{type:'text',text:'无关'}]},
  ]})}}
  const result = await milestoneChat(item,'I',client)
  assert.deepEqual(result.messages.map(m=>m.text),['用户原话','真实答复','另一个会话的闲聊'])
  // init occurs after its initiating user prompt. Include the exact parent,
  // not arbitrary earlier chat or every sibling assistant turn.
  item.state.createdAt = new Date(2).toISOString()
  assert.deepEqual((await milestoneChat(item,'I',client)).messages.map(m=>m.text),['用户原话','真实答复','另一个会话的闲聊'])
  assert.deepEqual((await milestoneChat(item,'II',client)).messages.map(m=>m.text),['无关'])
  client.session.get = async ({sessionID}) => sessionID === 's2' ? {error:{}} : {data:{directory:project}}
  const partial = await milestoneChat(item,'I',client)
  assert.equal(partial.messages.length,2)
  assert.equal(partial.warnings.length,1)
})

test('revisited milestones form multiple windows and closed workflows exclude later chat', () => {
  const at = n => new Date(n).toISOString()
  const item = {state:{createdAt:at(1),status:'complete',updatedAt:at(9),checkpoints:[
    {milestone:'I',completedAt:at(2),review:{decision:'approve',reviewedAt:at(3)}},
    {milestone:'II',completedAt:at(4)},
    {milestone:'I',completedAt:at(6),review:{decision:'approve',reviewedAt:at(7)}}
  ]}}
  const windows = milestoneWindows(item,'I')
  const includes = n => windows.some(w=>n>=w.start&&n<w.end)
  assert.equal(includes(2),true); assert.equal(includes(4),false); assert.equal(includes(6),true)
  assert.equal(includes(11),false)
})
