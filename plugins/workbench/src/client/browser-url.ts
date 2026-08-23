/**
 * Browser 地址栏归一化（纯函数，可单测）：
 * 只允许 http(s)；拒绝 loopback / 应用自身 origin，避免内嵌页面接触
 * GUI 源或本机服务。参考 refs/tmp-better-sidebar 的 browser.ts 语义，
 * 按我们的 resourceKey/持久化模型重写。
 */

export type NormalizeBrowserUrlResult =
  | { kind: 'ok'; url: string }
  | { kind: 'invalid' }
  | { kind: 'blocked'; reason: 'scheme' | 'loopback' | 'self' }

export function normalizeBrowserUrl(raw: string, ownOrigin?: string): NormalizeBrowserUrlResult {
  const first = normalizeOnce(raw, ownOrigin)
  if (first.kind === 'ok') return first
  const trimmed = raw.trim()
  // 裸域名/主机自动补 https://（用户习惯输入 www.example.com 或 example.com/path）。
  // 仅对「无法解析」的输入重试：已有 scheme 的拦截（javascript:/ftp: 等）保持原语义。
  if (first.kind === 'invalid' && trimmed !== '' && !/\s/u.test(trimmed) && !/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//u.test(trimmed)) {
    return normalizeOnce('https://' + trimmed, ownOrigin)
  }
  return first
}

function normalizeOnce(raw: string, ownOrigin?: string): NormalizeBrowserUrlResult {
  const trimmed = raw.trim()
  if (trimmed === '' || trimmed.length > 2048 || /\s/u.test(trimmed)) return { kind: 'invalid' }
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return { kind: 'invalid' }
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { kind: 'blocked', reason: 'scheme' }
  }
  const host = parsed.hostname.toLowerCase()
  if (isLoopbackHost(host)) return { kind: 'blocked', reason: 'loopback' }
  if (ownOrigin !== undefined) {
    try {
      const own = new URL(ownOrigin)
      if (parsed.origin === own.origin) return { kind: 'blocked', reason: 'self' }
    } catch {
      // ownOrigin 不可解析时不做 self 判定。
    }
  }
  return { kind: 'ok', url: parsed.toString() }
}

export function isLoopbackHost(host: string): boolean {
  if (host === 'localhost' || host.endsWith('.localhost')) return true
  if (host === '::1' || host === '[::1]') return true
  if (/^127(?:\.\d{1,3}){3}$/u.test(host)) return true
  return false
}

/** 从 URL 提取简短页签标题（hostname，失败时回退原串前 60 字符）。 */
export function browserTabTitle(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url.slice(0, 60)
  }
}
