import assert from 'node:assert/strict'
import test from 'node:test'

import { selectSmokePids } from '../scripts/kill-smoke-orphans.js'

test('smoke orphan detection matches markers only, never the real client', () => {
  const rows = [
    { pid: 1001, name: 'DeepSeek Harness Personal-Smoke.exe', commandLine: '"D:\\repo\\artifacts\\win-unpacked\\DeepSeek Harness Personal-Smoke.exe"' },
    { pid: 1002, name: 'DeepSeek Harness Personal.exe', commandLine: '"D:\\repo\\artifacts\\win-unpacked\\DeepSeek Harness Personal.exe" --type=renderer --user-data-dir="C:\\Users\\Cyrus\\AppData\\Local\\Temp\\dsh-desktop-smoke-abc"' },
    { pid: 1003, name: 'DeepSeek Harness Personal.exe', commandLine: '"D:\\Cyrus Deepseek Harness\\DeepSeek Harness Personal\\DeepSeek Harness Personal.exe" --user-data-dir="F:\\documents\\Cyrus Deepseek Harness Data"' },
    { pid: 1004, name: 'DeepSeek Harness Personal Dev-Smoke.exe', commandLine: '"D:\\repo\\artifacts-dev\\win-unpacked\\DeepSeek Harness Personal Dev-Smoke.exe"' },
    { pid: 1005, name: 'DeepSeek Harness Personal Dev.exe', commandLine: '"D:\\repo\\artifacts-dev\\win-unpacked\\DeepSeek Harness Personal Dev.exe"' },
    // Defense-in-depth: even a smoke marker must lose against a protected root.
    { pid: 1006, name: 'DeepSeek Harness Personal-Smoke.exe', commandLine: '"...-Smoke.exe" --user-data-dir="F:\\documents\\Cyrus Deepseek Harness Data"' },
    { pid: 'not-a-pid', name: 'DeepSeek Harness Personal-Smoke.exe', commandLine: '' },
  ]
  assert.deepEqual(selectSmokePids(rows), [1001, 1002, 1004])
  assert.ok(!selectSmokePids(rows).includes(1003), 'the real stable client is never selected')
  assert.ok(!selectSmokePids(rows).includes(1005), 'the real dev client is never selected')
  assert.deepEqual(selectSmokePids([]), [])
})