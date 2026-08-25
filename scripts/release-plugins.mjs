// scripts/release-plugins.mjs — A2 插件发布管线（local-fixture staging / 真实 GitHub plugins-v* Release）
// 用法：
//   node scripts/release-plugins.mjs --local-fixture --bootstrap --minClient 0.4.3 [--out release-staging/plugins-v2026.08.24.1] [--tag plugins-v2026.08.24.1]
//   node scripts/release-plugins.mjs --publish --bootstrap --minClient 0.4.3 --repo SeeiiLee/deepseek-projectpl-console --token-file <path> [--tag plugins-v2026.08.24.1] [--dry-run]
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'

import { PERSONAL_PLUGINS } from '../src/personal-plugins.js'
import { assertAutomationSafe } from './protected-paths.js'
import { inspectTarball, safeExtractTarball, scanExtractedDirectory } from '../src/plugin-archive-security.js'
import { EXPECTED_HARNESS_COMMIT, EXPECTED_HARNESS_VERSION } from './build-kit.mjs'

const projectRoot = resolve(import.meta.dirname, '..')
const readJson = path => JSON.parse(readFileSync(path, 'utf8'))
const DEFAULT_RELEASE_PACKAGES = new Set(['@cyrus/dsh-anysearch', '@cyrus/dsh-trajectory-island'])
const EXTERNAL_RELEASE_PACKAGES = new Set([
  ...DEFAULT_RELEASE_PACKAGES,
  '@cyrus/dsh-project-control',
])
const DEFAULT_REPOSITORY = 'SeeiiLee/deepseek-projectpl-console'

function parseArgs(argv) {
  const args = {
    localFixture: false,
    publish: false,
    dryRun: false,
    bootstrap: false,
    minClient: undefined,
    out: undefined,
    tag: undefined,
    repo: DEFAULT_REPOSITORY,
    tokenFile: undefined,
  }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--local-fixture') args.localFixture = true
    else if (arg === '--publish') args.publish = true
    else if (arg === '--dry-run') args.dryRun = true
    else if (arg === '--bootstrap') args.bootstrap = true
    else if (arg === '--minClient') args.minClient = argv[++i]
    else if (arg === '--out') args.out = argv[++i]
    else if (arg === '--tag') args.tag = argv[++i]
    else if (arg === '--repo') args.repo = argv[++i]
    else if (arg === '--token-file') args.tokenFile = argv[++i]
  }
  return args
}

/**
 * Parse explicit plugin selection from --plugin/--plugins.
 * Rejects unknown whitelist names, duplicates, and empty selections.
 */
export function parsePluginSelection(argv, { allowed = EXTERNAL_RELEASE_PACKAGES } = {}) {
  const selected = []
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--plugin') {
      const value = argv[++i]
      if (value === undefined || value.trim() === '') throw new Error('--plugin 不能为空')
      selected.push(value.trim())
    } else if (arg === '--plugins') {
      const value = argv[++i]
      if (value === undefined || value.trim() === '') throw new Error('--plugins 不能为空')
      for (const part of value.split(',')) {
        const name = part.trim()
        if (name === '') throw new Error('--plugins 不能包含空项')
        selected.push(name)
      }
    }
  }
  if (selected.length === 0) return new Set()
  const seen = new Set()
  for (const name of selected) {
    if (!allowed.has(name)) throw new Error(`未知插件: ${name}`)
    if (seen.has(name)) throw new Error(`重复插件: ${name}`)
    seen.add(name)
  }
  return seen
}

function runCheck() {
  const result = spawnSync(process.execPath, ['scripts/generate-plugin-set.mjs', '--check'], {
    cwd: projectRoot,
    encoding: 'utf8',
    windowsHide: true,
  })
  if (result.status !== 0) {
    throw new Error(`plugin-set lock 校验失败:\n${result.stderr || result.stdout}`)
  }
}

function sha256File(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

function defaultTag(now = new Date()) {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `plugins-v${y}.${m}.${d}.1`
}

function nextTag(tag) {
  const match = /^(plugins-v\d{4}\.\d{2}\.\d{2}\.)(\d+)$/u.exec(tag)
  if (match === null) throw new Error(`无法递增 tag: ${tag}`)
  return `${match[1]}${Number(match[2]) + 1}`
}

function resolveTag(existingTags, explicitTag, now = new Date()) {
  let tag = explicitTag ?? defaultTag(now)
  while (existingTags.has(tag)) tag = nextTag(tag)
  return tag
}

function fetchExistingPluginTags(repository) {
  const result = spawnSync('git', ['ls-remote', '--tags', `https://github.com/${repository}.git`], {
    encoding: 'utf8',
    windowsHide: true,
  })
  if (result.status !== 0) {
    throw new Error(`无法读取远端 tag: ${result.stderr || result.stdout}`)
  }
  return new Set(result.stdout.split(/\r?\n/u)
    .map(line => line.split('\t')[1])
    .filter(ref => typeof ref === 'string' && ref.startsWith('refs/tags/plugins-v'))
    .map(ref => ref.slice('refs/tags/'.length)))
}

function assertCleanGitTree() {
  const result = spawnSync('git', ['status', '--porcelain', '--untracked-files=no'], {
    cwd: projectRoot,
    encoding: 'utf8',
    windowsHide: true,
  })
  if (result.status !== 0) throw new Error(`无法检查 git 状态: ${result.stderr || result.stdout}`)
  if (result.stdout.trim() !== '') {
    throw new Error(`真实发布要求已提交的干净 git 树，当前有未提交改动:\n${result.stdout.trim()}`)
  }
}

async function packPlugin(pluginDir, packDir) {
  const result = spawnSync('npm', ['pack', '--pack-destination', packDir, '--silent'], {
    cwd: pluginDir,
    encoding: 'utf8',
    windowsHide: true,
    shell: process.platform === 'win32',
  })
  if (result.status !== 0) throw new Error(`npm pack 失败: ${result.stderr || result.stdout}`)
  const name = result.stdout.trim().split(/\r?\n/).at(-1)
  const tgz = join(packDir, name)
  if (!existsSync(tgz)) throw new Error(`npm pack 未产出 tarball: ${name}`)
  return tgz
}

async function processPlugin(plugin, outDir, tempRoot, minClient, indexPlugins) {
  const manifest = readJson(join(plugin.dir, 'package.json'))
  const composable = manifest.dshComposable
  if (composable?.schemaVersion !== 2) {
    throw new Error(`${manifest.name} 没有 v2 manifest，不能进入插件简易发布线`)
  }
  if (composable.minClient !== minClient) {
    throw new Error(`${manifest.name} dshComposable.minClient=${composable.minClient}，与发布参数 ${minClient} 不一致`)
  }
  const ajv = new Ajv2020({ allErrors: true, strict: true })
  addFormats(ajv)
  const v2Schema = readJson(join(projectRoot, 'protocol', 'personal-plugin-contract', 'v2', 'schemas', 'dsh-composable.schema.json'))
  const validate = ajv.compile(v2Schema)
  if (!validate(composable)) throw new Error(`${manifest.name} v2 manifest 校验失败: ${ajv.errorsText(validate.errors)}`)

  const packDir = join(tempRoot, 'pack')
  mkdirSync(packDir, { recursive: true })
  const tgz = await packPlugin(plugin.dir, packDir)
  const inspection = await inspectTarball(tgz)
  if (!inspection.ok) throw new Error(`${manifest.name} tgz 安全检查失败: ${inspection.issues.join('; ')}`)

  const extractDir = join(tempRoot, 'extract')
  mkdirSync(extractDir, { recursive: true })
  await safeExtractTarball(tgz, extractDir)
  const allowedFiles = composable.files?.list
  const scan = scanExtractedDirectory(extractDir, { allowedFiles })
  if (!scan.ok) throw new Error(`${manifest.name} 解包内容扫描失败: ${scan.issues.join('; ')}`)
  if (allowedFiles !== undefined) {
    const normalizedFiles = inspection.files.map(file => file.replace(/^package\//u, ''))
    for (const file of allowedFiles) {
      if (!normalizedFiles.includes(file)) throw new Error(`${manifest.name} 清单文件 ${file} 不在 tgz 中`)
    }
  }
  // 包内 SHA 合同：发布前必须与 dshComposable.files.sha256 完全一致。
  // package.json 是自引用清单（其 files.sha256 含自身声明），minClient 已单独校验，
  // 这里校验其余实体文件哈希，避免循环依赖。
  if (composable.files?.sha256 !== undefined) {
    for (const [file, expected] of Object.entries(composable.files.sha256)) {
      if (file === 'package.json') continue
      const absolute = join(extractDir, 'package', ...file.split('/'))
      if (!existsSync(absolute)) throw new Error(`${manifest.name} 包内缺少 ${file}`)
      const actual = sha256File(absolute)
      if (actual !== expected) {
        throw new Error(`${manifest.name} 包内 ${file} SHA-256 不符：expected ${expected} actual ${actual}`)
      }
    }
  }

  const assetName = basename(tgz)
  const assetPath = join(outDir, assetName)
  copyFileSync(tgz, assetPath)
  const sha256 = sha256File(assetPath)
  writeFileSync(join(outDir, `${assetName}.sha256`), `${sha256} *${assetName}\n`)
  const assetSize = statSync(assetPath).size

  indexPlugins.push({
    packageName: manifest.name,
    version: manifest.version,
    assetName,
    assetSize,
    sha256,
    minClient,
    compatibleHarness: composable.compatibleHarness,
    seams: (composable.seams ?? []).map(seam => seam.name),
    requires: composable.requires?.packages ?? [],
    dataSchema: composable.dataSchema,
    modelAssets: composable.modelAssets ?? [],
    externalEligible: true,
  })
}

function writeReleaseFiles(outDir, releaseTag, minClient, indexPlugins, localFixture, options = {}) {
  const bootstrap = options.bootstrap ?? false
  const index = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    releaseTag,
    minClient,
    compatibleHarness: { version: EXPECTED_HARNESS_VERSION, commit: EXPECTED_HARNESS_COMMIT },
    plugins: indexPlugins,
  }
  writeFileSync(join(outDir, 'plugin-index.json'), JSON.stringify(index, null, 2) + '\n')
  writeFileSync(join(outDir, 'release-manifest.json'), JSON.stringify({
    schemaVersion: 1,
    releaseTag,
    minClient,
    compatibleHarness: { version: EXPECTED_HARNESS_VERSION, commit: EXPECTED_HARNESS_COMMIT },
    bootstrap,
    localFixture,
    assets: indexPlugins.map(plugin => ({ assetName: plugin.assetName, sha256: plugin.sha256, assetSize: plugin.assetSize })),
  }, null, 2) + '\n')
  writeFileSync(join(outDir, 'release-notes.draft.md'), [
    `# ${releaseTag}`,
    '',
    `- minClient: ${minClient}`,
    `- compatibleHarness: ${EXPECTED_HARNESS_VERSION} / ${EXPECTED_HARNESS_COMMIT}`,
    `- plugins: ${indexPlugins.map(plugin => `${plugin.packageName}@${plugin.version}`).join(', ')}`,
    '',
    localFixture
      ? '> 本地 fixture staging，未创建 GitHub release。'
      : '> 正式插件发布（公开 Release），资产与 plugin-index 已核验。',
    '',
  ].join('\n'))
}

function validateStaging(outDir, releaseTag, minClient, { publicOnly = false, expectedPlugins = DEFAULT_RELEASE_PACKAGES, bootstrap } = {}) {
  const index = readJson(join(outDir, 'plugin-index.json'))
  const manifest = readJson(join(outDir, 'release-manifest.json'))
  if (index.releaseTag !== releaseTag) throw new Error(`plugin-index.releaseTag ${index.releaseTag} != ${releaseTag}`)
  if (manifest.releaseTag !== releaseTag) throw new Error(`release-manifest.releaseTag ${manifest.releaseTag} != ${releaseTag}`)
  if (index.minClient !== minClient) throw new Error(`plugin-index.minClient ${index.minClient} != ${minClient}`)
  if (manifest.minClient !== minClient) throw new Error(`release-manifest.minClient ${manifest.minClient} != ${minClient}`)
  if (publicOnly && manifest.localFixture === true) throw new Error('公开/校验产物不得带 localFixture=true')
  if (bootstrap !== undefined && manifest.bootstrap !== bootstrap) {
    throw new Error(`release-manifest.bootstrap ${manifest.bootstrap} != 期望 ${bootstrap}`)
  }
  if (index.compatibleHarness?.version !== EXPECTED_HARNESS_VERSION || index.compatibleHarness?.commit !== EXPECTED_HARNESS_COMMIT) {
    throw new Error('plugin-index compatibleHarness 与合同不一致')
  }
  if (manifest.compatibleHarness?.version !== EXPECTED_HARNESS_VERSION || manifest.compatibleHarness?.commit !== EXPECTED_HARNESS_COMMIT) {
    throw new Error('release-manifest compatibleHarness 与合同不一致')
  }
  const expected = new Set(expectedPlugins ?? [])
  if (expected.size === 0) throw new Error('validateStaging 期望插件集合不能为空')
  if (index.plugins.length !== expected.size) throw new Error(`插件数量 ${index.plugins.length} != 期望 ${expected.size}`)
  const names = new Set(index.plugins.map(plugin => plugin.packageName))
  if (names.size !== expected.size || [...names].some(name => !expected.has(name))) {
    throw new Error(`插件集合必须精确为 ${[...expected].join(', ')}`)
  }
  const expectedAssetFiles = new Set()
  for (const plugin of index.plugins) {
    if (plugin.minClient !== minClient) throw new Error(`${plugin.packageName}.minClient ${plugin.minClient} != ${minClient}`)
    const shaPath = join(outDir, `${plugin.assetName}.sha256`)
    if (!existsSync(shaPath)) throw new Error(`${plugin.packageName} 缺少 .sha256`)
    const expected = `${plugin.sha256} *${plugin.assetName}\n`
    if (readFileSync(shaPath, 'utf8') !== expected) throw new Error(`${plugin.packageName} .sha256 内容与索引不一致`)
    if (statSync(join(outDir, plugin.assetName)).size !== plugin.assetSize) throw new Error(`${plugin.packageName} 资产大小与索引不一致`)
    expectedAssetFiles.add(plugin.assetName)
    expectedAssetFiles.add(`${plugin.assetName}.sha256`)
  }
  const staleAssets = readdirSync(outDir)
    .filter(name => name.endsWith('.tgz') || name.endsWith('.tgz.sha256'))
    .filter(name => !expectedAssetFiles.has(name))
  if (staleAssets.length > 0) throw new Error(`staging 混入多余资产: ${staleAssets.join(', ')}`)
  const manifestAssets = new Set(manifest.assets.map(asset => asset.assetName))
  if (manifestAssets.size !== index.plugins.length) throw new Error('release-manifest 资产集合不唯一')
  for (const plugin of index.plugins) {
    const asset = manifest.assets.find(item => item.assetName === plugin.assetName)
    if (asset === undefined) throw new Error(`release-manifest 缺少 ${plugin.assetName}`)
    if (asset.sha256 !== plugin.sha256 || asset.assetSize !== plugin.assetSize) throw new Error(`release-manifest ${plugin.assetName} 与索引不一致`)
  }
}

function readToken(tokenFile) {
  if (tokenFile === undefined || tokenFile === '') throw new Error('真实发布必须提供 --token-file')
  const token = readFileSync(resolve(tokenFile), 'utf8').trim()
  if (token === '') throw new Error('token 为空')
  return token
}

function githubHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'dsh-release-plugins',
  }
}

function ensureLocalTag(releaseTag) {
  const check = spawnSync('git', ['rev-parse', '-q', '--verify', `refs/tags/${releaseTag}`], {
    cwd: projectRoot,
    encoding: 'utf8',
    windowsHide: true,
  })
  if (check.status === 0) {
    const existing = check.stdout.trim()
    const headResult = spawnSync('git', ['rev-parse', 'HEAD'], {
      cwd: projectRoot,
      encoding: 'utf8',
      windowsHide: true,
    })
    if (headResult.status !== 0) throw new Error('无法读取 HEAD')
    if (existing !== headResult.stdout.trim()) {
      throw new Error(`tag ${releaseTag} 已存在且指向 ${existing}，不是当前 HEAD ${headResult.stdout.trim()}`)
    }
    return
  }
  const create = spawnSync('git', ['tag', releaseTag], {
    cwd: projectRoot,
    encoding: 'utf8',
    windowsHide: true,
  })
  if (create.status !== 0) throw new Error(`git tag 失败: ${create.stderr || create.stdout}`)
}

function pushReleaseRefs({ branch, releaseTag, repository, tokenFile }) {
  const token = readToken(tokenFile)
  const url = `https://github.com/${repository}.git`
  const basic = Buffer.from(`x-access-token:${token}`, 'utf8').toString('base64')
  const env = {
    ...process.env,
    GIT_CONFIG_COUNT: '2',
    GIT_CONFIG_KEY_0: 'http.extraheader',
    GIT_CONFIG_VALUE_0: `Authorization: Basic ${basic}`,
    GIT_CONFIG_KEY_1: 'credential.helper',
    GIT_CONFIG_VALUE_1: '',
  }
  const branchResult = spawnSync('git', ['push', url, `HEAD:refs/heads/${branch}`], {
    cwd: projectRoot,
    encoding: 'utf8',
    windowsHide: true,
    env,
  })
  if (branchResult.status !== 0) {
    throw new Error(`push 分支失败: ${branchResult.stderr || branchResult.stdout}`)
  }
  const tagResult = spawnSync('git', ['push', url, `refs/tags/${releaseTag}`], {
    cwd: projectRoot,
    encoding: 'utf8',
    windowsHide: true,
    env,
  })
  if (tagResult.status !== 0) {
    throw new Error(`push tag 失败: ${tagResult.stderr || tagResult.stdout}`)
  }
}

async function githubRequest(url, options, token) {
  const response = await fetch(url, options)
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`GitHub API ${response.status} ${response.statusText}: ${text.slice(0, 2_000)}`)
  }
  return response.json()
}

async function createDraftRelease({ releaseTag, repository, outDir, token }) {
  const notes = readFileSync(join(outDir, 'release-notes.draft.md'), 'utf8')
  return githubRequest(`https://api.github.com/repos/${repository}/releases`, {
    method: 'POST',
    headers: githubHeaders(token),
    body: JSON.stringify({
      tag_name: releaseTag,
      name: releaseTag,
      body: notes,
      draft: true,
      prerelease: false,
    }),
  }, token)
}

async function uploadAsset({ release, assetPath, assetName, token }) {
  const uploadUrl = (release.upload_url ?? '').replace(/\{\?name,label\}$/u, '')
  if (uploadUrl === '') throw new Error('Release 缺少 upload_url')
  const data = readFileSync(assetPath)
  const response = await fetch(`${uploadUrl}?name=${encodeURIComponent(assetName)}`, {
    method: 'POST',
    headers: { ...githubHeaders(token), 'Content-Type': 'application/octet-stream' },
    body: data,
  })
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`上传资产失败 ${assetName}: ${response.status} ${response.statusText}: ${text.slice(0, 2_000)}`)
  }
  return response.json()
}

async function verifyDraftAssets({ release, repository, outDir, token }) {
  const current = await githubRequest(`https://api.github.com/repos/${repository}/releases/${release.id}`, {
    headers: githubHeaders(token),
  }, token)
  const remoteAssets = current.assets ?? []
  const remoteNames = remoteAssets.map(asset => asset.name)
  if (new Set(remoteNames).size !== remoteNames.length) throw new Error('Release 资产名不唯一')
  const expectedNames = [
    'plugin-index.json',
    'release-manifest.json',
    ...readdirSync(outDir).filter(name => name.endsWith('.tgz') || name.endsWith('.tgz.sha256')),
  ]
  const missing = expectedNames.filter(name => !remoteNames.includes(name))
  if (missing.length > 0) throw new Error(`Release 缺少资产: ${missing.join(', ')}`)
  for (const asset of remoteAssets) {
    if (!expectedNames.includes(asset.name)) throw new Error(`Release 含多余资产: ${asset.name}`)
  }
  return current
}

async function publishRelease({ release, repository, token }) {
  return githubRequest(`https://api.github.com/repos/${repository}/releases/${release.id}`, {
    method: 'PATCH',
    headers: githubHeaders(token),
    body: JSON.stringify({ draft: false, prerelease: false }),
  }, token)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const selectedPlugins = parsePluginSelection(process.argv.slice(2))
  if (selectedPlugins.size === 0) {
    for (const name of DEFAULT_RELEASE_PACKAGES) selectedPlugins.add(name)
  }
  if (args.localFixture && args.publish) throw new Error('--local-fixture 与 --publish 不能同时使用')
  if (!args.localFixture && !args.publish) throw new Error('必须指定 --local-fixture 或 --publish')
  if (!args.minClient) throw new Error('--minClient 是发布参数，不能写死。')
  if (args.publish && !args.dryRun && args.tokenFile === undefined) throw new Error('真实发布必须提供 --token-file')

  let releaseTag = args.tag
  let releaseBranch
  if (args.publish) {
    const existingTags = fetchExistingPluginTags(args.repo)
    if (args.bootstrap && existingTags.size > 0) {
      throw new Error(`bootstrap 只能用于无 plugins-v 基线的首次发布，当前远端已有 ${existingTags.size} 个 plugins-v tag。`)
    }
    if (!args.bootstrap && existingTags.size === 0) {
      throw new Error('首次无 plugins-v* 基线必须显式 --bootstrap。')
    }
    releaseTag = resolveTag(existingTags, args.tag)
    if (!args.dryRun) {
      assertCleanGitTree()
      const branchResult = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
        cwd: projectRoot,
        encoding: 'utf8',
        windowsHide: true,
      })
      if (branchResult.status !== 0) throw new Error('无法读取当前分支')
      releaseBranch = branchResult.stdout.trim()
      if (releaseBranch === 'HEAD' || releaseBranch === 'main') throw new Error(`发布分支不合法: ${releaseBranch}`)
    }
  } else {
    if (args.tag === undefined && args.out !== undefined) {
      const outTagMatch = /^plugins-v\d{4}\.\d{2}\.\d{2}\.\d+$/u.exec(basename(args.out))
      if (outTagMatch !== null) releaseTag = outTagMatch[0]
    }
    releaseTag ??= defaultTag()
  }

  const outDir = resolve(projectRoot, args.out ?? join('release-staging', releaseTag))
  assertAutomationSafe(outDir, 'release staging')
  mkdirSync(outDir, { recursive: true })

  runCheck()

  const tempRoot = mkdtempSync(join(tmpdir(), 'dsh-release-plugins-'))
  const indexPlugins = []
  try {
    for (const { packageName, directoryName } of PERSONAL_PLUGINS) {
      if (!selectedPlugins.has(packageName)) continue
      const dir = join(projectRoot, 'plugins', directoryName)
      await processPlugin({ dir, packageName }, outDir, tempRoot, args.minClient, indexPlugins)
    }
  } finally {
    rmSync(tempRoot, { recursive: true, force: true })
  }

  writeReleaseFiles(outDir, releaseTag, args.minClient, indexPlugins, args.localFixture, { bootstrap: args.bootstrap })
  validateStaging(outDir, releaseTag, args.minClient, {
    publicOnly: args.publish,
    expectedPlugins: selectedPlugins,
    bootstrap: args.bootstrap,
  })

  process.stdout.write(`release staging ready: ${outDir}\n`)
  process.stdout.write(`tag: ${releaseTag}\n`)
  process.stdout.write(`mode: ${args.publish ? (args.dryRun ? 'publish-dry-run' : 'publish') : 'local-fixture'}\n`)
  process.stdout.write(`plugins: ${indexPlugins.length}\n`)

  if (!args.publish || args.dryRun) return

  ensureLocalTag(releaseTag)
  pushReleaseRefs({ branch: releaseBranch, releaseTag, repository: args.repo, tokenFile: args.tokenFile })
  const token = readToken(args.tokenFile)
  const release = await createDraftRelease({ releaseTag, repository: args.repo, outDir, token })
  process.stdout.write(`draft release created: id=${release.id} url=${release.html_url}\n`)
  const expectedAssets = [
    'plugin-index.json',
    'release-manifest.json',
    ...indexPlugins.flatMap(plugin => [plugin.assetName, `${plugin.assetName}.sha256`]),
  ]
  for (const assetName of expectedAssets) {
    await uploadAsset({ release, assetPath: join(outDir, assetName), assetName, token })
    process.stdout.write(`uploaded ${assetName}\n`)
  }
  const verified = await verifyDraftAssets({ release, repository: args.repo, outDir, token })
  process.stdout.write(`draft assets verified: ${verified.assets.length}\n`)
  const published = await publishRelease({ release: verified, repository: args.repo, token })
  process.stdout.write(`published release: ${published.html_url}\n`)
}

export {
  defaultTag,
  nextTag,
  resolveTag,
  validateStaging,
  writeReleaseFiles,
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    process.stderr.write(`${error.stack ?? error}\n`)
    process.exit(1)
  })
}
