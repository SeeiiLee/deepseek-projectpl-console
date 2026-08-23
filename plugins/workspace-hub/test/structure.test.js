import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const client = readFileSync(new URL('../src/client/index.ts', import.meta.url), 'utf8')
const host = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8')
const reducer = readFileSync(new URL('../src/client/reducer.ts', import.meta.url), 'utf8')

test('声明 bundle 形态与 rc.2 合同', () => {
  assert.equal(manifest.name, '@cyrus/dsh-workspace-hub')
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(manifest.dshComposable.role, 'core')
  assert.deepEqual(manifest.dshComposable.supports.harness, ['0.1.1-rc.2'])
  assert.deepEqual(manifest.peerDependencies['@deepseek-ai/dsh-client-runtime'], '0.1.1-rc.2')
  assert.equal(manifest.private, undefined)
})

test('Client 只注入 sessions/workspaces，无 UI/数据库写', () => {
  assert.match(client, /export const inject = \['sessions', 'workspaces'\]/)
  assert.doesNotMatch(client, /slots\.inject/)
  assert.doesNotMatch(client, /fetch\s*\(|readFile|writeFile|indexedDB|localStorage/)
  assert.match(client, /reflect\.provide\('workspaceHub', service\)/)
})

test('Hub 不 value-import Workbench（只读 reflect 观察；Hub 缺失不影响旧联动）', () => {
  assert.doesNotMatch(client, /from '@cyrus\/dsh-workbench'/)
  assert.doesNotMatch(client, /from '@cyrus\/dsh-project-control'/)
  assert.match(client, /reflect\.get\('workbench', false\)/)
})

test('Host W0 骨架无资源能力', () => {
  assert.match(host, /inject: readonly string\[\] = \[\]/)
  assert.doesNotMatch(host, /webServer|fetch|readFile|writeFile/)
})

test('reducer 冻结三种模式与稳定状态', () => {
  assert.match(reducer, /'follow-session'/)
  assert.match(reducer, /'follow-console'/)
  assert.match(reducer, /'pinned'/)
  assert.match(reducer, /'unbound'/)
  assert.match(reducer, /'missing'/)
  assert.match(reducer, /'ready'/)
})

test('ships Host and Client bundle artifacts', async () => {
  for (const file of ['../lib/index.js', '../lib/client.js', '../lib/client.js.map']) {
    assert.equal(existsSync(new URL(file, import.meta.url)), true, file + ' is missing')
  }
  const hostBundle = readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8')
  assert.match(hostBundle, /workspace-hub/)
  const clientBundle = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  assert.match(clientBundle, /@cyrus\/dsh-workspace-hub/)
  assert.match(clientBundle, /workspaceHub/)
})
