import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { commitActivatingGeneration, PERSONAL_PLUGINS, startPendingActivation } from '../src/personal-plugins.js'
import { resolveActiveHarnessRoot, UpdateService } from '../src/update-service.js'

const require = createRequire(import.meta.url)
const tar = require('../vendor/pnpm/dist/node_modules/tar')

test('active Harness selection accepts only a valid managed runtime below userData', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-personal-update-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const fallback = join(root, 'fallback')
  const managed = join(root, 'harness-runtimes', 'a'.repeat(40))
  await mkdir(join(managed, 'apps', 'cli', 'src'), { recursive: true })
  await writeFile(join(managed, 'package.json'), '{}\n')
  await writeFile(join(managed, 'apps', 'cli', 'src', 'profile-boot.ts'), 'export {}\n')
  await writeFile(join(root, 'update-center.json'), `${JSON.stringify({
    schemaVersion: 1,
    settings: {
      desktopRepository: '',
      harnessRepository: 'deepseek-ai/deepseek-harness',
      channel: 'stable',
      autoCheck: true,
    },
    activeHarnessRoot: managed,
    activeHarnessRepository: 'deepseek-ai/deepseek-harness',
  })}\n`)
  assert.equal(await resolveActiveHarnessRoot(root, fallback), managed)

  await writeFile(join(root, 'update-center.json'), `${JSON.stringify({
    schemaVersion: 1,
    settings: {
      desktopRepository: '',
      harnessRepository: 'deepseek-ai/deepseek-harness',
      channel: 'stable',
      autoCheck: true,
    },
    activeHarnessRoot: 'C:\\Windows',
  })}\n`)
  assert.equal(await resolveActiveHarnessRoot(root, fallback), fallback)
})

test('a corrupt updater document cannot prevent the desktop from using its fallback checkout', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-personal-update-corrupt-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const fallback = join(root, 'fallback')
  await writeFile(join(root, 'update-center.json'), '{not-json')
  assert.equal(await resolveActiveHarnessRoot(root, fallback), fallback)
})

test('an oversized updater document is quarantined instead of blocking startup', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-personal-update-oversized-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const fallback = join(root, 'fallback')
  await writeFile(join(root, 'update-center.json'), Buffer.alloc(256 * 1024 + 1, 0x20))
  assert.equal(await resolveActiveHarnessRoot(root, fallback), fallback)
})

test('an installed stable without a release repository explains the local manual upgrade path', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-personal-update-no-repo-'))
  const service = new UpdateService({
    app: { getVersion: () => '0.1.0', isPackaged: true },
    shell: {},
    userDataPath: root,
    projectRoot: root,
    getCurrentSourceRoot: () => 'D:\\Deepseek Harness',
    preflightHarness: async () => {},
    onInstallDesktop: async () => {},
    onRelaunch: async () => {},
  })
  await writeFile(join(root, 'update-center.json'), JSON.stringify({
    schemaVersion: 1,
    settings: {
      desktopRepository: '',
      harnessRepository: 'deepseek-ai/deepseek-harness',
      channel: 'stable',
      autoCheck: true,
    },
  }))
  t.after(async () => {
    await service.dispose().catch(() => {})
    await rm(root, { recursive: true, force: true })
  })
  await service.ensureLoaded()
  await service.checkDesktop()
  const state = await service.getState()
  assert.equal(state.desktop.status, 'unsupported')
  assert.match(state.desktop.message ?? '', /最新安装包人工升级/u)
})

test('the development tree keeps the original missing-repository message', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-personal-update-no-repo-dev-'))
  const service = new UpdateService({
    app: { getVersion: () => '0.1.0', isPackaged: false },
    shell: {},
    userDataPath: root,
    projectRoot: root,
    getCurrentSourceRoot: () => 'D:\\Deepseek Harness',
    preflightHarness: async () => {},
    onInstallDesktop: async () => {},
    onRelaunch: async () => {},
  })
  await writeFile(join(root, 'update-center.json'), JSON.stringify({
    schemaVersion: 1,
    settings: {
      desktopRepository: '',
      harnessRepository: 'deepseek-ai/deepseek-harness',
      channel: 'stable',
      autoCheck: true,
    },
  }))
  t.after(async () => {
    await service.dispose().catch(() => {})
    await rm(root, { recursive: true, force: true })
  })
  await service.ensureLoaded()
  await service.checkDesktop()
  const state = await service.getState()
  assert.equal(state.desktop.status, 'unsupported')
  assert.match(state.desktop.message ?? '', /尚未配置/u)
})

test('a downloaded installer is retired after the client has reached that version', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-personal-update-installed-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const download = join(root, 'updates', 'downloads', 'setup.exe')
  await mkdir(join(root, 'updates', 'downloads'), { recursive: true })
  await writeFile(download, 'already-installed')
  await writeFile(join(root, 'update-center.json'), `${JSON.stringify({
    schemaVersion: 1,
    settings: {
      desktopRepository: 'cyrus/personal',
      harnessRepository: 'deepseek-ai/deepseek-harness',
      channel: 'stable',
      autoCheck: true,
    },
    downloadedDesktop: {
      path: download,
      sha256: '0'.repeat(64),
      version: '0.1.0',
      assetName: 'setup.exe',
      repository: 'cyrus/personal',
      channel: 'stable',
    },
  })}\n`)
  const service = new UpdateService({
    app: { getVersion: () => '0.1.0', isPackaged: true },
    shell: {},
    userDataPath: root,
    projectRoot: root,
    getCurrentSourceRoot: () => root,
    preflightHarness: async () => {},
    onInstallDesktop: async () => {},
    onRelaunch: async () => {},
  })
  t.after(() => service.dispose().catch(() => {}))
  const state = await service.getState()
  assert.notEqual(state.desktop.status, 'ready')
  assert.equal(state.desktop.canInstall, false)
  const persisted = JSON.parse(await readFile(join(root, 'update-center.json'), 'utf8'))
  assert.equal(persisted.downloadedDesktop, undefined)
})

test('quiescing the updater strips secrets and confirms its active child has exited', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-personal-update-child-'))
  const marker = join(root, 'child.json')
  const service = new UpdateService({
    app: { getVersion: () => '0.1.0', isPackaged: false },
    shell: {},
    userDataPath: root,
    projectRoot: root,
    getCurrentSourceRoot: () => 'D:\\Deepseek Harness',
    preflightHarness: async () => {},
    onInstallDesktop: async () => {},
    onRelaunch: async () => {},
  })
  t.after(async () => {
    await service.dispose().catch(() => {})
    await rm(root, { recursive: true, force: true })
  })
  const inherited = {
    DSH_UPDATE_TEST_SECRET: process.env.DSH_UPDATE_TEST_SECRET,
    GITHUB_PAT: process.env.GITHUB_PAT,
    AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
    SSH_AUTH_SOCK: process.env.SSH_AUTH_SOCK,
    NPM_CONFIG_USERCONFIG: process.env.NPM_CONFIG_USERCONFIG,
  }
  Object.assign(process.env, {
    DSH_UPDATE_TEST_SECRET: 'must-not-leak',
    GITHUB_PAT: 'must-not-leak',
    AWS_ACCESS_KEY_ID: 'must-not-leak',
    SSH_AUTH_SOCK: 'must-not-leak',
    NPM_CONFIG_USERCONFIG: 'C:\\Users\\real\\.npmrc',
  })
  t.after(() => {
    for (const [key, value] of Object.entries(inherited)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  const script = `require('node:fs').writeFileSync(${JSON.stringify(marker)}, JSON.stringify({ pid: process.pid, secret: process.env.DSH_UPDATE_TEST_SECRET, github: process.env.GITHUB_PAT, aws: process.env.AWS_ACCESS_KEY_ID, ssh: process.env.SSH_AUTH_SOCK, npmrc: process.env.NPM_CONFIG_USERCONFIG, home: process.env.USERPROFILE, temp: process.env.TEMP, corepack: process.env.COREPACK_HOME, store: process.env.NPM_CONFIG_STORE_DIR, gitPrompt: process.env.GIT_TERMINAL_PROMPT })); setInterval(() => {}, 1000)`
  const outcome = service.runCommand(process.execPath, ['-e', script], { cwd: root, timeoutMs: 60_000 })
    .then(() => undefined, error => error)
  const payload = await waitForJson(marker)
  assert.equal(payload.secret, undefined)
  assert.equal(payload.github, undefined)
  assert.equal(payload.aws, undefined)
  assert.equal(payload.ssh, undefined)
  assert.match(payload.npmrc, /empty-npmrc$/u)
  assert.match(payload.home, /update-process-home$/u)
  assert.match(payload.temp, /update-process-home[\\/]AppData[\\/]Local[\\/]Temp$/u)
  assert.match(payload.corepack, /update-process-home[\\/]AppData[\\/]Local[\\/]Corepack$/u)
  assert.match(payload.store, /update-process-home[\\/]AppData[\\/]Local[\\/]pnpm-store$/u)
  assert.equal(payload.gitPrompt, '0')
  await service.quiesce()
  assert.match((await outcome)?.message ?? '', /取消/u)
  assert.equal(isProcessAlive(payload.pid), false)
})

test('quiescing retains an unconfirmed preflight and removes it after a successful retry', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-personal-update-preflight-'))
  const service = new UpdateService({
    app: { getVersion: () => '0.1.0', isPackaged: false },
    shell: {},
    userDataPath: root,
    projectRoot: root,
    getCurrentSourceRoot: () => 'D:\\Deepseek Harness',
    preflightHarness: async () => {},
    onInstallDesktop: async () => {},
    onRelaunch: async () => {},
  })
  let attempts = 0
  const supervisor = {
    async stop() {
      attempts += 1
      if (attempts === 1) throw new Error('preflight tree still alive')
      return { graceful: false, forced: true, code: 1, signal: null }
    },
  }
  t.after(async () => {
    service.activePreflights.delete(supervisor)
    await service.dispose().catch(() => {})
    await rm(root, { recursive: true, force: true })
  })
  service.activePreflights.add(supervisor)
  await assert.rejects(service.quiesce(), /preflight tree still alive/u)
  assert.equal(service.activePreflights.has(supervisor), true)
  await service.quiesce()
  assert.equal(attempts, 2)
  assert.equal(service.activePreflights.size, 0)
  await service.dispose()
})

async function waitForJson(path) {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    try {
      return JSON.parse(await readFile(path, 'utf8'))
    } catch (error) {
      if (error?.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error
      await new Promise(resolvePromise => setTimeout(resolvePromise, 25))
    }
  }
  throw new Error(`Timed out waiting for ${path}`)
}


test('checkDesktop falls back to /releases/latest when the release list is empty', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-personal-update-fallback-'))
  const service = new UpdateService({
    app: { getVersion: () => '0.1.0', isPackaged: true },
    shell: {},
    userDataPath: root,
    projectRoot: root,
    getCurrentSourceRoot: () => 'D:\\Deepseek Harness',
    preflightHarness: async () => {},
    onInstallDesktop: async () => {},
    onRelaunch: async () => {},
  })
  await writeFile(join(root, 'update-center.json'), JSON.stringify({
    schemaVersion: 1,
    settings: {
      desktopRepository: 'cyrus/personal',
      harnessRepository: 'deepseek-ai/deepseek-harness',
      channel: 'stable',
      autoCheck: true,
    },
  }))
  const releaseObject = {
    tag_name: 'v0.3.0',
    name: 'DeepSeek Harness Personal v0.3.0',
    draft: false,
    prerelease: false,
    published_at: '2026-08-17T00:00:00Z',
    body: 'release notes',
    html_url: 'https://github.com/cyrus/personal/releases/tag/v0.3.0',
    assets: [{ name: 'DeepSeek-Harness-Personal-0.3.0-setup-x64.exe', digest: 'sha256:' + 'a'.repeat(64), size: 1 }],
  }
  const calls = []
  const realFetch = globalThis.fetch
  globalThis.fetch = async (url) => {
    const target = String(url)
    calls.push(target)
    if (target.includes('/releases?per_page=')) return jsonResponse([], target)
    if (target.endsWith('/releases/latest')) return jsonResponse(releaseObject, target)
    throw new Error('unexpected fetch: ' + target)
  }
  t.after(async () => {
    globalThis.fetch = realFetch
    await service.dispose().catch(() => {})
    await rm(root, { recursive: true, force: true })
  })
  await service.ensureLoaded()
  await service.checkDesktop()
  const state = await service.getState()
  assert.equal(state.desktop.status, 'available')
  assert.equal(state.desktop.latestVersion, '0.3.0')
  assert.equal(state.desktop.canDownload, true)
  assert.equal(calls.filter(target => target.endsWith('/releases/latest')).length, 1)
})

test('checkDesktop keeps the unsupported message when both list and latest fail', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-personal-update-fallback404-'))
  const service = new UpdateService({
    app: { getVersion: () => '0.1.0', isPackaged: true },
    shell: {},
    userDataPath: root,
    projectRoot: root,
    getCurrentSourceRoot: () => 'D:\\Deepseek Harness',
    preflightHarness: async () => {},
    onInstallDesktop: async () => {},
    onRelaunch: async () => {},
  })
  await writeFile(join(root, 'update-center.json'), JSON.stringify({
    schemaVersion: 1,
    settings: {
      desktopRepository: 'cyrus/personal',
      harnessRepository: 'deepseek-ai/deepseek-harness',
      channel: 'stable',
      autoCheck: true,
    },
  }))
  const realFetch = globalThis.fetch
  globalThis.fetch = async (url) => {
    const target = String(url)
    if (target.includes('/releases?per_page=')) return jsonResponse([], target)
    if (target.endsWith('/releases/latest')) return new Response('Not Found', { status: 404, headers: { 'content-type': 'text/plain' } })
    throw new Error('unexpected fetch: ' + target)
  }
  t.after(async () => {
    globalThis.fetch = realFetch
    await service.dispose().catch(() => {})
    await rm(root, { recursive: true, force: true })
  })
  await service.ensureLoaded()
  await service.checkDesktop()
  const state = await service.getState()
  assert.equal(state.desktop.status, 'unsupported')
  assert.match(state.desktop.message ?? '', /还没有符合当前通道/u)
})

test('checkDesktop does not call /releases/latest when the list already has a release', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-personal-update-listok-'))
  const service = new UpdateService({
    app: { getVersion: () => '0.1.0', isPackaged: true },
    shell: {},
    userDataPath: root,
    projectRoot: root,
    getCurrentSourceRoot: () => 'D:\\Deepseek Harness',
    preflightHarness: async () => {},
    onInstallDesktop: async () => {},
    onRelaunch: async () => {},
  })
  await writeFile(join(root, 'update-center.json'), JSON.stringify({
    schemaVersion: 1,
    settings: {
      desktopRepository: 'cyrus/personal',
      harnessRepository: 'deepseek-ai/deepseek-harness',
      channel: 'stable',
      autoCheck: true,
    },
  }))
  const releaseObject = {
    tag_name: 'v0.3.0',
    name: 'v0.3.0',
    draft: false,
    prerelease: false,
    published_at: '2026-08-17T00:00:00Z',
    body: 'notes',
    html_url: 'https://github.com/cyrus/personal/releases/tag/v0.3.0',
    assets: [{ name: 'DeepSeek-Harness-Personal-0.3.0-setup-x64.exe', digest: 'sha256:' + 'b'.repeat(64), size: 1 }],
  }
  const calls = []
  const realFetch = globalThis.fetch
  globalThis.fetch = async (url) => {
    const target = String(url)
    calls.push(target)
    if (target.includes('/releases?per_page=')) return jsonResponse([releaseObject], target)
    throw new Error('unexpected fetch: ' + target)
  }
  t.after(async () => {
    globalThis.fetch = realFetch
    await service.dispose().catch(() => {})
    await rm(root, { recursive: true, force: true })
  })
  await service.ensureLoaded()
  await service.checkDesktop()
  const state = await service.getState()
  assert.equal(state.desktop.status, 'available')
  assert.equal(calls.filter(target => target.endsWith('/releases/latest')).length, 0)
})

test('pluginChannel reads a local fixture plugin-index and reports available updates', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-personal-update-plugin-'))
  const indexPath = join(root, 'plugin-index.json')
  await writeFile(indexPath, JSON.stringify({
    schemaVersion: 1,
    generatedAt: '2026-08-21T00:00:00.000Z',
    releaseTag: 'plugins-v2026.08.21.1',
    minClient: '0.4.2',
    compatibleHarness: { version: '0.1.1-rc.2', commit: 'b150a551b8d465e31e418e1b2eaf5e79bbb7d28e' },
    plugins: [{
      packageName: '@cyrus/dsh-anysearch',
      version: '9.9.9',
      assetName: 'cyrus-dsh-anysearch-9.9.9.tgz',
      assetSize: 1,
      sha256: 'a'.repeat(64),
      minClient: '0.4.2',
      compatibleHarness: { versionRange: '0.1.1-rc.2', commits: ['b150a551b8d465e31e418e1b2eaf5e79bbb7d28e'] },
      seams: ['web.searchProvider'],
      requires: [],
      externalEligible: true,
    }],
  }, null, 2))
  const previous = process.env.DSH_PERSONAL_PLUGIN_INDEX
  process.env.DSH_PERSONAL_PLUGIN_INDEX = indexPath
  const service = new UpdateService({
    app: { getVersion: () => '0.4.2', isPackaged: false },
    shell: {},
    userDataPath: root,
    projectRoot: root,
    getCurrentSourceRoot: () => root,
    preflightHarness: async () => {},
    onInstallDesktop: async () => {},
    onRelaunch: async () => {},
  })
  t.after(async () => {
    if (previous === undefined) delete process.env.DSH_PERSONAL_PLUGIN_INDEX
    else process.env.DSH_PERSONAL_PLUGIN_INDEX = previous
    await service.dispose().catch(() => {})
    await rm(root, { recursive: true, force: true })
  })
  await service.ensureLoaded()
  service.harness.currentCommit = 'b150a551b8d465e31e418e1b2eaf5e79bbb7d28e'
  await service.checkPlugins()
  const state = await service.getState()
  assert.equal(state.pluginChannel.status, 'available')
  assert.equal(state.pluginChannel.available.length, 1)
  assert.equal(state.pluginChannel.available[0].packageName, '@cyrus/dsh-anysearch')
})

test('preparePluginGeneration writes pending generation from a local fixture', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-personal-update-plugin-prep-'))
  const sourceDir = join(root, 'src')
  await mkdir(join(sourceDir, 'package', 'lib'), { recursive: true })
  await writeFile(join(sourceDir, 'package', 'package.json'), JSON.stringify({ name: '@cyrus/dsh-anysearch', version: '9.9.9', dshComposable: { schemaVersion: 2 } }))
  await writeFile(join(sourceDir, 'package', 'lib', 'index.js'), 'export const ok = true\n')
  const tgz = join(root, 'cyrus-dsh-anysearch-9.9.9.tgz')
  await tar.c({ gzip: true, cwd: sourceDir, file: tgz }, ['package/package.json', 'package/lib/index.js'])
  const tgzData = await readFile(tgz)
  const sha = createHash('sha256').update(tgzData).digest('hex')
  const indexPath = join(root, 'plugin-index.json')
  await writeFile(indexPath, JSON.stringify({
    schemaVersion: 1,
    generatedAt: '2026-08-21T00:00:00.000Z',
    releaseTag: 'plugins-v2026.08.21.1',
    minClient: '0.4.2',
    compatibleHarness: { version: '0.1.1-rc.2', commit: 'b150a551b8d465e31e418e1b2eaf5e79bbb7d28e' },
    plugins: [{
      packageName: '@cyrus/dsh-anysearch',
      version: '9.9.9',
      assetName: 'cyrus-dsh-anysearch-9.9.9.tgz',
      assetSize: tgzData.length,
      sha256: sha,
      minClient: '0.4.2',
      compatibleHarness: { versionRange: '0.1.1-rc.2', commits: ['b150a551b8d465e31e418e1b2eaf5e79bbb7d28e'] },
      seams: ['web.searchProvider'],
      requires: [],
      externalEligible: true,
    }],
  }, null, 2))
  const previous = process.env.DSH_PERSONAL_PLUGIN_INDEX
  process.env.DSH_PERSONAL_PLUGIN_INDEX = indexPath
  const service = new UpdateService({
    app: { getVersion: () => '0.4.2', isPackaged: false },
    shell: {},
    userDataPath: root,
    projectRoot: root,
    getCurrentSourceRoot: () => root,
    preflightHarness: async () => {},
    onInstallDesktop: async () => {},
    onRelaunch: async () => {},
  })
  t.after(async () => {
    if (previous === undefined) delete process.env.DSH_PERSONAL_PLUGIN_INDEX
    else process.env.DSH_PERSONAL_PLUGIN_INDEX = previous
    await service.dispose().catch(() => {})
    await rm(root, { recursive: true, force: true })
  })
  await service.ensureLoaded()
  service.harness.currentCommit = 'b150a551b8d465e31e418e1b2eaf5e79bbb7d28e'
  await service.checkPlugins()
  await service.preparePluginGeneration()
  const externalRoot = join(root, 'plugins-external')
  const pending = JSON.parse(await readFile(join(externalRoot, 'pending.json'), 'utf8'))
  assert.ok(pending.generationId.startsWith('pending-'))
  const batch = JSON.parse(await readFile(join(externalRoot, 'generations', pending.generationId, 'batch.json'), 'utf8'))
  assert.equal(batch.packages['@cyrus/dsh-anysearch'].source, 'external')
  const installPath = join(externalRoot, 'generations', pending.generationId, 'packages', 'anysearch', '9.9.9', '.install.json')
  const install = JSON.parse(await readFile(installPath, 'utf8'))
  assert.equal(install.packageName, '@cyrus/dsh-anysearch')
  assert.ok(install.files['lib/index.js'])
})

test('rollbackPluginGeneration restores previous generation or builtin baseline', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-personal-update-plugin-rollback-'))
  const externalRoot = join(root, 'plugins-external')
  await mkdir(externalRoot, { recursive: true })
  await writeFile(join(externalRoot, 'current.json'), JSON.stringify({ generationId: 'current-gen', committedAt: '2026-08-21T00:00:00.000Z' }))
  await writeFile(join(externalRoot, 'previous.json'), JSON.stringify({ generationId: 'prev-gen', committedAt: '2026-08-20T00:00:00.000Z' }))
  const service = new UpdateService({
    app: { getVersion: () => '0.4.2', isPackaged: false },
    shell: {},
    userDataPath: root,
    projectRoot: root,
    getCurrentSourceRoot: () => root,
    preflightHarness: async () => {},
    onInstallDesktop: async () => {},
    onRelaunch: async () => {},
  })
  t.after(async () => {
    await service.dispose().catch(() => {})
    await rm(root, { recursive: true, force: true })
  })
  await service.ensureLoaded()
  await service.rollbackPluginGeneration()
  const current = JSON.parse(await readFile(join(externalRoot, 'current.json'), 'utf8'))
  assert.equal(current.generationId, 'prev-gen')
  await assert.rejects(readFile(join(externalRoot, 'previous.json')))
})

test('preparePluginGeneration rejects a tampered local fixture tgz', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-personal-update-plugin-badhash-'))
  const sourceDir = join(root, 'src')
  await mkdir(join(sourceDir, 'package', 'lib'), { recursive: true })
  await writeFile(join(sourceDir, 'package', 'package.json'), JSON.stringify({ name: '@cyrus/dsh-anysearch', version: '9.9.9', dshComposable: { schemaVersion: 2 } }))
  await writeFile(join(sourceDir, 'package', 'lib', 'index.js'), 'export const ok = true\n')
  const tgz = join(root, 'cyrus-dsh-anysearch-9.9.9.tgz')
  await tar.c({ gzip: true, cwd: sourceDir, file: tgz }, ['package/package.json', 'package/lib/index.js'])
  const tgzData = await readFile(tgz)
  const indexPath = join(root, 'plugin-index.json')
  await writeFile(indexPath, JSON.stringify({
    schemaVersion: 1,
    generatedAt: '2026-08-21T00:00:00.000Z',
    releaseTag: 'plugins-v2026.08.21.1',
    minClient: '0.4.2',
    compatibleHarness: { version: '0.1.1-rc.2', commit: 'b150a551b8d465e31e418e1b2eaf5e79bbb7d28e' },
    plugins: [{
      packageName: '@cyrus/dsh-anysearch',
      version: '9.9.9',
      assetName: 'cyrus-dsh-anysearch-9.9.9.tgz',
      assetSize: tgzData.length,
      sha256: 'f'.repeat(64),
      minClient: '0.4.2',
      compatibleHarness: { versionRange: '0.1.1-rc.2', commits: ['b150a551b8d465e31e418e1b2eaf5e79bbb7d28e'] },
      seams: ['web.searchProvider'],
      requires: [],
      externalEligible: true,
    }],
  }, null, 2))
  const previous = process.env.DSH_PERSONAL_PLUGIN_INDEX
  process.env.DSH_PERSONAL_PLUGIN_INDEX = indexPath
  const service = new UpdateService({
    app: { getVersion: () => '0.4.2', isPackaged: false },
    shell: {},
    userDataPath: root,
    projectRoot: root,
    getCurrentSourceRoot: () => root,
    preflightHarness: async () => {},
    onInstallDesktop: async () => {},
    onRelaunch: async () => {},
  })
  t.after(async () => {
    if (previous === undefined) delete process.env.DSH_PERSONAL_PLUGIN_INDEX
    else process.env.DSH_PERSONAL_PLUGIN_INDEX = previous
    await service.dispose().catch(() => {})
    await rm(root, { recursive: true, force: true })
  })
  await service.ensureLoaded()
  service.harness.currentCommit = 'b150a551b8d465e31e418e1b2eaf5e79bbb7d28e'
  await service.checkPlugins()
  await assert.rejects(() => service.preparePluginGeneration(), /SHA-256 与索引不一致/u)
})

test('pluginChannel blocks updates whose minClient is newer than the app', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-personal-update-plugin-blocked-'))
  const indexPath = join(root, 'plugin-index.json')
  await writeFile(indexPath, JSON.stringify({
    schemaVersion: 1,
    generatedAt: '2026-08-21T00:00:00.000Z',
    releaseTag: 'plugins-v2026.08.21.1',
    minClient: '0.4.2',
    compatibleHarness: { version: '0.1.1-rc.2', commit: 'b150a551b8d465e31e418e1b2eaf5e79bbb7d28e' },
    plugins: [{
      packageName: '@cyrus/dsh-anysearch',
      version: '9.9.9',
      assetName: 'cyrus-dsh-anysearch-9.9.9.tgz',
      assetSize: 1,
      sha256: 'a'.repeat(64),
      minClient: '99.0.0',
      compatibleHarness: { versionRange: '0.1.1-rc.2', commits: ['b150a551b8d465e31e418e1b2eaf5e79bbb7d28e'] },
      seams: ['web.searchProvider'],
      requires: [],
      externalEligible: true,
    }],
  }, null, 2))
  const previous = process.env.DSH_PERSONAL_PLUGIN_INDEX
  process.env.DSH_PERSONAL_PLUGIN_INDEX = indexPath
  const service = new UpdateService({
    app: { getVersion: () => '0.4.2', isPackaged: false },
    shell: {},
    userDataPath: root,
    projectRoot: root,
    getCurrentSourceRoot: () => root,
    preflightHarness: async () => {},
    onInstallDesktop: async () => {},
    onRelaunch: async () => {},
  })
  t.after(async () => {
    if (previous === undefined) delete process.env.DSH_PERSONAL_PLUGIN_INDEX
    else process.env.DSH_PERSONAL_PLUGIN_INDEX = previous
    await service.dispose().catch(() => {})
    await rm(root, { recursive: true, force: true })
  })
  await service.ensureLoaded()
  service.harness.currentCommit = 'b150a551b8d465e31e418e1b2eaf5e79bbb7d28e'
  await service.checkPlugins()
  const state = await service.getState()
  assert.equal(state.pluginChannel.status, 'blocked')
  assert.equal(state.pluginChannel.available.length, 0)
  assert.equal(state.pluginChannel.blocked.length, 1)
  assert.match(state.pluginChannel.blocked[0].blockedReason ?? '', /需要更高客户端版本/u)
})

test('pluginChannel without local fixture source is unsupported', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-personal-update-plugin-nosource-'))
  const previous = process.env.DSH_PERSONAL_PLUGIN_INDEX
  delete process.env.DSH_PERSONAL_PLUGIN_INDEX
  const service = new UpdateService({
    app: { getVersion: () => '0.4.2', isPackaged: false },
    shell: {},
    userDataPath: root,
    projectRoot: root,
    getCurrentSourceRoot: () => root,
    preflightHarness: async () => {},
    onInstallDesktop: async () => {},
    onRelaunch: async () => {},
  })
  t.after(async () => {
    if (previous !== undefined) process.env.DSH_PERSONAL_PLUGIN_INDEX = previous
    await service.dispose().catch(() => {})
    await rm(root, { recursive: true, force: true })
  })
  await service.ensureLoaded()
  await service.checkPlugins()
  const state = await service.getState()
  assert.equal(state.pluginChannel.status, 'unsupported')
})

test('rollbackDesktop reinstalls the previous known-good client package', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-personal-update-rollback-desktop-'))
  const downloadDir = join(root, 'updates', 'downloads')
  await mkdir(downloadDir, { recursive: true })
  const previousPath = join(downloadDir, 'previous-setup.exe')
  await writeFile(previousPath, 'previous-installer')
  const previousSha = createHash('sha256').update(await readFile(previousPath)).digest('hex')
  await writeFile(join(root, 'update-center.json'), `${JSON.stringify({
    schemaVersion: 1,
    settings: {
      desktopRepository: 'cyrus/personal',
      harnessRepository: 'deepseek-ai/deepseek-harness',
      channel: 'stable',
      autoCheck: true,
    },
    previousDesktop: {
      path: previousPath,
      sha256: previousSha,
      version: '0.3.0',
      assetName: 'previous-setup.exe',
      repository: 'cyrus/personal',
      channel: 'stable',
    },
  })}\n`)
  let installedPath
  let currentVersion = '0.4.2'
  const service = new UpdateService({
    app: { getVersion: () => currentVersion, isPackaged: true },
    shell: {},
    userDataPath: root,
    projectRoot: root,
    getCurrentSourceRoot: () => root,
    preflightHarness: async () => {},
    onInstallDesktop: async path => { installedPath = path },
    onRelaunch: async () => {},
  })
  t.after(async () => {
    await service.dispose().catch(() => {})
    await rm(root, { recursive: true, force: true })
  })
  await service.ensureLoaded()
  await service.rollbackDesktop()
  assert.equal(installedPath, previousPath)
  let persisted = JSON.parse(await readFile(join(root, 'update-center.json'), 'utf8'))
  assert.equal(persisted.previousDesktop.version, '0.3.0')
  assert.equal(persisted.rollbackPending.version, '0.3.0')
  currentVersion = '0.3.0'
  await service.confirmDesktopLifecycle()
  persisted = JSON.parse(await readFile(join(root, 'update-center.json'), 'utf8'))
  assert.equal(persisted.previousDesktop, undefined)
  assert.equal(persisted.rollbackPending, undefined)
})

test('installDesktop records installPending and confirmDesktopLifecycle clears it only after matching boot', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-personal-update-install-pending-'))
  const downloadDir = join(root, 'updates', 'downloads')
  await mkdir(downloadDir, { recursive: true })
  const candidatePath = join(downloadDir, 'candidate-setup.exe')
  await writeFile(candidatePath, 'candidate-installer')
  const candidateSha = createHash('sha256').update(await readFile(candidatePath)).digest('hex')
  await writeFile(join(root, 'update-center.json'), `${JSON.stringify({
    schemaVersion: 1,
    settings: {
      desktopRepository: 'cyrus/personal',
      harnessRepository: 'deepseek-ai/deepseek-harness',
      channel: 'stable',
      autoCheck: true,
    },
    downloadedDesktop: {
      path: candidatePath,
      sha256: candidateSha,
      version: '0.5.0',
      assetName: 'candidate-setup.exe',
      repository: 'cyrus/personal',
      channel: 'stable',
    },
  })}\n`)
  let installedPath
  let currentVersion = '0.4.2'
  const service = new UpdateService({
    app: { getVersion: () => currentVersion, isPackaged: true },
    shell: {},
    userDataPath: root,
    projectRoot: root,
    getCurrentSourceRoot: () => root,
    preflightHarness: async () => {},
    onInstallDesktop: async path => { installedPath = path },
    onRelaunch: async () => {},
  })
  t.after(async () => {
    await service.dispose().catch(() => {})
    await rm(root, { recursive: true, force: true })
  })
  await service.ensureLoaded()
  await service.installDesktop()
  assert.equal(installedPath, candidatePath)
  let persisted = JSON.parse(await readFile(join(root, 'update-center.json'), 'utf8'))
  assert.equal(persisted.installPending.version, '0.5.0')
  currentVersion = '0.5.0'
  await service.confirmDesktopLifecycle()
  persisted = JSON.parse(await readFile(join(root, 'update-center.json'), 'utf8'))
  assert.equal(persisted.installPending, undefined)
  assert.equal(persisted.downloadedDesktop, undefined)
})

test('confirmDesktopLifecycle keeps rollbackPending until the old version actually boots', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-personal-update-rollback-unconfirmed-'))
  const downloadDir = join(root, 'updates', 'downloads')
  await mkdir(downloadDir, { recursive: true })
  const previousPath = join(downloadDir, 'previous-setup.exe')
  await writeFile(previousPath, 'previous-installer')
  const previousSha = createHash('sha256').update(await readFile(previousPath)).digest('hex')
  await writeFile(join(root, 'update-center.json'), `${JSON.stringify({
    schemaVersion: 1,
    settings: {
      desktopRepository: 'cyrus/personal',
      harnessRepository: 'deepseek-ai/deepseek-harness',
      channel: 'stable',
      autoCheck: true,
    },
    previousDesktop: {
      path: previousPath,
      sha256: previousSha,
      version: '0.3.0',
      assetName: 'previous-setup.exe',
      repository: 'cyrus/personal',
      channel: 'stable',
    },
  })}\n`)
  let currentVersion = '0.4.2'
  const service = new UpdateService({
    app: { getVersion: () => currentVersion, isPackaged: true },
    shell: {},
    userDataPath: root,
    projectRoot: root,
    getCurrentSourceRoot: () => root,
    preflightHarness: async () => {},
    onInstallDesktop: async () => {},
    onRelaunch: async () => {},
  })
  t.after(async () => {
    await service.dispose().catch(() => {})
    await rm(root, { recursive: true, force: true })
  })
  await service.ensureLoaded()
  await service.rollbackDesktop()
  await service.confirmDesktopLifecycle()
  let persisted = JSON.parse(await readFile(join(root, 'update-center.json'), 'utf8'))
  assert.equal(persisted.previousDesktop.version, '0.3.0')
  assert.equal(persisted.rollbackPending.version, '0.3.0')
  currentVersion = '0.3.0'
  await service.confirmDesktopLifecycle()
  persisted = JSON.parse(await readFile(join(root, 'update-center.json'), 'utf8'))
  assert.equal(persisted.previousDesktop, undefined)
  assert.equal(persisted.rollbackPending, undefined)
})

test('pluginChannel rejects an unknown plugin-index schemaVersion', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-personal-update-plugin-badschema-'))
  const indexPath = join(root, 'plugin-index.json')
  await writeFile(indexPath, JSON.stringify({ schemaVersion: 2, plugins: [] }))
  const previous = process.env.DSH_PERSONAL_PLUGIN_INDEX
  process.env.DSH_PERSONAL_PLUGIN_INDEX = indexPath
  const service = new UpdateService({
    app: { getVersion: () => '0.4.2', isPackaged: false },
    shell: {},
    userDataPath: root,
    projectRoot: root,
    getCurrentSourceRoot: () => root,
    preflightHarness: async () => {},
    onInstallDesktop: async () => {},
    onRelaunch: async () => {},
  })
  t.after(async () => {
    if (previous === undefined) delete process.env.DSH_PERSONAL_PLUGIN_INDEX
    else process.env.DSH_PERSONAL_PLUGIN_INDEX = previous
    await service.dispose().catch(() => {})
    await rm(root, { recursive: true, force: true })
  })
  await service.ensureLoaded()
  await assert.rejects(() => service.checkPlugins(), /plugin-index 校验失败/u)
})

test('preparePluginGeneration rejects a missing local fixture asset', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-personal-update-plugin-missingasset-'))
  const indexPath = join(root, 'plugin-index.json')
  await writeFile(indexPath, JSON.stringify({
    schemaVersion: 1,
    generatedAt: '2026-08-21T00:00:00.000Z',
    releaseTag: 'plugins-v2026.08.21.1',
    minClient: '0.4.2',
    compatibleHarness: { version: '0.1.1-rc.2', commit: 'b150a551b8d465e31e418e1b2eaf5e79bbb7d28e' },
    plugins: [{
      packageName: '@cyrus/dsh-anysearch',
      version: '9.9.9',
      assetName: 'missing.tgz',
      assetSize: 1,
      sha256: 'a'.repeat(64),
      minClient: '0.4.2',
      compatibleHarness: { versionRange: '0.1.1-rc.2', commits: ['b150a551b8d465e31e418e1b2eaf5e79bbb7d28e'] },
      seams: ['web.searchProvider'],
      requires: [],
      externalEligible: true,
    }],
  }, null, 2))
  const previous = process.env.DSH_PERSONAL_PLUGIN_INDEX
  process.env.DSH_PERSONAL_PLUGIN_INDEX = indexPath
  const service = new UpdateService({
    app: { getVersion: () => '0.4.2', isPackaged: false },
    shell: {},
    userDataPath: root,
    projectRoot: root,
    getCurrentSourceRoot: () => root,
    preflightHarness: async () => {},
    onInstallDesktop: async () => {},
    onRelaunch: async () => {},
  })
  t.after(async () => {
    if (previous === undefined) delete process.env.DSH_PERSONAL_PLUGIN_INDEX
    else process.env.DSH_PERSONAL_PLUGIN_INDEX = previous
    await service.dispose().catch(() => {})
    await rm(root, { recursive: true, force: true })
  })
  await service.ensureLoaded()
  service.harness.currentCommit = 'b150a551b8d465e31e418e1b2eaf5e79bbb7d28e'
  await service.checkPlugins()
  await assert.rejects(() => service.preparePluginGeneration(), /ENOENT|missing\.tgz/u)
})

test('pluginChannel reads a production plugins-v release index', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-personal-update-plugin-prod-'))
  await writeFile(join(root, 'update-center.json'), `${JSON.stringify({
    schemaVersion: 1,
    settings: {
      desktopRepository: '',
      harnessRepository: 'deepseek-ai/deepseek-harness',
      pluginRepository: 'cyrus/plugins',
      channel: 'stable',
      autoCheck: true,
    },
  })}\n`)
  const releaseObject = {
    tag_name: 'plugins-v2026.08.21.1',
    name: 'plugins-v2026.08.21.1',
    draft: false,
    prerelease: false,
    published_at: '2026-08-21T00:00:00Z',
    assets: [{
      name: 'plugin-index.json',
      browser_download_url: 'https://github.com/cyrus/plugins/releases/download/plugins-v2026.08.21.1/plugin-index.json',
    }],
  }
  const indexBody = {
    schemaVersion: 1,
    generatedAt: '2026-08-21T00:00:00.000Z',
    releaseTag: 'plugins-v2026.08.21.1',
    minClient: '0.4.2',
    compatibleHarness: { version: '0.1.1-rc.2', commit: 'b150a551b8d465e31e418e1b2eaf5e79bbb7d28e' },
    plugins: [{
      packageName: '@cyrus/dsh-anysearch',
      version: '9.9.9',
      assetName: 'cyrus-dsh-anysearch-9.9.9.tgz',
      assetSize: 1,
      sha256: 'a'.repeat(64),
      minClient: '0.4.2',
      compatibleHarness: { versionRange: '0.1.1-rc.2', commits: ['b150a551b8d465e31e418e1b2eaf5e79bbb7d28e'] },
      seams: ['web.searchProvider'],
      requires: [],
      externalEligible: true,
    }],
  }
  const realFetch = globalThis.fetch
  globalThis.fetch = async url => {
    const target = String(url)
    if (target.includes('/releases?per_page=')) return jsonResponse([releaseObject], target)
    if (target.endsWith('/plugin-index.json')) return jsonResponse(indexBody, target)
    throw new Error('unexpected fetch: ' + target)
  }
  const service = new UpdateService({
    app: { getVersion: () => '0.4.2', isPackaged: false },
    shell: {},
    userDataPath: root,
    projectRoot: root,
    getCurrentSourceRoot: () => root,
    preflightHarness: async () => {},
    onInstallDesktop: async () => {},
    onRelaunch: async () => {},
  })
  t.after(async () => {
    globalThis.fetch = realFetch
    await service.dispose().catch(() => {})
    await rm(root, { recursive: true, force: true })
  })
  await service.ensureLoaded()
  service.harness.currentCommit = 'b150a551b8d465e31e418e1b2eaf5e79bbb7d28e'
  await service.checkPlugins()
  const state = await service.getState()
  assert.equal(state.pluginChannel.status, 'available')
  assert.equal(state.pluginChannel.available.length, 1)
})

test('downloadDesktop fails closed when release lacks client-release-manifest.json', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-personal-update-no-manifest-'))
  await writeFile(join(root, 'update-center.json'), `${JSON.stringify({
    schemaVersion: 1,
    settings: {
      desktopRepository: 'cyrus/personal',
      harnessRepository: 'deepseek-ai/deepseek-harness',
      channel: 'stable',
      autoCheck: true,
    },
  })}\n`)
  const releaseObject = {
    tag_name: 'v0.3.0',
    name: 'v0.3.0',
    draft: false,
    prerelease: false,
    published_at: '2026-08-17T00:00:00Z',
    body: 'notes',
    html_url: 'https://github.com/cyrus/personal/releases/tag/v0.3.0',
    assets: [{ name: 'DeepSeek-Harness-Personal-0.3.0-setup-x64.exe', digest: 'sha256:' + 'a'.repeat(64), size: 1 }],
  }
  const realFetch = globalThis.fetch
  globalThis.fetch = async url => {
    const target = String(url)
    if (target.includes('/releases?per_page=')) return jsonResponse([releaseObject], target)
    if (target.endsWith('/releases/latest')) return jsonResponse(releaseObject, target)
    throw new Error('unexpected fetch: ' + target)
  }
  const service = new UpdateService({
    app: { getVersion: () => '0.1.0', isPackaged: true },
    shell: {},
    userDataPath: root,
    projectRoot: root,
    getCurrentSourceRoot: () => root,
    preflightHarness: async () => {},
    onInstallDesktop: async () => {},
    onRelaunch: async () => {},
  })
  t.after(async () => {
    globalThis.fetch = realFetch
    await service.dispose().catch(() => {})
    await rm(root, { recursive: true, force: true })
  })
  await service.ensureLoaded()
  await service.checkDesktop()
  await assert.rejects(() => service.downloadDesktop(), /client-release-manifest\.json/u)
})

test('pluginChannel production source fails closed on network error', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-personal-update-plugin-net404-'))
  await writeFile(join(root, 'update-center.json'), `${JSON.stringify({
    schemaVersion: 1,
    settings: {
      desktopRepository: '',
      harnessRepository: 'deepseek-ai/deepseek-harness',
      pluginRepository: 'cyrus/plugins',
      channel: 'stable',
      autoCheck: true,
    },
  })}\n`)
  const realFetch = globalThis.fetch
  globalThis.fetch = async () => { throw new Error('network down') }
  const service = new UpdateService({
    app: { getVersion: () => '0.4.2', isPackaged: false },
    shell: {},
    userDataPath: root,
    projectRoot: root,
    getCurrentSourceRoot: () => root,
    preflightHarness: async () => {},
    onInstallDesktop: async () => {},
    onRelaunch: async () => {},
  })
  t.after(async () => {
    globalThis.fetch = realFetch
    await service.dispose().catch(() => {})
    await rm(root, { recursive: true, force: true })
  })
  await service.ensureLoaded()
  await assert.rejects(() => service.checkPlugins(), /network down/u)
})

test('preparePluginGeneration fails closed when plugins-external cannot be created', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-personal-update-plugin-disk-'))
  const indexPath = join(root, 'plugin-index.json')
  await writeFile(indexPath, JSON.stringify({
    schemaVersion: 1,
    generatedAt: '2026-08-21T00:00:00.000Z',
    releaseTag: 'plugins-v2026.08.21.1',
    minClient: '0.4.2',
    compatibleHarness: { version: '0.1.1-rc.2', commit: 'b150a551b8d465e31e418e1b2eaf5e79bbb7d28e' },
    plugins: [{
      packageName: '@cyrus/dsh-anysearch',
      version: '9.9.9',
      assetName: 'missing.tgz',
      assetSize: 1,
      sha256: 'a'.repeat(64),
      minClient: '0.4.2',
      compatibleHarness: { versionRange: '0.1.1-rc.2', commits: ['b150a551b8d465e31e418e1b2eaf5e79bbb7d28e'] },
      seams: ['web.searchProvider'],
      requires: [],
      externalEligible: true,
    }],
  }, null, 2))
  await writeFile(join(root, 'plugins-external'), 'not a directory')
  const previous = process.env.DSH_PERSONAL_PLUGIN_INDEX
  process.env.DSH_PERSONAL_PLUGIN_INDEX = indexPath
  const service = new UpdateService({
    app: { getVersion: () => '0.4.2', isPackaged: false },
    shell: {},
    userDataPath: root,
    projectRoot: root,
    getCurrentSourceRoot: () => root,
    preflightHarness: async () => {},
    onInstallDesktop: async () => {},
    onRelaunch: async () => {},
  })
  t.after(async () => {
    if (previous === undefined) delete process.env.DSH_PERSONAL_PLUGIN_INDEX
    else process.env.DSH_PERSONAL_PLUGIN_INDEX = previous
    await service.dispose().catch(() => {})
    await rm(root, { recursive: true, force: true })
  })
  await service.ensureLoaded()
  service.harness.currentCommit = 'b150a551b8d465e31e418e1b2eaf5e79bbb7d28e'
  await service.checkPlugins()
  await assert.rejects(() => service.preparePluginGeneration(), /EEXIST|ENOTDIR|plugins-external/u)
})

test('plugin purge preview and confirmed purge remove only automation state', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-personal-update-plugin-purge-'))
  const externalRoot = join(root, 'plugins-external')
  await mkdir(join(externalRoot, 'generations', 'gen1'), { recursive: true })
  await mkdir(join(externalRoot, 'quarantine', 'bad'), { recursive: true })
  await writeFile(join(externalRoot, 'current.json'), JSON.stringify({ generationId: 'gen1' }))
  const service = new UpdateService({
    app: { getVersion: () => '0.4.2', isPackaged: false },
    shell: {},
    userDataPath: root,
    projectRoot: root,
    getCurrentSourceRoot: () => root,
    preflightHarness: async () => {},
    onInstallDesktop: async () => {},
    onRelaunch: async () => {},
  })
  t.after(async () => {
    await service.dispose().catch(() => {})
    await rm(root, { recursive: true, force: true })
  })
  await service.ensureLoaded()
  const preview = await service.previewPluginPurge()
  assert.equal(preview.externalGenerations, 1)
  assert.equal(preview.quarantineItems, 1)
  assert.equal(preview.wouldRemoveBusinessData, false)
  await service.purgePluginGeneration(preview.token)
  await assert.rejects(readFile(join(externalRoot, 'current.json')))
  await assert.rejects(readFile(join(externalRoot, 'generations', 'gen1', 'x')))
})

test('pluginChannel blocks updates with missing required plugin dependencies', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-personal-update-plugin-missingdep-'))
  const indexPath = join(root, 'plugin-index.json')
  await writeFile(indexPath, JSON.stringify({
    schemaVersion: 1,
    generatedAt: '2026-08-21T00:00:00.000Z',
    releaseTag: 'plugins-v2026.08.21.1',
    minClient: '0.4.2',
    compatibleHarness: { version: '0.1.1-rc.2', commit: 'b150a551b8d465e31e418e1b2eaf5e79bbb7d28e' },
    plugins: [{
      packageName: '@cyrus/dsh-anysearch',
      version: '9.9.9',
      assetName: 'cyrus-dsh-anysearch-9.9.9.tgz',
      assetSize: 1,
      sha256: 'a'.repeat(64),
      minClient: '0.4.2',
      compatibleHarness: { versionRange: '0.1.1-rc.2', commits: ['b150a551b8d465e31e418e1b2eaf5e79bbb7d28e'] },
      seams: ['web.searchProvider'],
      requires: ['@cyrus/dsh-missing'],
      externalEligible: true,
    }],
  }, null, 2))
  const previous = process.env.DSH_PERSONAL_PLUGIN_INDEX
  process.env.DSH_PERSONAL_PLUGIN_INDEX = indexPath
  const service = new UpdateService({
    app: { getVersion: () => '0.4.2', isPackaged: false },
    shell: {},
    userDataPath: root,
    projectRoot: root,
    getCurrentSourceRoot: () => root,
    preflightHarness: async () => {},
    onInstallDesktop: async () => {},
    onRelaunch: async () => {},
  })
  t.after(async () => {
    if (previous === undefined) delete process.env.DSH_PERSONAL_PLUGIN_INDEX
    else process.env.DSH_PERSONAL_PLUGIN_INDEX = previous
    await service.dispose().catch(() => {})
    await rm(root, { recursive: true, force: true })
  })
  await service.ensureLoaded()
  service.harness.currentCommit = 'b150a551b8d465e31e418e1b2eaf5e79bbb7d28e'
  await service.checkPlugins()
  const state = await service.getState()
  assert.equal(state.pluginChannel.status, 'blocked')
  assert.match(state.pluginChannel.blocked[0].blockedReason ?? '', /缺少依赖插件/u)
})

test('removePluginGeneration clears external generation state without purge', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-personal-update-plugin-remove-'))
  const externalRoot = join(root, 'plugins-external')
  await mkdir(join(externalRoot, 'generations', 'gen1'), { recursive: true })
  await writeFile(join(externalRoot, 'current.json'), JSON.stringify({ generationId: 'gen1' }))
  const service = new UpdateService({
    app: { getVersion: () => '0.4.2', isPackaged: false },
    shell: {},
    userDataPath: root,
    projectRoot: root,
    getCurrentSourceRoot: () => root,
    preflightHarness: async () => {},
    onInstallDesktop: async () => {},
    onRelaunch: async () => {},
  })
  t.after(async () => {
    await service.dispose().catch(() => {})
    await rm(root, { recursive: true, force: true })
  })
  await service.ensureLoaded()
  await service.removePluginGeneration()
  await assert.rejects(readFile(join(externalRoot, 'current.json')))
  const state = await service.getState()
  assert.equal(state.pluginChannel.status, 'idle')
})

test('preparePluginGeneration rejects a corrupt tgz asset', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-personal-update-plugin-corrupttgz-'))
  await writeFile(join(root, 'bad.tgz'), 'this is not a gzip tar')
  const badData = 'this is not a gzip tar'
  const indexPath = join(root, 'plugin-index.json')
  await writeFile(indexPath, JSON.stringify({
    schemaVersion: 1,
    generatedAt: '2026-08-21T00:00:00.000Z',
    releaseTag: 'plugins-v2026.08.21.1',
    minClient: '0.4.2',
    compatibleHarness: { version: '0.1.1-rc.2', commit: 'b150a551b8d465e31e418e1b2eaf5e79bbb7d28e' },
    plugins: [{
      packageName: '@cyrus/dsh-anysearch',
      version: '9.9.9',
      assetName: 'bad.tgz',
      assetSize: Buffer.byteLength(badData),
      sha256: createHash('sha256').update(badData).digest('hex'),
      minClient: '0.4.2',
      compatibleHarness: { versionRange: '0.1.1-rc.2', commits: ['b150a551b8d465e31e418e1b2eaf5e79bbb7d28e'] },
      seams: ['web.searchProvider'],
      requires: [],
      externalEligible: true,
    }],
  }, null, 2))
  const previous = process.env.DSH_PERSONAL_PLUGIN_INDEX
  process.env.DSH_PERSONAL_PLUGIN_INDEX = indexPath
  const service = new UpdateService({
    app: { getVersion: () => '0.4.2', isPackaged: false },
    shell: {},
    userDataPath: root,
    projectRoot: root,
    getCurrentSourceRoot: () => root,
    preflightHarness: async () => {},
    onInstallDesktop: async () => {},
    onRelaunch: async () => {},
  })
  t.after(async () => {
    if (previous === undefined) delete process.env.DSH_PERSONAL_PLUGIN_INDEX
    else process.env.DSH_PERSONAL_PLUGIN_INDEX = previous
    await service.dispose().catch(() => {})
    await rm(root, { recursive: true, force: true })
  })
  await service.ensureLoaded()
  service.harness.currentCommit = 'b150a551b8d465e31e418e1b2eaf5e79bbb7d28e'
  await service.checkPlugins()
  await assert.rejects(() => service.preparePluginGeneration(), /gzip|tar|ENOENT|bad\.tgz|TAR_BAD_ARCHIVE/u)
})

test('downloadDesktop fails closed when installer download aborts', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-personal-update-download-abort-'))
  await writeFile(join(root, 'update-center.json'), `${JSON.stringify({
    schemaVersion: 1,
    settings: {
      desktopRepository: 'cyrus/personal',
      harnessRepository: 'deepseek-ai/deepseek-harness',
      channel: 'stable',
      autoCheck: true,
    },
  })}\n`)
  const installerName = 'DeepSeek-Harness-Personal-0.3.0-setup-x64.exe'
  const installerDigest = 'a'.repeat(64)
  const releaseObject = {
    tag_name: 'v0.3.0',
    name: 'v0.3.0',
    draft: false,
    prerelease: false,
    published_at: '2026-08-17T00:00:00Z',
    body: 'notes',
    html_url: 'https://github.com/cyrus/personal/releases/tag/v0.3.0',
    assets: [
      { name: installerName, digest: `sha256:${installerDigest}`, size: 1, browser_download_url: 'https://github.com/cyrus/personal/releases/download/v0.3.0/setup.exe' },
      { name: 'client-release-manifest.json', browser_download_url: 'https://github.com/cyrus/personal/releases/download/v0.3.0/client-release-manifest.json' },
    ],
  }
  const manifestBody = {
    schemaVersion: 1,
    clientVersion: '0.3.0',
    supportedHarnessCommits: ['b150a551b8d465e31e418e1b2eaf5e79bbb7d28e'],
    builtinGenerationHash: 'b'.repeat(64),
    pluginContractVersion: '2',
    seamCapabilities: {},
    installerSha256: installerDigest,
  }
  const realFetch = globalThis.fetch
  globalThis.fetch = async url => {
    const target = String(url)
    if (target.includes('/releases?per_page=')) return jsonResponse([releaseObject], target)
    if (target.endsWith('/releases/latest')) return jsonResponse(releaseObject, target)
    if (target.endsWith('client-release-manifest.json')) return jsonResponse(manifestBody, target)
    if (target.endsWith('setup.exe')) throw new DOMException('The operation was aborted.', 'AbortError')
    throw new Error('unexpected fetch: ' + target)
  }
  const service = new UpdateService({
    app: { getVersion: () => '0.1.0', isPackaged: true },
    shell: {},
    userDataPath: root,
    projectRoot: root,
    getCurrentSourceRoot: () => root,
    preflightHarness: async () => {},
    onInstallDesktop: async () => {},
    onRelaunch: async () => {},
  })
  t.after(async () => {
    globalThis.fetch = realFetch
    await service.dispose().catch(() => {})
    await rm(root, { recursive: true, force: true })
  })
  await service.ensureLoaded()
  await service.checkDesktop()
  await assert.rejects(() => service.downloadDesktop(), /abort|AbortError|fetch failed/u)
})

test('pluginChannel blocks updates requiring unsupported model assets', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-personal-update-plugin-model-'))
  const indexPath = join(root, 'plugin-index.json')
  await writeFile(indexPath, JSON.stringify({
    schemaVersion: 1,
    generatedAt: '2026-08-21T00:00:00.000Z',
    releaseTag: 'plugins-v2026.08.21.1',
    minClient: '0.4.2',
    compatibleHarness: { version: '0.1.1-rc.2', commit: 'b150a551b8d465e31e418e1b2eaf5e79bbb7d28e' },
    plugins: [{
      packageName: '@cyrus/dsh-anysearch',
      version: '9.9.9',
      assetName: 'cyrus-dsh-anysearch-9.9.9.tgz',
      assetSize: 1,
      sha256: 'a'.repeat(64),
      minClient: '0.4.2',
      compatibleHarness: { versionRange: '0.1.1-rc.2', commits: ['b150a551b8d465e31e418e1b2eaf5e79bbb7d28e'] },
      seams: ['web.searchProvider'],
      requires: [],
      modelAssets: [{ name: 'embedding', version: '1', fetch: 'https://example.invalid/model' }],
      externalEligible: true,
    }],
  }, null, 2))
  const previous = process.env.DSH_PERSONAL_PLUGIN_INDEX
  process.env.DSH_PERSONAL_PLUGIN_INDEX = indexPath
  const service = new UpdateService({
    app: { getVersion: () => '0.4.2', isPackaged: false },
    shell: {},
    userDataPath: root,
    projectRoot: root,
    getCurrentSourceRoot: () => root,
    preflightHarness: async () => {},
    onInstallDesktop: async () => {},
    onRelaunch: async () => {},
  })
  t.after(async () => {
    if (previous === undefined) delete process.env.DSH_PERSONAL_PLUGIN_INDEX
    else process.env.DSH_PERSONAL_PLUGIN_INDEX = previous
    await service.dispose().catch(() => {})
    await rm(root, { recursive: true, force: true })
  })
  await service.ensureLoaded()
  service.harness.currentCommit = 'b150a551b8d465e31e418e1b2eaf5e79bbb7d28e'
  await service.checkPlugins()
  const state = await service.getState()
  assert.equal(state.pluginChannel.status, 'blocked')
  assert.match(state.pluginChannel.blocked[0].blockedReason ?? '', /模型资产/u)
})

test('preparePluginGeneration downloads and verifies production plugin assets', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-personal-update-plugin-prod-prep-'))
  const sourceDir = join(root, 'src')
  await mkdir(join(sourceDir, 'package', 'lib'), { recursive: true })
  await writeFile(join(sourceDir, 'package', 'package.json'), JSON.stringify({ name: '@cyrus/dsh-anysearch', version: '9.9.9', dshComposable: { schemaVersion: 2 } }))
  await writeFile(join(sourceDir, 'package', 'lib', 'index.js'), 'export const ok = true\n')
  const tgz = join(root, 'cyrus-dsh-anysearch-9.9.9.tgz')
  await tar.c({ gzip: true, cwd: sourceDir, file: tgz }, ['package/package.json', 'package/lib/index.js'])
  const tgzData = await readFile(tgz)
  const sha = createHash('sha256').update(tgzData).digest('hex')
  const releaseTag = 'plugins-v2026.08.21.1'
  const releaseObject = {
    tag_name: releaseTag,
    name: releaseTag,
    draft: false,
    prerelease: false,
    published_at: '2026-08-21T00:00:00Z',
    assets: [
      { name: 'plugin-index.json', browser_download_url: `https://github.com/cyrus/plugins/releases/download/${releaseTag}/plugin-index.json` },
      { name: 'cyrus-dsh-anysearch-9.9.9.tgz', browser_download_url: `https://github.com/cyrus/plugins/releases/download/${releaseTag}/cyrus-dsh-anysearch-9.9.9.tgz` },
    ],
  }
  const indexBody = {
    schemaVersion: 1,
    generatedAt: '2026-08-21T00:00:00.000Z',
    releaseTag,
    minClient: '0.4.2',
    compatibleHarness: { version: '0.1.1-rc.2', commit: 'b150a551b8d465e31e418e1b2eaf5e79bbb7d28e' },
    plugins: [{
      packageName: '@cyrus/dsh-anysearch',
      version: '9.9.9',
      assetName: 'cyrus-dsh-anysearch-9.9.9.tgz',
      assetSize: tgzData.length,
      sha256: sha,
      minClient: '0.4.2',
      compatibleHarness: { versionRange: '0.1.1-rc.2', commits: ['b150a551b8d465e31e418e1b2eaf5e79bbb7d28e'] },
      seams: ['web.searchProvider'],
      requires: [],
      externalEligible: true,
    }],
  }
  await writeFile(join(root, 'update-center.json'), `${JSON.stringify({
    schemaVersion: 1,
    settings: {
      desktopRepository: '',
      harnessRepository: 'deepseek-ai/deepseek-harness',
      pluginRepository: 'cyrus/plugins',
      channel: 'stable',
      autoCheck: true,
    },
  })}\n`)
  const realFetch = globalThis.fetch
  globalThis.fetch = async url => {
    const target = String(url)
    if (target.includes('/releases?per_page=')) return jsonResponse([releaseObject], target)
    if (target.endsWith('/plugin-index.json')) return jsonResponse(indexBody, target)
    if (target.endsWith('.tgz')) return binaryResponse(tgzData, target)
    throw new Error('unexpected fetch: ' + target)
  }
  const service = new UpdateService({
    app: { getVersion: () => '0.4.2', isPackaged: false },
    shell: {},
    userDataPath: root,
    projectRoot: root,
    getCurrentSourceRoot: () => root,
    preflightHarness: async () => {},
    onInstallDesktop: async () => {},
    onRelaunch: async () => {},
  })
  t.after(async () => {
    globalThis.fetch = realFetch
    await service.dispose().catch(() => {})
    await rm(root, { recursive: true, force: true })
  })
  await service.ensureLoaded()
  service.harness.currentCommit = 'b150a551b8d465e31e418e1b2eaf5e79bbb7d28e'
  await service.checkPlugins()
  await service.preparePluginGeneration()
  const pending = JSON.parse(await readFile(join(root, 'plugins-external', 'pending.json'), 'utf8'))
  const batch = JSON.parse(await readFile(join(root, 'plugins-external', 'generations', pending.generationId, 'batch.json'), 'utf8'))
  assert.equal(batch.packages['@cyrus/dsh-anysearch'].source, 'external')
})

test('preparePluginGeneration production fails closed on 404 asset', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-personal-update-plugin-prod-404-'))
  const releaseTag = 'plugins-v2026.08.21.1'
  const releaseObject = {
    tag_name: releaseTag,
    name: releaseTag,
    draft: false,
    prerelease: false,
    published_at: '2026-08-21T00:00:00Z',
    assets: [
      { name: 'plugin-index.json', browser_download_url: `https://github.com/cyrus/plugins/releases/download/${releaseTag}/plugin-index.json` },
      { name: 'cyrus-dsh-anysearch-9.9.9.tgz', browser_download_url: `https://github.com/cyrus/plugins/releases/download/${releaseTag}/cyrus-dsh-anysearch-9.9.9.tgz` },
    ],
  }
  const indexBody = {
    schemaVersion: 1,
    generatedAt: '2026-08-21T00:00:00.000Z',
    releaseTag,
    minClient: '0.4.2',
    compatibleHarness: { version: '0.1.1-rc.2', commit: 'b150a551b8d465e31e418e1b2eaf5e79bbb7d28e' },
    plugins: [{
      packageName: '@cyrus/dsh-anysearch',
      version: '9.9.9',
      assetName: 'cyrus-dsh-anysearch-9.9.9.tgz',
      assetSize: 1,
      sha256: 'a'.repeat(64),
      minClient: '0.4.2',
      compatibleHarness: { versionRange: '0.1.1-rc.2', commits: ['b150a551b8d465e31e418e1b2eaf5e79bbb7d28e'] },
      seams: ['web.searchProvider'],
      requires: [],
      externalEligible: true,
    }],
  }
  await writeFile(join(root, 'update-center.json'), `${JSON.stringify({
    schemaVersion: 1,
    settings: {
      desktopRepository: '',
      harnessRepository: 'deepseek-ai/deepseek-harness',
      pluginRepository: 'cyrus/plugins',
      channel: 'stable',
      autoCheck: true,
    },
  })}\n`)
  const realFetch = globalThis.fetch
  globalThis.fetch = async url => {
    const target = String(url)
    if (target.includes('/releases?per_page=')) return jsonResponse([releaseObject], target)
    if (target.endsWith('/plugin-index.json')) return jsonResponse(indexBody, target)
    if (target.endsWith('.tgz')) return new Response('Not Found', { status: 404, headers: { 'content-type': 'text/plain' } })
    throw new Error('unexpected fetch: ' + target)
  }
  const service = new UpdateService({
    app: { getVersion: () => '0.4.2', isPackaged: false },
    shell: {},
    userDataPath: root,
    projectRoot: root,
    getCurrentSourceRoot: () => root,
    preflightHarness: async () => {},
    onInstallDesktop: async () => {},
    onRelaunch: async () => {},
  })
  t.after(async () => {
    globalThis.fetch = realFetch
    await service.dispose().catch(() => {})
    await rm(root, { recursive: true, force: true })
  })
  await service.ensureLoaded()
  service.harness.currentCommit = 'b150a551b8d465e31e418e1b2eaf5e79bbb7d28e'
  await service.checkPlugins()
  await assert.rejects(() => service.preparePluginGeneration(), /HTTP 404/u)
})

test('preparePluginGeneration production rejects duplicate release asset names', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-personal-update-plugin-prod-dup-'))
  const releaseTag = 'plugins-v2026.08.21.1'
  const releaseObject = {
    tag_name: releaseTag,
    name: releaseTag,
    draft: false,
    prerelease: false,
    published_at: '2026-08-21T00:00:00Z',
    assets: [
      { name: 'plugin-index.json', browser_download_url: `https://github.com/cyrus/plugins/releases/download/${releaseTag}/plugin-index.json` },
      { name: 'cyrus-dsh-anysearch-9.9.9.tgz', browser_download_url: `https://github.com/cyrus/plugins/releases/download/${releaseTag}/cyrus-dsh-anysearch-9.9.9.tgz` },
      { name: 'cyrus-dsh-anysearch-9.9.9.tgz', browser_download_url: `https://github.com/cyrus/plugins/releases/download/${releaseTag}/cyrus-dsh-anysearch-9.9.9.tgz` },
    ],
  }
  const indexBody = {
    schemaVersion: 1,
    generatedAt: '2026-08-21T00:00:00.000Z',
    releaseTag,
    minClient: '0.4.2',
    compatibleHarness: { version: '0.1.1-rc.2', commit: 'b150a551b8d465e31e418e1b2eaf5e79bbb7d28e' },
    plugins: [{
      packageName: '@cyrus/dsh-anysearch',
      version: '9.9.9',
      assetName: 'cyrus-dsh-anysearch-9.9.9.tgz',
      assetSize: 1,
      sha256: 'a'.repeat(64),
      minClient: '0.4.2',
      compatibleHarness: { versionRange: '0.1.1-rc.2', commits: ['b150a551b8d465e31e418e1b2eaf5e79bbb7d28e'] },
      seams: ['web.searchProvider'],
      requires: [],
      externalEligible: true,
    }],
  }
  await writeFile(join(root, 'update-center.json'), `${JSON.stringify({
    schemaVersion: 1,
    settings: {
      desktopRepository: '',
      harnessRepository: 'deepseek-ai/deepseek-harness',
      pluginRepository: 'cyrus/plugins',
      channel: 'stable',
      autoCheck: true,
    },
  })}\n`)
  const realFetch = globalThis.fetch
  globalThis.fetch = async url => {
    const target = String(url)
    if (target.includes('/releases?per_page=')) return jsonResponse([releaseObject], target)
    if (target.endsWith('/plugin-index.json')) return jsonResponse(indexBody, target)
    throw new Error('unexpected fetch: ' + target)
  }
  const service = new UpdateService({
    app: { getVersion: () => '0.4.2', isPackaged: false },
    shell: {},
    userDataPath: root,
    projectRoot: root,
    getCurrentSourceRoot: () => root,
    preflightHarness: async () => {},
    onInstallDesktop: async () => {},
    onRelaunch: async () => {},
  })
  t.after(async () => {
    globalThis.fetch = realFetch
    await service.dispose().catch(() => {})
    await rm(root, { recursive: true, force: true })
  })
  await service.ensureLoaded()
  service.harness.currentCommit = 'b150a551b8d465e31e418e1b2eaf5e79bbb7d28e'
  await service.checkPlugins()
  await assert.rejects(() => service.preparePluginGeneration(), /资产名不唯一/u)
})

test('preparePluginGeneration production rejects release tag mismatch', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-personal-update-plugin-prod-tag-'))
  const releaseTag = 'plugins-v2026.08.21.2'
  const releaseObject = {
    tag_name: releaseTag,
    name: releaseTag,
    draft: false,
    prerelease: false,
    published_at: '2026-08-21T00:00:00Z',
    assets: [{ name: 'plugin-index.json', browser_download_url: `https://github.com/cyrus/plugins/releases/download/${releaseTag}/plugin-index.json` }],
  }
  const indexBody = {
    schemaVersion: 1,
    generatedAt: '2026-08-21T00:00:00.000Z',
    releaseTag: 'plugins-v2026.08.21.1',
    minClient: '0.4.2',
    compatibleHarness: { version: '0.1.1-rc.2', commit: 'b150a551b8d465e31e418e1b2eaf5e79bbb7d28e' },
    plugins: [{
      packageName: '@cyrus/dsh-anysearch',
      version: '9.9.9',
      assetName: 'cyrus-dsh-anysearch-9.9.9.tgz',
      assetSize: 1,
      sha256: 'a'.repeat(64),
      minClient: '0.4.2',
      compatibleHarness: { versionRange: '0.1.1-rc.2', commits: ['b150a551b8d465e31e418e1b2eaf5e79bbb7d28e'] },
      seams: ['web.searchProvider'],
      requires: [],
      externalEligible: true,
    }],
  }
  await writeFile(join(root, 'update-center.json'), `${JSON.stringify({
    schemaVersion: 1,
    settings: {
      desktopRepository: '',
      harnessRepository: 'deepseek-ai/deepseek-harness',
      pluginRepository: 'cyrus/plugins',
      channel: 'stable',
      autoCheck: true,
    },
  })}\n`)
  const realFetch = globalThis.fetch
  globalThis.fetch = async url => {
    const target = String(url)
    if (target.includes('/releases?per_page=')) return jsonResponse([releaseObject], target)
    if (target.endsWith('/plugin-index.json')) return jsonResponse(indexBody, target)
    throw new Error('unexpected fetch: ' + target)
  }
  const service = new UpdateService({
    app: { getVersion: () => '0.4.2', isPackaged: false },
    shell: {},
    userDataPath: root,
    projectRoot: root,
    getCurrentSourceRoot: () => root,
    preflightHarness: async () => {},
    onInstallDesktop: async () => {},
    onRelaunch: async () => {},
  })
  t.after(async () => {
    globalThis.fetch = realFetch
    await service.dispose().catch(() => {})
    await rm(root, { recursive: true, force: true })
  })
  await service.ensureLoaded()
  service.harness.currentCommit = 'b150a551b8d465e31e418e1b2eaf5e79bbb7d28e'
  await service.checkPlugins()
  await assert.rejects(() => service.preparePluginGeneration(), /tag.*不一致|不一致/u)
})

test('preparePluginGeneration production rejects a missing asset', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-personal-update-plugin-prod-missing-'))
  const releaseTag = 'plugins-v2026.08.21.1'
  const releaseObject = {
    tag_name: releaseTag,
    name: releaseTag,
    draft: false,
    prerelease: false,
    published_at: '2026-08-21T00:00:00Z',
    assets: [{ name: 'plugin-index.json', browser_download_url: `https://github.com/cyrus/plugins/releases/download/${releaseTag}/plugin-index.json` }],
  }
  const indexBody = {
    schemaVersion: 1,
    generatedAt: '2026-08-21T00:00:00.000Z',
    releaseTag,
    minClient: '0.4.2',
    compatibleHarness: { version: '0.1.1-rc.2', commit: 'b150a551b8d465e31e418e1b2eaf5e79bbb7d28e' },
    plugins: [{
      packageName: '@cyrus/dsh-anysearch',
      version: '9.9.9',
      assetName: 'cyrus-dsh-anysearch-9.9.9.tgz',
      assetSize: 1,
      sha256: 'a'.repeat(64),
      minClient: '0.4.2',
      compatibleHarness: { versionRange: '0.1.1-rc.2', commits: ['b150a551b8d465e31e418e1b2eaf5e79bbb7d28e'] },
      seams: ['web.searchProvider'],
      requires: [],
      externalEligible: true,
    }],
  }
  await writeFile(join(root, 'update-center.json'), `${JSON.stringify({
    schemaVersion: 1,
    settings: {
      desktopRepository: '',
      harnessRepository: 'deepseek-ai/deepseek-harness',
      pluginRepository: 'cyrus/plugins',
      channel: 'stable',
      autoCheck: true,
    },
  })}\n`)
  const realFetch = globalThis.fetch
  globalThis.fetch = async url => {
    const target = String(url)
    if (target.includes('/releases?per_page=')) return jsonResponse([releaseObject], target)
    if (target.endsWith('/plugin-index.json')) return jsonResponse(indexBody, target)
    throw new Error('unexpected fetch: ' + target)
  }
  const service = new UpdateService({
    app: { getVersion: () => '0.4.2', isPackaged: false },
    shell: {},
    userDataPath: root,
    projectRoot: root,
    getCurrentSourceRoot: () => root,
    preflightHarness: async () => {},
    onInstallDesktop: async () => {},
    onRelaunch: async () => {},
  })
  t.after(async () => {
    globalThis.fetch = realFetch
    await service.dispose().catch(() => {})
    await rm(root, { recursive: true, force: true })
  })
  await service.ensureLoaded()
  service.harness.currentCommit = 'b150a551b8d465e31e418e1b2eaf5e79bbb7d28e'
  await service.checkPlugins()
  await assert.rejects(() => service.preparePluginGeneration(), /Release 缺少资产/u)
})

test('preparePluginGeneration production fails closed on aborted download', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-personal-update-plugin-prod-abort-'))
  const releaseTag = 'plugins-v2026.08.21.1'
  const releaseObject = {
    tag_name: releaseTag,
    name: releaseTag,
    draft: false,
    prerelease: false,
    published_at: '2026-08-21T00:00:00Z',
    assets: [
      { name: 'plugin-index.json', browser_download_url: `https://github.com/cyrus/plugins/releases/download/${releaseTag}/plugin-index.json` },
      { name: 'cyrus-dsh-anysearch-9.9.9.tgz', browser_download_url: `https://github.com/cyrus/plugins/releases/download/${releaseTag}/cyrus-dsh-anysearch-9.9.9.tgz` },
    ],
  }
  const indexBody = {
    schemaVersion: 1,
    generatedAt: '2026-08-21T00:00:00.000Z',
    releaseTag,
    minClient: '0.4.2',
    compatibleHarness: { version: '0.1.1-rc.2', commit: 'b150a551b8d465e31e418e1b2eaf5e79bbb7d28e' },
    plugins: [{
      packageName: '@cyrus/dsh-anysearch',
      version: '9.9.9',
      assetName: 'cyrus-dsh-anysearch-9.9.9.tgz',
      assetSize: 1,
      sha256: 'a'.repeat(64),
      minClient: '0.4.2',
      compatibleHarness: { versionRange: '0.1.1-rc.2', commits: ['b150a551b8d465e31e418e1b2eaf5e79bbb7d28e'] },
      seams: ['web.searchProvider'],
      requires: [],
      externalEligible: true,
    }],
  }
  await writeFile(join(root, 'update-center.json'), `${JSON.stringify({
    schemaVersion: 1,
    settings: {
      desktopRepository: '',
      harnessRepository: 'deepseek-ai/deepseek-harness',
      pluginRepository: 'cyrus/plugins',
      channel: 'stable',
      autoCheck: true,
    },
  })}\n`)
  const realFetch = globalThis.fetch
  globalThis.fetch = async url => {
    const target = String(url)
    if (target.includes('/releases?per_page=')) return jsonResponse([releaseObject], target)
    if (target.endsWith('/plugin-index.json')) return jsonResponse(indexBody, target)
    if (target.endsWith('.tgz')) throw new DOMException('The operation was aborted.', 'AbortError')
    throw new Error('unexpected fetch: ' + target)
  }
  const service = new UpdateService({
    app: { getVersion: () => '0.4.2', isPackaged: false },
    shell: {},
    userDataPath: root,
    projectRoot: root,
    getCurrentSourceRoot: () => root,
    preflightHarness: async () => {},
    onInstallDesktop: async () => {},
    onRelaunch: async () => {},
  })
  t.after(async () => {
    globalThis.fetch = realFetch
    await service.dispose().catch(() => {})
    await rm(root, { recursive: true, force: true })
  })
  await service.ensureLoaded()
  service.harness.currentCommit = 'b150a551b8d465e31e418e1b2eaf5e79bbb7d28e'
  await service.checkPlugins()
  await assert.rejects(() => service.preparePluginGeneration(), /abort|AbortError|fetch failed/u)
})

test('preparePluginGeneration production fails closed on ENOSPC while staging asset', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-personal-update-plugin-prod-enospc-'))
  const releaseTag = 'plugins-v2026.08.21.1'
  const releaseObject = {
    tag_name: releaseTag,
    name: releaseTag,
    draft: false,
    prerelease: false,
    published_at: '2026-08-21T00:00:00Z',
    assets: [
      { name: 'plugin-index.json', browser_download_url: `https://github.com/cyrus/plugins/releases/download/${releaseTag}/plugin-index.json` },
      { name: 'cyrus-dsh-anysearch-9.9.9.tgz', browser_download_url: `https://github.com/cyrus/plugins/releases/download/${releaseTag}/cyrus-dsh-anysearch-9.9.9.tgz` },
    ],
  }
  const indexBody = {
    schemaVersion: 1,
    generatedAt: '2026-08-21T00:00:00.000Z',
    releaseTag,
    minClient: '0.4.2',
    compatibleHarness: { version: '0.1.1-rc.2', commit: 'b150a551b8d465e31e418e1b2eaf5e79bbb7d28e' },
    plugins: [{
      packageName: '@cyrus/dsh-anysearch',
      version: '9.9.9',
      assetName: 'cyrus-dsh-anysearch-9.9.9.tgz',
      assetSize: 1,
      sha256: createHash('sha256').update('x').digest('hex'),
      minClient: '0.4.2',
      compatibleHarness: { versionRange: '0.1.1-rc.2', commits: ['b150a551b8d465e31e418e1b2eaf5e79bbb7d28e'] },
      seams: ['web.searchProvider'],
      requires: [],
      externalEligible: true,
    }],
  }
  await writeFile(join(root, 'update-center.json'), `${JSON.stringify({
    schemaVersion: 1,
    settings: {
      desktopRepository: '',
      harnessRepository: 'deepseek-ai/deepseek-harness',
      pluginRepository: 'cyrus/plugins',
      channel: 'stable',
      autoCheck: true,
    },
  })}\n`)
  const realFetch = globalThis.fetch
  globalThis.fetch = async url => {
    const target = String(url)
    if (target.includes('/releases?per_page=')) return jsonResponse([releaseObject], target)
    if (target.endsWith('/plugin-index.json')) return jsonResponse(indexBody, target)
    if (target.endsWith('.tgz')) return binaryResponse(Buffer.from('x'), target)
    throw new Error('unexpected fetch: ' + target)
  }
  const service = new UpdateService({
    app: { getVersion: () => '0.4.2', isPackaged: false },
    shell: {},
    userDataPath: root,
    projectRoot: root,
    getCurrentSourceRoot: () => root,
    preflightHarness: async () => {},
    onInstallDesktop: async () => {},
    onRelaunch: async () => {},
    writeFileAtomic: async () => {
      const error = new Error('模拟磁盘满')
      error.code = 'ENOSPC'
      throw error
    },
  })
  t.after(async () => {
    globalThis.fetch = realFetch
    await service.dispose().catch(() => {})
    await rm(root, { recursive: true, force: true })
  })
  await service.ensureLoaded()
  service.harness.currentCommit = 'b150a551b8d465e31e418e1b2eaf5e79bbb7d28e'
  await service.checkPlugins()
  await assert.rejects(() => service.preparePluginGeneration(), /ENOSPC|磁盘满/u)
})

test('desktop lifecycle A->B->multiple restarts->rollback A is produced by public download/install/confirm', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-personal-update-lifecycle-ab-'))
  const downloadDir = join(root, 'updates', 'downloads')
  await mkdir(downloadDir, { recursive: true })
  const installerA = Buffer.from('a-installer-v1')
  const installerB = Buffer.from('b-installer-v2')
  const shaA = createHash('sha256').update(installerA).digest('hex')
  const shaB = createHash('sha256').update(installerB).digest('hex')
  const harnessCommit = 'b150a551b8d465e31e418e1b2eaf5e79bbb7d28e'
  const makeRelease = (version, assetName, data, sha, manifest) => ({
    tag_name: `v${version}`,
    name: `v${version}`,
    draft: false,
    prerelease: false,
    published_at: '2026-08-22T00:00:00Z',
    body: 'notes',
    html_url: `https://github.com/cyrus/personal/releases/tag/v${version}`,
    assets: [
      {
        name: assetName,
        digest: `sha256:${sha}`,
        size: data.length,
        browser_download_url: `https://github.com/cyrus/personal/releases/download/v${version}/${assetName}`,
      },
      {
        name: 'client-release-manifest.json',
        browser_download_url: `https://github.com/cyrus/personal/releases/download/v${version}/client-release-manifest.json`,
      },
    ],
    _data: data,
    _manifest: manifest,
  })
  const manifestA = {
    schemaVersion: 1,
    clientVersion: '0.4.2',
    supportedHarnessCommits: [harnessCommit],
    builtinGenerationHash: 'a'.repeat(64),
    pluginContractVersion: '2',
    seamCapabilities: { 'web.searchProvider': '0.1.1-rc.2' },
    installerSha256: shaA,
  }
  const manifestB = {
    schemaVersion: 1,
    clientVersion: '0.5.0',
    supportedHarnessCommits: [harnessCommit],
    builtinGenerationHash: 'b'.repeat(64),
    pluginContractVersion: '2',
    seamCapabilities: { 'web.searchProvider': '0.1.1-rc.2' },
    installerSha256: shaB,
  }
  let release = makeRelease('0.4.2', 'a-setup.exe', installerA, shaA, manifestA)
  const realFetch = globalThis.fetch
  globalThis.fetch = async url => {
    const target = String(url)
    if (target.includes('/releases?per_page=')) return jsonResponse([release], target)
    if (target.endsWith('/releases/latest')) return jsonResponse(release, target)
    if (target.endsWith('client-release-manifest.json')) return jsonResponse(release._manifest, target)
    if (target.endsWith(release.assets[0].name)) return binaryResponse(release._data, target)
    throw new Error('unexpected fetch: ' + target)
  }
  const makeService = currentVersion => {
    const service = new UpdateService({
      app: { getVersion: () => currentVersion, isPackaged: true },
      shell: {},
      userDataPath: root,
      projectRoot: root,
      getCurrentSourceRoot: () => root,
      preflightHarness: async () => {},
      onInstallDesktop: async () => {},
      onRelaunch: async () => {},
    })
    t.after(() => service.dispose().catch(() => {}))
    return service
  }
  t.after(async () => {
    globalThis.fetch = realFetch
    await rm(root, { recursive: true, force: true })
  })

  await writeFile(join(root, 'update-center.json'), `${JSON.stringify({
    schemaVersion: 1,
    settings: {
      desktopRepository: 'cyrus/personal',
      harnessRepository: 'deepseek-ai/deepseek-harness',
      channel: 'stable',
      autoCheck: true,
    },
  })}\n`)

  // 1. From an older 0.3.0 install, download and install A through public API.
  const serviceA0 = makeService('0.3.0')
  await serviceA0.ensureLoaded()
  await serviceA0.checkDesktop()
  await serviceA0.downloadDesktop()
  let persisted = JSON.parse(await readFile(join(root, 'update-center.json'), 'utf8'))
  assert.equal(persisted.downloadedDesktop.version, '0.4.2')
  assert.equal(persisted.downloadedDesktop.sha256, shaA)
  assert.equal(persisted.downloadedDesktop.repository, 'cyrus/personal')
  assert.equal(persisted.downloadedDesktop.channel, 'stable')
  assert.equal(persisted.previousDesktop, undefined)
  assert.equal(persisted.knownGoodDesktop, undefined)
  await serviceA0.installDesktop()
  persisted = JSON.parse(await readFile(join(root, 'update-center.json'), 'utf8'))
  assert.equal(persisted.installPending.version, '0.4.2')

  // 2. Restart into A and confirm; A becomes knownGood through public lifecycle.
  const serviceA1 = makeService('0.4.2')
  await serviceA1.ensureLoaded()
  await serviceA1.confirmDesktopLifecycle()
  persisted = JSON.parse(await readFile(join(root, 'update-center.json'), 'utf8'))
  assert.equal(persisted.installPending, undefined)
  assert.equal(persisted.downloadedDesktop, undefined)
  assert.equal(persisted.knownGoodDesktop.version, '0.4.2')
  assert.equal(persisted.knownGoodDesktop.sha256, shaA)
  assert.equal(persisted.previousDesktop, undefined)

  // 3. At least one more restart on A keeps knownGood A stable.
  const serviceA2 = makeService('0.4.2')
  await serviceA2.ensureLoaded()
  await serviceA2.confirmDesktopLifecycle()
  persisted = JSON.parse(await readFile(join(root, 'update-center.json'), 'utf8'))
  assert.equal(persisted.knownGoodDesktop.version, '0.4.2')

  // 4. Now download B; the public download must move A into previousDesktop.
  release = makeRelease('0.5.0', 'b-setup.exe', installerB, shaB, manifestB)
  const serviceA3 = makeService('0.4.2')
  await serviceA3.ensureLoaded()
  await serviceA3.checkDesktop()
  await serviceA3.downloadDesktop()
  persisted = JSON.parse(await readFile(join(root, 'update-center.json'), 'utf8'))
  assert.equal(persisted.downloadedDesktop.version, '0.5.0')
  assert.equal(persisted.downloadedDesktop.sha256, shaB)
  assert.equal(persisted.downloadedDesktop.repository, 'cyrus/personal')
  assert.equal(persisted.downloadedDesktop.channel, 'stable')
  assert.equal(persisted.previousDesktop.version, '0.4.2')
  assert.equal(persisted.previousDesktop.sha256, shaA)
  assert.equal(persisted.previousDesktop.repository, 'cyrus/personal')
  assert.equal(persisted.previousDesktop.channel, 'stable')
  assert.equal(persisted.knownGoodDesktop.version, '0.4.2')
  await serviceA3.installDesktop()
  persisted = JSON.parse(await readFile(join(root, 'update-center.json'), 'utf8'))
  assert.equal(persisted.installPending.version, '0.5.0')
  assert.equal(persisted.previousDesktop.version, '0.4.2')

  // 5. Restart 1 into B: install confirmed, B becomes knownGood, A remains previous.
  const serviceB1 = makeService('0.5.0')
  await serviceB1.ensureLoaded()
  await serviceB1.confirmDesktopLifecycle()
  persisted = JSON.parse(await readFile(join(root, 'update-center.json'), 'utf8'))
  assert.equal(persisted.installPending, undefined)
  assert.equal(persisted.downloadedDesktop, undefined)
  assert.equal(persisted.knownGoodDesktop.version, '0.5.0')
  assert.equal(persisted.previousDesktop.version, '0.4.2')

  // 6. Restart 2 on B: previous A must remain for rollback.
  const serviceB2 = makeService('0.5.0')
  await serviceB2.ensureLoaded()
  await serviceB2.confirmDesktopLifecycle()
  persisted = JSON.parse(await readFile(join(root, 'update-center.json'), 'utf8'))
  assert.equal(persisted.previousDesktop.version, '0.4.2')
  assert.equal(persisted.knownGoodDesktop.version, '0.5.0')

  // 7. Rollback to A: pending recorded and previous A not cleared.
  await serviceB2.rollbackDesktop()
  persisted = JSON.parse(await readFile(join(root, 'update-center.json'), 'utf8'))
  assert.equal(persisted.rollbackPending.version, '0.4.2')
  assert.equal(persisted.previousDesktop.version, '0.4.2')

  // 8. Restart 3 into A: rollback confirmed, A becomes knownGood and lifecycle clears.
  const serviceA4 = makeService('0.4.2')
  await serviceA4.ensureLoaded()
  await serviceA4.confirmDesktopLifecycle()
  persisted = JSON.parse(await readFile(join(root, 'update-center.json'), 'utf8'))
  assert.equal(persisted.rollbackPending, undefined)
  assert.equal(persisted.previousDesktop, undefined)
  assert.equal(persisted.downloadedDesktop, undefined)
  assert.equal(persisted.knownGoodDesktop.version, '0.4.2')

  // 9. Restart 4 on A: no leftover lifecycle state.
  const serviceA5 = makeService('0.4.2')
  await serviceA5.ensureLoaded()
  persisted = JSON.parse(await readFile(join(root, 'update-center.json'), 'utf8'))
  assert.equal(persisted.installPending, undefined)
  assert.equal(persisted.rollbackPending, undefined)
  assert.equal(persisted.previousDesktop, undefined)
})

test('legacy 0.4.2 state has no known-good installer; first upgrade cannot auto-preserve 0.4.2 for rollback', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-personal-update-legacy-042-'))
  const downloadDir = join(root, 'updates', 'downloads')
  await mkdir(downloadDir, { recursive: true })
  const installerB = Buffer.from('b-installer-first-upgrade')
  const shaB = createHash('sha256').update(installerB).digest('hex')
  const harnessCommit = 'b150a551b8d465e31e418e1b2eaf5e79bbb7d28e'
  const releaseB = {
    tag_name: 'v0.5.0',
    name: 'v0.5.0',
    draft: false,
    prerelease: false,
    published_at: '2026-08-22T00:00:00Z',
    body: 'notes',
    html_url: 'https://github.com/cyrus/personal/releases/tag/v0.5.0',
    assets: [
      {
        name: 'b-setup.exe',
        digest: `sha256:${shaB}`,
        size: installerB.length,
        browser_download_url: 'https://github.com/cyrus/personal/releases/download/v0.5.0/b-setup.exe',
      },
      {
        name: 'client-release-manifest.json',
        browser_download_url: 'https://github.com/cyrus/personal/releases/download/v0.5.0/client-release-manifest.json',
      },
    ],
    _data: installerB,
    _manifest: {
      schemaVersion: 1,
      clientVersion: '0.5.0',
      supportedHarnessCommits: [harnessCommit],
      builtinGenerationHash: 'b'.repeat(64),
      pluginContractVersion: '2',
      seamCapabilities: { 'web.searchProvider': '0.1.1-rc.2' },
      installerSha256: shaB,
    },
  }
  const realFetch = globalThis.fetch
  globalThis.fetch = async url => {
    const target = String(url)
    if (target.includes('/releases?per_page=')) return jsonResponse([releaseB], target)
    if (target.endsWith('/releases/latest')) return jsonResponse(releaseB, target)
    if (target.endsWith('client-release-manifest.json')) return jsonResponse(releaseB._manifest, target)
    if (target.endsWith('b-setup.exe')) return binaryResponse(releaseB._data, target)
    throw new Error('unexpected fetch: ' + target)
  }
  const makeService = currentVersion => {
    const service = new UpdateService({
      app: { getVersion: () => currentVersion, isPackaged: true },
      shell: {},
      userDataPath: root,
      projectRoot: root,
      getCurrentSourceRoot: () => root,
      preflightHarness: async () => {},
      onInstallDesktop: async () => {},
      onRelaunch: async () => {},
    })
    t.after(() => service.dispose().catch(() => {}))
    return service
  }
  t.after(async () => {
    globalThis.fetch = realFetch
    await rm(root, { recursive: true, force: true })
  })

  // Legacy 0.4.2 update-center.json has no desktop lifecycle fields at all.
  await writeFile(join(root, 'update-center.json'), `${JSON.stringify({
    schemaVersion: 1,
    settings: {
      desktopRepository: 'cyrus/personal',
      harnessRepository: 'deepseek-ai/deepseek-harness',
      channel: 'stable',
      autoCheck: true,
    },
  })}\n`)

  const serviceA = makeService('0.4.2')
  await serviceA.ensureLoaded()
  await serviceA.checkDesktop()
  await serviceA.downloadDesktop()
  let persisted = JSON.parse(await readFile(join(root, 'update-center.json'), 'utf8'))
  assert.equal(persisted.downloadedDesktop.version, '0.5.0')
  assert.equal(persisted.previousDesktop, undefined)
  assert.equal(persisted.knownGoodDesktop, undefined)
  assert.equal(persisted.installPending, undefined)
  await serviceA.installDesktop()
  persisted = JSON.parse(await readFile(join(root, 'update-center.json'), 'utf8'))
  assert.equal(persisted.installPending.version, '0.5.0')

  const serviceB = makeService('0.5.0')
  await serviceB.ensureLoaded()
  await serviceB.confirmDesktopLifecycle()
  persisted = JSON.parse(await readFile(join(root, 'update-center.json'), 'utf8'))
  assert.equal(persisted.installPending, undefined)
  assert.equal(persisted.downloadedDesktop, undefined)
  assert.equal(persisted.previousDesktop, undefined)
  assert.equal(persisted.knownGoodDesktop.version, '0.5.0')
  const state = await serviceB.getState()
  assert.equal(state.desktop.canRollbackDesktop, false)
})

test('plugin generation GC preview and confirmed GC keep current and previous only', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-personal-update-plugin-gc-'))
  const externalRoot = join(root, 'plugins-external')
  const marker = async (dir, name, content) => {
    await mkdir(join(externalRoot, 'generations', dir), { recursive: true })
    await writeFile(join(externalRoot, 'generations', dir, name), content)
  }
  await marker('current-gen', 'marker.txt', 'current')
  await marker('prev-gen', 'marker.txt', 'prev')
  await marker('old-gen', 'marker.txt', 'old')
  await mkdir(join(externalRoot, 'staging', 'partial'), { recursive: true })
  await writeFile(join(externalRoot, 'staging', 'partial', 'marker.txt'), 'staging')
  await mkdir(join(externalRoot, 'quarantine', 'bad'), { recursive: true })
  await writeFile(join(externalRoot, 'quarantine', 'bad', 'marker.txt'), 'quarantine')
  await writeFile(join(externalRoot, 'current.json'), JSON.stringify({ generationId: 'current-gen', committedAt: '2026-08-22T00:00:00.000Z' }))
  await writeFile(join(externalRoot, 'previous.json'), JSON.stringify({ generationId: 'prev-gen', committedAt: '2026-08-21T00:00:00.000Z' }))
  const service = new UpdateService({
    app: { getVersion: () => '0.4.2', isPackaged: false },
    shell: {},
    userDataPath: root,
    projectRoot: root,
    getCurrentSourceRoot: () => root,
    preflightHarness: async () => {},
    onInstallDesktop: async () => {},
    onRelaunch: async () => {},
  })
  t.after(async () => {
    await service.dispose().catch(() => {})
    await rm(root, { recursive: true, force: true })
  })
  await service.ensureLoaded()
  const preview = await service.previewPluginGC()
  assert.deepEqual(preview.reclaimableGenerations, ['old-gen'])
  assert.equal(preview.stagingItems, 1)
  assert.deepEqual(preview.stagingDirectories, ['partial'])
  assert.equal(preview.quarantineItems, 1)
  assert.deepEqual(preview.quarantineDirectories, ['bad'])
  assert.equal(preview.wouldRemoveBusinessData, false)
  await service.gcPluginGenerations(preview.token)
  assert.equal(await readFile(join(externalRoot, 'generations', 'current-gen', 'marker.txt'), 'utf8'), 'current')
  assert.equal(await readFile(join(externalRoot, 'generations', 'prev-gen', 'marker.txt'), 'utf8'), 'prev')
  await assert.rejects(readFile(join(externalRoot, 'generations', 'old-gen', 'marker.txt')))
  await assert.rejects(readFile(join(externalRoot, 'staging', 'partial', 'marker.txt')))
  await assert.rejects(readFile(join(externalRoot, 'quarantine', 'bad', 'marker.txt')))
})

test('plugin generation GC refuses to run when current or previous journal is corrupt', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-personal-update-plugin-gc-corrupt-'))
  const externalRoot = join(root, 'plugins-external')
  for (const dir of ['current-gen', 'prev-gen', 'old-gen']) {
    await mkdir(join(externalRoot, 'generations', dir), { recursive: true })
    await writeFile(join(externalRoot, 'generations', dir, 'marker.txt'), dir)
  }
  await writeFile(join(externalRoot, 'current.json'), '{not-json')
  await writeFile(join(externalRoot, 'previous.json'), JSON.stringify({ generationId: 'prev-gen' }))
  const service = new UpdateService({
    app: { getVersion: () => '0.4.2', isPackaged: false },
    shell: {},
    userDataPath: root,
    projectRoot: root,
    getCurrentSourceRoot: () => root,
    preflightHarness: async () => {},
    onInstallDesktop: async () => {},
    onRelaunch: async () => {},
  })
  t.after(async () => {
    await service.dispose().catch(() => {})
    await rm(root, { recursive: true, force: true })
  })
  await service.ensureLoaded()
  await assert.rejects(() => service.previewPluginGC(), /GC 拒绝/u)
  for (const dir of ['current-gen', 'prev-gen', 'old-gen']) {
    assert.equal(await readFile(join(externalRoot, 'generations', dir, 'marker.txt'), 'utf8'), dir)
  }
})

test('removePluginGeneration preserves generation artifacts for reinstall recovery', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-personal-update-plugin-reinstall-'))
  const externalRoot = join(root, 'plugins-external')
  const generationId = 'gen1'
  const generationDir = join(externalRoot, 'generations', generationId)
  const pkgDir = join(generationDir, 'packages', 'anysearch', '9.9.9')
  await mkdir(join(pkgDir, 'lib'), { recursive: true })
  await writeFile(join(pkgDir, 'package.json'), JSON.stringify({ name: '@cyrus/dsh-anysearch', version: '9.9.9', dshComposable: { schemaVersion: 2 } }))
  await writeFile(join(pkgDir, 'lib', 'index.js'), 'export const ok = true\n')
  await writeFile(join(pkgDir, 'lib', 'client.js'), 'id: "@cyrus/dsh-anysearch"\n')
  const files = {
    'package.json': createHash('sha256').update(await readFile(join(pkgDir, 'package.json'))).digest('hex'),
    'lib/index.js': createHash('sha256').update(await readFile(join(pkgDir, 'lib', 'index.js'))).digest('hex'),
    'lib/client.js': createHash('sha256').update(await readFile(join(pkgDir, 'lib', 'client.js'))).digest('hex'),
  }
  await writeFile(join(pkgDir, '.install.json'), JSON.stringify({
    schemaVersion: 1,
    packageName: '@cyrus/dsh-anysearch',
    version: '9.9.9',
    sourceTag: 'plugins-v2026.08.22.1',
    tgzSha256: 'a'.repeat(64),
    minClient: '0.4.2',
    harnessCommit: 'b150a551b8d465e31e418e1b2eaf5e79bbb7d28e',
    pluginContractVersion: '2',
    seams: ['web.searchProvider'],
    files,
  }, null, 2))
  await writeFile(join(generationDir, 'batch.json'), JSON.stringify({
    schemaVersion: 1,
    generationId,
    harness: { version: '0.1.1-rc.2', commit: 'b150a551b8d465e31e418e1b2eaf5e79bbb7d28e' },
    packages: {
      '@cyrus/dsh-anysearch': { source: 'external', directoryName: 'anysearch', version: '9.9.9' },
    },
  }, null, 2))
  await writeFile(join(externalRoot, 'current.json'), JSON.stringify({ generationId }))
  // Real user-data business file: must survive remove and reinstall unchanged.
  const businessData = join(root, 'business-data.bin')
  const businessPayload = Buffer.from('keep-me-' + Date.now())
  await writeFile(businessData, businessPayload)
  const businessHashBefore = createHash('sha256').update(businessPayload).digest('hex')

  // A minimal built-in plugin tree is needed by the legal activation entry.
  const pluginRoot = join(root, 'plugins')
  for (const { packageName, directoryName } of PERSONAL_PLUGINS) {
    const dir = join(pluginRoot, directoryName)
    await mkdir(join(dir, 'lib'), { recursive: true })
    await writeFile(join(dir, 'package.json'), JSON.stringify({ name: packageName, version: '0.0.0' }))
    await writeFile(join(dir, 'lib', 'index.js'), '')
    await writeFile(join(dir, 'lib', 'client.js'), '')
  }

  const service = new UpdateService({
    app: { getVersion: () => '0.4.2', isPackaged: false },
    shell: {},
    userDataPath: root,
    projectRoot: root,
    getCurrentSourceRoot: () => root,
    preflightHarness: async () => {},
    onInstallDesktop: async () => {},
    onRelaunch: async () => {},
  })
  t.after(async () => {
    await service.dispose().catch(() => {})
    await rm(root, { recursive: true, force: true })
  })
  await service.ensureLoaded()
  await service.removePluginGeneration()
  await assert.rejects(readFile(join(externalRoot, 'current.json')))
  assert.equal(createHash('sha256').update(await readFile(businessData)).digest('hex'), businessHashBefore)
  assert.equal(JSON.parse(await readFile(join(externalRoot, 'generations', 'gen1', 'batch.json'), 'utf8')).generationId, 'gen1')

  // Reinstall recovery goes through the legal activation journal, generation
  // validation and doctor; current.json is produced by commit, never hand-written.
  await writeFile(join(externalRoot, 'pending.json'), JSON.stringify({
    generationId,
    candidateId: generationId,
    createdAt: new Date().toISOString(),
  }, null, 2))
  const activated = startPendingActivation({ externalRoot, pluginRoot, dshHome: join(root, 'home') })
  assert.equal(activated.candidateId, generationId)
  assert.equal(commitActivatingGeneration({ externalRoot, pluginRoot, dshHome: join(root, 'home'), fiberOk: true }), generationId)
  assert.equal(JSON.parse(await readFile(join(externalRoot, 'current.json'), 'utf8')).generationId, 'gen1')
  assert.equal(createHash('sha256').update(await readFile(businessData)).digest('hex'), businessHashBefore)
})

test('cross-line compatibility blocks Harness switch and client rollback against active plugin generation', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-personal-update-crossline-'))
  const externalRoot = join(root, 'plugins-external')
  const generationId = 'gen-cross'
  const pkgDir = join(externalRoot, 'generations', generationId, 'packages', 'anysearch', '9.9.9')
  await mkdir(pkgDir, { recursive: true })
  await writeFile(join(pkgDir, '.install.json'), JSON.stringify({
    schemaVersion: 1,
    packageName: '@cyrus/dsh-anysearch',
    version: '9.9.9',
    sourceTag: 'plugins-v2026.08.22.1',
    tgzSha256: 'a'.repeat(64),
    minClient: '0.5.0',
    harnessCommit: 'a'.repeat(40),
    pluginContractVersion: '2',
    seams: ['web.searchProvider'],
    files: {},
  }, null, 2))
  await writeFile(join(externalRoot, 'generations', generationId, 'batch.json'), JSON.stringify({
    schemaVersion: 1,
    generationId,
    harness: { version: '0.1.1-rc.2', commit: 'a'.repeat(40) },
    packages: {
      '@cyrus/dsh-anysearch': { source: 'external', directoryName: 'anysearch', version: '9.9.9' },
    },
  }, null, 2))
  await writeFile(join(externalRoot, 'current.json'), JSON.stringify({ generationId, committedAt: '2026-08-22T00:00:00.000Z' }))
  const service = new UpdateService({
    app: { getVersion: () => '0.5.0', isPackaged: false },
    shell: {},
    userDataPath: root,
    projectRoot: root,
    getCurrentSourceRoot: () => root,
    preflightHarness: async () => {},
    onInstallDesktop: async () => {},
    onRelaunch: async () => {},
  })
  t.after(async () => {
    await service.dispose().catch(() => {})
    await rm(root, { recursive: true, force: true })
  })
  await service.ensureLoaded()
  await assert.rejects(() => service.assertHarnessCompatibleWithPluginGeneration('b'.repeat(40)), /绑定 Harness/u)
  await service.assertHarnessCompatibleWithPluginGeneration('a'.repeat(40))
  await assert.rejects(() => service.assertClientVersionCompatibleWithPluginGeneration('0.4.2'), /需要客户端/u)
  await service.assertClientVersionCompatibleWithPluginGeneration('0.5.0')
})

test('active plugin generation with incomplete compatibility evidence fails closed for Harness and client operations', async t => {
  const scenarios = [
    {
      name: 'damaged batch',
      mutate: async externalRoot => {
        await writeFile(join(externalRoot, 'generations', 'gen-bad-evidence', 'batch.json'), '{not-json')
      },
    },
    {
      name: 'missing install',
      mutate: async externalRoot => {
        await rm(join(externalRoot, 'generations', 'gen-bad-evidence', 'packages', 'anysearch', '9.9.9', '.install.json'), { force: true })
      },
    },
    {
      name: 'unknown contract',
      mutate: async externalRoot => {
        const installPath = join(externalRoot, 'generations', 'gen-bad-evidence', 'packages', 'anysearch', '9.9.9', '.install.json')
        const install = JSON.parse(await readFile(installPath, 'utf8'))
        install.schemaVersion = 99
        await writeFile(installPath, JSON.stringify(install, null, 2))
      },
    },
    {
      name: 'unknown Harness commit',
      mutate: async externalRoot => {
        const batchPath = join(externalRoot, 'generations', 'gen-bad-evidence', 'batch.json')
        const batch = JSON.parse(await readFile(batchPath, 'utf8'))
        batch.harness = { version: '0.1.1-rc.2', commit: '' }
        await writeFile(batchPath, JSON.stringify(batch, null, 2))
      },
    },
  ]
  for (const scenario of scenarios) {
    const root = await mkdtemp(join(tmpdir(), `dsh-personal-update-failclosed-${scenario.name.replace(/[^a-z0-9]+/giu, '-')}-`))
    const externalRoot = join(root, 'plugins-external')
    const generationId = 'gen-bad-evidence'
    const pkgDir = join(externalRoot, 'generations', generationId, 'packages', 'anysearch', '9.9.9')
    await mkdir(pkgDir, { recursive: true })
    await writeFile(join(pkgDir, '.install.json'), JSON.stringify({
      schemaVersion: 1,
      packageName: '@cyrus/dsh-anysearch',
      version: '9.9.9',
      sourceTag: 'plugins-v2026.08.22.1',
      tgzSha256: 'a'.repeat(64),
      minClient: '0.4.2',
      harnessCommit: 'a'.repeat(40),
      pluginContractVersion: '2',
      seams: ['web.searchProvider'],
      files: {},
    }, null, 2))
    await writeFile(join(externalRoot, 'generations', generationId, 'batch.json'), JSON.stringify({
      schemaVersion: 1,
      generationId,
      harness: { version: '0.1.1-rc.2', commit: 'a'.repeat(40) },
      packages: {
        '@cyrus/dsh-anysearch': { source: 'external', directoryName: 'anysearch', version: '9.9.9' },
      },
    }, null, 2))
    await writeFile(join(externalRoot, 'current.json'), JSON.stringify({ generationId, committedAt: '2026-08-22T00:00:00.000Z' }))
    await scenario.mutate(externalRoot)
    const service = new UpdateService({
      app: { getVersion: () => '0.5.0', isPackaged: false },
      shell: {},
      userDataPath: root,
      projectRoot: root,
      getCurrentSourceRoot: () => root,
      preflightHarness: async () => {},
      onInstallDesktop: async () => {},
      onRelaunch: async () => {},
    })
    t.after(async () => {
      await service.dispose().catch(() => {})
      await rm(root, { recursive: true, force: true })
    })
    await service.ensureLoaded()
    await assert.rejects(
      () => service.assertHarnessCompatibleWithPluginGeneration('a'.repeat(40)),
      /兼容证据不完整|batch\.json|\.install\.json|schemaVersion|Harness commit/u,
      `${scenario.name} should block Harness compatibility`,
    )
    await assert.rejects(
      () => service.assertClientVersionCompatibleWithPluginGeneration('0.5.0', {
        schemaVersion: 1,
        clientVersion: '0.5.0',
        supportedHarnessCommits: ['a'.repeat(40)],
        builtinGenerationHash: 'b'.repeat(64),
        pluginContractVersion: '2',
        seamCapabilities: { 'web.searchProvider': '0.1.1-rc.2' },
        installerSha256: 'b'.repeat(64),
      }),
      /兼容证据不完整|batch\.json|\.install\.json|schemaVersion|Harness commit/u,
      `${scenario.name} should block client install/rollback`,
    )
    assert.equal(JSON.parse(await readFile(join(externalRoot, 'current.json'), 'utf8')).generationId, generationId)
  }
})

function binaryResponse(data, url) {
  const response = new Response(data, { status: 200, headers: { 'content-type': 'application/octet-stream' } })
  Object.defineProperty(response, 'url', { value: url })
  return response
}

function jsonResponse(body, url) {
  const response = new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  Object.defineProperty(response, 'url', { value: url })
  return response
}
function isProcessAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code !== 'ESRCH'
  }
}
