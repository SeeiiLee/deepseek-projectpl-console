import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

test('Windows packaging keeps NSIS and portable targets with stable artifact names', () => {
  assert.equal(manifest.build.appId, 'com.cyrus.deepseek-harness-personal')
  assert.equal(manifest.build.asar, false)
  assert.deepEqual(manifest.build.win.target.map(entry => entry.target), ['nsis', 'portable'])
  assert.match(manifest.build.nsis.artifactName, /setup/)
  assert.match(manifest.build.portable.artifactName, /portable/)
  assert.equal(manifest.build.nsis.createDesktopShortcut, true)
  assert.equal(manifest.build.nsis.createStartMenuShortcut, true)
})

test('the packaged Windows icon contains a multi-size ICO and a renderer PNG', () => {
  const ico = readFileSync(new URL('../assets/app-icon.ico', import.meta.url))
  const png = readFileSync(new URL('../assets/app-icon.png', import.meta.url))
  assert.equal(ico.readUInt16LE(0), 0)
  assert.equal(ico.readUInt16LE(2), 1)
  assert.ok(ico.readUInt16LE(4) >= 8)
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  assert.ok(manifest.build.files.includes('assets/app-icon.ico'))
  assert.ok(manifest.build.files.includes('assets/app-icon.png'))
  assert.equal(manifest.build.win.icon, 'assets/app-icon.ico')
})

test('Project Control migration and protocol assets are included in unpacked builds', () => {
  assert.ok(manifest.build.files.includes('plugins/*/migrations/**/*'))
  assert.ok(manifest.build.files.includes('protocol/project-control/v1alpha1/**/*.json'))
  assert.equal(manifest.dependencies.ajv, '8.20.0')
  assert.equal(manifest.dependencies['ajv-formats'], '3.0.1')
})
