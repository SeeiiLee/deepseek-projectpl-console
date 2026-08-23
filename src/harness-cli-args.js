import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * rc.8 起 `dsh web` 默认自动打开浏览器并新增 `--no-open`；更早版本（rc.5 等）
 * 不认识该参数会直接退出（稳定版 v0.4.0 启动失败事故的根因）。
 * 按 apps/cli/package.json 的 version 判定：rc.N 需 N>=8；正式版按支持处理；
 * 读不到版本时按老版本处理（不传新参数，保证能启动）。
 */
export function supportsNoOpen(sourceRoot, readFile = readFileSync) {
  try {
    const pkg = JSON.parse(readFile(join(sourceRoot, 'apps', 'cli', 'package.json'), 'utf8'))
    const match = /^0\.1\.0-rc\.(\d+)$/u.exec(String(pkg?.version ?? ''))
    return match === null ? true : Number(match[1]) >= 8
  } catch {
    return false
  }
}

/** web profile 启动参数：--no-open 只在运行时支持时传入。 */
export function webProfileArgs(sourceRoot, port) {
  const args = ['--host', '127.0.0.1']
  if (supportsNoOpen(sourceRoot)) args.push('--no-open')
  args.push('--port', port)
  return args
}
