import assert from 'node:assert/strict'
import test from 'node:test'

import { fetchProjectIndex, matchProjectRoot, ProjectIndex } from '../src/client/projectIndex.ts'
import { canonicalPath } from '../src/client/adapter.ts'

test('canonicalPath 归一化（与旧联动同规则）', () => {
  assert.equal(canonicalPath('C:/Work/'), 'c:\\work')
  assert.equal(canonicalPath('F:/QClawData/workspace/meal_tracker'), 'f:\\qclawdata\\workspace\\meal_tracker')
})

test('matchProjectRoot：相等/包含/最长根优先/分隔符边界', () => {
  const roots = [
    { projectId: 'prj_a', root: 'F:/QClawData/workspace/meal_tracker' },
    { projectId: 'prj_b', root: 'F:/QClawData/workspace' },
    { projectId: 'prj_c', root: 'C:/work' },
  ]
  assert.deepEqual(matchProjectRoot('F:/QClawData/workspace/meal_tracker', roots), { projectId: 'prj_a', root: 'F:/QClawData/workspace/meal_tracker' })
  // 最长根优先：meal_tracker 内部命中 prj_a 而非 prj_b
  assert.deepEqual(matchProjectRoot('F:/QClawData/workspace/meal_tracker/docs', roots), { projectId: 'prj_a', root: 'F:/QClawData/workspace/meal_tracker' })
  // 分隔符边界：meal_trackerX 不匹配 meal_tracker（但仍在 workspace 项目内 → 命中 prj_b）
  assert.equal(matchProjectRoot('F:/QClawData/workspace/meal_trackerX', roots)?.projectId, 'prj_b')
  assert.equal(matchProjectRoot('F:/QClawData/workspace/meal_trackerX', [roots[0]]), undefined)
  // 无命中
  assert.equal(matchProjectRoot('D:/other', roots), undefined)
  assert.equal(matchProjectRoot('', roots), undefined)
})

test('fetchProjectIndex 解析紧凑索引信封与 etag', async () => {
  const calls = []
  const fetchImpl = async () => {
    calls.push(1)
    return {
      status: 200,
      headers: new Headers({ etag: '"wsidx-v1"' }),
      json: async () => ({ ok: true, data: { projects: [
        { projectId: 'prj_1', root: 'F:/a', updatedAt: '2026-08-18T00:00:00.000Z' },
        { projectId: 'prj_2', root: 'F:/b', updatedAt: '2026-08-18T00:00:01.000Z' },
        { projectId: '', root: 'F:/bad', updatedAt: 'x' },
      ] } }),
    }
  }
  const result = await fetchProjectIndex(fetchImpl)
  assert.equal(result.projects.length, 2)
  assert.deepEqual(result.projects[0], { projectId: 'prj_1', root: 'F:/a', updatedAt: '2026-08-18T00:00:00.000Z' })
  assert.equal(result.etag, '"wsidx-v1"')
  assert.equal(calls.length, 1)
})

test('fetchProjectIndex 304 返回 null（未变化）', async () => {
  let status = 304
  let sentIfNoneMatch = undefined
  const fetchImpl = async (_url, init) => {
    sentIfNoneMatch = init?.headers?.['if-none-match']
    return { status, headers: new Headers(), json: async () => ({ ok: true, data: { projects: [] } }) }
  }
  const result = await fetchProjectIndex(fetchImpl, '"wsidx-v1"')
  assert.equal(result, null)
  assert.equal(sentIfNoneMatch, '"wsidx-v1"')
  status = 200
  const full = await fetchProjectIndex(fetchImpl)
  assert.notEqual(full, null)
})

test('fetchProjectIndex 拒绝非 ok 信封', async () => {
  const fetchImpl = async () => ({ json: async () => ({ ok: false }) })
  await assert.rejects(() => fetchProjectIndex(fetchImpl))
})

test('ProjectIndex ETag 条件刷新：304 零更新、指纹变化才更新', async () => {
  let etag = '"e1"'
  let projects = [{ projectId: 'prj_1', root: 'F:/a', updatedAt: 't1' }]
  const requests = []
  const fetchImpl = async (_url, init) => {
    requests.push(init?.headers?.['if-none-match'])
    if (init?.headers?.['if-none-match'] === etag) {
      return { status: 304, headers: new Headers(), json: async () => ({ ok: true, data: { projects: [] } }) }
    }
    return { status: 200, headers: new Headers({ etag }), json: async () => ({ ok: true, data: { projects } }) }
  }
  const index = new ProjectIndex(fetchImpl)
  await index.refresh()
  assert.equal(index.roots().length, 1)
  const ref = index.roots()
  // 第二次：带 etag → 304 → roots 引用与内容不变
  await index.refresh()
  assert.equal(index.roots(), ref)
  assert.equal(index.roots()[0].updatedAt, 't1')
  assert.deepEqual(requests, [undefined, '"e1"'])
  // 服务端变化 → 新 etag → 更新
  etag = '"e2"'
  projects = [{ projectId: 'prj_1', root: 'F:/a', updatedAt: 't2' }]
  await index.refresh()
  assert.equal(index.roots()[0].updatedAt, 't2')
  assert.equal(requests[2], '"e1"')
})

test('ProjectIndex 并发 refresh 共享同一次拉取', async () => {
  let fetches = 0
  const fetchImpl = async () => { fetches += 1; return { status: 200, headers: new Headers(), json: async () => ({ ok: true, data: { projects: [] } }) } }
  const index = new ProjectIndex(fetchImpl)
  await Promise.all([index.refresh(), index.refresh(), index.refresh()])
  assert.equal(fetches, 1)
})

test('ProjectIndex forceRefresh 强制重拉', async () => {
  let fetches = 0
  const fetchImpl = async () => { fetches += 1; return { status: 200, headers: new Headers(), json: async () => ({ ok: true, data: { projects: [] } }) } }
  const index = new ProjectIndex(fetchImpl)
  await index.refresh()
  await index.forceRefresh()
  assert.equal(fetches, 2)
})
