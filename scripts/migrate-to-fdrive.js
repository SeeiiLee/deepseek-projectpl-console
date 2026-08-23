import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { findRunningClientPids } from './client-process-detect.js'

// Lossless migration into the INSTALLED stable package's F: data home
// (F:\documents\Cyrus Deepseek Harness Data):
//   - old stable user data  -> target root (settings/project-control/...)
//   - .dsh sessions          -> target\harness-home (excluding boot node_modules)
//   - test (Dev) user data   -> target\from-test-userdata (preserved archive)
// Nothing is deleted or moved from the sources. Run with BOTH clients closed.
// With --finalize: skip guard/copy entirely, verify an already-populated
// target (e.g. after a manual migration) and write the report + marker only.

const finalizeOnly = process.argv.includes('--finalize')
const appDataRoot = process.env.DSH_MIGRATE_APPDATA_ROOT ?? process.env.APPDATA ?? ''
const stableUserData = join(appDataRoot, 'DeepSeek Harness Personal')
const devUserData = join(appDataRoot, 'DeepSeek Harness Personal Dev')
const dshHome = resolve(process.env.DSH_MIGRATE_DSH_HOME ?? join(process.env.USERPROFILE ?? '.', '.dsh'))
const target = resolve(process.env.DSH_MIGRATE_TARGET ?? 'F:\\documents\\Cyrus Deepseek Harness Data')
const marker = join(target, 'MIGRATED.marker')

function fail(message, code) {
  process.stderr.write('migration aborted: ' + message + '\n')
  process.exit(code)
}

if (!finalizeOnly) {
  if (process.env.DSH_MIGRATE_SKIP_RUNNING_CHECK !== '1') {
    if (process.env.DSH_MIGRATE_PROBE_FORCE_FAIL === '1') {
      fail('cannot verify whether clients are running (probe unavailable); close all clients and retry.', 3)
    }
    const probe = spawnSync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      'Get-CimInstance Win32_Process | Select-Object ProcessId,Name,CommandLine | ConvertTo-Json -Compress',
    ], { encoding: 'utf8', windowsHide: true, timeout: 20_000 })
    if (probe.status !== 0) {
      fail('cannot verify whether clients are running (process probe failed); close all clients and retry.', 3)
    }
    let running = []
    try {
      const parsed = JSON.parse(String(probe.stdout ?? '').trim() || '[]')
      const rows = Array.isArray(parsed) ? parsed : parsed === null ? [] : [parsed]
      running = findRunningClientPids(rows.map((row) => ({
        pid: row?.ProcessId,
        name: row?.Name,
        commandLine: row?.CommandLine,
      })), { excludePids: [process.pid, process.ppid] })
    } catch {
      fail('cannot verify whether clients are running (process probe unreadable); close all clients and retry.', 3)
    }
    if (running.length > 0) {
      fail('a DeepSeek Harness Personal client is still running (PID ' + running.join(', ') + '). Close both the stable and the test clients first.', 3)
    }
  }
}

if (existsSync(marker)) {
  fail('the F: data home was already finalized (MIGRATED.marker exists). To redo, review the report and remove the marker deliberately.', 2)
}

if (finalizeOnly) {
  const required = [
    join(target, 'project-control'),
    join(target, 'harness-home', 'sessions'),
    join(target, 'from-test-userdata'),
  ]
  for (const path of required) {
    if (!existsSync(path)) fail('finalize requires the migrated trees to exist; missing: ' + path, 1)
  }
  process.stdout.write('finalize: verifying and registering the existing migrated trees (no copying).\n')
} else {
  if (!existsSync(stableUserData)) fail('old stable user data not found: ' + stableUserData, 1)
  if (!existsSync(dshHome)) fail('Harness home not found: ' + dshHome, 1)
  const devPresent = existsSync(devUserData)

  if (existsSync(target)) {
    const existing = readdirSync(target)
    if (existing.length > 0) {
      if (!process.argv.includes('--force')) {
        fail('the target already contains data (' + String(existing.length) + ' entries). Refusing to delete it. Pass --force only after you have reviewed the target and are certain it is residue from an aborted attempt.', 4)
      }
      process.stdout.write('--force: removing residue from an aborted earlier attempt: ' + target + '\n')
      rmSync(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    }
  }
  mkdirSync(target, { recursive: true })

  function isBootNodeModules(sourcePath) {
    const rel = relative(dshHome, sourcePath)
    return rel === join('profiles', 'node_modules')
      || rel === join('profiles', 'web', 'node_modules')
      || rel.startsWith(join('profiles', 'node_modules') + '\\')
      || rel.startsWith(join('profiles', 'web', 'node_modules') + '\\')
  }

  try {
    cpSync(stableUserData, target, { recursive: true })
    cpSync(dshHome, join(target, 'harness-home'), {
      recursive: true,
      filter: (sourcePath) => !isBootNodeModules(String(sourcePath)),
    })
    if (devPresent) {
      cpSync(devUserData, join(target, 'from-test-userdata'), { recursive: true })
    }
  } catch (error) {
    try {
      rmSync(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    } catch {}
    fail('copy failed mid-way (' + String(error?.code ?? error?.message ?? error) + '); partial files were removed. Close all clients and retry.', 1)
  }
}

function countFiles(root) {
  let files = 0
  let bytes = 0
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) {
        walk(path)
      } else {
        files += 1
        bytes += statSync(path).size
      }
    }
  }
  walk(root)
  return { files, bytes }
}

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

const stableCount = countFiles(target)
const harnessCount = countFiles(join(target, 'harness-home'))
const devTree = join(target, 'from-test-userdata')
const devCount = existsSync(devTree) ? countFiles(devTree) : { files: 0, bytes: 0 }
const stableDb = join(target, 'project-control', 'project-control.sqlite3')
const devDb = join(devTree, 'project-control', 'project-control.sqlite3')
const migratedAt = new Date().toISOString()
const reportLines = [
  'DeepSeek Harness Personal 数据迁移报告（无损复制，源目录全部保留）',
  '',
  '执行时间：' + migratedAt + (finalizeOnly ? '（登记模式：仅核对并登记，未复制）' : ''),
  '目标数据目录：' + target,
  '',
  '当前内容：',
  '- 稳定版数据（设置/项目库/更新配置）：' + String(stableCount.files) + ' 个文件，' + String(Math.round(stableCount.bytes / 1024 / 1024)) + ' MB',
  '- 会话与 Harness 配置（harness-home）：' + String(harnessCount.files) + ' 个文件，' + String(Math.round(harnessCount.bytes / 1024 / 1024)) + ' MB',
  '- 测试版数据存档（from-test-userdata）：' + String(devCount.files) + ' 个文件，' + String(Math.round(devCount.bytes / 1024 / 1024)) + ' MB',
  '',
  '关键文件 SHA-256：',
  '  project-control/project-control.sqlite3  ' + (existsSync(stableDb) ? sha256File(stableDb) : '(n/a)'),
  '  from-test-userdata/project-control/project-control.sqlite3  ' + (existsSync(devDb) ? sha256File(devDb) : '(n/a)'),
  '',
  '下一步：',
  '1. 运行 分发包\\稳定版 的 setup-x64.exe，安装目录选择 D:\\Cyrus Deepseek Harness（如已完成可忽略）。',
  '2. 启动安装版；它会自动使用本数据目录与会话目录。',
  '3. 逐项核对：会话历史、项目控制台项目、设置。旧目录可继续保留作备份。',
]
writeFileSync(join(target, '迁移报告.txt'), reportLines.join('\r\n') + '\r\n', 'utf8')
writeFileSync(marker, JSON.stringify({
  migratedAt,
  finalizeOnly,
  stableFiles: stableCount.files,
  stableBytes: stableCount.bytes,
  harnessFiles: harnessCount.files,
  harnessBytes: harnessCount.bytes,
  devFiles: devCount.files,
  devBytes: devCount.bytes,
}, null, 2) + '\n', 'utf8')
process.stdout.write((finalizeOnly ? 'finalize complete: ' : 'migration complete: ') + target + '\n')
process.stdout.write('  data: ' + String(stableCount.files) + ' files / ' + String(Math.round(stableCount.bytes / 1024 / 1024)) + ' MB\n')
process.stdout.write('  harness home: ' + String(harnessCount.files) + ' files / ' + String(Math.round(harnessCount.bytes / 1024 / 1024)) + ' MB\n')
process.stdout.write('  test archive: ' + String(devCount.files) + ' files / ' + String(Math.round(devCount.bytes / 1024 / 1024)) + ' MB\n')
