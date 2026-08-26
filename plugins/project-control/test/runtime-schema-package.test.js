import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { test } from 'node:test'

const pluginRoot = resolve(import.meta.dirname, '..')
const repositoryRoot = resolve(pluginRoot, '..', '..')

const RUNTIME_SCHEMAS = Object.freeze([
  ['lib/runtime-schemas/project-manifest.schema.json', 'protocol/project-control/v1alpha1/schemas/project-manifest.schema.json'],
  ['lib/runtime-schemas/lifecycle-command-envelope.schema.json', 'protocol/project-control/v1alpha1/lifecycle/schemas/lifecycle-command-envelope.schema.json'],
  ['lib/runtime-schemas/lifecycle-command-result.schema.json', 'protocol/project-control/v1alpha1/lifecycle/schemas/lifecycle-command-result.schema.json'],
  ['lib/runtime-schemas/external-command-envelope.schema.json', 'protocol/project-control/v1alpha1/schemas/command-envelope.schema.json'],
  ['lib/runtime-schemas/project-home.schema.json', 'protocol/project-control/v1alpha1/project-home/schemas/project-home.schema.json'],
  ['lib/runtime-schemas/template-manifest.schema.json', 'protocol/project-control/v1alpha1/templates/schemas/template-manifest.schema.json'],
])

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

test('Project Control package carries every runtime Schema with authority-identical bytes', () => {
  const manifest = JSON.parse(readFileSync(join(pluginRoot, 'package.json'), 'utf8'))
  for (const [packagePath, authorityPath] of RUNTIME_SCHEMAS) {
    const packaged = join(pluginRoot, ...packagePath.split('/'))
    const authority = join(repositoryRoot, ...authorityPath.split('/'))
    assert.equal(existsSync(packaged), true, `missing packaged runtime Schema: ${packagePath}`)
    assert.ok(manifest.files.includes(packagePath), `npm files omits ${packagePath}`)
    assert.ok(manifest.dshComposable.files.list.includes(packagePath), `plugin contract omits ${packagePath}`)
    assert.equal(
      manifest.dshComposable.files.sha256[packagePath],
      sha256(readFileSync(packaged)),
      `plugin contract hash drifted for ${packagePath}`,
    )
    assert.equal(
      sha256(readFileSync(packaged)),
      sha256(readFileSync(authority)),
      `${packagePath} drifted from ${authorityPath}`,
    )
  }
})
