import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const script = fileURLToPath(new URL('../scripts/preflight-publish.js', import.meta.url))

function makeTree() {
  const root = mkdtempSync(join(tmpdir(), 'dsh-preflight-'))
  mkdirSync(join(root, 'src'), { recursive: true })
  mkdirSync(join(root, 'docs'), { recursive: true })
  writeFileSync(join(root, 'src', 'main.js'), 'export const ok = 1\\n')
  writeFileSync(join(root, 'docs', 'notes.md'), 'clean notes\\n')
  return root
}

function runPreflight(root) {
  return spawnSync(process.execPath, [script], {
    env: { ...process.env, DSH_PREFLIGHT_PROJECT_ROOT: root },
    encoding: 'utf8',
  })
}

test('a clean tree passes the publish preflight', () => {
  const root = makeTree()
  const result = runPreflight(root)
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /zero secrets/u)
  rmSync(root, { recursive: true, force: true })
})

test('credential-shaped content in shipped files blocks the publish', () => {
  const root = makeTree()
  const fakePat = ['github_pat_', '11A7TL7IQ0mDTno0RX96Ip_H7AaarSjJN6v3LEbohkDzIUQTtQTMMAkh8GCYMIH5Ez4U7MQBRM4rvMxFkb'].join('')
  writeFileSync(join(root, 'src', 'leak.js'), `const t = '${fakePat}'\n`)
  const result = runPreflight(root)
  assert.equal(result.status, 1)
  assert.match(result.stderr, /BLOCKED/u)
  assert.match(result.stderr, /leak\.js/u)
  rmSync(root, { recursive: true, force: true })
})

test('database and key files inside the shipped tree block the publish', () => {
  const root = makeTree()
  writeFileSync(join(root, 'src', 'profiles.sqlite3'), 'sqlite-format')
  writeFileSync(join(root, 'src', 'key.txt'), 'key-material')
  const result = runPreflight(root)
  assert.equal(result.status, 1)
  assert.match(result.stderr, /profiles\.sqlite3/u)
  assert.match(result.stderr, /key\.txt/u)
  rmSync(root, { recursive: true, force: true })
})

test('personal paths in docs are reported, not blocked, and tokens in docs are ignored', () => {
  const root = makeTree()
  writeFileSync(join(root, 'docs', 'notes.md'), 'F:\\QClawData\\workspace ref\\n')
  const result = runPreflight(root)
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /notes\.md references personal data path/u)
  rmSync(root, { recursive: true, force: true })
})
