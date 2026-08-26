import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'

export const BOOT_LOG_RELATIVE_PATH = join('logs', 'boot-error.log')

/** @param {string} userDataPath */
export function resolveBootLogPath(userDataPath) {
  if (typeof userDataPath !== 'string' || userDataPath.trim() === '' || !isAbsolute(userDataPath)) {
    throw new Error('Boot log requires an absolute userData path.')
  }
  return join(resolve(userDataPath), BOOT_LOG_RELATIVE_PATH)
}

/**
 * @param {{userDataPath:string,line:unknown,now?:()=>Date}} options
 */
export function appendBootLogLine({ userDataPath, line, now = () => new Date() }) {
  const path = resolveBootLogPath(userDataPath)
  mkdirSync(dirname(path), { recursive: true })
  appendFileSync(path, `${now().toISOString()} ${String(line)}\n`, { encoding: 'utf8' })
  return path
}
