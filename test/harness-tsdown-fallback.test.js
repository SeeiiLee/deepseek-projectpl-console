import assert from 'node:assert/strict'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'

import { applyHarnessTsdownFallback, assertManagedRuntimeRoot, patchWorkspaceManifestText } from '../scripts/apply-harness-tsdown-fallback.mjs'
import { resolveBuildRoot } from '../scripts/build-kit.mjs'

// A representative upstream block from rc.2 tsdown.client.ts.
const ORIGINAL = `function workspaceManifest(id: string): WorkspaceManifest {
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

test('tsdown fallback patch adds plugin-local package.json lookup and is idempotent', () => {
  const first = patchWorkspaceManifestText(ORIGINAL)
  assert.equal(first.ok, true)
  assert.equal(first.alreadyPatched, false)
  assert.match(first.text, /@cyrus\/dsh-personal-fallback/u)
  assert.match(first.text, /resolvePath\(process\.cwd\(\), 'package\.json'\)/u)

  const second = patchWorkspaceManifestText(first.text)
  assert.equal(second.ok, true)
  assert.equal(second.alreadyPatched, true)
  assert.equal(second.text, first.text)
})

test('tsdown fallback patch fails closed on an unknown upstream file', () => {
  const result = patchWorkspaceManifestText('function totallyDifferent() { return 1 }')
  assert.equal(result.ok, false)
  assert.ok(result.issues.some(issue => /workspaceManifest/u.test(issue)))
})

test('managed runtime fallback is already applied and idempotent', () => {
  const result = applyHarnessTsdownFallback()
  assert.equal(result.patched, false)
  assert.match(result.path, /harness-runtimes[\\/][0-9a-f]{40}[\\/]packages[\\/]client[\\/]tsdown\.client\.ts$/u)
  assert.match(result.sha256, /^[0-9a-f]{64}$/u)
})

test('managed runtime path guard accepts only the Personal Dev managed runtime', () => {
  assert.doesNotThrow(() => assertManagedRuntimeRoot(resolveBuildRoot()))
})

test('managed runtime path guard rejects D:\\Deepseek Harness', () => {
  assert.throws(() => assertManagedRuntimeRoot('D:\\Deepseek Harness'), /read-only upstream/u)
})

test('managed runtime path guard is anchored to APPDATA and ignores DSH_SOURCE_ROOT', () => {
  const realRoot = resolveBuildRoot()
  const previousSourceRoot = process.env.DSH_SOURCE_ROOT
  process.env.DSH_SOURCE_ROOT = 'C:\\Fake\\Checkout'
  try {
    // The real Dev managed runtime must still be accepted even when
    // DSH_SOURCE_ROOT points elsewhere.
    assert.doesNotThrow(() => assertManagedRuntimeRoot(realRoot))
    // A look-alike under the fake DSH_SOURCE_ROOT must be rejected.
    assert.throws(
      () => assertManagedRuntimeRoot('C:\\Fake\\Checkout\\harness-runtimes\\b150a551b8d465e31e418e1b2eaf5e79bbb7d28e'),
      /non-Personal-Dev managed runtime/u,
    )
  } finally {
    if (previousSourceRoot === undefined) delete process.env.DSH_SOURCE_ROOT
    else process.env.DSH_SOURCE_ROOT = previousSourceRoot
  }
})

test('managed runtime path guard rejects a fake path merely containing harness-runtimes', () => {
  assert.throws(
    () => assertManagedRuntimeRoot('C:\\Temp\\fake\\harness-runtimes\\b150a551b8d465e31e418e1b2eaf5e79bbb7d28e'),
    /non-Personal-Dev managed runtime/u,
  )
})

test('managed runtime path guard rejects a stable managed runtime path', () => {
  assert.throws(
    () => assertManagedRuntimeRoot('C:\\Users\\me\\AppData\\Roaming\\DeepSeek Harness Personal\\harness-runtimes\\b150a551b8d465e31e418e1b2eaf5e79bbb7d28e'),
    /non-Personal-Dev managed runtime/u,
  )
})

test('managed runtime path guard rejects a same-named Dev tree under another root', () => {
  const fakeRoot = join(tmpdir(), 'DeepSeek Harness Personal Dev', 'harness-runtimes', 'b150a551b8d465e31e418e1b2eaf5e79bbb7d28e')
  assert.throws(
    () => assertManagedRuntimeRoot(fakeRoot),
    /non-Personal-Dev managed runtime/u,
  )
})

test('managed runtime path guard rejects a Dev runtime without a 40-hex commit segment', () => {
  const expectedRuntimesRoot = dirname(resolveBuildRoot())
  assert.throws(
    () => assertManagedRuntimeRoot(join(expectedRuntimesRoot, 'not-a-commit')),
    /40-hex commit/u,
  )
})
