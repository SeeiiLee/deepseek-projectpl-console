// P4-2 向量嵌入观测（纯函数，可单测；index.ts 挂入 memory_status，不新增工具面）。
/** 与根 package.json 依赖版本一致（generation 材料，变更即新 generation）。 */
export const EMBEDDING_RUNTIME_VERSIONS = Object.freeze({
  transformersJs: '4.2.0',
  onnxruntimeNode: '1.24.3',
})

export function renderEmbeddingStatus(input: {
  enabled: boolean
  modelDir: string
  manifest: { modelId: string; dimensions: number; dtype: string; pooling: string } | null
  manifestError: string
  generation: string
  workerState: string
  workerError: string
  jobs: { pending: number; ready: number; failed: number; stale: number } | null
  hybridEnabled: boolean
  lastDrain: string
}): string {
  if (input.enabled !== true) {
    return '向量嵌入（P4-2）：未开启（embeddingEnabled=false）。'
  }
  if (input.modelDir === '') {
    return '向量嵌入（P4-2）：已开启但未配置模型目录（embeddingModelDir 为空）——语义召回保持 FTS。'
  }
  if (input.manifest === null) {
    return [
      '向量嵌入（P4-2）：已开启',
      '  模型目录：' + input.modelDir,
      '  manifest：无效（' + (input.manifestError === '' ? '未找到' : input.manifestError) + '）——semantic_unavailable，召回维持 FTS',
      '  worker：未加载',
      '  hybrid 召回：未启用（功能门通过后开启）',
    ].join('\n')
  }
  const jobs = input.jobs === null
    ? ''
    : '\n  jobs：pending ' + String(input.jobs.pending) + ' / ready ' + String(input.jobs.ready) + ' / failed ' + String(input.jobs.failed) + ' / stale ' + String(input.jobs.stale)
  return [
    '向量嵌入（P4-2）：已开启',
    '  模型目录：' + input.modelDir,
    '  manifest：OK（' + input.manifest.modelId + '，' + String(input.manifest.dimensions) + ' 维，' + input.manifest.dtype + '/' + input.manifest.pooling + '/l2）',
    '  generation：' + (input.generation === '' ? '未生成' : input.generation),
    '  worker：' + input.workerState + (input.workerError === '' ? '' : '（' + input.workerError + '）'),
  ].join('\n') + jobs + '\n  上次回填：' + input.lastDrain + '\n  hybrid 召回：' + (input.hybridEnabled ? '已启用（FTS+向量 RRF 融合）' : '未启用（功能门通过后开启）')
}
