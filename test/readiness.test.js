import assert from 'node:assert/strict'
import test from 'node:test'
import { createLineDecoder, parseReadinessLine } from '../src/readiness.js'

test('accepts the exact loopback readiness URL', () => {
  assert.equal(parseReadinessLine('dsh web: http://127.0.0.1:54321')?.href, 'http://127.0.0.1:54321/')
})

test('ignores unrelated output', () => {
  assert.equal(parseReadinessLine('starting plugins'), undefined)
})

for (const value of [
  'https://127.0.0.1:54321',
  'http://localhost:54321',
  'http://0.0.0.0:54321',
  'http://2130706433:54321',
  'http://0x7f000001:54321',
  'http://127.1:54321',
  'http://127.0.0.1',
  'http://127.0.0.1:54321/path',
  'http://user@127.0.0.1:54321',
]) {
  test(`rejects untrusted readiness URL ${value}`, () => {
    assert.throws(() => parseReadinessLine(`dsh web: ${value}`), /readiness|untrusted/i)
  })
}

test('does not accept readiness with leading whitespace', () => {
  assert.equal(parseReadinessLine(' dsh web: http://127.0.0.1:54321'), undefined)
})

test('rejects readiness with trailing whitespace', () => {
  assert.throws(
    () => parseReadinessLine('dsh web: http://127.0.0.1:54321 '),
    /untrusted readiness/i,
  )
})

test('decodes readiness split across output chunks', () => {
  const lines = []
  const decoder = createLineDecoder(line => lines.push(line))
  decoder.push('first\r\ndsh web: http://127.')
  decoder.push('0.0.1:54321\nlast')
  decoder.flush()
  assert.deepEqual(lines, ['first', 'dsh web: http://127.0.0.1:54321', 'last'])
})

test('bounds an unterminated output line', () => {
  const decoder = createLineDecoder(() => {}, 4)
  assert.throws(() => decoder.push('12345'), /longer than 4/)
})
