import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import test from 'node:test'
import {
  checkCheckoutContract,
  classifyCheckoutPath,
  inspectEolBytes,
} from '../scripts/check-checkout-contract.js'

const repositoryRoot = resolve(import.meta.dirname, '..')

test('checkout contract classifies canonical LF, Windows CRLF, and binary paths', () => {
  assert.equal(classifyCheckoutPath('src/main.js'), 'lf')
  assert.equal(classifyCheckoutPath('scripts/probe.ps1'), 'lf')
  assert.equal(classifyCheckoutPath('启动.cmd'), 'crlf')
  assert.equal(classifyCheckoutPath('vendor/tool.bat'), 'crlf')
  assert.equal(classifyCheckoutPath('plugins/memory/src/core/wordlist.ts'), 'crlf')
  assert.equal(classifyCheckoutPath('assets/icon.png'), 'binary')
})

test('checkout contract rejects mixed or wrong line endings with stable codes', () => {
  assert.deepEqual(inspectEolBytes(Buffer.from('a\nb\n'), 'lf'), [])
  assert.deepEqual(inspectEolBytes(Buffer.from('a\r\nb\r\n'), 'lf'), ['CR_BYTE_IN_LF_FILE'])
  assert.deepEqual(inspectEolBytes(Buffer.from('a\r\nb\r\n'), 'crlf'), [])
  assert.deepEqual(inspectEolBytes(Buffer.from('a\nb\n'), 'crlf'), ['BARE_LF_IN_CRLF_FILE'])
  assert.deepEqual(inspectEolBytes(Buffer.from('a\rb'), 'crlf'), ['BARE_CR_IN_CRLF_FILE'])
})

test('the current repository satisfies the checkout byte contract', () => {
  const result = checkCheckoutContract(repositoryRoot)
  assert.equal(result.ok, true, JSON.stringify(result.failures.slice(0, 20), null, 2))
})
