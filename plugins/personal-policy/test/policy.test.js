import assert from 'node:assert/strict'
import test from 'node:test'
import { SECTION_NAME, SECTION_ORDER, POLICY_TEXT, POLICY_VERSION, inject, apply } from '../src/index.ts'

test('policy section registers with the unique name and governance order', () => {
  const captured = []
  const ctx = {
    systemPrompt: {
      section(entry) { captured.push(entry) },
    },
  }
  apply(ctx)
  assert.equal(captured.length, 1)
  assert.equal(captured[0].name, SECTION_NAME)
  assert.equal(captured[0].order, SECTION_ORDER)
  assert.equal(captured[0].order, -50)
  assert.equal(typeof captured[0].text, 'string')
  assert.equal('complete' in captured[0], false, 'must stay a normal section, never complete')
})

test('policy text carries all 8 red lines without the diagnostic version', () => {
  assert.match(POLICY_TEXT, /你必须遵守以下跨项目工作红线/)
  for (let i = 1; i <= 8; i += 1) {
    assert.match(POLICY_TEXT, new RegExp('^' + i + '\.', 'm'), 'line ' + i + ' present')
  }
  assert.doesNotMatch(POLICY_TEXT, new RegExp(POLICY_VERSION.replace(/\./g, '\\.')))
})

test('policy injects the systemPrompt service', () => {
  assert.ok(inject.includes('systemPrompt'))
})
