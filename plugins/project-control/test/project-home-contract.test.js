import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import {
  createProjectHomeMarker,
  ProjectHomeContractError,
  validateProjectHomeIdentity,
  validateProjectHomeMarker,
} from '../src/project-home.ts'

const examplesRoot = fileURLToPath(new URL(
  '../../../protocol/project-control/v1alpha1/project-home/examples/',
  import.meta.url,
))

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

test('all indexed Project Home marker fixtures match their declared result', () => {
  const index = readJson(resolve(examplesRoot, 'index.json'))
  assert.equal(index.cases.length, 8)
  for (const example of index.cases) {
    const result = validateProjectHomeMarker(readJson(resolve(examplesRoot, example.fixture)))
    assert.equal(result.valid, example.expectedValid, example.name)
    if (!result.valid) {
      assert.equal(result.errors.some(error => error.keyword === example.expectedErrorKeyword), true, example.name)
    }
  }
})

test('Host creates the fixed three-zone marker without accepting caller paths', () => {
  const marker = createProjectHomeMarker({
    projectId: 'prj_0198f4b2-7c3a-7d11-a5c6-6b6f39e34711',
    slug: 'example-project',
    createdAt: '2026-08-25T05:30:00.000Z',
  })
  assert.deepEqual(marker.zones, { workspace: 'workspace', worktrees: 'worktrees', local: 'local' })
  assert.equal(validateProjectHomeMarker(marker).valid, true)
})

test('marker and workspace manifest must carry the same Project Control identity', () => {
  const marker = createProjectHomeMarker({
    projectId: 'prj_0198f4b2-7c3a-7d11-a5c6-6b6f39e34711',
    slug: 'example-project',
    createdAt: '2026-08-25T05:30:00.000Z',
  })
  assert.doesNotThrow(() => validateProjectHomeIdentity(marker, {
    metadata: { projectId: marker.projectId },
  }))
  assert.throws(
    () => validateProjectHomeIdentity(marker, {
      metadata: { projectId: 'prj_0198f4b2-7c3a-7d11-a5c6-6b6f39e34712' },
    }),
    error => error instanceof ProjectHomeContractError && error.code === 'PROJECT_ID_MISMATCH',
  )
})
