import { createHmac, timingSafeEqual } from 'node:crypto'

export const PROJECT_CONTROL_SELECTION_TICKET_VERSION = 1
export const PROJECT_CONTROL_SELECTION_TICKET_TTL_MS = 5 * 60 * 1000

export interface ProjectControlSelectionAuthorization {
  version: 1
  kind: 'source-root' | 'project-root' | 'create-parent'
  expiresAt: string
  nonce: string
  signature: string
}

/** Verify the short-lived HMAC capability issued by the Electron main process. */
export function verifyProjectControlSelectionTicket(options: {
  kind: 'source-root' | 'project-root' | 'create-parent'
  path: string
  authorization: ProjectControlSelectionAuthorization
  secret: string
  nowMs?: number
}): boolean {
  try {
    const path = requirePath(options.path)
    const secret = requireSecret(options.secret)
    const authorization = requireAuthorization(options.authorization)
    if (authorization.kind !== options.kind) return false
    const nowMs = options.nowMs ?? Date.now()
    if (!Number.isSafeInteger(nowMs) || nowMs < 0) return false
    const expiresMs = Date.parse(authorization.expiresAt)
    if (!Number.isFinite(expiresMs)
      || expiresMs < nowMs
      || expiresMs - nowMs > PROJECT_CONTROL_SELECTION_TICKET_TTL_MS) {
      return false
    }
    const expected = signSelectionTicket({
      kind: authorization.kind,
      path,
      expiresAt: authorization.expiresAt,
      nonce: authorization.nonce,
      secret,
    })
    const actualBytes = Buffer.from(authorization.signature, 'utf8')
    const expectedBytes = Buffer.from(expected, 'utf8')
    return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes)
  } catch {
    return false
  }
}

function signSelectionTicket(options: {
  kind: string
  path: string
  expiresAt: string
  nonce: string
  secret: string
}): string {
  return createHmac('sha256', options.secret)
    .update(
      `${String(PROJECT_CONTROL_SELECTION_TICKET_VERSION)}\0${options.kind}\0${options.expiresAt}\0${options.nonce}\0${options.path}`,
      'utf8',
    )
    .digest('base64url')
}

function requireAuthorization(value: ProjectControlSelectionAuthorization): ProjectControlSelectionAuthorization {
  if (typeof value !== 'object' || value === null
    || value.version !== PROJECT_CONTROL_SELECTION_TICKET_VERSION
    || !['source-root', 'project-root', 'create-parent'].includes(value.kind)
    || typeof value.expiresAt !== 'string'
    || typeof value.nonce !== 'string'
    || typeof value.signature !== 'string'
    || value.signature.length !== 43) {
    throw new TypeError('Selection ticket authorization is invalid.')
  }
  return value
}

function requirePath(value: string): string {
  if (typeof value !== 'string'
    || value.length === 0
    || value.length > 32_767
    || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new TypeError('Selection ticket path is invalid.')
  }
  return value
}

function requireSecret(value: string): string {
  if (typeof value !== 'string' || value.length < 32 || value.length > 256) {
    throw new TypeError('Selection ticket secret is invalid.')
  }
  return value
}
