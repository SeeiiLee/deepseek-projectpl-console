// scripts/apply-harness-tsdown-fallback.mjs
// ADR-005 boundary: D:\Deepseek Harness is read-only. This script applies a
// minimal fallback only to the Personal Dev managed runtime copy under
// AppData\DeepSeek Harness Personal Dev\harness-runtimes\<commit>.
//
// The fallback lets tsdown.client.ts resolve a Personal plugin's own
// package.json when the plugin is not a member of the upstream workspace.
// It is repeatable, hash-verified, and fails closed if the target file is not
// exactly the expected upstream rc.2 file (no blind patching).
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gitCommit, resolveBuildRoot } from './build-kit.mjs'

const EXPECTED_HARNESS_COMMIT = 'b150a551b8d465e31e418e1b2eaf5e79bbb7d28e'
const TSDOWN_RELATIVE = join('packages', 'client', 'tsdown.client.ts')
const ORIGINAL_SHA256 = '93dc6227bb6545e0fbd49f726379484073443da52ceabb40dcab3224e384392e'
// Populated after the first successful patch; used for idempotent re-runs.
const PATCHED_SHA256 = '76620022edd5255873eaf0c00056aff7997758b4638461f29c9649473aecce19'

const FALLBACK_MARKER = '// @cyrus/dsh-personal-fallback: read plugin-local package.json'

const OLD_BLOCK = `function workspaceManifest(id: string): WorkspaceManifest {
  const cached = manifestCache.get(id)
  if (cached !== undefined) return cached
  for (const manifestPath of globSync('packages/*/*/package.json', { cwd: REPOSITORY_ROOT })) {
    const manifest = JSON.parse(
      readFileSync(resolvePath(REPOSITORY_ROOT, manifestPath), 'utf8'),
    ) as WorkspaceManifest
    if (manifest.name !== id) continue
    manifestCache.set(id, manifest)
    return manifest
  }
  throw new Error(\`tsdown: no packages/*/*/package.json declares the name \${id}\`)
}`

const NEW_BLOCK = `function workspaceManifest(id: string): WorkspaceManifest {
  const cached = manifestCache.get(id)
  if (cached !== undefined) return cached
  for (const manifestPath of globSync('packages/*/*/package.json', { cwd: REPOSITORY_ROOT })) {
    const manifest = JSON.parse(
      readFileSync(resolvePath(REPOSITORY_ROOT, manifestPath), 'utf8'),
    ) as WorkspaceManifest
    if (manifest.name !== id) continue
    manifestCache.set(id, manifest)
    return manifest
  }
  ${FALLBACK_MARKER}
  const localManifestPath = resolvePath(process.cwd(), 'package.json')
  if (existsSync(localManifestPath)) {
    const manifest = JSON.parse(
      readFileSync(localManifestPath, 'utf8'),
    ) as WorkspaceManifest
    if (manifest.name === id) {
      manifestCache.set(id, manifest)
      return manifest
    }
  }
  throw new Error(\`tsdown: no packages/*/*/package.json declares the name \${id}\`)
}`

function sha256Text(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/**
 * Pure patch operation for tsdown.client.ts text. Exported for regression
 * tests; never touches the filesystem.
 * @returns {{ ok: true, text: string, alreadyPatched: boolean } | { ok: false, issues: string[] }}
 */
export function patchWorkspaceManifestText(original) {
  if (original.includes(FALLBACK_MARKER)) {
    return { ok: true, text: original, alreadyPatched: true }
  }
  if (!original.includes(OLD_BLOCK)) {
    return { ok: false, issues: ['tsdown.client.ts does not contain the expected workspaceManifest block'] }
  }
  const patched = original.replace(OLD_BLOCK, NEW_BLOCK)
  if (patched === original || !patched.includes(FALLBACK_MARKER)) {
    return { ok: false, issues: ['Patch replacement did not apply cleanly'] }
  }
  return { ok: true, text: patched, alreadyPatched: false }
}

export function assertManagedRuntimeRoot(root) {
  if (typeof root !== 'string' || root === '' || !isAbsolute(root)) {
    throw new Error('Harness build root must be an absolute path.')
  }
  const normalized = resolve(root)
  const protectedUpstream = resolve('D:\\Deepseek Harness')
  const upstreamRel = relative(protectedUpstream, normalized)
  if (upstreamRel === '' || (!upstreamRel.startsWith('..') && !isAbsolute(upstreamRel))) {
    throw new Error(`Refusing to patch read-only upstream: ${normalized}`)
  }

  // Independent trusted anchor: the real Personal Dev userData under %APPDATA%.
  // This must NOT be derived from DSH_SOURCE_ROOT/resolveBuildRoot(), otherwise
  // an attacker-controlled DSH_SOURCE_ROOT could point at a look-alike checkout.
  const appData = process.env.APPDATA
  if (typeof appData !== 'string' || appData.trim() === '') {
    throw new Error('APPDATA is not set; cannot anchor the Personal Dev managed runtime.')
  }
  const expectedRuntimesRoot = resolve(join(appData, 'DeepSeek Harness Personal Dev', 'harness-runtimes'))
  if (dirname(normalized) !== expectedRuntimesRoot) {
    throw new Error(`Refusing to patch a non-Personal-Dev managed runtime path: ${normalized}`)
  }
  const commitSegment = basename(normalized)
  if (!/^[0-9a-f]{40}$/iu.test(commitSegment)) {
    throw new Error(`Managed runtime path must be a 40-hex commit under harness-runtimes: ${normalized}`)
  }

  const packagePath = join(normalized, 'package.json')
  if (!existsSync(packagePath)) throw new Error(`Managed runtime missing package.json: ${packagePath}`)
  const manifest = JSON.parse(readFileSync(packagePath, 'utf8'))
  if (manifest.version !== '0.1.1-rc.2') {
    throw new Error(`Managed runtime version ${manifest.version} != 0.1.1-rc.2; refusing to patch.`)
  }
  const gitHead = gitCommit(normalized)
  if (gitHead !== EXPECTED_HARNESS_COMMIT) {
    throw new Error(`Managed runtime HEAD ${gitHead ?? 'unknown'} != ${EXPECTED_HARNESS_COMMIT}; refusing to patch.`)
  }
}

/**
 * Apply the tsdown.client.ts fallback to the managed Personal Dev runtime.
 * @returns {{ patched: boolean, path: string, sha256: string }}
 */
export function applyHarnessTsdownFallback({ root = resolveBuildRoot() } = {}) {
  assertManagedRuntimeRoot(root)
  const target = join(root, TSDOWN_RELATIVE)
  if (!existsSync(target)) throw new Error(`tsdown.client.ts not found: ${target}`)
  const original = readFileSync(target, 'utf8')
  const currentHash = sha256Text(original)

  if (currentHash === PATCHED_SHA256) {
    return { patched: false, path: target, sha256: currentHash }
  }
  if (currentHash !== ORIGINAL_SHA256) {
    throw new Error(
      `tsdown.client.ts hash mismatch: expected ${ORIGINAL_SHA256}, got ${currentHash}. `
      + 'Refusing to blind-patch an unknown upstream file.',
    )
  }
  if (!original.includes(OLD_BLOCK)) {
    throw new Error('tsdown.client.ts does not contain the expected workspaceManifest block; refusing to patch.')
  }
  const patched = original.replace(OLD_BLOCK, NEW_BLOCK)
  if (patched === original || !patched.includes(FALLBACK_MARKER)) {
    throw new Error('Patch replacement did not apply cleanly; no file was written.')
  }
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(temporary, patched, { encoding: 'utf8', flag: 'wx' })
  try {
    renameSync(temporary, target)
  } catch (error) {
    try { readFileSync(temporary) } catch { /* noop */ }
    throw error
  }
  const newHash = sha256Text(readFileSync(target, 'utf8'))
  return { patched: true, path: target, sha256: newHash }
}

// CLI
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = applyHarnessTsdownFallback()
    process.stdout.write(`${result.patched ? 'patched' : 'already-patched'} ${result.path}\nsha256=${result.sha256}\n`)
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exit(1)
  }
}
