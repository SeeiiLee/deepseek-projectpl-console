// P4-2 主侧运行时：懒加载 worker、单飞初始化、有界队列、AbortSignal、drain/terminate。
// 只做 health + query/document embedding（step 2），不接记忆写入/召回。
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Worker } from 'node:worker_threads'
import type { EmbeddingManifest } from './embedding-manifest.ts'

export type EmbeddingWorkerState = 'idle' | 'loading' | 'ready' | 'failed'

const MAX_PENDING = 32
const INIT_TIMEOUT_MS = 120_000
const EMBED_TIMEOUT_MS = 60_000

/** worker 文件定位：源码态 src/core → embedding-worker.ts；打包态 lib → embedding-worker.js。 */
export function embeddingWorkerPath(): string {
  const here = dirname(fileURLToPath(import.meta.url))
  // 源码态：src/core/embedding-worker.ts（与本文件同级）；打包态：lib/core/embedding-worker.js
  const candidates = [resolve(here, 'embedding-worker.ts'), resolve(here, 'core', 'embedding-worker.js')]
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  throw new Error('embedding worker 未找到（near ' + here + '）。')
}

export interface EmbedResult {
  vectors: Float32Array
  count: number
  dimensions: number
  generation: string
}

interface PendingRequest {
  resolve(result: { vectors: ArrayBuffer; count: number; dimensions: number }): void
  reject(error: Error): void
  timer: ReturnType<typeof setTimeout>
}

export class EmbeddingRuntime {
  readonly modelDir: string
  readonly manifest: EmbeddingManifest
  readonly generation: string
  private worker: Worker | null = null
  private pending = new Map<number, PendingRequest>()
  private nextId = 1
  private initPromise: Promise<void> | null = null
  private state: EmbeddingWorkerState = 'idle'
  private lastError = ''

  constructor(options: { modelDir: string; manifest: EmbeddingManifest; generation: string }) {
    this.modelDir = resolve(options.modelDir)
    this.manifest = options.manifest
    this.generation = options.generation
  }

  stateText(): EmbeddingWorkerState {
    return this.state
  }

  lastErrorText(): string {
    return this.lastError
  }

  /** 单飞初始化：worker 懒加载，首次调用才拉起；重复调用共享同一 promise。 */
  ensureReady(): Promise<void> {
    this.initPromise ??= this.initialize()
    return this.initPromise
  }

  private async initialize(): Promise<void> {
    if (this.state === 'ready') return
    if (this.state === 'loading') {
      await new Promise<void>((resolvePromise, rejectPromise) => {
        const timer = setInterval(() => {
          if (this.state === 'ready') { clearInterval(timer); resolvePromise() }
          if (this.state === 'failed') { clearInterval(timer); rejectPromise(new Error(this.lastError || 'embedding 初始化失败')) }
        }, 50)
      })
      return
    }
    this.state = 'loading'
    try {
      const worker = new Worker(embeddingWorkerPath())
      this.worker = worker
      const ready = new Promise<void>((resolvePromise, rejectPromise) => {
        const timer = setTimeout(() => { rejectPromise(new Error('embedding 初始化超时（' + String(INIT_TIMEOUT_MS / 1000) + 's）')) }, INIT_TIMEOUT_MS)
        worker.once('message', (message) => {
          clearTimeout(timer)
          if (message.type === 'ready') resolvePromise()
          else if (message.type === 'error') rejectPromise(new Error(message.error))
          else rejectPromise(new Error('embedding worker 意外消息'))
        })
        worker.once('error', (error) => { clearTimeout(timer); rejectPromise(error) })
        worker.once('exit', (code) => { clearTimeout(timer); rejectPromise(new Error('embedding worker 提前退出（code ' + String(code) + '）')) })
      })
      worker.on('message', (message) => { this.dispatch(message) })
      worker.postMessage({
        type: 'init',
        modelDir: this.modelDir,
        dtype: this.manifest.dtype,
      })
      await ready
      this.state = 'ready'
      this.lastError = ''
    } catch (error) {
      this.state = 'failed'
      this.lastError = error instanceof Error ? error.message : String(error)
      this.initPromise = null
      throw error
    }
  }

  private dispatch(message: Record<string, unknown>): void {
    const id = Number(message.id ?? 0)
    const pending = this.pending.get(id)
    if (pending === undefined) return
    this.pending.delete(id)
    clearTimeout(pending.timer)
    if (message.type === 'embedded' && message.vectors instanceof ArrayBuffer) {
      pending.resolve({ vectors: message.vectors, count: Number(message.count ?? 0), dimensions: Number(message.dimensions ?? 0) })
      return
    }
    if (message.type === 'error') {
      pending.reject(new Error(String(message.error ?? 'embedding 未知错误')))
      return
    }
    pending.reject(new Error('embedding worker 意外响应'))
  }

  /**
   * 有界嵌入：purpose='query' 按 manifest.queryInstruction 加前缀；document 不加。
   * 队列上限 MAX_PENDING，超限显式报 busy（评审 §2.2B：不无限堆积）。
   */
  async embed(texts: string[], purpose: 'query' | 'document'): Promise<EmbedResult> {
    if (texts.length === 0) throw new Error('embed 文本不能为空')
    if (this.pending.size >= MAX_PENDING) throw new Error('embedding 队列已满（busy），请稍后重试')
    await this.ensureReady()
    const id = this.nextId
    this.nextId += 1
    const result = await new Promise<{ vectors: ArrayBuffer; count: number; dimensions: number }>((resolvePromise, rejectPromise) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        rejectPromise(new Error('embedding 请求超时（' + String(EMBED_TIMEOUT_MS / 1000) + 's）'))
      }, EMBED_TIMEOUT_MS)
      this.pending.set(id, { resolve: resolvePromise, reject: rejectPromise, timer })
      this.worker?.postMessage({
        type: 'embed',
        id,
        texts,
        purpose,
        pooling: this.manifest.pooling,
        queryInstruction: this.manifest.queryInstruction,
      })
    })
    if (result.dimensions !== this.manifest.dimensions) {
      throw new Error('embedding 维度不符：期望 ' + String(this.manifest.dimensions) + '，实际 ' + String(result.dimensions))
    }
    return {
      vectors: new Float32Array(result.vectors),
      count: result.count,
      dimensions: result.dimensions,
      generation: this.generation,
    }
  }

  /** 关闭：终止 worker（等待中的请求全部拒绝）。 */
  async close(): Promise<void> {
    this.initPromise = null
    this.state = 'idle'
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer)
      this.pending.delete(id)
      pending.reject(new Error('embedding 运行时已关闭'))
    }
    const worker = this.worker
    this.worker = null
    if (worker !== null) await worker.terminate()
  }
}
