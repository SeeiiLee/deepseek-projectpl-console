import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import type {
  ConnectionCenterApi, ConnectionInput, ConnectionItem, ConnectionKind, McpTransport,
} from './connectionApi.ts'
import css from './ConnectionCenterSection.module.css'

export interface ConnectionCenterSectionInjected {
  api: ConnectionCenterApi
}

export type ConnectionCenterSectionProps = Partial<ConnectionCenterSectionInjected>

type EditableKind = Exclude<ConnectionKind, 'personal-wechat'>
type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; items: readonly ConnectionItem[] }

interface Draft {
  label: string
  kind: EditableKind
  enabled: boolean
  endpoint: string
  mcpTransport: McpTransport
  secret: string
}

const EMPTY_DRAFT: Draft = {
  label: '', kind: 'feishu-bot', enabled: false, endpoint: '', mcpTransport: 'streamable-http', secret: '',
}

const TEMPLATES: ReadonlyArray<{ kind: ConnectionKind; label: string; description: string; available: boolean }> = [
  { kind: 'feishu-bot', label: '飞书机器人', description: '保存飞书群机器人 Webhook 配置。', available: true },
  { kind: 'wechat-work-bot', label: '企业微信机器人', description: '保存企业微信群机器人 Webhook 配置。', available: true },
  { kind: 'webhook', label: '通用 Webhook', description: '保存一个通用 HTTP Webhook 目标。', available: true },
  { kind: 'mcp', label: 'MCP', description: '保存 HTTP 或本地 stdio MCP 配置。', available: true },
  { kind: 'model', label: '模型服务（识图等）', description: '保存 OpenAI 兼容的模型 API 地址与密钥，供识图等插件调用。', available: true },
  { kind: 'memory-extraction', label: '记忆提取', description: '保存供记忆自动提取使用的 OpenAI 兼容模型服务（建议低成本小模型）。', available: true },
  { kind: 'personal-wechat', label: '个人微信', description: '仅保留产品位置，当前不可创建。', available: false },
]

function template(kind: ConnectionKind): (typeof TEMPLATES)[number] {
  return TEMPLATES.find(item => item.kind === kind) ?? TEMPLATES[2]!
}

function messageOf(error: unknown): string {
  return error instanceof Error && error.message.trim().length > 0 ? error.message : '请求失败，请稍后重试。'
}

function draftFor(item: ConnectionItem): Draft {
  return {
    label: item.label,
    kind: item.kind === 'personal-wechat' ? 'webhook' : item.kind,
    enabled: item.enabled,
    // Target values may contain bot secrets. Editing starts blank; omission means preserve.
    endpoint: '',
    mcpTransport: item.mcpTransport ?? 'streamable-http',
    secret: '',
  }
}

function endpointCopy(draft: Draft): { label: string; placeholder: string } {
  if (draft.kind === 'mcp' && draft.mcpTransport === 'stdio') {
    return { label: '启动命令', placeholder: '例如：npx -y @modelcontextprotocol/server-example' }
  }
  if (draft.kind === 'mcp') return { label: 'MCP URL', placeholder: 'https://example.com/mcp' }
  if (draft.kind === 'model' || draft.kind === 'memory-extraction') return { label: '模型 API 地址（OpenAI 兼容）', placeholder: 'https://api.example.com/v1' }
  return { label: 'Webhook URL', placeholder: 'https://example.com/webhook/…' }
}

/** Configuration UI that deliberately never claims a remote is connected. */
export function ConnectionCenterSection({ api }: ConnectionCenterSectionProps): ReactNode {
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<ConnectionItem | null>(null)
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const load = async (): Promise<void> => {
    if (api === undefined) {
      setState({ status: 'error', message: '连接 API 尚未挂载。' })
      return
    }
    setState({ status: 'loading' })
    try {
      setState({ status: 'ready', items: await api.list() })
    } catch (error) {
      setState({ status: 'error', message: messageOf(error) })
    }
  }

  useEffect(() => { void load() }, [api])

  const resetEditor = (): void => {
    setAdding(false)
    setEditing(null)
    setDraft(EMPTY_DRAFT)
  }

  const runMutation = async (operation: () => Promise<void>, success: string): Promise<void> => {
    setBusy(true)
    setNotice(null)
    try {
      await operation()
      resetEditor()
      setNotice(success)
      await load()
    } catch (error) {
      setNotice(messageOf(error))
    } finally {
      setBusy(false)
    }
  }

  const openAdd = (kind: EditableKind = 'feishu-bot'): void => {
    setEditing(null)
    setDraft({ ...EMPTY_DRAFT, kind })
    setAdding(true)
    setNotice(null)
  }

  const openEdit = (item: ConnectionItem): void => {
    if (!item.canEdit || item.kind === 'personal-wechat') return
    setAdding(false)
    setEditing(item)
    setDraft(draftFor(item))
    setNotice(null)
  }

  const submit = (event: FormEvent): void => {
    event.preventDefault()
    if (api === undefined || draft.label.trim().length === 0) return
    const endpoint = draft.endpoint.trim()
    const targetMustChange = editing === null
      || !editing.endpointConfigured
      || editing.kind !== draft.kind
      || (draft.kind === 'mcp' && editing.mcpTransport !== draft.mcpTransport)
    if (targetMustChange && endpoint.length === 0) return
    const shared = {
      label: draft.label.trim(),
      kind: draft.kind,
      enabled: draft.enabled,
      ...(draft.kind === 'mcp' ? { mcpTransport: draft.mcpTransport } : {}),
      ...(endpoint.length > 0 ? { endpoint } : {}),
      ...(draft.secret.length > 0 ? { secret: draft.secret } : {}),
    }
    if (editing === null) {
      const input: ConnectionInput = { ...shared, endpoint }
      void runMutation(() => api.create(input), `已保存 ${input.label} 的配置；尚未实际连接。`)
    } else {
      void runMutation(() => api.update(editing, shared), `已更新 ${shared.label} 的配置；尚未实际连接。`)
    }
  }

  const toggleEnabled = (item: ConnectionItem): void => {
    if (api === undefined || !item.canEdit) return
    void runMutation(
      () => api.update(item, { enabled: !item.enabled }),
      `${item.label} 的配置已${item.enabled ? '停用' : '启用'}；尚未实际连接。`,
    )
  }

  const remove = (item: ConnectionItem): void => {
    if (api === undefined || !item.canDelete) return
    if (!window.confirm(`确认删除连接配置“${item.label}”吗？不会据此声称或操作任何真实连接。`)) return
    void runMutation(() => api.remove(item), `已删除 ${item.label} 的配置。`)
  }

  const endpoint = endpointCopy(draft)

  return (
    <section className={css.section} aria-busy={state.status === 'loading' || busy}>
      <header className={css.header}>
        <div><h2>连接中心</h2><p>集中整理外部服务入口与凭据引用，先建立清楚、可审核的配置清单。</p></div>
        <button className={css.primaryButton} type="button" onClick={() => { adding ? resetEditor() : openAdd() }}>{adding ? '取消添加' : '添加连接'}</button>
      </header>

      <aside className={css.warning} role="note">
        <strong>仅配置 · 尚未实际连接</strong>
        <span>当前页面不会发起 Webhook、启动 MCP、验证凭据或探测在线状态；“启用”也只保存配置开关。</span>
      </aside>

      <div className={css.templates} aria-label="连接模板">
        {TEMPLATES.map(item => (
          <button key={item.kind} disabled={!item.available} type="button" onClick={() => { if (item.available) openAdd(item.kind as EditableKind) }}>
            <strong>{item.label}</strong><span>{item.description}</span><small>{item.available ? '可添加配置' : '预留模板'}</small>
          </button>
        ))}
      </div>

      {adding || editing !== null ? (
        <form className={css.editor} onSubmit={submit}>
          <div className={css.editorHeading}>
            <h3>{editing === null ? '添加连接配置' : `编辑 ${editing.label}`}</h3>
            <span>密钥字段永不回显</span>
          </div>
          <div className={css.formGrid}>
            <label>名称<input required value={draft.label} placeholder="便于自己识别的名称" onChange={event => { setDraft(value => ({ ...value, label: event.target.value })) }} /></label>
            <label>类型<select value={draft.kind} onChange={event => { setDraft(value => ({ ...value, kind: event.target.value as EditableKind })) }}>
              {TEMPLATES.filter(item => item.available).map(item => <option key={item.kind} value={item.kind}>{item.label}</option>)}
              <option disabled value="personal-wechat">个人微信（预留）</option>
            </select></label>
          </div>
          {draft.kind === 'mcp' ? (
            <label>MCP 传输<select value={draft.mcpTransport} onChange={event => { setDraft(value => ({ ...value, mcpTransport: event.target.value as McpTransport })) }}><option value="streamable-http">Streamable HTTP</option><option value="stdio">本地 stdio</option></select></label>
          ) : null}
          <label>{endpoint.label}<input required={editing === null || !editing.endpointConfigured || editing.kind !== draft.kind || (draft.kind === 'mcp' && editing.mcpTransport !== draft.mcpTransport)} value={draft.endpoint} placeholder={editing?.endpointConfigured ? '已保存；留空保持不变，输入新值则替换' : endpoint.placeholder} onChange={event => { setDraft(value => ({ ...value, endpoint: event.target.value })) }} /><small>{editing?.endpointConfigured ? '现有目标不会回填到浏览器；留空表示保持。' : '请输入连接目标。'}</small></label>
          <label>密钥 / Token（只写）<input type="password" autoComplete="new-password" value={draft.secret} placeholder={editing?.secretConfigured ? '已保存；留空保持不变' : '可选；保存后不会回显'} onChange={event => { setDraft(value => ({ ...value, secret: event.target.value })) }} /><small>{editing?.secretConfigured ? '已有凭据已配置；其内容未读取到浏览器。' : '输入内容只用于本次写入。'}</small></label>
          <label className={css.checkbox}><input type="checkbox" checked={draft.enabled} onChange={event => { setDraft(value => ({ ...value, enabled: event.target.checked })) }} /><span>启用这条配置（仍不代表已连接）</span></label>
          <div className={css.actions}><button type="button" onClick={resetEditor}>取消</button><button className={css.primaryButton} disabled={busy} type="submit">保存配置</button></div>
        </form>
      ) : null}

      {notice !== null ? <p className={css.notice} role="status">{notice}</p> : null}
      {state.status === 'loading' ? <p className={css.status}>正在读取连接配置…</p> : null}
      {state.status === 'error' ? <div className={css.failure}><p role="alert">{state.message}</p><button type="button" onClick={() => { void load() }}>重试</button></div> : null}
      {state.status === 'ready' && state.items.length === 0 ? <p className={css.status}>还没有保存任何连接配置。</p> : null}
      {state.status === 'ready' && state.items.length > 0 ? (
        <ul className={css.cards}>
          {state.items.map(item => (
            <li className={css.card} key={item.id}>
              <div className={css.cardHeading}>
                <div><strong>{item.label}</strong><span>{template(item.kind).label}</span></div>
                <span className={css.configState} data-enabled={item.enabled ? 'true' : 'false'}>{item.enabled ? '配置已启用' : '配置已停用'}</span>
              </div>
              <p className={css.notConnected}>仅配置 · 尚未实际连接</p>
              <code title={item.endpointDisplay}>{item.endpointDisplay || (item.endpointConfigured ? '目标已配置（已隐藏）' : '未填写目标')}</code>
              <div className={css.credentials}><span>{item.secretConfigured ? '凭据已保存（不可见）' : '未保存凭据'}</span>{item.kind === 'mcp' ? <span>{item.mcpTransport === 'stdio' ? 'stdio' : 'Streamable HTTP'}</span> : null}</div>
              <div className={css.cardActions}>
                <button disabled={!item.canEdit || busy} type="button" onClick={() => { toggleEnabled(item) }}>{item.enabled ? '停用配置' : '启用配置'}</button>
                <button disabled={!item.canEdit || busy} type="button" onClick={() => { openEdit(item) }}>编辑</button>
                <button className={css.dangerButton} disabled={!item.canDelete || busy} type="button" onClick={() => { remove(item) }}>删除</button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}
