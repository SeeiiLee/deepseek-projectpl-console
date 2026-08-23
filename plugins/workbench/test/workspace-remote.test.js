import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  createWorkspaceRequestHandler,
  MAX_TEXT_BYTES,
  WORKSPACE_API_PREFIX,
} from '../src/workspace-remote.ts'
import { diffLines } from '../src/client/workspace-diff.ts'
import { extractOutline } from '../src/client/outline.ts'

function makeRoot() {
  const root = mkdtempSync(join(tmpdir(), 'dsh-workspace-remote-'))
  mkdirSync(join(root, 'docs'))
  writeFileSync(join(root, 'README.md'), '# 标题\n\n第一段。\n\n## 小节\n- 项目 A\n', 'utf8')
  writeFileSync(join(root, 'notes.txt'), 'alpha\nbeta\ngamma\n', 'utf8')
  writeFileSync(join(root, 'secret.json'), JSON.stringify({ hidden: true }), 'utf8')
  writeFileSync(join(root, 'image.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00]))
  return root
}

async function serve(root) {
  const server = createServer(createWorkspaceRequestHandler(root))
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  assert.equal(typeof address, 'object')
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () => new Promise(resolve => { server.close(resolve) }),
  }
}

async function api(origin, resource, init = {}) {
  const response = await fetch(`${origin}${WORKSPACE_API_PREFIX}${resource}`, {
    ...init,
    headers: { 'x-dsh-personal-workspace': '1', ...init.headers },
  })
  return { response, payload: await response.json() }
}

test('W1：显式 root 参数提供按会话根的只读访问（过渡方案）', async t => {
  const root = makeRoot()
  t.after(() => { rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }) })
  const other = mkdtempSync(join(tmpdir(), 'dsh-workspace-remote-other-'))
  writeFileSync(join(other, 'other.txt'), 'other-root\n', 'utf8')
  t.after(() => { rmSync(other, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }) })
  const { origin, close } = await serve(root)
  t.after(() => { void close() })

  // 默认根读不到 other 的内容；显式 root 读到
  const forbidden = await api(origin, '/file?path=other.txt')
  assert.equal(forbidden.response.status, 404)
  const viaRoot = await api(origin, '/file?path=other.txt&root=' + encodeURIComponent(other))
  assert.equal(viaRoot.response.status, 200)
  assert.match(viaRoot.payload.data.content, /other-root/)

  // status 反映显式根
  const status = await api(origin, '/status?root=' + encodeURIComponent(other))
  assert.match(status.payload.data.workspaceRoot, /dsh-workspace-remote-other-/u)

  // 不存在的根 → 400
  const missing = await api(origin, '/tree?path=&root=' + encodeURIComponent('C:\\no-such-root-dir'))
  assert.equal(missing.response.status, 400)
  assert.equal(missing.payload.error.code, 'ROOT_INVALID')

  // containment 仍基于显式根（越界拒绝）
  const escape = await api(origin, '/file?path=..%2F..%2F..%2FWindows%2Fwin.ini&root=' + encodeURIComponent(other))
  assert.equal(escape.response.status, 403)
})

test('serves status, bounded trees and text/binary reads', async t => {
  const root = makeRoot()
  t.after(() => { rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }) })
  const { origin, close } = await serve(root)
  t.after(() => { void close() })

  const unauthorized = await fetch(`${origin}${WORKSPACE_API_PREFIX}/status`)
  assert.equal(unauthorized.status, 403)

  const status = await api(origin, '/status')
  assert.equal(status.response.status, 200)
  // Windows may expand 8.3 names differently across realpath callers; the
  // served root must at least resolve to the same leaf directory.
  assert.match(status.payload.data.workspaceRoot, /dsh-workspace-remote-[A-Za-z0-9]+$/u)

  const tree = await api(origin, '/tree?path=')
  assert.equal(tree.response.status, 200)
  const names = tree.payload.data.entries.map(entry => entry.name)
  assert.deepEqual(names, ['docs', 'image.png', 'notes.txt', 'README.md', 'secret.json'])

  const docs = await api(origin, '/tree?path=docs')
  assert.equal(docs.payload.data.entries.length, 0)

  const readme = await api(origin, '/file?path=README.md')
  assert.equal(readme.payload.data.kind, 'text')
  assert.match(readme.payload.data.content, /^# 标题/u)
  assert.equal(readme.payload.data.truncated, false)
  assert.match(readme.payload.data.sha256, /^sha256:[0-9a-f]{64}$/u)

  const png = await api(origin, '/file?path=image.png')
  assert.equal(png.payload.data.kind, 'binary')
  assert.equal(png.payload.data.mime, 'image/png')

  const missing = await api(origin, '/file?path=nope.md')
  assert.equal(missing.response.status, 404)
  assert.equal(missing.payload.error.code, 'NOT_A_FILE')
})

test('rejects traversal, symlink escapes and oversized writes', async t => {
  const root = makeRoot()
  t.after(() => { rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }) })
  const { origin, close } = await serve(root)
  t.after(() => { void close() })

  const traversal = await api(origin, '/tree?path=' + encodeURIComponent('..'))
  assert.equal(traversal.response.status, 403)
  assert.equal(traversal.payload.error.code, 'PATH_OUTSIDE_WORKSPACE')

  const absolute = await api(origin, '/file?path=' + encodeURIComponent('C:/Windows/win.ini'))
  assert.equal(absolute.response.status, 403)

  const huge = await api(origin, '/save', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path: 'huge.txt', content: 'x'.repeat(MAX_TEXT_BYTES + 1) }),
  })
  assert.equal(huge.response.status, 400)
  assert.equal(huge.payload.error.code, 'INVALID_BODY')
})

test('saves text with optimistic concurrency and refuses stale writes', async t => {
  const root = makeRoot()
  t.after(() => { rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }) })
  const { origin, close } = await serve(root)
  t.after(() => { void close() })

  const before = await api(origin, '/file?path=notes.txt')
  const saved = await api(origin, '/save', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path: 'notes.txt', content: 'updated\n', expectedSha256: before.payload.data.sha256 }),
  })
  assert.equal(saved.response.status, 200)
  assert.match(saved.payload.data.sha256, /^sha256:/u)

  const stale = await api(origin, '/save', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path: 'notes.txt', content: 'conflict\n', expectedSha256: before.payload.data.sha256 }),
  })
  assert.equal(stale.response.status, 409)
  assert.equal(stale.payload.error.code, 'FILE_CHANGED')

  const after = await api(origin, '/file?path=notes.txt')
  assert.equal(after.payload.data.content, 'updated\n')
})

test('diffLines and extractOutline are deterministic', () => {
  const diff = diffLines(['a', 'b', 'c'], ['a', 'x', 'c', 'd'])
  assert.deepEqual(diff, [
    { kind: 'same', text: 'a' },
    { kind: 'removed', text: 'b' },
    { kind: 'added', text: 'x' },
    { kind: 'same', text: 'c' },
    { kind: 'added', text: 'd' },
  ])
  assert.deepEqual(diffLines(['a', 'b'], ['a', 'c']), [
    { kind: 'same', text: 'a' },
    { kind: 'removed', text: 'b' },
    { kind: 'added', text: 'c' },
  ])
  const outline = extractOutline('# 一\ntext\n## 二\n### 三')
  assert.deepEqual(outline, [
    { level: 1, text: '一', line: 1, kind: 'heading' },
    { level: 2, text: '二', line: 3, kind: 'heading' },
    { level: 3, text: '三', line: 4, kind: 'heading' },
  ])
})