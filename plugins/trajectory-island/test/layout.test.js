import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const css = readFileSync(new URL('../src/client/SessionMinimap.module.css', import.meta.url), 'utf8')
const component = readFileSync(new URL('../src/client/SessionMinimap.tsx', import.meta.url), 'utf8')

test('renders a slim vertical rail pinned to the conversation right edge', () => {
  assert.match(css, /\.rail\s*\{[\s\S]*?position:\s*fixed/)
  assert.match(css, /\.rail\s*\{[\s\S]*?width:\s*14px/)
  assert.match(css, /\.track\s*\{[\s\S]*?flex-direction:\s*column/)
  // 刻度群以中轴为中心向上下发散（轮次少时聚在正中），不许铺满整条轨道。
  assert.match(css, /\.track\s*\{[\s\S]*?justify-content:\s*center/)
  assert.doesNotMatch(css, /justify-content:\s*space-between/)
  assert.match(component, /data-session-minimap/)
  assert.match(component, /\[data-conversation-scroll\]/)
  assert.match(component, /aria-label="会话导航轨"/)
  // 旧的顶部横条轨迹岛不许回来：不再水平居中、不再顶部胶囊。
  assert.doesNotMatch(css, /translateX\(-50%\)/)
})

test('distinguishes user/assistant ticks, running/error states and active position', () => {
  assert.match(css, /\.tick\[data-kind='user'\] i/)
  assert.match(css, /\.tick\[data-status='running'\] i/)
  assert.match(css, /\.tick\[data-status='error'\] i/)
  assert.match(css, /\.tick\[data-active='true'\] i/)
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)/)
})
