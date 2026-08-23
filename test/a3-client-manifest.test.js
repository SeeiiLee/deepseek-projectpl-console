import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { parsePluginsVTag, validateClientReleaseManifest } from '../src/client-release-manifest.js'

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const readJson = path => JSON.parse(readFileSync(resolve(repoRoot, path), 'utf8'))

test('client-release-manifest/v1 schema 接受合法 fixture、拒绝非法 fixture', () => {
  assert.equal(validateClientReleaseManifest(readJson('protocol/client-release-manifest/v1/examples/client-release-manifest.valid.json')).ok, true)
  assert.equal(validateClientReleaseManifest(readJson('protocol/client-release-manifest/v1/examples/client-release-manifest.invalid.json')).ok, false)
})

test('installerSha256 不匹配时 fail closed', () => {
  const valid = readJson('protocol/client-release-manifest/v1/examples/client-release-manifest.valid.json')
  assert.equal(validateClientReleaseManifest(valid, { installerSha256: 'c'.repeat(64) }).ok, false)
})

test('parsePluginsVTag 只识别 plugins-v 四段日期标签', () => {
  assert.deepEqual(parsePluginsVTag('plugins-v2026.08.21.1'), { tag: 'plugins-v2026.08.21.1', year: 2026, month: 8, day: 21, sequence: 1 })
  assert.equal(parsePluginsVTag('v0.4.2'), null)
  assert.equal(parsePluginsVTag('plugins-v2026.08.21'), null)
})
