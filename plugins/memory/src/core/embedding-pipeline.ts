// P4-2 嵌入回填管线：批处理 drain、重试上限、generation 退役、坏向量防护。
// 推理在插件 worker；本层只编排存储调用。失败绝不外抛（回填是后台低优先级）。
import type { EmbeddingRuntime } from './embedding.ts'

export interface EmbeddingServiceLike {
  listRegisteredProjects(): string[]
  pendingEmbeddings(scope: string, projectId: string | undefined, generation: string, limit?: number): Array<{ id: string; text: string }>
  storeEmbedding(input: {
    id: string
    scope: string
    projectId?: string | undefined
    providerId: string
    modelId: string
    modelRevision: string
    dimensions: number
    contentHash: string
    vector: Float32Array
    generation: string
  }): void
  markEmbeddingFailed(scope: string, projectId: string | undefined, id: string, errorCode: string): void
  retireStaleEmbeddings(scope: string, projectId: string | undefined, generation: string): number
  reconcileEmbeddingJobs(scope: string, projectId: string | undefined, generation: string): number
}

export interface EmbeddingDrainOptions {
  batch?: number
  providerId: string
  modelId: string
  modelRevision: string
  dimensions: number
  generation: string
  contentHashOf(text: string): string
}

export interface EmbeddingDrainResult {
  embedded: number
  failed: number
  skipped: number
  retired: number
  /** 本轮各 scope 看到的待嵌条目总数（诊断：区分「看不到」与「嵌不动」）。 */
  seen: number
}

export function embeddingScopes(service: EmbeddingServiceLike): Array<{ scope: 'global_user' | 'project'; projectId?: string | undefined }> {
  return [
    { scope: 'global_user' as const },
    ...service.listRegisteredProjects().map((projectId): { scope: 'project'; projectId: string } => ({ scope: 'project', projectId })),
  ]
}

function isUnitVector(vector: Float32Array): boolean {
  let norm = 0
  for (let i = 0; i < vector.length; i += 1) {
    const value = vector[i]!
    if (!Number.isFinite(value)) return false
    norm += value * value
  }
  const length = Math.sqrt(norm)
  return length > 0.9 && length < 1.1
}

/** 一轮回填：每 scope 先退役旧 generation，再批量嵌入待办（≤batch）。任何失败只记作业状态。 */
export async function drainEmbeddings(
  service: EmbeddingServiceLike,
  runtime: EmbeddingRuntime,
  options: EmbeddingDrainOptions,
): Promise<EmbeddingDrainResult> {
  const result: EmbeddingDrainResult = { embedded: 0, failed: 0, skipped: 0, retired: 0, seen: 0 }
  const batch = Math.min(Math.max(Number(options.batch ?? 16) || 16, 1), 32)
  let ready = true
  try {
    await runtime.ensureReady()
  } catch {
    ready = false
  }
  if (!ready) {
    result.skipped += 1
    return result
  }
  for (const target of embeddingScopes(service)) {
    try {
      result.retired += service.retireStaleEmbeddings(target.scope, target.projectId, options.generation)
    } catch {
      // 退役失败不阻断本 scope 回填（下轮再试）
    }
    let pending: Array<{ id: string; text: string }> = []
    try {
      service.reconcileEmbeddingJobs(target.scope, target.projectId, options.generation) // 修复统计漏报（迁移前旧条目）
      pending = service.pendingEmbeddings(target.scope, target.projectId, options.generation, batch)
    } catch {
      continue
    }
    if (pending.length === 0) continue
    result.seen += pending.length
    try {
      const embedded = await runtime.embed(pending.map((item) => item.text), 'document')
      if (embedded.count !== pending.length) throw new Error('嵌入数量不符：期望 ' + String(pending.length) + '，实际 ' + String(embedded.count))
      for (let i = 0; i < pending.length; i += 1) {
        const item = pending[i]!
        const vector = embedded.vectors.subarray(i * embedded.dimensions, (i + 1) * embedded.dimensions)
        if (vector.length !== options.dimensions || !isUnitVector(vector)) {
          service.markEmbeddingFailed(target.scope, target.projectId, item.id, 'BAD_VECTOR')
          result.failed += 1
          continue
        }
        service.storeEmbedding({
          id: item.id,
          scope: target.scope,
          projectId: target.projectId,
          providerId: options.providerId,
          modelId: options.modelId,
          modelRevision: options.modelRevision,
          dimensions: options.dimensions,
          contentHash: options.contentHashOf(item.text),
          vector,
          generation: options.generation,
        })
        result.embedded += 1
      }
    } catch (error) {
      for (const item of pending) {
        try {
          service.markEmbeddingFailed(target.scope, target.projectId, item.id, 'EMBED_FAILED')
        } catch {
          // 作业行可能已不存在（并发删除），忽略
        }
      }
      result.failed += pending.length
      void error
    }
  }
  return result
}
