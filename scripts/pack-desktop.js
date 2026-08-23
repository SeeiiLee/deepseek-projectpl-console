import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'
import { writeBuildReceipt } from './build-receipt.mjs'

// Flavor-aware packager. Builds the same tree under two completely separate
// identities:
//   stable -> DeepSeek Harness Personal (appId ...-personal, artifacts/)
//   dev    -> DeepSeek Harness Personal Dev (appId ...-personal-dev, artifacts-dev/)
// The dev flavor is selected by rewriting src/build-flavor.js before the
// plugin build and restoring it afterwards, so the running app derives its
// name/AppId/userData/shortcut identity from a single boot-time constant.
//
// Usage: node scripts/pack-desktop.js <stable|dev> <nsis|portable|dir> [...]

const projectRoot = resolve(import.meta.dirname, '..')
const [flavor = '', ...targets] = process.argv.slice(2)
const validTargets = new Set(['nsis', 'portable', 'dir'])
if ((flavor !== 'stable' && flavor !== 'dev') || targets.length === 0 || targets.some(target => !validTargets.has(target))) {
  process.stderr.write('usage: node scripts/pack-desktop.js <stable|dev> <nsis|portable|dir> [...]\n')
  process.exit(2)
}

const flavorFile = join(projectRoot, 'src', 'build-flavor.js')
const previousFlavor = readFileSync(flavorFile, 'utf8')
const e2eBuild = process.env.DSH_E2E_BUILD === '1'
if (e2eBuild && flavor !== 'dev') {
  throw new Error('E2E build capability is only allowed for dev flavor.')
}
writeFileSync(flavorFile, `export const BUILD_FLAVOR = '${flavor}'\nexport const E2E_BUILD = ${e2eBuild}\n`)

// electron-builder invokes `pnpm list --json` for node-module collection.
// This machine has no global pnpm, so provide a temporary pnpm.cmd shim that
// runs the vendored pnpm from this repository.
const pnpmShimDir = mkdtempSync(join(tmpdir(), 'dsh-pnpm-shim-'))
const vendoredPnpm = join(projectRoot, 'vendor', 'pnpm', 'bin', 'pnpm.cjs')
writeFileSync(join(pnpmShimDir, 'pnpm.cmd'), `@echo off\r\nnode "${vendoredPnpm}" %*\r\n`, { encoding: 'utf8' })
const pnpmShimPath = `${pnpmShimDir}${delimiter}${process.env.PATH ?? ''}`

function run(label, executable, args, env) {
  process.stdout.write(`${label}...\n`)
  const result = spawnSync(executable, args, {
    cwd: projectRoot,
    encoding: 'utf8',
    windowsHide: true,
    env: { ...process.env, ...env },
  })
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  if (result.status !== 0) {
    throw new Error(`${label} failed with exit status ${String(result.status ?? 1)}.`)
  }
}

let exitCode = 0
try {
  if (flavor === 'stable') {
    run('publish preflight', process.execPath, ['scripts/preflight-publish.js'])
  }
  run('plugin build', process.execPath, ['scripts/build-plugins.js'])
  run('launch gate', process.execPath, ['scripts/verify-launch.js'])
  const builder = join(projectRoot, 'node_modules', 'electron-builder', 'out', 'cli', 'cli.js')
  const builderArgs = [builder, '--win', ...targets, '--x64', '--publish', 'never']
  if (flavor === 'dev') {
    builderArgs.push(
      '-c.appId=com.cyrus.deepseek-harness-personal-dev',
      '-c.productName=DeepSeek Harness Personal Dev',
      '-c.nsis.shortcutName=DeepSeek Harness Personal Dev',
      '-c.nsis.artifactName=DeepSeek-Harness-Personal-Dev-${version}-setup-${arch}.${ext}',
      '-c.portable.artifactName=DeepSeek-Harness-Personal-Dev-${version}-portable-${arch}.${ext}',
      '-c.directories.output=artifacts-dev',
    )
  }
  run(`electron-builder (${flavor})`, process.execPath, builderArgs, { PATH: pnpmShimPath })
  const unpackedExe = flavor === 'dev'
    ? join(projectRoot, 'artifacts-dev', 'win-unpacked', 'DeepSeek Harness Personal Dev.exe')
    : join(projectRoot, 'artifacts', 'win-unpacked', 'DeepSeek Harness Personal.exe')
  const unpackedAppDir = flavor === 'dev'
    ? join(projectRoot, 'artifacts-dev', 'win-unpacked', 'resources', 'app')
    : join(projectRoot, 'artifacts', 'win-unpacked', 'resources', 'app')
  if (existsSync(unpackedExe) && existsSync(unpackedAppDir)) {
    const receiptPath = flavor === 'dev'
      ? join(projectRoot, 'artifacts-dev', 'build-receipt.json')
      : join(projectRoot, 'artifacts', 'build-receipt.json')
    const receipt = writeBuildReceipt({ projectRoot, flavor, exePath: unpackedExe, packagedAppDir: unpackedAppDir, receiptPath, e2eBuild })
    process.stdout.write(`build receipt written: ${receipt.path}\n`)
  }
  if (targets.some(target => target === 'nsis' || target === 'portable')) {
    run('artifact checksums', process.execPath, ['scripts/write-artifact-checksums.js'], {
      DSH_ARTIFACT_DIR: flavor === 'dev' ? 'artifacts-dev' : 'artifacts',
    })
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  exitCode = 1
} finally {
  writeFileSync(flavorFile, previousFlavor)
  rmSync(pnpmShimDir, { recursive: true, force: true })
}
if (exitCode === 0) process.stdout.write(`${flavor} packaging complete.\n`)
process.exit(exitCode)
