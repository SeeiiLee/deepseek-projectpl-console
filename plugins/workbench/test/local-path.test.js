import assert from 'node:assert/strict'
import test from 'node:test'

import {
  decodePath,
  isAbsoluteLocalPath,
  isRemoteImageSrc,
  resolveLocalPath,
} from '../src/client/desktopReveal.ts'
import { baseDirOfDocument } from '../src/client/local-doc-context.ts'

test('isAbsoluteLocalPath 识别盘符与 POSIX 根，拒绝相对路径与 UNC', () => {
  assert.equal(isAbsoluteLocalPath('D:/Docs/a.md'), true)
  assert.equal(isAbsoluteLocalPath('d:\\Docs\\a.md'), true)
  assert.equal(isAbsoluteLocalPath('/home/u/a.md'), true)
  assert.equal(isAbsoluteLocalPath('./docs/a.md'), false)
  assert.equal(isAbsoluteLocalPath('docs/a.md'), false)
  assert.equal(isAbsoluteLocalPath('//server/share/a.md'), false)
})

test('isRemoteImageSrc 只放行 http/blob/data', () => {
  assert.equal(isRemoteImageSrc('https://example.com/a.png'), true)
  assert.equal(isRemoteImageSrc('http://example.com/a.png'), true)
  assert.equal(isRemoteImageSrc('blob:https://app/123'), true)
  assert.equal(isRemoteImageSrc('data:image/png;base64,xx'), true)
  assert.equal(isRemoteImageSrc('D:/pics/a.png'), false)
  assert.equal(isRemoteImageSrc('./pics/a.png'), false)
})

test('decodePath 解码 %20，非法编码原样返回', () => {
  assert.equal(decodePath('D:/foo%20bar/a.md'), 'D:/foo bar/a.md')
  assert.equal(decodePath('%E4%B8%AD%E6%96%87.md'), '中文.md')
  assert.equal(decodePath('100%.md'), '100%.md')
})

test('resolveLocalPath 绝对路径归一化后直接返回', () => {
  assert.equal(resolveLocalPath('D:\\Docs\\a.md', undefined), 'D:/Docs/a.md')
  assert.equal(resolveLocalPath('D:/foo%20bar/a.md', undefined), 'D:/foo bar/a.md')
})

test('resolveLocalPath 相对路径按文档目录拼接并归一化', () => {
  const base = 'D:/workspace/project/docs'
  assert.equal(resolveLocalPath('./pics/a.png', base), 'D:/workspace/project/docs/pics/a.png')
  assert.equal(resolveLocalPath('../README.md', base), 'D:/workspace/project/README.md')
  assert.equal(resolveLocalPath('../../outside/x.md', base), 'D:/workspace/outside/x.md')
  assert.equal(resolveLocalPath('plain-name.md', base), 'D:/workspace/project/docs/plain-name.md')
  assert.equal(resolveLocalPath('./%E5%9B%BE%20%E7%89%87.png', base), 'D:/workspace/project/docs/图 片.png')
})

test('resolveLocalPath 无 baseDir 时返回解码后的原样（不静默吞掉）', () => {
  assert.equal(resolveLocalPath('./pics/a.png', undefined), 'pics/a.png')
  assert.equal(resolveLocalPath('./pics/a.png', ''), 'pics/a.png')
})

test('resolveLocalPath 的 .. 不越过根', () => {
  assert.equal(resolveLocalPath('../../x.md', 'D:/docs'), 'D:/x.md')
  assert.equal(resolveLocalPath('../../../x.md', 'D:/docs'), 'D:/x.md')
})

test('resolveLocalPath 还原 file:/// URL（Typora 等工具写出的形式）', () => {
  assert.equal(resolveLocalPath('file:///F:/picture/%E6%89%8B%E6%9C%BA/a.jpg', undefined), 'F:/picture/手机/a.jpg')
  assert.equal(resolveLocalPath('file:///F:/picture/a.jpg', undefined), 'F:/picture/a.jpg')
  assert.equal(resolveLocalPath('file:///home/u/a.png', undefined), '/home/u/a.png')
  // file:// 与反斜杠混合编码（F:%5Cpicture%5C… 被当成 file 还原前就先解码归一）
  assert.equal(resolveLocalPath('F:%5Cpicture%5C%E5%A3%81%E7%BA%B8%5Ca.jpg', undefined), 'F:/picture/壁纸/a.jpg')
  // file:/// 相对形式叠加 baseDir 时仍按绝对路径处理
  assert.equal(resolveLocalPath('file:///D:/docs/a.md', 'C:/ws'), 'D:/docs/a.md')
})

test('baseDirOfDocument 由工作区根与相对路径推目录', () => {
  assert.equal(baseDirOfDocument('D:\\ws\\proj', 'docs/子 目录/a.md'), 'D:/ws/proj/docs/子 目录')
  assert.equal(baseDirOfDocument('D:/ws/proj/', 'a.md'), 'D:/ws/proj')
  assert.equal(baseDirOfDocument(undefined, 'docs/a.md'), undefined)
  assert.equal(baseDirOfDocument('D:/ws/proj', null), undefined)
  assert.equal(baseDirOfDocument('', 'docs/a.md'), undefined)
})
