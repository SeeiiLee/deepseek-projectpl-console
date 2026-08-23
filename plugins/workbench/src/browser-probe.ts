/**
 * Browser 嵌入性判定（纯函数，可单测；不发请求）。
 * Host 取回目标站响应头后，这里判断浏览器是否会拒绝 iframe 嵌入：
 * X-Frame-Options 与 CSP frame-ancestors 正是浏览器强制拒载的两个信号。
 * 语义借鉴 refs/tmp-better-sidebar 的 browser-probe.ts，按我们的返回值模型重写。
 */

export type EmbedVerdict = 'ok' | 'blocked' | 'unknown'

export interface EmbedProbeInput {
  /** HTTP 状态码；请求失败/超时传 undefined。 */
  status?: number
  xFrameOptions?: string | null
  contentSecurityPolicy?: string | null
}

/** 提取 CSP 的 frame-ancestors 源列表；指令缺失/为空返回 undefined。 */
export function extractFrameAncestors(csp: string | null): string[] | undefined {
  if (csp === null) return undefined
  for (const directive of csp.split(';')) {
    const parts = directive.trim().split(/\s+/)
    if (parts[0] === 'frame-ancestors') {
      const sources = parts.slice(1).filter(source => source !== '')
      return sources.length === 0 ? undefined : sources
    }
  }
  return undefined
}

/** X-Frame-Options 是否拒绝嵌入（DENY / SAMEORIGIN 对我们都是拒绝）。 */
export function xfoBlocks(xfo: string | null): boolean {
  if (xfo === null) return false
  const value = xfo.trim().toLowerCase()
  return value === 'deny' || value === 'sameorigin'
}

/**
 * frame-ancestors 是否拒绝嵌入：'none' 总是拒绝；'self'/具体源列表
 * 对第三方嵌入者（我们）同样拒绝；只有 * 允许任意嵌入。
 */
export function frameAncestorsBlock(csp: string | null): boolean {
  const sources = extractFrameAncestors(csp)
  if (sources === undefined) return false
  return !sources.includes('*')
}

export function embeddabilityOf(probe: EmbedProbeInput): EmbedVerdict {
  if (probe.status === undefined) return 'unknown'
  if (xfoBlocks(probe.xFrameOptions ?? null)) return 'blocked'
  if (frameAncestorsBlock(probe.contentSecurityPolicy ?? null)) return 'blocked'
  return 'ok'
}
