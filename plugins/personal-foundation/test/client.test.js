import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizePath } from '../src/client/index.ts'

test('personalApi accepts shorthand and complete private API paths', () => {
  assert.equal(normalizePath('/skills'), '/__personal/api/skills')
  assert.equal(normalizePath('/__personal/api/theme'), '/__personal/api/theme')
  assert.throws(() => normalizePath('skills'), /must begin/u)
})
