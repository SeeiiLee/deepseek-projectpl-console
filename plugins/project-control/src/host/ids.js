import { randomBytes } from 'node:crypto'

import { StorageValidationError } from './errors.js'

export function createPrefixedUuidV7(prefix, options = {}) {
  if (!/^[a-z][a-z0-9]{1,7}$/.test(prefix)) {
    throw new StorageValidationError('Business ID prefix is invalid.', { prefix })
  }
  const nowMs = options.nowMs ?? Date.now()
  if (!Number.isSafeInteger(nowMs) || nowMs < 0 || nowMs > 0xffffffffffff) {
    throw new StorageValidationError('UUIDv7 timestamp is outside the 48-bit range.')
  }
  const entropy = options.randomBytes ?? randomBytes(10)
  if (!(entropy instanceof Uint8Array) || entropy.length !== 10) {
    throw new StorageValidationError('UUIDv7 entropy must contain exactly 10 bytes.')
  }

  const bytes = new Uint8Array(16)
  let timestamp = BigInt(nowMs)
  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = Number(timestamp & 0xffn)
    timestamp >>= 8n
  }
  bytes[6] = 0x70 | (entropy[0] & 0x0f)
  bytes[7] = entropy[1]
  bytes[8] = 0x80 | (entropy[2] & 0x3f)
  bytes.set(entropy.subarray(3), 9)

  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${prefix}_${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
