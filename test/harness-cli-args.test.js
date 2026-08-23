import assert from 'node:assert/strict'
import test from 'node:test'
import { supportsNoOpen, webProfileArgs } from '../src/harness-cli-args.js'
import { pickNodeExecutableCandidate } from '../src/harness-process.js'

const rcVersionReader = version => () => JSON.stringify({ version })

test('supportsNoOpen: rc.5/rc.7 不支持，rc.8+ 与正式版支持', () => {
  assert.equal(supportsNoOpen('/fake', rcVersionReader('0.1.0-rc.5')), false)
  assert.equal(supportsNoOpen('/fake', rcVersionReader('0.1.0-rc.7')), false)
  assert.equal(supportsNoOpen('/fake', rcVersionReader('0.1.0-rc.8')), true)
  assert.equal(supportsNoOpen('/fake', rcVersionReader('0.1.0-rc.9')), true)
  assert.equal(supportsNoOpen('/fake', rcVersionReader('0.1.0')), true)
  assert.equal(supportsNoOpen('/fake', rcVersionReader('0.2.0')), true)
})

test('supportsNoOpen: 读不到版本按老版本处理（不传新参数，保证能启动）', () => {
  assert.equal(supportsNoOpen('/nonexistent-root'), false)
  assert.equal(supportsNoOpen('/fake', () => 'not json'), false)
  assert.equal(supportsNoOpen('/fake', () => JSON.stringify({})), true)
})

test('webProfileArgs: 老运行时不带 --no-open，新运行时带', () => {
  assert.deepEqual(webProfileArgs('/nonexistent-root', '0'), ['--host', '127.0.0.1', '--port', '0'])
})

test('pickNodeExecutableCandidate: 跳过 .cmd/.bat/.ps1 shim（spawn 无 shell 会 EINVAL）', () => {
  const output = 'D:\\shim\\bin\\node.cmd\r\nC:\\Program Files\\nodejs\\node.exe\r\n'
  assert.equal(pickNodeExecutableCandidate(output), 'C:\\Program Files\\nodejs\\node.exe')
  assert.equal(pickNodeExecutableCandidate('node.bat\n'), undefined)
  assert.equal(pickNodeExecutableCandidate('node.EXE\n'), 'node.EXE')
  assert.equal(pickNodeExecutableCandidate(''), undefined)
  assert.equal(pickNodeExecutableCandidate(undefined), undefined)
})
