import assert from 'node:assert/strict'
import test from 'node:test'

import { normalizeBrowserUrl, isLoopbackHost, browserTabTitle } from '../src/client/browser-url.ts'
import { embeddabilityOf, extractFrameAncestors, xfoBlocks, frameAncestorsBlock } from '../src/browser-probe.ts'
import { extractOutline, extractMarkdownHeadings, extractCodeSymbols } from '../src/client/outline.ts'
import { diffLines, buildHunks, isWorkspaceDiffResourceKey } from '../src/client/workspace-diff.ts'
import { WorkbenchViewerRegistry } from '../src/client/viewers.ts'

test('browser-url: 只允许 http(s)，拒绝 loopback 与自身源', () => {
  assert.equal(normalizeBrowserUrl('https://example.com/a').kind, 'ok')
  assert.equal(normalizeBrowserUrl('http://example.com').kind, 'ok')
  assert.equal(normalizeBrowserUrl('ftp://example.com').kind, 'blocked')
  assert.equal(normalizeBrowserUrl('javascript:alert(1)').kind, 'blocked')
  // 裸域名/裸主机自动补 https://；loopback 依旧拦截（补全后判定）
  assert.equal(normalizeBrowserUrl('localhost').kind, 'blocked')
  assert.equal(normalizeBrowserUrl('localhost:3000').kind, 'blocked')
  assert.equal(normalizeBrowserUrl('https://localhost/x').kind, 'blocked')
  assert.equal(normalizeBrowserUrl('https://127.0.0.1/x').kind, 'blocked')
  assert.equal(normalizeBrowserUrl('https://example.com/x', 'https://example.com').kind, 'blocked')
  assert.equal(isLoopbackHost('::1'), true)
  assert.equal(isLoopbackHost('192.168.1.1'), false)
  assert.equal(browserTabTitle('https://example.com/a'), 'example.com')
})

test('browser-url: 裸域名自动补 https://', () => {
  assert.deepEqual(normalizeBrowserUrl('www.moonshot.cn'), { kind: 'ok', url: 'https://www.moonshot.cn/' })
  assert.deepEqual(normalizeBrowserUrl('example.com/a b'), { kind: 'invalid' })
  // 误输入的前导斜杠也能归一化（WHATWG URL 容忍特殊 scheme 的多余斜杠）
  assert.deepEqual(normalizeBrowserUrl('/www.google.com'), { kind: 'ok', url: 'https://www.google.com/' })
  const withPath = normalizeBrowserUrl('example.com/docs?q=1')
  assert.equal(withPath.kind, 'ok')
  if (withPath.kind === 'ok') assert.equal(withPath.url, 'https://example.com/docs?q=1')
  // 带 scheme 的非 http(s) 不补全、不降级拦截
  assert.equal(normalizeBrowserUrl('ftp://example.com').kind, 'blocked')
})

test('browser-probe: X-Frame-Options / frame-ancestors 判定', () => {
  assert.equal(xfoBlocks('DENY'), true)
  assert.equal(xfoBlocks('SAMEORIGIN'), true)
  assert.equal(xfoBlocks(null), false)
  assert.deepEqual(extractFrameAncestors('default-src \'self\'; frame-ancestors https://a.example https://b.example'), ['https://a.example', 'https://b.example'])
  assert.equal(frameAncestorsBlock('frame-ancestors *'), false)
  assert.equal(frameAncestorsBlock('frame-ancestors none'), true)
  assert.equal(frameAncestorsBlock(null), false)
  assert.equal(embeddabilityOf({ status: 200, xFrameOptions: 'DENY' }), 'blocked')
  assert.equal(embeddabilityOf({ status: 200, contentSecurityPolicy: 'frame-ancestors none' }), 'blocked')
  assert.equal(embeddabilityOf({ status: 200 }), 'ok')
  assert.equal(embeddabilityOf({}), 'unknown')
})

test('outline: Markdown 跳过围栏，代码文件提取符号', () => {
  const md = '# 标题\n```js\n# 这不是标题\n```\n## 二级\n'
  assert.deepEqual(extractMarkdownHeadings(md), [
    { level: 1, text: '标题', line: 1, kind: 'heading' },
    { level: 2, text: '二级', line: 5, kind: 'heading' },
  ])
  const code = 'export class Foo {}\nfunction bar() {}\n  method() {}\nconst x = 1\n'
  const symbols = extractCodeSymbols(code)
  assert.ok(symbols.some(s => s.kind === 'class' && s.text === 'Foo' && s.level === 1))
  assert.ok(symbols.some(s => s.kind === 'function' && s.text === 'bar' && s.level === 1))
  assert.ok(symbols.some(s => s.kind === 'method' && s.text === 'method' && s.level === 2))
  assert.ok(symbols.some(s => s.kind === 'variable' && s.text === 'x' && s.level === 1))
  assert.equal(extractOutline('# a\n', 'x.py').length, 0)
  assert.equal(extractOutline('def f():\n  pass\n', 'x.py').some(s => s.kind === 'function' && s.text === 'f'), true)
})

test('workspace-diff: Myers diff + hunk 行号 + resourceKey 校验', () => {
  const lines = diffLines(['a', 'b', 'c'], ['a', 'x', 'c', 'd'])
  assert.deepEqual(lines, [
    { kind: 'same', text: 'a' },
    { kind: 'removed', text: 'b' },
    { kind: 'added', text: 'x' },
    { kind: 'same', text: 'c' },
    { kind: 'added', text: 'd' },
  ])
  const hunks = buildHunks(lines, 1)
  assert.ok(hunks.length >= 1)
  assert.ok(hunks[0].oldStart >= 1)
  assert.ok(hunks[0].newStart >= 1)
  assert.equal(isWorkspaceDiffResourceKey('workspace-diff:a|b'), true)
  // R-UX：裸前缀（落地两步选择器）与仅左文件（中间态）同为合法 resourceKey
  assert.equal(isWorkspaceDiffResourceKey('workspace-diff:'), true)
  assert.equal(isWorkspaceDiffResourceKey('workspace-diff:a'), true)
  assert.equal(isWorkspaceDiffResourceKey('workspace-diff:|b'), false)
  assert.equal(isWorkspaceDiffResourceKey('workspace-diff:a|'), false)
  assert.equal(isWorkspaceDiffResourceKey('workspace-diff:   '), false)
  assert.equal(isWorkspaceDiffResourceKey('other:a|b'), false)
})

test('viewers.matchViewer: priority/exts/catch-all 匹配', () => {
  const registry = new WorkbenchViewerRegistry()
  registry.register({
    id: 'test.markdown',
    family: 'preview',
    title: 'Markdown',
    exts: ['md', 'markdown'],
    priority: 10,
    canRestore: () => true,
  })
  registry.register({
    id: 'test.code',
    family: 'preview',
    title: 'Code',
    exts: [],
    priority: -100,
    canRestore: () => true,
  })
  assert.equal(registry.matchViewer('a.md')?.id, 'test.markdown')
  assert.equal(registry.matchViewer('a.txt')?.id, 'test.code')
  assert.equal(registry.matchViewer('noext')?.id, 'test.code')
})
