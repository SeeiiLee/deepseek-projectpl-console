// scripts/plugin-installer.mjs — dshComposable 感知的 installer/doctor（架构书 D-03/D-05/D-10）
// 官方 dsh plugin 只是 pnpm forwarder + dsh.profile.bundles reconcile；必需依赖闭包、
// 环检测、冲突检查与安全卸载由本层负责（ADR-09 B：绕过它直接改 pnpm 造成的坏图不宣称可恢复）。
// 子命令均为只读校验；实际 add/remove 仍通过官方 CLI 执行，本层作为前置/后置门禁。
//   add-check  <profileDir> <packageDir...>  预演加入后的依赖图（缺失/环/冲突）
//   remove-check <profileDir> <name>         校验移除安全性（存在安装中的依赖者则拒绝）
//   graph      <profileDir> [packageDir...]  输出当前图与校验结果
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export class InstallerError extends Error {}

export function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

/** 从 package.json 读取 dshComposable（缺省空对象）。 */
export function composableOf(manifest) {
  return manifest?.dshComposable ?? {}
}

/** 从 profile 目录读取已安装依赖的包名列表。 */
export function installedPackages(profileDir) {
  const manifestPath = join(profileDir, 'package.json')
  if (!existsSync(manifestPath)) throw new InstallerError(`profile manifest 不存在: ${manifestPath}`)
  return Object.keys(readJson(manifestPath).dependencies ?? {})
}

/**
 * 构建依赖图：profile 已装依赖 + 候选包目录。
 * @returns {Map<string, {version, role, requires, conflicts, source}>}
 */
export function buildGraph({ profileDir, candidateDirs = [] }) {
  const graph = new Map()
  for (const name of installedPackages(profileDir)) {
    // 从 profile node_modules 读取已装包 manifest，获取 dshComposable（必需依赖/冲突）。
    const installed = join(profileDir, 'node_modules', ...name.split('/'), 'package.json')
    let composable = {}
    if (existsSync(installed)) composable = composableOf(readJson(installed))
    graph.set(name, {
      version: composable.version,
      role: composable.role,
      requires: composable.requires?.packages ?? [],
      conflicts: composable.conflicts ?? [],
      source: 'profile',
    })
  }
  for (const dir of candidateDirs) {
    const manifestPath = join(dir, 'package.json')
    if (!existsSync(manifestPath)) throw new InstallerError(`候选包缺失 manifest: ${manifestPath}`)
    const manifest = readJson(manifestPath)
    const c = composableOf(manifest)
    graph.set(manifest.name, {
      version: manifest.version,
      role: c.role,
      requires: c.requires?.packages ?? [],
      conflicts: c.conflicts ?? [],
      source: 'candidate',
    })
  }
  return graph
}

/** 缺失必需依赖：graph 中 requires 指向但不在图中的包。 */
export function detectMissing(graph) {
  const missing = []
  for (const [name, pkg] of graph) {
    for (const required of pkg.requires) {
      if (!graph.has(required)) missing.push({ dependent: name, required })
    }
  }
  return missing
}

/** 环检测（DFS，返回第一个环的路径）。 */
export function detectCycles(graph) {
  const visited = new Set()
  const stack = []
  const inStack = new Set()
  for (const start of graph.keys()) {
    if (visited.has(start)) continue
    const walk = (name, path) => {
      if (visited.has(name)) return undefined
      if (inStack.has(name)) {
        const cut = path.indexOf(name)
        return [...path.slice(cut), name]
      }
      inStack.add(name)
      for (const next of graph.get(name)?.requires ?? []) {
        if (!graph.has(next)) continue
        const cycle = walk(next, [...path, name])
        if (cycle !== undefined) return cycle
      }
      inStack.delete(name)
      visited.add(name)
      return undefined
    }
    const cycle = walk(start, [])
    if (cycle !== undefined) return cycle
  }
  return undefined
}

/** 冲突：已装依赖命中某包 conflicts。 */
export function detectConflicts(graph) {
  const issues = []
  for (const [name, pkg] of graph) {
    for (const conflict of pkg.conflicts ?? []) {
      if (graph.has(conflict) && conflict !== name) {
        issues.push({ package: name, conflictsWith: conflict })
      }
    }
  }
  return issues
}

/** 依赖者：图中 require 了 name 的已安装/候选包。 */
export function dependentsOf(graph, name) {
  const dependents = []
  for (const [pkgName, pkg] of graph) {
    if (pkg.requires.includes(name)) dependents.push(pkgName)
  }
  return dependents
}

/** 全量校验：返回 { ok, issues }，issues 为人类可读消息数组。 */
export function validateGraph(graph) {
  const issues = []
  for (const { dependent, required } of detectMissing(graph)) {
    issues.push(`${dependent} 需要 ${required}，但图中不存在（installer 必须一次装齐）`)
  }
  const cycle = detectCycles(graph)
  if (cycle !== undefined) issues.push(`依赖环: ${cycle.join(' → ')}`)
  for (const { package: p, conflictsWith } of detectConflicts(graph)) {
    issues.push(`${p} 与 ${conflictsWith} 冲突`)
  }
  return { ok: issues.length === 0, issues }
}

/** 移除校验：存在安装中的依赖者时抛 InstallerError。 */
export function assertRemoveAllowed(graph, name) {
  if (!graph.has(name)) throw new InstallerError(`${name} 未安装，无需移除`)
  const dependents = dependentsOf(graph, name)
  if (dependents.length > 0) {
    throw new InstallerError(
      `拒绝移除 ${name}：仍有已安装依赖者 [${dependents.join(', ')}]（先移除依赖者或确认降级）`,
    )
  }
}

/** CLI 入口。 */
export function main(argv = process.argv.slice(2)) {
  const [command, profileDir, ...rest] = argv
  if (command === undefined || profileDir === undefined) {
    process.stderr.write('用法: node scripts/plugin-installer.mjs <graph|add-check|remove-check> <profileDir> [packageDir...]\n')
    process.exit(2)
  }
  const dir = resolve(profileDir)
  if (command === 'remove-check') {
    const [name] = rest
    const graph = buildGraph({ profileDir: dir })
    try {
      assertRemoveAllowed(graph, name)
      process.stdout.write(`OK：${name} 可安全移除。\n`)
    } catch (error) {
      if (error instanceof InstallerError) {
        process.stderr.write(error.message + '\n')
        process.exit(1)
      }
      throw error
    }
    return
  }
  const candidateDirs = rest.map(p => resolve(p))
  const graph = buildGraph({ profileDir: dir, candidateDirs })
  const { ok, issues } = validateGraph(graph)
  process.stdout.write(`图节点: ${[...graph.keys()].join(', ') || '(空)'}\n`)
  for (const issue of issues) process.stdout.write('! ' + issue + '\n')
  process.stdout.write(ok ? '图校验通过。\n' : '图校验失败。\n')
  if (!ok) process.exit(1)
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
}
