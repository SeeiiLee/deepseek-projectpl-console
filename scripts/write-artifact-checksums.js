import { createHash } from 'node:crypto'
import { createReadStream, existsSync, readdirSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'

const artifactRoot = resolve(import.meta.dirname, '..', process.env.DSH_ARTIFACT_DIR ?? 'artifacts')
if (!existsSync(artifactRoot)) throw new Error(`Artifact directory does not exist: ${artifactRoot}`)

const executables = readdirSync(artifactRoot, { withFileTypes: true })
  .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.exe'))
  .map(entry => join(artifactRoot, entry.name))

if (executables.length === 0) throw new Error('No Windows artifacts were found for checksum generation.')

for (const path of executables) {
  const digest = await digestFile(path)
  const checksumPath = `${path}.sha256`
  writeFileSync(checksumPath, `${digest} *${basename(path)}\n`, 'utf8')
  process.stdout.write(`${basename(checksumPath)} ${digest}\n`)
}

function digestFile(path) {
  return new Promise((resolvePromise, rejectPromise) => {
    const hash = createHash('sha256')
    const stream = createReadStream(path)
    stream.on('data', chunk => hash.update(chunk))
    stream.once('error', rejectPromise)
    stream.once('end', () => resolvePromise(hash.digest('hex')))
  })
}
