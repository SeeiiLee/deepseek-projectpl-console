import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import {
  pathIndependentCssModulesPlugin,
  portableStylesheetPath,
} from '../build/path-independent-css-modules.mjs'

const clientBundlePath = fileURLToPath(new URL('../lib/client.js', import.meta.url))

test('client bundle does not embed an absolute CSS module virtual id', async () => {
  const bundle = await readFile(clientBundlePath, 'utf8')
  assert.doesNotMatch(bundle, /\\0dsh-(?:project-control-)?css:[A-Za-z]:[\\\\/]/u)
})

test('CSS module output has the same SHA under two absolute package roots', async (context) => {
  const temporary = await mkdtemp(join(tmpdir(), 'dsh-project-control-css-repro-'))
  context.after(async () => rm(temporary, { recursive: true, force: true }))
  const roots = [join(temporary, 'canonical'), join(temporary, 'task-worktree')]
  const outputs = []
  const virtualIds = []
  for (const root of roots) {
    const client = join(root, 'src', 'client')
    await mkdir(client, { recursive: true })
    const stylesheet = join(client, 'Fixture.module.css')
    const importer = join(client, 'index.ts')
    await writeFile(stylesheet, '.card { color: #123456; }\n', 'utf8')
    await writeFile(importer, "import styles from './Fixture.module.css'\n", 'utf8')
    const plugin = pathIndependentCssModulesPlugin('@cyrus/dsh-project-control', { root })
    const virtualId = plugin.resolveId('./Fixture.module.css', importer)
    const watched = []
    const output = await plugin.load.call({ addWatchFile: path => watched.push(path) }, virtualId)
    assert.deepEqual(watched, [stylesheet])
    virtualIds.push(virtualId)
    outputs.push(output)
  }
  assert.equal(virtualIds[0], virtualIds[1])
  assert.equal(portableStylesheetPath(roots[0], join(roots[0], 'src', 'client', 'Fixture.module.css')), 'src/client/Fixture.module.css')
  const hashes = outputs.map(output => createHash('sha256').update(output, 'utf8').digest('hex'))
  assert.equal(hashes[0], hashes[1])
})
