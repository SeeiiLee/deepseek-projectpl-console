// scripts/generate-plugin-set.mjs — plugin-set.lock.json 生成器（架构书 D-12 / D-04）
// 从 18 个插件目录 manifest 生成机器可读安装集合与版本锁：精确版本、tarball SHA-256、
// 角色、必需依赖、冲突、安装顺序、兼容 Harness（rc.2）。Personal Desktop 构建后续从它
// 生成插件清单/overlay，消除 PERSONAL_PLUGINS 与共享 YAML 的双维护。
// 用法：
//   node scripts/generate-plugin-set.mjs [--out <path>] [--pack-dir <dir>]  生成（默认写仓库根 plugin-set.lock.json）
//   node scripts/generate-plugin-set.mjs --check                           校验现有锁与当前 manifest 一致
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { EXPECTED_HARNESS_COMMIT, EXPECTED_HARNESS_VERSION } from './build-kit.mjs'

export const DEFAULT_LOCK_PATH = 'plugin-set.lock.json'

/** 读取插件目录的 manifest 与 dshComposable。 */
export function collectPlugins(pluginsRoot) {
  const plugins = []
  for (const entry of readdirSync(pluginsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const dir = join(pluginsRoot, entry.name)
    const manifestPath = join(dir, 'package.json')
    if (!existsSync(manifestPath)) continue
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    const composable = manifest.dshComposable ?? {}
    if (typeof manifest.name !== 'string' || typeof manifest.version !== 'string') continue
    plugins.push({
      name: manifest.name,
      version: manifest.version,
      dir,
      bundle: typeof manifest.dsh?.bundle?.patch === 'string',
      role: composable.role,
      requires: composable.requires?.packages ?? [],
      bridges: composable.bridges ?? [],
      conflicts: composable.conflicts ?? [],
      dataDir: composable.data?.dirName,
    })
  }
  return plugins.sort((a, b) => (a.name < b.name ? -1 : 1))
}

/** npm pack 到临时目录并计算 tarball SHA-256。 */
export function packPlugin(plugin, packDir) {
  // Windows 上 npm 是 .cmd shim：spawn 必须经过 shell（与官方 CLI 同口径）。
  const result = spawnSync('npm', ['pack', '--pack-destination', packDir, '--silent'], {
    cwd: plugin.dir,
    encoding: 'utf8',
    windowsHide: true,
    shell: process.platform === 'win32',
  })
  if (result.error !== undefined || result.status !== 0) {
    throw new Error(`npm pack 失败 (${plugin.name}): ${result.error?.message ?? result.stderr ?? result.stdout}`)
  }
  const tgz = join(packDir, result.stdout.trim().split(/\r?\n/).at(-1) ?? '')
  if (!existsSync(tgz)) throw new Error(`npm pack 未产出 tarball (${plugin.name})`)
  const sha256 = createHash('sha256').update(readFileSync(tgz)).digest('hex')
  return { tgz, sha256 }
}

/** 依赖先行、名字字典序稳定的安装顺序；环则抛错。 */
export function buildInstallOrder(plugins) {
  const byName = new Map(plugins.map(p => [p.name, p]))
  const order = []
  const visited = new Set()
  const visit = (name, stack) => {
    if (visited.has(name)) return
    if (stack.includes(name)) throw new Error(`依赖环: ${[...stack, name].join(' → ')}`)
    const plugin = byName.get(name)
    for (const required of plugin?.requires ?? []) {
      if (byName.has(required)) visit(required, [...stack, name])
    }
    visited.add(name)
    order.push(name)
  }
  for (const plugin of plugins) visit(plugin.name, [])
  return order
}

/** 从收集结果构造锁对象（纯函数，可测）。 */
export function computeLock({ plugins, harness, generatedAt }) {
  const packages = {}
  for (const plugin of plugins) {
    packages[plugin.name] = {
      version: plugin.version,
      integrity: plugin.integrity,
      source: 'tgz',
      role: plugin.role,
      bundle: plugin.bundle,
      ...(plugin.requires.length > 0 ? { requires: plugin.requires } : {}),
      ...(plugin.bridges.length > 0 ? { bridges: plugin.bridges } : {}),
      ...(plugin.conflicts.length > 0 ? { conflicts: plugin.conflicts } : {}),
      ...(plugin.dataDir !== undefined ? { dataDir: plugin.dataDir } : {}),
    }
  }
  return {
    schemaVersion: 1,
    preset: 'personal-desktop',
    generatedAt,
    compatibleHarness: { version: harness.version, commit: harness.commit },
    packages,
    installOrder: buildInstallOrder(plugins),
  }
}

/** 校验两个锁的包集合一致（name/version/integrity/requires/bundle/installOrder）。 */
export function locksEquivalent(a, b) {
  const aNames = Object.keys(a.packages).sort()
  const bNames = Object.keys(b.packages).sort()
  if (JSON.stringify(aNames) !== JSON.stringify(bNames)) return false
  if (JSON.stringify(a.installOrder) !== JSON.stringify(b.installOrder)) return false
  if (a.compatibleHarness?.commit !== b.compatibleHarness?.commit) return false
  for (const name of aNames) {
    const x = a.packages[name]
    const y = b.packages[name]
    if (x.version !== y.version || x.integrity !== y.integrity || x.bundle !== y.bundle
      || JSON.stringify(x.requires ?? []) !== JSON.stringify(y.requires ?? [])
      || x.role !== y.role) return false
  }
  return true
}

export function main(argv = process.argv.slice(2)) {
  const projectRoot = resolve(import.meta.dirname, '..')
  const pluginsRoot = join(projectRoot, 'plugins')
  const outArg = argv.find((a, i) => a === '--out') ? argv[argv.indexOf('--out') + 1] : undefined
  const packDir = argv.find((a, i) => a === '--pack-dir') ? argv[argv.indexOf('--pack-dir') + 1] : undefined
  const checkOnly = argv.includes('--check')
  const outPath = outArg !== undefined ? resolve(outArg) : join(projectRoot, DEFAULT_LOCK_PATH)

  const plugins = collectPlugins(pluginsRoot)
  if (plugins.length === 0) throw new Error('未收集到任何插件')
  const tempPackDir = packDir !== undefined ? resolve(packDir) : join(process.env.TEMP ?? '.', 'dsh-plugin-set-pack')
  if (!checkOnly && !existsSync(tempPackDir)) mkdirSync(tempPackDir, { recursive: true })
  for (const plugin of plugins) {
    if (checkOnly) {
      const lock = readJsonSafe(outPath)
      plugin.integrity = lock?.packages?.[plugin.name]?.integrity
    } else {
      plugin.integrity = packPlugin(plugin, tempPackDir).sha256
    }
  }
  const lock = computeLock({
    plugins,
    harness: { version: EXPECTED_HARNESS_VERSION, commit: EXPECTED_HARNESS_COMMIT },
    generatedAt: new Date().toISOString(),
  })
  if (checkOnly) {
    const existing = readJsonSafe(outPath)
    if (existing === null || !locksEquivalent(existing, lock)) {
      process.stderr.write('plugin-set.lock.json 与当前 manifest 不一致。\n')
      process.exit(1)
    }
    process.stdout.write(`plugin-set.lock.json 一致（${plugins.length} 包）。\n`)
    return
  }
  writeFileSync(outPath, JSON.stringify(lock, null, 2) + '\n')
  process.stdout.write(`已生成 ${outPath}（${plugins.length} 包）。\n`)
}

function readJsonSafe(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
}
