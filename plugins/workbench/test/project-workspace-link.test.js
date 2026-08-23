import assert from 'node:assert/strict'
import test from 'node:test'
import {
  canonicalPath,
  installProjectWorkspaceLink,
  matchProjectRoot,
} from '../src/client/projectWorkspaceLink.ts'

function store(initial, listeners) {
  let snapshot = initial
  return {
    getSnapshot: () => snapshot,
    set(next) {
      snapshot = next
      for (const listener of [...listeners]) listener()
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }
}

function fixture(seed = {}) {
  const sessionsListeners = new Set()
  const workspacesListeners = new Set()
  const sessions = store(seed.sessions ?? { current: undefined, byId: {} }, sessionsListeners)
  const workspaces = store(seed.workspaces ?? { items: [] }, workspacesListeners)
  const calls = []
  let binding = seed.binding
  const workbench = {
    getSnapshot: () => ({ ...(binding === undefined ? {} : { projectWorkspace: binding }) }),
    setProjectWorkspace(projectId, root) {
      calls.push(['set', projectId, root])
      binding = { projectId, root }
    },
    clearProjectWorkspace() {
      calls.push(['clear'])
      binding = undefined
    },
  }
  const requests = []
  const fetchImpl = async (url) => {
    requests.push(String(url))
    if (url.endsWith('/projects')) {
      return { json: async () => ({ ok: true, data: { projects: seed.projects ?? [] } }) }
    }
    const projectId = decodeURIComponent(String(url).split('/projects/')[1]?.split('/workspace/')[0] ?? '')
    const root = seed.roots?.[projectId]
    if (root === undefined) {
      return { json: async () => ({ ok: false, error: { code: 'MISSING' } }) }
    }
    return { json: async () => ({ ok: true, data: { projectId, root } }) }
  }
  const dispose = installProjectWorkspaceLink({ sessions: { list: sessions }, workspaces: { list: workspaces }, workbench, fetchImpl })
  return {
    sessions, workspaces, workbench, calls, requests, dispose,
    setSession(current, cwd, items = []) {
      sessions.set({ current, byId: { ...(current === undefined ? {} : { [current]: { cwd } }) } })
      workspaces.set({ items })
    },
  }
}

const mealRoot = 'F:\\QClawData\\workspace\\meal_tracker'
const quantRoot = 'F:\\QClawData\\workspace\\quant'

function mealProjects() {
  return [
    { projectId: 'prj_meal', name: '食溯', updatedAt: '2026-08-17T00:00:00Z' },
    { projectId: 'prj_quant', name: '量化', updatedAt: '2026-08-17T00:00:00Z' },
  ]
}

const mealRoots = { prj_meal: mealRoot, prj_quant: quantRoot }

test('canonicalPath 大小写不敏感、去尾分隔符、统一反斜杠', () => {
  assert.equal(canonicalPath('F:\\QClawData\\workspace\\meal_tracker'), 'f:\\qclawdata\\workspace\\meal_tracker')
  assert.equal(canonicalPath('F:/QClawData/workspace/meal_tracker/'), 'f:\\qclawdata\\workspace\\meal_tracker')
  assert.equal(canonicalPath('F:\\WORKSPACE\\\\'), 'f:\\workspace')
})

test('matchProjectRoot 精确匹配与最长前缀优先', () => {
  const roots = [
    { projectId: 'prj_parent', root: 'F:\\QClawData\\workspace' },
    { projectId: 'prj_meal', root: mealRoot },
  ]
  assert.deepEqual(matchProjectRoot(mealRoot, roots), { projectId: 'prj_meal', root: mealRoot })
  // 子目录属于项目（最长前缀）
  assert.deepEqual(matchProjectRoot(mealRoot + '\\docs', roots), { projectId: 'prj_meal', root: mealRoot })
  // 大小写不敏感 + 尾分隔符
  assert.deepEqual(matchProjectRoot('f:\\qclawdata\\workspace\\meal_tracker\\', roots), { projectId: 'prj_meal', root: mealRoot })
})

test('matchProjectRoot 分隔符边界：同名前缀不算命中', () => {
  const roots = [{ projectId: 'prj_x', root: 'D:\\projects\\app' }]
  assert.equal(matchProjectRoot('D:\\projects\\application', roots), undefined)
  assert.equal(matchProjectRoot('D:\\projects', roots), undefined)
  assert.deepEqual(matchProjectRoot('D:\\projects\\app\\src', roots), { projectId: 'prj_x', root: 'D:\\projects\\app' })
})

test('matchProjectRoot 空路径与空根不命中', () => {
  assert.equal(matchProjectRoot('', [{ projectId: 'p', root: 'D:\\x' }]), undefined)
  assert.equal(matchProjectRoot('  ', [{ projectId: 'p', root: 'D:\\x' }]), undefined)
  assert.equal(matchProjectRoot('D:\\x', [{ projectId: 'p', root: '' }]), undefined)
})

test('切到项目会话 → setProjectWorkspace；切到非项目会话 → clear', async () => {
  const f = fixture({ projects: mealProjects(), roots: mealRoots })
  f.setSession('s-meal', mealRoot)
  await new Promise(resolve => setTimeout(resolve, 10))
  assert.deepEqual(f.calls.at(-1), ['set', 'prj_meal', mealRoot])
  f.setSession('s-other', 'D:\\nowhere')
  await new Promise(resolve => setTimeout(resolve, 10))
  assert.deepEqual(f.calls.at(-1), ['clear'])
  f.dispose()
})

test('无当前会话 → 清空绑定；空白会话用 cwd 匹配', async () => {
  const f = fixture({ projects: mealProjects(), roots: mealRoots })
  f.setSession(undefined, undefined)
  await new Promise(resolve => setTimeout(resolve, 10))
  assert.deepEqual(f.calls.at(-1), ['clear'])
  // 空白会话仍在项目中：使用 cwd（无 workspace 成员关系时）
  f.setSession('s-blank', mealRoot, [])
  await new Promise(resolve => setTimeout(resolve, 10))
  assert.deepEqual(f.calls.at(-1), ['set', 'prj_meal', mealRoot])
  f.dispose()
})

test('workspace 成员关系优先于 cwd', async () => {
  const f = fixture({ projects: mealProjects(), roots: mealRoots })
  f.setSession('s1', 'D:\\stale-cwd', [
    { workspaceId: 'ws1', path: quantRoot, sessionIds: ['s1'] },
  ])
  await new Promise(resolve => setTimeout(resolve, 10))
  assert.deepEqual(f.calls.at(-1), ['set', 'prj_quant', quantRoot])
  f.dispose()
})

test('项目列表拉取失败 → 保持现有绑定不动', async () => {
  const f = fixture({ binding: { projectId: 'prj_meal', root: mealRoot } })
  f.setSession('s1', mealRoot)
  // 无 projects 字段 → fetch 会失败吗？projects 缺省返回 []；改用 fetch 抛错分支
  f.dispose()
  const g = fixture({ binding: { projectId: 'prj_meal', root: mealRoot }, projects: mealProjects(), roots: mealRoots })
  const failingFetch = async () => { throw new Error('network down') }
  const listenersS = new Set()
  const sessions2 = store({ current: 's1', byId: { s1: { cwd: mealRoot } } }, listenersS)
  const workspaces2 = store({ items: [] }, new Set())
  const workbench2 = {
    getSnapshot: () => ({ projectWorkspace: { projectId: 'prj_meal', root: mealRoot } }),
    setProjectWorkspace() {},
    clearProjectWorkspace() {},
  }
  const calls2 = []
  workbench2.setProjectWorkspace = (...args) => { calls2.push(['set', ...args]) }
  workbench2.clearProjectWorkspace = () => { calls2.push(['clear']) }
  installProjectWorkspaceLink({ sessions: { list: sessions2 }, workspaces: { list: workspaces2 }, workbench: workbench2, fetchImpl: failingFetch })
  await new Promise(resolve => setTimeout(resolve, 10))
  assert.deepEqual(calls2, [])
  g.dispose()
})

test('updatedAt 未变时复用缓存，不再请求 workspace/status', async () => {
  const f = fixture({ projects: mealProjects(), roots: mealRoots })
  f.setSession('s-meal', mealRoot)
  await new Promise(resolve => setTimeout(resolve, 10))
  const statusRequestsAfterFirst = f.requests.filter(url => url.includes('/workspace/status'))
  assert.equal(statusRequestsAfterFirst.length, 2)
  // 再次切走再切回：/projects 重新拉，status 命中缓存不再请求
  f.setSession('s-other', 'D:\\nowhere')
  await new Promise(resolve => setTimeout(resolve, 10))
  f.setSession('s-meal', mealRoot)
  await new Promise(resolve => setTimeout(resolve, 10))
  const statusRequestsAfterSecond = f.requests.filter(url => url.includes('/workspace/status'))
  assert.equal(statusRequestsAfterSecond.length, 2)
  f.dispose()
})

test('项目更新 updatedAt 后重新拉取该项目的根', async () => {
  const f = fixture({ projects: mealProjects(), roots: mealRoots })
  f.setSession('s-meal', mealRoot)
  await new Promise(resolve => setTimeout(resolve, 10))
  // 食溯项目根迁移 + updatedAt 变化
  const moved = 'G:\\migrated\\meal_tracker'
  const fetchImpl2 = async (url) => {
    f.requests.push(String(url))
    if (url.endsWith('/projects')) {
      return {
        json: async () => ({ ok: true, data: { projects: [
          { projectId: 'prj_meal', updatedAt: '2026-08-17T06:00:00Z' },
          { projectId: 'prj_quant', updatedAt: '2026-08-17T00:00:00Z' },
        ] } }),
      }
    }
    const projectId = decodeURIComponent(String(url).split('/projects/')[1]?.split('/workspace/')[0] ?? '')
    const root = projectId === 'prj_meal' ? moved : mealRoots[projectId]
    return { json: async () => ({ ok: true, data: { projectId, root } }) }
  }
  const listenersS = new Set()
  const sessions2 = store({ current: 's-meal', byId: { 's-meal': { cwd: mealRoot } } }, listenersS)
  const workspaces2 = store({ items: [] }, new Set())
  const snapshot2 = { projectWorkspace: { projectId: 'prj_meal', root: mealRoot } }
  const workbench2 = {
    getSnapshot: () => snapshot2,
    setProjectWorkspace(projectId, root) { this.last = ['set', projectId, root] },
    clearProjectWorkspace() { this.last = ['clear'] },
  }
  installProjectWorkspaceLink({ sessions: { list: sessions2 }, workspaces: { list: workspaces2 }, workbench: workbench2, fetchImpl: fetchImpl2 })
  // 切换会话触发重算（新地址不匹配 → 先 clear，随后匹配新根）
  sessions2.set({ current: 's-moved', byId: { 's-moved': { cwd: moved } } })
  await new Promise(resolve => setTimeout(resolve, 10))
  assert.deepEqual(workbench2.last, ['set', 'prj_meal', moved])
  f.dispose()
})

test('拉取期间控制台改写绑定 → 本次联动结果放弃（last-write-wins）', async () => {
  const f = fixture({ projects: mealProjects(), roots: mealRoots })
  const listenersS = new Set()
  const sessions2 = store({ current: undefined, byId: {} }, listenersS)
  const workspaces2 = store({ items: [] }, new Set())
  let binding
  let resolveList
  const gate = new Promise(resolve => { resolveList = resolve })
  const workbench2 = {
    getSnapshot: () => ({ ...(binding === undefined ? {} : { projectWorkspace: binding }) }),
    setProjectWorkspace(projectId, root) { binding = { projectId, root } },
    clearProjectWorkspace() { binding = undefined },
  }
  const fetchImpl2 = async (url) => {
    if (url.endsWith('/projects')) {
      await gate
      return { json: async () => ({ ok: true, data: { projects: mealProjects() } }) }
    }
    const projectId = decodeURIComponent(String(url).split('/projects/')[1]?.split('/workspace/')[0] ?? '')
    return { json: async () => ({ ok: true, data: { projectId, root: mealRoots[projectId] } }) }
  }
  installProjectWorkspaceLink({ sessions: { list: sessions2 }, workspaces: { list: workspaces2 }, workbench: workbench2, fetchImpl: fetchImpl2 })
  sessions2.set({ current: 's-meal', byId: { 's-meal': { cwd: mealRoot } } })
  // 拉取期间控制台打开另一个项目（改写绑定）
  workbench2.setProjectWorkspace('prj_quant', quantRoot)
  resolveList()
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.deepEqual(binding, { projectId: 'prj_quant', root: quantRoot })
  f.dispose()
})

test('dispose 后 store 变化不再触发联动', async () => {
  const f = fixture({ projects: mealProjects(), roots: mealRoots })
  f.setSession('s-meal', mealRoot)
  await new Promise(resolve => setTimeout(resolve, 10))
  const before = f.calls.length
  f.dispose()
  f.setSession('s-other', 'D:\\nowhere')
  await new Promise(resolve => setTimeout(resolve, 10))
  assert.equal(f.calls.length, before)
})
