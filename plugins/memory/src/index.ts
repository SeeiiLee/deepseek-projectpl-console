/**
 * @cyrus/dsh-memory — P1 最小存储：分片 SQLite + FTS5 + 显式工具。
 * 边界：dbRoot 未配置时用系统临时目录（开发/夹具阶段）；真实数据目录与加密在后续阶段按合同落地。
 * 工具全部 Host 侧有界：参数白名单、长度上限、scope 硬过滤、写入门禁。
 */
import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { join, resolve } from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import z from '@deepseek-ai/schemastery'
import {
  buildBatches,
  callCostYuan,
  locatorTextReader,
  readStagingPackage,
  runExtraction,
  sampleSessions,
} from './core/codex-import-extractor.ts'
import { createMemoryContextRequestHandler, MEMORY_CONTEXT_API_PREFIX } from './core/context-bridge.ts'
import { EmbeddingRuntime } from './core/embedding.ts'
import { readEmbeddingManifest, verifyEmbeddingManifest, type EmbeddingManifest } from './core/embedding-manifest.ts'
import { drainEmbeddings, embeddingScopes } from './core/embedding-pipeline.ts'
import { EMBEDDING_RUNTIME_VERSIONS, renderEmbeddingStatus } from './core/embedding-status.ts'
import type { ExtractionConnection } from './core/extractor.ts'
import { loadFoundationStoreConstructor } from './core/foundation-runtime.ts'
import { officialExtractionConnection } from './core/official-fallback.ts'
import { buildQuickPassText, classifyRecordIntent, needsMemory, normalizedHash } from './core/gates.ts'
import { vectorCandidates } from './core/hybrid.ts'
import { MemoryService } from './core/service.ts'
import { createTurnEndExtractor, type AgentSessionLike, type ExtractionRuntimeLike, type TurnEventLike } from './core/turn-extractor.ts'

interface ToolsLike {
  register(definition: unknown): void
}

interface ContentBlockLike { type?: string; text?: string }
interface MessageLike { content?: ContentBlockLike[] }
interface SessionEventLike { type?: string; content?: MessageLike }
interface PreStepAgentLike { session?: { events?: SessionEventLike[] } }
type DecisionLike = { messages?: unknown[] }

interface CredentialInfoLike { configured: boolean }
interface CredentialsLike {
  describe(reference: string): Promise<CredentialInfoLike>
  resolve(reference: string): Promise<{ value: string; source?: string } | undefined>
}

interface WebServerLike {
  register(route: {
    kind: 'prefix'
    path: string
    handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>
  }): () => void
}

/** 结构子集：personal-suite 连接行。 */
interface ModelConnectionRow {
  id: string
  label: string
  kind: string
  enabled: boolean
  endpointRef: string
  secretRef: string
}

interface ModelConnectionStore {
  read(): Promise<{ connections: readonly ModelConnectionRow[] }>
}

interface SystemPromptLike {
  section(entry: { name: string; order: number; text: string }): void
}

interface HostContextLike {
  tools: ToolsLike
  systemPrompt: SystemPromptLike
  webServer: WebServerLike
  credentials: CredentialsLike
  effect(factory: () => (() => void) | void, label?: string): void
  on(event: 'agent/pre-step', handler: (payload: { agent?: PreStepAgentLike }, next: () => Promise<DecisionLike>) => Promise<DecisionLike>): void
  on(event: 'session/event', handler: (session: AgentSessionLike, event: TurnEventLike) => void): void
}

/** Plugin configuration. */
export interface Config {
  /** 记忆库根目录；空 = 系统临时目录（开发/夹具阶段）。 */
  dbRoot?: string
  /** 静态加密（SQLCipher + DPAPI 数据密钥 + 恢复口令）；默认开启，真实数据防护门槛。 */
  encryptionEnabled?: boolean
  /** 自动 quick-pass（agent/pre-step 注入）；默认关闭，验证后按项目启用。 */
  quickPassEnabled?: boolean
  /** quick-pass 注入字节预算。 */
  quickPassMaxBytes?: number
  /** quick-pass 注入条目上限。 */
  quickPassMaxItems?: number
  /** 启动自检：打开 catalog 并做完整性校验（冒烟/打包验证用，失败即拒绝启动）。 */
  selfTest?: boolean
  /** P3：候选自动过期天数（1–90，默认 14）。 */
  candidateTtlDays?: number
  /** P3：维护任务间隔秒（默认 3600 = 每小时跑一次过期清理）。 */
  maintenanceIntervalSeconds?: number
  /** P3-2：自动候选提取（session/event 轮末触发）；默认关闭，开发版/试点项目开启。 */
  extractionEnabled?: boolean
  /** P3-2：提取模型名（默认 deepseek-v4-flash，非思考小模型）。 */
  extractionModel?: string
  /** P3-2：无「记忆提取」连接时回退到 DeepSeek 官方接口 + DEEPSEEK_API_KEY（开发版默认密钥）；默认开启，DSH_MEMORY_EXTRACTION_OFFICIAL=0 关闭。 */
  extractionOfficialFallback?: boolean
  /** P3-2：提取上下文预算（字符，默认 1500）。 */
  extractionMaxContextChars?: number
  /** P3-2：提取调用超时（毫秒，默认 30 000）。 */
  extractionTimeoutMs?: number
  /** P4-2：向量嵌入（worker 内 ONNX，默认关闭；功能门通过前不接入召回）。 */
  embeddingEnabled?: boolean
  /** P4-2：本地 ONNX 模型目录（含 MODEL_MANIFEST.json）。 */
  embeddingModelDir?: string
  /** P4-2：hybrid 召回（FTS+向量 RRF 融合）；默认开（Cyrus 拍板：开发版/稳定版都开），DSH_MEMORY_HYBRID=0 一键关断。 */
  hybridRecallEnabled?: boolean
}

export const Config: z<Config> = z.object({
  dbRoot: z.string().default(''),
  encryptionEnabled: z.boolean().default(true),
  quickPassEnabled: z.boolean().default(process.env.DSH_MEMORY_QUICKPASS === '1'),
  quickPassMaxBytes: z.number().min(200).max(8000).default(2000),
  quickPassMaxItems: z.number().min(1).max(5).default(3),
  selfTest: z.boolean().default(process.env.DSH_MEMORY_SELF_TEST === '1'),
  candidateTtlDays: z.number().min(1).max(90).default(14),
  maintenanceIntervalSeconds: z.number().min(60).max(86400).default(3600),
  extractionEnabled: z.boolean().default(process.env.DSH_MEMORY_EXTRACTION === '1'),
  extractionModel: z.string().default(process.env.DSH_MEMORY_EXTRACTION_MODEL || 'deepseek-v4-flash'),
  extractionOfficialFallback: z.boolean().default(process.env.DSH_MEMORY_EXTRACTION_OFFICIAL !== '0'),
  extractionMaxContextChars: z.number().min(200).max(8000).default(1500),
  extractionTimeoutMs: z.number().min(5000).max(120000).default(30000),
  embeddingEnabled: z.boolean().default(process.env.DSH_MEMORY_EMBEDDING === '1'),
  embeddingModelDir: z.string().default(process.env.DSH_MEMORY_EMBEDDING_MODEL_DIR || ''),
  hybridRecallEnabled: z.boolean().default(process.env.DSH_MEMORY_HYBRID !== '0'),
})

export const inject = ['tools', 'systemPrompt', 'webServer', 'credentials']
export const name = 'cyrus-memory'

/** 工具路由指引（order 150：工具指南带），让「记住/之前」类请求可靠路由到记忆工具。 */
export const MEMORY_GUIDANCE_TEXT = [
  '长期记忆工具使用约定：',
  '- 用户说「记住…/记一下…」时，先做前置归类再写入：项目专属（客户/业务/项目架构/该项目坑）→ scope=project + kind=project_fact/event；跨项目通用（开发规范/通用教训/方法/偏好）→ scope=global_user + kind=global_fact/pattern/skill/user_profile；拿不准先 memory_classify 要建议。',
  '- 硬规则：project_fact/event/task 禁止写入 global_user（会被拒绝）；项目未登记时说明并询问，禁止擅自降级落全局。项目事故含通用教训时，主记录为项目 event，经用户同意另存全局 pattern。',
  '- 涉及「之前/上次/按约定/经验/坑」的提问，先 memory_summary 看紧凑摘要，需要细节再 memory_query。',
  '- memory_query/memory_summary 返回的是历史参考，可能过时；回答要带「这是历史记忆、可能过时」的口吻，并与当前事实核对。',
  '- P3 候选治理：自动提取的候选先经 memory_candidates 查看，memory_review 确认（confirm）或拒绝（reject）；14 天不处理自动过期。memory_pause(on=true) 可暂停自动候选与自动召回。',
  '- P3-2 自动提取（试点）：轮末自动从会话提取候选（≤2 条，text-only）；Project Control 控制台打开项目时自动绑定会话→项目，未绑定只提取全局 pattern 类。',
].join('\n')

const TEXT_OUTPUT = { type: 'string' } as const
const renderText = (_args: unknown, value: unknown): Array<{ type: 'text'; text: string }> => [
  { type: 'text', text: String(value ?? '') },
]

export function resolveDbRoot(config: Config | undefined): string {
  const configured = typeof config?.dbRoot === 'string' ? config.dbRoot.trim() : ''
  if (configured !== '') return resolve(configured)
  const fromEnv = process.env.DSH_MEMORY_ROOT?.trim()
  if (fromEnv !== undefined && fromEnv !== '') return resolve(fromEnv)
  return resolve(join(tmpdir(), 'dsh-memory-dev'))
}

function lastUserText(events: SessionEventLike[] | undefined): string {
  if (events === undefined) return ''
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type !== 'user/message') continue
    const parts: string[] = []
    for (const block of event.content?.content ?? []) {
      if (block.type === 'text' && typeof block.text === 'string') parts.push(block.text)
    }
    return parts.join('\n')
  }
  return ''
}

/** quick-pass 注入包：需求门 + 有界召回 + 不可信标记（ephemeral，不落历史）。 */
export function buildQuickPassMessage(recallText: string, maxBytes: number): { message: unknown; truncated: boolean } | null {
  const built = buildQuickPassText(recallText, maxBytes)
  if (built === null) return null
  const message = createUserMessage({
    content: [{ type: 'text', text: built.text }],
    source: { kind: 'plugin', plugin: 'cyrus-memory', form: 'notice', summary: 'memory quick-pass recall' },
  })
  return { message, truncated: built.truncated }
}

export function apply(ctx: HostContextLike, config: Config = {}): void {
  const service = new MemoryService({
    dbRoot: resolveDbRoot(config),
    encrypted: config.encryptionEnabled === true,
    ...(config.candidateTtlDays === undefined ? {} : { candidateTtlDays: config.candidateTtlDays }),
  })
  if (config.selfTest === true) {
    // 启动自检：真实走一遍密钥解锁 + 密文库打开 + 完整性校验；任何一步失败都拒绝启动。
    service.selfTest()
  }
  ctx.systemPrompt.section({ name: 'tool:memory', order: 150, text: MEMORY_GUIDANCE_TEXT })
  const quickPassEnabled = config.quickPassEnabled === true
  const quickPassMaxBytes = Math.max(200, Math.min(8000, Number(config.quickPassMaxBytes ?? 2000) || 2000))
  const quickPassMaxItems = Math.max(1, Math.min(5, Number(config.quickPassMaxItems ?? 3) || 3))
  const maintenanceInterval = Math.max(60, Math.min(86_400, Number(config.maintenanceIntervalSeconds ?? 3600) || 3600)) * 1000
  ctx.effect(() => {
    const timer = setInterval(() => {
      try { service.expireCandidates() } catch { /* 维护失败不打断主流程 */ }
    }, maintenanceInterval)
    timer.unref?.()
    return () => {
      clearInterval(timer)
      if (embedding.runtime !== null) void embedding.runtime.close().catch(() => {})
      service.close()
    }
  }, 'dsh-memory: maintenance + close service')

  // ---- P4-2 向量嵌入：合同 + 懒运行时 + 回填 drain +（hybrid 召回默认关，功能门通过后开启） ----
  const embeddingEnabled = config.embeddingEnabled === true
  const hybridRecallEnabled = config.hybridRecallEnabled === true
  const embeddingModelDir = typeof config.embeddingModelDir === 'string' ? config.embeddingModelDir.trim() : ''
  const embedding = { runtime: null as EmbeddingRuntime | null }
  let embeddingManifest: EmbeddingManifest | null = null
  let embeddingManifestError = ''
  let embeddingGenerationValue = ''
  if (embeddingEnabled && embeddingModelDir !== '') {
    const manifest = readEmbeddingManifest(embeddingModelDir)
    if (manifest === null) {
      embeddingManifestError = 'MODEL_MANIFEST.json 缺失或形状非法'
    } else {
      const verified = verifyEmbeddingManifest(embeddingModelDir, manifest, EMBEDDING_RUNTIME_VERSIONS, false)
      if (verified.ok === true && verified.generation !== undefined) {
        embeddingManifest = manifest
        embeddingGenerationValue = verified.generation
      } else {
        embeddingManifestError = verified.error ?? '未知校验错误'
      }
    }
  }
  const getEmbeddingRuntime = (): EmbeddingRuntime => {
    if (embedding.runtime === null) {
      if (embeddingManifest === null) throw new Error('embedding manifest 无效：' + (embeddingManifestError || '未找到'))
      embedding.runtime = new EmbeddingRuntime({ modelDir: embeddingModelDir, manifest: embeddingManifest, generation: embeddingGenerationValue })
    }
    return embedding.runtime
  }
  const embeddingJobsStats = (): { pending: number; ready: number; failed: number; stale: number } => {
    if (!embeddingEnabled || embeddingManifest === null) return { pending: 0, ready: 0, failed: 0, stale: 0 }
    const total = { pending: 0, ready: 0, failed: 0, stale: 0 }
    for (const target of embeddingScopes(service)) {
      try {
        const stats = service.embeddingStats(target.scope, target.projectId)
        total.pending += stats.pending; total.ready += stats.ready; total.failed += stats.failed; total.stale += stats.stale
      } catch { /* 分片未创建等，忽略 */ }
    }
    return total
  }
  // 回填 drain：懒加载 worker、批处理、失败只记作业状态（后台低优先级，绝不外抛）。
  let drainRunning = false
  let loggedEmbeddingReady = false
  const embeddingLastDrain = { text: '未运行', at: '' }
  const drainOnce = (): void => {
    if (!embeddingEnabled || embeddingManifest === null || drainRunning) return
    drainRunning = true
    void (async () => {
      try {
        const result = await drainEmbeddings(service, getEmbeddingRuntime(), {
          providerId: 'local-onnx',
          modelId: embeddingManifest.modelId,
          modelRevision: embeddingManifest.source.revision,
          dimensions: embeddingManifest.dimensions,
          generation: embeddingGenerationValue,
          contentHashOf: (text) => normalizedHash(text),
        })
        embeddingLastDrain.text = 'seen ' + String(result.seen) + ' → embedded ' + String(result.embedded) + ' / failed ' + String(result.failed) + ' / skipped ' + String(result.skipped) + ' / retired ' + String(result.retired)
        embeddingLastDrain.at = new Date().toISOString()
        if (!loggedEmbeddingReady && embedding.runtime !== null && embedding.runtime.stateText() === 'ready') {
          loggedEmbeddingReady = true
          console.log('[dsh-memory] 向量嵌入 worker 就绪（' + embeddingManifest.modelId + '，generation ' + embeddingGenerationValue + '）')
        }
      } catch (error) {
        embeddingLastDrain.text = '失败：' + (error instanceof Error && error.message !== '' ? error.message : String(error))
        embeddingLastDrain.at = new Date().toISOString()
        console.warn('[dsh-memory] 嵌入回填失败：' + embeddingLastDrain.text)
      }
      finally { drainRunning = false }
    })()
  }
  if (embeddingEnabled && embeddingManifest !== null) {
    ctx.effect(() => {
      const first = setTimeout(() => { drainOnce() }, 3000)
      const timer = setInterval(() => { drainOnce() }, 30_000)
      first.unref?.()
      timer.unref?.()
      return () => { clearTimeout(first); clearInterval(timer) }
    }, 'dsh-memory: embedding backfill drain')
  }

  // ---- P3-2 项目绑定桥：Project Control 控制台 → 会话↔项目绑定 + 新增项目自动登记 ----
  const projectBindings = new Map<string, string | undefined>()
  ctx.effect(() => {
    const unregister = ctx.webServer.register({
      kind: 'prefix',
      path: MEMORY_CONTEXT_API_PREFIX,
      handler: createMemoryContextRequestHandler({ service, bindings: projectBindings }),
    })
    return () => { unregister() }
  }, 'dsh-memory: project context bridge')

  // ---- P3-2 轮末自动提取：懒加载「记忆提取」连接，fire-and-forget，绝不打断会话 ----
  const extractionStats = {
    paused: 0,
    gateSkip: 0,
    noConnection: 0,
    ok: 0,
    failed: 0,
    lastDetail: '暂无',
  }
  if (config.extractionEnabled === true) {
    const extractionModel = typeof config.extractionModel === 'string' && config.extractionModel.trim() !== ''
      ? config.extractionModel.trim()
      : (process.env.DSH_MEMORY_EXTRACTION_MODEL || 'deepseek-chat')
    const extractionMaxContextChars = Math.max(200, Math.min(8000, Number(config.extractionMaxContextChars ?? 1500) || 1500))
    const extractionTimeoutMs = Math.max(5000, Math.min(120_000, Number(config.extractionTimeoutMs ?? 30_000) || 30_000))
    let runtimePromise: Promise<ExtractionRuntimeLike> | null = null
    const extractor = createTurnEndExtractor({
      service,
      runtime: () => {
        runtimePromise ??= openExtractionRuntime(ctx.credentials, config.extractionOfficialFallback !== false)
        return runtimePromise
      },
      bindings: projectBindings,
      model: extractionModel,
      maxContextChars: extractionMaxContextChars,
      timeoutMs: extractionTimeoutMs,
      // 决策：提取不思考（官方最低强度，与 session-title 同类轻量任务一致）
      disableThinking: true,
      onOutcome: (outcome) => {
        extractionStats.lastDetail = outcome.detail
        if (outcome.kind === 'paused') extractionStats.paused += 1
        else if (outcome.kind === 'gate-skip') extractionStats.gateSkip += 1
        else if (outcome.kind === 'no-connection') extractionStats.noConnection += 1
        else if (outcome.kind === 'ok') extractionStats.ok += 1
        else extractionStats.failed += 1
        if (outcome.kind === 'failed') {
          // 提取失败只进宿主日志与 memory_status，绝不上抛到会话。
          console.warn('[dsh-memory] 自动候选提取失败：' + outcome.detail)
        }
      },
    })
    ctx.on('session/event', (session, event) => {
      extractor.onEvent(session, event)
    })
  }

  if (quickPassEnabled) {
    ctx.on('agent/pre-step', async (payload, next) => {
      const decision = await next()
      try {
        if (service.isPaused()) return decision // memory_pause on：暂停自动召回
        const text = lastUserText(payload.agent?.session?.events)
        if (!needsMemory(text)) return decision
        const recall = service.query({ q: text, limit: quickPassMaxItems })
        const built = buildQuickPassMessage(recall, quickPassMaxBytes)
        if (built === null) return decision
        return { ...decision, messages: [...(decision.messages ?? []), built.message] }
      } catch {
        return decision
      }
    })
  }

  const tools = ctx.tools

  tools.register(defineTool({
    name: 'memory_record',
    description: '记录一条长期记忆。scope=global_user 为跨项目用户偏好；scope=project 需要已登记的 project_id。首次写入为候选（candidate），回传 confirm=true 确认写入。敏感内容（凭据/身份证/银行卡）会被硬拒绝。',
    parameters: {
      kind: { type: 'string', required: true, enum: ['event', 'project_fact', 'global_fact', 'user_profile', 'skill', 'task', 'pattern'], description: '记忆类型白名单' },
      text: { type: 'string', required: true, description: '记忆内容（1–3 句，≤4000 字符）' },
      scope: { type: 'string', required: true, enum: ['global_user', 'project'], description: '归属范围' },
      project_id: { type: 'string', description: 'scope=project 时必填；必须是已登记项目' },
      evidence: { type: 'string', description: '可选来源说明（locator 或用户确认描述）' },
      confirm: { type: 'boolean', description: 'true = 确认写入（active + user_confirmed）；缺省为候选' },
    },
    output: { schema: TEXT_OUTPUT, render: renderText },
    timeoutMs: 10_000,
    async execute(args) {
      return service.record({ kind: args.kind, text: args.text, scope: args.scope, projectId: args.project_id, evidence: args.evidence, confirm: args.confirm })
    },
  }))

  tools.register(defineTool({
    name: 'memory_query',
    description: '按关键词检索长期记忆（FTS5，scope 硬过滤，不跨项目）。结果标记为不可信历史参考，不得当作当前事实。',
    parameters: {
      q: { type: 'string', required: true, description: '查询文本' },
      scope: { type: 'string', enum: ['global_user', 'project'], description: '缺省：有 project_id 则按项目，否则 global_user' },
      project_id: { type: 'string', description: '项目范围' },
      limit: { type: 'integer', description: '1–10，缺省 5' },
    },
    output: { schema: TEXT_OUTPUT, render: renderText },
    timeoutMs: 30_000,
    async execute(args) {
      const q = String(args.q ?? '')
      const base = { q, scope: args.scope, projectId: args.project_id, limit: args.limit }
      if (hybridRecallEnabled && embeddingManifest !== null && q.trim() !== '') {
        try {
          const runtime = getEmbeddingRuntime()
          const query = await runtime.embed([q], 'query')
          const scope = args.scope === 'project' || (args.project_id !== undefined && args.project_id !== '') ? 'project' : 'global_user'
          const docs = service.activeEmbeddingVectors(scope, args.project_id, embeddingGenerationValue)
          // 语义下限筛选：全噪声查询（如「火花塞」）不产生任何候选，语义通道不参与 → 走纯 FTS
          const { ranked, topScore } = vectorCandidates(query.vectors, docs)
          if (ranked.length === 0) return service.query(base)
          return service.query({ ...base, vectorRanked: ranked, vectorTopScore: topScore })
        } catch {
          return service.query(base) // 降级：embedding 不可用 → 纯 FTS
        }
      }
      return service.query(base)
    },
  }))

  tools.register(defineTool({
    name: 'memory_classify',
    description: '前置归类建议（只读，不写入）：判断一条「记住」内容应是项目级还是全局、该用什么 kind，并给出理由与可选的双记录建议。',
    parameters: {
      text: { type: 'string', required: true, description: '用户想记住的内容原文' },
      project_hint: { type: 'string', description: '若已知所属项目（名称或 project_id），传进来提高准确度' },
    },
    output: { schema: TEXT_OUTPUT, render: renderText },
    timeoutMs: 10_000,
    async execute(args) {
      const suggestion = classifyRecordIntent(args.text, args.project_hint)
      const lines = [
        '归类建议（未写入）：',
        'scope: ' + suggestion.scope + '  kind: ' + suggestion.kind,
        '理由: ' + suggestion.reason,
      ]
      if (suggestion.dual !== undefined) {
        lines.push('可另存第二条：scope: ' + suggestion.dual.scope + '  kind: ' + suggestion.dual.kind + '（' + suggestion.dual.reason + '）')
      }
      return lines.join('\n')
    },
  }))

  tools.register(defineTool({
    name: 'memory_summary',
    description: '渐进披露第一层：紧凑摘要（active 计数、重要条目、最近更新、冲突对，≤4KB）。先看摘要，需要细节再用 memory_query。',
    parameters: {
      scope: { type: 'string', enum: ['global_user', 'project'], description: '缺省：有 project_id 则按项目，否则 global_user' },
      project_id: { type: 'string' },
      limit: { type: 'integer', description: '重要条目数 1–10，缺省 5' },
    },
    output: { schema: TEXT_OUTPUT, render: renderText },
    timeoutMs: 10_000,
    async execute(args) {
      return service.summary({ scope: args.scope, projectId: args.project_id, limit: args.limit })
    },
  }))

  tools.register(defineTool({
    name: 'memory_pause',
    description: '暂停/恢复自动候选与自动召回（quick-pass）。on=true 暂停，on=false 恢复。仅影响自动行为，显式 memory_record/query 不受影响。',
    parameters: {
      on: { type: 'boolean', required: true, description: 'true = 暂停自动候选与自动召回；false = 恢复' },
    },
    output: { schema: TEXT_OUTPUT, render: renderText },
    timeoutMs: 10_000,
    async execute(args) {
      const paused = service.setPaused(args.on === true)
      return paused ? '已暂停自动候选与自动召回（显式记录/查询不受影响）。' : '已恢复自动候选与自动召回。'
    },
  }))

  tools.register(defineTool({
    name: 'memory_candidates',
    description: '列出待处理候选记忆（status=candidate，最老优先，含到期时间）。配合 memory_review 确认或拒绝；14 天不处理自动过期。',
    parameters: {
      scope: { type: 'string', enum: ['global_user', 'project'], description: '缺省：有 project_id 则按项目，否则 global_user' },
      project_id: { type: 'string' },
      limit: { type: 'integer', description: '1–50，缺省 10' },
    },
    output: { schema: TEXT_OUTPUT, render: renderText },
    timeoutMs: 10_000,
    async execute(args) {
      return service.listCandidates({ scope: args.scope, projectId: args.project_id, limit: args.limit })
    },
  }))

  tools.register(defineTool({
    name: 'memory_review',
    description: '评审一条候选：decision=confirm 转为 active + user_confirmed；decision=reject 归档（退出候选队列与默认召回）。会写入 promotion 评审记录。',
    parameters: {
      id: { type: 'string', required: true, description: '候选 id（来自 memory_candidates）' },
      decision: { type: 'string', required: true, enum: ['confirm', 'reject'] },
      scope: { type: 'string', enum: ['global_user', 'project'], description: '候选所在范围；缺省：有 project_id 则按项目，否则 global_user' },
      project_id: { type: 'string' },
      rationale: { type: 'string', description: '可选评审理由（≤500 字符）' },
    },
    output: { schema: TEXT_OUTPUT, render: renderText },
    timeoutMs: 10_000,
    async execute(args) {
      return service.reviewCandidate({ id: args.id, decision: args.decision === 'reject' ? 'reject' : 'confirm', scope: args.scope, projectId: args.project_id, rationale: args.rationale })
    },
  }))

  tools.register(defineTool({
    name: 'memory_list',
    description: '列出记忆条目（可按 kind/status 过滤）。',
    parameters: {
      scope: { type: 'string', enum: ['global_user', 'project'], description: '缺省：有 project_id 则按项目，否则 global_user' },
      project_id: { type: 'string' },
      kind: { type: 'string' },
      status: { type: 'string', enum: ['candidate', 'active', 'disputed', 'superseded', 'archived'] },
      limit: { type: 'integer', description: '1–50，缺省 20' },
    },
    output: { schema: TEXT_OUTPUT, render: renderText },
    timeoutMs: 10_000,
    async execute(args) {
      return service.list({ scope: args.scope, projectId: args.project_id, kind: args.kind, status: args.status, limit: args.limit })
    },
  }))

  tools.register(defineTool({
    name: 'memory_status',
    description: '记忆库健康状态：目录、分片、schemaVersion、active 条数、FTS 行数、自动提取统计（P3-2）。',
    parameters: {
      verbose: { type: 'boolean', description: 'true 时输出各分片条目数明细' },
    },
    output: { schema: TEXT_OUTPUT, render: renderText },
    timeoutMs: 10_000,
    async execute() {
      return service.status()
        + '\n' + renderExtractionStats(config, extractionStats, extractionModelText(config))
        + '\n' + renderEmbeddingStatus({
          enabled: embeddingEnabled,
          modelDir: embeddingModelDir,
          manifest: embeddingManifest === null ? null : { modelId: embeddingManifest.modelId, dimensions: embeddingManifest.dimensions, dtype: embeddingManifest.dtype, pooling: embeddingManifest.pooling },
          manifestError: embeddingManifestError,
          generation: embeddingGenerationValue,
          workerState: embedding.runtime === null ? '未加载（首次嵌入时懒加载）' : embedding.runtime.stateText(),
          workerError: embedding.runtime === null ? '' : embedding.runtime.lastErrorText(),
          jobs: embeddingJobsStats(),
          hybridEnabled: hybridRecallEnabled,
          lastDrain: embeddingLastDrain.at === '' ? '未运行' : embeddingLastDrain.text + '（' + embeddingLastDrain.at.slice(11, 19) + '）',
        })
    },
  }))

  tools.register(defineTool({
    name: 'memory_explain',
    description: '解释某条记忆：来源证据、状态、提升记录、被召回次数。',
    parameters: {
      id: { type: 'string', required: true, description: '条目 id' },
    },
    output: { schema: TEXT_OUTPUT, render: renderText },
    timeoutMs: 10_000,
    async execute(args) {
      return service.explain(args.id)
    },
  }))

  tools.register(defineTool({
    name: 'memory_correct',
    description: '修正一条记忆：写入新条目（active + user_confirmed）并让旧条目 superseded，保留取代链。',
    parameters: {
      id: { type: 'string', required: true },
      corrected_text: { type: 'string', required: true, description: '修正后的内容（≤4000 字符）' },
    },
    output: { schema: TEXT_OUTPUT, render: renderText },
    timeoutMs: 10_000,
    async execute(args) {
      return service.correct(args.id, args.corrected_text)
    },
  }))

  // P6-1：项目重置（预览 + 双重确认令牌 + 审计回执）
  const resetTokens = new Map<string, { token: string; expiresAt: number }>()
  tools.register(defineTool({
    name: 'memory_reset_project',
    description: '项目级重置：preview 看条目构成并生成确认令牌；execute 回传令牌与 mode（archive=全部转归档保留审计 / delete=逐条 tombstone 后物理删除，不可逆）完成重置。项目必须先登记。',
    parameters: {
      action: { type: 'string', required: true, enum: ['preview', 'execute'], description: 'preview=预览并生成令牌；execute=执行' },
      project_id: { type: 'string', required: true, description: '项目 id（必须已登记）' },
      mode: { type: 'string', enum: ['archive', 'delete'], description: 'execute 时必填：archive 或 delete' },
      confirm_token: { type: 'string', description: 'execute 时必填：preview 返回的令牌' },
      reason: { type: 'string', description: '可选：重置原因（进审计回执）' },
    },
    output: { schema: TEXT_OUTPUT, render: renderText },
    timeoutMs: 30_000,
    async execute(args) {
      const projectId = String(args.project_id ?? '').trim()
      if (projectId === '') throw new Error('必须提供 project_id。')
      if (args.action === 'preview') {
        const preview = service.resetProjectPreview(projectId)
        const token = randomBytes(6).toString('hex')
        resetTokens.set(projectId, { token, expiresAt: Date.now() + 10 * 60_000 })
        return [
          '项目重置预览（project: ' + projectId + '）：',
          '  条目总数 ' + String(preview.total) + '（active ' + String(preview.active) + ' / candidate ' + String(preview.candidates) + ' / archived ' + String(preview.archived) + ' / tombstones ' + String(preview.tombstones) + '）',
          '确认令牌：' + token + '（10 分钟内有效）',
          '执行：再次调用 memory_reset_project，action=execute，回传 project_id / confirm_token / mode（archive 或 delete）。',
          '警告：delete 不可逆（逐条 tombstone 后物理删除）；archive 保留审计可追溯。',
        ].join('\n')
      }
      // execute
      const mode = args.mode === 'delete' ? 'delete' : 'archive'
      const token = String(args.confirm_token ?? '').trim()
      const held = resetTokens.get(projectId)
      if (token === '' || held === undefined || held.token !== token || held.expiresAt < Date.now()) {
        throw new Error('确认令牌无效或已过期：先 action=preview 获取新令牌。')
      }
      resetTokens.delete(projectId)
      return service.resetProject(projectId, { mode, confirmToken: token, ...(args.reason === undefined ? {} : { reason: String(args.reason) }) })
    },
  }))

  tools.register(defineTool({
    name: 'memory_archive',
    description: '归档一条记忆（退出默认召回，保留审计；不可逆语义与删除不同）。',
    parameters: {
      id: { type: 'string', required: true },
      reason: { type: 'string', description: '归档原因（进审计）' },
    },
    output: { schema: TEXT_OUTPUT, render: renderText },
    timeoutMs: 10_000,
    async execute(args) {
      return service.archive(args.id, args.reason)
    },
  }))

  tools.register(defineTool({
    name: 'memory_export',
    description: '导出记忆包（JSONL + manifest + 哈希；evidence.local_locator 一律省略）。',
    parameters: {
      scope: { type: 'string', enum: ['global_user', 'project'], description: '缺省：有 project_id 则按项目，否则 global_user' },
      project_id: { type: 'string' },
    },
    output: { schema: TEXT_OUTPUT, render: renderText },
    timeoutMs: 30_000,
    async execute(args) {
      return service.exportPackage({ scope: args.scope, projectId: args.project_id })
    },
  }))

  // P6-0C：Codex 历史候选提取（试点批次；dry-run 默认零成本零写入）
  tools.register(defineTool({
    name: 'memory_import_codex',
    description: '从 Codex 历史 staging 包提取候选记忆（食溯试点）。默认 dry_run=true：零成本零写入，只报抽样/批次/成本预估；dry_run=false 时按项目写入候选队列（candidate + llm_extracted，带 codex:// 证据），有成本硬上限与空闲时段闸门。',
    parameters: {
      package_dir: { type: 'string', required: true, description: 'codex-import dry-run 输出包目录（含 sessions.jsonl / turn-index.jsonl）' },
      project_id: { type: 'string', description: 'dry_run=false 时必填：目标项目 id（已登记）' },
      sample: { type: 'integer', description: '抽样会话数，缺省 20（1–100）' },
      budget_yuan: { type: 'number', description: '成本硬上限（元），缺省 0.5（0.1–5）' },
      dry_run: { type: 'boolean', description: 'true=只预演（默认）；false=正式提取并写入候选' },
      off_peak_only: { type: 'boolean', description: '只在空闲时段执行（默认 true，高峰自动暂停）' },
    },
    output: { schema: TEXT_OUTPUT, render: renderText },
    timeoutMs: 600_000,
    async execute(args) {
      const packageDir = String(args.package_dir ?? '').trim()
      if (packageDir === '' || !existsSync(packageDir)) throw new Error('package_dir 无效：先跑 scripts/codex-import-dryrun.mjs 生成 staging 包。')
      const { sessions, turns } = readStagingPackage(packageDir)
      const sample = Math.min(Math.max(Number(args.sample ?? 20) || 20, 1), 100)
      const sampled = sampleSessions(sessions, { projectLabel: '食溯(mealtracker)', count: sample })
      const batches = buildBatches(sampled, turns)
      const estCalls = batches.length
      const estChars = batches.reduce((sum, batch) => sum + batch.chars, 0)
      const estYuan = callCostYuan({ missIn: Math.round(estChars * 0.6) + estCalls * 800, out: estCalls * 400 })
      const lines = [
        'Codex 历史提取（试点批次，食溯）：',
        '  抽样会话：' + String(sampled.length) + ' / 预计调用：' + String(estCalls),
        '  源码字符：' + String(estChars) + ' / 预计成本：￥' + estYuan.toFixed(2) + '（空闲时段官方价；缓存命中只会更低）',
        '  预计候选：' + String(Math.round(estCalls * 2.5)) + ' 条（全部 candidate，人工确认后才 active）',
      ]
      if (args.dry_run !== false) {
        lines.push('dry-run：未调用模型、未写记忆库。')
        return lines.join('\n')
      }
      const projectId = String(args.project_id ?? '').trim()
      if (projectId === '') throw new Error('正式提取必须提供 project_id（fail closed）。')
      if (!service.listRegisteredProjects().includes(projectId)) {
        throw new Error('项目 ' + projectId + ' 未在记忆库登记（fail closed）：先经 Project Control 注册项目身份，或用已登记 project_id 重试。')
      }
      const key = (await resolveCredential(ctx.credentials, 'DEEPSEEK_API_KEY')) ?? process.env.DEEPSEEK_API_KEY
      if (key === undefined) throw new Error('未解析到 DEEPSEEK_API_KEY，无法调用提取模型。')
      const budget = Math.min(Math.max(Number(args.budget_yuan ?? 0.5) || 0.5, 0.1), 5)
      const connection = officialExtractionConnection(key, process.env.DEEPSEEK_BASE_URL)
      if (connection === null) throw new Error('官方回退连接不可用。')
      const result = await runExtraction({
        endpoint: connection.endpoint,
        apiKey: connection.apiKey,
        projectId,
        batches,
        readText: locatorTextReader(packageDir),
        budgetYuan: budget,
        offPeakOnly: args.off_peak_only !== false,
        checkpointFile: join(packageDir, 'extract-state.json'),
      })
      let written = 0
      for (const candidate of result.candidates) {
        const kind = ['project_fact', 'event', 'pattern'].includes(candidate.kind) ? candidate.kind : 'event'
        try {
          service.record({
            kind,
            text: candidate.text,
            scope: 'project',
            projectId,
            confirm: false,
            evidence: candidate.locator,
            evidenceKind: 'session',
            ...(candidate.factualAt === undefined ? {} : { factualAt: candidate.factualAt }),
          })
          written += 1
        } catch {
          // 敏感门禁/重复/归类比拒绝 → 跳过该候选，不中断批次
        }
      }
      lines.push('正式提取：调用 ' + String(result.calls) + ' / 实际成本 ￥' + result.spentYuan.toFixed(3)
        + ' / 候选产出 ' + String(result.candidates.length) + ' / 写入候选队列 ' + String(written)
        + ' / 停止原因 ' + result.stopped + (result.error === undefined ? '' : '（' + result.error + '）'))
      return lines.join('\n')
    },
  }))
}

// ---- P3-2 提取运行时（懒加载：首次轮末才 import personal-foundation） ----

async function openExtractionRuntime(credentials: CredentialsLike, officialFallback: boolean): Promise<ExtractionRuntimeLike> {
  // 按文件路径加载兄弟包的主机 bundle（包名解析在源码态/打包态都不可用，见 foundation-runtime.ts）。
  const PersonalStore = await loadFoundationStoreConstructor()
  const dshHome = resolve(process.env.DSH_HOME || join(homedir(), '.dsh'))
  const store = new PersonalStore(join(dshHome, 'personal', 'personal-suite.json')) as unknown as ModelConnectionStore
  return {
    findConnection: async () => {
      const fromStore = await findExtractionConnection(store, credentials)
      if (fromStore !== null) return fromStore
      if (!officialFallback) return null
      // 回退：与主 Agent 官方适配器同一凭据引用 DEEPSEEK_API_KEY（Models 页管理，可回退环境变量），
      // 不复制密钥、不写连接数据。
      const key = (await resolveCredential(credentials, 'DEEPSEEK_API_KEY')) ?? process.env.DEEPSEEK_API_KEY
      return officialExtractionConnection(key, process.env.DEEPSEEK_BASE_URL)
    },
  }
}

/** 取第一个已启用且密钥齐备的「记忆提取」连接（决策②：独立连接，不与其他插件混用）。 */
async function findExtractionConnection(store: ModelConnectionStore, credentials: CredentialsLike): Promise<ExtractionConnection | null> {
  const document = await store.read()
  for (const stored of document.connections) {
    if (stored.kind !== 'memory-extraction' || !stored.enabled) continue
    const [endpoint, apiKey] = await Promise.all([
      resolveCredential(credentials, stored.endpointRef),
      resolveCredential(credentials, stored.secretRef),
    ])
    if (endpoint !== undefined && apiKey !== undefined) return { endpoint, apiKey, label: stored.label }
  }
  return null
}

async function resolveCredential(credentials: CredentialsLike, reference: string): Promise<string | undefined> {
  try {
    const resolved = await credentials.resolve(reference)
    return resolved?.value
  } catch {
    return undefined
  }
}

// ---- P3-2 提取观测：统计块挂入 memory_status（不新增工具面） ----

function extractionModelText(config: Config): string {
  const model = typeof config.extractionModel === 'string' && config.extractionModel.trim() !== ''
    ? config.extractionModel.trim()
    : (process.env.DSH_MEMORY_EXTRACTION_MODEL || 'deepseek-v4-flash')
  return model
}

function renderExtractionStats(config: Config, stats: { paused: number; gateSkip: number; noConnection: number; ok: number; failed: number; lastDetail: string }, model: string): string {
  if (config.extractionEnabled !== true) {
    return '自动提取（P3-2）：未开启（extractionEnabled=false）。'
  }
  return [
    '自动提取（P3-2）：已开启（模型 ' + model + '，关思考，官方密钥回退 ' + (config.extractionOfficialFallback === false ? '关' : '开') + '）',
    '  统计：成功 ' + String(stats.ok) + ' / 失败 ' + String(stats.failed) + ' / 需求门跳过 ' + String(stats.gateSkip) + ' / 暂停跳过 ' + String(stats.paused) + ' / 无连接跳过 ' + String(stats.noConnection),
    '  最近结果：' + stats.lastDetail,
  ].join('\n')
}

// ---- P4-2 向量嵌入观测：renderEmbeddingStatus 与 EMBEDDING_RUNTIME_VERSIONS 在 core/embedding-status.ts ----
