import assert from 'node:assert/strict'
import test from 'node:test'

import {
  classifyWorkspaceLink,
  installMarkdownOpenPathInterception,
  isMarkdownPath,
  planAdhocMarkdownOpen,
  planMarkdownOpen,
  relativeInside,
} from '../src/client/open-in-workbench.ts'

test('classifyWorkspaceLink：锚点/mailto 放行，http(s) 走外链，本地链接接管，其余不干预', () => {
  assert.equal(classifyWorkspaceLink('#脚注', false), 'passthrough')
  assert.equal(classifyWorkspaceLink('mailto:a@b.c', false), 'passthrough')
  assert.equal(classifyWorkspaceLink('MAILTO:a@b.c', false), 'passthrough')
  assert.equal(classifyWorkspaceLink('https://example.com/x', false), 'external')
  assert.equal(classifyWorkspaceLink('http://example.com', false), 'external')
  assert.equal(classifyWorkspaceLink('HTTPS://example.com', false), 'external')
  // 非本地链接的其它协议不接管（保持宿主默认行为）
  assert.equal(classifyWorkspaceLink('ftp://example.com/f', false), 'ignore')
  assert.equal(classifyWorkspaceLink('./docs/a.md', false), 'ignore')
  // 渲染产物标记的本地文件链接才走本地分流（.md 内开由后续逻辑判定）
  assert.equal(classifyWorkspaceLink('./docs/a.md', true), 'local')
  assert.equal(classifyWorkspaceLink('D:/ws/b.txt', true), 'local')
})

test('isMarkdownPath 只认 md/markdown/mdx（大小写不敏感）', () => {
  assert.equal(isMarkdownPath('D:/docs/a.md'), true)
  assert.equal(isMarkdownPath('D:/docs/a.MD'), true)
  assert.equal(isMarkdownPath('/home/u/指南.markdown'), true)
  assert.equal(isMarkdownPath('D:/docs/component.mdx'), true)
  assert.equal(isMarkdownPath('D:/docs/a.txt'), false)
  assert.equal(isMarkdownPath('D:/docs/md'), false)
  assert.equal(isMarkdownPath('D:/docs/a.md.bak'), false)
})

test('relativeInside 归一化斜杠并做大小写不敏感前缀判定', () => {
  assert.equal(relativeInside('D:\\ws\\proj\\docs\\a.md', 'D:/ws/proj'), 'docs/a.md')
  assert.equal(relativeInside('d:/WS/proj/docs/a.md', 'D:/ws/Proj/'), 'docs/a.md')
  assert.equal(relativeInside('D:/ws/proj2/a.md', 'D:/ws/proj'), undefined)
  assert.equal(relativeInside('D:/other/a.md', 'D:/ws/proj'), undefined)
  assert.equal(relativeInside('D:/ws/proj', 'D:/ws/proj'), undefined)
  assert.equal(relativeInside('D:/ws/proj/a.md', ''), undefined)
})

test('planMarkdownOpen 与查看器解析规则同序：项目绑定优先且不降级', () => {
  const snapshot = {
    projectWorkspace: { projectId: 'p1', root: 'D:/proj' },
    context: { primaryPath: 'D:/session' },
  }
  assert.deepEqual(
    planMarkdownOpen('D:/proj/docs/a.md', snapshot, 'D:/ambient'),
    { rel: 'docs/a.md', name: 'a.md', root: 'D:/proj', projectId: 'p1' },
  )
  // 项目根外直接否决，不降级到 context/ambient（查看器同样不会降级）
  assert.equal(planMarkdownOpen('D:/session/b.md', snapshot, 'D:/ambient'), undefined)
  assert.equal(planMarkdownOpen('D:/ambient/c.md', snapshot, 'D:/ambient'), undefined)
})

test('planMarkdownOpen 无项目绑定时走 Hub 浏览目标，再退环境默认根', () => {
  const followed = { context: { primaryPath: 'D:/session ws' } }
  assert.deepEqual(
    planMarkdownOpen('D:/session ws/docs/指 南.md', followed, 'D:/ambient'),
    { rel: 'docs/指 南.md', name: '指 南.md', root: 'D:/session ws' },
  )
  // context 命中但未包含时不许退到 ambient
  assert.equal(planMarkdownOpen('D:/ambient/c.md', followed, 'D:/ambient'), undefined)
  const bare = {}
  assert.deepEqual(
    planMarkdownOpen('D:/ambient/README.md', bare, 'D:/ambient'),
    { rel: 'README.md', name: 'README.md', root: 'D:/ambient' },
  )
  assert.equal(planMarkdownOpen('D:/elsewhere/a.md', bare, 'D:/ambient'), undefined)
  // 非 Markdown 直接否决
  assert.equal(planMarkdownOpen('D:/ambient/a.txt', bare, 'D:/ambient'), undefined)
})

test('planAdhocMarkdownOpen：根外 .md 以文件所在目录为显式根兜底', () => {
  // 反斜杠路径归一化；中文与空格文件名保留
  assert.deepEqual(
    planAdhocMarkdownOpen('F:\\documents\\CyrusNotes\\CyrusNote\\About Me--李思熠Cyrus.md'),
    { rel: 'About Me--李思熠Cyrus.md', name: 'About Me--李思熠Cyrus.md', root: 'F:/documents/CyrusNotes/CyrusNote' },
  )
  // 盘符根补尾斜杠（'F:/x.md' → root 'F:/'，避免 resolve 退化成盘符当前目录）
  assert.deepEqual(
    planAdhocMarkdownOpen('F:/README.md'),
    { rel: 'README.md', name: 'README.md', root: 'F:/' },
  )
  // POSIX 绝对路径
  assert.deepEqual(
    planAdhocMarkdownOpen('/home/u/notes/a.markdown'),
    { rel: 'a.markdown', name: 'a.markdown', root: '/home/u/notes' },
  )
  // 非 Markdown / 无目录分量直接否决
  assert.equal(planAdhocMarkdownOpen('D:/docs/a.txt'), undefined)
  assert.equal(planAdhocMarkdownOpen('README.md'), undefined)
  assert.equal(planAdhocMarkdownOpen('/a.md'), undefined)
})

test('openPath 补丁：.md 命中走 tryOpen，其余放行原方法；清理后还原', async () => {
  const calls = []
  class FakeWorkspaces {
    async openPath(path) { calls.push(path) }
  }
  const svc = new FakeWorkspaces()
  const tried = []
  const dispose = installMarkdownOpenPathInterception(svc, async path => {
    tried.push(path)
    return path.endsWith('in.md')
  })

  await svc.openPath('D:/ws/docs/in.md')
  assert.deepEqual(tried, ['D:/ws/docs/in.md'])
  assert.deepEqual(calls, [], '命中的 .md 不得再调系统打开')

  await svc.openPath('D:/ws/docs/out.md')
  assert.deepEqual(calls, ['D:/ws/docs/out.md'], '未命中的 .md 回落系统打开')

  await svc.openPath('D:/ws/app.exe')
  assert.deepEqual(calls.at(-1), 'D:/ws/app.exe')
  assert.equal(tried.length, 3, 'tryOpen 内部自负 .md 过滤；补丁不预判')
  assert.equal(calls.filter(path => path.endsWith('.md')).length, 1, '只有未命中的 .md 回落系统打开')

  dispose()
  assert.equal(Object.hasOwn(svc, 'openPath'), false, '清理必须摘除实例补丁（原型方法重现）')
  assert.equal(Object.hasOwn(svc, '__wbMarkdownOpenPathPatched'), false)
  await svc.openPath('D:/ws/docs/after.md')
  assert.deepEqual(calls.at(-1), 'D:/ws/docs/after.md', '还原后走原型方法')
})

test('openPath 补丁幂等：重复安装返回 no-op，不叠加', async () => {
  const calls = []
  const svc = { openPath: async path => { calls.push(path) } }
  const first = installMarkdownOpenPathInterception(svc, async () => true)
  const second = installMarkdownOpenPathInterception(svc, async () => false)
  await svc.openPath('D:/ws/a.md')
  assert.deepEqual(calls, [], '第二层补丁不得生效（第一层 tryOpen 已命中）')
  second()
  first()
  await svc.openPath('D:/ws/b.md')
  assert.deepEqual(calls, ['D:/ws/b.md'])
})

test('openPath 补丁：tryOpen 抛错回落原方法', async () => {
  const calls = []
  const svc = { openPath: async path => { calls.push(path) } }
  const dispose = installMarkdownOpenPathInterception(svc, async () => { throw new Error('boom') })
  await svc.openPath('D:/ws/a.md')
  assert.deepEqual(calls, ['D:/ws/a.md'])
  dispose()
})
