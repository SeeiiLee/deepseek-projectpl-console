// P4-2 混合召回纯函数：余弦相似度 + RRF 名次融合（评审 §4.1：两路候选并集后融合，不混加异源分数）。
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  const length = Math.min(a.length, b.length)
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < length; i += 1) {
    dot += a[i]! * b[i]!
    normA += a[i]! * a[i]!
    normB += b[i]! * b[i]!
  }
  if (normA === 0 || normB === 0) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

// 向量通道的语义门槛（针对 bge-m3 校准，generation 锁定模型下有效；实测分布见 DEVLOG）：
// - HYBRID_STRICT_FLOOR：FTS 零命中时，向量最高分必须 ≥ 0.45 才允许语义通道单独兜底（噪声查询实测 top≈0.37–0.45）；
// - HYBRID_TOP_RATIO：候选集尾剪枝，只保留同查询内 top 分 75% 以上的强簇（bge-m3 基线分普遍 0.35–0.45，
//   绝对阈值无法区分 0.428 真命中与 0.446 噪声；fixture 最低真命中与 top 之比 0.907，0.75 有安全余量）。
export const HYBRID_STRICT_FLOOR = 0.45
export const HYBRID_TOP_RATIO = 0.75

/**
 * 由查询向量在文档向量集上筛选语义候选：低于相对下限的丢弃；返回名次列表 + 本查询最高分
 * （调用方用 topScore 做 FTS 零命中时的严格门）。
 */
export function vectorCandidates(
  query: Float32Array,
  docs: Array<{ claimId: string; vector: Float32Array }>,
  topK = 24,
): { ranked: Array<{ id: string; rank: number }>; topScore: number } {
  if (docs.length === 0) return { ranked: [], topScore: 0 }
  const scored = docs.map((doc) => ({ id: doc.claimId, score: cosineSimilarity(query, doc.vector) }))
  let topScore = 0
  for (const item of scored) {
    if (item.score > topScore) topScore = item.score
  }
  const floor = topScore * HYBRID_TOP_RATIO
  return { ranked: rankByScore(scored.filter((item) => item.score >= floor)).slice(0, topK), topScore }
}

/** 向量候选按余弦排序后，转成与 FTS 同构的名次列表（并列取最高名次）。 */
export function rankByScore(scored: Array<{ id: string; score: number }>): Array<{ id: string; rank: number }> {
  const sorted = [...scored].sort((left, right) => right.score - left.score)
  const output: Array<{ id: string; rank: number }> = []
  let previousScore = Number.NaN
  let previousRank = 0
  for (let i = 0; i < sorted.length; i += 1) {
    const rank = sorted[i]!.score === previousScore ? previousRank : i + 1
    if (sorted[i]!.score !== previousScore) { previousScore = sorted[i]!.score; previousRank = rank }
    output.push({ id: sorted[i]!.id, rank })
  }
  return output
}

/**
 * Reciprocal Rank Fusion：id 在两路中的名次共同决定融合分 1/(k+rank)，缺席一路按 0。
 * 名次不能直接与 cosine/FTS 分混加（量纲不同，评审 §3.4/§4.1）。
 */
export function rrfFuse(
  ftsRanked: Array<{ id: string; rank: number }>,
  vectorRanked: Array<{ id: string; rank: number }>,
  k = 60,
): Map<string, number> {
  const fused = new Map<string, number>()
  const add = (id: string, rank: number): void => {
    const contribution = 1 / (k + rank)
    fused.set(id, (fused.get(id) ?? 0) + contribution)
  }
  for (const item of ftsRanked) add(item.id, item.rank)
  for (const item of vectorRanked) add(item.id, item.rank)
  return fused
}

/** 融合分降序取前 top 的 id 列表（同分保持输入稳定性：Map 插入序）。 */
export function topFused(fused: Map<string, number>, top: number): string[] {
  return [...fused.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, top)
    .map((entry) => entry[0])
}
