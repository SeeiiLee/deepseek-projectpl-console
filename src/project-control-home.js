import { isAbsolute, join, resolve } from 'node:path'

/**
 * Resolve the stable per-user Project Control data directory.
 * Portable extraction paths, DSH_HOME and the current workspace are never used.
 *
 * @param {string} userDataPath Electron's stable userData directory.
 * @param {NodeJS.ProcessEnv} env Optional explicit PROJECT_CONTROL_HOME override.
 */
export function resolveProjectControlHome(userDataPath, env = process.env) {
  const override = env.PROJECT_CONTROL_HOME?.trim()
  if (override !== undefined && override !== '') {
    if (!isAbsolute(override)) {
      throw new Error('PROJECT_CONTROL_HOME must be an absolute path.')
    }
    const absoluteOverride = resolve(override)
    if (process.platform === 'win32' && isUncPath(absoluteOverride)) {
      throw new Error('PROJECT_CONTROL_HOME must use a local Windows drive, not a UNC path.')
    }
    return absoluteOverride
  }
  return join(resolve(userDataPath), 'project-control')
}

function isUncPath(path) {
  return path.startsWith('\\\\') || path.startsWith('//')
}
