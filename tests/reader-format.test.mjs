import {test} from 'node:test'
import assert from 'node:assert/strict'
import {renderReaderDocument, documentSections, renderSections, sectionsFor} from '../dist/documents.js'

for (const roman of ['I','II','III','IV','V','VI']) test(`reader format ${roman} preserves every canonical section and review updates`, async()=>{
  const sections = Object.fromEntries((await sectionsFor(`milestone${roman}`)).map(s=>[s.heading, '### 具体业务结论\n'+s.heading+'的事实、建议与未知需分别确认。\n\n```mermaid\nflowchart LR\nA-->B\n```\n\n```markdown\n## 示例标题不是章节\n### 示例子标题\n```']))
  sections['一页结论']='### 当前结论\n等待人工验收。'
  sections['本次请您确认']='### DEC-01\n推荐方案及业务代价。'
  sections['业务验收记录']='等待审核。'
  const body=renderReaderDocument(roman, `milestone${roman}`, sections)
  assert.deepEqual([...body.matchAll(/^## ([一二三四五]、.+)$/gm)].map(m=>m[1]),['一、本阶段结论','二、分析范围与依据','三、阶段分析','四、需要你确认的事项','五、补充依据'])
  assert.deepEqual(documentSections(body),sections)
  const revised=renderSections(body,{'业务验收记录':'- 验收决定：revise\n- 反馈：补充事件之间的因果关系。'})
  const parsed=documentSections(revised)
  assert.equal(parsed['业务验收记录'],'- 验收决定：revise\n- 反馈：补充事件之间的因果关系。')
  delete parsed['业务验收记录']; delete sections['业务验收记录']
  assert.deepEqual(parsed,sections,'review changes neither domain decisions nor Mermaid')
})

test('old documents remain readable and editable without migration',()=>{
  const body='# I\n\n## 一页结论\n\n已有结论。\n\n## 业务验收记录\n\n待审核。\n'
  assert.equal(documentSections(renderSections(body,{'业务验收记录':'已批准。'}))['业务验收记录'],'已批准。')
})
