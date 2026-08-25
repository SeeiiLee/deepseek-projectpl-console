import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { CANONICAL_PATH, TOOLBOX_PROJECT_HOME, TOOLBOX_PROJECT_ID, projectGlobalAgents, validateCanonicalGlobalAgentsSource } from '../scripts/project-global-agents.js'

test('Global AGENTS authority resolves only through the Toolbox Project Home identity', () => {
  const result = validateCanonicalGlobalAgentsSource()
  assert.equal(TOOLBOX_PROJECT_HOME, 'F:\\Projects\\toolbox')
  assert.equal(result.projectId, TOOLBOX_PROJECT_ID)
  assert.equal(result.canonicalPath, CANONICAL_PATH)
  assert.match(readFileSync(CANONICAL_PATH, 'utf8'), /跨 Harness 全局工作规则/u)
})

test('legacy direct projection entry fails closed in favor of plan and receipt', () => {
  assert.throws(() => projectGlobalAgents(), /TOOLBOX_PROJECTION_REQUIRED/u)
})
