import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'

const protocolRoot = fileURLToPath(
  new URL('../protocol/project-control/v1alpha1/', import.meta.url),
)
const lifecycleRoot = resolve(protocolRoot, 'lifecycle')
const schemasRoot = resolve(lifecycleRoot, 'schemas')
const examplesRoot = resolve(lifecycleRoot, 'examples')

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function loadSchemas() {
  return readdirSync(schemasRoot)
    .filter(name => name.endsWith('.schema.json'))
    .sort()
    .map(name => ({ name, value: readJson(resolve(schemasRoot, name)) }))
}

function createValidator(schemas) {
  const ajv = new Ajv2020({ allErrors: true, strict: true })
  addFormats(ajv)
  for (const { value } of schemas) ajv.addSchema(value)
  for (const { value } of schemas) ajv.getSchema(value.$id)
  return ajv
}

function fixture(name) {
  return readJson(resolve(examplesRoot, name))
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(Object.is(value, -0) ? 0 : value)
}

function assertRejected(validate, candidate, expectedKeyword) {
  assert.equal(validate(candidate), false)
  assert.ok(
    validate.errors?.some(error => error.keyword === expectedKeyword),
    `expected ${expectedKeyword}; got ${JSON.stringify(validate.errors)}`,
  )
}

test('Gate 2B lifecycle schemas compile strictly as a unique 2020-12 set', () => {
  const schemas = loadSchemas()
  assert.equal(schemas.length, 3)

  const ids = new Set()
  for (const { name, value } of schemas) {
    assert.equal(value.$schema, 'https://json-schema.org/draft/2020-12/schema', name)
    assert.equal(typeof value.$id, 'string', name)
    assert.ok(!ids.has(value.$id), `duplicate schema id: ${value.$id}`)
    ids.add(value.$id)
  }

  createValidator(schemas)
})

test('all indexed lifecycle fixtures match their declared validation outcome', () => {
  const schemas = loadSchemas()
  const ajv = createValidator(schemas)
  const indexPath = resolve(examplesRoot, 'index.json')
  const index = readJson(indexPath)

  assert.equal(index.cases.length, 19)
  for (const example of index.cases) {
    const schema = readJson(resolve(dirname(indexPath), example.schema))
    const value = readJson(resolve(dirname(indexPath), example.fixture))
    const validate = ajv.getSchema(schema.$id)

    assert.equal(typeof validate, 'function', example.name)
    const actualValid = validate(value)
    assert.equal(actualValid, example.expectedValid, `${example.name}: ${ajv.errorsText(validate.errors)}`)
    if (actualValid) {
      assert.equal(example.expectedErrorKeyword, null, example.name)
    } else {
      assert.ok(
        validate.errors?.some(error => error.keyword === example.expectedErrorKeyword),
        `${example.name}: expected ${example.expectedErrorKeyword}; got ${ajv.errorsText(validate.errors)}`,
      )
    }
  }
})

test('the five lifecycle commands have fixed create/update revision semantics', () => {
  const schemas = loadSchemas()
  const ajv = createValidator(schemas)
  const commandSchema = schemas.find(({ name }) => name === 'lifecycle-command-envelope.schema.json').value
  const validate = ajv.getSchema(commandSchema.$id)
  const commands = [
    fixture('command-register-legacy.valid.json'),
    fixture('command-register-managed.valid.json'),
    fixture('command-create-template.valid.json'),
    fixture('command-rebind-location.valid.json'),
    fixture('command-upgrade-managed.valid.json'),
  ]

  assert.deepEqual(
    new Set(commands.map(command => command.kind)),
    new Set([
      'project.registerLegacy',
      'project.registerManaged',
      'project.createFromTemplate',
      'project.rebindLocation',
      'project.upgradeManaged',
    ]),
  )

  for (const command of commands.slice(0, 3)) {
    const staleCreate = structuredClone(command)
    staleCreate.expectedRevision = 1
    assertRejected(validate, staleCreate, 'const')
  }

  for (const command of commands.slice(3)) {
    const missingAggregate = structuredClone(command)
    missingAggregate.expectedRevision = 0
    assertRejected(validate, missingAggregate, 'minimum')
  }

  const mismatchedRebind = structuredClone(commands[3])
  mismatchedRebind.payload.expectedMode = 'linked_legacy'
  assertRejected(validate, mismatchedRebind, 'required')
})

test('lifecycle DTOs accept only Host-issued location references and canonical hashes', () => {
  const schemas = loadSchemas()
  const ajv = createValidator(schemas)
  const commandSchema = schemas.find(({ name }) => name === 'lifecycle-command-envelope.schema.json').value
  const validate = ajv.getSchema(commandSchema.$id)
  const legacy = fixture('command-register-legacy.valid.json')
  const create = fixture('command-create-template.valid.json')
  const managed = fixture('command-register-managed.valid.json')

  for (const unsafeRef of ['D:\\Projects\\unsafe', '\\\\server\\share\\unsafe', '/var/tmp/unsafe']) {
    const unsafeLocation = structuredClone(legacy)
    unsafeLocation.payload.locationRef = unsafeRef
    assertRejected(validate, unsafeLocation, 'pattern')

    const unsafeRoot = structuredClone(create)
    unsafeRoot.payload.sourceRootRef = unsafeRef
    assertRejected(validate, unsafeRoot, 'pattern')
  }

  const unsafeProvenance = structuredClone(legacy)
  unsafeProvenance.provenance.sourceId = 'D:/Projects/unsafe'
  assertRejected(validate, unsafeProvenance, 'pattern')

  const invalidManifestHash = structuredClone(managed)
  invalidManifestHash.payload.manifestHash = 'sha256:not-a-digest'
  assertRejected(validate, invalidManifestHash, 'pattern')

  const unsafePlanPath = structuredClone(create)
  unsafePlanPath.payload.writePlan.operations[0].relativePath = '../escape'
  assertRejected(validate, unsafePlanPath, 'pattern')

  const unnamespacedExtension = structuredClone(legacy)
  unnamespacedExtension.extensions = { debug: true }
  assertRejected(validate, unnamespacedExtension, 'pattern')

  const unknownCoreField = structuredClone(legacy)
  unknownCoreField.payload.absolutePath = 'D:\\Projects\\unsafe'
  assertRejected(validate, unknownCoreField, 'additionalProperties')

  for (const planned of [create, fixture('command-upgrade-managed.valid.json')]) {
    const { manifestHash, operations, planHash, syncPolicy } = planned.payload.writePlan
    const canonicalPlan = canonicalJson({ manifestHash, syncPolicy, operations })
    const calculated = `sha256:${createHash('sha256').update(canonicalPlan, 'utf8').digest('hex')}`
    assert.equal(planHash, calculated, planned.kind)
  }
})

test('accepted create and upgrade outputs prove committed sync before state advances', () => {
  const schemas = loadSchemas()
  const ajv = createValidator(schemas)
  const resultSchema = schemas.find(({ name }) => name === 'lifecycle-command-result.schema.json').value
  const eventSchema = schemas.find(({ name }) => name === 'lifecycle-normalized-event.schema.json').value
  const validateResult = ajv.getSchema(resultSchema.$id)
  const validateEvent = ajv.getSchema(eventSchema.$id)

  const acceptedResults = [
    fixture('result-create-template.valid.json'),
    fixture('result-upgrade-managed.valid.json'),
  ]
  for (const result of acceptedResults) {
    assert.equal(result.fileSync.status, 'committed')
    const uncommitted = structuredClone(result)
    uncommitted.fileSync.status = 'planned'
    assertRejected(validateResult, uncommitted, 'const')
  }

  const committedTriples = [
    [
      fixture('command-create-template.valid.json'),
      fixture('result-create-template.valid.json'),
      fixture('event-create-template.valid.json'),
    ],
    [
      fixture('command-upgrade-managed.valid.json'),
      fixture('result-upgrade-managed.valid.json'),
      fixture('event-upgrade-managed.valid.json'),
    ],
  ]
  for (const [command, result, event] of committedTriples) {
    assert.equal(result.commandId, command.commandId)
    assert.equal(event.causation.commandId, command.commandId)
    assert.equal(result.correlationId, command.correlationId)
    assert.equal(event.causation.correlationId, command.correlationId)
    assert.equal(result.fileSync.planHash, command.payload.writePlan.planHash)
    assert.equal(event.data.fileSync.planHash, command.payload.writePlan.planHash)
    assert.equal(result.fileSync.manifestHash, command.payload.writePlan.manifestHash)
    assert.equal(event.data.manifestHash, command.payload.writePlan.manifestHash)
  }

  const capabilityRejected = fixture('result-create-capability-rejected.valid.json')
  assert.equal(validateResult(capabilityRejected), true)
  assert.equal(capabilityRejected.status, 'rejected')
  assert.equal(capabilityRejected.error.code, 'CAPABILITY_NOT_NEGOTIATED')
  assert.equal(capabilityRejected.fileSync.status, 'planned')

  const capabilityRejectedWithoutPlan = structuredClone(capabilityRejected)
  delete capabilityRejectedWithoutPlan.fileSync
  assertRejected(validateResult, capabilityRejectedWithoutPlan, 'required')

  const nonWriteWithFileSync = structuredClone(capabilityRejected)
  nonWriteWithFileSync.kind = 'project.registerLegacy'
  assertRejected(validateResult, nonWriteWithFileSync, 'not')

  const eventFiles = [
    'event-register-legacy.valid.json',
    'event-register-managed.valid.json',
    'event-create-template.valid.json',
    'event-rebind-location.valid.json',
    'event-upgrade-managed.valid.json',
  ]
  for (const eventFile of eventFiles) {
    const event = fixture(eventFile)
    assert.equal(validateEvent(event), true, eventFile)
    assert.equal(event.afterRevision, event.beforeRevision + 1, eventFile)
    assert.equal(event.causation.correlationId.startsWith('corr.lifecycle.'), true, eventFile)
  }
})

test('lifecycle commands remain disjoint from the three external runtime updates', () => {
  const lifecycleSchema = readJson(resolve(schemasRoot, 'lifecycle-command-envelope.schema.json'))
  const runtimeSchema = readJson(resolve(protocolRoot, 'schemas', 'command-envelope.schema.json'))
  const lifecycleKinds = lifecycleSchema.properties.kind.enum
  const runtimeKinds = runtimeSchema.properties.kind.enum

  assert.deepEqual(runtimeKinds, ['progress.report', 'blocker.raise', 'completion.declare'])
  assert.equal(lifecycleKinds.length, 5)
  assert.deepEqual(lifecycleKinds.filter(kind => runtimeKinds.includes(kind)), [])
})
