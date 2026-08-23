import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'

import { PERSONAL_PLUGINS } from '../src/personal-plugins.js'
import { ensureHarnessSourceLink, resolveBuildRoot } from './build-kit.mjs'

const require = createRequire(import.meta.url)
const projectRoot = resolve(import.meta.dirname, '..')
const sourceRoot = resolveBuildRoot()
ensureHarnessSourceLink(projectRoot, sourceRoot)
const tsc = join(sourceRoot, 'node_modules', 'typescript', 'bin', 'tsc')

const PILOT_PACKAGES = new Set(['@cyrus/dsh-anysearch', '@cyrus/dsh-trajectory-island'])
const CONTRACT_ROOT = join(projectRoot, 'protocol', 'personal-plugin-contract')

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function validateManifestContracts() {
  const ajv = new Ajv2020({ allErrors: true, strict: true })
  addFormats(ajv)
  const v2Schema = readJson(join(CONTRACT_ROOT, 'v2', 'schemas', 'dsh-composable.schema.json'))
  const v1Schema = readJson(join(CONTRACT_ROOT, 'v1', 'schemas', 'dsh-composable.schema.json'))
  const validateV2 = ajv.compile(v2Schema)
  const validateV1 = ajv.compile(v1Schema)
  const summary = []
  for (const { packageName, directoryName } of PERSONAL_PLUGINS) {
    const manifestPath = join(projectRoot, 'plugins', directoryName, 'package.json')
    if (!existsSync(manifestPath)) throw new Error(`${packageName} manifest is missing: ${manifestPath}`)
    const manifest = readJson(manifestPath)
    const composable = manifest.dshComposable
    if (PILOT_PACKAGES.has(packageName)) {
      if (!validateV2(composable)) {
        throw new Error(`${packageName} v2 manifest 校验失败: ${ajv.errorsText(validateV2.errors)}`)
      }
      summary.push(`${packageName} v2 PASS`)
    } else {
      if (composable?.schemaVersion === 2) {
        // 非试点若已迁移到 v2，也必须通过 v2 schema。
        if (!validateV2(composable)) {
          throw new Error(`${packageName} v2 manifest 校验失败: ${ajv.errorsText(validateV2.errors)}`)
        }
        summary.push(`${packageName} v2 PASS`)
      } else {
        if (!validateV1(composable ?? {})) {
          throw new Error(`${packageName} v1 manifest 校验失败: ${ajv.errorsText(validateV1.errors)}`)
        }
        summary.push(`${packageName} 未迁移（v1）`)
      }
    }
  }
  process.stdout.write('Manifest contract summary:\n  ' + summary.join('\n  ') + '\n')
}

function validateLock() {
  const lock = readJson(join(projectRoot, 'plugin-set.lock.json'))
  const ajv = new Ajv2020({ allErrors: true, strict: true })
  addFormats(ajv)
  const schema = readJson(join(CONTRACT_ROOT, 'v1', 'schemas', 'preset-lock.schema.json'))
  const validate = ajv.compile(schema)
  if (!validate(lock)) {
    throw new Error(`plugin-set.lock.json schema 校验失败: ${ajv.errorsText(validate.errors)}`)
  }
  process.stdout.write('plugin-set.lock.json schema: PASS\n')
}

function runPluginChecks() {
  for (const { packageName, directoryName } of PERSONAL_PLUGINS) {
    const directory = join(projectRoot, 'plugins', directoryName)
    run(process.execPath, [tsc, '-p', 'tsconfig.json', '--noEmit'], directory, `${packageName} typecheck`)
    run(process.execPath, ['--check', 'lib/index.js'], directory, `${packageName} Host syntax`)
    run(process.execPath, ['--check', 'lib/client.js'], directory, `${packageName} Client syntax`)

    const client = readFileSync(join(directory, 'lib', 'client.js'), 'utf8')
    if (!client.includes(`id: ${JSON.stringify(packageName)}`)) {
      throw new Error(`${packageName} client bundle does not register its exact package id.`)
    }
    const testDirectory = join(directory, 'test')
    if (existsSync(testDirectory)) {
      const tests = readdirSync(testDirectory)
        .filter(name => name.endsWith('.test.js'))
        .map(name => join('test', name))
      if (tests.length > 0) run(process.execPath, ['--test', ...tests], directory, `${packageName} tests`)
    }
  }
}

validateManifestContracts()
validateLock()
run(process.execPath, ['scripts/generate-plugin-set.mjs', '--check'], projectRoot, 'plugin-set lock consistency')
runPluginChecks()

function run(executable, args, cwd, label) {
  process.stdout.write(`${label}...\n`)
  const result = spawnSync(executable, args, { cwd, encoding: 'utf8', windowsHide: true })
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  if (result.status !== 0) process.exit(result.status ?? 1)
}
