// scripts/check-bundle-identity.js — D0 一致性检查器
// 合同（架构书 ADR-09 D / §8.11 D-02 / D-04）：
//   package.json name = clientBundle(id)（lib/client.js 内 handoff 标记）= cordis.patch.yml row 名
//   每个运行时插件必须声明 dsh.bundle.patch；Preset 不插 row。
// 默认报告模式（exit 0，供基线证据）；--strict 作为安装/发布门禁（任一违例 exit 1）。
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(import.meta.dirname, '..')
const PLUGINS = join(REPO, 'plugins')
const SHARED_PATCH = join(PLUGINS, 'cordis.patch.yml')

/** 读取 cordis.patch.yml 中 insert 条目（- id: X 后跟 name: Y）的 id/name 对；同时收集顶层条目 id。 */
export function collectPatchRows(patchSource) {
  const rows = []
  const lines = patchSource.split(/\r?\n/)
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^\s*-\s+id:\s*['"]?([A-Za-z0-9@/._-]+)['"]?\s*$/.exec(lines[index])
    if (!match) continue
    const id = match[1]
    let name
    for (let next = index + 1; next < Math.min(index + 4, lines.length); next += 1) {
      const nameMatch = /^\s*name:\s*['"]?([^'"]+)['"]?\s*$/.exec(lines[next])
      if (nameMatch) { name = nameMatch[1]; break }
      if (/^\s*-\s+id:/.test(lines[next])) break
    }
    rows.push({ id, name })
  }
  return rows
}

/** client bundle 的 handoff id 是否等于包名（与 build-plugins.js 校验同口径）。 */
export function hasClientBundleId(clientSource, packageName) {
  return clientSource.includes(`id: ${JSON.stringify(packageName)}`)
}

/** 列出插件目录（有 package.json 的目录，排除共享 patch 与隐藏项）。 */
export function listPluginDirectories(pluginsRoot = PLUGINS) {
  return readdirSync(pluginsRoot)
    .filter(name => !name.startsWith('.') && name !== 'cordis.patch.yml')
    .filter(name => existsSync(join(pluginsRoot, name, 'package.json')))
    .sort()
}

/**
 * 分析单个插件目录。返回：
 * { packageName, hasBundle, patchPath (shared|own|none), rowId, rowName,
 *   handoffOk (boolean|'no-client-bundle'), verdict, issues[] }
 */
export function analyzePlugin(directory, { sharedPatchSource, sharedRows }) {
  const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))
  const packageName = manifest.name
  const issues = []
  let hasBundle = false
  let patchPath = 'none'
  let rowId
  let rowName
  const ownPatch = join(directory, 'cordis.patch.yml')

  if (typeof manifest.dsh?.bundle?.patch === 'string' && manifest.dsh.bundle.patch.length > 0) {
    hasBundle = true
  }
  let rows = sharedRows
  if (existsSync(ownPatch)) {
    patchPath = 'own'
    rows = collectPatchRows(readFileSync(ownPatch, 'utf8'))
  } else if (sharedPatchSource !== undefined && sharedRows !== undefined && sharedRows.length > 0) {
    patchPath = 'shared'
  }
  for (const row of rows ?? []) {
    if (row.name === packageName || row.id === packageName) {
      rowId = row.id
      rowName = row.name
      break
    }
  }
  if (rowId !== undefined && rowId !== packageName) {
    issues.push(`row id ${JSON.stringify(rowId)} != package name ${JSON.stringify(packageName)}`)
  }
  const clientBundle = join(directory, 'lib', 'client.js')
  let handoffOk = 'no-client-bundle'
  if (existsSync(clientBundle)) {
    handoffOk = hasClientBundleId(readFileSync(clientBundle, 'utf8'), packageName)
    if (!handoffOk) issues.push('client bundle handoff id mismatch')
  }
  if (!hasBundle) issues.push('missing dsh.bundle.patch')
  const verdict = issues.length === 0 ? 'ready' : 'needs-work'
  return { packageName, hasBundle, patchPath, rowId, rowName, handoffOk, verdict, issues }
}

/** 全仓分析：pluginsRoot 下每个插件目录。 */
export function analyzeRepository({ pluginsRoot = PLUGINS, sharedPatch = SHARED_PATCH } = {}) {
  const sharedSource = existsSync(sharedPatch) ? readFileSync(sharedPatch, 'utf8') : undefined
  const sharedRows = sharedSource === undefined ? undefined : collectPatchRows(sharedSource)
  return listPluginDirectories(pluginsRoot).map(name => analyzePlugin(join(pluginsRoot, name), {
    sharedPatchSource: sharedSource,
    sharedRows,
  }))
}

/** 违例判定（--strict 门禁）：有 client bundle 却缺 dsh.bundle / handoff 错 / row 名错。 */
export function hasViolation(record) {
  if (!record.hasBundle && record.handoffOk !== 'no-client-bundle') return true
  if (record.handoffOk === false) return true
  if (record.rowId !== undefined && record.rowId !== record.packageName) return true
  return false
}

export function formatReport(records) {
  const lines = []
  lines.push('插件一致性报告（name = handoff id = row name；dsh.bundle 在位）')
  lines.push('─'.repeat(100))
  for (const record of records) {
    lines.push(
      `${record.packageName.padEnd(38)} bundle:${String(record.hasBundle).padEnd(5)} `
      + `handoff:${String(record.handoffOk).padEnd(18)} row:${record.patchPath === 'none' ? '(none)' : `${record.rowId ?? '?'}/${record.rowName ?? '?'}`} `
      + `=> ${record.verdict}${record.issues.length ? ' — ' + record.issues.join('; ') : ''}`,
    )
  }
  lines.push('─'.repeat(100))
  const ready = records.filter(record => record.verdict === 'ready').length
  lines.push(`${ready}/${records.length} 已符合 bundle 合同；违例 ${records.filter(hasViolation).length} 项。`)
  return lines.join('\n')
}

export function main(argv = process.argv.slice(2)) {
  const strict = argv.includes('--strict')
  const records = analyzeRepository()
  process.stdout.write(formatReport(records) + '\n')
  if (strict && records.some(hasViolation)) process.exit(1)
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
}
