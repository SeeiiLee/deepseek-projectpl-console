import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import type { PluginItem, PluginOrganizerApi } from './pluginApi.ts'
import css from './PluginOrganizerSection.module.css'

export interface PluginOrganizerSectionInjected {
  api: PluginOrganizerApi
}

export type PluginOrganizerSectionProps = Partial<PluginOrganizerSectionInjected>

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; items: readonly PluginItem[]; refreshedAt: number }

function messageOf(error: unknown): string {
  return error instanceof Error && error.message.trim().length > 0 ? error.message : '请求失败，请稍后重试。'
}

const PHASE_LABEL = {
  pending: '等待加载', loading: '加载中', active: '运行中', failed: '加载失败', unloading: '卸载中', unobserved: '未观察到运行实例',
} as const

function phaseLabel(item: PluginItem): string {
  return item.fiberPhase === null ? PHASE_LABEL.unobserved : PHASE_LABEL[item.fiberPhase]
}

/** Live Loader inventory enriched with personal, editable organization metadata. */
export function PluginOrganizerSection({ api }: PluginOrganizerSectionProps): ReactNode {
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<PluginItem | null>(null)
  const [category, setCategory] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    if (api === undefined) {
      setState({ status: 'error', message: '插件清单 API 尚未挂载。' })
      return
    }
    let alive = true
    let first = true
    let controller: AbortController | undefined
    const refresh = async (): Promise<void> => {
      controller?.abort()
      controller = new AbortController()
      if (first) setState({ status: 'loading' })
      try {
        const items = await api.list(controller.signal)
        if (alive) setState({ status: 'ready', items, refreshedAt: Date.now() })
      } catch (error) {
        if (alive && !controller.signal.aborted) setState({ status: 'error', message: messageOf(error) })
      } finally {
        first = false
      }
    }
    void refresh()
    const timer = window.setInterval(() => { void refresh() }, 5000)
    return () => { alive = false; controller?.abort(); window.clearInterval(timer) }
  }, [api, reloadToken])

  const groups = useMemo(() => {
    if (state.status !== 'ready') return []
    const needle = query.trim().toLocaleLowerCase()
    const items = needle.length === 0
      ? state.items
      : state.items.filter(item => [item.packageName, item.entryId, item.category, item.description]
        .some(value => value.toLocaleLowerCase().includes(needle)))
    const map = new Map<string, PluginItem[]>()
    for (const item of items) {
      const group = map.get(item.category) ?? []
      group.push(item)
      map.set(item.category, group)
    }
    return [...map.entries()]
      .sort(([left], [right]) => left.localeCompare(right, 'zh-CN'))
      .map(([name, entries]) => ({ name, entries: entries.sort((a, b) => a.packageName.localeCompare(b.packageName)) }))
  }, [query, state])

  const startEdit = (item: PluginItem): void => {
    setEditing(item)
    setCategory(item.category)
    setDescription(item.description)
    setNotice(null)
  }

  const submit = (event: FormEvent): void => {
    event.preventDefault()
    if (api === undefined || editing === null || category.trim().length === 0 || description.trim().length === 0) return
    setBusy(true)
    setNotice(null)
    void api.update(editing, { category: category.trim(), description: description.trim() }).then(
      () => {
        setEditing(null)
        setNotice(`已更新 ${editing.packageName} 的整理信息。`)
        setReloadToken(value => value + 1)
      },
      error => { setNotice(messageOf(error)) },
    ).finally(() => { setBusy(false) })
  }

  return (
    <section className={css.section} aria-busy={state.status === 'loading' || busy}>
      <header className={css.header}>
        <div>
          <h2>插件整理</h2>
          <p>这里读取实时 Loader 清单，只维护个人分类与一句话简介。安装、更新和卸载请使用 Harness 原生“插件”页。</p>
        </div>
        <button type="button" onClick={() => { setReloadToken(value => value + 1) }}>立即刷新</button>
      </header>

      <aside className={css.boundary}>
        <strong>职责边界</strong>
        <span>本页不会安装、卸载、启用或停用插件；运行状态来自当前 Loader 快照。需要安装、更新或回滚插件时，请前往设置 → 更新中心。</span>
      </aside>

      {editing !== null ? (
        <form className={css.editor} onSubmit={submit}>
          <h3>整理 {editing.packageName}</h3>
          <label>分类<input required value={category} onChange={event => { setCategory(event.target.value) }} /></label>
          <label>一句话简介<input required value={description} onChange={event => { setDescription(event.target.value) }} /></label>
          <div className={css.actions}>
            <button type="button" onClick={() => { setEditing(null) }}>取消</button>
            <button className={css.primaryButton} disabled={busy} type="submit">保存</button>
          </div>
        </form>
      ) : null}

      <label className={css.search}>搜索<input type="search" value={query} placeholder="按包名、入口、分类或简介搜索" onChange={event => { setQuery(event.target.value) }} /></label>
      {notice !== null ? <p className={css.notice} role="status">{notice}</p> : null}
      {state.status === 'loading' ? <p className={css.status}>正在读取 Loader 清单…</p> : null}
      {state.status === 'error' ? <div className={css.failure}><p role="alert">{state.message}</p><button type="button" onClick={() => { setReloadToken(value => value + 1) }}>重试</button></div> : null}
      {state.status === 'ready' ? <p className={css.live}><span />实时清单 · 每 5 秒刷新 · {state.items.length} 项</p> : null}
      {state.status === 'ready' && state.items.length === 0 ? <p className={css.status}>当前 Loader 没有可展示的插件条目。</p> : null}
      {state.status === 'ready' && state.items.length > 0 && groups.length === 0 ? <p className={css.status}>没有匹配的插件。</p> : null}

      <div className={css.groups}>
        {groups.map(group => (
          <section className={css.group} key={group.name}>
            <div className={css.groupHeading}><h3>{group.name}</h3><span>{group.entries.length}</span></div>
            <ul className={css.cards}>
              {group.entries.map(item => (
                <li className={css.card} key={item.id}>
                  <div className={css.cardHeader}>
                    <strong title={item.packageName}>{item.packageName}</strong>
                    <span className={css.phase} data-phase={item.fiberPhase ?? 'unobserved'}>{item.enabled ? phaseLabel(item) : '配置已停用'}</span>
                  </div>
                  <p className={css.description} title={item.description}>{item.description}</p>
                  <div className={css.meta}>
                    <code title={item.entryId}>{item.entryId}</code>
                    <span>{item.categoryCustomized || item.descriptionCustomized ? '含自定义整理' : '默认整理'}</span>
                    {item.version !== undefined ? <span>v{item.version}</span> : null}
                    {item.source !== undefined ? <span>{item.source === 'external' ? '外部' : '内置'}</span> : null}
                    {item.degradedReason !== undefined ? <span title={item.degradedReason}>降级</span> : null}
                  </div>
                  <div className={css.cardActions}><button disabled={!item.canEdit || busy} type="button" onClick={() => { startEdit(item) }}>编辑分类和简介</button></div>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </section>
  )
}
