import { realpathSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Cyrus 红线：稳定版客户端的路径一律不碰。
 * 这里把「属于稳定版 / 属于用户数据」的目录固化为受保护根：
 *  - 安装目录 D:\Cyrus Deepseek Harness（含其中已安装的稳定版程序与插件）
 *  - 稳定版数据主目录 F:\documents\Cyrus Deepseek Harness Data
 *    （settings、project-control、harness-home、from-test-userdata 全部在内）
 *  - 迁移前遗留的 %APPDATA% 两个客户端数据目录（保留备份，不写不删）
 *  - 迁移前遗留的 %USERPROFILE%\.dsh（保留备份，不写不删）
 * 自动化流程（冒烟、清进程、打包、暂存）对任何受保护路径的写入/删除都会
 * 立即失败。唯一例外是 Cyrus 亲手运行的迁移脚本（见 migrate-to-fdrive.js）。
 */
export const STABLE_INSTALL_ROOT = 'D:\\Cyrus Deepseek Harness'
export const STABLE_DATA_HOME = 'F:\\documents\\Cyrus Deepseek Harness Data'

const roaming = process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming')
export const PROTECTED_ROOTS = Object.freeze([
  STABLE_INSTALL_ROOT,
  STABLE_DATA_HOME,
  join(roaming, 'DeepSeek Harness Personal'),
  join(roaming, 'DeepSeek Harness Personal Dev'),
  join(process.env.USERPROFILE ?? homedir(), '.dsh'),
])

const MODULE_DIR = dirname(fileURLToPath(import.meta.url))
/** The repository root: automation owns everything below it. */
export const REPOSITORY_ROOT = resolve(MODULE_DIR, '..')
/** The system temp root: smoke runs own their temp directories. */
export const SAFE_ROOTS = Object.freeze([REPOSITORY_ROOT, tmpdir()])

function canonical(path) {
  try {
    return realpathSync.native(path)
  } catch {
    return resolve(path)
  }
}

function inside(root, candidate) {
  const target = canonical(candidate)
  // Windows realpath may keep 8.3 short names on one side and long names on
  // the other (or the candidate may not exist yet), so containment is checked
  // against BOTH the realpathed root and the caller's spelling of it.
  for (const rawRoot of [canonical(root), resolve(root)]) {
    const normalized = rawRoot.replace(/[\\/]+$/u, '')
    if (target === normalized) return true
    if (target.toLowerCase().startsWith(normalized.toLowerCase() + sep)) return true
  }
  return false
}

/** Return the protected root containing the path, or null. */
export function protectedRootOf(path) {
  for (const root of PROTECTED_ROOTS) {
    if (inside(root, path)) return root
  }
  return null
}

/**
 * Guard for automation: refuse any path under a protected root, and refuse
 * paths that are neither repository-owned nor under the system temp dir
 * (automation must never invent new write targets outside its own domain).
 * @param {string} path - absolute path about to be written/deleted.
 * @param {string} label - human-readable operation label for the error.
 */
export function assertAutomationSafe(path, label) {
  const absolute = resolve(path)
  const protectedMatch = protectedRootOf(absolute)
  if (protectedMatch !== null) {
    throw new Error(`受保护路径拦截：${label} 目标 ${absolute} 位于稳定版/用户数据目录 ${protectedMatch} 之内，自动化流程禁止写入或删除。`)
  }
  for (const root of SAFE_ROOTS) {
    if (inside(root, absolute)) return absolute
  }
  throw new Error(`安全边界拦截：${label} 目标 ${absolute} 既不在仓库目录也不在系统临时目录内，自动化流程拒绝写入或删除。`)
}

/** True when the path belongs to the repository or the system temp dir. */
export function isAutomationOwned(path) {
  try {
    assertAutomationSafe(path, 'check')
    return true
  } catch {
    return false
  }
}