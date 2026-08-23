import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'

const protocolRoot = fileURLToPath(
  new URL('../protocol/project-control/v1alpha1/', import.meta.url),
)
const schemasRoot = resolve(protocolRoot, 'schemas')
const examplesRoot = resolve(protocolRoot, 'examples')

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
  return ajv
}

test('Project Protocol schemas compile strictly as a unique 2020-12 set', () => {
  const schemas = loadSchemas()
  assert.equal(schemas.length, 4)

  const ids = new Set()
  for (const { name, value } of schemas) {
    assert.equal(value.$schema, 'https://json-schema.org/draft/2020-12/schema', name)
    assert.equal(typeof value.$id, 'string', name)
    assert.ok(!ids.has(value.$id), `duplicate schema id: ${value.$id}`)
    ids.add(value.$id)
  }

  const ajv = createValidator(schemas)
  for (const { name, value } of schemas) {
    assert.equal(typeof ajv.getSchema(value.$id), 'function', name)
  }
})

test('the indexed protocol examples match their declared validation outcome', () => {
  const schemas = loadSchemas()
  const ajv = createValidator(schemas)
  const indexPath = resolve(examplesRoot, 'index.json')
  const index = readJson(indexPath)

  assert.equal(index.cases.length, 8)
  for (const example of index.cases) {
    const schemaPath = resolve(dirname(indexPath), example.schema)
    const fixturePath = resolve(dirname(indexPath), example.fixture)
    const schema = readJson(schemaPath)
    const fixture = readJson(fixturePath)
    const validate = ajv.getSchema(schema.$id)

    assert.equal(typeof validate, 'function', example.name)
    const actualValid = validate(fixture)
    assert.equal(actualValid, example.expectedValid, `${example.name}: ${ajv.errorsText(validate.errors)}`)

    if (example.expectedValid) {
      assert.equal(example.expectedErrorKeyword, null, example.name)
      assert.equal(validate.errors, null, example.name)
    } else {
      assert.ok(
        validate.errors?.some(error => error.keyword === example.expectedErrorKeyword),
        `${example.name}: expected ${example.expectedErrorKeyword}; got ${ajv.errorsText(validate.errors)}`,
      )
    }
  }
})

test('the frozen v1alpha1 examples preserve fact ownership and canonical IDs', () => {
  const manifest = readJson(resolve(examplesRoot, 'project-manifest.valid.json'))
  const command = readJson(resolve(examplesRoot, 'command-envelope.valid.json'))
  const event = readJson(resolve(examplesRoot, 'normalized-event.valid.json'))

  assert.equal(manifest.apiVersion, 'project-control.dsh/v1alpha1')
  assert.equal(command.protocolVersion, 'project-control.dsh/v1alpha1')
  assert.equal(event.protocolVersion, 'project-control.dsh/v1alpha1')

  assert.equal('summary' in manifest.spec, false)
  assert.equal('goal' in manifest.spec, false)
  assert.equal('successCriteria' in manifest.spec, false)

  const uuidV7 = '[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'
  assert.match(manifest.metadata.projectId, new RegExp(`^prj_${uuidV7}$`))
  assert.match(command.target.workItemId, new RegExp(`^wrk_${uuidV7}$`))
  assert.match(command.target.runId, new RegExp(`^run_${uuidV7}$`))

  for (const entry of manifest.spec.documents.entries) {
    assert.equal(entry.path.includes('\\'), false)
    assert.equal(entry.path.startsWith('/'), false)
    assert.equal(/^[A-Za-z]:/.test(entry.path), false)
    assert.equal(entry.path.split('/').includes('..'), false)
  }
})

test('the schemas reject fact duplication, unsafe paths, and mismatched runtime updates', () => {
  const schemas = loadSchemas()
  const ajv = createValidator(schemas)
  const manifestSchema = schemas.find(({ name }) => name === 'project-manifest.schema.json').value
  const commandSchema = schemas.find(({ name }) => name === 'command-envelope.schema.json').value
  const validateManifest = ajv.getSchema(manifestSchema.$id)
  const validateCommand = ajv.getSchema(commandSchema.$id)
  const validManifest = readJson(resolve(examplesRoot, 'project-manifest.valid.json'))
  const validCommand = readJson(resolve(examplesRoot, 'command-envelope.valid.json'))

  function assertRejected(validate, candidate, expectedKeyword) {
    assert.equal(validate(candidate), false)
    assert.ok(
      validate.errors?.some(error => error.keyword === expectedKeyword),
      `expected ${expectedKeyword}; got ${ajv.errorsText(validate.errors)}`,
    )
  }

  const duplicatePrdFact = structuredClone(validManifest)
  duplicatePrdFact.spec.goal = 'This belongs in the bound PRD.'
  assertRejected(validateManifest, duplicatePrdFact, 'additionalProperties')

  for (const unsafePath of ['../README.md', './README.md', 'docs/file.txt:secret', 'docs/line\nbreak.md']) {
    const escapedPath = structuredClone(validManifest)
    escapedPath.spec.documents.entries[0].path = unsafePath
    assertRejected(validateManifest, escapedPath, 'pattern')
  }

  const incompleteTemplateOrigin = structuredClone(validManifest)
  delete incompleteTemplateOrigin.metadata.origin.templateVersion
  assertRejected(validateManifest, incompleteTemplateOrigin, 'required')

  const mismatchedAggregate = structuredClone(validCommand)
  mismatchedAggregate.target.aggregateId = mismatchedAggregate.target.workItemId
  assertRejected(validateCommand, mismatchedAggregate, 'pattern')

  const obsoleteWorkItemPrefix = structuredClone(validCommand)
  obsoleteWorkItemPrefix.target.workItemId = obsoleteWorkItemPrefix.target.workItemId.replace('wrk_', 'wi_')
  assertRejected(validateCommand, obsoleteWorkItemPrefix, 'pattern')

  const mismatchedPayload = structuredClone(validCommand)
  mismatchedPayload.kind = 'blocker.raise'
  assertRejected(validateCommand, mismatchedPayload, 'required')

  const unsupportedVersion = structuredClone(validCommand)
  unsupportedVersion.protocolVersion = 'project-control.dsh/v2'
  assertRejected(validateCommand, unsupportedVersion, 'const')

  const impossibleTimestamp = structuredClone(validCommand)
  impossibleTimestamp.occurredAt = '2026-02-31T12:00:00.000Z'
  assertRejected(validateCommand, impossibleTimestamp, 'format')

  const noCorrelation = structuredClone(validCommand)
  delete noCorrelation.correlationId
  assertRejected(validateCommand, noCorrelation, 'required')

  const unversionedProducer = structuredClone(validCommand)
  delete unversionedProducer.provenance.applicationVersion
  assertRejected(validateCommand, unversionedProducer, 'required')

  const unnamespacedExtension = structuredClone(validCommand)
  unnamespacedExtension.extensions = { debug: true }
  assertRejected(validateCommand, unnamespacedExtension, 'pattern')

  const evidenceFreeCompletion = structuredClone(validCommand)
  evidenceFreeCompletion.kind = 'completion.declare'
  evidenceFreeCompletion.payload = {
    summary: 'Claimed done',
    acceptanceClaims: ['All acceptance checks pass'],
    evidence: [],
  }
  assertRejected(validateCommand, evidenceFreeCompletion, 'minItems')
})
