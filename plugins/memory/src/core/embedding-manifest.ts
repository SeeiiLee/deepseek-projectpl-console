// P4-2 模型 manifest 校验与 generation 材料（step 1：冻结合同）。
// 合同 = docs/p4-model-manifests/*.json 的 schema；generation = 全部影响向量语义的字段哈希，
// 任一变化都产生新 generation，避免新旧向量混比。
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

export const EMBEDDING_MANIFEST_NAME = 'MODEL_MANIFEST.json'
export const MANIFEST_SCHEMA_VERSION = 1

interface ManifestFile {
  path: string
  bytes: number
  sha256: string
}

interface ManifestFiles {
  model: ManifestFile
  tokenizer: ManifestFile
  config: ManifestFile
}

export interface EmbeddingManifest {
  schemaVersion: number
  role: string
  modelId: string
  source: { repository: string; revision: string }
  license: string
  dimensions: number
  maxInputTokens: number
  dtype: string
  pooling: string
  normalization: string
  queryInstruction: string
  files: ManifestFiles
}

export interface ManifestVerifyResult {
  ok: boolean
  generation?: string
  error?: string
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function numberValue(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function objectValue(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  return {}
}

function fileEntry(value: unknown): ManifestFile | null {
  const row = objectValue(value)
  const path = text(row.path)
  const sha256 = text(row.sha256)
  if (path === '' || !/^[0-9a-f]{64}$/u.test(sha256)) return null
  return { path, bytes: numberValue(row.bytes, 0), sha256 }
}

function isPooling(value: unknown): value is string {
  return value === 'cls' || value === 'mean' || value === 'last_token'
}

/** 读取并做形状校验；目录缺失/JSON 非法/字段越界一律返回 null（调用方走 semantic_unavailable）。 */
export function readEmbeddingManifest(modelDir: string): EmbeddingManifest | null {
  const dir = resolve(modelDir)
  const manifestPath = join(dir, EMBEDDING_MANIFEST_NAME)
  if (!existsSync(manifestPath)) return null
  let parsed: unknown = null
  try {
    parsed = JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch {
    return null
  }
  const record = objectValue(parsed)
  if (record.schemaVersion !== MANIFEST_SCHEMA_VERSION) return null
  const modelId = text(record.modelId)
  const dimensions = numberValue(record.dimensions, 0)
  const dtype = text(record.dtype)
  const pooling = record.pooling
  const files = objectValue(record.files)
  const model = fileEntry(files.model)
  const tokenizer = fileEntry(files.tokenizer)
  const config = fileEntry(files.config)
  if (
    modelId === ''
    || dimensions < 16 || dimensions > 16384
    || dtype === ''
    || !isPooling(pooling)
    || record.normalization !== 'l2'
    || model === null
    || tokenizer === null
    || config === null
  ) {
    return null
  }
  const source = objectValue(record.source)
  return {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    role: text(record.role),
    modelId,
    source: { repository: text(source.repository), revision: text(source.revision) },
    license: text(record.license),
    dimensions,
    maxInputTokens: numberValue(record.maxInputTokens, 512),
    dtype,
    pooling,
    normalization: 'l2',
    queryInstruction: text(record.queryInstruction),
    files: { model, tokenizer, config },
  }
}

function sha256Of(filePath: string): string {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex')
}

/**
 * 校验 manifest 与本地文件是否一致：大小恒查（廉价），SHA-256 按 verifyHashes 开关
 * （首次加载/自检时为 true；日常启动 false，避免每次哈希 570MB 模型）。
 * 通过后返回 generation（全部影响向量语义的字段 + 运行时版本哈希）。
 */
export function verifyEmbeddingManifest(
  modelDir: string,
  manifest: EmbeddingManifest,
  runtimeVersions: { transformersJs: string; onnxruntimeNode: string },
  verifyHashes = false,
): ManifestVerifyResult {
  const dir = resolve(modelDir)
  const entries = [
    ['model', manifest.files.model],
    ['tokenizer', manifest.files.tokenizer],
    ['config', manifest.files.config],
  ] as const
  for (const [name, file] of entries) {
    const path = join(dir, file.path)
    if (!existsSync(path)) return { ok: false, error: name + ' 文件缺失：' + file.path }
    const size = statSync(path).size
    if (file.bytes > 0 && size !== file.bytes) {
      return { ok: false, error: name + ' 大小不符：期望 ' + String(file.bytes) + '，实际 ' + String(size) }
    }
    if (verifyHashes) {
      const hash = sha256Of(path)
      if (hash !== file.sha256) return { ok: false, error: name + ' SHA-256 不符（' + hash.slice(0, 12) + '…）' }
    }
  }
  return { ok: true, generation: embeddingGeneration(manifest, runtimeVersions) }
}

/** generation = 语义合同哈希（模型/分词器/预处理/运行时），与文档 P4 方案 §7.2.3 一致。 */
export function embeddingGeneration(
  manifest: EmbeddingManifest,
  runtimeVersions: { transformersJs: string; onnxruntimeNode: string },
): string {
  const material = {
    modelId: manifest.modelId,
    repository: manifest.source.repository,
    revision: manifest.source.revision,
    modelSha256: manifest.files.model.sha256,
    tokenizerSha256: manifest.files.tokenizer.sha256,
    dtype: manifest.dtype,
    pooling: manifest.pooling,
    normalization: manifest.normalization,
    queryInstruction: manifest.queryInstruction,
    maxInputTokens: manifest.maxInputTokens,
    transformersJs: runtimeVersions.transformersJs,
    onnxruntimeNode: runtimeVersions.onnxruntimeNode,
  }
  return createHash('sha256').update(JSON.stringify(material)).digest('hex').slice(0, 16)
}
