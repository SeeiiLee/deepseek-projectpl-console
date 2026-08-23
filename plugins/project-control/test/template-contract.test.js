import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'

import { parseYamlSubset } from '../src/discovery/runtime.js'
import { canonicalJson } from '../src/host/canonical-json.js'

const templatesRoot = fileURLToPath(
  new URL('../../../protocol/project-control/v1alpha1/templates/', import.meta.url),
)
const protocolSchemasRoot = resolve(templatesRoot, '../schemas')
const schemaPath = resolve(templatesRoot, 'schemas/template-manifest.schema.json')
const examplesRoot = resolve(templatesRoot, 'examples')
const indexPath = resolve(examplesRoot, 'index.json')

const PLACEHOLDERS = ['{{PROJECT_ID}}', '{{PROJECT_NAME}}', '{{CREATED_AT}}', '{{TEMPLATE_ID}}', '{{TEMPLATE_VERSION}}']
const PROJECT_MANIFEST_PATH = '.dsh-project/project.yaml'

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function createValidator() {
  const ajv = new Ajv2020({ allErrors: true, strict: true })
  addFormats(ajv)
  ajv.addSchema(readJson(schemaPath))
  return ajv
}

function ancestorDirectories(relativePath) {
  const segments = relativePath.split('/')
  const ancestors = []
  for (let length = 1; length < segments.length; length += 1) {
    ancestors.push(segments.slice(0, length).join('/'))
  }
  return ancestors
}

function templateHashInput(template) {
  const files = template.files
    .map(entry => entry.kind === 'directory'
      ? { relativePath: entry.relativePath, kind: 'directory' }
      : { relativePath: entry.relativePath, kind: 'file', content: entry.content })
    .sort((a, b) => (a.relativePath < b.relativePath ? -1 : a.relativePath > b.relativePath ? 1 : 0))
  return {
    templateId: template.metadata.templateId,
    templateVersion: template.metadata.templateVersion,
    files,
  }
}

function templateHash(template) {
  return `sha256:${createHash('sha256').update(canonicalJson(templateHashInput(template)), 'utf8').digest('hex')}`
}

function renderContent(content, substitutions) {
  return PLACEHOLDERS.reduce((text, token) => text.split(token).join(substitutions[token]), content)
}

test('Gate 2D template manifest schema compiles strictly as a 2020-12 schema', () => {
  const schema = readJson(schemaPath)
  assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema')
  assert.equal(typeof schema.$id, 'string')
  assert.doesNotThrow(() => createValidator())
})

test('all indexed template fixtures match their declared validation outcome', () => {
  const ajv = createValidator()
  const index = readJson(indexPath)
  assert.equal(index.cases.length, 8)
  const validate = ajv.getSchema(readJson(schemaPath).$id)
  assert.equal(typeof validate, 'function')
  for (const example of index.cases) {
    const value = readJson(resolve(examplesRoot, example.fixture))
    const actualValid = validate(value)
    assert.equal(actualValid, example.expectedValid, example.name)
    if (!actualValid) {
      assert.ok(
        validate.errors?.some(error => error.keyword === example.expectedErrorKeyword),
        `${example.name}: expected ${example.expectedErrorKeyword}; got ${JSON.stringify(validate.errors)}`,
      )
    }
  }
})

for (const fixtureName of ['template-minimal.valid.json', 'template-software.valid.json']) {
  test(`${fixtureName} satisfies the frozen template host rules`, () => {
    const template = readJson(resolve(examplesRoot, fixtureName))
    const files = template.files

    const paths = new Set()
    for (const entry of files) {
      assert.ok(!paths.has(entry.relativePath), `duplicate relativePath: ${entry.relativePath}`)
      paths.add(entry.relativePath)
      assert.ok(!/\{\{|\}\}/.test(entry.relativePath), 'placeholders are forbidden in paths')
    }

    const fileEntries = files.filter(entry => entry.kind === 'file')
    const directoryEntries = files.filter(entry => entry.kind === 'directory')
    const manifestEntries = fileEntries.filter(entry => entry.relativePath === PROJECT_MANIFEST_PATH)
    assert.equal(manifestEntries.length, 1, 'exactly one .dsh-project/project.yaml file entry')

    const requiredDirectories = new Set()
    for (const entry of fileEntries) {
      for (const ancestor of ancestorDirectories(entry.relativePath)) requiredDirectories.add(ancestor)
    }
    const declaredDirectories = new Set(directoryEntries.map(entry => entry.relativePath))
    assert.deepEqual(
      [...declaredDirectories].sort(),
      [...requiredDirectories].sort(),
      'directory entries must exactly cover the ancestors of all files',
    )

    const manifestContent = manifestEntries[0].content
    for (const token of PLACEHOLDERS) {
      assert.ok(manifestContent.includes(token), `project.yaml must use ${token}`)
    }
    for (const entry of fileEntries) {
      const stripped = PLACEHOLDERS.reduce((text, token) => text.split(token).join(''), entry.content)
      assert.ok(!/\{\{|\}\}/.test(stripped), `unknown {{ }} token in ${entry.relativePath}`)
    }

    const totalBytes = fileEntries.reduce((sum, entry) => sum + Buffer.byteLength(entry.content, 'utf8'), 0)
    assert.ok(totalBytes <= 256 * 1024, 'template content stays inside the total byte cap')
  })
}

test('a rendered minimal template manifest passes the project manifest schema', () => {
  const template = readJson(resolve(examplesRoot, 'template-minimal.valid.json'))
  const manifestEntry = template.files.find(entry => entry.relativePath === PROJECT_MANIFEST_PATH)
  const substitutions = {
    '{{PROJECT_ID}}': 'prj_0198f4b2-7c3a-7d11-a5c6-6b6f39e34711',
    '{{PROJECT_NAME}}': 'Contract Test Project',
    '{{CREATED_AT}}': '2026-08-15T09:30:00.000Z',
    '{{TEMPLATE_ID}}': template.metadata.templateId,
    '{{TEMPLATE_VERSION}}': template.metadata.templateVersion,
  }
  const rendered = renderContent(manifestEntry.content, substitutions)
  const parsed = parseYamlSubset(rendered)
  assert.equal(parsed.metadata.projectId, substitutions['{{PROJECT_ID}}'])
  assert.equal(parsed.metadata.origin.templateId, template.metadata.templateId)
  assert.equal(parsed.metadata.origin.templateVersion, template.metadata.templateVersion)
  assert.deepEqual(parsed.spec.documents.entries.map(entry => entry.role), [
    'readme', 'prd', 'devlog', 'next',
  ])

  const ajv = new Ajv2020({ allErrors: true, strict: true })
  addFormats(ajv)
  const manifestSchema = readJson(resolve(protocolSchemasRoot, 'project-manifest.schema.json'))
  const validate = ajv.compile(manifestSchema)
  assert.equal(validate(parsed), true, ajv.errorsText(validate.errors))
})

test('templateHash is deterministic, sorted and content-sensitive', () => {
  const template = readJson(resolve(examplesRoot, 'template-minimal.valid.json'))
  const hash = templateHash(template)
  assert.match(hash, /^sha256:[a-f0-9]{64}$/)

  const reordered = { ...template, files: [...template.files].reverse() }
  assert.equal(templateHash(reordered), hash, 'file order must not change the hash')

  const changed = {
    ...template,
    files: template.files.map(entry => entry.relativePath === 'docs/PRD.md'
      ? { ...entry, content: `${entry.content} changed\n` }
      : entry),
  }
  assert.notEqual(templateHash(changed), hash, 'content changes must change the hash')

  const versionChanged = { ...template, metadata: { ...template.metadata, templateVersion: '1.0.1' } }
  assert.notEqual(templateHash(versionChanged), hash, 'version changes must change the hash')
})

test('directory entries never carry content into the template hash', () => {
  const template = readJson(resolve(examplesRoot, 'template-software.valid.json'))
  const withBogusContent = {
    ...template,
    files: template.files.map(entry => entry.kind === 'directory'
      ? { ...entry, content: 'ignored' }
      : entry),
  }
  assert.equal(templateHash(withBogusContent), templateHash(template))
})
