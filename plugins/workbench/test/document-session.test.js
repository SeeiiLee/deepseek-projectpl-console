import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createWorkspaceResourceAdapter,
  DocumentSessionStore,
} from '../src/client/document-session.ts'

function openSession(store, id = 'tab-1', text = '第一行\n第二行\n', etag = 'sha256:v1') {
  return store.open(id, 'workspace:README.md', { text, etag })
}

test('open 建立 base 与 draft 一致、saved 状态、revision 1', () => {
  const store = new DocumentSessionStore()
  const session = openSession(store)
  assert.equal(session.documentId, 'tab-1')
  assert.equal(session.resourceKey, 'workspace:README.md')
  assert.equal(session.baseText, session.draftText)
  assert.equal(session.dirty, false)
  assert.equal(session.saveState, 'saved')
  assert.equal(session.revision, 1)
  assert.equal(session.baseEtag, 'sha256:v1')
})

test('编辑草稿：dirty、saveState idle、revision 递增；改回 base 恢复 clean', () => {
  const store = new DocumentSessionStore()
  openSession(store)
  const edited = store.updateDraft('tab-1', '第一行（改）\n第二行\n')
  assert.equal(edited.dirty, true)
  assert.equal(edited.saveState, 'idle')
  assert.equal(edited.revision, 2)
  const reverted = store.updateDraft('tab-1', '第一行\n第二行\n')
  assert.equal(reverted.dirty, false)
  assert.equal(reverted.saveState, 'saved')
})

test('保存成功：base 对齐 draft、dirty false、saved、新 etag', async () => {
  const store = new DocumentSessionStore()
  openSession(store)
  store.updateDraft('tab-1', '新内容\n')
  let written
  const adapter = {
    load: async () => { throw new Error('unused') },
    saveText: async (resourceKey, draftText, expectedEtag) => {
      written = { resourceKey, draftText, expectedEtag }
      return { etag: 'sha256:v2', byteSize: 4 }
    },
  }
  const saved = await store.save('tab-1', adapter)
  assert.deepEqual(written, { resourceKey: 'workspace:README.md', draftText: '新内容\n', expectedEtag: 'sha256:v1' })
  assert.equal(saved.dirty, false)
  assert.equal(saved.saveState, 'saved')
  assert.equal(saved.baseEtag, 'sha256:v2')
  assert.equal(saved.baseText, '新内容\n')
})

test('保存 409 冲突：saveState conflict + externalEtag 提示', async () => {
  const store = new DocumentSessionStore()
  openSession(store)
  store.updateDraft('tab-1', 'draft')
  const adapter = {
    load: async () => { throw new Error('unused') },
    saveText: async () => { throw new Error('FILE_CHANGED: 文件在你阅读后被修改，保存被拒绝。') },
  }
  const result = await store.save('tab-1', adapter)
  assert.equal(result.saveState, 'conflict')
  assert.match(result.errorMessage ?? '', /FILE_CHANGED/)
})

test('保存其他错误：saveState error 且草稿保留', async () => {
  const store = new DocumentSessionStore()
  openSession(store)
  store.updateDraft('tab-1', 'draft')
  const adapter = {
    load: async () => { throw new Error('unused') },
    saveText: async () => { throw new Error('磁盘已满') },
  }
  const result = await store.save('tab-1', adapter)
  assert.equal(result.saveState, 'error')
  assert.equal(result.draftText, 'draft')
})

test('clean 文档外部更新：自动 reload（保留编辑现场无冲突）', () => {
  const store = new DocumentSessionStore()
  openSession(store)
  const result = store.markExternalUpdate('tab-1', { externalEtag: 'sha256:v2', externalText: '外部新文本\n' })
  assert.deepEqual(result, { kind: 'reloaded' })
  const session = store.get('tab-1')
  assert.equal(session?.baseText, '外部新文本\n')
  assert.equal(session?.draftText, '外部新文本\n')
  assert.equal(session?.dirty, false)
  assert.equal(session?.saveState, 'saved')
})

test('dirty 文档外部更新：进入 conflict，externalEtag 记录', () => {
  const store = new DocumentSessionStore()
  openSession(store)
  store.updateDraft('tab-1', '我的草稿')
  const result = store.markExternalUpdate('tab-1', { externalEtag: 'sha256:v2', externalText: '外部文本' })
  assert.deepEqual(result, { kind: 'conflict' })
  const session = store.get('tab-1')
  assert.equal(session?.saveState, 'conflict')
  assert.equal(session?.externalEtag, 'sha256:v2')
  assert.equal(session?.externalText, '外部文本')
  assert.equal(session?.draftText, '我的草稿') // 草稿保留
})

test('冲突处理 keep-draft：回到 idle 可继续保存（外部版本保留在外）', () => {
  const store = new DocumentSessionStore()
  openSession(store)
  store.updateDraft('tab-1', '我的草稿')
  store.markExternalUpdate('tab-1', { externalEtag: 'sha256:v2', externalText: '外部' })
  const resolved = store.resolveConflict('tab-1', { kind: 'keep-draft' })
  assert.equal(resolved.saveState, 'idle')
  assert.equal(resolved.draftText, '我的草稿')
  assert.equal(resolved.externalEtag, undefined)
})

test('冲突处理 reload：直接用外部文本重载（三方比较后取外部版本），草稿丢弃', () => {
  const store = new DocumentSessionStore()
  openSession(store)
  store.updateDraft('tab-1', '我的草稿')
  store.markExternalUpdate('tab-1', { externalEtag: 'sha256:v2', externalText: '外部文本' })
  const reloaded = store.resolveConflict('tab-1', { kind: 'reload' })
  assert.equal(reloaded.draftText, '外部文本')
  assert.equal(reloaded.baseEtag, 'sha256:v2')
  assert.equal(reloaded.dirty, false)
  assert.equal(reloaded.saveState, 'saved')
  assert.equal(reloaded.externalText, undefined)
})

test('discardDraft 回到 base；selection/scroll 内存态存取；close 移除', () => {
  const store = new DocumentSessionStore()
  openSession(store)
  store.updateDraft('tab-1', '草稿')
  const reverted = store.discardDraft('tab-1')
  assert.equal(reverted.draftText, '第一行\n第二行\n')
  assert.equal(reverted.dirty, false)
  store.setSelection('tab-1', { anchor: 3, head: 5 })
  store.setScrollTop('tab-1', 120)
  const session = store.get('tab-1')
  assert.deepEqual(session?.selection, { anchor: 3, head: 5 })
  assert.equal(session?.scrollTop, 120)
  store.close('tab-1')
  assert.equal(store.has('tab-1'), false)
  assert.equal(store.get('tab-1'), undefined)
})

test('subscribe 收到每次提交通知；重复 open 视为重新加载并丢草稿', () => {
  const store = new DocumentSessionStore()
  openSession(store)
  let notified = 0
  store.subscribe(() => { notified += 1 })
  store.updateDraft('tab-1', 'x')
  assert.equal(notified, 1)
  const reopened = store.open('tab-1', 'workspace:README.md', { text: '重载版\n', etag: 'sha256:v9' })
  assert.equal(reopened.draftText, '重载版\n')
  assert.equal(reopened.dirty, false)
})

test('workspaceApi 适配：load 文本文件、save 传 expectedEtag', async () => {
  const calls = []
  const api = {
    file: async () => ({ kind: 'text', content: '内容\n', truncated: false, byteSize: 9, sha256: 'sha256:x' }),
    save: async (path, content, expectedSha256) => {
      calls.push({ path, content, expectedSha256 })
      return { path, sha256: 'sha256:y', byteSize: 3 }
    },
  }
  const adapter = createWorkspaceResourceAdapter(api)
  const loaded = await adapter.load('workspace:a.md')
  assert.equal(loaded.text, '内容\n')
  assert.equal(loaded.etag, 'sha256:x')
  const saved = await adapter.saveText('workspace:a.md', '新', 'sha256:x')
  assert.deepEqual(calls, [{ path: 'workspace:a.md', content: '新', expectedSha256: 'sha256:x' }])
  assert.equal(saved.etag, 'sha256:y')
})
