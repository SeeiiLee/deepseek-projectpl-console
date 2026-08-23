// scripts/build-kit.mjs — rc.2 构建根解析与校验（架构书 D-13 / C-27 / §16.3）
// 合同：源码构建必须显式解析到已验证的 rc.2 checkout；不允许相邻源码目录成为公开构建合同。
// 解析顺序：
//   1. env DSH_SOURCE_ROOT（显式给出，仍须通过校验）
//   2. 开发版托管运行时：%APPDATA%\DeepSeek Harness Personal Dev\update-center.json 的 activeHarnessRoot
//   3. 都没有 → fail closed，给出可执行提示
// 校验：package.json version = 0.1.1-rc.2、git HEAD = b150a551…、tsdown 与 tsdown.client.ts 在位。
// 本模块还维护仓库根 harness-src junction（gitignore 的 dev seam），供插件 tsconfig/tsdown 的
// 相对引用（../../../harness-src/...）解析到构建根；不提交、不进包、干净 clone 无此链接时按上方顺序重建。
import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, readFileSync, readlinkSync, symlinkSync, unlinkSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const EXPECTED_HARNESS_COMMIT = 'b150a551b8d465e31e418e1b2eaf5e79bbb7d28e'
export const EXPECTED_HARNESS_VERSION = '0.1.1-rc.2'
export const HARNESS_SRC_LINK = 'harness-src'

export class BuildRootError extends Error {}

export function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

/** 读取目录的 git HEAD（非 git 目录返回 null）。 */
export function gitCommit(directory) {
  try {
    return execFileSync('git', ['-C', directory, 'rev-parse', 'HEAD'], {
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return null
  }
}

/** 校验一个构建根是否满足 rc.8 合同；返回问题数组（空 = 通过）。 */
export function verifyBuildRoot(root) {
  const problems = []
  if (!existsSync(join(root, 'package.json'))) {
    problems.push('package.json 不存在')
    return problems
  }
  let version
  try {
    version = readJson(join(root, 'package.json')).version
  } catch (error) {
    problems.push(`package.json 读取失败: ${error.message}`)
  }
  if (version !== EXPECTED_HARNESS_VERSION) {
    problems.push(`版本 ${version ?? '未知'} != ${EXPECTED_HARNESS_VERSION}`)
  }
  const commit = gitCommit(root)
  if (commit !== EXPECTED_HARNESS_COMMIT) {
    problems.push(`git HEAD ${commit ?? '非 git 目录'} != ${EXPECTED_HARNESS_COMMIT}`)
  }
  if (!existsSync(join(root, 'node_modules', 'tsdown', 'dist', 'run.mjs'))) {
    problems.push('node_modules/tsdown 缺失（先在构建根执行 pnpm install）')
  }
  if (!existsSync(join(root, 'packages', 'client', 'tsdown.client.ts'))) {
    problems.push('packages/client/tsdown.client.ts 缺失（不是完整源码树）')
  }
  return problems
}

/** 从开发版 userData 的 update-center.json 解析当前激活托管运行时（无则 null）。 */
export function resolveActiveRuntimeRoot({ env = process.env, appData = process.env.APPDATA } = {}) {
  const userData = env.DSH_DESKTOP_USER_DATA !== undefined && env.DSH_DESKTOP_USER_DATA !== ''
    ? resolve(env.DSH_DESKTOP_USER_DATA)
    : (appData === undefined || appData === '' ? null : join(appData, 'DeepSeek Harness Personal Dev'))
  if (userData === null) return null
  const statePath = join(userData, 'update-center.json')
  if (!existsSync(statePath)) return null
  try {
    const state = readJson(statePath)
    const root = state.activeHarnessRoot
    if (typeof root === 'string' && root !== '' && existsSync(root)) return root
  } catch {
    // 解析失败视为无激活运行时，走 fail closed
  }
  return null
}

/** 解析并校验构建根；无根或校验失败抛 BuildRootError。 */
export function resolveBuildRoot({ env = process.env, appData = process.env.APPDATA } = {}) {
  const explicit = env.DSH_SOURCE_ROOT
  const root = explicit !== undefined && explicit !== ''
    ? resolve(explicit)
    : resolveActiveRuntimeRoot({ env, appData })
  if (root === null || root === undefined) {
    throw new BuildRootError(
      '无法确定 rc.2 构建根：请设置 DSH_SOURCE_ROOT 指向 rc.2 checkout'
      + `（commit ${EXPECTED_HARNESS_COMMIT}），或先在更新中心激活托管运行时。`,
    )
  }
  const problems = verifyBuildRoot(root)
  if (problems.length > 0) {
    throw new BuildRootError(`构建根校验失败（${root}）：\n- ${problems.join('\n- ')}`)
  }
  return root
}

/** 确保仓库根 harness-src junction 指向构建根（幂等；拒绝替换非链接路径）。 */
export function ensureHarnessSourceLink(projectRoot, buildRoot) {
  const link = join(projectRoot, HARNESS_SRC_LINK)
  const resolvedTarget = resolve(buildRoot)
  try {
    const stat = lstatSync(link)
    if (!stat.isSymbolicLink()) {
      throw new BuildRootError(`拒绝替换非链接路径: ${link}`)
    }
    if (resolve(dirname(link), readlinkSync(link)) === resolvedTarget) return link
    unlinkSync(link)
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  symlinkSync(resolvedTarget, link, process.platform === 'win32' ? 'junction' : 'dir')
  return link
}

export function main(argv = process.argv.slice(2)) {
  const linkOnly = argv.includes('--link')
  const root = resolveBuildRoot()
  if (linkOnly) {
    const projectRoot = resolve(import.meta.dirname, '..')
    const link = ensureHarnessSourceLink(projectRoot, root)
    process.stdout.write(`构建根: ${root}\n`)
    process.stdout.write(`链接: ${link}\n`)
  } else {
    process.stdout.write(root + '\n')
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
}
