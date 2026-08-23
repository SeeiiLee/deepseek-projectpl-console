// P3-2 官方回退：没有「记忆提取」连接时，用开发版默认密钥（DEEPSEEK_API_KEY 环境变量，
// 与主 Agent 的官方适配器同一来源）直接调用 DeepSeek 官方 chat/completions。
// 纯函数可单测；密钥只在运行时读取环境变量，不落盘、不打印。
import type { ExtractionConnection } from './extractor.ts'

/** 与上游 llm-deepseek 的 PUBLIC_BASE_URL 一致。 */
export const DEEPSEEK_OFFICIAL_ENDPOINT = 'https://api.deepseek.com'

export function officialExtractionConnection(apiKey: string | undefined, baseUrl?: string | undefined): ExtractionConnection | null {
  const key = typeof apiKey === 'string' ? apiKey.trim() : ''
  if (key === '') return null
  const endpoint = typeof baseUrl === 'string' && baseUrl.trim() !== '' ? baseUrl.trim() : DEEPSEEK_OFFICIAL_ENDPOINT
  return { endpoint, apiKey: key, label: 'deepseek-official（开发版默认密钥）' }
}
