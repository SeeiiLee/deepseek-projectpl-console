import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { BUILD_FLAVOR } from './build-flavor.js'
import { abortActivatingGeneration, ensurePersonalPluginLinks, resolvePersonalPatch } from './personal-plugins.js'
import { assertExternalRootProvided, loadCurrentGeneration, verifyGenerationDoctor } from './personal-plugin-validation.js'
import { webProfileArgs } from './harness-cli-args.js'

let runtime
let stopRequested = false
let stopPromise
let bootStarted = false
const ORPHAN_EXIT_TIMEOUT_MS = 8_000

function requestStop() {
  stopRequested = true
  if (runtime !== undefined) {
    void stopRuntime()
    return
  }
  // runProfile owns an in-flight boot only after it has installed its signal
  // handlers. Emitting in-process is the only deliverable Windows SIGTERM.
  if (bootStarted) process.emit('SIGTERM')
}

async function stopRuntime() {
  if (runtime === undefined) return
  stopPromise ??= runtime.shutdown.shutdown(0).then(() => new Promise(resolve => {
    if (!process.connected) {
      resolve()
      return
    }
    process.send({ type: 'stopped' }, () => {
      if (process.connected) process.disconnect()
      resolve()
    })
  }))
  await stopPromise
}

process.on('message', message => {
  if (message?.type === 'shutdown') requestStop()
})
process.on('disconnect', () => {
  requestStop()
  const timer = setTimeout(() => process.exit(1), ORPHAN_EXIT_TIMEOUT_MS)
  timer.unref()
})

const sourceRoot = process.env.DSH_SOURCE_ROOT
if (!sourceRoot) throw new Error('DSH_SOURCE_ROOT is required.')

// Helper 是子进程，拿不到 Electron app.getPath('userData')。主进程必须注入
// DSH_PERSONAL_PLUGINS_EXTERNAL 和可信 DSH_DESKTOP_FLAVOR。这里不能无条件用
// BUILD_FLAVOR 覆盖主进程传来的 flavor：源码/未打包 Dev 必须保留 dev 行为；
// 已安装 Stable 的身份由主进程在打包态忽略用户 env 后传入 stable。
const helperEnv = { ...process.env }
const helperFlavor = helperEnv.DSH_DESKTOP_FLAVOR?.trim() || BUILD_FLAVOR

const [bootModule, appBootModule] = await Promise.all([
  import(pathToFileURL(join(sourceRoot, 'apps', 'cli', 'src', 'profile-boot.ts')).href),
  import(pathToFileURL(join(sourceRoot, 'packages', 'boot', 'app-boot', 'src', 'index.ts')).href),
])

if (stopRequested) {
  if (process.connected) {
    process.send({ type: 'stopped' }, () => {
      if (process.connected) process.disconnect()
    })
  }
} else {
  bootStarted = true
  const externalRoot = assertExternalRootProvided({ env: helperEnv, flavor: helperFlavor })
  ensurePersonalPluginLinks({ env: helperEnv })
  runtime = await bootModule.runProfile({
    environment: appBootModule.loadLayeredEnv('dsh'),
    profile: 'web',
    patchFiles: [resolvePersonalPatch()],
    // DSH_DESKTOP_WEB_PORT 由桌面外壳按 flavor 固定注入；缺省 0 = 随机端口。
    args: webProfileArgs(sourceRoot, process.env.DSH_DESKTOP_WEB_PORT ?? '0'),
  })

  // A1 post-boot doctor: when an external generation is activating, verify the
  // candidate scope view and profile junction after Harness has booted. The
  // fiber doctor and atomic current.json commit happen in the desktop main
  // process after the UI is ready. If this offline doctor fails, stop Harness,
  // restore the fallback, quarantine the candidate, and fail the boot.
  // externalRoot 已在启动前由 assertExternalRootProvided 解析；这里直接复用。
  if (externalRoot !== null) {
    const dshHome = process.env.DSH_HOME === undefined || process.env.DSH_HOME === ''
      ? undefined
      : resolve(process.env.DSH_HOME)
    const activatingPath = join(externalRoot, 'activating.json')
    if (existsSync(activatingPath)) {
      let activating
      try {
        activating = JSON.parse(readFileSync(activatingPath, 'utf8'))
      } catch (error) {
        await stopRuntime()
        throw new Error(`A1 post-boot activating.json 解析失败: ${error instanceof Error ? error.message : String(error)}`)
      }
      const generationDir = join(externalRoot, 'generations', activating?.candidateId ?? '')
      const batchPath = join(generationDir, 'batch.json')
      if (!existsSync(batchPath)) {
        await stopRuntime()
        abortActivatingGeneration({ externalRoot, dshHome, reason: 'post-boot activating generation 缺 batch.json' })
        throw new Error(`A1 post-boot activating generation 缺 batch.json: ${batchPath}`)
      }
      const batch = JSON.parse(readFileSync(batchPath, 'utf8'))
      const doctor = verifyGenerationDoctor({ generationDir, batch, dshHome })
      if (!doctor.ok) {
        await stopRuntime()
        abortActivatingGeneration({ externalRoot, dshHome, reason: `post-boot doctor failed: ${doctor.issues.join('; ')}` })
        throw new Error(`A1 post-boot doctor failed: ${doctor.issues.join('; ')}`)
      }
    } else {
      const generation = loadCurrentGeneration(externalRoot)
      if (generation !== null) {
        const doctor = verifyGenerationDoctor({
          generationDir: generation.generationDir,
          batch: generation.batch,
          dshHome,
        })
        if (!doctor.ok) {
          await stopRuntime()
          throw new Error(`A1 post-boot doctor failed: ${doctor.issues.join('; ')}`)
        }
      }
    }
  }

  if (stopRequested) await stopRuntime()
  else if (process.connected) process.send({ type: 'booted' })
}
