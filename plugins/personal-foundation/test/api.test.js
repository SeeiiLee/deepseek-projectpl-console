import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createPersonalRequestHandler } from '../src/index.ts'
import { PersonalStore } from '../src/store.ts'

test('private API exposes inventory while connection targets and secrets stay write-only', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-personal-api-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const values = new Map()
  const credentials = {
    async describe(reference) { return { configured: values.has(reference), writable: true } },
    async set(reference, value) { values.set(reference, value) },
    async unset(reference) { values.delete(reference) },
  }
  const runtime = {
    store: new PersonalStore(join(root, 'dsh', 'personal', 'personal-suite.json')),
    dshHome: join(root, 'dsh'),
    agentsHome: join(root, 'agents'),
    credentials,
    loader: {
      * entries() {
        yield { id: 'personal-theme', disabled: false, options: { name: '@cyrus/dsh-personal-theme' }, fiber: { state: 2 } }
      },
    },
    packageRequire() { throw new Error('manifest unavailable in isolated test') },
  }
  const server = createServer(createPersonalRequestHandler(runtime))
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  t.after(() => new Promise(resolve => { server.close(resolve) }))
  const address = server.address()
  assert.equal(typeof address, 'object')
  const origin = `http://127.0.0.1:${address.port}`

  const unauthorized = await fetch(`${origin}/__personal/api/theme`)
  assert.equal(unauthorized.status, 403)

  const plugins = await api(origin, 'GET', '/plugins')
  assert.equal(plugins.data.plugins[0].fiberPhase, 'active')
  assert.equal(plugins.data.plugins[0].category, '个人扩展')

  const endpoint = 'https://example.test/hook/private-hook-token'
  const secret = 'super-secret-value'
  const created = await api(origin, 'POST', '/connections', {
    label: '测试飞书', kind: 'feishu-bot', enabled: true, endpoint, secret,
  })
  const serialized = JSON.stringify(created)
  assert.ok(!serialized.includes('private-hook-token'))
  assert.ok(!serialized.includes(secret))
  assert.equal(created.data.endpointConfigured, true)
  assert.equal(created.data.secretConfigured, true)

  const listed = await api(origin, 'GET', '/connections')
  assert.equal(listed.data.connections.length, 1)
  assert.equal(listed.data.connections[0].endpointDisplay, '飞书 Webhook 已保存（不回显）')
  const id = listed.data.connections[0].id
  await api(origin, 'PUT', '/connections', { id, label: '重命名', enabled: false })
  assert.ok([...values.values()].includes(endpoint), 'blank update must preserve the stored endpoint')

  const persisted = await readFile(runtime.store.filename, 'utf8')
  assert.ok(!persisted.includes('private-hook-token'))
  assert.ok(!persisted.includes(secret))
  await api(origin, 'DELETE', '/connections', { id })
  assert.equal(values.size, 0)
})

async function api(origin, method, resource, body) {
  const response = await fetch(`${origin}/__personal/api${resource}`, {
    method,
    headers: {
      'x-dsh-personal-client': '1',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const payload = await response.json()
  assert.equal(payload.ok, true, JSON.stringify(payload))
  return payload
}
