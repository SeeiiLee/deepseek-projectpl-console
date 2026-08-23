import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, parse, resolve } from 'node:path'
import { launchHarness } from './harness-process.js'
import { createProjectControlSelectionSecret } from './project-control-selection-ticket.js'

/** Boot and gracefully stop a candidate Harness runtime with isolated, keyless state. */
export async function preflightHarnessRuntime(sourceRoot, options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-personal-runtime-preflight-'))
  const workspaceRoot = join(root, 'workspace')
  const dshHome = join(root, 'dsh-home')
  const agentsHome = join(root, 'agents-home')
  const projectControlHome = join(root, 'project-control')
  const externalPluginsRoot = join(root, 'plugins-external')
  const processHome = join(root, 'process-home')
  const roamingData = join(processHome, 'AppData', 'Roaming')
  const localData = join(processHome, 'AppData', 'Local')
  const processTemp = join(localData, 'Temp')
  const corepackHome = join(localData, 'Corepack')
  const npmCache = join(localData, 'npm-cache')
  const pnpmStore = join(localData, 'pnpm-store')
  const npmConfig = join(processHome, 'empty-npmrc')
  // 2026-08-21：新版 npm 拒绝同一文件同时作为 user 与 global 配置加载
  // （double-loading config ... as "global", previously loaded as "user"），
  // global 必须使用独立文件。
  const npmGlobalConfig = join(processHome, 'empty-npmrc-global')
  await Promise.all([
    mkdir(workspaceRoot),
    mkdir(agentsHome),
    mkdir(externalPluginsRoot, { recursive: true }),
    mkdir(roamingData, { recursive: true }),
    mkdir(localData, { recursive: true }),
    mkdir(processTemp, { recursive: true }),
    mkdir(corepackHome, { recursive: true }),
    mkdir(npmCache, { recursive: true }),
    mkdir(pnpmStore, { recursive: true }),
  ])
  await writeFile(npmConfig, '', 'utf8')
  await writeFile(npmGlobalConfig, '', 'utf8')
  let supervisor
  let stopped = false
  let failure
  try {
    if (options.signal?.aborted) throw new Error('Harness 更新预检已取消。')
    const env = createMinimalEnvironment(options.environment ?? process.env)
    Object.assign(env, {
      HOME: processHome,
      USERPROFILE: processHome,
      APPDATA: roamingData,
      LOCALAPPDATA: localData,
      TEMP: processTemp,
      TMP: processTemp,
      TMPDIR: processTemp,
      XDG_CONFIG_HOME: join(processHome, '.config'),
      XDG_CACHE_HOME: join(processHome, '.cache'),
      COREPACK_HOME: corepackHome,
      NPM_CONFIG_USERCONFIG: npmConfig,
      NPM_CONFIG_GLOBALCONFIG: npmGlobalConfig,
      NPM_CONFIG_CACHE: npmCache,
      NPM_CONFIG_STORE_DIR: pnpmStore,
      NPM_CONFIG_UPDATE_NOTIFIER: 'false',
      NPM_CONFIG_FUND: 'false',
      NPM_CONFIG_AUDIT: 'false',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
      GIT_TERMINAL_PROMPT: '0',
      GCM_INTERACTIVE: 'Never',
      GCM_GUI_PROMPT: '0',
      CI: '1',
      NO_UPDATE_NOTIFIER: '1',
      DSH_HOME: dshHome,
      DSH_AGENTS_HOME: agentsHome,
      PROJECT_CONTROL_HOME: projectControlHome,
      PROJECT_CONTROL_SELECTION_SECRET: createProjectControlSelectionSecret(),
      DSH_SOURCE_ROOT: resolve(sourceRoot),
      DSH_WORKSPACE_ROOT: workspaceRoot,
      DSH_TELEMETRY_DISABLED: '1',
      ...(process.platform === 'win32' ? windowsHomeVariables(processHome) : {}),
    })
    supervisor = (options.launch ?? launchHarness)({
      sourceRoot,
      workspaceRoot,
      env,
      // Preflight is fully isolated: the helper must never see the real
      // userData external root or a user-supplied flavor. The external root is
      // inside this run's temporary root, and the flavor is the caller-trusted
      // desktop flavor (stable by default for candidate runtime preflight).
      externalPluginsRoot,
      desktopFlavor: options.desktopFlavor ?? 'stable',
      startupTimeoutMs: options.startupTimeoutMs ?? 120_000,
      shutdownTimeoutMs: options.shutdownTimeoutMs ?? 10_000,
    })
    options.onSupervisor?.(supervisor)
    await abortable(supervisor.ready, options.signal)
    const result = await supervisor.stop()
    stopped = true
    options.onSupervisorStopped?.(supervisor)
    if (!result.graceful || result.forced || result.code !== 0 || result.signal !== null) {
      throw new Error(`Candidate Harness failed the shutdown check: ${JSON.stringify(result)}`)
    }
  } catch (error) {
    failure = error
  } finally {
    if (supervisor !== undefined && !stopped) {
      try {
        await supervisor.stop()
        stopped = true
        options.onSupervisorStopped?.(supervisor)
      } catch (error) {
        console.error(`Unable to stop failed Harness preflight: ${error instanceof Error ? error.message : String(error)}`)
        const cleanupError = new Error('无法确认 Harness 更新预检进程已经退出。', { cause: error })
        cleanupError.code = 'PREFLIGHT_CLEANUP_UNCONFIRMED'
        failure = failure === undefined ? cleanupError : new AggregateError([failure, cleanupError], cleanupError.message)
      }
    }
    try {
      await rm(root, { recursive: true, force: true })
    } catch (error) {
      const cleanupError = new Error('无法清理 Harness 更新预检临时目录。', { cause: error })
      cleanupError.code = 'PREFLIGHT_CLEANUP_UNCONFIRMED'
      failure = failure === undefined ? cleanupError : new AggregateError([failure, cleanupError], cleanupError.message)
    }
  }
  if (failure !== undefined) throw failure
}

function abortable(promise, signal) {
  if (signal === undefined) return promise
  if (signal.aborted) return Promise.reject(new Error('Harness 更新预检已取消。'))
  return new Promise((resolvePromise, rejectPromise) => {
    const abort = () => {
      cleanup()
      rejectPromise(new Error('Harness 更新预检已取消。'))
    }
    const cleanup = () => signal.removeEventListener('abort', abort)
    signal.addEventListener('abort', abort, { once: true })
    promise.then(
      value => {
        cleanup()
        resolvePromise(value)
      },
      error => {
        cleanup()
        rejectPromise(error)
      },
    )
  })
}

const SAFE_ENVIRONMENT_KEYS = new Set([
  'PATH',
  'PATHEXT',
  'SYSTEMROOT',
  'WINDIR',
  'COMSPEC',
  'TEMP',
  'TMP',
  'TMPDIR',
  'SYSTEMDRIVE',
  'OS',
  'PROGRAMFILES',
  'PROGRAMFILES(X86)',
  'PROGRAMW6432',
  'COMMONPROGRAMFILES',
  'COMMONPROGRAMFILES(X86)',
  'COMMONPROGRAMW6432',
  'PROCESSOR_ARCHITECTURE',
  'PROCESSOR_ARCHITEW6432',
  'NUMBER_OF_PROCESSORS',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TZ',
  // 2026-08-17：pnpm/node 工具链需要的主目录与本地应用数据（非凭据）；
  // 缺失时 pnpm 在真实安装中行为异常（更新器 Harness prepare 曾静默失败）。
  'USERPROFILE',
  'HOME',
  'HOMEDRIVE',
  'HOMEPATH',
  'USERNAME',
  'ALLUSERSPROFILE',
  'LOCALAPPDATA',
  'APPDATA',
])

/** Build a launch environment from a small non-credential allowlist. */
export function createMinimalEnvironment(environment) {
  const clean = {}
  for (const [key, value] of Object.entries(environment)) {
    if (typeof value === 'string' && SAFE_ENVIRONMENT_KEYS.has(key.toUpperCase())) clean[key] = value
  }
  return clean
}

function windowsHomeVariables(processHome) {
  const drive = parse(processHome).root.replace(/[\\/]+$/u, '')
  return {
    HOMEDRIVE: drive,
    HOMEPATH: processHome.slice(drive.length),
  }
}
