import { createHash } from 'node:crypto'

import { StorageValidationError } from './errors.js'

function normalizeJson(value, seen, path) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new StorageValidationError('Command request contains a non-finite number.', { path })
    }
    return Object.is(value, -0) ? 0 : value
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) {
      throw new StorageValidationError('Command request contains a cycle.', { path })
    }
    seen.add(value)
    const normalized = value.map((item, index) => {
      if (item === undefined || typeof item === 'function' || typeof item === 'symbol') {
        throw new StorageValidationError('Command request is not lossless JSON.', {
          path: `${path}[${index}]`,
        })
      }
      return normalizeJson(item, seen, `${path}[${index}]`)
    })
    seen.delete(value)
    return normalized
  }

  if (typeof value !== 'object') {
    throw new StorageValidationError('Command request is not a JSON value.', { path })
  }

  if (seen.has(value)) {
    throw new StorageValidationError('Command request contains a cycle.', { path })
  }
  seen.add(value)
  const normalized = {}
  for (const key of Object.keys(value).sort()) {
    const child = value[key]
    if (child === undefined || typeof child === 'function' || typeof child === 'symbol') {
      throw new StorageValidationError('Command request is not lossless JSON.', {
        path: `${path}.${key}`,
      })
    }
    normalized[key] = normalizeJson(child, seen, `${path}.${key}`)
  }
  seen.delete(value)
  return normalized
}

export function canonicalJson(value) {
  return JSON.stringify(normalizeJson(value, new Set(), '$'))
}

export function requestSha256(value) {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex')
}
