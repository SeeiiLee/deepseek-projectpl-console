export type BillingOpenResult =
  | { ok: true; mode: 'isolated' | 'external' }
  | { ok: false; reason: string }

declare global {
  interface Window {
    deepseekHarnessPersonal?: {
      billing?: {
        /** Main validates its fixed DeepSeek billing target; Renderer supplies no URL. */
        open(): Promise<BillingOpenResult>
      }
    }
  }
}

export async function openBillingCenter(): Promise<BillingOpenResult> {
  const open = window.deepseekHarnessPersonal?.billing?.open
  if (typeof open !== 'function') return { ok: false, reason: 'desktop-bridge-unavailable' }
  try {
    const result = await open()
    if (result?.ok === true && (result.mode === 'isolated' || result.mode === 'external')) return result
    if (result?.ok === false && typeof result.reason === 'string') return result
    return { ok: false, reason: 'desktop-bridge-invalid-response' }
  } catch {
    return { ok: false, reason: 'desktop-bridge-failed' }
  }
}
