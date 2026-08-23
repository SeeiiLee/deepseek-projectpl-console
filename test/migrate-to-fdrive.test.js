import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { setTimeout as delay } from 'node:timers/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const script = fileURLToPath(new URL('../scripts/migrate-to-fdrive.js', import.meta.url))

function makeFixture() {
  const root = mkdtempSync(join(tmpdir(), 'dsh-migrate-'))
  const appData = join(root, 'roaming')
  const stable = join(appData, 'DeepSeek Harness Personal')
  const dev = join(appData, 'DeepSeek Harness Personal Dev')
  const dsh = join(root, 'dotdsh')
  mkdirSync(join(stable, 'project-control'), { recursive: true })
  writeFileSync(join(stable, 'Preferences'), 'stable-preferences')
  writeFileSync(join(stable, 'project-control', 'project-control.sqlite3'), 'stable-db')
  mkdirSync(join(dev, 'project-control'), { recursive: true })
  writeFileSync(join(dev, 'Preferences'), 'dev-preferences')
  writeFileSync(join(dev, 'project-control', 'dev.sqlite3'), 'dev-db')
  mkdirSync(join(dsh, 'profiles', 'web', 'node_modules', '@cyrus'), { recursive: true })
  mkdirSync(join(dsh, 'profiles', 'node_modules', 'junk'), { recursive: true })
  mkdirSync(join(dsh, 'sessions'), { recursive: true })
  writeFileSync(join(dsh, 'settings.yaml'), 'session-settings')
  writeFileSync(join(dsh, 'profiles', 'web', 'cordis.yml'), 'cordis')
  writeFileSync(join(dsh, 'profiles', 'node_modules', 'junk', 'junk.txt'), 'junk')
  writeFileSync(join(dsh, 'profiles', 'web', 'node_modules', '@cyrus', 'junk.txt'), 'junk')
  writeFileSync(join(dsh, 'sessions', 'a.txt'), 'session-a')
  return { root, appData, dsh }
}

function runMigration(root, appData, dsh, target, extraEnv = {}) {
  return spawnSync(process.execPath, [script], {
    env: {
      ...process.env,
      DSH_MIGRATE_APPDATA_ROOT: appData,
      DSH_MIGRATE_DSH_HOME: dsh,
      DSH_MIGRATE_TARGET: target,
      DSH_MIGRATE_SKIP_RUNNING_CHECK: '1',
      ...extraEnv,
    },
    encoding: 'utf8',
  })
}

test('the migration copies all three sources losslessly, skips boot node_modules, and reports hashes', () => {
  const { root, appData, dsh } = makeFixture()
  const target = join(root, 'target')
  const result = runMigration(root, appData, dsh, target)
  assert.equal(result.status, 0, result.stderr)

  // Old stable user data lands in the target root.
  assert.equal(existsSync(join(target, 'Preferences')), true)
  assert.equal(existsSync(join(target, 'project-control', 'project-control.sqlite3')), true)
  // Harness home lands under harness-home, without boot node_modules.
  assert.equal(existsSync(join(target, 'harness-home', 'settings.yaml')), true)
  assert.equal(existsSync(join(target, 'harness-home', 'sessions', 'a.txt')), true)
  assert.equal(existsSync(join(target, 'harness-home', 'profiles', 'web', 'cordis.yml')), true)
  assert.equal(existsSync(join(target, 'harness-home', 'profiles', 'node_modules')), false)
  assert.equal(existsSync(join(target, 'harness-home', 'profiles', 'web', 'node_modules')), false)
  // Test user data is preserved as an archive.
  assert.equal(existsSync(join(target, 'from-test-userdata', 'Preferences')), true)
  assert.equal(existsSync(join(target, 'from-test-userdata', 'project-control', 'dev.sqlite3')), true)
  // Report + marker + no source deletion.
  const report = readFileSync(join(target, '迁移报告.txt'), 'utf8')
  assert.match(report, /SHA-256/i)
  assert.match(report, /D:\\Cyrus Deepseek Harness/)
  assert.equal(existsSync(join(target, 'MIGRATED.marker')), true)
  assert.equal(existsSync(join(appData, 'DeepSeek Harness Personal', 'Preferences')), true)
  assert.equal(existsSync(join(dsh, 'settings.yaml')), true)

  // Second run refuses (marker).
  const second = runMigration(root, appData, dsh, target)
  assert.equal(second.status, 2)
  assert.match(second.stderr, /already/u)
  rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
})

test('a non-empty target is only replaced with an explicit --force', () => {
  const { root, appData, dsh } = makeFixture()
  const target = join(root, 'target')
  mkdirSync(target, { recursive: true })
  writeFileSync(join(target, 'stray.txt'), 'stray')

  // Without --force the populated target is protected.
  const refused = spawnSync(process.execPath, [script], {
    env: {
      ...process.env,
      DSH_MIGRATE_APPDATA_ROOT: appData,
      DSH_MIGRATE_DSH_HOME: dsh,
      DSH_MIGRATE_TARGET: target,
      DSH_MIGRATE_SKIP_RUNNING_CHECK: '1',
    },
    encoding: 'utf8',
  })
  assert.equal(refused.status, 4, refused.stdout)
  assert.match(refused.stderr, /Refusing to delete/u)
  assert.equal(existsSync(join(target, 'stray.txt')), true, 'no data may be deleted without --force')

  // With --force the residue is replaced.
  const forced = spawnSync(process.execPath, [script, '--force'], {
    env: {
      ...process.env,
      DSH_MIGRATE_APPDATA_ROOT: appData,
      DSH_MIGRATE_DSH_HOME: dsh,
      DSH_MIGRATE_TARGET: target,
      DSH_MIGRATE_SKIP_RUNNING_CHECK: '1',
    },
    encoding: 'utf8',
  })
  assert.equal(forced.status, 0, forced.stderr)
  assert.match(forced.stdout, /residue/u)
  assert.equal(existsSync(join(target, 'stray.txt')), false)
  assert.equal(existsSync(join(target, 'Preferences')), true)
  assert.equal(existsSync(join(target, 'MIGRATED.marker')), true)
  rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
})

test('a failed process probe aborts instead of proceeding blind', () => {
  const { root, appData, dsh } = makeFixture()
  const target = join(root, 'target')
  const result = spawnSync(process.execPath, [script], {
    env: {
      ...process.env,
      DSH_MIGRATE_APPDATA_ROOT: appData,
      DSH_MIGRATE_DSH_HOME: dsh,
      DSH_MIGRATE_TARGET: target,
      DSH_MIGRATE_PROBE_FORCE_FAIL: '1',
    },
    encoding: 'utf8',
  })
  assert.equal(result.status, 3)
  assert.match(result.stderr, /cannot verify/u)
  assert.equal(existsSync(target), false)
  rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
})

test('the default F: target keeps its backslashes when evaluated', async () => {
  const { readFileSync: readSync } = await import('node:fs')
  const source = readSync(script, 'utf8')
  assert.match(source, /'F:\\\\documents\\\\Cyrus Deepseek Harness Data'/u)
})

test('--finalize registers a manually migrated tree without copying or touching the running check', () => {
  const { root, appData, dsh } = makeFixture()
  const target = join(root, 'target')
  mkdirSync(join(target, 'project-control'), { recursive: true })
  mkdirSync(join(target, 'harness-home', 'sessions'), { recursive: true })
  mkdirSync(join(target, 'from-test-userdata'), { recursive: true })
  writeFileSync(join(target, 'project-control', 'project-control.sqlite3'), 'stable-db')
  writeFileSync(join(target, 'harness-home', 'sessions', 'a.txt'), 'session-a')
  const finalize = spawnSync(process.execPath, [script, '--finalize'], {
    env: {
      ...process.env,
      DSH_MIGRATE_APPDATA_ROOT: appData,
      DSH_MIGRATE_DSH_HOME: dsh,
      DSH_MIGRATE_TARGET: target,
    },
    encoding: 'utf8',
  })
  assert.equal(finalize.status, 0, finalize.stderr)
  assert.equal(existsSync(join(target, 'MIGRATED.marker')), true)
  assert.equal(existsSync(join(target, '迁移报告.txt')), true)
  assert.equal(existsSync(join(target, 'project-control', 'project-control.sqlite3')), true, 'finalize must not delete data')
  const second = spawnSync(process.execPath, [script, '--finalize'], {
    env: {
      ...process.env,
      DSH_MIGRATE_APPDATA_ROOT: appData,
      DSH_MIGRATE_DSH_HOME: dsh,
      DSH_MIGRATE_TARGET: target,
    },
    encoding: 'utf8',
  })
  assert.equal(second.status, 2)
  assert.match(second.stderr, /already finalized/u)
  rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
})

test('a mid-copy failure removes the partial target so a retry is one click', async () => {
  const { root, appData, dsh } = makeFixture()
  const target = join(root, 'target')
  const lockedFile = join(appData, 'DeepSeek Harness Personal', 'Preferences')
  const lockCommand = "$fs=[System.IO.File]::Open('" + lockedFile.replaceAll("'", "''") + "','Open','Read','None'); Start-Sleep -Seconds 30"
  const locker = spawn('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    lockCommand,
  ], { stdio: 'ignore', windowsHide: true })
  try {
    const deadline = Date.now() + 10_000
    let locked = false
    while (Date.now() < deadline) {
      try {
        const { copyFileSync, rmSync: rmProbe } = await import('node:fs')
        copyFileSync(lockedFile, join(root, 'probe.txt'))
        rmProbe(join(root, 'probe.txt'), { force: true })
      } catch (error) {
        if (error?.code === 'EBUSY' || error?.code === 'EPERM') {
          locked = true
          break
        }
      }
      await delay(150)
    }
    assert.equal(locked, true, 'the locker never took the file')
    const result = runMigration(root, appData, dsh, target)
    assert.equal(result.status, 1, result.stderr)
    assert.match(result.stderr, /partial files were removed/u)
    assert.equal(existsSync(target), false)
  } finally {
    locker.kill()
    await new Promise(resolvePromise => { locker.once('exit', resolvePromise) })
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
})
