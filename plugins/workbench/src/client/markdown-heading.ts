/**
 * R-PV1 Markdown 标题身份与远程媒体提示（架构书 §8.9.3/§8.9.4）。
 * heading identity = contentHash + heading ordinal + normalized text（§8.9.3），
 * 不只用标题文字，避免同文标题无法区分。远程媒体检测只用于「可能联网加载」状态
 * 提示，绝不用于阻断或改写（平台无 mediaPolicy seam 前不冒充安全解析）。
 */
import { extractOutline, type OutlineHeading } from './outline.ts'

export interface MarkdownHeadingRef extends OutlineHeading {
  ordinal: number
  identity: string
}

/** 归一化标题文本：去首尾空白、压缩连续空白（保留内文大小写）。 */
export function normalizeHeadingText(text: string): string {
  return text.trim().replace(/\s+/g, ' ')
}

/** FNV-1a 32 位内容哈希（稳定、无依赖；仅用于身份区分，非安全用途）。 */
export function contentHashOf(text: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/** 标题身份：contentHash + ordinal + normalized text。 */
export function headingIdentity(text: string, ordinal: number, contentHash: string): string {
  return contentHash + ':' + String(ordinal) + ':' + normalizeHeadingText(text)
}

/** 从源文本提取带 ordinal 与身份的标题序列。 */
export function headingsFromSource(text: string): readonly MarkdownHeadingRef[] {
  const hash = contentHashOf(text)
  return extractOutline(text).map((heading, ordinal) => ({
    ...heading,
    ordinal,
    identity: headingIdentity(heading.text, ordinal, hash),
  }))
}

/** 保守检测 Markdown 图片语法中的 http(s) 远程图片（仅提示用途）。 */
export function hasRemoteImageHint(text: string): boolean {
  return /!\[[^\]]*\]\(\s*https?:\/\/[^)]+\)/i.test(text)
}
