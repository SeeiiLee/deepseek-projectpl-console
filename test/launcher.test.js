import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import test from 'node:test'

test('the launch gate accepts the current tree and the pack scripts run it before Electron', () => {
  const gate = spawnSync(process.execPath, ['scripts/verify-launch.js'], {
    cwd: new URL('..', import.meta.url),
    encoding: 'utf8',
  })
  assert.equal(gate.status, 0, gate.stderr)
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.match(manifest.scripts['pack:win'], /pack-desktop\.js stable nsis portable/u)
  assert.match(manifest.scripts['pack:dev:portable'], /pack-desktop\.js dev portable/u)
  assert.match(manifest.scripts['stage:releases'], /stage-releases/u)
  assert.equal(manifest.scripts['sync:stable'], undefined, 'the retired directory-mode sync must not linger')
  assert.equal(manifest.scripts['sync:test'], undefined, 'the retired directory-mode sync must not linger')
})

test('the remaining launcher script stays pure ASCII with CRLF for the GBK console', () => {
  for (const name of ['../一键迁移数据到F盘.cmd', '../启动 DeepSeek Harness 开发版.cmd']) {
    const bytes = readFileSync(new URL(name, import.meta.url))
    assert.equal(bytes.some(byte => byte > 127), false, name + ' must be pure ASCII')
    const text = bytes.toString('latin1')
    assert.equal(text.includes('\r\n'), true, name + ' must use CRLF')
    assert.equal(/(?<!\r)\n/.test(text), false, name + ' must not contain bare LF')
  }
})
