// src/upstream-gate-planner.js — 无副作用门禁规划器（A0）
// 只做“变更 → 最低门禁等级/消费闭包”的机器计划，不执行任何构建、测试、联网、模型或激活。
// unknown、diff 不完整、map 版本缺失/未知一律升级 G3（fail closed）。
const GATE_ORDER = { G0: 0, G1: 1, G2: 2, G3: 3 }

function highest(...gates) {
  return gates.reduce((max, gate) => (GATE_ORDER[gate] > GATE_ORDER[max] ? gate : max), 'G0')
}

/** 极简 glob：支持 `*`（不跨分隔符）与 `**`（跨分隔符），仅用于影响图 path-glob 规则。 */
function globMatch(pattern, value) {
  const normalize = input => input.replace(/\\/gu, '/')
  const pat = normalize(pattern)
  const text = normalize(value)
  const parts = pat.split('/')
  const values = text.split('/')
  const memo = new Map()
  const match = (pi, vi) => {
    const key = `${pi}:${vi}`
    if (memo.has(key)) return memo.get(key)
    let result = false
    if (pi === parts.length) {
      result = vi === values.length
    } else if (parts[pi] === '**') {
      result = match(pi + 1, vi) || (vi < values.length && match(pi, vi + 1))
    } else if (vi < values.length) {
      const re = new RegExp(`^${parts[pi].replace(/[.+^${}()|[\]\\]/gu, '\\$&').replace(/\*/gu, '[^/]*')}$`, 'u')
      result = re.test(values[vi]) && match(pi + 1, vi + 1)
    }
    memo.set(key, result)
    return result
  }
  return match(0, 0)
}

function matchesRule(rule, path) {
  if (rule.patternType === 'path-prefix') {
    const prefix = rule.pattern.replace(/[\\/]+$/u, '')
    return path === prefix || path.toLowerCase().startsWith(prefix.toLowerCase() + '/') || path.toLowerCase().startsWith(prefix.toLowerCase() + '\\')
  }
  if (rule.patternType === 'path-glob') {
    return globMatch(rule.pattern, path)
  }
  if (rule.patternType === 'export' || rule.patternType === 'schema' || rule.patternType === 'dependency') {
    // 语义指纹不在路径 diff 内可判定；由调用方把指纹项也放入 changed 列表。
    // 这里按精确 token 匹配（例如 export 名、schema id、dependency 名）。
    return path === rule.pattern
  }
  return false
}

/**
 * 生成门禁计划。
 * @param {object} input
 * @param {object} input.impactMap - upstream-impact-map/v1 对象。
 * @param {string[]} input.changed - 变更路径/语义指纹项。
 * @param {boolean} [input.diffComplete=true] - diff 是否完整（含 staged/unstaged/untracked 全量）。
 * @returns {{gateLevel: string, changedSurfaces: string[], consumerClosure: string[], reasons: string[], mapVersion: string}}
 */
export function planGate({ impactMap, changed = [], diffComplete = true }) {
  const reasons = []
  if (!impactMap || impactMap.schemaVersion !== 1) {
    return {
      gateLevel: 'G3',
      changedSurfaces: ['unknown'],
      consumerClosure: [],
      reasons: ['impact-map 缺失或 schemaVersion 未知'],
      mapVersion: impactMap?.mapVersion ?? 'unknown',
    }
  }
  if (!impactMap.mapVersion || impactMap.mapVersion === 'unknown') {
    return {
      gateLevel: 'G3',
      changedSurfaces: ['unknown'],
      consumerClosure: [],
      reasons: ['impact-map 版本缺失/未知'],
      mapVersion: impactMap.mapVersion ?? 'unknown',
    }
  }
  if (!Array.isArray(impactMap.rules) || impactMap.rules.length === 0) {
    return {
      gateLevel: 'G3',
      changedSurfaces: ['unknown'],
      consumerClosure: [],
      reasons: ['impact-map 规则缺失或为空'],
      mapVersion: impactMap.mapVersion,
    }
  }
  if (!diffComplete) {
    return {
      gateLevel: 'G3',
      changedSurfaces: ['unknown'],
      consumerClosure: [],
      reasons: ['diff 不完整（可能遗漏 tracked/staged/unstaged/untracked 变更）'],
      mapVersion: impactMap.mapVersion,
    }
  }
  if (!Array.isArray(changed) || changed.length === 0) {
    return {
      gateLevel: impactMap.defaultGate ?? 'G3',
      changedSurfaces: ['none'],
      consumerClosure: [],
      reasons: ['无变更项；按 defaultGate 计划'],
      mapVersion: impactMap.mapVersion,
    }
  }

  const matchedRules = []
  const unmatched = []
  for (const path of changed) {
    const hits = impactMap.rules.filter(rule => matchesRule(rule, path))
    if (hits.length === 0) unmatched.push(path)
    for (const hit of hits) {
      if (!matchedRules.some(rule => rule.id === hit.id)) matchedRules.push(hit)
    }
  }

  if (unmatched.length > 0) {
    return {
      gateLevel: 'G3',
      changedSurfaces: ['unknown'],
      consumerClosure: [],
      reasons: [`未命中任何 impact-map 规则，fail closed: ${unmatched.join(', ')}`],
      mapVersion: impactMap.mapVersion,
    }
  }

  const gateLevel = matchedRules.reduce((max, rule) => highest(max, rule.minGate), 'G0')
  const changedSurfaces = [...new Set(matchedRules.map(rule => rule.surface))]
  const consumerSet = new Set()
  for (const rule of matchedRules) {
    for (const plugin of rule.consumerPlugins ?? []) {
      consumerSet.add(plugin)
    }
  }
  const consumerClosure = [...consumerSet]
  reasons.push(`命中规则: ${matchedRules.map(rule => rule.id).join(', ')}`)
  return { gateLevel, changedSurfaces, consumerClosure, reasons, mapVersion: impactMap.mapVersion }
}

/**
 * 反向校验：伪造 reused ID、缺失证据键、证据 skipped、G3 缺锚点必须拒绝。
 * @param {object} receipt - harness-compat-receipt/v1 对象。
 * @returns {{ok: boolean, issues: string[]}}
 */
export function validateReceiptIntegrity(receipt) {
  const issues = []
  if (!receipt || receipt.schemaVersion !== 1) issues.push('回执 schemaVersion 不是 v1')
  if (!Array.isArray(receipt?.evidence) || receipt.evidence.length === 0) issues.push('回执缺少 evidence')
  for (const item of receipt?.evidence ?? []) {
    if (!item?.check || typeof item.check !== 'string') issues.push('evidence 缺 check 键')
    if (!item?.status || typeof item.status !== 'string') issues.push(`evidence ${item?.check ?? '?'} 缺 status 键`)
    if (typeof item?.status === 'string' && item.status === 'skipped') issues.push(`evidence ${item.check} 是 skipped，等同失败`)
    if (typeof item?.status === 'string' && /^reused:/u.test(item.status) && !/^reused:[A-Za-z0-9._-]+$/u.test(item.status)) {
      issues.push(`evidence ${item.check} 的 reused ID 非法`)
    }
  }
  if (receipt?.gateLevel === 'G3' && (!receipt?.g3Anchor || !receipt.g3Anchor.lastG3ReceiptId)) {
    issues.push('G3 回执缺少 g3Anchor')
  }
  if (receipt?.revoked === true && !receipt?.revocationReason) issues.push('已撤销回执缺少 revocationReason')
  return { ok: issues.length === 0, issues }
}
