import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  assertAutomationSafe,
  isAutomationOwned,
  protectedRootOf,
  REPOSITORY_ROOT,
  STABLE_DATA_HOME,
  STABLE_INSTALL_ROOT,
} from '../scripts/protected-paths.js'

test('the stable install and data homes are protected from automation', () => {
  const protectedPaths = [
    'D:\\Cyrus Deepseek Harness',
    'D:\\Cyrus Deepseek Harness\\DeepSeek Harness Personal',
    'D:\\Cyrus Deepseek Harness\\DeepSeek Harness Personal\\resources\\app\\plugins\\project-control',
    'F:\\documents\\Cyrus Deepseek Harness Data',
    'F:\\documents\\Cyrus Deepseek Harness Data\\harness-home\\profiles',
    'F:\\documents\\Cyrus Deepseek Harness Data\\project-control\\project-control.sqlite3',
    'F:\\documents\\Cyrus Deepseek Harness Data\\from-test-userdata',
  ]
  for (const path of protectedPaths) {
    assert.notEqual(protectedRootOf(path), null, `expected protected: ${path}`)
    assert.throws(() => assertAutomationSafe(path, '测试写入'), /受保护路径拦截/u)
    assert.equal(isAutomationOwned(path), false)
  }
  assert.equal(STABLE_INSTALL_ROOT, 'D:\\Cyrus Deepseek Harness')
  assert.equal(STABLE_DATA_HOME, 'F:\\documents\\Cyrus Deepseek Harness Data')
})

test('repository and system temp paths stay automation-owned', () => {
  const temp = mkdtempSync(join(tmpdir(), 'dsh-protected-'))
  try {
    assert.equal(protectedRootOf(temp), null)
    assert.equal(isAutomationOwned(temp), true)
    assert.equal(isAutomationOwned(join(temp, 'nested', 'file.txt')), true)
    assert.equal(protectedRootOf(join(REPOSITORY_ROOT, 'artifacts')), null)
    assert.equal(isAutomationOwned(join(REPOSITORY_ROOT, 'artifacts')), true)
    assertAutomationSafe(join(REPOSITORY_ROOT, 'artifacts'), '测试写入')
  } finally {
    rmSync(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
})

test('unknown territory outside repo and temp is refused too', () => {
  // C:\Windows is neither repo nor temp: automation must refuse it as well.
  assert.throws(() => assertAutomationSafe('C:\\Windows\\Temp\\x', '测试写入'), /安全边界拦截/u)
  assert.equal(isAutomationOwned('C:\\Windows\\Temp\\x'), false)
  assert.equal(protectedRootOf('C:\\Windows\\Temp\\x'), null)
  const temp = mkdtempSync(join(tmpdir(), 'dsh-safe-'))
  mkdirSync(join(temp, 'inner'))
  try {
    assert.equal(isAutomationOwned(join(temp, 'inner')), true)
  } finally {
    rmSync(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
})