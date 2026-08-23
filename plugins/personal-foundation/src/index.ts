import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  PersonalStore,
  boundedText,
  connectionKind,
  credentialRefFor,
  normalizeDocument,
  record,
  type ConnectionKind,
  type PersonalDocument,
  type StoredConnection,
} from './store.ts'
import { apiError, createSkill, listSkills, trashSkill, updateSkillMetadata } from './skills.ts'

const API_PREFIX = '/__personal/api'
const MAX_BODY_BYTES = 1_048_576

type FiberPhase = 'pending' | 'loading' | 'active' | 'failed' | 'unloading' | null

interface WebServerLike {
  register(route: {
    kind: 'prefix'
    path: string
    handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>
  }): () => void
}

interface LoaderEntryLike {
  id: string
  disabled: boolean
  options: { group?: boolean; name?: unknown }
  fiber?: { state: number }
}

interface LoaderLike { entries(): Iterable<LoaderEntryLike> }

interface CredentialInfo { configured: boolean; writable: boolean; source?: string }
interface CredentialsLike {
  describe(reference: string): Promise<CredentialInfo>
  set(reference: string, value: string): Promise<void>
  unset(reference: string): Promise<void>
}

interface HostContextLike {
  webServer: WebServerLike
  loader: LoaderLike
  credentials: CredentialsLike
  effect(factory: () => (() => void) | void, label?: string): void
}

interface FoundationRuntime {
  store: PersonalStore
  dshHome: string
  agentsHome: string
  loader: LoaderLike
  credentials: CredentialsLike
  packageRequire: NodeJS.Require
}

interface PluginItem {
  id: string
  entryId: string
  packageName: string
  category: string
  categoryCustomized: boolean
  description: string
  descriptionCustomized: boolean
  enabled: boolean
  fiberPhase: FiberPhase
  canEdit: boolean
}

interface ConnectionItem {
  id: string
  label: string
  kind: ConnectionKind
  enabled: boolean
  endpointDisplay: string
  endpointConfigured: boolean
  secretConfigured: boolean
  mcpTransport?: 'streamable-http' | 'stdio'
  canEdit: boolean
  canDelete: boolean
}

/** Host services used by the private personal-data API. */
export const inject = ['webServer', 'loader', 'credentials']

/** Register one loopback-only API surface shared by all personal Client plugins. */
export function apply(ctx: HostContextLike): void {
  const dshHome = resolve(process.env.DSH_HOME || join(homedir(), '.dsh'))
  const agentsHome = resolve(process.env.DSH_AGENTS_HOME || join(homedir(), '.agents'))
  const runtime: FoundationRuntime = {
    store: new PersonalStore(join(dshHome, 'personal', 'personal-suite.json')),
    dshHome,
    agentsHome,
    loader: ctx.loader,
    credentials: ctx.credentials,
    packageRequire: createRequire(join(dshHome, 'profiles', 'web', 'package.json')),
  }
  const handler = createPersonalRequestHandler(runtime)
  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: API_PREFIX, handler }), 'personal API route')
}

/** Exported for focused HTTP contract tests without starting the full Harness. */
export function createPersonalRequestHandler(runtime: FoundationRuntime) {
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    try {
      if (request.headers['x-dsh-personal-client'] !== '1') {
        throw apiError('PERSONAL_CLIENT_REQUIRED', '此接口只供个人桌面客户端使用。', 403)
      }
      const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
      const resource = pathname.slice(API_PREFIX.length)
      const method = request.method ?? 'GET'
      const body = method === 'GET' ? {} : record(await readJsonBody(request))
      const data = await dispatch(runtime, resource, method, body)
      sendJson(response, 200, { ok: true, data })
    } catch (error) {
      const status = errorStatus(error)
      const message = status >= 500 ? '个人功能请求失败。' : errorMessage(error)
      sendJson(response, status, { ok: false, error: { code: errorCode(error, status), message } })
    }
  }
}

async function dispatch(
  runtime: FoundationRuntime,
  resource: string,
  method: string,
  body: Record<string, unknown>,
): Promise<unknown> {
  switch (resource) {
    case '/theme': return themeResource(runtime, method, body)
    case '/skills': return skillsResource(runtime, method, body)
    case '/plugins': return pluginsResource(runtime, method, body)
    case '/connections': return connectionsResource(runtime, method, body)
    default: throw apiError('NOT_FOUND', '个人功能接口不存在。', 404)
  }
}

async function themeResource(
  runtime: FoundationRuntime,
  method: string,
  body: Record<string, unknown>,
): Promise<unknown> {
  if (method === 'GET') return (await runtime.store.read()).theme
  if (method === 'PUT') {
    return runtime.store.mutate(document => {
      document.theme = normalizeDocument({ theme: body }).theme
      return document.theme
    })
  }
  throw methodNotAllowed()
}

async function skillsResource(
  runtime: FoundationRuntime,
  method: string,
  body: Record<string, unknown>,
): Promise<unknown> {
  if (method === 'GET') {
    const document = await runtime.store.read()
    return { skills: await listSkills(runtime.dshHome, runtime.agentsHome, document.skillMetadata) }
  }
  if (method === 'POST') {
    return runtime.store.mutate(document => createSkill(runtime.dshHome, body, document))
  }
  if (method === 'PUT') {
    return runtime.store.mutate(document => updateSkillMetadata(runtime.dshHome, runtime.agentsHome, body, document))
  }
  if (method === 'DELETE') {
    return runtime.store.mutate(document => trashSkill(runtime.dshHome, runtime.agentsHome, body, document))
  }
  throw methodNotAllowed()
}

async function pluginsResource(
  runtime: FoundationRuntime,
  method: string,
  body: Record<string, unknown>,
): Promise<unknown> {
  if (method === 'GET') {
    const document = await runtime.store.read()
    return { plugins: pluginItems(runtime, document) }
  }
  if (method === 'PUT') {
    const id = boundedText(body.id, '', 300)
    const existing = [...runtime.loader.entries()].find(entry => !entry.options.group && entry.id === id)
    if (existing === undefined) throw apiError('PLUGIN_NOT_FOUND', '要整理的插件当前不在 Loader 清单中。', 404)
    const category = boundedText(body.category, '', 80)
    const description = boundedText(body.description, '', 300)
    if (category === '' || description === '') throw apiError('INVALID_PLUGIN_METADATA', '分类和一句话简介不能为空。')
    await runtime.store.mutate(document => {
      document.pluginMetadata[id] = { category, description }
    })
    const document = await runtime.store.read()
    return pluginItems(runtime, document).find(item => item.id === id)
  }
  throw methodNotAllowed()
}

function pluginItems(runtime: FoundationRuntime, document: PersonalDocument): PluginItem[] {
  const items: PluginItem[] = []
  for (const entry of runtime.loader.entries()) {
    if (entry.options.group) continue
    const packageName = typeof entry.options.name === 'string' ? entry.options.name : '(unknown package)'
    const custom = document.pluginMetadata[entry.id]
    const manifestDescription = packageDescription(runtime.packageRequire, packageName)
    items.push({
      id: entry.id,
      entryId: entry.id,
      packageName,
      category: custom?.category ?? defaultPluginCategory(packageName),
      categoryCustomized: custom !== undefined,
      description: custom?.description ?? manifestDescription ?? defaultPluginDescription(packageName),
      descriptionCustomized: custom !== undefined,
      enabled: !entry.disabled,
      fiberPhase: entry.fiber === undefined ? null : fiberPhase(entry.fiber.state),
      canEdit: true,
    })
  }
  return items
}

async function connectionsResource(
  runtime: FoundationRuntime,
  method: string,
  body: Record<string, unknown>,
): Promise<unknown> {
  if (method === 'GET') {
    const document = await runtime.store.read()
    return { connections: await Promise.all(document.connections.map(item => connectionItem(runtime.credentials, item))) }
  }
  if (method === 'POST') return createConnection(runtime, body)
  if (method === 'PUT') return updateConnection(runtime, body)
  if (method === 'DELETE') return deleteConnection(runtime, body)
  throw methodNotAllowed()
}

async function createConnection(runtime: FoundationRuntime, body: Record<string, unknown>): Promise<ConnectionItem> {
  const kind = requiredConnectionKind(body.kind)
  const label = requiredText(body.label, '连接名称', 100)
  const transport = connectionTransport(kind, body.mcpTransport)
  const endpoint = requiredEndpoint(kind, transport, body.endpoint)
  const secret = optionalSecret(body.secret)
  const id = randomUUID().replaceAll('-', '')
  const endpointRef = credentialRefFor(id, 'ENDPOINT')
  const secretRef = credentialRefFor(id, 'SECRET')
  const now = new Date().toISOString()
  const stored: StoredConnection = {
    id,
    label,
    kind,
    enabled: body.enabled === true,
    ...(kind === 'mcp' ? { mcpTransport: transport } : {}),
    endpointDisplay: endpointDisplay(kind, transport),
    endpointRef,
    secretRef,
    createdAt: now,
    updatedAt: now,
  }
  await setCredential(runtime.credentials, endpointRef, endpoint)
  try {
    if (secret !== undefined) await setCredential(runtime.credentials, secretRef, secret)
    await runtime.store.mutate(document => { document.connections.push(stored) })
  } catch (error) {
    await Promise.allSettled([
      runtime.credentials.unset(endpointRef),
      ...(secret === undefined ? [] : [runtime.credentials.unset(secretRef)]),
    ])
    throw error
  }
  return connectionItem(runtime.credentials, stored)
}

async function updateConnection(runtime: FoundationRuntime, body: Record<string, unknown>): Promise<ConnectionItem> {
  const id = boundedText(body.id, '', 80)
  const document = await runtime.store.read()
  const current = document.connections.find(item => item.id === id)
  if (current === undefined) throw apiError('CONNECTION_NOT_FOUND', '要更新的连接配置不存在。', 404)
  const kind = body.kind === undefined ? current.kind : requiredConnectionKind(body.kind)
  const transport = connectionTransport(kind, body.mcpTransport ?? current.mcpTransport)
  const endpointChanged = typeof body.endpoint === 'string' && body.endpoint.trim() !== ''
  const transportChanged = kind === 'mcp' && transport !== (current.mcpTransport ?? 'streamable-http')
  if ((kind !== current.kind || transportChanged) && !endpointChanged) {
    throw apiError('CONNECTION_TARGET_REQUIRED', '更改连接类型或传输方式时必须填写新的目标。')
  }
  if (endpointChanged) {
    await setCredential(runtime.credentials, current.endpointRef, requiredEndpoint(kind, transport, body.endpoint))
  }
  const secret = optionalSecret(body.secret)
  if (secret !== undefined) await setCredential(runtime.credentials, current.secretRef, secret)
  const updated = await runtime.store.mutate(draft => {
    const index = draft.connections.findIndex(item => item.id === id)
    if (index < 0) throw apiError('CONNECTION_NOT_FOUND', '要更新的连接配置不存在。', 404)
    const next: StoredConnection = {
      ...draft.connections[index]!,
      label: body.label === undefined ? current.label : requiredText(body.label, '连接名称', 100),
      kind,
      enabled: typeof body.enabled === 'boolean' ? body.enabled : current.enabled,
      endpointDisplay: endpointDisplay(kind, transport),
      updatedAt: new Date().toISOString(),
    }
    if (kind === 'mcp') next.mcpTransport = transport
    else delete next.mcpTransport
    draft.connections[index] = next
    return next
  })
  return connectionItem(runtime.credentials, updated)
}

async function deleteConnection(runtime: FoundationRuntime, body: Record<string, unknown>): Promise<{ deleted: string }> {
  const id = boundedText(body.id, '', 80)
  const document = await runtime.store.read()
  const current = document.connections.find(item => item.id === id)
  if (current === undefined) throw apiError('CONNECTION_NOT_FOUND', '要删除的连接配置不存在。', 404)
  await Promise.all([
    unsetCredential(runtime.credentials, current.endpointRef),
    unsetCredential(runtime.credentials, current.secretRef),
  ])
  await runtime.store.mutate(draft => {
    draft.connections = draft.connections.filter(item => item.id !== id)
  })
  return { deleted: id }
}

async function connectionItem(credentials: CredentialsLike, stored: StoredConnection): Promise<ConnectionItem> {
  const [endpoint, secret] = await Promise.all([
    describeCredential(credentials, stored.endpointRef),
    describeCredential(credentials, stored.secretRef),
  ])
  return {
    id: stored.id,
    label: stored.label,
    kind: stored.kind,
    enabled: stored.enabled,
    endpointDisplay: stored.endpointDisplay,
    endpointConfigured: endpoint.configured,
    secretConfigured: secret.configured,
    ...(stored.kind === 'mcp' ? { mcpTransport: stored.mcpTransport ?? 'streamable-http' } : {}),
    canEdit: endpoint.writable && secret.writable,
    canDelete: endpoint.writable && secret.writable,
  }
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const declared = Number(request.headers['content-length'] ?? 0)
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) throw apiError('BODY_TOO_LARGE', '请求内容过大。', 413)
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > MAX_BODY_BYTES) throw apiError('BODY_TOO_LARGE', '请求内容过大。', 413)
    chunks.push(buffer)
  }
  if (size === 0) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw apiError('INVALID_JSON', '请求不是有效的 JSON。')
  }
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

function requiredConnectionKind(value: unknown): ConnectionKind {
  const kind = connectionKind(value)
  if (kind === undefined) throw apiError('INVALID_CONNECTION_KIND', '不支持这种连接类型。')
  return kind
}

function connectionTransport(kind: ConnectionKind, value: unknown): 'streamable-http' | 'stdio' {
  if (kind !== 'mcp') return 'streamable-http'
  return value === 'stdio' ? 'stdio' : 'streamable-http'
}

function requiredEndpoint(kind: ConnectionKind, transport: 'streamable-http' | 'stdio', value: unknown): string {
  const endpoint = requiredText(value, transport === 'stdio' ? '启动命令' : '连接 URL', 4_096)
  if (kind === 'mcp' && transport === 'stdio') {
    if (/\r|\n/u.test(endpoint)) throw apiError('INVALID_CONNECTION_TARGET', 'stdio 启动命令必须是单行。')
    return endpoint
  }
  try {
    const url = new URL(endpoint)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('unsupported protocol')
  } catch {
    throw apiError('INVALID_CONNECTION_TARGET', '连接目标必须是有效的 HTTP 或 HTTPS URL。')
  }
  return endpoint
}

function optionalSecret(value: unknown): string | undefined {
  if (value === undefined || value === '') return undefined
  if (typeof value !== 'string' || value.length > 65_536 || value.trim() === '') {
    throw apiError('INVALID_CONNECTION_SECRET', '密钥格式无效。')
  }
  return value
}

function requiredText(value: unknown, label: string, maxLength: number): string {
  const result = boundedText(value, '', maxLength)
  if (result === '') throw apiError('REQUIRED_FIELD', `${label}不能为空。`)
  return result
}

function endpointDisplay(kind: ConnectionKind, transport: 'streamable-http' | 'stdio'): string {
  if (kind === 'feishu-bot') return '飞书 Webhook 已保存（不回显）'
  if (kind === 'wechat-work-bot') return '企业微信 Webhook 已保存（不回显）'
  if (kind === 'mcp' && transport === 'stdio') return 'stdio 启动命令已保存（不回显）'
  if (kind === 'mcp') return 'MCP URL 已保存（不回显）'
  if (kind === 'model') return '模型 API 地址已保存（不回显）'
  return 'Webhook 目标已保存（不回显）'
}

async function setCredential(credentials: CredentialsLike, reference: string, value: string): Promise<void> {
  try {
    await credentials.set(reference, value)
  } catch {
    throw apiError('CREDENTIAL_WRITE_FAILED', '凭据无法写入；请检查是否被只读环境变量覆盖。', 409)
  }
}

async function unsetCredential(credentials: CredentialsLike, reference: string): Promise<void> {
  try {
    await credentials.unset(reference)
  } catch {
    throw apiError('CREDENTIAL_DELETE_FAILED', '凭据无法删除；请检查是否被只读环境变量覆盖。', 409)
  }
}

async function describeCredential(credentials: CredentialsLike, reference: string): Promise<CredentialInfo> {
  try {
    return await credentials.describe(reference)
  } catch {
    throw apiError('CREDENTIAL_STATUS_FAILED', '无法读取凭据配置状态。', 500)
  }
}

function packageDescription(packageRequire: NodeJS.Require, packageName: string): string | undefined {
  try {
    const manifest = packageRequire(`${packageName}/package.json`) as { description?: unknown }
    if (typeof manifest.description !== 'string') return undefined
    const description = manifest.description.trim().replace(/\s+/gu, ' ')
    return description === '' ? undefined : description.slice(0, 300)
  } catch {
    return undefined
  }
}

function defaultPluginCategory(packageName: string): string {
  if (packageName.startsWith('@cyrus/')) return '个人扩展'
  if (packageName.startsWith('@deepseek-ai/')) return 'Harness 官方'
  return '第三方插件'
}

function defaultPluginDescription(packageName: string): string {
  if (packageName.startsWith('@cyrus/')) return '个人桌面环境的扩展组件。'
  if (packageName.startsWith('@deepseek-ai/')) return 'DeepSeek Harness 随附的官方组件。'
  return '由当前 Harness 配置加载的第三方组件。'
}

function fiberPhase(state: number): FiberPhase {
  return (['pending', 'loading', 'active', 'failed', null, 'unloading'] as const)[state] ?? null
}

function methodNotAllowed(): Error & { code: string; status: number } {
  return apiError('METHOD_NOT_ALLOWED', '此接口不支持该请求方法。', 405)
}

function errorStatus(error: unknown): number {
  const status = (error as { status?: unknown } | null)?.status
  return typeof status === 'number' && status >= 400 && status <= 599 ? status : 500
}

function errorCode(error: unknown, status: number): string {
  const code = (error as { code?: unknown } | null)?.code
  return typeof code === 'string' && code !== '' ? code : status >= 500 ? 'INTERNAL_ERROR' : 'BAD_REQUEST'
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message !== '' ? error.message : '请求失败。'
}

/** 供兄弟插件按文件路径加载连接存储（源码态与打包态都不存在包名解析链）。 */
export { PersonalStore } from './store.ts'
