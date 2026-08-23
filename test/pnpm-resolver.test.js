import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveVendoredPnpm } from '../src/pnpm-resolver.js'

test('resolveVendoredPnpm finds the vendored pnpm shipped with the app', () => {
  const result = resolveVendoredPnpm({ ...process.env, DSH_PNPM_CJS: undefined, DSH_NODE_EXECUTABLE: process.env.DSH_NODE_EXECUTABLE })
  assert.ok(result, 'expected vendored pnpm to be found')
  assert.match(result.pnpmCjs, /vendor[\\/]pnpm[\\/]bin[\\/]pnpm\.cjs$/u)
  assert.match(result.nodeExecutable, /node(\.exe)?$/u)
})

test('resolveVendoredPnpm honors DSH_PNPM_CJS override', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-pnpm-'))
  const fake = join(dir, 'custom-pnpm.cjs')
  writeFileSync(fake, '// fake\n')
  const result = resolveVendoredPnpm({ ...process.env, DSH_PNPM_CJS: fake })
  assert.equal(result.pnpmCjs, fake)
})

test('resolveVendoredPnpm falls through a missing override to the vendored copy', () => {
  const result = resolveVendoredPnpm({ ...process.env, DSH_PNPM_CJS: join(tmpdir(), 'does-not-exist-pnpm.cjs') })
  assert.ok(result, 'expected fallback to vendored pnpm')
  assert.match(result.pnpmCjs, /vendor[\\/]pnpm[\\/]bin[\\/]pnpm\.cjs$/u)
})
