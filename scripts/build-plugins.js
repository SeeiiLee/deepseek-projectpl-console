import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { PERSONAL_PLUGINS } from '../src/personal-plugins.js'
import { applyHarnessTsdownFallback } from './apply-harness-tsdown-fallback.mjs'
import { ensureHarnessSourceLink, resolveBuildRoot } from './build-kit.mjs'
import { stageProjectControlRuntimeSchemas } from './project-control-runtime-schemas.mjs'

const projectRoot = resolve(import.meta.dirname, '..')
const forceRebuild = process.argv.includes('--force')
// rc.7 构建根：DSH_SOURCE_ROOT 显式给出或解析活动托管运行时；校验失败即 fail closed。
const sourceRoot = resolveBuildRoot()
ensureHarnessSourceLink(projectRoot, sourceRoot)
// ADR-005 boundary: only the Personal Dev managed runtime copy gets the
// tsdown.client.ts fallback; upstream D:\Deepseek Harness is never patched.
const fallback = applyHarnessTsdownFallback({ root: sourceRoot })
if (fallback.patched) process.stdout.write(`Applied harness tsdown fallback: ${fallback.path}\n`)
const tsdown = join(sourceRoot, 'node_modules', 'tsdown', 'dist', 'run.mjs')
if (!existsSync(tsdown)) {
  throw new Error(`Harness build dependency is missing: ${tsdown}. Run pnpm install in ${sourceRoot}.`)
}

/** 递归收集目录下全部文件路径。 */
function collectFiles(directory, output = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) collectFiles(path, output)
    else if (entry.isFile()) output.push(path)
  }
  return output
}

/**
 * 产物完整且比全部输入新 → 跳过重建。开发版每次启动不再无谓重打包，
 * 只有真正改动过源码/配置的插件才重跑 tsdown；verify-launch 仍逐次校验产物。
 */
function isFreshBuild(directory) {
  const libDirectory = join(directory, 'lib')
  // 只以必需产物为准：部分插件不产出 host/client 两边的 map。
  const outputs = ['index.js', 'client.js'].map(name => join(libDirectory, name))
  if (outputs.some(path => !existsSync(path))) return false
  const inputPaths = [
    ...collectFiles(join(directory, 'src')),
    ...['package.json', 'tsconfig.json', 'tsdown.config.ts']
      .map(name => join(directory, name))
      .filter(existsSync),
  ]
  if (inputPaths.length === 0) return false
  const newestInput = Math.max(...inputPaths.map(path => statSync(path).mtimeMs))
  const oldestOutput = Math.min(...outputs.map(path => statSync(path).mtimeMs))
  return oldestOutput > newestInput
}

for (const { packageName, directoryName } of PERSONAL_PLUGINS) {
  const directory = join(projectRoot, 'plugins', directoryName)
  const manifestPath = join(directory, 'package.json')
  if (!existsSync(manifestPath)) throw new Error(`Personal plugin source is missing: ${manifestPath}`)
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  if (manifest.name !== packageName) {
    throw new Error(`Expected ${packageName} at ${directory}, found ${JSON.stringify(manifest.name)}.`)
  }
  if (packageName === '@cyrus/dsh-project-control') {
    stageProjectControlRuntimeSchemas(projectRoot)
  }
  if (!forceRebuild && isFreshBuild(directory)) {
    process.stdout.write(`Up to date ${packageName} — skipping rebuild.\n`)
    continue
  }
  process.stdout.write(`Building ${packageName}...\n`)
  const result = spawnSync(process.execPath, [tsdown, '--config', 'tsdown.config.ts'], {
    cwd: directory,
    env: { ...process.env, NODE_ENV: process.env.NODE_ENV ?? 'production' },
    encoding: 'utf8',
    windowsHide: true,
  })
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  if (result.status !== 0) process.exit(result.status ?? 1)
  // Verify the produced bundles before the next plugin build so a torn or
  // incompatible bundle can never be the last state on disk.
  const hostBundle = join(directory, 'lib', 'index.js')
  const clientBundle = join(directory, 'lib', 'client.js')
  for (const bundle of [hostBundle, clientBundle]) {
    if (!existsSync(bundle)) {
      throw new Error(`${packageName} build did not produce ${bundle}.`)
    }
    const check = spawnSync(process.execPath, ['--check', bundle], { encoding: 'utf8', windowsHide: true })
    if (check.status !== 0) {
      process.stderr.write(check.stderr ?? '')
      throw new Error(`${packageName} bundle failed the launch syntax check: ${bundle}`)
    }
  }
  const client = readFileSync(clientBundle, 'utf8')
  if (!client.includes(`id: ${JSON.stringify(packageName)}`)) {
    throw new Error(`${packageName} client bundle does not register its exact package id.`)
  }
  process.stdout.write(`Verified ${packageName} bundles.\n`)
}
