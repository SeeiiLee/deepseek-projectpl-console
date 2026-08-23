import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'

export const PROJECT_CONTROL_SELECTION_TICKET_VERSION = 1
export const PROJECT_CONTROL_SELECTION_TICKET_TTL_MS = 5 * 60 * 1000

export function createProjectControlSelectionSecret() {
  return randomBytes(32).toString('base64url')
}

export function issueProjectControlSelectionTicket(options) {
  const kind = requireKind(options.kind)
  const path = requirePath(options.path)
  const secret = requireSecret(options.secret)
  const nowMs = options.nowMs ?? Date.now()
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) throw new TypeError('Selection ticket time is invalid.')
  const expiresAt = new Date(nowMs + PROJECT_CONTROL_SELECTION_TICKET_TTL_MS).toISOString()
  const nonce = options.nonce ?? randomUUID()
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(nonce)) {
    throw new TypeError('Selection ticket nonce is invalid.')
  }
  return {
    version: PROJECT_CONTROL_SELECTION_TICKET_VERSION,
    kind,
    expiresAt,
    nonce,
    signature: signSelectionTicket({ kind, path, expiresAt, nonce, secret }),
  }
}

export function verifyProjectControlSelectionTicket(options) {
  try {
    const path = requirePath(options.path)
    const secret = requireSecret(options.secret)
    const authorization = requireAuthorization(options.authorization)
    if (authorization.kind !== options.kind) return false
    const nowMs = options.nowMs ?? Date.now()
    const expiresMs = Date.parse(authorization.expiresAt)
    if (!Number.isFinite(expiresMs) || expiresMs < nowMs || expiresMs - nowMs > PROJECT_CONTROL_SELECTION_TICKET_TTL_MS) {
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

function signSelectionTicket({ kind, path, expiresAt, nonce, secret }) {
  return createHmac('sha256', secret)
    .update(`${String(PROJECT_CONTROL_SELECTION_TICKET_VERSION)}\0${kind}\0${expiresAt}\0${nonce}\0${path}`, 'utf8')
    .digest('base64url')
}

function requireAuthorization(value) {
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

function requireKind(value) {
  if (!['source-root', 'project-root', 'create-parent'].includes(value)) throw new TypeError('Selection ticket kind is invalid.')
  return value
}

function requirePath(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 32_767 || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new TypeError('Selection ticket path is invalid.')
  }
  return value
}

function requireSecret(value) {
  if (typeof value !== 'string' || value.length < 32 || value.length > 256) {
    throw new TypeError('Selection ticket secret is invalid.')
  }
  return value
}
