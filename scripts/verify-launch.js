import { spawn } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { PERSONAL_PLUGINS } from '../src/personal-plugins.js'
import { loadCurrentGeneration, resolveExternalRoot, validateGeneration } from '../src/personal-plugin-validation.js'

// Launch gate: refuses to boot the desktop with an inconsistent tree.
// The launcher builds plugins first; this script verifies every artifact the
// running app actually loads, so a torn build fails here with a clear message
// instead of crashing the Electron process later. Checks run in parallel.

const projectRoot = resolve(import.meta.dirname, '..')

const checks = []
const failures = []

function verifySyntax(label, path) {
  checks.push(new Promise(resolveCheck => {
    if (!existsSync(path) || statSync(path).size === 0) {
      failures.push(`${label} is missing or empty: ${path}`)
      resolveCheck()
      return
    }
    const check = spawn(process.execPath, ['--check', path], { encoding: 'utf8', windowsHide: true })
    check.on('close', code => {
      if (code !== 0) failures.push(`${label} failed the syntax check: ${path}`)
      resolveCheck()
    })
    check.on('error', () => {
      failures.push(`${label} could not be checked: ${path}`)
      resolveCheck()
    })
  }))
}

for (const { packageName, directoryName } of PERSONAL_PLUGINS) {
  const directory = join(projectRoot, 'plugins', directoryName)
  const hostBundle = join(directory, 'lib', 'index.js')
  const clientBundle = join(directory, 'lib', 'client.js')
  verifySyntax(`${packageName} Host bundle`, hostBundle)
  verifySyntax(`${packageName} Client bundle`, clientBundle)
  checks.push(Promise.resolve().then(() => {
    if (existsSync(clientBundle)) {
      const client = readFileSync(clientBundle, 'utf8')
      if (!client.includes(`id: ${JSON.stringify(packageName)}`)) {
        failures.push(`${packageName} client bundle does not register its exact package id.`)
      }
    }
  }))
}

for (const entry of ['src/main.js', 'src/preload.cjs', 'src/desktop-bridge.js', 'src/harness-process.js', 'src/dev-e2e-driver.js']) {
  verifySyntax(entry, join(projectRoot, entry))
}

const migrationsDirectory = join(projectRoot, 'plugins', 'project-control', 'migrations')
let migrationFiles = []
const overlayPatch = join(projectRoot, 'plugins', 'cordis.patch.yml')
if (!existsSync(overlayPatch) || statSync(overlayPatch).size === 0) {
  failures.push('Personal plugin overlay (plugins/cordis.patch.yml) is missing.')
}

if (existsSync(migrationsDirectory)) {
  migrationFiles = readdirSync(migrationsDirectory).filter(name => name.endsWith('.sql'))
}
for (let version = 1; version <= 9; version += 1) {
  const prefix = String(version).padStart(4, '0')
  if (!migrationFiles.some(name => name.startsWith(`${prefix}_`))) {
    failures.push(`Project Control migration ${prefix} is missing.`)
  }
}

// A1: development-tree launch gate reuses the same validation module. If an
// external generation is configured, it must be valid before launch.
const externalRoot = resolveExternalRoot({ env: process.env })
if (externalRoot !== null && existsSync(externalRoot)) {
  const generation = loadCurrentGeneration(externalRoot, {
    directoryByPackage: new Map(PERSONAL_PLUGINS.map(plugin => [plugin.packageName, plugin.directoryName])),
  })
  if (generation === null) {
    failures.push('external generation is configured but current.json is missing/invalid.')
  } else {
    const result = validateGeneration(generation.generationDir, {
      directoryByPackage: new Map(PERSONAL_PLUGINS.map(plugin => [plugin.packageName, plugin.directoryName])),
    })
    if (!result.ok) failures.push(...result.issues)
  }
}

await Promise.all(checks)

if (failures.length > 0) {
  for (const failure of failures) process.stderr.write('launch-gate: ' + failure + '\n')
  process.stderr.write('launch-gate: tree is not launch-ready; rebuild with the plugin build step and retry.\n')
  process.exit(1)
}
process.stdout.write('launch-gate: tree is launch-ready.\n')
