// scripts/generate-client-release-manifest.mjs — A3 客户端 release manifest 生产侧生成
// 用法：node scripts/generate-client-release-manifest.mjs --installer <exe> [--out <path>]
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { EXPECTED_HARNESS_COMMIT } from './build-kit.mjs'

const projectRoot = resolve(import.meta.dirname, '..')

function parseArgs(argv) {
  const args = { installer: undefined, out: undefined }
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--installer') args.installer = argv[++i]
    else if (argv[i] === '--out') args.out = argv[++i]
  }
  return args
}

function sha256File(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.installer === undefined) throw new Error('--installer <path> 必填。')
  const packageJson = JSON.parse(readFileSync(resolve(projectRoot, 'package.json'), 'utf8'))
  const lock = JSON.parse(readFileSync(resolve(projectRoot, 'plugin-set.lock.json'), 'utf8'))
  const builtinGenerationHash = createHash('sha256').update(readFileSync(resolve(projectRoot, 'plugin-set.lock.json'))).digest('hex')
  const seamCapabilities = {}
  for (const name of ['@cyrus/dsh-anysearch', '@cyrus/dsh-trajectory-island']) {
    const entry = lock.packages[name]
    if (entry === undefined) continue
    const pluginRoot = name === '@cyrus/dsh-anysearch' ? 'anysearch' : 'trajectory-island'
    const manifest = JSON.parse(readFileSync(resolve(projectRoot, 'plugins', pluginRoot, 'package.json'), 'utf8'))
    for (const seam of manifest.dshComposable?.seams ?? []) {
      seamCapabilities[seam.name] = seam.minVersion
    }
  }
  const manifest = {
    schemaVersion: 1,
    clientVersion: packageJson.version,
    supportedHarnessCommits: [EXPECTED_HARNESS_COMMIT],
    builtinGenerationHash,
    pluginContractVersion: '2',
    seamCapabilities,
    installerSha256: sha256File(resolve(args.installer)),
  }
  const outPath = args.out === undefined ? resolve(projectRoot, 'client-release-manifest.json') : resolve(args.out)
  writeFileSync(outPath, `${JSON.stringify(manifest, null, 2)}\n`)
  process.stdout.write(`client-release-manifest written: ${outPath}\n`)
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main()
  } catch (error) {
    process.stderr.write(`${error.stack ?? error}\n`)
    process.exit(1)
  }
}
