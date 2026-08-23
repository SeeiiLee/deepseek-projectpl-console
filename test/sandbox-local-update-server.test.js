import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, test } from 'node:test'

const repoRoot = resolve(import.meta.dirname, '..')
const SERVER_SCRIPT = join(repoRoot, 'scripts', 'sandbox-local-update-server.ps1')
const VERSIONS = ['0.4.0', '0.4.1', '0.4.2']
const owned = []

// powershell.exe (Windows PowerShell 5.1) must not inherit PowerShell 7-only
// PSModulePath entries. When this test is launched from pwsh/Codex, the
// inherited PSModulePath can point Get-FileHash's auto-load at incompatible
// module copies. Keep only WindowsPowerShell module roots and fall back to the
// in-box module directory.
function windowsPowerShellEnv() {
  const inherited = (process.env.PSModulePath || '').split(';').filter(entry => entry && entry.toLowerCase().includes('windowspowershell'))
  const psModulePath = inherited.length > 0
    ? inherited
    : [join(process.env.SystemRoot || process.env.windir || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'Modules')]
  return { ...process.env, PSModulePath: psModulePath.join(';') }
}
afterEach(() => {
  for (const path of owned.splice(0)) rmSync(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
})

function sha256Buffer(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function makePackageFixture(root, current) {
  const packagesDir = join(root, 'packages')
  for (const version of VERSIONS) {
    const versionDir = join(packagesDir, version)
    mkdirSync(versionDir, { recursive: true })
    const installerName = `DeepSeek-Harness-Personal-Dev-${version}-setup-x64.exe`
    const installerPath = join(versionDir, installerName)
    writeFileSync(installerPath, Buffer.from(`fake-exe-${version}-${'x'.repeat(200)}`))
    const sha = sha256Buffer(readFileSync(installerPath))
    writeFileSync(join(versionDir, `${installerName}.sha256`), `${sha} *${installerName}\n`)
    writeJson(join(versionDir, 'client-release-manifest.json'), {
      schemaVersion: 1,
      clientVersion: version,
      supportedHarnessCommits: ['b150a551b8d465e31e418e1b2eaf5e79bbb7d28e'],
      builtinGenerationHash: 'a'.repeat(64),
      pluginContractVersion: '2',
      seamCapabilities: {},
      installerSha256: sha,
    })
    writeJson(join(versionDir, 'build-receipt.json'), {
      schemaVersion: 2,
      flavor: 'dev',
      e2eBuild: true,
      clientVersion: version,
      driverSchemaVersion: 1,
      driverVersion: '1.0.0',
      installerSha256: sha,
      exeSha256: 'b'.repeat(64),
      packagedTreeHash: 'c'.repeat(64),
      packagedFileCount: 1,
      sourceFiles: {},
      generatedAt: new Date().toISOString(),
    })
  }
  writeFileSync(join(root, 'current.txt'), `${current}\n`, 'utf8')
  return { packagesDir, currentFile: join(root, 'current.txt') }
}

function startServer({ packagesDir, currentFile, port }) {
  const args = [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    SERVER_SCRIPT,
    '-PackagesDir', packagesDir,
    '-CurrentFile', currentFile,
    '-RequiredVersions', VERSIONS.join(','),
    '-Port', String(port),
  ]
  const child = spawn('powershell.exe', args, {
    cwd: repoRoot,
    env: windowsPowerShellEnv(),
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  let stderr = ''
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', chunk => { output = `${output}${chunk}`.slice(-200_000) })
  child.stderr.on('data', chunk => { stderr = `${stderr}${chunk}`.slice(-100_000) })
  const ready = new Promise((resolvePromise, rejectPromise) => {
    const timer = setTimeout(() => rejectPromise(new Error(`Server did not start.\n${output}\n${stderr}`)), 15_000)
    const check = () => {
      if (output.includes('LISTENING')) {
        clearTimeout(timer)
        resolvePromise()
      } else if (child.exitCode !== null) {
        clearTimeout(timer)
        rejectPromise(new Error(`Server exited early (${String(child.exitCode)}).\n${output}\n${stderr}`))
      } else {
        setTimeout(check, 25)
      }
    }
    check()
  })
  return { child, ready, getOutput: () => output }
}

function stopServer(server) {
  if (server.child.exitCode === null && server.child.pid !== undefined) {
    spawnSync('taskkill.exe', ['/pid', String(server.child.pid), '/t', '/f'], {
      shell: false,
      windowsHide: true,
      stdio: 'ignore',
    })
  }
}

function startServerExpectFailure({ packagesDir, currentFile, port }) {
  const args = [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    SERVER_SCRIPT,
    '-PackagesDir', packagesDir,
    '-CurrentFile', currentFile,
    '-RequiredVersions', VERSIONS.join(','),
    '-Port', String(port),
  ]
  const child = spawn('powershell.exe', args, {
    cwd: repoRoot,
    env: windowsPowerShellEnv(),
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  let stderr = ''
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', chunk => { output = `${output}${chunk}`.slice(-100_000) })
  child.stderr.on('data', chunk => { stderr = `${stderr}${chunk}`.slice(-100_000) })
  return new Promise((resolvePromise, rejectPromise) => {
    const timer = setTimeout(() => {
      spawnSync('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], { shell: false, windowsHide: true, stdio: 'ignore' })
      rejectPromise(new Error(`Server did not fail in time.\n${output}\n${stderr}`))
    }, 15_000)
    child.once('exit', code => {
      clearTimeout(timer)
      resolvePromise({ code, output, stderr })
    })
    child.once('error', error => {
      clearTimeout(timer)
      rejectPromise(error)
    })
  })
}

async function getJson(base, path) {
  const response = await fetch(`${base}${path}`)
  assert.equal(response.status, 200, `${path} status ${String(response.status)}`)
  return response.json()
}

function getFreePort() {
  return new Promise((resolvePromise, rejectPromise) => {
    const server = createServer()
    server.once('error', rejectPromise)
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port
      server.close(() => resolvePromise(port))
    })
  })
}

async function makeDevE2ESourceTree() {
  const root = mkdtempSync(join(repoRoot, '.tmp-e2e-src-'))
  owned.push(root)
  cpSync(join(repoRoot, 'src'), join(root, 'src'), { recursive: true })
  cpSync(join(repoRoot, 'protocol'), join(root, 'protocol'), { recursive: true })
  cpSync(
    join(repoRoot, 'vendor', 'pnpm', 'dist', 'node_modules', 'tar'),
    join(root, 'vendor', 'pnpm', 'dist', 'node_modules', 'tar'),
    { recursive: true },
  )
  writeFileSync(join(root, 'src', 'build-flavor.js'), "export const BUILD_FLAVOR = 'dev'\nexport const E2E_BUILD = true\n")
  return root
}

async function makeDevE2EService({ sourceRoot, userData, port, currentVersion = '0.4.0' }) {
  mkdirSync(userData, { recursive: true })
  const module = await import(pathToFileURL(join(sourceRoot, 'src', 'update-service.js')).href)
  const service = new module.UpdateService({
    app: { getVersion: () => currentVersion, isPackaged: true },
    shell: {},
    userDataPath: userData,
    projectRoot: sourceRoot,
    getCurrentSourceRoot: () => sourceRoot,
    preflightHarness: async () => {},
    onInstallDesktop: async () => {},
    onRelaunch: async () => {},
  })
  writeJson(join(userData, 'update-center.json'), {
    schemaVersion: 1,
    settings: {
      desktopRepository: 'cyrus/personal',
      harnessRepository: 'deepseek-ai/deepseek-harness',
      pluginRepository: '',
      channel: 'stable',
      autoCheck: true,
    },
  })
  process.env.DSH_DESKTOP_E2E_LOCAL_UPDATE = '1'
  process.env.DSH_DESKTOP_E2E_UPDATE_BASE_URL = `http://127.0.0.1:${port}`
  await service.ensureLoaded()
  return service
}

test('real sandbox-local-update-server serves releases array, latest object, and byte-identical assets', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-sandbox-server-ok-'))
  owned.push(root)
  const { packagesDir, currentFile } = makePackageFixture(root, '0.4.1')
  const port = await getFreePort()
  const server = startServer({ packagesDir, currentFile, port })
  await server.ready
  try {
    const base = `http://127.0.0.1:${port}`
    const list = await getJson(base, '/repos/cyrus/personal/releases?per_page=20')
    assert.equal(Array.isArray(list), true)
    assert.equal(list.length, 1)
    assert.equal(list[0].tag_name, 'v0.4.1')
    const latest = await getJson(base, '/repos/cyrus/personal/releases/latest')
    assert.equal(Array.isArray(latest), false)
    assert.equal(latest.tag_name, 'v0.4.1')

    const installerAsset = latest.assets.find(asset => asset.name.endsWith('.exe'))
    const manifestAsset = latest.assets.find(asset => asset.name === 'client-release-manifest.json')
    assert.ok(installerAsset)
    assert.ok(manifestAsset)

    const manifestResponse = await fetch(manifestAsset.browser_download_url)
    assert.equal(manifestResponse.status, 200)
    const manifestBody = Buffer.from(await manifestResponse.arrayBuffer())
    const expectedManifest = readFileSync(join(packagesDir, '0.4.1', 'client-release-manifest.json'))
    assert.deepEqual(manifestBody, expectedManifest)

    const installerResponse = await fetch(installerAsset.browser_download_url)
    assert.equal(installerResponse.status, 200)
    const installerBody = Buffer.from(await installerResponse.arrayBuffer())
    const expectedInstaller = readFileSync(join(packagesDir, '0.4.1', `DeepSeek-Harness-Personal-Dev-0.4.1-setup-x64.exe`))
    assert.deepEqual(installerBody, expectedInstaller)
    assert.equal(sha256Buffer(installerBody), installerAsset.digest.slice('sha256:'.length))
  } finally {
    stopServer(server)
  }
})

test('real sandbox-local-update-server rejects non-GET, unknown version/asset, and traversal', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-sandbox-server-bad-'))
  owned.push(root)
  const { packagesDir, currentFile } = makePackageFixture(root, '0.4.1')
  const port = await getFreePort()
  const server = startServer({ packagesDir, currentFile, port })
  await server.ready
  try {
    const base = `http://127.0.0.1:${port}`
    const post = await fetch(`${base}/repos/cyrus/personal/releases`, { method: 'POST' })
    assert.equal(post.status, 405)

    const unknownVersion = await fetch(`${base}/repos/cyrus/personal/releases/download/v9.9.9/DeepSeek-Harness-Personal-Dev-9.9.9-setup-x64.exe`)
    assert.equal(unknownVersion.status, 404)

    const unknownAsset = await fetch(`${base}/repos/cyrus/personal/releases/download/v0.4.1/not-there.exe`)
    assert.equal(unknownAsset.status, 404)

    const traversal = await fetch(`${base}/repos/cyrus/personal/releases/download/v0.4.1/%2e%2e%2fsecret.exe`)
    assert.ok([400, 404].includes(traversal.status), `traversal status ${String(traversal.status)}`)

    const traversalVersion = await fetch(`${base}/repos/cyrus/personal/releases/download/v..%2f..%2fsecret.exe`)
    assert.equal(traversalVersion.status, 404)
  } finally {
    stopServer(server)
  }
})

test('real server preflight rejects ordinary Dev, stable, and missing-driver packages', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-sandbox-server-preflight-'))
  owned.push(root)
  const { packagesDir, currentFile } = makePackageFixture(root, '0.4.1')
  const receiptPath = join(packagesDir, '0.4.1', 'build-receipt.json')
  const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'))

  receipt.e2eBuild = false
  writeJson(receiptPath, receipt)
  let port = await getFreePort()
  let failed = await startServerExpectFailure({ packagesDir, currentFile, port })
  assert.notEqual(failed.code, 0)
  assert.match(failed.output + failed.stderr, /e2eBuild/u)

  receipt.e2eBuild = true
  receipt.flavor = 'stable'
  writeJson(receiptPath, receipt)
  port = await getFreePort()
  failed = await startServerExpectFailure({ packagesDir, currentFile, port })
  assert.notEqual(failed.code, 0)
  assert.match(failed.output + failed.stderr, /flavor/u)

  receipt.flavor = 'dev'
  delete receipt.driverSchemaVersion
  delete receipt.driverVersion
  writeJson(receiptPath, receipt)
  port = await getFreePort()
  failed = await startServerExpectFailure({ packagesDir, currentFile, port })
  assert.notEqual(failed.code, 0)
  assert.match(failed.output + failed.stderr, /missing the Dev-E2E driver schema\/version|driverSchemaVersion|driverVersion/u)

  receipt.driverSchemaVersion = 1
  receipt.driverVersion = '1.0.0'
  receipt.installerSha256 = 'f'.repeat(64)
  writeJson(receiptPath, receipt)
  port = await getFreePort()
  failed = await startServerExpectFailure({ packagesDir, currentFile, port })
  assert.notEqual(failed.code, 0)
  assert.match(failed.output + failed.stderr, /installerSha256/u)
})

test('Dev-E2E client seam uses the real local server, follows same-origin redirects, and rejects external redirects before requesting them', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-sandbox-client-'))
  owned.push(root)
  const { packagesDir, currentFile } = makePackageFixture(root, '0.4.1')
  const port = await getFreePort()
  const server = startServer({ packagesDir, currentFile, port })
  await server.ready
  const sourceRoot = await makeDevE2ESourceTree()
  const userData = join(root, 'userData')
  mkdirSync(userData, { recursive: true })
  const previousEnv = {
    DSH_DESKTOP_E2E_LOCAL_UPDATE: process.env.DSH_DESKTOP_E2E_LOCAL_UPDATE,
    DSH_DESKTOP_E2E_UPDATE_BASE_URL: process.env.DSH_DESKTOP_E2E_UPDATE_BASE_URL,
  }
  try {
    const service = await makeDevE2EService({ sourceRoot, userData, port, currentVersion: '0.4.0' })
    try {
      await service.checkDesktop()
      assert.equal(service.desktop.status, 'available')
      assert.equal(service.desktop.latestVersion, '0.4.1')

      // Same-origin redirect: rewrite the installer URL to the server's redirect
      // route. The client must follow each hop and still accept the asset.
      const installerAsset = service.desktopRelease.assets.find(asset => asset.name.endsWith('.exe'))
      const installerName = installerAsset.name
      installerAsset.browser_download_url = `http://127.0.0.1:${port}/repos/cyrus/personal/releases/download/redirect/v0.4.1/${installerName}`
      await service.downloadDesktop()
      const downloaded = service.document.downloadedDesktop
      assert.equal(downloaded.version, '0.4.1')
      const downloadedBytes = readFileSync(downloaded.path)
      assert.equal(sha256Buffer(downloadedBytes), downloaded.sha256)

      // External redirect: the client must reject before making the outbound
      // request to 127.0.0.2.
      const service2 = await makeDevE2EService({
        sourceRoot, userData: join(root, 'userData2'), port, currentVersion: '0.4.0',
      })
      try {
        await service2.checkDesktop()
        const asset2 = service2.desktopRelease.assets.find(asset => asset.name.endsWith('.exe'))
        asset2.browser_download_url = `http://127.0.0.1:${port}/repos/cyrus/personal/releases/download/redirect-external/v0.4.1/${asset2.name}`
        await assert.rejects(() => service2.downloadDesktop(), /left the local E2E update source before the next request/u)
      } finally {
        await service2.dispose().catch(() => {})
      }
    } finally {
      await service.dispose().catch(() => {})
    }

    // Harness/plugin requests must never reach the local server. With an empty
    // plugin repository the only HTTP request made by check() for the desktop
    // source is the local releases call; harness uses git, plugins stay local.
    const output = server.getOutput()
    const localPaths = output.split(/\r?\n/u).filter(line => line.startsWith('REQ '))
    for (const line of localPaths) {
      assert.doesNotMatch(line, /\/repos\/deepseek-ai\/deepseek-harness/u)
      assert.doesNotMatch(line, /\/repos\/cyrus\/plugins/u)
    }
  } finally {
    stopServer(server)
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
})
