import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'

import { planGate, validateReceiptIntegrity } from '../src/upstream-gate-planner.js'

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const readJson = path => JSON.parse(readFileSync(resolve(repoRoot, path), 'utf8'))

function makeAjv() {
  const ajv = new Ajv2020({ allErrors: true, strict: true })
  addFormats(ajv)
  return ajv
}

test('dshComposable/v2 schema 接受合法 fixture、拒绝 v1 别名/缺字段', () => {
  const ajv = makeAjv()
  const validate = ajv.compile(readJson('protocol/personal-plugin-contract/v2/schemas/dsh-composable.schema.json'))
  assert.equal(validate(readJson('protocol/personal-plugin-contract/v2/examples/dsh-composable.valid.json')), true)
  assert.equal(validate(readJson('protocol/personal-plugin-contract/v2/examples/dsh-composable.invalid.json')), false)
})

test('harness-compat-receipt/v1 schema 接受合法 fixture、拒绝非法 fixture', () => {
  const ajv = makeAjv()
  const validate = ajv.compile(readJson('protocol/harness-compat-receipt/v1/schemas/harness-compat-receipt.schema.json'))
  assert.equal(validate(readJson('protocol/harness-compat-receipt/v1/examples/harness-compat-receipt.valid.json')), true)
  assert.equal(validate(readJson('protocol/harness-compat-receipt/v1/examples/harness-compat-receipt.invalid.json')), false)
})

test('upstream-impact-map/v1 schema 接受合法 fixture、拒绝非法 fixture', () => {
  const ajv = makeAjv()
  const validate = ajv.compile(readJson('protocol/upstream-impact-map/v1/schemas/upstream-impact-map.schema.json'))
  assert.equal(validate(readJson('protocol/upstream-impact-map/v1/examples/upstream-impact-map.valid.json')), true)
  assert.equal(validate(readJson('protocol/upstream-impact-map/v1/examples/upstream-impact-map.invalid.json')), false)
})

test('v1→v2 迁移规则文件存在且规则可机器消费', () => {
  const rules = readJson('protocol/personal-plugin-contract/v2/migration-rules.json')
  assert.equal(rules.schemaVersion, 1)
  assert.ok(Array.isArray(rules.rules) && rules.rules.length > 0)
  for (const rule of rules.rules) {
    assert.equal(typeof rule.from, 'string')
    assert.equal(typeof rule.to, 'string')
    assert.equal(typeof rule.action, 'string')
  }
})

test('planGate 对 G0/G1/G2/G3 正例给出预期计划', () => {
  const map = readJson('protocol/upstream-impact-map/v1/examples/upstream-impact-map.valid.json')
  assert.equal(planGate({ impactMap: map, changed: ['docs/README.md'] }).gateLevel, 'G0')
  assert.equal(planGate({ impactMap: map, changed: ['packages/client/src/runtime.ts'] }).gateLevel, 'G2')
  assert.equal(planGate({ impactMap: map, changed: ['dsh.profile.bundles'] }).gateLevel, 'G3')
  assert.equal(planGate({ impactMap: map, changed: ['packages/host/src/migrations/0001_x.sql'] }).gateLevel, 'G3')
})

test('planGate 对 unknown、缺 diff、缺 map 一律升级 G3', () => {
  const map = readJson('protocol/upstream-impact-map/v1/examples/upstream-impact-map.valid.json')
  assert.equal(planGate({ impactMap: map, changed: ['packages/unknown/path.js'] }).gateLevel, 'G3')
  assert.equal(planGate({ impactMap: map, changed: ['docs/README.md'], diffComplete: false }).gateLevel, 'G3')
  assert.equal(planGate({ impactMap: null, changed: ['docs/README.md'] }).gateLevel, 'G3')
  assert.equal(planGate({ impactMap: { ...map, mapVersion: 'unknown' }, changed: ['docs/README.md'] }).gateLevel, 'G3')
})

test('validateReceiptIntegrity 拒绝 skipped、伪造 reused、G3 缺锚点', () => {
  const base = readJson('protocol/harness-compat-receipt/v1/examples/harness-compat-receipt.valid.json')
  assert.equal(validateReceiptIntegrity(base).ok, true)
  const skipped = { ...base, evidence: [{ check: 'build', status: 'skipped' }] }
  assert.equal(validateReceiptIntegrity(skipped).ok, false)
  const fakeReused = { ...base, evidence: [{ check: 'build', status: 'reused:../bad' }] }
  assert.equal(validateReceiptIntegrity(fakeReused).ok, false)
  const missingAnchor = { ...base, gateLevel: 'G3', g3Anchor: { lastG3At: '2026-08-21T00:00:00.000Z' } }
  assert.equal(validateReceiptIntegrity(missingAnchor).ok, false)
})
