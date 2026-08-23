import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const host = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8')
const client = readFileSync(new URL('../src/client/index.ts', import.meta.url), 'utf8')
const dock = readFileSync(new URL('../src/client/ImageVisionDock.tsx', import.meta.url), 'utf8')
const analyzer = readFileSync(new URL('../src/image-vision.ts', import.meta.url), 'utf8')
const css = readFileSync(new URL('../src/client/ImageVisionDock.module.css', import.meta.url), 'utf8')

test('declares the image-vision package identity and host boundaries', () => {
  assert.equal(pkg.name, '@cyrus/dsh-image-vision')
  assert.match(pkg.description, /识图/)
  assert.match(host, /IMAGE_VISION_API_PREFIX = '\/__personal\/image-vision'/)
  assert.match(host, /inject = \['webServer', 'credentials'\]/)
  assert.match(host, /credentials\.resolve/)
  assert.match(host, /kind !== 'model'/)
  assert.match(host, /analyzeImage\(/)
  assert.doesNotMatch(host, /console\.log/)
})

test('keeps the renderer key-free and the provider call host-bounded', () => {
  assert.match(client, /'shell\.overlay'/)
  assert.match(client, /personal-image-vision/)
  assert.match(dock, /useSessions/)
  assert.match(dock, /api\.upload|api\.analyze/)
  assert.match(dock, /15 MiB/)
  assert.doesNotMatch(dock, /apiKey|authorization|Bearer|secret/)
  assert.match(analyzer, /authorization: 'Bearer ' \+ apiKey/)
  assert.match(analyzer, /OMNIBUS_PROMPT/)
  assert.match(analyzer, /image_url/)
  assert.doesNotMatch(analyzer, /process\.env|localStorage/)
})

test('uses a locally-scoped CSS Module without global selectors', () => {
  assert.doesNotMatch(css, /:global/)
  assert.doesNotMatch(css, /(^|\n)\s*(html|body|button|input|textarea|select)(?:\s|,|\{)/)
})