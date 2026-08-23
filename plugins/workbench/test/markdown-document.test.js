import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import {
  contentHashOf,
  headingIdentity,
  headingsFromSource,
  hasRemoteImageHint,
  normalizeHeadingText,
} from '../src/client/markdown-heading.ts'

const fixturesDir = fileURLToPath(new URL('./fixtures/markdown/', import.meta.url))

test('normalizeHeadingText 去空白并压缩连续空白', () => {
  assert.equal(normalizeHeadingText('  标题  内容  '), '标题 内容')
  assert.equal(normalizeHeadingText('Title'), 'Title')
})

test('contentHashOf 稳定且区分内容', () => {
  assert.equal(contentHashOf('abc'), contentHashOf('abc'))
  assert.notEqual(contentHashOf('abc'), contentHashOf('abd'))
  assert.match(contentHashOf('abc'), /^[0-9a-f]{8}$/)
})

test('headingIdentity = hash + ordinal + normalized text（§8.9.3）', () => {
  const hash = contentHashOf('a')
  assert.equal(headingIdentity('A', 0, hash), hash + ':0:A')
  assert.equal(headingIdentity('A', 0, hash), headingIdentity(' A ', 0, hash))
  assert.notEqual(headingIdentity('A', 0, hash), headingIdentity('A', 1, hash))
  assert.notEqual(headingIdentity('A', 0, hash), headingIdentity('B', 0, hash))
})

test('headingsFromSource 附带 ordinal 与身份', () => {
  const text = '# 一\n## 二\n### 三'
  const headings = headingsFromSource(text)
  assert.equal(headings.length, 3)
  assert.deepEqual(headings.map(h => h.ordinal), [0, 1, 2])
  assert.equal(headings[0].level, 1)
  assert.equal(headings[2].text, '三')
  assert.equal(headings[1].identity, contentHashOf(text) + ':1:二')
})

test('hasRemoteImageHint 只认 http(s) Markdown 图片（提示用途）', () => {
  assert.equal(hasRemoteImageHint('![a](https://example.com/x.png)'), true)
  assert.equal(hasRemoteImageHint('![a](http://example.com/x.png)'), true)
  assert.equal(hasRemoteImageHint('![a](./local.png)'), false)
  assert.equal(hasRemoteImageHint('![a](file:///C:/x.png)'), false)
  assert.equal(hasRemoteImageHint('普通文本 [链接](https://example.com) 无图片'), false)
  assert.equal(hasRemoteImageHint(''), false)
})

test('R-PV fixture 集齐全（§8.9.5：中英/GFM/嵌套/脚注/公式/长代码/危险/Unicode 路径）', () => {
  const expected = [
    'zh-en-mixed.md',
    'gfm-table-tasks.md',
    'nested-lists-footnotes.md',
    'math-formulas.md',
    'long-code.md',
    'raw-html-dangerous.md',
    'unicode-paths.md',
  ]
  for (const name of expected) {
    assert.equal(existsSync(fixturesDir + name), true, name + ' 缺失')
    assert.ok(readFileSync(fixturesDir + name, 'utf8').length > 50, name + ' 过短')
  }
  const actual = readdirSync(fixturesDir).sort()
  assert.deepEqual(actual, expected.sort())
})

test('危险 fixture 可被平台安全渲染（结构面：文档组件不自行执行 HTML）', () => {
  const doc = readFileSync(fileURLToPath(new URL('../src/client/WorkspaceMarkdownDocument.tsx', import.meta.url)), 'utf8')
  assert.doesNotMatch(doc, /dangerouslySetInnerHTML/)
  assert.doesNotMatch(doc, /rehype-raw|react-markdown/)
  assert.match(doc, /MarkdownText/)
})
