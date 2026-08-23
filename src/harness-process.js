import { spawn, spawnSync } from 'node:child_process'
import { accessSync, constants } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createLineDecoder, parseReadinessLine } from './readiness.js'
import { createWindowsJobGuard } from './windows-job.js'

export const DEFAULT_SOURCE_ROOT = 'D:\\Deepseek Harness'
export const DEFAULT_STARTUP_TIMEOUT_MS = 90_000
export const DEFAULT_SHUTDOWN_TIMEOUT_MS = 7_000
const FORCE_EXIT_TIMEOUT_MS = 5_000
const OUTPUT_LIMIT = 12_000
const MODULE_DIR = dirname(fileURLToPath(import.meta.url))

/**
 * Resolve and validate the source checkout used by the desktop helper.
 * @param {NodeJS.ProcessEnv} env Environment containing an optional DSH_SOURCE_ROOT.
 * @returns {string} Absolute checkout path.
 */
export function resolveSourceRoot(env = process.env) {
  const root = resolve(env.DSH_SOURCE_ROOT || DEFAULT_SOURCE_ROOT)
  for (const relativePath of [
    ['package.json'],
    ['tsconfig.json'],
    ['apps', 'cli', 'src', 'profile-boot.ts'],
    ['packages', 'boot', 'app-boot', 'src', 'index.ts'],
  ]) {
    accessSync(join(root, ...relativePath), constants.R_OK)
  }
  return root
}

/**
 * From `where.exe node` output pick a real executable. Lines ending in
 * .cmd/.bat/.ps1 are skipped: spawning them without shell:true throws EINVAL
 * on modern Node (CVE-2024-27980 hardening) — v0.4.0 stable hit exactly this
 * when a node.cmd shim outranked node.exe on PATH.
 * @param {string} whereOutput Raw stdout of where.exe/which.
 * @returns {string | undefined} First .exe (or extension-less) candidate.
 */
export function pickNodeExecutableCandidate(whereOutput) {
  const candidates = String(whereOutput ?? '')
    .split(/\r?\n/u)
    .map(line => line.trim())
    .filter(Boolean)
  return candidates.find(candidate => !/\.(cmd|bat|ps1)$/iu.test(candidate))
}

/**
 * Locate a real system Node executable rather than Electron's process executable.
 * @param {NodeJS.ProcessEnv} env Launch environment.
 * @returns {string} Absolute Node executable path.
 */
export function resolveNodeExecutable(env = process.env) {
  if (env.DSH_NODE_EXECUTABLE) {
    const configured = resolve(env.DSH_NODE_EXECUTABLE)
    accessSync(configured, constants.X_OK)
    return configured
  }

  const command = process.platform === 'win32' ? 'where.exe' : 'which'
  const result = spawnSync(command, ['node'], {
    encoding: 'utf8',
    env,
    windowsHide: true,
  })
  const candidate = pickNodeExecutableCandidate(result.stdout)
  if (result.status !== 0 || candidate === undefined) {
    throw new Error('System Node.js was not found on PATH. Install Node.js 24 or newer.')
  }
  accessSync(candidate, constants.X_OK)
  return candidate
}

/**
 * Start a supervised Harness helper. The supervisor is returned immediately so
 * callers can cancel startup as well as a fully ready application.
 * @param {{
 *   sourceRoot?: string,
 *   workspaceRoot?: string,
 *   env?: NodeJS.ProcessEnv,
 *   externalPluginsRoot?: string,
 *   desktopFlavor?: string,
 *   startupTimeoutMs?: number,
 *   shutdownTimeoutMs?: number,
 *   forceExitTimeoutMs?: number,
 *   helperPath?: string,
 *   importTsx?: boolean,
 *   processGuardFactory?: typeof createWindowsJobGuard,
 *   terminateProcessTree?: (pid: number | undefined) => Promise<void>,
 *   onOutput?: (entry: {stream: 'stdout' | 'stderr', text: string}) => void,
 * }} options Launch options.
 * @returns {{
 *   child: import('node:child_process').ChildProcess,
 *   ready: Promise<URL>,
 *   exited: Promise<{code: number | null, signal: NodeJS.Signals | null}>,
 *   recentOutput: () => string,
 *   sourceRoot: string,
 *   workspaceRoot: string,
 *   processProtection: {active: boolean, error?: string},
 *   stop: () => Promise<{graceful: boolean, forced: boolean, code: number | null, signal: NodeJS.Signals | null}>,
 * }} Running supervisor.
 */
export function launchHarness(options = {}) {
  const inheritedEnv = options.env ?? process.env
  const sourceRoot = resolveSourceRoot({
    ...inheritedEnv,
    ...(options.sourceRoot ? { DSH_SOURCE_ROOT: options.sourceRoot } : {}),
  })
  const workspaceRoot = resolve(options.workspaceRoot ?? inheritedEnv.DSH_WORKSPACE_ROOT ?? sourceRoot)
  accessSync(workspaceRoot, constants.R_OK)

  const nodeExecutable = resolveNodeExecutable(inheritedEnv)
  const helperPath = resolve(options.helperPath ?? join(MODULE_DIR, 'harness-helper.js'))
  accessSync(helperPath, constants.R_OK)
  const nodeArguments = []
  if (options.importTsx !== false) {
    const requireFromHarness = createRequire(join(sourceRoot, 'package.json'))
    const tsxLoader = requireFromHarness.resolve('tsx/esm')
    nodeArguments.push('--import', pathToFileURL(tsxLoader).href)
  }
  nodeArguments.push(helperPath)

  const child = spawn(nodeExecutable, nodeArguments, {
    cwd: workspaceRoot,
    env: {
      ...inheritedEnv,
      DSH_SOURCE_ROOT: sourceRoot,
      TSX_TSCONFIG_PATH: join(sourceRoot, 'tsconfig.json'),
      // Trusted main -> helper injection: the helper cannot call
      // app.getPath('userData'), so the desktop main passes the actual
      // userData-derived external root and the immutable build flavor.
      ...(options.externalPluginsRoot !== undefined && options.externalPluginsRoot !== ''
        ? { DSH_PERSONAL_PLUGINS_EXTERNAL: options.externalPluginsRoot }
        : {}),
      ...(options.desktopFlavor !== undefined && options.desktopFlavor !== ''
        ? { DSH_DESKTOP_FLAVOR: options.desktopFlavor }
        : {}),
    },
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    windowsHide: true,
  })
  const processGuard = (options.processGuardFactory ?? createWindowsJobGuard)(child.pid)
  const forceTerminate = options.terminateProcessTree ?? terminateProcessTree

  let readySettled = false
  let readyUrl
  let bootedAcknowledged = false
  let closed = false
  let stopping = false
  let stoppedAcknowledged = false
  let recentOutput = ''
  let stopPromise
  let startupTimer
  let resolveReady
  let rejectReady
  let resolveExited

  const ready = new Promise((resolvePromise, rejectPromise) => {
    resolveReady = resolvePromise
    rejectReady = rejectPromise
  })
  const exited = new Promise(resolvePromise => {
    resolveExited = resolvePromise
  })

  const remember = (stream, text) => {
    options.onOutput?.({ stream, text })
    recentOutput = `${recentOutput}${text}`.slice(-OUTPUT_LIMIT)
  }
  if (!processGuard.active && process.platform === 'win32') {
    remember('stderr', `Windows process-tree guard unavailable: ${processGuard.error}\n`)
  }
  const failReady = (error) => {
    if (readySettled) return
    readySettled = true
    clearTimeout(startupTimer)
    const detail = recentOutput.trim()
    rejectReady(detail === '' ? error : new Error(`${error.message}\n\n${detail}`, { cause: error }))
  }
  const abortReady = () => {
    const error = new Error('Harness startup was cancelled.')
    error.name = 'AbortError'
    failReady(error)
  }
  const completeReady = () => {
    if (readySettled || stopping || readyUrl === undefined || !bootedAcknowledged) return
    readySettled = true
    clearTimeout(startupTimer)
    resolveReady(readyUrl)
  }

  const stdoutDecoder = createLineDecoder(line => {
    remember('stdout', `${line}\n`)
    let url
    try {
      url = parseReadinessLine(line)
    } catch (error) {
      failReady(error)
      void stop()
      return
    }
    if (url === undefined || readySettled) return
    readyUrl = url
    completeReady()
  })

  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', chunk => {
    try {
      stdoutDecoder.push(chunk)
    } catch (error) {
      failReady(error)
      void stop()
    }
  })
  child.stdout.on('end', () => stdoutDecoder.flush())
  child.stderr.on('data', chunk => remember('stderr', chunk))
  child.on('message', message => {
    if (message?.type === 'booted') {
      bootedAcknowledged = true
      completeReady()
    }
    if (message?.type === 'stopped') stoppedAcknowledged = true
  })
  child.once('error', error => {
    processGuard.close()
    remember('stderr', `${error.message}\n`)
    failReady(new Error(`Unable to start Harness helper: ${error.message}`, { cause: error }))
  })
  child.once('exit', () => processGuard.close())
  child.once('close', (code, signal) => {
    processGuard.close()
    closed = true
    clearTimeout(startupTimer)
    resolveExited({ code, signal })
    if (!readySettled) {
      if (stopping) abortReady()
      else failReady(new Error(`Harness exited before readiness (code ${String(code)}, signal ${String(signal)}).`))
    }
  })

  startupTimer = setTimeout(() => {
    failReady(new Error(`Harness did not become ready within ${options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS} ms.`))
    void stop()
  }, options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS)

  function stop() {
    if (stopPromise !== undefined) return stopPromise
    const attempt = (async () => {
      stopping = true
      clearTimeout(startupTimer)
      if (!readySettled) abortReady()
      if (!closed && child.connected) {
        try {
          child.send({ type: 'shutdown' })
        } catch (error) {
          remember('stderr', `Unable to request graceful shutdown: ${error.message}\n`)
        }
      }

      let result = closed
        ? await exited
        : await waitFor(exited, options.shutdownTimeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS)
      if (result !== undefined) {
        const graceful = stoppedAcknowledged && result.code === 0 && result.signal === null
        return { graceful, forced: false, ...result }
      }

      if (closed || child.exitCode !== null || child.signalCode !== null) {
        result = await exited
        const graceful = stoppedAcknowledged && result.code === 0 && result.signal === null
        return { graceful, forced: false, ...result }
      }
      let terminationError
      try {
        await forceTerminate(child.pid)
      } catch (error) {
        terminationError = error
      }
      result = await waitFor(exited, options.forceExitTimeoutMs ?? FORCE_EXIT_TIMEOUT_MS)
      if (result === undefined && processGuard.active) {
        processGuard.close()
        result = await waitFor(exited, options.forceExitTimeoutMs ?? FORCE_EXIT_TIMEOUT_MS)
      }
      if (result === undefined) {
        throw new Error(`Harness helper PID ${String(child.pid)} did not exit after forced termination.`, {
          cause: terminationError,
        })
      }
      return { graceful: false, forced: true, ...result }
    })()
    stopPromise = attempt
    void attempt.catch(() => {
      if (stopPromise === attempt) stopPromise = undefined
    })
    return attempt
  }

  return {
    child,
    ready,
    exited,
    sourceRoot,
    workspaceRoot,
    processProtection: { active: processGuard.active, error: processGuard.error },
    recentOutput: () => recentOutput,
    stop,
  }
}

/** @template T @param {Promise<T>} promise @param {number} timeoutMs @returns {Promise<T | undefined>} */
function waitFor(promise, timeoutMs) {
  return new Promise(resolvePromise => {
    const timer = setTimeout(() => resolvePromise(undefined), timeoutMs)
    promise.then(value => {
      clearTimeout(timer)
      resolvePromise(value)
    })
  })
}

/** @param {number | undefined} pid */
async function terminateProcessTree(pid) {
  if (pid === undefined) throw new Error('Harness helper has no process ID to terminate.')
  if (process.platform === 'win32') {
    const result = spawnSync('taskkill.exe', ['/pid', String(pid), '/t', '/f'], {
      shell: false,
      windowsHide: true,
      stdio: 'ignore',
    })
    if ((result.error !== undefined || result.status !== 0) && isProcessAlive(pid)) {
      throw new Error(`Unable to terminate Harness helper PID ${pid}.`)
    }
    return
  }
  try {
    process.kill(pid, 'SIGKILL')
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error
  }
}

/** @param {number} pid */
function isProcessAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code !== 'ESRCH'
  }
}
