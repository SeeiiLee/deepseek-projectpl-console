import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { analyzeImage, MAX_IMAGE_BYTES } from './image-vision.ts'

export const IMAGE_VISION_API_PREFIX = '/__personal/image-vision'
export const MAX_ANALYZE_BODY_BYTES = 4096
const UPLOAD_TTL_MS = 5 * 60_000
const MAX_SESSION_IMAGES = 64

interface CredentialInfoLike { configured: boolean; writable: boolean; source?: string }
interface ResolvedCredentialLike { value: string; source: string }
interface CredentialsLike {
  describe(reference: string): Promise<CredentialInfoLike>
  resolve(reference: string): Promise<ResolvedCredentialLike | undefined>
}

interface WebServerLike {
  register(route: {
    kind: 'prefix'
    path: string
    handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>
  }): () => void
}

interface HostContextLike {
  webServer: WebServerLike
  credentials: CredentialsLike
  effect(
    factory: () => Promise<(() => void) | void> | (() => void) | void,
    label?: string,
  ): void
}

/** Structural subset of the personal-suite connection rows. */
export interface ModelConnectionRow {
  id: string
  label: string
  kind: string
  enabled: boolean
  endpointRef: string
  secretRef: string
}

/** Read-only connection source; the real one is PersonalStore (personal-foundation). */
export interface ModelConnectionStore {
  read(): Promise<{ connections: readonly ModelConnectionRow[] }>
}

type ModelConnectionStoreConstructor = new (filename: string) => ModelConnectionStore

/**
 * 按文件路径定位 personal-foundation 主机包入口（与 memory 插件同款套路）：
 * 源码态与打包态都不存在插件内按包名解析的 node_modules 链接，包名 import 会
 * 以「Cannot find package」静默失败；候选路径：src → ../../，lib → ../。
 */
export function foundationBundleUrl(): string {
  const here = dirname(fileURLToPath(import.meta.url))
  const candidates = [
    resolve(here, '..', '..', 'personal-foundation', 'lib', 'index.js'), // src 与 lib 均 → plugins/
  ]
  for (const candidate of candidates) {
    if (existsSync(candidate)) return pathToFileURL(candidate).href
  }
  throw new Error('personal-foundation 主机包未找到（near ' + here + '）。')
}

interface UploadedImage {
  buffer: Buffer
  mimeType: string
  expiresAt: number
}

export interface ImageVisionRuntime {
  store: ModelConnectionStore
  credentials: CredentialsLike
  uploads: Map<string, UploadedImage>
}

function imageVisionError(code: string, message: string, status = 400): Error {
  return Object.assign(new Error(message), { code, status, expose: true })
}

/** Host services used by the image-vision analyzer. */
export const inject = ['webServer', 'credentials']

export function apply(ctx: HostContextLike): void {
  ctx.effect(async () => {
    // Lazy load: the personal-foundation store is a runtime peer in the
    // profile node_modules; tests construct the same structural store.
    const bundle = await import(foundationBundleUrl())
    const PersonalStore = (bundle as { PersonalStore?: unknown }).PersonalStore as ModelConnectionStoreConstructor | undefined
    if (typeof PersonalStore !== 'function') {
      throw new Error('personal-foundation 主机包未导出 PersonalStore（lib 版本过旧，请重建插件）。')
    }
    const dshHome = resolve(process.env.DSH_HOME || join(homedir(), '.dsh'))
    const runtime: ImageVisionRuntime = {
      store: new PersonalStore(join(dshHome, 'personal', 'personal-suite.json')) as unknown as ModelConnectionStore,
      credentials: ctx.credentials,
      uploads: new Map<string, UploadedImage>(),
    }
    const unregister = ctx.webServer.register({
      kind: 'prefix',
      path: IMAGE_VISION_API_PREFIX,
      handler: createImageVisionRequestHandler(runtime),
    })
    return () => { unregister() }
  }, 'image vision API route')
}

/** Exported for focused HTTP contract tests without starting the full Harness. */
export function createImageVisionRequestHandler(runtime: ImageVisionRuntime) {
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    try {
      if (request.headers['x-dsh-image-vision'] !== '1') {
        throw imageVisionError('IMAGE_VISION_CLIENT_REQUIRED', '此接口只供个人桌面识图组件使用。', 403)
      }
      const url = new URL(request.url ?? '/', 'http://127.0.0.1')
      const resource = url.pathname.slice(IMAGE_VISION_API_PREFIX.length)
      const method = request.method ?? 'GET'
      if (resource === '/connections' && method === 'GET') {
        const data = await listModelConnections(runtime)
        sendJson(response, 200, { ok: true, data })
        return
      }
      if (resource === '/upload' && method === 'POST') {
        const sessionId = requireHeader(request, 'x-session-id', 200)
        const mimeType = requireHeader(request, 'content-type', 100)
        if (!mimeType.startsWith('image/')) {
          throw imageVisionError('NOT_AN_IMAGE', '上传内容不是图片。')
        }
        const buffer = await readRawBody(request, MAX_IMAGE_BYTES)
        if (buffer.length === 0) throw imageVisionError('EMPTY_IMAGE', '上传的图片是空的。')
        pruneUploads(runtime)
        if (runtime.uploads.size >= MAX_SESSION_IMAGES && !runtime.uploads.has(sessionId)) {
          throw imageVisionError('TOO_MANY_UPLOADS', '待识别的图片过多，请先完成现有识别。', 429)
        }
        const expiresAt = Date.now() + UPLOAD_TTL_MS
        runtime.uploads.set(sessionId, { buffer, mimeType, expiresAt })
        sendJson(response, 200, { ok: true, data: { bytes: buffer.length, mimeType, expiresAt: new Date(expiresAt).toISOString() } })
        return
      }
      if (resource === '/analyze' && method === 'POST') {
        const body = await readJsonBody(request, MAX_ANALYZE_BODY_BYTES)
        const sessionId = boundedField(body.sessionId, 200)
        const connectionId = boundedField(body.connectionId, 80)
        const model = boundedField(body.model, 200)
        if (sessionId === '' || connectionId === '' || model === '') {
          throw imageVisionError('INVALID_BODY', '缺少会话、连接或模型名。')
        }
        const uploaded = runtime.uploads.get(sessionId)
        if (uploaded === undefined || uploaded.expiresAt < Date.now()) {
          throw imageVisionError('NO_IMAGE', '请先上传图片。', 404)
        }
        const connection = await findModelConnection(runtime, connectionId)
        if (connection === null) throw imageVisionError('CONNECTION_NOT_FOUND', '模型连接不存在。', 404)
        if (!connection.enabled) throw imageVisionError('CONNECTION_DISABLED', '该模型连接已停用。', 409)
        const endpoint = await resolveCredential(runtime, connection.endpointRef)
        const apiKey = await resolveCredential(runtime, connection.secretRef)
        if (endpoint === undefined || apiKey === undefined) {
          throw imageVisionError('CONNECTION_NOT_CONFIGURED', '该模型连接缺少 API 地址或密钥。', 409)
        }
        const result = await analyzeImage({
          endpoint,
          apiKey,
          model,
          mimeType: uploaded.mimeType,
          base64: uploaded.buffer.toString('base64'),
        })
        sendJson(response, 200, { ok: true, data: { result, connectionLabel: connection.label } })
        return
      }
      if (['/connections', '/upload', '/analyze'].includes(resource)) {
        throw imageVisionError('METHOD_NOT_ALLOWED', '此识图接口不支持该请求方法。', 405)
      }
      throw imageVisionError('NOT_FOUND', '识图接口不存在。', 404)
    } catch (error) {
      const status = errorStatus(error)
      sendJson(response, status, {
        ok: false,
        error: {
          code: errorCode(error, status),
          message: status >= 500 ? '识图服务请求失败。' : messageOf(error),
        },
      })
    }
  }
}

async function listModelConnections(runtime: ImageVisionRuntime): Promise<{ connections: Array<Record<string, unknown>> }> {
  const document = await runtime.store.read()
  const connections: Array<Record<string, unknown>> = []
  for (const stored of document.connections) {
    if (stored.kind !== 'model') continue
    const [endpoint, secret] = await Promise.all([
      describeCredential(runtime, stored.endpointRef),
      describeCredential(runtime, stored.secretRef),
    ])
    connections.push({
      id: stored.id,
      label: stored.label,
      enabled: stored.enabled,
      endpointConfigured: endpoint.configured,
      secretConfigured: secret.configured,
    })
  }
  return { connections }
}

async function findModelConnection(runtime: ImageVisionRuntime, connectionId: string): Promise<ModelConnectionRow | null> {
  const document = await runtime.store.read()
  return document.connections.find(item => item.id === connectionId && item.kind === 'model') ?? null
}

async function resolveCredential(runtime: ImageVisionRuntime, reference: string): Promise<string | undefined> {
  try {
    const resolved = await runtime.credentials.resolve(reference)
    return resolved?.value
  } catch {
    return undefined
  }
}

async function describeCredential(runtime: ImageVisionRuntime, reference: string): Promise<CredentialInfoLike> {
  try {
    return await runtime.credentials.describe(reference)
  } catch {
    return { configured: false, writable: false }
  }
}

function pruneUploads(runtime: ImageVisionRuntime): void {
  const now = Date.now()
  for (const [sessionId, uploaded] of runtime.uploads) {
    if (uploaded.expiresAt < now) runtime.uploads.delete(sessionId)
  }
}

function requireHeader(request: IncomingMessage, name: string, maxLength: number): string {
  const value = request.headers[name]
  if (typeof value !== 'string' || value.trim() === '' || value.length > maxLength) {
    throw imageVisionError('MISSING_HEADER', `缺少请求头 ${name}。`)
  }
  return value.trim()
}

async function readRawBody(request: IncomingMessage, maximum: number): Promise<Buffer> {
  const declared = Number(request.headers['content-length'] ?? 0)
  if (Number.isFinite(declared) && declared > maximum) {
    throw imageVisionError('IMAGE_TOO_LARGE', '图片超过 15 MiB 上限。', 413)
  }
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > maximum) throw imageVisionError('IMAGE_TOO_LARGE', '图片超过 15 MiB 上限。', 413)
    chunks.push(buffer)
  }
  return Buffer.concat(chunks)
}

async function readJsonBody(request: IncomingMessage, maximum: number): Promise<Record<string, unknown>> {
  const buffer = await readRawBody(request, maximum)
  if (buffer.length === 0) return {}
  try {
    const parsed = JSON.parse(buffer.toString('utf8')) as unknown
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw imageVisionError('INVALID_BODY', '请求正文必须是对象。')
    }
    return parsed as Record<string, unknown>
  } catch (error) {
    const code = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined
    if (code === 'INVALID_BODY' || code === 'IMAGE_TOO_LARGE') throw error
    throw imageVisionError('INVALID_BODY', '请求正文不是有效 JSON。')
  }
}

function boundedField(value: unknown, maxLength: number): string {
  if (typeof value !== 'string' || value.trim() === '' || value.length > maxLength) return ''
  return value.trim()
}

function errorStatus(error: unknown): number {
  const status = (error as { status?: unknown } | null)?.status
  return typeof status === 'number' && status >= 400 && status <= 599 ? status : 500
}

function errorCode(error: unknown, status: number): string {
  const code = (error as { code?: unknown } | null)?.code
  return typeof code === 'string' && code !== '' ? code : status >= 500 ? 'INTERNAL_ERROR' : 'BAD_REQUEST'
}

function messageOf(error: unknown): string {
  return error instanceof Error && error.message.trim() !== '' ? error.message : '请求失败。'
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  if (response.headersSent) return
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  response.end(JSON.stringify(value))
}