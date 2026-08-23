import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { setTimeout as delay } from 'node:timers/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const script = fileURLToPath(new URL('../scripts/stage-releases.js', import.meta.url))

function makeFixtureRoot() {
  const root = mkdtempSync(join(tmpdir(), 'dsh-stage-'))
  mkdirSync(join(root, 'artifacts'), { recursive: true })
  mkdirSync(join(root, 'artifacts-dev'), { recursive: true })
  writeFileSync(join(root, 'artifacts', 'DeepSeek-Harness-Personal-0.1.0-portable-x64.exe'), 'stable-portable')
  writeFileSync(join(root, 'artifacts', 'DeepSeek-Harness-Personal-0.1.0-portable-x64.exe.sha256'), 'stable-hash')
  writeFileSync(join(root, 'artifacts-dev', 'DeepSeek-Harness-Personal-Dev-0.1.0-portable-x64.exe'), 'dev-portable')
  writeFileSync(join(root, 'artifacts-dev', 'DeepSeek-Harness-Personal-Dev-0.1.0-portable-x64.exe.sha256'), 'dev-hash')
  writeFileSync(join(root, 'artifacts-dev', 'win-unpacked.keep.txt'), 'should not be staged')
  return root
}

function runStage(root, stageDir) {
  return spawnSync(process.execPath, [script], {
    env: { ...process.env, DSH_STAGE_PROJECT_ROOT: root, DSH_STAGE_DIR: stageDir },
    encoding: 'utf8',
  })
}

test('staging skips files locked by a running package and reports a partial result', async () => {
  const root = makeFixtureRoot()
  const stageDir = join(root, 'stage')
  const lockedSource = join(root, 'artifacts', 'DeepSeek-Harness-Personal-0.1.0-portable-x64.exe')
  const locker = spawn('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    `$fs=[System.IO.File]::Open('${lockedSource.replaceAll("'", "''")}','Open','Read','None'); Start-Sleep -Seconds 45`,
  ], { stdio: 'ignore', windowsHide: true })
  try {
    // Wait until the lock is actually held: copying the locked file must fail
    // with EBUSY/EPERM before we run the staging step.
    const deadline = Date.now() + 10_000
    let locked = false
    while (Date.now() < deadline) {
      try {
        copyFileSync(lockedSource, join(root, 'probe.exe'))
        rmSync(join(root, 'probe.exe'), { force: true })
      } catch (error) {
        if (error?.code === 'EBUSY' || error?.code === 'EPERM') {
          locked = true
          break
        }
      }
      await delay(150)
    }
    assert.equal(locked, true, 'the powershell locker never took the file')
    const result = runStage(root, stageDir)
    assert.equal(result.status, 2, result.stderr)
    assert.match(result.stderr, /EBUSY/u)
    assert.match(result.stderr, /partial/u)
    // The locked exe is skipped, its checksum still stages, and the other group completes.
    assert.equal(existsSync(join(stageDir, '稳定版', 'DeepSeek-Harness-Personal-0.1.0-portable-x64.exe')), false)
    assert.equal(existsSync(join(stageDir, '稳定版', 'DeepSeek-Harness-Personal-0.1.0-portable-x64.exe.sha256')), true)
    assert.equal(existsSync(join(stageDir, '测试版', 'DeepSeek-Harness-Personal-Dev-0.1.0-portable-x64.exe')), true)
  } finally {
    locker.kill()
    await new Promise(resolvePromise => { locker.once('exit', resolvePromise) })
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
})

test('release staging separates the two package bodies into named folders with readme files', () => {
  const root = makeFixtureRoot()
  const stageDir = join(root, 'stage')
  const result = runStage(root, stageDir)
  assert.equal(result.status, 0, result.stderr)
  assert.equal(existsSync(join(stageDir, '测试版', 'DeepSeek-Harness-Personal-Dev-0.1.0-portable-x64.exe')), true)
  assert.equal(existsSync(join(stageDir, '测试版', 'DeepSeek-Harness-Personal-Dev-0.1.0-portable-x64.exe.sha256')), true)
  assert.equal(existsSync(join(stageDir, '稳定版', 'DeepSeek-Harness-Personal-0.1.0-portable-x64.exe')), true)
  assert.equal(existsSync(join(stageDir, '稳定版', 'DeepSeek-Harness-Personal-0.1.0-portable-x64.exe.sha256')), true)
  assert.equal(existsSync(join(stageDir, '测试版', '说明.txt')), true)
  assert.equal(existsSync(join(stageDir, '稳定版', '说明.txt')), true)
  const devReadme = readFileSync(join(stageDir, '测试版', '说明.txt'), 'utf8')
  const stableReadme = readFileSync(join(stageDir, '稳定版', '说明.txt'), 'utf8')
  assert.match(devReadme, /Dev/)
  assert.match(devReadme, /完全独立/)
  assert.match(stableReadme, /测试版验收通过后才更新/)
  rmSync(root, { recursive: true, force: true })
})
