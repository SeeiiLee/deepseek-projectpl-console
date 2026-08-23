import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { createRequire } from 'node:module'

import { inspectTarball, safeExtractTarball, scanExtractedDirectory } from '../src/plugin-archive-security.js'
import { nextTag, resolveTag, validateStaging, writeReleaseFiles } from '../scripts/release-plugins.mjs'

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const readJson = path => JSON.parse(readFileSync(resolve(repoRoot, path), 'utf8'))
const require = createRequire(import.meta.url)
const tar = require('../vendor/pnpm/dist/node_modules/tar')

test('plugin-index/v1 schema 接受合法 fixture、拒绝非法 fixture', () => {
  const ajv = new Ajv2020({ allErrors: true, strict: true })
  addFormats(ajv)
  const validate = ajv.compile(readJson('protocol/plugin-index/v1/schemas/plugin-index.schema.json'))
  assert.equal(validate(readJson('protocol/plugin-index/v1/examples/plugin-index.valid.json')), true)
  assert.equal(validate(readJson('protocol/plugin-index/v1/examples/plugin-index.invalid.json')), false)
})

test('inspectTarball 读取合法 tgz 文件清单', async () => {
  const root = mkdtempSync(join(tmpdir(), 'a2-tar-'))
  try {
    mkdirSync(join(root, 'src'), { recursive: true })
    writeFileSync(join(root, 'src', 'index.js'), 'export const ok = true\n')
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'x', version: '1.0.0' }))
    const tgz = join(root, 'x.tgz')
    await tar.c({ gzip: true, cwd: root, file: tgz }, ['package.json', 'src/index.js'])
    const result = await inspectTarball(tgz)
    assert.equal(result.ok, true)
    assert.ok(result.files.includes('package.json'))
    assert.ok(result.files.includes('src/index.js'))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('safeExtractTarball 解包到目标目录', async () => {
  const root = mkdtempSync(join(tmpdir(), 'a2-extract-'))
  try {
    mkdirSync(join(root, 'src'), { recursive: true })
    writeFileSync(join(root, 'src', 'index.js'), 'export const ok = true\n')
    const tgz = join(root, 'x.tgz')
    await tar.c({ gzip: true, cwd: root, file: tgz }, ['src/index.js'])
    const dest = join(root, 'out')
    mkdirSync(dest, { recursive: true })
    await safeExtractTarball(tgz, dest)
    assert.equal(readFileSync(join(dest, 'src', 'index.js'), 'utf8'), 'export const ok = true\n')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('scanExtractedDirectory 拒绝个人路径/密钥', async () => {
  const root = mkdtempSync(join(tmpdir(), 'a2-scan-'))
  try {
    writeFileSync(join(root, 'bad.txt'), 'token: ghp_123456789012345678901234567890123456\n')
    const result = scanExtractedDirectory(root)
    assert.equal(result.ok, false)
    assert.ok(result.issues.some(issue => issue.includes('GitHub classic PAT')))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }

test('nextTag 递增 plugins-v 日期序号', () => {
  assert.equal(nextTag('plugins-v2026.08.24.1'), 'plugins-v2026.08.24.2')
  assert.equal(nextTag('plugins-v2026.08.24.9'), 'plugins-v2026.08.24.10')
})

test('resolveTag 跳过已存在 tag 并选择下一序号', () => {
  const existing = new Set(['plugins-v2026.08.24.1', 'plugins-v2026.08.24.2'])
  const tag = resolveTag(existing, undefined, new Date(2026, 7, 24, 12, 0, 0))
  assert.equal(tag, 'plugins-v2026.08.24.3')
  assert.equal(resolveTag(existing, 'plugins-v2026.08.24.9', new Date(2026, 7, 24, 12, 0, 0)), 'plugins-v2026.08.24.9')
})

test('writeReleaseFiles + validateStaging 接受公开产物（localFixture=false, minClient=0.4.3）', () => {
  const root = mkdtempSync(join(tmpdir(), 'a2-staging-'))
  try {
    const tag = 'plugins-v2026.08.24.1'
    const minClient = '0.4.3'
    const assets = [
      { assetName: 'cyrus-dsh-anysearch-0.1.0-beta.tgz', data: 'anysearch' },
      { assetName: 'cyrus-dsh-trajectory-island-0.1.0.tgz', data: 'trajectory' },
    ]
    const indexPlugins = assets.map((asset, index) => {
      const packageName = index === 0 ? '@cyrus/dsh-anysearch' : '@cyrus/dsh-trajectory-island'
      const sha256 = createHash('sha256').update(asset.data).digest('hex')
      writeFileSync(join(root, asset.assetName), asset.data)
      writeFileSync(join(root, `${asset.assetName}.sha256`), `${sha256} *${asset.assetName}\n`)
      return {
        packageName,
        version: index === 0 ? '0.1.0-beta' : '0.1.0',
        assetName: asset.assetName,
        assetSize: asset.data.length,
        sha256,
        minClient,
        compatibleHarness: { versionRange: '0.1.1-rc.2', commits: ['b150a551b8d465e31e418e1b2eaf5e79bbb7d28e'] },
        seams: [],
        requires: [],
        dataSchema: { owned: false, readableVersions: [], migrations: [], rollbackCompatible: true },
        modelAssets: [],
        externalEligible: true,
      }
    })
    writeReleaseFiles(root, tag, minClient, indexPlugins, false)
    validateStaging(root, tag, minClient, { publicOnly: true })
    const manifest = readJson(join(root, 'release-manifest.json'))
    assert.equal(manifest.localFixture, false)
    assert.equal(manifest.minClient, '0.4.3')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('validateStaging publicOnly 拒绝 localFixture=true', () => {
  const root = mkdtempSync(join(tmpdir(), 'a2-staging-bad-'))
  try {
    const tag = 'plugins-v2026.08.24.1'
    const minClient = '0.4.3'
    const assets = [
      { assetName: 'cyrus-dsh-anysearch-0.1.0-beta.tgz', data: 'anysearch', packageName: '@cyrus/dsh-anysearch', version: '0.1.0-beta' },
      { assetName: 'cyrus-dsh-trajectory-island-0.1.0.tgz', data: 'trajectory', packageName: '@cyrus/dsh-trajectory-island', version: '0.1.0' },
    ]
    const indexPlugins = assets.map(asset => {
      const sha256 = createHash('sha256').update(asset.data).digest('hex')
      writeFileSync(join(root, asset.assetName), asset.data)
      writeFileSync(join(root, `${asset.assetName}.sha256`), `${sha256} *${asset.assetName}\n`)
      return {
        packageName: asset.packageName,
        version: asset.version,
        assetName: asset.assetName,
        assetSize: asset.data.length,
        sha256,
        minClient,
        compatibleHarness: { versionRange: '0.1.1-rc.2', commits: ['b150a551b8d465e31e418e1b2eaf5e79bbb7d28e'] },
        seams: [],
        requires: [],
        dataSchema: { owned: false, readableVersions: [], migrations: [], rollbackCompatible: true },
        modelAssets: [],
        externalEligible: true,
      }
    })
    writeReleaseFiles(root, tag, minClient, indexPlugins, true)
    assert.throws(() => validateStaging(root, tag, minClient, { publicOnly: true }), /localFixture=true/u)
    // local fixture 模式允许 localFixture=true
    validateStaging(root, tag, minClient)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

})
