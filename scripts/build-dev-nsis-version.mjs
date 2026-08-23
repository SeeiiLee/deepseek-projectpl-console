// scripts/build-dev-nsis-version.mjs
// Build one Dev NSIS installer with an isolated version override.
// Usage: node scripts/build-dev-nsis-version.mjs <version> [outputDir]
// The script restores package.json in all failure paths.
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { join, resolve } from 'node:path'
import { EXPECTED_HARNESS_COMMIT } from './build-kit.mjs'

const projectRoot = resolve(import.meta.dirname, '..')
const version = process.argv[2]
const outDir = resolve(process.argv[3] ?? join(projectRoot, 'artifacts-dev', 'e2e', version))
const packageJsonPath = join(projectRoot, 'package.json')

if (!version || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(version)) {
  process.stderr.write('usage: node scripts/build-dev-nsis-version.mjs <version> [outputDir]\n')
  process.exit(2)
}

const originalPackageJson = readFileSync(packageJsonPath, 'utf8')
const originalManifest = JSON.parse(originalPackageJson)
originalManifest.version = version
writeFileSync(packageJsonPath, `${JSON.stringify(originalManifest, null, 2)}\n`, 'utf8')

let exitCode = 0
try {
  const result = spawnSync(process.execPath, ['scripts/pack-desktop.js', 'dev', 'nsis'], {
    cwd: projectRoot,
    encoding: 'utf8',
    stdio: 'inherit',
    env: { ...process.env, DSH_E2E_BUILD: '1' },
  })
  if (result.status !== 0) {
    exitCode = result.status ?? 1
  } else {
    const installerName = `DeepSeek-Harness-Personal-Dev-${version}-setup-x64.exe`
    const installer = join(projectRoot, 'artifacts-dev', installerName)
    if (!existsSync(installer)) throw new Error(`Dev NSIS installer not found: ${installer}`)
    mkdirSync(outDir, { recursive: true })
    copyFileSync(installer, join(outDir, installerName))

    const receiptSrc = join(projectRoot, 'artifacts-dev', 'build-receipt.json')
    if (existsSync(receiptSrc)) {
      const receipt = JSON.parse(readFileSync(receiptSrc, 'utf8'))
      const installerSha = createHash('sha256').update(readFileSync(installer)).digest('hex')
      receipt.installerSha256 = installerSha
      if (receipt.e2eBuild !== true || receipt.flavor !== 'dev') {
        throw new Error(`Dev NSIS build receipt is not a Dev-E2E receipt for ${version}`)
      }
      writeFileSync(join(outDir, 'build-receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`, 'utf8')
    } else {
      throw new Error(`Dev NSIS build receipt missing for ${version}`)
    }

    const installerSha = createHash('sha256').update(readFileSync(installer)).digest('hex')
    writeFileSync(join(outDir, `${installerName}.sha256`), `${installerSha} *${installerName}\n`, 'utf8')

    const pluginLock = readFileSync(join(projectRoot, 'plugin-set.lock.json'), 'utf8')
    const builtinGenerationHash = createHash('sha256').update(pluginLock).digest('hex')
    const manifest = {
      schemaVersion: 1,
      clientVersion: version,
      supportedHarnessCommits: [EXPECTED_HARNESS_COMMIT],
      builtinGenerationHash,
      pluginContractVersion: '2',
      seamCapabilities: {
        'web.searchProvider': '0.1.1-rc.2',
        'dsh-client-ui-trajectory': '0.1.1-rc.2',
      },
      installerSha256: installerSha,
    }
    writeFileSync(join(outDir, 'client-release-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
    process.stdout.write(`BUILT ${version}\ninstaller=${installer}\nsha256=${installerSha}\noutput=${outDir}\n`)
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
  exitCode = 1
} finally {
  writeFileSync(packageJsonPath, originalPackageJson, 'utf8')
}
process.exit(exitCode)
