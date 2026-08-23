import { spawn } from 'node:child_process'
import { constants as fsConstants } from 'node:fs'
import {
  access,
  cp,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, parse, relative, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createMinimalEnvironment } from './runtime-preflight.js'
import { BUILD_FLAVOR, E2E_BUILD } from './build-flavor.js'
import { createWindowsJobGuard } from './windows-job.js'
import { resolveVendoredPnpm } from './pnpm-resolver.js'
import { readLocalPluginIndex, validatePluginIndex } from './plugin-index.js'
import { parsePluginsVTag, validateClientReleaseManifest } from './client-release-manifest.js'
import { PERSONAL_PLUGINS } from './personal-plugins.js'
import { safeExtractTarball } from './plugin-archive-security.js'
import {
  compareVersions,
  DEFAULT_HARNESS_REPOSITORY,
  defaultUpdateDocument,
  expectedSha256,
  isStrictLoopbackHttpUrl,
  normalizeUpdateSettings,
  parseRepository,
  parseVersion,
  selectRelease,
  selectWindowsAsset,
  sha256,
  UPDATE_STATE_VERSION,
} from './update-core.js'

const UPDATE_FILE_NAME = 'update-center.json'
const MAX_RELEASE_RESPONSE_BYTES = 2 * 1024 * 1024
const MAX_CHECKSUM_BYTES = 256 * 1024
const MAX_ARTIFACT_BYTES = 512 * 1024 * 1024

/**
 * Dev-E2E-only local update source permission. This must rely on the compiled
 * immutable BUILD_FLAVOR/E2E_BUILD constants, never on DSH_DESKTOP_FLAVOR.
 */
export function isLocalUpdateAllowed({ buildFlavor, e2eBuild, env = process.env }) {
  if (buildFlavor !== 'dev' || e2eBuild !== true) return false
  if (env.DSH_DESKTOP_E2E_LOCAL_UPDATE !== '1') return false
  const raw = env.DSH_DESKTOP_E2E_UPDATE_BASE_URL
  if (typeof raw !== 'string' || raw.trim() === '') return false
  // URL 会把 127.1 / 2130706433 / 0x7f000001 等归一化成 127.0.0.1，
  // 因此必须对原始字符串做严格形态校验，不能只依赖 URL.hostname。
  return isStrictLoopbackHttpUrl(raw)
}

/**
 * Dev-only local update source seam. It is intentionally narrow:
 * - only immutable Dev E2E builds may use it;
 * - an explicit E2E switch must be set;
 * - the base URL must be exactly http://127.0.0.1:<dynamic port>.
 * Stable and normal Dev builds fail closed even if env vars are set.
 */
export function resolveLocalUpdateBase(env = process.env) {
  if (!isLocalUpdateAllowed({ buildFlavor: BUILD_FLAVOR, e2eBuild: E2E_BUILD, env })) return null
  return env.DSH_DESKTOP_E2E_UPDATE_BASE_URL.trim().replace(/\/+$/u, '')
}
const REQUEST_TIMEOUT_MS = 20_000
const DOWNLOAD_TIMEOUT_MS = 15 * 60_000
const GIT_TIMEOUT_MS = 5 * 60_000
const BUILD_TIMEOUT_MS = 30 * 60_000

/** Resolve a previously activated, managed Harness runtime or retain the configured checkout. */
export async function resolveActiveHarnessRoot(userDataPath, fallbackRoot) {
  let document
  try {
    document = await readUpdateDocument(join(userDataPath, UPDATE_FILE_NAME))
  } catch {
    return fallbackRoot
  }
  const candidate = document.activeHarnessRoot
  if (typeof candidate !== 'string'
    || document.activeHarnessRepository !== DEFAULT_HARNESS_REPOSITORY
    || !isManagedRuntimePath(userDataPath, candidate)) return fallbackRoot
  try {
    await validateHarnessRoot(candidate)
    return candidate
  } catch {
    return fallbackRoot
  }
}

/** Main-process update coordinator. It never mutates the currently running Harness checkout. */
export class UpdateService {
  constructor(options) {
    this.app = options.app
    this.shell = options.shell
    this.userDataPath = resolve(options.userDataPath)
    this.projectRoot = resolve(options.projectRoot)
    this.getCurrentSourceRoot = options.getCurrentSourceRoot
    this.preflightHarness = options.preflightHarness
    this.onInstallDesktop = options.onInstallDesktop
    this.onRelaunch = options.onRelaunch
    this.writeFileAtomic = options.writeFileAtomic ?? writeFileAtomic
    this.statePath = join(this.userDataPath, UPDATE_FILE_NAME)
    this.runtimeRoot = join(this.userDataPath, 'harness-runtimes')
    this.document = undefined
    this.desktopRelease = undefined
    this.desktopAsset = undefined
    this.pluginRelease = undefined
    this.pluginIndex = undefined
    this.desktop = this.initialDesktopState()
    this.harness = this.initialHarnessState()
    this.plugin = this.initialPluginState()
    this.operation = Promise.resolve()
    this.activeCommands = new Set()
    this.activePreflights = new Set()
    this.abortController = new AbortController()
    this.disposed = false
    this.closing = false
    this.disposePromise = undefined
    this.childEnvironmentPromise = undefined
    this.pluginPurgeToken = undefined
    this.pluginGcToken = undefined
  }

  getState() {
    return this.exclusive(async () => {
      await this.ensureLoaded()
      await this.refreshLocalHarnessState()
      return this.snapshot()
    })
  }

  async configure(settings) {
    return this.exclusive(async () => {
      await this.ensureLoaded()
      const previousSettings = this.document.settings
      const nextSettings = normalizeUpdateSettings(settings)
      if (previousSettings.desktopRepository !== nextSettings.desktopRepository
        || previousSettings.channel !== nextSettings.channel) {
        this.document.downloadedDesktop = undefined
      }
      this.document.settings = nextSettings
      this.desktop = this.initialDesktopState()
      this.harness = this.initialHarnessState()
      await this.persist()
      await this.refreshLocalHarnessState()
      return this.snapshot()
    })
  }

  async check() {
    return this.exclusive(async () => {
      await this.ensureLoaded()
      this.desktop = { ...this.desktop, status: 'checking', message: undefined }
      this.harness = { ...this.harness, status: 'checking', message: undefined }
      this.plugin = { ...this.plugin, status: 'checking', message: undefined }
      const [desktop, harness, plugin] = await Promise.allSettled([
        this.checkDesktop(),
        this.checkHarness(),
        this.checkPlugins(),
      ])
      if (desktop.status === 'rejected') {
        this.desktop = { ...this.initialDesktopState(), status: 'error', message: messageOf(desktop.reason) }
      }
      if (harness.status === 'rejected') {
        await this.refreshLocalHarnessState()
        this.harness = { ...this.harness, status: 'error', message: messageOf(harness.reason) }
      }
      if (plugin.status === 'rejected') {
        this.plugin = { ...this.initialPluginState(), status: 'error', message: messageOf(plugin.reason) }
      }
      this.document.lastCheckedAt = new Date().toISOString()
      await this.persist()
      return this.snapshot()
    })
  }

  async downloadDesktop() {
    return this.exclusive(async () => {
      await this.ensureLoaded()
      if (this.desktop.status !== 'available' || this.desktopRelease === undefined || this.desktopAsset === undefined) {
        throw new Error('请先检查更新并确认存在可下载的客户端版本。')
      }
      this.desktop = { ...this.desktop, status: 'preparing', progressPercent: 0, canDownload: false }
      try {
        const expected = await this.resolveAssetChecksum(this.desktopRelease, this.desktopAsset)
        if (expected === undefined) {
          throw new Error('该 GitHub Release 没有提供 SHA-256；为避免安装未验证文件，更新已停止。')
        }
        const manifestAsset = (this.desktopRelease?.assets ?? []).find(asset => asset.name === 'client-release-manifest.json')
        if (manifestAsset === undefined) {
          throw new Error('Release 缺少 client-release-manifest.json；按客户端供应链合同 fail closed。')
        }
        let manifest
        {
          const manifestText = await fetchText(
            manifestAsset.browser_download_url,
            MAX_CHECKSUM_BYTES,
            {},
            REQUEST_TIMEOUT_MS,
            this.abortController.signal,
            true,
          )
          try {
            manifest = JSON.parse(manifestText)
          } catch (error) {
            throw new Error(`client-release-manifest.json 解析失败: ${error.message}`)
          }
          const validation = validateClientReleaseManifest(manifest, { installerSha256: expected })
          if (!validation.ok) throw new Error(`client-release-manifest 校验失败: ${validation.issues.join('; ')}`)
        }
        const data = await fetchBuffer(this.desktopAsset.browser_download_url, MAX_ARTIFACT_BYTES, progress => {
          this.desktop = { ...this.desktop, progressPercent: progress }
        }, {}, DOWNLOAD_TIMEOUT_MS, this.abortController.signal, true)
        const observed = sha256(data)
        if (observed !== expected) throw new Error('下载文件的 SHA-256 与 Release 清单不一致。')
        const downloadDirectory = join(this.userDataPath, 'updates', 'downloads')
        await mkdir(downloadDirectory, { recursive: true })
        const target = join(downloadDirectory, safeAssetName(this.desktopAsset.name))
        const temporary = `${target}.${randomUUID()}.tmp`
        await writeFile(temporary, data, { flag: 'wx' })
        await rename(temporary, target)
        if (this.document.knownGoodDesktop !== undefined) {
          await this.assertDesktopRecordUsable(this.document.knownGoodDesktop, '当前已知良好安装包')
          this.document.previousDesktop = this.document.knownGoodDesktop
        }
        this.document.downloadedDesktop = {
          path: target,
          sha256: observed,
          version: normalizeVersion(this.desktopRelease.tag_name),
          assetName: this.desktopAsset.name,
          repository: this.document.settings.desktopRepository,
          channel: this.document.settings.channel,
          manifest,
        }
        this.document.installPending = undefined
        this.document.rollbackPending = undefined
        await this.persist()
        const canInstall = this.desktop.packaging === 'nsis'
        this.desktop = {
          ...this.desktop,
          status: 'ready',
          progressPercent: 100,
          canDownload: false,
          canInstall,
          canRollbackDesktop: this.document.previousDesktop !== undefined,
          message: canInstall
            ? '安装包已验证，重启后可以安装。'
            : '新版 Portable 已验证并下载；请在退出后用新文件替换旧版本。',
        }
        if (!canInstall) this.shell.showItemInFolder(target)
        return this.snapshot()
      } catch (error) {
        this.desktop = { ...this.desktop, status: 'error', canDownload: true, canInstall: false, message: messageOf(error) }
        throw error
      }
    })
  }

  installDesktop() {
    return this.exclusive(async () => {
      await this.ensureLoaded()
      const downloaded = this.document.downloadedDesktop
      if (this.desktop.packaging !== 'nsis' || downloaded === undefined) {
        throw new Error('当前没有可安装的 Windows 安装版更新。')
      }
      if (compareVersions(downloaded.version, this.app.getVersion()) <= 0) {
        this.document.downloadedDesktop = undefined
        await this.persist()
        throw new Error('已下载文件不是比当前客户端更新的版本。')
      }
      if (!isManagedDownloadPath(this.userDataPath, downloaded.path)
        || downloaded.repository !== this.document.settings.desktopRepository
        || downloaded.channel !== this.document.settings.channel) {
        throw new Error('已下载更新与当前发布源不匹配。')
      }
      const data = await readFile(downloaded.path)
      if (sha256(data) !== downloaded.sha256) throw new Error('已下载安装包的校验值发生变化。')
      await this.assertClientVersionCompatibleWithPluginGeneration(downloaded.version, downloaded.manifest)
      this.document.installPending = {
        version: downloaded.version,
        path: downloaded.path,
        sha256: downloaded.sha256,
        scheduledAt: new Date().toISOString(),
      }
      this.document.rollbackPending = undefined
      await this.persist()
      await this.onInstallDesktop(downloaded.path)
    })
  }

  async rollbackDesktop() {
    return this.exclusive(async () => {
      await this.ensureLoaded()
      const previous = this.document.previousDesktop
      if (previous === undefined) throw new Error('没有保留上一已知良好客户端安装包。')
      if (!isManagedDownloadPath(this.userDataPath, previous.path)
        || previous.repository !== this.document.settings.desktopRepository
        || previous.channel !== this.document.settings.channel) {
        throw new Error('上一客户端安装包与当前发布源不匹配。')
      }
      const data = await readFile(previous.path)
      if (sha256(data) !== previous.sha256) throw new Error('上一客户端安装包的校验值发生变化。')
      await this.assertClientVersionCompatibleWithPluginGeneration(previous.version, previous.manifest)
      this.document.rollbackPending = {
        version: previous.version,
        path: previous.path,
        sha256: previous.sha256,
        scheduledAt: new Date().toISOString(),
      }
      this.document.installPending = undefined
      await this.persist()
      await this.onInstallDesktop(previous.path)
      this.desktop = { ...this.desktop, canRollbackDesktop: false }
    })
  }

  /**
   * Confirm a desktop install/rollback only after the target version has
   * actually booted and passed the desktop readiness gates. Called from the
   * main process after a successful startup. Until then the previous
   * known-good installer record is never cleared.
   */
  async confirmDesktopLifecycle() {
    return this.exclusive(async () => {
      await this.ensureLoaded()
      const currentVersion = normalizeVersion(this.app.getVersion())
      let changed = false
      if (this.document.installPending !== undefined
        && this.document.downloadedDesktop !== undefined
        && this.document.downloadedDesktop.version === currentVersion) {
        // The installed candidate is now the current known-good installer.
        this.document.knownGoodDesktop = this.document.downloadedDesktop
        this.document.installPending = undefined
        // The installed candidate is no longer a candidate; clear it so a later
        // download cannot overwrite the real previous known-good installer.
        this.document.downloadedDesktop = undefined
        changed = true
      }
      if (this.document.rollbackPending !== undefined
        && this.document.previousDesktop !== undefined
        && this.document.rollbackPending.version === currentVersion) {
        // The rollback target is again the current known-good installer.
        this.document.knownGoodDesktop = this.document.previousDesktop
        this.document.rollbackPending = undefined
        this.document.downloadedDesktop = undefined
        this.document.previousDesktop = undefined
        changed = true
      }
      if (changed) await this.persist()
      return this.snapshot()
    })
  }

  async prepareHarness() {
    return this.exclusive(async () => {
      await this.ensureLoaded()
      if (!this.harness.canPrepare || this.harness.remoteCommit === undefined) {
        throw new Error('请先检查更新并确认存在新的 Harness 提交。')
      }
      const commit = validateCommit(this.harness.remoteCommit)
      const target = join(this.runtimeRoot, commit)
      this.harness = { ...this.harness, status: 'preparing', canPrepare: false, message: '正在下载源代码并构建运行时…' }
      if (!await this.isPreparedRuntime(target, commit)) {
        await mkdir(this.runtimeRoot, { recursive: true })
        const staging = join(this.runtimeRoot, `.staging-${commit}-${randomUUID()}`)
        try {
          const repository = parseRepository(this.document.settings.harnessRepository)
          const url = `https://github.com/${repository.fullName}.git`
          await this.runCommand('git.exe', ['-c', 'core.longpaths=true', 'clone', '--filter=blob:none', '--no-checkout', '--depth', '1', url, staging], {
            cwd: this.runtimeRoot, timeoutMs: GIT_TIMEOUT_MS,
          })
          // Windows 长路径：仓库含 .agents/notes 超深路径，staging 前缀叠加后超过 MAX_PATH；
          // 命令行 -c 之外，仓库级配置兜底（2026-08-17 实测修复）。
          await this.runCommand('git.exe', ['-c', 'core.longpaths=true', '-C', staging, 'config', 'core.longpaths', 'true'], {
            cwd: this.runtimeRoot, timeoutMs: GIT_TIMEOUT_MS,
          })
          await this.runCommand('git.exe', ['-c', 'core.longpaths=true', '-C', staging, 'fetch', '--depth', '1', 'origin', commit], {
            cwd: this.runtimeRoot, timeoutMs: GIT_TIMEOUT_MS,
          })
          await this.runCommand('git.exe', ['-c', 'core.longpaths=true', '-C', staging, 'checkout', '--detach', commit], {
            cwd: this.runtimeRoot, timeoutMs: GIT_TIMEOUT_MS,
          })
          const checkedOut = (await this.runCommand('git.exe', ['-c', 'core.longpaths=true', '-C', staging, 'rev-parse', 'HEAD'], {
            cwd: this.runtimeRoot, timeoutMs: GIT_TIMEOUT_MS,
          })).stdout.trim()
          if (checkedOut !== commit) throw new Error('下载的 Harness 提交与远端检查结果不一致。')
          await this.runPnpm(['install', '--frozen-lockfile'], staging)
          await this.runPnpm(['run', 'build'], staging)
          await this.preflightHarness(staging, {
            signal: this.abortController.signal,
            onSupervisor: supervisor => this.activePreflights.add(supervisor),
            onSupervisorStopped: supervisor => this.activePreflights.delete(supervisor),
          })
          await rename(staging, target)
        } catch (error) {
          await safeRemoveWithin(this.runtimeRoot, staging)
          this.harness = { ...this.harness, status: 'error', message: messageOf(error), canPrepare: true }
          throw error
        }
      }
      this.document.preparedHarnessRoot = target
      this.document.preparedHarnessCommit = commit
      this.document.preparedHarnessRepository = DEFAULT_HARNESS_REPOSITORY
      await this.persist()
      this.harness = {
        ...this.harness,
        status: 'ready',
        preparedCommit: commit,
        canPrepare: false,
        canActivate: true,
        message: '新运行时已在独立目录构建并通过启动检查，尚未影响当前会话。',
      }
      return this.snapshot()
    })
  }

  activateHarness() {
    return this.exclusive(async () => {
      await this.ensureLoaded()
      const target = this.document.preparedHarnessRoot
      const commit = this.document.preparedHarnessCommit
      if (typeof target !== 'string' || typeof commit !== 'string'
        || this.document.preparedHarnessRepository !== DEFAULT_HARNESS_REPOSITORY
        || !isManagedRuntimePath(this.userDataPath, target)
        || !await this.isPreparedRuntime(target, commit)) {
        throw new Error('没有可切换的已验证 Harness 运行时。')
      }
      await this.assertHarnessCompatibleWithPluginGeneration(commit)
      const currentRoot = resolve(this.getCurrentSourceRoot())
      const currentCommit = await this.gitCommit(currentRoot)
      this.document.previousHarnessRoot = currentRoot
      this.document.previousHarnessCommit = currentCommit
      this.document.previousHarnessRepository = DEFAULT_HARNESS_REPOSITORY
      this.document.activeHarnessRoot = target
      this.document.activeHarnessCommit = commit
      this.document.activeHarnessRepository = DEFAULT_HARNESS_REPOSITORY
      this.document.pendingHarnessActivation = true
      this.document.preparedHarnessRoot = undefined
      this.document.preparedHarnessCommit = undefined
      this.document.preparedHarnessRepository = undefined
      await this.persist()
      await this.onRelaunch('harness-update')
    })
  }

  rollbackHarness() {
    return this.exclusive(async () => {
      await this.ensureLoaded()
      const previous = this.document.previousHarnessRoot
      if (typeof previous !== 'string' || this.document.previousHarnessRepository !== DEFAULT_HARNESS_REPOSITORY) {
        throw new Error('没有可回滚的 Harness 运行时。')
      }
      await validateHarnessRoot(previous)
      await this.assertHarnessCompatibleWithPluginGeneration(this.document.previousHarnessCommit)
      const current = resolve(this.getCurrentSourceRoot())
      const currentCommit = await this.gitCommit(current)
      this.document.activeHarnessRoot = previous
      this.document.activeHarnessCommit = this.document.previousHarnessCommit
      this.document.activeHarnessRepository = DEFAULT_HARNESS_REPOSITORY
      this.document.previousHarnessRoot = current
      this.document.previousHarnessCommit = currentCommit
      this.document.previousHarnessRepository = DEFAULT_HARNESS_REPOSITORY
      this.document.pendingHarnessActivation = true
      await this.persist()
      await this.onRelaunch('harness-rollback')
    })
  }

  recordHarnessBoot(sourceRoot, succeeded) {
    return this.exclusive(async () => {
      await this.ensureLoaded()
      const active = this.document.activeHarnessRoot
      if (typeof active !== 'string' || resolve(active) !== resolve(sourceRoot) || this.document.pendingHarnessActivation !== true) return false
      if (succeeded) {
        this.document.pendingHarnessActivation = false
        this.document.activeHarnessVerifiedAt = new Date().toISOString()
        await this.persist()
        return false
      }
      const previous = this.document.previousHarnessRoot
      if (typeof previous !== 'string') return false
      this.document.failedHarnessRoot = active
      this.document.activeHarnessRoot = previous
      this.document.activeHarnessCommit = this.document.previousHarnessCommit
      this.document.activeHarnessRepository = this.document.previousHarnessRepository
      this.document.previousHarnessRoot = undefined
      this.document.previousHarnessCommit = undefined
      this.document.previousHarnessRepository = undefined
      this.document.pendingHarnessActivation = false
      await this.persist()
      return true
    })
  }

  openRelease(kind) {
    return this.exclusive(async () => {
      await this.ensureLoaded()
      let target
      if (kind === 'desktop') target = this.desktop.releaseUrl
      if (kind === 'harness') {
        const repository = parseRepository(this.document.settings.harnessRepository)
        target = `https://github.com/${repository.fullName}`
      }
      if (typeof target !== 'string') {
        throw new Error('没有可信的 GitHub 页面可以打开。')
      }
      const parsed = new URL(target)
      if (parsed.protocol !== 'https:' || parsed.hostname !== 'github.com') throw new Error('没有可信的 GitHub 页面可以打开。')
      await this.shell.openExternal(target)
    })
  }

  shouldAutoCheck() {
    return this.exclusive(async () => {
      await this.ensureLoaded()
      if (!this.document.settings.autoCheck) return false
      if (typeof this.document.lastCheckedAt !== 'string') return true
      return Date.now() - new Date(this.document.lastCheckedAt).valueOf() >= 24 * 60 * 60 * 1000
    })
  }

  async ensureLoaded() {
    if (this.document !== undefined) return
    this.document = await readUpdateDocument(this.statePath)
    this.document.settings = normalizeUpdateSettings(this.document.settings)
    let documentChanged = false
    if (this.document.preparedHarnessRepository !== DEFAULT_HARNESS_REPOSITORY
      || typeof this.document.preparedHarnessRoot !== 'string'
      || !isManagedRuntimePath(this.userDataPath, this.document.preparedHarnessRoot)) {
      this.document.preparedHarnessRoot = undefined
      this.document.preparedHarnessCommit = undefined
      this.document.preparedHarnessRepository = undefined
      documentChanged = true
    }
    await this.refreshLocalHarnessState()
    const downloaded = this.document.downloadedDesktop
    if (downloaded !== undefined) {
      try {
        if (!isManagedDownloadPath(this.userDataPath, downloaded.path)
          || downloaded.repository !== this.document.settings.desktopRepository
          || downloaded.channel !== this.document.settings.channel
          || (compareVersions(downloaded.version, this.app.getVersion()) <= 0 && this.document.installPending === undefined)) {
          throw new Error('Downloaded update metadata no longer matches the configured release source.')
        }
        await access(downloaded.path, fsConstants.R_OK)
        this.desktop = {
          ...this.desktop,
          status: 'ready',
          latestVersion: downloaded.version,
          canInstall: this.desktop.packaging === 'nsis',
          canRollbackDesktop: this.document.previousDesktop !== undefined,
          message: this.desktop.packaging === 'nsis' ? '安装包已下载并等待安装。' : 'Portable 更新已下载。',
        }
      } catch {
        this.document.downloadedDesktop = undefined
        documentChanged = true
      }
    }
    if (documentChanged) await this.persist()
  }

  async assertDesktopRecordUsable(record, label) {
    if (typeof record !== 'object' || record === null) throw new Error(`${label}记录缺失。`)
    if (typeof record.path !== 'string' || !isManagedDownloadPath(this.userDataPath, record.path)) {
      throw new Error(`${label}路径不在受管下载目录内。`)
    }
    if (record.repository !== this.document.settings.desktopRepository || record.channel !== this.document.settings.channel) {
      throw new Error(`${label}与当前发布源不匹配。`)
    }
    if (typeof record.sha256 !== 'string' || !/^[0-9a-f]{64}$/u.test(record.sha256)) {
      throw new Error(`${label}缺少合法 SHA-256。`)
    }
    try {
      const data = await readFile(record.path)
      if (sha256(data) !== record.sha256) throw new Error(`${label}校验值发生变化。`)
    } catch (error) {
      if (error?.code === 'ENOENT') throw new Error(`${label}安装包文件缺失。`)
      throw error
    }
  }

  async checkDesktop() {
    const repository = parseRepository(this.document.settings.desktopRepository, { allowEmpty: true })
    if (repository === undefined) {
      this.desktop = {
        ...this.initialDesktopState(),
        status: 'unsupported',
        message: this.app.isPackaged
          ? '尚未配置发布仓库：当前请用最新安装包人工升级（重新运行安装版或替换 Portable 文件）。配置 GitHub Releases 后即可在应用内检查并安装更新。'
          : '尚未配置 Personal 的 GitHub Release 仓库。',
      }
      return
    }
    const releases = await desktopGithubJson(`/repos/${repository.fullName}/releases?per_page=20`, this.abortController.signal)
    // GitHub 列表接口偶发索引延迟（列表为空或缺新 Release，直查接口正常，2026-08-17 实测）：
    // 列表选不出时回退到 /releases/latest，避免把已发布版本误报成「没有可用更新」。
    let release = selectRelease(Array.isArray(releases) ? releases : [], this.document.settings.channel)
    if (release === undefined) {
      const latest = await desktopGithubJson(`/repos/${repository.fullName}/releases/latest`, this.abortController.signal)
        .catch(() => undefined)
      if (latest !== undefined && typeof latest === 'object' && latest !== null && typeof latest.tag_name === 'string') {
        try {
          parseVersion(latest.tag_name)
          release = latest
        } catch {
          release = undefined
        }
      }
    }
    if (release === undefined) {
      this.desktop = { ...this.initialDesktopState(), status: 'unsupported', message: '该仓库还没有符合当前通道的 GitHub Release。' }
      return
    }
    const latestVersion = normalizeVersion(release.tag_name)
    const packaging = this.desktop.packaging
    const asset = selectWindowsAsset(Array.isArray(release.assets) ? release.assets : [], packaging)
    const newer = compareVersions(latestVersion, this.app.getVersion()) > 0
    this.desktopRelease = release
    this.desktopAsset = asset
    this.desktop = {
      ...this.initialDesktopState(),
      status: newer ? 'available' : 'current',
      latestVersion,
      releaseName: textLimit(release.name || release.tag_name, 160),
      releaseNotes: textLimit(release.body, 4_000),
      publishedAt: release.published_at,
      releaseUrl: release.html_url,
      canDownload: newer && this.app.isPackaged && asset !== undefined,
      message: newer && asset === undefined
        ? '发现新版本，但 Release 中没有匹配当前 Windows 分发形态的文件。'
        : (!this.app.isPackaged && newer ? '开发环境只显示更新，不能覆盖当前源码运行。' : undefined),
    }
  }

  async checkHarness() {
    await this.refreshLocalHarnessState()
    const repository = parseRepository(this.document.settings.harnessRepository)
    const result = await this.runCommand('git.exe', ['-c', 'core.longpaths=true', 'ls-remote', `https://github.com/${repository.fullName}.git`, 'HEAD'], {
      cwd: this.getCurrentSourceRoot(), timeoutMs: GIT_TIMEOUT_MS,
    })
    const commit = validateCommit(result.stdout.trim().split(/\s+/u)[0])
    const current = this.harness.currentCommit
    const prepared = this.document.preparedHarnessRepository === DEFAULT_HARNESS_REPOSITORY
      && typeof this.document.preparedHarnessRoot === 'string'
      && isManagedRuntimePath(this.userDataPath, this.document.preparedHarnessRoot)
      ? this.document.preparedHarnessCommit
      : undefined
    const available = current !== commit
    this.harness = {
      ...this.harness,
      repository: repository.fullName,
      remoteCommit: commit,
      preparedCommit: prepared,
      status: prepared === commit ? 'ready' : available ? 'available' : 'current',
      canPrepare: available && prepared !== commit,
      canActivate: prepared === commit,
      message: available
        ? (prepared === commit ? '新提交已经准备完毕，等待重启切换。' : '远端有新提交；当前目录不会被直接覆盖。')
        : '当前 Harness 与 GitHub HEAD 一致。',
    }
  }

  async refreshLocalHarnessState() {
    const sourceRoot = resolve(this.getCurrentSourceRoot())
    let currentCommit
    let dirty = false
    let message
    try {
      currentCommit = await this.gitCommit(sourceRoot)
      const statusResult = await this.runCommand('git.exe', ['-c', 'core.longpaths=true', '-C', sourceRoot, 'status', '--porcelain', '--untracked-files=no'], {
        cwd: sourceRoot, timeoutMs: GIT_TIMEOUT_MS,
      })
      dirty = statusResult.stdout.trim() !== ''
    } catch (error) {
      message = messageOf(error)
    }
    this.harness = {
      ...this.initialHarnessState(),
      sourceRoot,
      repository: this.document?.settings?.harnessRepository ?? 'deepseek-ai/deepseek-harness',
      currentCommit,
      previousCommit: this.document?.previousHarnessCommit,
      preparedCommit: this.document?.preparedHarnessCommit,
      status: message === undefined ? 'idle' : 'error',
      dirty,
      canPrepare: false,
      canActivate: typeof this.document?.preparedHarnessRoot === 'string'
        && this.document?.preparedHarnessRepository === DEFAULT_HARNESS_REPOSITORY,
      canRollback: typeof this.document?.previousHarnessRoot === 'string'
        && this.document?.previousHarnessRepository === DEFAULT_HARNESS_REPOSITORY,
      message,
    }
  }

  async resolveAssetChecksum(release, asset) {
    const direct = expectedSha256(asset)
    if (direct !== undefined) return direct
    const assets = Array.isArray(release.assets) ? release.assets : []
    const companion = assets.find(item => item.name === `${asset.name}.sha256`)
      ?? assets.find(item => /^(sha256sums|checksums\.txt)$/iu.test(item.name))
    if (companion === undefined) return undefined
    const body = await fetchText(
      companion.browser_download_url,
      MAX_CHECKSUM_BYTES,
      {},
      REQUEST_TIMEOUT_MS,
      this.abortController.signal,
      true,
    )
    const oneFileDigest = /^[A-Fa-f0-9]{64}\s*$/u.test(body.trim()) ? body.trim().toLowerCase() : undefined
    return oneFileDigest ?? expectedSha256(asset, body)
  }

  initialDesktopState() {
    const packaging = !this.app.isPackaged
      ? 'development'
      : process.env.PORTABLE_EXECUTABLE_FILE ? 'portable' : 'nsis'
    return {
      currentVersion: this.app.getVersion(),
      packaging,
      status: 'idle',
      canDownload: false,
      canInstall: false,
      canRollbackDesktop: false,
    }
  }

  initialHarnessState() {
    return {
      sourceRoot: resolve(this.getCurrentSourceRoot()),
      repository: this.document?.settings?.harnessRepository ?? 'deepseek-ai/deepseek-harness',
      status: 'idle',
      dirty: false,
      canPrepare: false,
      canActivate: false,
      canRollback: false,
    }
  }

  initialPluginState() {
    return {
      status: 'idle',
      current: [],
      available: [],
      blocked: [],
      canRollback: false,
      message: undefined,
    }
  }

  async checkPlugins() {
    const indexPath = process.env.DSH_PERSONAL_PLUGIN_INDEX
    let loaded
    this.pluginIndex = undefined
    this.pluginRelease = undefined
    if (indexPath !== undefined && indexPath !== '') {
      loaded = readLocalPluginIndex(indexPath)
    } else {
      const repository = parseRepository(this.document.settings.pluginRepository, { allowEmpty: true })
      if (repository === undefined) {
        this.plugin = {
          ...this.initialPluginState(),
          status: 'unsupported',
          message: '未配置插件更新源；本地 fixture 用 DSH_PERSONAL_PLUGIN_INDEX，生产源用 pluginRepository。',
        }
        return
      }
      loaded = await this.fetchProductionPluginIndex(repository)
    }
    if (!loaded.ok || loaded.index === undefined) {
      throw new Error(`plugin-index 校验失败: ${loaded.issues.join('; ')}`)
    }
    this.pluginIndex = loaded.index
    this.pluginRelease = loaded.release ?? undefined
    if (this.harness.currentCommit === undefined) await this.refreshLocalHarnessState()
    const current = await bundledPluginVersions(this.projectRoot)
    const available = []
    const blocked = []
    for (const entry of loaded.index.plugins) {
      if (!entry.externalEligible) continue
      const currentRow = current.find(row => row.packageName === entry.packageName)
      const currentVersion = currentRow?.version
      let newer = currentVersion === undefined
      if (currentVersion !== undefined) {
        try {
          newer = compareVersions(entry.version, currentVersion) > 0
        } catch {
          newer = true
        }
      }
      if (!newer) continue
      let blockedReason
      if (this.harness.currentCommit === undefined) {
        blockedReason = '当前 Harness commit 未知'
      } else if (!(entry.compatibleHarness?.commits ?? []).includes(this.harness.currentCommit)) {
        blockedReason = `当前 Harness commit ${this.harness.currentCommit.slice(0, 10)} 不在插件兼容列表`
      }
      if (blockedReason === undefined) {
        const currentNames = new Set(current.map(row => row.packageName))
        const missingDeps = (entry.requires ?? []).filter(name => !currentNames.has(name))
        if (missingDeps.length > 0) blockedReason = `缺少依赖插件 ${missingDeps.join(', ')}`
      }
      if (blockedReason === undefined && (entry.modelAssets?.length ?? 0) > 0) {
        blockedReason = '模型资产外部更新尚未支持'
      }
      if (blockedReason === undefined && (entry.dataSchema?.migrations?.length ?? 0) > 0) {
        blockedReason = '数据迁移外部更新尚未支持'
      }
      if (blockedReason === undefined) {
        try {
          if (compareVersions(entry.minClient, this.app.getVersion()) > 0) {
            blockedReason = `需要更高客户端版本 ${entry.minClient}`
          }
        } catch {
          blockedReason = 'minClient 无法解析'
        }
      }
      if (blockedReason !== undefined) {
        blocked.push({ ...entry, currentVersion, newer: true, blockedReason })
      } else {
        available.push({ ...entry, currentVersion, newer: true })
      }
    }
    const externalRoot = join(this.userDataPath, 'plugins-external')
    const canRollback = await stat(join(externalRoot, 'current.json')).then(() => true).catch(() => false)
      || await stat(join(externalRoot, 'previous.json')).then(() => true).catch(() => false)
    this.plugin = {
      status: available.length > 0 ? 'available' : (blocked.length > 0 ? 'blocked' : 'current'),
      current,
      available,
      blocked,
      canRollback,
      message: available.length > 0 ? `发现 ${available.length} 个可更新插件。` : (blocked.length > 0 ? '存在需要更高客户端的插件更新。' : '插件均为当前版本。'),
    }
  }

  async fetchProductionPluginIndex(repository) {
    const releases = await githubJson(`/repos/${repository.fullName}/releases?per_page=20`, this.abortController.signal)
    const candidates = (Array.isArray(releases) ? releases : [])
      .filter(release => release?.draft !== true && parsePluginsVTag(release.tag_name) !== null)
      .sort((left, right) => String(right.published_at ?? '').localeCompare(String(left.published_at ?? '')))
    const release = candidates[0]
    if (release === undefined) return { ok: false, issues: ['没有可用的 plugins-v* Release'], index: null, release: null }
    const asset = (release.assets ?? []).find(item => item?.name === 'plugin-index.json')
    if (asset === undefined) return { ok: false, issues: ['plugins-v* Release 缺少 plugin-index.json'], index: null, release }
    const text = await fetchText(
      asset.browser_download_url,
      MAX_RELEASE_RESPONSE_BYTES,
      { accept: 'application/vnd.github+json' },
      REQUEST_TIMEOUT_MS,
      this.abortController.signal,
    )
    let index
    try {
      index = JSON.parse(text)
    } catch (error) {
      return { ok: false, issues: [`plugin-index.json 解析失败: ${error.message}`], index: null, release }
    }
    const validation = validatePluginIndex(index)
    if (!validation.ok) return { ...validation, index: null, release }
    return { ok: true, issues: [], index, release }
  }

  async preparePluginGeneration() {
    const indexPath = process.env.DSH_PERSONAL_PLUGIN_INDEX
    let index
    let release = null
    let localMode = false
    if (indexPath !== undefined && indexPath !== '') {
      const loaded = readLocalPluginIndex(indexPath)
      if (!loaded.ok || loaded.index === undefined) {
        throw new Error(`plugin-index 校验失败: ${loaded.issues.join('; ')}`)
      }
      index = loaded.index
      localMode = true
    } else {
      if (this.pluginIndex === undefined) {
        throw new Error('未配置本地插件索引且尚未检查到生产插件索引。')
      }
      if (this.pluginRelease === undefined) {
        throw new Error('没有可用的 plugins-v* Release。')
      }
      if (this.pluginRelease.tag_name !== this.pluginIndex.releaseTag) {
        throw new Error('Release tag 与 plugin-index.releaseTag 不一致。')
      }
      index = this.pluginIndex
      release = this.pluginRelease
      const releaseAssetNames = (release.assets ?? []).map(asset => asset?.name).filter(name => typeof name === 'string')
      if (new Set(releaseAssetNames).size !== releaseAssetNames.length) {
        throw new Error('Release 资产名不唯一。')
      }
      const indexAssetNames = index.plugins.map(plugin => plugin.assetName)
      if (new Set(indexAssetNames).size !== indexAssetNames.length) {
        throw new Error('plugin-index 资产名不唯一。')
      }
    }
    const available = this.plugin.available
    if (available.length === 0) {
      throw new Error('当前没有可下载的插件更新。')
    }

    const externalRoot = join(this.userDataPath, 'plugins-external')
    const generationId = `pending-${Date.now()}`
    const stagingDir = join(externalRoot, 'staging', generationId)
    const assetDir = join(stagingDir, 'assets')
    const generationDir = join(externalRoot, 'generations', generationId)
    try {
      await mkdir(assetDir, { recursive: true })
      await mkdir(join(stagingDir, 'extract'), { recursive: true })
      await mkdir(generationDir, { recursive: true })

      const packages = {}
      for (const { packageName, directoryName } of PERSONAL_PLUGINS) {
        const entry = available.find(item => item.packageName === packageName)
        if (entry === undefined) {
          packages[packageName] = { source: 'builtin' }
          continue
        }
        let data
        if (localMode) {
          const assetPath = join(dirname(indexPath), entry.assetName)
          data = await readFile(assetPath)
        } else {
          const asset = (release.assets ?? []).find(item => item?.name === entry.assetName)
          if (asset === undefined) {
            throw new Error(`${packageName} Release 缺少资产 ${entry.assetName}`)
          }
          if (typeof asset.browser_download_url !== 'string' || asset.browser_download_url === '') {
            throw new Error(`${packageName} Release 资产缺少下载 URL`)
          }
          data = await fetchBuffer(
            asset.browser_download_url,
            entry.assetSize,
            undefined,
            {},
            DOWNLOAD_TIMEOUT_MS,
            this.abortController.signal,
          )
        }
        if (data.length !== entry.assetSize) {
          throw new Error(`${packageName} 资产大小与索引不一致`)
        }
        if (sha256(data) !== entry.sha256) {
          throw new Error(`${packageName} 下载文件 SHA-256 与索引不一致。`)
        }
        const safeName = safePluginAssetName(entry.assetName)
        const assetPath = join(assetDir, safeName)
        await this.writeFileAtomic(assetPath, data)
        const pkgDir = join(generationDir, 'packages', directoryName, entry.version)
        await mkdir(pkgDir, { recursive: true })
        const extractDir = join(stagingDir, 'extract', packageName.replace(/[^A-Za-z0-9-]/gu, '_'))
        await mkdir(extractDir, { recursive: true })
        await safeExtractTarball(assetPath, extractDir)
        const packedRoot = join(extractDir, 'package')
        for (const name of await readdir(packedRoot)) {
          await cp(join(packedRoot, name), join(pkgDir, name), { recursive: true })
        }
        const files = {}
        await collectFileHashes(pkgDir, files)
        let pluginContractVersion = ''
        let seams = []
        try {
          const packageManifest = JSON.parse(await readFile(join(pkgDir, 'package.json'), 'utf8'))
          pluginContractVersion = String(packageManifest?.dshComposable?.schemaVersion ?? '')
          seams = Array.isArray(packageManifest?.dshComposable?.seams)
            ? packageManifest.dshComposable.seams
              .map(seam => typeof seam === 'string' ? seam : seam?.name)
              .filter(seam => typeof seam === 'string' && seam.length > 0)
            : []
        } catch (error) {
          throw new Error(`${packageName} package.json 读取失败: ${error.message}`)
        }
        if (pluginContractVersion === '') {
          throw new Error(`${packageName} 缺少 dshComposable.schemaVersion，插件合同版本未知。`)
        }
        if (seams.length === 0 && Array.isArray(entry.seams)) seams = entry.seams
        await writeFile(join(pkgDir, '.install.json'), `${JSON.stringify({
          schemaVersion: 1,
          packageName,
          version: entry.version,
          sourceTag: index.releaseTag,
          tgzSha256: entry.sha256,
          minClient: entry.minClient,
          harnessCommit: index.compatibleHarness.commit,
          pluginContractVersion,
          seams,
          files,
        }, null, 2)}\n`)
        packages[packageName] = { source: 'external', directoryName, version: entry.version }
      }

      await writeFile(join(generationDir, 'batch.json'), `${JSON.stringify({
        schemaVersion: 1,
        generationId,
        harness: {
          version: index.compatibleHarness.version,
          commit: index.compatibleHarness.commit,
        },
        packages,
      }, null, 2)}\n`)
      await writeFile(join(externalRoot, 'pending.json'), `${JSON.stringify({
        generationId,
        candidateId: generationId,
        createdAt: new Date().toISOString(),
      }, null, 2)}\n`)
    } catch (error) {
      await rm(stagingDir, { recursive: true, force: true }).catch(() => {})
      await rm(generationDir, { recursive: true, force: true }).catch(() => {})
      throw error
    }

    this.plugin = {
      ...this.plugin,
      status: 'ready',
      canRollback: true,
      message: '插件 generation 已准备，重启后整批激活。',
    }
    return this.snapshot()
  }

  /**
   * Read the active external plugin generation's cross-line compatibility
   * facts. Returns null when no external generation is currently committed.
   * Throws with a visible reason when an active generation exists but its
   * batch/install evidence is missing, corrupt, or unknown (fail closed).
   */
  async readActivePluginGeneration() {
    const externalRoot = join(this.userDataPath, 'plugins-external')
    const currentPath = join(externalRoot, 'current.json')
    try {
      await access(currentPath, fsConstants.R_OK)
    } catch {
      return null
    }
    let current
    try {
      current = JSON.parse(await readFile(currentPath, 'utf8'))
    } catch (error) {
      throw new Error(`当前外部插件 current.json 解析失败: ${error.message}`)
    }
    if (typeof current !== 'object' || current === null
      || typeof current.generationId !== 'string' || current.generationId.length === 0) {
      throw new Error('当前外部插件 current.json 缺 generationId')
    }
    const generationDir = join(externalRoot, 'generations', current.generationId)
    const batchPath = join(generationDir, 'batch.json')
    let batch
    try {
      batch = JSON.parse(await readFile(batchPath, 'utf8'))
    } catch (error) {
      if (error?.code === 'ENOENT') {
        throw new Error(`当前外部插件 generation ${current.generationId} 缺 batch.json`)
      }
      throw new Error(`当前外部插件 generation ${current.generationId} batch.json 解析失败: ${error.message}`)
    }
    const issues = []
    if (batch.schemaVersion !== 1) issues.push(`batch.json schemaVersion 未知: ${batch.schemaVersion}`)
    if (typeof batch.generationId !== 'string' || batch.generationId !== current.generationId) {
      issues.push('batch.json generationId 与 current.json 不一致')
    }
    if (!batch.harness || typeof batch.harness !== 'object') {
      issues.push('batch.json 缺 harness 兼容信息')
    } else {
      if (typeof batch.harness.version !== 'string' || batch.harness.version.length === 0) {
        issues.push('batch.json 缺 Harness version')
      }
      if (typeof batch.harness.commit !== 'string' || !/^[0-9a-f]{40}$/u.test(batch.harness.commit)) {
        issues.push('batch.json 缺/非法 Harness commit')
      }
    }
    if (!batch.packages || typeof batch.packages !== 'object') {
      issues.push('batch.json 缺 packages')
    }
    const externalEntries = Object.entries(batch?.packages ?? {})
      .filter(([, info]) => info?.source === 'external')
    let minClient = null
    let pluginContractVersion = null
    const seams = new Set()
    for (const [name, info] of externalEntries) {
      if (typeof info !== 'object' || info === null
        || typeof info.directoryName !== 'string' || typeof info.version !== 'string') {
        issues.push(`${name} 外部条目缺 directoryName/version`)
        continue
      }
      const installPath = join(generationDir, 'packages', info.directoryName, info.version, '.install.json')
      let install
      try {
        install = JSON.parse(await readFile(installPath, 'utf8'))
      } catch (error) {
        if (error?.code === 'ENOENT') issues.push(`${name} .install.json 缺失`)
        else issues.push(`${name} .install.json 解析失败: ${error.message}`)
        continue
      }
      if (install.schemaVersion !== 1) issues.push(`${name} .install.json schemaVersion 未知: ${install.schemaVersion}`)
      if (typeof install.minClient !== 'string' || install.minClient.length === 0) {
        issues.push(`${name} .install.json 缺 minClient`)
      } else if (minClient === null || compareVersions(install.minClient, minClient) > 0) {
        minClient = install.minClient
      }
      if (typeof install.harnessCommit !== 'string' || !/^[0-9a-f]{40}$/u.test(install.harnessCommit)) {
        issues.push(`${name} .install.json 缺/非法 Harness commit`)
      }
      if (typeof install.pluginContractVersion !== 'string' || install.pluginContractVersion.length === 0) {
        issues.push(`${name} .install.json 缺 pluginContractVersion`)
      } else if (pluginContractVersion === null) {
        pluginContractVersion = install.pluginContractVersion
      } else if (install.pluginContractVersion !== pluginContractVersion) {
        issues.push(`${name} .install.json pluginContractVersion 不一致`)
      }
      if (!Array.isArray(install.seams)) {
        issues.push(`${name} .install.json 缺 seams`)
      } else {
        for (const seam of install.seams) {
          if (typeof seam === 'string' && seam.length > 0) seams.add(seam)
        }
      }
    }
    if (issues.length > 0) {
      throw new Error(`当前外部插件 generation ${current.generationId} 兼容证据不完整: ${issues.join('; ')}`)
    }
    return {
      external: externalEntries.length > 0,
      generationId: current.generationId,
      harnessCommit: batch.harness.commit,
      minClient,
      pluginContractVersion,
      seams: [...seams],
    }
  }

  async assertHarnessCompatibleWithPluginGeneration(commit) {
    const info = await this.readActivePluginGeneration()
    if (info === null || !info.external) return
    if (info.harnessCommit !== commit) {
      throw new Error(`当前外部插件 generation ${info.generationId} 绑定 Harness ${info.harnessCommit}，不能切换到 ${commit}；请先回退插件到内置或兼容代。`)
    }
  }

  async assertClientVersionCompatibleWithPluginGeneration(version, manifest) {
    const info = await this.readActivePluginGeneration()
    if (info === null || !info.external) return
    if (compareVersions(version, info.minClient) < 0) {
      throw new Error(`当前外部插件 generation ${info.generationId} 需要客户端 >= ${info.minClient}，不能回滚到 ${version}；请先回退插件。`)
    }
    if (manifest === undefined) return
    if (typeof manifest !== 'object' || manifest === null) {
      throw new Error('候选客户端 release manifest 缺失，无法完成跨线兼容校验。')
    }
    if (!Array.isArray(manifest.supportedHarnessCommits) || !manifest.supportedHarnessCommits.includes(info.harnessCommit)) {
      throw new Error(`候选客户端 manifest 不支持当前外部插件 generation 绑定的 Harness ${info.harnessCommit}。`)
    }
    if (manifest.pluginContractVersion !== info.pluginContractVersion) {
      throw new Error(`候选客户端插件合同版本 ${manifest.pluginContractVersion} 与外部 generation ${info.pluginContractVersion} 不一致。`)
    }
    const capabilities = manifest.seamCapabilities
    const missingSeams = info.seams.filter(seam => !capabilities || typeof capabilities[seam] !== 'string')
    if (missingSeams.length > 0) {
      throw new Error(`候选客户端 manifest 缺少 seam 能力: ${missingSeams.join(', ')}`)
    }
  }

  async rollbackPluginGeneration() {
    const externalRoot = join(this.userDataPath, 'plugins-external')
    const currentPath = join(externalRoot, 'current.json')
    const previousPath = join(externalRoot, 'previous.json')
    if (await stat(previousPath).then(() => true).catch(() => false)) {
      const previous = JSON.parse(await readFile(previousPath, 'utf8'))
      if (typeof previous?.generationId !== 'string') throw new Error('previous.json 缺少 generationId。')
      await writeFile(currentPath, `${JSON.stringify({
        generationId: previous.generationId,
        committedAt: new Date().toISOString(),
      }, null, 2)}\n`)
      await rm(previousPath, { force: true })
      this.plugin = {
        ...this.plugin,
        status: 'ready',
        canRollback: false,
        message: '已回滚到上一外部 generation，重启后生效。',
      }
    } else if (await stat(currentPath).then(() => true).catch(() => false)) {
      await rm(currentPath, { force: true })
      await rm(join(externalRoot, 'pending.json'), { force: true }).catch(() => {})
      this.plugin = {
        ...this.plugin,
        status: 'current',
        canRollback: false,
        message: '已回退到内置插件基线，重启后生效。',
      }
    } else {
      throw new Error('当前没有可回滚的外部插件 generation。')
    }
    return this.snapshot()
  }

  async removePluginGeneration() {
    const externalRoot = join(this.userDataPath, 'plugins-external')
    for (const name of ['pending.json', 'activating.json', 'current.json', 'previous.json']) {
      await rm(join(externalRoot, name), { force: true }).catch(() => {})
    }
    this.plugin = this.initialPluginState()
    return this.snapshot()
  }

  async previewPluginPurge() {
    const externalRoot = join(this.userDataPath, 'plugins-external')
    const countDir = async name => {
      try {
        const entries = await readdir(join(externalRoot, name))
        return entries.length
      } catch {
        return 0
      }
    }
    const externalGenerations = await countDir('generations')
    const quarantineItems = await countDir('quarantine')
    const token = randomUUID()
    this.pluginPurgeToken = token
    return {
      token,
      externalGenerations,
      quarantineItems,
      wouldRemoveBusinessData: false,
    }
  }

  async purgePluginGeneration(token) {
    if (typeof token !== 'string' || token.length === 0 || token !== this.pluginPurgeToken) {
      throw new Error('purge 需要 preview 返回的确认令牌。')
    }
    const externalRoot = join(this.userDataPath, 'plugins-external')
    for (const name of ['generations', 'staging', 'quarantine']) {
      await rm(join(externalRoot, name), { recursive: true, force: true }).catch(() => {})
    }
    for (const name of ['pending.json', 'activating.json', 'current.json', 'previous.json']) {
      await rm(join(externalRoot, name), { force: true }).catch(() => {})
    }
    this.pluginPurgeToken = undefined
    this.plugin = this.initialPluginState()
    return this.snapshot()
  }

  async previewPluginGC() {
    const externalRoot = join(this.userDataPath, 'plugins-external')
    const keep = await this.collectPluginGcKeepSet(externalRoot)
    let generations = []
    try {
      generations = await readdir(join(externalRoot, 'generations'))
    } catch {
      generations = []
    }
    const reclaimableGenerations = generations.filter(name => !keep.has(name))
    let stagingNames = []
    let quarantineNames = []
    try {
      stagingNames = await readdir(join(externalRoot, 'staging'))
    } catch {
      stagingNames = []
    }
    try {
      quarantineNames = await readdir(join(externalRoot, 'quarantine'))
    } catch {
      quarantineNames = []
    }
    const token = randomUUID()
    this.pluginGcToken = token
    return {
      token,
      reclaimableGenerations,
      stagingItems: stagingNames.length,
      stagingDirectories: stagingNames,
      quarantineItems: quarantineNames.length,
      quarantineDirectories: quarantineNames,
      wouldRemoveBusinessData: false,
    }
  }

  async gcPluginGenerations(token) {
    if (typeof token !== 'string' || token.length === 0 || token !== this.pluginGcToken) {
      throw new Error('GC 需要 preview 返回的确认令牌。')
    }
    const externalRoot = join(this.userDataPath, 'plugins-external')
    const keep = await this.collectPluginGcKeepSet(externalRoot)
    const generationsRoot = join(externalRoot, 'generations')
    let generations = []
    try {
      generations = await readdir(generationsRoot)
    } catch {
      generations = []
    }
    for (const name of generations) {
      if (keep.has(name)) continue
      await rm(join(generationsRoot, name), { recursive: true, force: true }).catch(() => {})
    }
    for (const name of ['staging', 'quarantine']) {
      await rm(join(externalRoot, name), { recursive: true, force: true }).catch(() => {})
    }
    this.pluginGcToken = undefined
    this.plugin = {
      ...this.plugin,
      message: '插件 generation GC 完成，已保留当前与上一已知良好代。',
    }
    return this.snapshot()
  }

  async collectPluginGcKeepSet(externalRoot) {
    const keep = new Set()
    for (const name of ['current.json', 'previous.json']) {
      const journalPath = join(externalRoot, name)
      let exists = true
      try {
        await access(journalPath, fsConstants.R_OK)
      } catch {
        exists = false
      }
      if (!exists) continue
      let state
      try {
        state = JSON.parse(await readFile(journalPath, 'utf8'))
      } catch (error) {
        throw new Error(`GC 拒绝：${name} 损坏，不能把所有 generation 当垃圾: ${error.message}`)
      }
      if (typeof state !== 'object' || state === null
        || typeof state.generationId !== 'string' || state.generationId.length === 0) {
        throw new Error(`GC 拒绝：${name} 缺 generationId，不能继续清理。`)
      }
      const generationDir = join(externalRoot, 'generations', state.generationId)
      try {
        await access(generationDir)
      } catch {
        throw new Error(`GC 拒绝：${name} 指向缺失 generation ${state.generationId}，不能继续清理。`)
      }
      keep.add(state.generationId)
    }
    return keep
  }

  async snapshot() {
    const plugins = await bundledPluginVersions(this.projectRoot)
    return structuredClone({
      settings: this.document.settings,
      lastCheckedAt: this.document.lastCheckedAt,
      desktop: this.desktop,
      harness: this.harness,
      plugins,
      pluginChannel: this.plugin,
    })
  }

  async persist() {
    await mkdir(dirname(this.statePath), { recursive: true })
    const temporary = `${this.statePath}.${randomUUID()}.tmp`
    await writeFile(temporary, `${JSON.stringify(this.document, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
    await rename(temporary, this.statePath)
  }

  async runCommand(executable, arguments_, options) {
    const env = await this.getChildEnvironment()
    return runCommand(executable, arguments_, {
      ...options,
      env,
      signal: this.abortController.signal,
      activeCommands: this.activeCommands,
    })
  }

  async runPnpm(arguments_, cwd) {
    const env = await this.getChildEnvironment()
    return runPnpm(arguments_, cwd, {
      env,
      signal: this.abortController.signal,
      activeCommands: this.activeCommands,
    })
  }

  async getChildEnvironment() {
    if (this.childEnvironmentPromise === undefined) {
      const processHome = join(this.userDataPath, 'update-process-home')
      const roamingData = join(processHome, 'AppData', 'Roaming')
      const localData = join(processHome, 'AppData', 'Local')
      const processTemp = join(localData, 'Temp')
      const corepackHome = join(localData, 'Corepack')
      const npmCache = join(localData, 'npm-cache')
      const pnpmStore = join(localData, 'pnpm-store')
      const npmConfig = join(processHome, 'empty-npmrc')
      // 2026-08-21：新版 npm 拒绝同一文件同时作为 user/global 配置
      // （double-loading config 报错导致上游 build 失败），global 用独立文件。
      const npmGlobalConfig = join(processHome, 'empty-npmrc-global')
      this.childEnvironmentPromise = (async () => {
        await Promise.all([
          mkdir(roamingData, { recursive: true }),
          mkdir(localData, { recursive: true }),
          mkdir(processTemp, { recursive: true }),
          mkdir(corepackHome, { recursive: true }),
          mkdir(npmCache, { recursive: true }),
          mkdir(pnpmStore, { recursive: true }),
        ])
        await writeFile(npmConfig, '', 'utf8')
        await writeFile(npmGlobalConfig, '', 'utf8')
        return {
          ...createMinimalEnvironment(process.env),
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
          ...(process.platform === 'win32' ? windowsHomeVariables(processHome) : {}),
        }
      })()
    }
    try {
      return await this.childEnvironmentPromise
    } catch (error) {
      this.childEnvironmentPromise = undefined
      throw error
    }
  }

  async gitCommit(root) {
    const result = await this.runCommand('git.exe', ['-c', 'core.longpaths=true', '-C', root, 'rev-parse', 'HEAD'], {
      cwd: root,
      timeoutMs: GIT_TIMEOUT_MS,
    })
    return validateCommit(result.stdout.trim())
  }

  async isPreparedRuntime(root, commit) {
    try {
      await validateHarnessRoot(root)
      return await this.gitCommit(root) === commit
    } catch {
      return false
    }
  }

  async quiesce() {
    if (this.disposed) return
    this.closing = true
    this.abortController.abort()
    try {
      const active = [...this.activeCommands]
      const terminations = await Promise.allSettled(active.map(record => terminateUpdateRecord(record)))
      const preflightStops = await Promise.allSettled(
        [...this.activePreflights].map(async supervisor => {
          await supervisor.stop()
          this.activePreflights.delete(supervisor)
        }),
      )
      await waitForSettlement(this.operation, 15_000, '更新任务未能在退出前停止。')
      const failed = [...terminations, ...preflightStops].find(result => result.status === 'rejected')
      if (failed?.status === 'rejected') throw failed.reason
      if (this.activeCommands.size !== 0) throw new Error('仍有更新子进程未能在退出前停止。')
      if (this.activePreflights.size !== 0) throw new Error('仍有 Harness 更新预检进程未能在退出前停止。')
    } finally {
      if (!this.disposed) {
        this.abortController = new AbortController()
        this.closing = false
      }
    }
  }

  dispose() {
    if (this.disposePromise !== undefined) return this.disposePromise
    const attempt = (async () => {
      await this.quiesce()
      this.disposed = true
      this.closing = true
    })()
    this.disposePromise = attempt.catch(error => {
      this.disposePromise = undefined
      throw error
    })
    return this.disposePromise
  }

  exclusive(operation) {
    if (this.disposed || this.closing) return Promise.reject(new Error('更新服务正在关闭。'))
    const guarded = async () => {
      if (this.disposed || this.closing) throw new Error('更新服务正在关闭。')
      if (this.activeCommands.size !== 0 || this.activePreflights.size !== 0) {
        throw new Error('上一项更新任务的进程仍未确认退出。')
      }
      return operation()
    }
    const next = this.operation.then(guarded, guarded)
    this.operation = next.then(() => undefined, () => undefined)
    return next
  }
}

async function readUpdateDocument(path) {
  try {
    const metadata = await stat(path)
    if (metadata.size > 256 * 1024) {
      await preserveCorruptState(path)
      return defaultUpdateDocument()
    }
  } catch (error) {
    if (error?.code === 'ENOENT') return defaultUpdateDocument()
    throw error
  }
  let raw
  try {
    raw = await readFile(path, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') return defaultUpdateDocument()
    throw error
  }
  if (Buffer.byteLength(raw, 'utf8') > 256 * 1024) {
    await preserveCorruptState(path)
    return defaultUpdateDocument()
  }
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error
    await preserveCorruptState(path)
    return defaultUpdateDocument()
  }
  if (typeof parsed !== 'object' || parsed === null || parsed.schemaVersion !== UPDATE_STATE_VERSION) {
    await preserveCorruptState(path)
    return defaultUpdateDocument()
  }
  return { ...defaultUpdateDocument(), ...parsed, settings: normalizeUpdateSettings(parsed.settings) }
}

async function collectFileHashes(directory, output, prefix = '') {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = join(directory, entry.name)
    const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`
    if (entry.isDirectory()) {
      await collectFileHashes(absolute, output, rel)
    } else if (entry.isFile()) {
      output[rel] = sha256(await readFile(absolute))
    }
  }
}

async function bundledPluginVersions(projectRoot) {
  const pluginsRoot = join(projectRoot, 'plugins')
  let entries
  try {
    entries = await import('node:fs/promises').then(fs => fs.readdir(pluginsRoot, { withFileTypes: true }))
  } catch {
    return []
  }
  const rows = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    try {
      const manifest = JSON.parse(await readFile(join(pluginsRoot, entry.name, 'package.json'), 'utf8'))
      if (typeof manifest.name === 'string' && typeof manifest.version === 'string') {
        rows.push({ packageName: manifest.name, version: manifest.version, updateWithDesktop: true })
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
  }
  return rows.sort((left, right) => left.packageName.localeCompare(right.packageName))
}

async function githubJson(path, signal) {
  const text = await fetchText(`https://api.github.com${path}`, MAX_RELEASE_RESPONSE_BYTES, {
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
  }, REQUEST_TIMEOUT_MS, signal)
  return JSON.parse(text)
}

async function desktopGithubJson(path, signal) {
  const localBase = resolveLocalUpdateBase()
  const url = localBase === null ? `https://api.github.com${path}` : `${localBase}${path}`
  const text = await fetchText(url, MAX_RELEASE_RESPONSE_BYTES, {
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
  }, REQUEST_TIMEOUT_MS, signal, true)
  return JSON.parse(text)
}

async function fetchText(url, maximumBytes, headers = {}, timeoutMs = REQUEST_TIMEOUT_MS, signal, allowLocal = false) {
  return (await fetchBuffer(url, maximumBytes, undefined, headers, timeoutMs, signal, allowLocal)).toString('utf8')
}

const GITHUB_DOWNLOAD_HOSTS = new Set([
  'api.github.com',
  'github.com',
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com',
])
const MAX_REDIRECT_HOPS = 5

function assertAllowedUpdateTarget(target, localBase) {
  const parsed = new URL(target)
  if (localBase !== null) {
    if (parsed.origin !== localBase) {
      throw new Error('Update redirect left the local E2E update source before the next request.')
    }
    return
  }
  if (parsed.protocol !== 'https:' || !GITHUB_DOWNLOAD_HOSTS.has(parsed.hostname)) {
    throw new Error('Update download was redirected to an untrusted host before the next request.')
  }
}

async function fetchBuffer(url, maximumBytes, onProgress, headers = {}, timeoutMs = REQUEST_TIMEOUT_MS, externalSignal, allowLocal = false) {
  const parsed = new URL(url)
  const localBase = resolveLocalUpdateBase()
  const isLocal = allowLocal && localBase !== null && parsed.origin === localBase
  if (!isLocal) {
    if (parsed.protocol !== 'https:' || !GITHUB_DOWNLOAD_HOSTS.has(parsed.hostname)) {
      throw new Error('Update download was redirected to an untrusted host.')
    }
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const signal = externalSignal === undefined
    ? controller.signal
    : AbortSignal.any([controller.signal, externalSignal])
  try {
    let currentUrl = parsed
    for (let hop = 0; ; hop += 1) {
      const response = await fetch(currentUrl, {
        // Local E2E must never follow a redirect first and validate only the
        // final URL: every hop is checked before the next request is made.
        redirect: 'manual',
        signal,
        headers: { 'user-agent': 'DeepSeek-Harness-Personal-Updater', ...headers },
      })
      if (response.status >= 300 && response.status < 400) {
        if (hop >= MAX_REDIRECT_HOPS) throw new Error('Update response exceeded the redirect limit.')
        const location = response.headers.get('location')
        if (location === null || location === '') throw new Error('Update redirect response is missing a Location header.')
        const nextUrl = new URL(location, currentUrl)
        assertAllowedUpdateTarget(nextUrl, isLocal ? localBase : null)
        currentUrl = nextUrl
        continue
      }
      if (!response.ok) throw new Error(`GitHub request failed with HTTP ${String(response.status)}.`)
      if (isLocal && currentUrl.origin !== localBase) {
        throw new Error('Update download ended outside the local E2E update source.')
      }
      const declared = Number(response.headers.get('content-length'))
      if (Number.isFinite(declared) && declared > maximumBytes) throw new Error('Update response exceeds the allowed size.')
      if (response.body === null) throw new Error('Update response has no body.')
      const chunks = []
      let total = 0
      for await (const chunk of response.body) {
        const buffer = Buffer.from(chunk)
        total += buffer.length
        if (total > maximumBytes) throw new Error('Update response exceeds the allowed size.')
        chunks.push(buffer)
        if (declared > 0) onProgress?.(Math.min(99, Math.round(total / declared * 100)))
      }
      return Buffer.concat(chunks)
    }
  } finally {
    clearTimeout(timer)
  }
}

async function runPnpm(arguments_, cwd, runtime) {
  // 2026-08-21：不能假设目标机器有全局 pnpm（Cyrus 机器就没有，更新中心曾因此
  // 报 “'pnpm.cmd' 不是内部或外部命令”）。优先使用随应用发布的 vendor pnpm，
  // 通过已解析的真实 Node 可执行文件运行；找不到再退回 PATH 上的 pnpm。
  const vendored = resolveVendoredPnpm(runtime?.env ?? process.env)
  if (vendored !== null) {
    return runCommand(vendored.nodeExecutable, [vendored.pnpmCjs, ...arguments_], {
      cwd, timeoutMs: BUILD_TIMEOUT_MS, ...runtime,
    })
  }
  if (process.platform === 'win32') {
    const command = `pnpm.cmd ${arguments_.join(' ')}`
    const commandProcessor = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'cmd.exe')
    return runCommand(commandProcessor, ['/d', '/s', '/c', command], {
      cwd, timeoutMs: BUILD_TIMEOUT_MS, ...runtime,
    })
  }
  return runCommand('pnpm', arguments_, { cwd, timeoutMs: BUILD_TIMEOUT_MS, ...runtime })
}

function runCommand(executable, arguments_, options) {
  return new Promise((resolvePromise, rejectPromise) => {
    if (options.signal?.aborted) {
      rejectPromise(new Error('更新任务已取消。'))
      return
    }
    const child = spawn(executable, arguments_, {
      cwd: options.cwd,
      env: options.env ?? createMinimalEnvironment(process.env),
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const guard = createWindowsJobGuard(child.pid)
    const record = { child, guard, released: false }
    options.activeCommands?.add(record)
    let stdout = ''
    let stderr = ''
    let settled = false
    let terminating = false
    const append = (value, chunk) => `${value}${chunk}`.slice(-128_000)
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', chunk => { stdout = append(stdout, chunk) })
    child.stderr.on('data', chunk => { stderr = append(stderr, chunk) })
    const releaseRecord = () => {
      if (record.released) return
      record.released = true
      options.activeCommands?.delete(record)
      guard.close()
    }
    const cleanup = confirmedStopped => {
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', abort)
      if (confirmedStopped) releaseRecord()
    }
    const finish = (error, value, confirmedStopped = true) => {
      if (settled) return
      settled = true
      cleanup(confirmedStopped)
      if (error !== undefined) rejectPromise(error)
      else resolvePromise(value)
    }
    const stop = error => {
      if (settled || terminating) return
      terminating = true
      void terminateUpdateRecord(record).then(
        () => finish(error),
        stopError => finish(new Error(`${error.message}\n${messageOf(stopError)}`), undefined, false),
      )
    }
    const abort = () => stop(new Error('更新任务已取消。'))
    const timer = setTimeout(() => {
      stop(new Error(`${basename(executable)} timed out.\n${stderr.slice(-4_000)}`))
    }, options.timeoutMs)
    options.signal?.addEventListener('abort', abort, { once: true })
    child.once('error', error => {
      if (!terminating) finish(error)
    })
    child.once('close', code => {
      releaseRecord()
      if (terminating) return
      if (code === 0) finish(undefined, { stdout, stderr })
      else finish(new Error(`${basename(executable)} exited with code ${String(code)}.\n${stderr.slice(-8_000)}`))
    })
  })
}

const terminationRequests = new WeakMap()

async function terminateUpdateRecord(record) {
  try {
    await terminateChildTree(record.child)
  } catch (error) {
    if (record.guard.active) {
      record.guard.close()
      await waitForChildClose(record.child, 8_000, 'Windows Job Object did not stop an update task.')
      return
    }
    throw error
  }
}

function terminateChildTree(child) {
  const existing = terminationRequests.get(child)
  if (existing !== undefined) return existing
  const request = (async () => {
    if (child.exitCode !== null || child.signalCode !== null || child.pid === undefined) return
    if (process.platform === 'win32') {
      const killer = spawn('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], {
        shell: false,
        windowsHide: true,
        stdio: 'ignore',
      })
      await waitForChildClose(killer, 8_000, 'taskkill did not finish while stopping an update task.')
    } else {
      child.kill('SIGKILL')
    }
    await waitForChildClose(child, 8_000, 'An update child process did not exit after termination.')
  })()
  const retryable = request.catch(error => {
    terminationRequests.delete(child)
    throw error
  })
  terminationRequests.set(child, retryable)
  return retryable
}

function waitForChildClose(child, timeoutMs, timeoutMessage) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve()
  return new Promise((resolvePromise, rejectPromise) => {
    let settled = false
    const cleanup = () => {
      clearTimeout(timer)
      child.removeListener('close', close)
      child.removeListener('error', fail)
    }
    const close = () => {
      if (settled) return
      settled = true
      cleanup()
      resolvePromise()
    }
    const fail = error => {
      if (settled) return
      settled = true
      cleanup()
      rejectPromise(error)
    }
    const timer = setTimeout(() => fail(new Error(timeoutMessage)), timeoutMs)
    child.once('close', close)
    child.once('error', fail)
    if (child.exitCode !== null || child.signalCode !== null) close()
  })
}

function waitForSettlement(promise, timeoutMs, timeoutMessage) {
  return new Promise((resolvePromise, rejectPromise) => {
    const timer = setTimeout(() => rejectPromise(new Error(timeoutMessage)), timeoutMs)
    promise.then(
      () => {
        clearTimeout(timer)
        resolvePromise()
      },
      error => {
        clearTimeout(timer)
        rejectPromise(error)
      },
    )
  })
}

async function preserveCorruptState(path) {
  try {
    await rename(path, `${path}.corrupt-${Date.now()}`)
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
}

function validateCommit(value) {
  if (!/^[a-f0-9]{40}$/u.test(String(value))) throw new Error('GitHub returned an invalid commit id.')
  return String(value)
}

async function validateHarnessRoot(root) {
  await access(join(root, 'package.json'), fsConstants.R_OK)
  await access(join(root, 'apps', 'cli', 'src', 'profile-boot.ts'), fsConstants.R_OK)
}

function isManagedRuntimePath(userDataPath, candidate) {
  if (typeof candidate !== 'string' || !isAbsolute(candidate)) return false
  const root = resolve(userDataPath, 'harness-runtimes')
  const child = resolve(candidate)
  const rel = relative(root, child)
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

function isManagedDownloadPath(userDataPath, candidate) {
  if (typeof candidate !== 'string' || !isAbsolute(candidate)) return false
  const root = resolve(userDataPath, 'updates', 'downloads')
  const child = resolve(candidate)
  const rel = relative(root, child)
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

async function safeRemoveWithin(root, candidate) {
  const resolvedRoot = resolve(root)
  const resolvedCandidate = resolve(candidate)
  const rel = relative(resolvedRoot, resolvedCandidate)
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) throw new Error('Refusing to remove a path outside the runtime staging directory.')
  await rm(resolvedCandidate, { recursive: true, force: true })
}

function normalizeVersion(value) {
  return String(value).trim().replace(/^v/u, '')
}

function safeAssetName(value) {
  const name = basename(String(value))
  if (name !== value || !/^[A-Za-z0-9._ -]+\.exe$/u.test(name)) throw new Error('Release asset has an unsafe file name.')
  return name
}

function safePluginAssetName(value) {
  const name = basename(String(value))
  if (name !== value || !/^[A-Za-z0-9._-]+\.tgz$/u.test(name)) throw new Error('插件资产文件名不安全。')
  return name
}

async function writeFileAtomic(path, data) {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${randomUUID()}.tmp`
  await writeFile(temporary, data, { flag: 'wx' })
  try {
    await rename(temporary, path)
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {})
    throw error
  }
}

function textLimit(value, maximum) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim().slice(0, maximum) : undefined
}

function windowsHomeVariables(processHome) {
  const drive = parse(processHome).root.replace(/[\\/]+$/u, '')
  return {
    HOMEDRIVE: drive,
    HOMEPATH: processHome.slice(drive.length),
  }
}

function messageOf(error) {
  return error instanceof Error && error.message.trim() !== '' ? error.message : String(error)
}
