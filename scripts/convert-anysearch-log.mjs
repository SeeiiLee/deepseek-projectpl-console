// Convert anysearch-build.log to UTF-8 for tooling that rejects GBK bytes.
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = resolve(root, 'anysearch-build.log')
const target = resolve(root, 'anysearch-build-utf8.log')

const bytes = await readFile(source)

function validUtf8(buffer) {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buffer)
    return true
  } catch {
    return false
  }
}

let text
if (validUtf8(bytes)) {
  text = bytes.toString('utf8')
} else {
  try {
    text = new TextDecoder('gbk').decode(bytes)
  } catch {
    text = bytes.toString('latin1')
  }
}

await writeFile(target, text, 'utf8')
console.log(`wrote ${target}`)
