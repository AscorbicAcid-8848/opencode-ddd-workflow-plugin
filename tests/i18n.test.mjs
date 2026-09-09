import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveLanguage, translate } from '../dist/dashboard/i18n.js'
test('locale precedence: optional host config, environment, system UI culture', () => {
  assert.equal(resolveLanguage({ language: 'zh-TW' }, { LANG: 'en_US.UTF-8' }, 'en-US'), 'zh')
  assert.equal(resolveLanguage({ locale: 'en-US' }, { LANG: 'zh_CN.UTF-8' }, 'zh-CN'), 'en')
  assert.equal(resolveLanguage({}, { LC_ALL: 'zh_CN.UTF-8', LANG: 'en-US' }, 'en-US'), 'zh')
  assert.equal(resolveLanguage({}, { LANG: 'C.UTF-8' }, 'zh-CN'), 'zh')
  assert.equal(resolveLanguage({}, {}, 'en-US'), 'en')
  assert.equal(resolveLanguage({}, {}, 'fr-FR'), 'en')
})
test('translation applies only to known UI strings and preserves unknown content', () => {
  assert.equal(translate('en', '批准 [a]'), 'Approve [a]')
  assert.equal(translate('zh', '批准 [a]'), '批准 [a]')
  assert.equal(translate('en', '用户预约成功'), '用户预约成功')
})
