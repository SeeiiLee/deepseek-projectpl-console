export type DirectorySelectionKind = 'source-root' | 'project-root' | 'create-parent'

export interface DirectoryAuthorization {
  version: 1
  kind: DirectorySelectionKind
  expiresAt: string
  nonce: string
  signature: string
}

export interface AuthorizedDirectorySelection {
  path: string
  authorization: DirectoryAuthorization
}

export type DirectorySelectionOutcome =
  | { kind: 'selected'; selection: AuthorizedDirectorySelection }
  | { kind: 'cancelled' }
  | { kind: 'error'; message: string }

interface ProjectControlDesktopBridge {
  selectDirectory(kind: DirectorySelectionKind): Promise<unknown>
}

declare global {
  interface Window {
    deepseekHarnessPersonal?: {
      projectControl?: ProjectControlDesktopBridge
    }
  }
}

export function hasProjectControlDirectoryBridge(): boolean {
  return typeof window.deepseekHarnessPersonal?.projectControl?.selectDirectory === 'function'
}

export async function selectProjectDirectory(
  kind: DirectorySelectionKind,
): Promise<DirectorySelectionOutcome> {
  const selectDirectory = window.deepseekHarnessPersonal?.projectControl?.selectDirectory
  if (typeof selectDirectory !== 'function') {
    return { kind: 'error', message: '目录选择服务只在 DeepSeek Harness Personal 桌面客户端中可用。' }
  }
  try {
    return parseDirectorySelectionResult(await selectDirectory(kind), kind)
  } catch (error) {
    return {
      kind: 'error',
      message: error instanceof Error && error.message.trim().length > 0
        ? error.message
        : '目录选择没有完成，请重试。',
    }
  }
}

export function parseDirectorySelectionResult(
  value: unknown,
  expectedKind: DirectorySelectionKind,
): DirectorySelectionOutcome {
  if (!isRecord(value)) return invalidBridgeResponse()
  if (value.ok === true && value.canceled === true) return { kind: 'cancelled' }
  if (value.ok === false) {
    const reason = boundedText(value.reason, 240)
    return { kind: 'error', message: reason ?? '目录选择没有完成，请重试。' }
  }
  if (value.ok !== true || value.canceled !== false) return invalidBridgeResponse()
  const path = boundedText(value.path, 32_767)
  if (path === undefined || !isRecord(value.authorization)) return invalidBridgeResponse()
  const authorization = value.authorization
  const kind = authorization.kind
  const expiresAt = boundedText(authorization.expiresAt, 64)
  const nonce = boundedText(authorization.nonce, 512)
  const signature = boundedText(authorization.signature, 2_048)
  if (authorization.version !== 1
    || kind !== expectedKind
    || expiresAt === undefined
    || Number.isNaN(Date.parse(expiresAt))
    || nonce === undefined
    || signature === undefined) return invalidBridgeResponse()
  if (Date.parse(expiresAt) <= Date.now()) {
    return { kind: 'error', message: '目录授权已经过期，请重新选择目录。' }
  }
  return {
    kind: 'selected',
    selection: {
      path,
      authorization: { version: 1, kind: expectedKind, expiresAt, nonce, signature },
    },
  }
}

function invalidBridgeResponse(): DirectorySelectionOutcome {
  return { kind: 'error', message: '目录选择服务返回了无法识别的响应。' }
}

function boundedText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  return normalized.length > 0 && normalized.length <= maxLength ? normalized : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
