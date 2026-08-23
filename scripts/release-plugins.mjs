// scripts/release-plugins.mjs — A2 插件发布管线（离线 staging，不 push/tag/release）
// 用法：
//   node scripts/release-plugins.mjs --local-fixture --bootstrap --minClient 0.4.2 [--out release-staging/plugins-v2026.08.21.1]
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
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

function parseArgs(argv) {
  const args = { localFixture: false, bootstrap: false, minClient: undefined, out: undefined, tag: undefined }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--local-fixture') args.localFixture = true
    else if (arg === '--bootstrap') args.bootstrap = true
    else if (arg === '--minClient') args.minClient = argv[++i]
    else if (arg === '--out') args.out = argv[++i]
    else if (arg === '--tag') args.tag = argv[++i]
  }
  return args
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

function defaultTag() {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `plugins-v${y}.${m}.${d}.1`
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

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!args.localFixture) throw new Error('A2 只允许 --local-fixture；真实发布需 Cyrus 明确授权。')
  if (!args.bootstrap) throw new Error('首次无 plugins-v* 基线必须显式 --bootstrap。')
  if (!args.minClient) throw new Error('--minClient 是发布参数，不能写死。')

  const outDir = resolve(projectRoot, args.out ?? join('release-staging', defaultTag()))
  assertAutomationSafe(outDir, 'release staging')
  mkdirSync(outDir, { recursive: true })

  runCheck()

  const tempRoot = mkdtempSync(join(tmpdir(), 'dsh-release-plugins-'))
  const indexPlugins = []
  try {
    for (const { packageName, directoryName } of PERSONAL_PLUGINS) {
      if (!['@cyrus/dsh-anysearch', '@cyrus/dsh-trajectory-island'].includes(packageName)) continue
      const dir = join(projectRoot, 'plugins', directoryName)
      await processPlugin({ dir, packageName }, outDir, tempRoot, args.minClient, indexPlugins)
    }
  } finally {
    rmSync(tempRoot, { recursive: true, force: true })
  }

  const outTagMatch = /^plugins-v\d{4}\.\d{2}\.\d{2}\.\d+$/u.exec(basename(outDir))
  const releaseTag = args.tag ?? (outTagMatch === null ? defaultTag() : outTagMatch[0])
  const index = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    releaseTag,
    minClient: args.minClient,
    compatibleHarness: { version: EXPECTED_HARNESS_VERSION, commit: EXPECTED_HARNESS_COMMIT },
    plugins: indexPlugins,
  }
  writeFileSync(join(outDir, 'plugin-index.json'), JSON.stringify(index, null, 2) + '\n')
  writeFileSync(join(outDir, 'release-manifest.json'), JSON.stringify({
    schemaVersion: 1,
    releaseTag,
    minClient: args.minClient,
    compatibleHarness: { version: EXPECTED_HARNESS_VERSION, commit: EXPECTED_HARNESS_COMMIT },
    bootstrap: true,
    localFixture: true,
    assets: indexPlugins.map(plugin => ({ assetName: plugin.assetName, sha256: plugin.sha256, assetSize: plugin.assetSize })),
  }, null, 2) + '\n')
  writeFileSync(join(outDir, 'release-notes.draft.md'), [
    `# ${releaseTag} (draft)`,
    '',
    `- minClient: ${args.minClient}`,
    `- compatibleHarness: ${EXPECTED_HARNESS_VERSION} / ${EXPECTED_HARNESS_COMMIT}`,
    `- plugins: ${indexPlugins.map(plugin => `${plugin.packageName}@${plugin.version}`).join(', ')}`,
    '',
    '> 本地 fixture staging，未创建 GitHub release。',
    '',
  ].join('\n'))

  process.stdout.write(`release staging ready: ${outDir}\n`)
  process.stdout.write(`tag: ${releaseTag}\n`)
  process.stdout.write(`plugins: ${indexPlugins.length}\n`)
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    process.stderr.write(`${error.stack ?? error}\n`)
    process.exit(1)
  })
}
