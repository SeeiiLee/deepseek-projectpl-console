import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { createRequire } from 'node:module'

import { inspectTarball, safeExtractTarball, scanExtractedDirectory } from '../src/plugin-archive-security.js'

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
})
