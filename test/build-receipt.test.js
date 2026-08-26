import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, test } from 'node:test'

import {
  RECEIPT_SCHEMA_VERSION,
  verifyBuildReceipt,
  writeBuildReceipt,
} from '../scripts/build-receipt.mjs'

const owned = []
afterEach(() => {
  for (const path of owned.splice(0)) rmSync(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
})

function writeFileRecursive(path, content) {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, content, 'utf8')
}

function makeFixture() {
  const root = mkdtempSync(join(tmpdir(), 'dsh-build-receipt-'))
  owned.push(root)
  const sourceFiles = {
    'package.json': JSON.stringify({ name: 'fixture', version: '0.4.2' }),
    'plugin-set.lock.json': '{}',
    'src/main.js': 'main',
    'src/boot-log.js': 'bl',
    'src/update-service.js': 'us',
    'src/update-core.js': 'uc',
    'src/personal-plugins.js': 'pp',
    'src/personal-plugin-validation.js': 'ppv',
    'src/harness-helper.js': 'hh',
    'src/harness-process.js': 'hp',
    'src/desktop-bridge.js': 'db',
    'src/preload.cjs': 'pre',
    'src/app-flavor.js': 'af',
    'src/dev-e2e-driver.js': 'driver',
    'src/build-flavor.js': "export const BUILD_FLAVOR = 'stable'\n",
    'scripts/build-plugins.js': 'bp',
    'scripts/pack-desktop.js': 'pd',
    'scripts/apply-harness-tsdown-fallback.mjs': 'af',
  }
  for (const [file, content] of Object.entries(sourceFiles)) {
    writeFileRecursive(join(root, file), content)
  }
  const appDir = join(root, 'win-unpacked', 'resources', 'app')
  const appFiles = {
    'package.json': JSON.stringify({ name: 'fixture-app' }),
    'src/main.js': 'main',
    'src/build-flavor.js': "export const BUILD_FLAVOR = 'stable'\n",
    'plugins/anysearch/package.json': '{}',
    'plugins/anysearch/lib/index.js': 'x',
    'protocol/foo.json': '{}',
    'migrations/0001.sql': 'x',
    'templates/a.txt': 'x',
  }
  for (const [file, content] of Object.entries(appFiles)) {
    writeFileRecursive(join(appDir, file), content)
  }
  const exePath = join(root, 'win-unpacked', 'DeepSeek Harness Personal.exe')
  writeFileRecursive(exePath, 'exe-bytes')
  const receiptPath = join(root, 'receipt.json')
  const receipt = writeBuildReceipt({
    projectRoot: root,
    flavor: 'stable',
    exePath,
    packagedAppDir: appDir,
    receiptPath,
  })
  return { root, appDir, exePath, receiptPath, receipt }
}

test('build receipt passes for current source and current package', () => {
  const { root, appDir, exePath, receipt } = makeFixture()
  const result = verifyBuildReceipt({
    projectRoot: root,
    receipt,
    exePath,
    packagedAppDir: appDir,
    expectedFlavor: 'stable',
  })
  assert.equal(result.ok, true, result.issues.join('; '))
})

test('build receipt fails when a source file changes', () => {
  const { root, appDir, exePath, receipt } = makeFixture()
  writeFileSync(join(root, 'src', 'main.js'), 'changed')
  const result = verifyBuildReceipt({ projectRoot: root, receipt, exePath, packagedAppDir: appDir, expectedFlavor: 'stable' })
  assert.equal(result.ok, false)
  assert.ok(result.issues.some(issue => /source file hash mismatch: src\/main\.js/u.test(issue)))
})

test('build receipt fails when the EXE is tampered', () => {
  const { root, appDir, exePath, receipt } = makeFixture()
  writeFileSync(exePath, 'tampered-exe')
  const result = verifyBuildReceipt({ projectRoot: root, receipt, exePath, packagedAppDir: appDir, expectedFlavor: 'stable' })
  assert.equal(result.ok, false)
  assert.ok(result.issues.some(issue => /exe sha256 mismatch/u.test(issue)))
})

test('build receipt fails when a resources/app protected file is tampered', () => {
  const { root, appDir, exePath, receipt } = makeFixture()
  writeFileSync(join(appDir, 'src', 'main.js'), 'tampered')
  const result = verifyBuildReceipt({ projectRoot: root, receipt, exePath, packagedAppDir: appDir, expectedFlavor: 'stable' })
  assert.equal(result.ok, false)
  assert.ok(result.issues.some(issue => /packaged resources\/app tree hash mismatch/u.test(issue)))
})

test('boot-error.log is not excluded from package immutability checks', () => {
  const { root, appDir, exePath, receipt } = makeFixture()
  writeFileSync(join(appDir, 'boot-error.log'), 'runtime mutation')
  const result = verifyBuildReceipt({ projectRoot: root, receipt, exePath, packagedAppDir: appDir, expectedFlavor: 'stable' })
  assert.equal(result.ok, false)
  assert.ok(result.issues.some(issue => /resources\/app tree hash mismatch/u.test(issue)))
})

test('build receipt fails when a packaged file is missing', () => {
  const { root, appDir, exePath, receipt } = makeFixture()
  const missing = join(appDir, 'plugins', 'anysearch', 'lib', 'index.js')
  rmSync(missing, { force: true })
  const result = verifyBuildReceipt({ projectRoot: root, receipt, exePath, packagedAppDir: appDir, expectedFlavor: 'stable' })
  assert.equal(result.ok, false)
  assert.ok(result.issues.some(issue => /file count mismatch|tree hash mismatch/u.test(issue)))
})

test('build receipt fails when dev flavor is used for stable E2E', () => {
  const { root, appDir, exePath } = makeFixture()
  const devReceiptPath = join(root, 'dev-receipt.json')
  const devReceipt = writeBuildReceipt({
    projectRoot: root,
    flavor: 'dev',
    exePath,
    packagedAppDir: appDir,
    receiptPath: devReceiptPath,
  })
  const result = verifyBuildReceipt({ projectRoot: root, receipt: devReceipt, exePath, packagedAppDir: appDir, expectedFlavor: 'stable' })
  assert.equal(result.ok, false)
  assert.ok(result.issues.some(issue => /flavor dev != expected stable/u.test(issue)))
})

test('Dev-E2E build receipt records driver schema/version and verifies only with expectedE2eBuild true', () => {
  const { root, appDir, exePath } = makeFixture()
  writeFileSync(join(appDir, 'src', 'build-flavor.js'), "export const BUILD_FLAVOR = 'dev'\nexport const E2E_BUILD = true\n")
  const receiptPath = join(root, 'dev-receipt.json')
  const receipt = writeBuildReceipt({
    projectRoot: root,
    flavor: 'dev',
    e2eBuild: true,
    installerSha256: 'a'.repeat(64),
    exePath,
    packagedAppDir: appDir,
    receiptPath,
  })
  assert.equal(receipt.driverSchemaVersion, 1)
  assert.equal(receipt.driverVersion, '1.0.0')
  assert.equal(receipt.e2eBuild, true)
  const result = verifyBuildReceipt({
    projectRoot: root,
    receipt,
    exePath,
    packagedAppDir: appDir,
    expectedFlavor: 'dev',
    expectedE2eBuild: true,
  })
  assert.equal(result.ok, true, result.issues.join('; '))
})

test('Dev-E2E verification rejects an ordinary dev receipt without e2eBuild', () => {
  const { root, appDir, exePath } = makeFixture()
  writeFileSync(join(appDir, 'src', 'build-flavor.js'), "export const BUILD_FLAVOR = 'dev'\n")
  const receiptPath = join(root, 'dev-receipt.json')
  const receipt = writeBuildReceipt({
    projectRoot: root,
    flavor: 'dev',
    exePath,
    packagedAppDir: appDir,
    receiptPath,
  })
  const result = verifyBuildReceipt({
    projectRoot: root,
    receipt,
    exePath,
    packagedAppDir: appDir,
    expectedFlavor: 'dev',
    expectedE2eBuild: true,
  })
  assert.equal(result.ok, false)
  assert.ok(result.issues.some(issue => /e2eBuild/u.test(issue)))
})

test('build receipt fails on unknown schema and corrupt receipt', () => {
  const { root, appDir, exePath, receipt } = makeFixture()
  const unknownSchema = { ...receipt, schemaVersion: 99 }
  const unknownResult = verifyBuildReceipt({ projectRoot: root, receipt: unknownSchema, exePath, packagedAppDir: appDir, expectedFlavor: 'stable' })
  assert.equal(unknownResult.ok, false)
  assert.ok(unknownResult.issues.some(issue => /schemaVersion/u.test(issue)))

  const corruptResult = verifyBuildReceipt({ projectRoot: root, receipt: { bad: true }, exePath, packagedAppDir: appDir, expectedFlavor: 'stable' })
  assert.equal(corruptResult.ok, false)
  assert.ok(corruptResult.issues.some(issue => /sourceFiles missing|schemaVersion/u.test(issue)))
})
