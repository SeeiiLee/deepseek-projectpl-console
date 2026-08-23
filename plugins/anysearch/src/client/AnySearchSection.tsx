import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import type { SettingsScope, SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import css from './AnySearchSection.module.css'

export interface AnySearchSectionValue {
  apiKey?: string
  apiKeyEnv?: string
  endpoint?: string
}

export interface AnySearchSectionInjected {
  scope: SettingsScope<AnySearchSectionValue>
}

export type AnySearchSectionProps = Partial<AnySearchSectionInjected>

const DEFAULT_ENDPOINT = 'https://api.anysearch.com/mcp'
const DEFAULT_API_KEY_ENV = 'ANYSEARCH_API_KEY'

function messageOf(error: unknown): string {
  return error instanceof Error && error.message.trim().length > 0 ? error.message : 'AnySearch 设置保存失败。'
}

/** AnySearch provider settings section. */
export function AnySearchSection({ scope }: AnySearchSectionProps): ReactNode {
  const [snapshot, setSnapshot] = useState<SettingsScopeSnapshot<AnySearchSectionValue>>(
    () => scope?.getSnapshot() ?? { status: 'unavailable', value: undefined, base: undefined, user: undefined, revision: undefined, writable: false, mode: 'memory' },
  )
  const [endpoint, setEndpoint] = useState(DEFAULT_ENDPOINT)
  const [apiKey, setApiKey] = useState('')
  const [apiKeyEnv, setApiKeyEnv] = useState(DEFAULT_API_KEY_ENV)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    if (scope === undefined) return
    setSnapshot(scope.getSnapshot())
    return scope.subscribe(() => setSnapshot(scope.getSnapshot()))
  }, [scope])

  useEffect(() => {
    if (snapshot.status !== 'ready' || snapshot.value === undefined) return
    if (typeof snapshot.value.endpoint === 'string' && snapshot.value.endpoint.trim().length > 0) {
      setEndpoint(snapshot.value.endpoint)
    }
    if (typeof snapshot.value.apiKeyEnv === 'string' && snapshot.value.apiKeyEnv.trim().length > 0) {
      setApiKeyEnv(snapshot.value.apiKeyEnv)
    }
  }, [snapshot])

  const runSave = async (operation: () => Promise<void>, success: string): Promise<void> => {
    if (scope === undefined || snapshot.writable === false) return
    setBusy(true)
    setNotice(null)
    try {
      await operation()
      setNotice(success)
    } catch (error) {
      setNotice(messageOf(error))
    } finally {
      setBusy(false)
    }
  }

  const submit = (event: FormEvent): void => {
    event.preventDefault()
    void runSave(async () => {
      await scope?.set('endpoint', endpoint.trim())
      if (apiKeyEnv.trim().length > 0) await scope?.set('apiKeyEnv', apiKeyEnv.trim())
      if (apiKey.trim().length > 0) {
        await scope?.set('apiKey', apiKey.trim())
        setApiKey('')
      }
    }, 'AnySearch 设置已保存。')
  }

  const clearKey = (): void => {
    void runSave(async () => {
      await scope?.unset('apiKey')
      setApiKey('')
    }, '已清除 AnySearch API Key。')
  }

  return (
    <section className={css.section} aria-busy={busy || snapshot.status === 'loading'}>
      <header className={css.header}>
        <div>
          <h2>AnySearch 搜索</h2>
          <p>第三方网络搜索 provider。保存后 Harness 的 web_search 会通过 AnySearch 执行。</p>
        </div>
        <span className={css.beta}>测试版</span>
      </header>

      {notice !== null ? <p className={css.notice} role="status">{notice}</p> : null}
      {snapshot.status === 'loading' ? <p className={css.status}>正在读取 AnySearch 设置…</p> : null}
      {snapshot.status === 'unavailable' ? <p className={css.status} role="alert">AnySearch 设置命名空间当前不可用。</p> : null}

      <form className={css.form} onSubmit={submit}>
        <label>
          <span>接口地址</span>
          <input value={endpoint} placeholder={DEFAULT_ENDPOINT} onChange={event => { setEndpoint(event.target.value) }} />
        </label>

        <label>
          <span>API Key 引用</span>
          <input value={apiKeyEnv} placeholder={DEFAULT_API_KEY_ENV} onChange={event => { setApiKeyEnv(event.target.value) }} />
          <small>默认通过 ANYSEARCH_API_KEY 凭据解析。</small>
        </label>

        <label>
          <span>API Key</span>
          <input type="password" value={apiKey} placeholder="留空则保持已保存的 Key 不变" autoComplete="off" onChange={event => { setApiKey(event.target.value) }} />
          <small>密钥保存后不会回显。</small>
        </label>

        <div className={css.actions}>
          <button className={css.primaryButton} disabled={busy || snapshot.writable === false} type="submit">保存设置</button>
          <button disabled={busy || snapshot.writable === false} type="button" onClick={clearKey}>清除 API Key</button>
        </div>
      </form>
    </section>
  )
}
