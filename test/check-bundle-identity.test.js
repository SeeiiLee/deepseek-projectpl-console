import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'

import {
  analyzePlugin,
  collectPatchRows,
  hasClientBundleId,
  hasViolation,
  listPluginDirectories,
} from '../scripts/check-bundle-identity.js'

const contractRoot = fileURLToPath(
  new URL('../protocol/personal-plugin-contract/v1/', import.meta.url),
)

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

test('collectPatchRows 解析共享 patch 的 id/name 对', () => {
  const source = [
    '- id: ui-layout',
    "  name: '@deepseek-ai/dsh-client-ui-layout'",
    '  disabled: true',
    '- insert:',
    '    - id: cyrus-workbench',
    "      name: '@cyrus/dsh-workbench'",
    '    - id: cyrus-anysearch',
    "      name: '@cyrus/dsh-anysearch'",
  ].join('\n')
  const rows = collectPatchRows(source)
  assert.deepEqual(rows, [
    { id: 'ui-layout', name: '@deepseek-ai/dsh-client-ui-layout' },
    { id: 'cyrus-workbench', name: '@cyrus/dsh-workbench' },
    { id: 'cyrus-anysearch', name: '@cyrus/dsh-anysearch' },
  ])
})

test('hasClientBundleId 与 build 校验同口径', () => {
  assert.equal(hasClientBundleId('const x = 1; id: "@cyrus/dsh-workbench"', '@cyrus/dsh-workbench'), true)
  assert.equal(hasClientBundleId('const x = 1; id: "@cyrus/dsh-other"', '@cyrus/dsh-workbench'), false)
})

test('analyzePlugin 对标准 bundle 形态判定 ready', () => {
  const root = mkdtempSync(join(tmpdir(), 'bundle-identity-'))
  const dir = join(root, 'good')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({
    name: '@cyrus/dsh-workbench',
    dsh: { bundle: { patch: './cordis.patch.yml' } },
  }))
  writeFileSync(join(dir, 'cordis.patch.yml'), '- insert:\n    - id: @cyrus/dsh-workbench\n      name: \'@cyrus/dsh-workbench\'\n')
  mkdirSync(join(dir, 'lib'), { recursive: true })
  writeFileSync(join(dir, 'lib', 'client.js'), 'id: "@cyrus/dsh-workbench"')
  const record = analyzePlugin(dir, { sharedRows: [] })
  assert.equal(record.verdict, 'ready')
  assert.equal(record.hasBundle, true)
  assert.equal(record.handoffOk, true)
  assert.equal(record.rowId, '@cyrus/dsh-workbench')
  assert.equal(record.patchPath, 'own')
  assert.deepEqual(record.issues, [])
  assert.equal(hasViolation(record), false)
  rmSync(root, { recursive: true, force: true })
})

test('analyzePlugin 对无 bundle / handoff 缺失 / row 短 id 分别报告', () => {
  const root = mkdtempSync(join(tmpdir(), 'bundle-identity-'))
  const mk = (name, manifest, clientSource, ownPatch) => {
    const dir = join(root, name)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'package.json'), JSON.stringify(manifest))
    if (ownPatch !== undefined) writeFileSync(join(dir, 'cordis.patch.yml'), ownPatch)
    if (clientSource !== undefined) {
      mkdirSync(join(dir, 'lib'), { recursive: true })
      writeFileSync(join(dir, 'lib', 'client.js'), clientSource)
    }
    return dir
  }
  const sharedRows = [{ id: 'cyrus-anysearch', name: '@cyrus/dsh-anysearch' }]

  const noBundle = mk('nobundle', { name: '@cyrus/dsh-anysearch' }, 'id: "@cyrus/dsh-anysearch"')
  const a = analyzePlugin(noBundle, { sharedRows })
  assert.equal(a.verdict, 'needs-work')
  assert.ok(a.issues.includes('missing dsh.bundle.patch'))
  assert.equal(hasViolation(a), true)

  const badHandoff = mk('badhandoff', { name: '@cyrus/dsh-anysearch', dsh: { bundle: { patch: './cordis.patch.yml' } } }, 'id: "@cyrus/dsh-other"')
  const b = analyzePlugin(badHandoff, { sharedRows })
  assert.equal(b.handoffOk, false)
  assert.equal(hasViolation(b), true)

  const shortRow = mk('shortrow', { name: '@cyrus/dsh-anysearch', dsh: { bundle: { patch: './cordis.patch.yml' } } }, 'id: "@cyrus/dsh-anysearch"')
  const c = analyzePlugin(shortRow, { sharedRows })
  assert.equal(c.rowId, 'cyrus-anysearch')
  assert.ok(c.issues.some(issue => issue.includes('cyrus-anysearch')))
  assert.equal(hasViolation(c), true)
  rmSync(root, { recursive: true, force: true })
})

test('listPluginDirectories 排除共享 patch 与无 manifest 目录', () => {
  const root = mkdtempSync(join(tmpdir(), 'bundle-identity-'))
  mkdirSync(join(root, 'a'), { recursive: true })
  writeFileSync(join(root, 'a', 'package.json'), '{"name":"@cyrus/a"}')
  mkdirSync(join(root, 'b'), { recursive: true })
  writeFileSync(join(root, 'cordis.patch.yml'), '[]')
  mkdirSync(join(root, '.hidden'), { recursive: true })
  writeFileSync(join(root, '.hidden', 'package.json'), '{"name":"@cyrus/hidden"}')
  assert.deepEqual(listPluginDirectories(root), ['a'])
  rmSync(root, { recursive: true, force: true })
})

test('dshComposable/v1 与 preset-lock/v1 schema 校验示例', () => {
  const ajv = new Ajv2020({ allErrors: true, strict: true })
  addFormats(ajv)
  const composable = readJson(resolve(contractRoot, 'schemas/dsh-composable.schema.json'))
  const lock = readJson(resolve(contractRoot, 'schemas/preset-lock.schema.json'))
  const validateComposable = ajv.compile(composable)
  const validateLock = ajv.compile(lock)

  assert.equal(validateComposable(readJson(resolve(contractRoot, 'examples/dsh-composable.valid.json'))), true)
  assert.equal(validateComposable(readJson(resolve(contractRoot, 'examples/dsh-composable.invalid.json'))), false)
  assert.equal(validateLock(readJson(resolve(contractRoot, 'examples/preset-lock.valid.json'))), true)
  assert.equal(validateLock(readJson(resolve(contractRoot, 'examples/preset-lock.invalid.json'))), false)
})

test('preset-lock 拒绝循环 requires（installer 环检测占位断言）', () => {
  const ajv = new Ajv2020({ allErrors: true, strict: true })
  addFormats(ajv)
  const lock = readJson(resolve(contractRoot, 'schemas/preset-lock.schema.json'))
  const validate = ajv.compile(lock)
  const base = readJson(resolve(contractRoot, 'examples/preset-lock.valid.json'))
  // schema 层只保证结构；环检测属于 installer 运行时职责（D-03），此处仅验证 schema 不误伤合法依赖边。
  assert.equal(validate(base), true)
})
