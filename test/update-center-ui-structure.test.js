import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

test('update center only shows prepare button when available plugins exist and pending state is visible', () => {
  const source = readFileSync(new URL('../plugins/update-center/src/client/UpdateCenterSection.tsx', import.meta.url), 'utf8')
  const availableCondition = 'state.pluginChannel?.available !== undefined && state.pluginChannel.available.length > 0'
  const button = '下载并准备插件更新'
  assert.ok(source.includes(availableCondition), 'prepare button must be gated by available.length > 0')
  assert.ok(source.includes(button), 'prepare button text must exist')
  assert.ok(
    source.indexOf(button) > source.indexOf(availableCondition),
    'prepare button must be inside the available.length > 0 conditional',
  )
  assert.ok(source.includes('state.pluginChannel?.message'), 'plugin channel message must be rendered')
  assert.ok(source.includes('pendingVersion'), 'pendingVersion state must be rendered')
  assert.ok(source.includes('重启后激活'), 'pending ready copy must be present')
})
