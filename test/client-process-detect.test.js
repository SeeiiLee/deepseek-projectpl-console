import assert from 'node:assert/strict'
import test from 'node:test'

import { findRunningClientPids } from '../scripts/client-process-detect.js'

test('detects the real client processes and never the probe or agent hosts', () => {
  const rows = [
    { pid: 101, name: 'electron.exe', commandLine: '"D:\\Deepseek Harness Personal\\node_modules\\electron\\dist\\electron.exe" "runtime-stable"' },
    { pid: 102, name: 'electron.exe', commandLine: 'electron.exe --type=renderer --user-data-dir="C:\\Users\\Administrator\\AppData\\Roaming\\DeepSeek Harness Personal"' },
    { pid: 103, name: 'DeepSeek Harness Personal Dev.exe', commandLine: 'C:\\Temp\\abc\\DeepSeek Harness Personal Dev.exe' },
    { pid: 104, name: 'DeepSeek Harness Personal.exe', commandLine: 'D:\\Cyrus Deepseek Harness\\DeepSeek Harness Personal.exe' },
    { pid: 105, name: 'electron.exe', commandLine: '"C:\\other\\electron.exe" --user-data-dir="C:\\Users\\Administrator\\AppData\\Roaming\\Some App"' },
    { pid: 106, name: 'node.exe', commandLine: 'node.exe --import tsx "D:\\Deepseek Harness Personal\\src\\something.js"' },
    { pid: 107, name: 'powershell.exe', commandLine: 'powershell.exe -Command "Get-CimInstance ... DeepSeek Harness Personal ..."' },
    { pid: 'bad', name: 'electron.exe', commandLine: 'electron.exe "runtime-stable"' },
  ]
  assert.deepEqual(findRunningClientPids(rows), [101, 102, 103, 104])
})

test('excludes the caller own process so an electron-as-node host never self-matches', () => {
  const rows = [
    { pid: 26004, name: 'electron.exe', commandLine: '"D:\\Deepseek Harness Personal\\node_modules\\electron\\dist\\electron.exe" "scripts\\migrate-to-fdrive.js"' },
    { pid: 26005, name: 'electron.exe', commandLine: '"D:\\Deepseek Harness Personal\\node_modules\\electron\\dist\\electron.exe" "runtime-stable"' },
  ]
  assert.deepEqual(findRunningClientPids(rows, { excludePids: [26004, 26000] }), [26005])
  assert.deepEqual(findRunningClientPids(rows, { excludePids: [] }), [26004, 26005])
})

test('handles degenerate input safely', () => {
  assert.deepEqual(findRunningClientPids(null), [])
  assert.deepEqual(findRunningClientPids([]), [])
  assert.deepEqual(findRunningClientPids([null, 42, 'electron.exe']), [])
  assert.deepEqual(findRunningClientPids([{ pid: 7, name: 'electron.exe', commandLine: '' }]), [])
})
