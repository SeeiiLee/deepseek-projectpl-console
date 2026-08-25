import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { RECEIPT_SOURCE_FILES, writeBuildReceipt } from '../scripts/build-receipt.mjs'
import { findReusablePackageSet, packageSetDirectoryName } from '../scripts/package-set.mjs'

function write(path, content) {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, content, 'utf8')
}

function makeProjectAndSet() {
  const root = mkdtempSync(join(tmpdir(), 'dsh-package-set-'))
  const projectRoot = join(root, 'workspace')
  const setsRoot = join(root, 'local', 'package-sets')
  for (const file of RECEIPT_SOURCE_FILES) {
    const content = file === 'package.json'
      ? JSON.stringify({ name: 'fixture', version: '0.4.5' })
      : file === 'src/build-flavor.js'
        ? "export const BUILD_FLAVOR = 'stable'\n"
        : `${file}\n`
    write(join(projectRoot, file), content)
  }
  const staging = join(setsRoot, '.staging', 'fixture')
  const appDir = join(staging, 'win-unpacked', 'resources', 'app')
  const exePath = join(staging, 'win-unpacked', 'DeepSeek Harness Personal.exe')
  write(join(appDir, 'src', 'build-flavor.js'), "export const BUILD_FLAVOR = 'stable'\n")
  write(join(appDir, 'src', 'main.js'), 'main\n')
  write(join(staging, 'win-unpacked', 'resources.pak'), 'resources\n')
  write(exePath, 'exe\n')
  const receipt = writeBuildReceipt({
    projectRoot,
    flavor: 'stable',
    exePath,
    packagedAppDir: appDir,
    receiptPath: join(staging, 'build-receipt.json'),
  })
  const finalRoot = join(setsRoot, packageSetDirectoryName(receipt.packageSetTreeHash))
  mkdirSync(setsRoot, { recursive: true })
  renameSync(staging, finalRoot)
  return { root, projectRoot, setsRoot, finalRoot }
}

test('managed package-set lookup reuses an exact source and complete package receipt', () => {
  const fixture = makeProjectAndSet()
  try {
    const result = findReusablePackageSet({
      projectRoot: fixture.projectRoot,
      packageSetsRoot: fixture.setsRoot,
    })
    assert.equal(result?.root, fixture.finalRoot)
    assert.equal(result?.reused, true)
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

test('managed package-set lookup fails closed after non-app package bytes drift', () => {
  const fixture = makeProjectAndSet()
  try {
    writeFileSync(join(fixture.finalRoot, 'win-unpacked', 'resources.pak'), 'tampered\n')
    assert.equal(findReusablePackageSet({
      projectRoot: fixture.projectRoot,
      packageSetsRoot: fixture.setsRoot,
    }), null)
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})
