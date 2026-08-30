import { spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

const projectRoot = resolve(import.meta.dirname, '..')
const projectControlRelative = join('plugins', 'project-control')
const comparedArtifacts = [
  join('lib', 'index.js'),
  join('lib', 'client.js'),
  join('lib', 'client.js.map'),
]

function argument(name) {
  const index = process.argv.indexOf(name)
  if (index < 0) return undefined
  const value = process.argv[index + 1]
  if (value === undefined || value.startsWith('--')) throw new Error(`${name} requires a value.`)
  return value
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function assertRegisteredWorktree(path) {
  const result = spawnSync('git', ['worktree', 'list', '--porcelain'], {
    cwd: projectRoot,
    encoding: 'utf8',
    windowsHide: true,
  })
  if (result.status !== 0) throw new Error(result.stderr || 'Could not list Git worktrees.')
  const registered = result.stdout.split(/\r?\n/u)
    .filter(line => line.startsWith('worktree '))
    .map(line => resolve(line.slice('worktree '.length)))
  if (!registered.includes(path)) throw new Error(`Alternate path is not a registered worktree: ${path}`)
  if (path === projectRoot) throw new Error('Alternate worktree must differ from the canonical workspace.')
}

function runBuild(root) {
  const harnessRoot = realpathSync(join(root, 'harness-src'))
  const tsdown = join(harnessRoot, 'node_modules', 'tsdown', 'dist', 'run.mjs')
  if (!existsSync(tsdown)) throw new Error(`tsdown is missing from the Harness build root: ${tsdown}`)
  const pluginRoot = join(root, projectControlRelative)
  const result = spawnSync(process.execPath, [tsdown, '--config', 'tsdown.config.ts'], {
    cwd: pluginRoot,
    env: { ...process.env, NODE_ENV: process.env.NODE_ENV ?? 'production' },
    encoding: 'utf8',
    windowsHide: true,
  })
  if (result.status !== 0) {
    throw new Error(`Project Control build failed in ${root}.\n${result.stdout}${result.stderr}`)
  }
  return { stdout: result.stdout, stderr: result.stderr }
}

function packProjectControl(root, packDir) {
  mkdirSync(packDir, { recursive: true })
  const pluginRoot = join(root, projectControlRelative)
  const result = spawnSync('npm', ['pack', '--pack-destination', packDir, '--silent'], {
    cwd: pluginRoot,
    encoding: 'utf8',
    windowsHide: true,
    shell: process.platform === 'win32',
  })
  if (result.status !== 0) {
    throw new Error(`Project Control pack failed in ${root}.\n${result.stdout}${result.stderr}`)
  }
  const assetName = result.stdout.trim().split(/\r?\n/u).at(-1)
  const assetPath = assetName === undefined ? undefined : join(packDir, assetName)
  if (assetPath === undefined || !existsSync(assetPath)) {
    throw new Error(`Project Control pack did not produce an asset in ${packDir}.`)
  }
  return {
    assetName,
    sha256: sha256(assetPath),
    bytes: statSync(assetPath).size,
  }
}

function copyProjectControlSource(source, target) {
  cpSync(source, target, {
    recursive: true,
    filter(path) {
      const local = relative(source, path)
      if (local === '') return true
      const first = local.split(sep)[0]
      if (first === 'node_modules') return false
      return !comparedArtifacts.includes(local)
    },
  })
}

function copyBundledHostDependencies(targetNodeModules) {
  mkdirSync(targetNodeModules, { recursive: true })
  const sourceNodeModules = realpathSync(join(projectRoot, 'node_modules'))
  const projectRequire = createRequire(pathToFileURL(join(projectRoot, projectControlRelative, 'package.json')))
  const ajvManifest = projectRequire.resolve('ajv/package.json')
  const ajvRequire = createRequire(pathToFileURL(ajvManifest))
  const manifests = new Map([
    ['ajv', ajvManifest],
    ['ajv-formats', projectRequire.resolve('ajv-formats/package.json')],
    ['fast-deep-equal', ajvRequire.resolve('fast-deep-equal/package.json')],
    ['fast-uri', ajvRequire.resolve('fast-uri/package.json')],
    ['json-schema-traverse', ajvRequire.resolve('json-schema-traverse/package.json')],
  ])
  const targetPackages = new Map()
  for (const [name, manifest] of manifests) {
    const local = relative(sourceNodeModules, dirname(manifest))
    if (local.startsWith(`..${sep}`) || isAbsolute(local)) {
      throw new Error(`Dependency is outside the canonical node_modules: ${manifest}`)
    }
    const target = join(targetNodeModules, local)
    mkdirSync(dirname(target), { recursive: true })
    cpSync(dirname(manifest), target, { recursive: true })
    targetPackages.set(name, target)
  }
  for (const [name, manifest] of manifests) {
    const packageNodeModules = dirname(targetPackages.get(name))
    const packageJson = JSON.parse(readFileSync(manifest, 'utf8'))
    for (const dependency of Object.keys(packageJson.dependencies ?? {})) {
      const target = targetPackages.get(dependency)
      if (target === undefined) continue
      const link = join(packageNodeModules, dependency)
      if (!existsSync(link)) symlinkSync(target, link, 'junction')
    }
  }
  for (const name of ['ajv', 'ajv-formats']) {
    symlinkSync(targetPackages.get(name), join(targetNodeModules, name), 'junction')
  }
}

function assertOwnedTemporary(path, container, token) {
  const normalized = resolve(path)
  const local = relative(resolve(container), normalized)
  if (local === '' || local.startsWith(`..${sep}`) || isAbsolute(local)) {
    throw new Error(`Refusing to clean a path outside the task container: ${normalized}`)
  }
  const marker = join(normalized, '.task-owner.json')
  const parsed = JSON.parse(readFileSync(marker, 'utf8'))
  if (parsed.token !== token || parsed.task !== 'B-G4-LEGACY-DOCUMENT-BINDING-HASH-ACCEPTANCE-RC15-LOCAL-CANDIDATE') {
    throw new Error(`Task ownership marker mismatch: ${marker}`)
  }
}

const alternateValue = argument('--alternate-worktree')
if (alternateValue === undefined) {
  throw new Error('Usage: node scripts/verify-project-control-build-reproducibility.mjs --alternate-worktree <registered-worktree> [--receipt <new-json-path>]')
}
const alternateWorktree = resolve(alternateValue)
assertRegisteredWorktree(alternateWorktree)

const taskContainer = join(alternateWorktree, '.dsh-task-temp', 'b-g4-legacy-document-binding-hash-acceptance-rc15-local-candidate')
mkdirSync(taskContainer, { recursive: true })
const temporaryRoot = mkdtempSync(join(taskContainer, 'run-'))
const token = randomUUID()
writeFileSync(join(temporaryRoot, '.task-owner.json'), JSON.stringify({
  task: 'B-G4-LEGACY-DOCUMENT-BINDING-HASH-ACCEPTANCE-RC15-LOCAL-CANDIDATE',
  token,
}, null, 2), { encoding: 'utf8', flag: 'wx' })

try {
  const alternateBuildRoot = join(temporaryRoot, 'source')
  mkdirSync(join(alternateBuildRoot, 'plugins'), { recursive: true })
  copyProjectControlSource(
    join(projectRoot, projectControlRelative),
    join(alternateBuildRoot, projectControlRelative),
  )
  symlinkSync(realpathSync(join(projectRoot, 'harness-src')), join(alternateBuildRoot, 'harness-src'), 'junction')
  copyBundledHostDependencies(join(alternateBuildRoot, 'node_modules'))

  const canonicalBuild = runBuild(projectRoot)
  const alternateBuild = runBuild(alternateBuildRoot)
  const artifacts = comparedArtifacts.map((artifact) => {
    const canonicalPath = join(projectRoot, projectControlRelative, artifact)
    const alternatePath = join(alternateBuildRoot, projectControlRelative, artifact)
    const canonicalSha256 = sha256(canonicalPath)
    const alternateSha256 = sha256(alternatePath)
    if (canonicalSha256 !== alternateSha256) {
      throw new Error(`${artifact} differs by build path: ${canonicalSha256} != ${alternateSha256}`)
    }
    return {
      path: artifact.split(sep).join('/'),
      sha256: canonicalSha256,
      bytes: readFileSync(canonicalPath).byteLength,
    }
  })
  const client = readFileSync(join(projectRoot, projectControlRelative, 'lib', 'client.js'), 'utf8')
  for (const forbidden of [projectRoot, alternateBuildRoot]) {
    if (client.includes(forbidden) || client.includes(forbidden.split(sep).join('/'))) {
      throw new Error(`client.js embeds an absolute build root: ${forbidden}`)
    }
  }
  const candidatePackage = packProjectControl(projectRoot, join(temporaryRoot, 'candidate-pack'))
  const alternatePackage = packProjectControl(alternateBuildRoot, join(temporaryRoot, 'alternate-pack'))
  if (candidatePackage.assetName !== alternatePackage.assetName
    || candidatePackage.sha256 !== alternatePackage.sha256
    || candidatePackage.bytes !== alternatePackage.bytes) {
    throw new Error(`Project Control package differs by build path: ${JSON.stringify({ candidatePackage, alternatePackage })}`)
  }
  const result = {
    schemaVersion: 1,
    task: 'B-G4-LEGACY-DOCUMENT-BINDING-HASH-ACCEPTANCE-RC15-LOCAL-CANDIDATE',
    status: 'passed',
    checkedAt: new Date().toISOString(),
    canonicalWorkspace: alternateWorktree,
    candidateWorktree: projectRoot,
    canonicalTemporaryBuildRoot: alternateBuildRoot,
    artifacts,
    packageArtifact: candidatePackage,
    buildLogs: {
      canonicalStdoutBytes: Buffer.byteLength(canonicalBuild.stdout),
      canonicalStderrBytes: Buffer.byteLength(canonicalBuild.stderr),
      alternateStdoutBytes: Buffer.byteLength(alternateBuild.stdout),
      alternateStderrBytes: Buffer.byteLength(alternateBuild.stderr),
    },
  }
  const receiptValue = argument('--receipt')
  if (receiptValue !== undefined) {
    const receipt = resolve(receiptValue)
    mkdirSync(dirname(receipt), { recursive: true })
    writeFileSync(receipt, `${JSON.stringify(result, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
    result.receipt = receipt
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
} finally {
  assertOwnedTemporary(temporaryRoot, taskContainer, token)
  rmSync(temporaryRoot, { recursive: true, force: true })
  if (existsSync(taskContainer) && readdirSync(taskContainer).length === 0) {
    rmSync(taskContainer, { recursive: true, force: true })
  }
  const parent = dirname(taskContainer)
  if (existsSync(parent) && readdirSync(parent).length === 0) {
    rmSync(parent, { recursive: true, force: true })
  }
}
