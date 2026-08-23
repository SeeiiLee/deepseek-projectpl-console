// scripts/project-global-agents.js — Global AGENTS 受控投影（决策 8：只投影 Dev DSH_HOME）
// 规范源：docs/agent-instructions/global-AGENTS.md
// 目标：<DSH_HOME>/AGENTS.md（默认 %USERPROFILE%\.dsh\AGENTS.md）
// 纪律：稳定版安装目录 / F 盘数据目录一律拒绝；写入前备份旧副本为 AGENTS.md.previous；
//       写入后回读做 SHA-256 校验；打印目标绝对路径与两端哈希供审阅。
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { STABLE_DATA_HOME, STABLE_INSTALL_ROOT } from './protected-paths.js'

const MODULE_DIR = dirname(fileURLToPath(import.meta.url))
export const CANONICAL_PATH = resolve(MODULE_DIR, '..', 'docs', 'agent-instructions', 'global-AGENTS.md')

function inside(root, candidate) {
  const normalized = resolve(root).replace(/[\\/]+$/u, '')
  const target = resolve(candidate).toLowerCase()
  return target === normalized.toLowerCase() || target.startsWith(normalized.toLowerCase() + sep)
}

export function resolveTargetHome(env = process.env) {
  return resolve(env.DSH_HOME || join(env.USERPROFILE ?? homedir(), '.dsh'))
}

export function sha256Hex(text) {
  return createHash('sha256').update(text).digest('hex')
}

export function projectGlobalAgents(home = resolveTargetHome(), canonicalPath = CANONICAL_PATH) {
  for (const forbidden of [STABLE_INSTALL_ROOT, STABLE_DATA_HOME]) {
    if (inside(forbidden, home)) {
      throw new Error('投影拒绝：目标 home 位于稳定版安装/数据目录内。稳定版只走正式安装/升级流程（手册决策 8）。')
    }
  }
  const target = join(resolve(home), 'AGENTS.md')
  if (!target.toLowerCase().endsWith(sep + 'agents.md')) {
    throw new Error('投影拒绝：目标不是 <DSH_HOME>/AGENTS.md。')
  }
  const content = readFileSync(canonicalPath, 'utf8')
  const canonicalHash = sha256Hex(content)
  const existed = existsSync(target)
  const previous = existed ? readFileSync(target, 'utf8') : null
  if (previous === content) {
    return { target, changed: false, existed: true, canonicalHash, targetHash: canonicalHash, backup: null }
  }
  if (!existsSync(dirname(target))) mkdirSync(dirname(target), { recursive: true })
  if (existed) writeFileSync(target + '.previous', previous)
  writeFileSync(target, content)
  const targetHash = sha256Hex(readFileSync(target, 'utf8'))
  return { target, changed: true, existed, canonicalHash, targetHash, backup: existed ? target + '.previous' : null }
}

if (process.argv[1] !== undefined && new URL('file://' + resolve(process.argv[1])).href === new URL(import.meta.url).href) {
  const homeArg = process.argv[2] ? resolve(process.argv[2]) : resolveTargetHome()
  const result = projectGlobalAgents(homeArg)
  process.stdout.write('Global AGENTS 投影报告\n')
  process.stdout.write('  规范源: ' + CANONICAL_PATH + '\n')
  process.stdout.write('  目标:   ' + result.target + '\n')
  process.stdout.write('  源哈希: ' + result.canonicalHash + '\n')
  process.stdout.write('  目标哈希: ' + result.targetHash + '\n')
  process.stdout.write('  变更:   ' + (result.changed ? '是（已写入' + (result.existed ? '，旧副本保留为 AGENTS.md.previous' : '，此前不存在') + '）' : '否（内容已一致）') + '\n')
  process.stdout.write('  校验:   ' + (result.targetHash === result.canonicalHash ? 'PASS' : 'FAIL') + '\n')
  process.exit(result.targetHash === result.canonicalHash ? 0 : 1)
}
