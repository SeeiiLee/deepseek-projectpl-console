import assert from 'node:assert/strict'
import test from 'node:test'
import {
  compareVersions,
  expectedSha256,
  normalizeUpdateSettings,
  parseRepository,
  selectRelease,
  selectWindowsAsset,
  sha256,
} from '../src/update-core.js'

test('repository identifiers accept GitHub names and reject URLs', () => {
  assert.deepEqual(parseRepository('deepseek-ai/deepseek-harness'), {
    owner: 'deepseek-ai', repository: 'deepseek-harness', fullName: 'deepseek-ai/deepseek-harness',
  })
  assert.throws(() => parseRepository('https://github.com/deepseek-ai/deepseek-harness'), /owner\/repository/u)
  assert.throws(() => parseRepository('../repo'), /owner\/repository/u)
  assert.equal(parseRepository('', { allowEmpty: true }), undefined)
})

test('settings keep the official Harness source and explicit beta channel', () => {
  assert.deepEqual(normalizeUpdateSettings({
    desktopRepository: 'cyrus/personal', harnessRepository: 'untrusted/example', channel: 'beta', autoCheck: false,
  }), {
    desktopRepository: 'cyrus/personal', harnessRepository: 'deepseek-ai/deepseek-harness', pluginRepository: '', channel: 'beta', autoCheck: false,
  })
  assert.throws(() => normalizeUpdateSettings({ desktopRepository: '..\\repo' }), /owner\/repository/u)
})

test('release ordering distinguishes stable and prerelease versions', () => {
  assert.equal(compareVersions('0.2.0', '0.1.9'), 1)
  assert.equal(compareVersions('v0.2.0-beta.2', '0.2.0'), -1)
  const releases = [
    { tag_name: 'v0.2.0-beta.1', prerelease: true, draft: false },
    { tag_name: 'v0.1.2', prerelease: false, draft: false },
    { tag_name: 'v0.1.1', prerelease: false, draft: false },
  ]
  assert.equal(selectRelease([...releases], 'stable')?.tag_name, 'v0.1.2')
  assert.equal(selectRelease([...releases], 'beta')?.tag_name, 'v0.2.0-beta.1')
})

test('artifact selection never mistakes a portable file for the installer', () => {
  const assets = [
    { name: 'DeepSeek-Harness-Personal-0.2.0-portable-x64.exe' },
    { name: 'DeepSeek-Harness-Personal-Setup-0.2.0-x64.exe' },
  ]
  assert.equal(selectWindowsAsset(assets, 'portable')?.name, assets[0].name)
  assert.equal(selectWindowsAsset(assets, 'nsis')?.name, assets[1].name)
})

test('downloads require and verify an exact SHA-256 value', () => {
  const data = Buffer.from('personal-update')
  const digest = sha256(data)
  const asset = { name: 'setup.exe' }
  assert.equal(expectedSha256(asset, `${digest} *setup.exe\n`), digest)
  assert.equal(expectedSha256({ ...asset, digest: `sha256:${digest}` }), digest)
  assert.equal(expectedSha256(asset, `${digest} other.exe\n`), undefined)
})
