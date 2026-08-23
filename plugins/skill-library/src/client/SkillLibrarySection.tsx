import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import type { NewSkillInput, SkillItem, SkillLibraryApi } from './skillApi.ts'
import css from './SkillLibrarySection.module.css'

export interface SkillLibrarySectionInjected {
  api: SkillLibraryApi
}

export type SkillLibrarySectionProps = Partial<SkillLibrarySectionInjected>

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; items: readonly SkillItem[] }

const EMPTY_NEW: NewSkillInput = { name: '', category: '', description: '', content: '' }

function messageOf(error: unknown): string {
  return error instanceof Error && error.message.trim().length > 0 ? error.message : '请求失败，请稍后重试。'
}

/** Searchable, category-grouped Skill catalog with guarded mutations. */
export function SkillLibrarySection({ api }: SkillLibrarySectionProps): ReactNode {
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [query, setQuery] = useState('')
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState<NewSkillInput>(EMPTY_NEW)
  const [editing, setEditing] = useState<SkillItem | null>(null)
  const [editCategory, setEditCategory] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const load = async (): Promise<void> => {
    if (api === undefined) {
      setState({ status: 'error', message: 'Skill API 尚未挂载。' })
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

  const groups = useMemo(() => {
    if (state.status !== 'ready') return []
    const needle = query.trim().toLocaleLowerCase()
    const matching = needle.length === 0
      ? state.items
      : state.items.filter(item => [item.name, item.description, item.category]
        .some(value => value.toLocaleLowerCase().includes(needle)))
    const grouped = new Map<string, SkillItem[]>()
    for (const item of matching) {
      const list = grouped.get(item.category) ?? []
      list.push(item)
      grouped.set(item.category, list)
    }
    return [...grouped.entries()]
      .sort(([left], [right]) => left.localeCompare(right, 'zh-CN'))
      .map(([category, items]) => ({ category, items: items.sort((a, b) => a.name.localeCompare(b.name)) }))
  }, [query, state])

  const runMutation = async (operation: () => Promise<void>, success: string): Promise<void> => {
    setBusy(true)
    setNotice(null)
    try {
      await operation()
      setNotice(success)
      await load()
    } catch (error) {
      setNotice(messageOf(error))
    } finally {
      setBusy(false)
    }
  }

  const submitNew = (event: FormEvent): void => {
    event.preventDefault()
    if (api === undefined || draft.name.trim().length === 0 || draft.description.trim().length === 0) return
    const input = {
      name: draft.name.trim(),
      category: draft.category.trim() || '未分类',
      description: draft.description.trim(),
      content: draft.content.trim(),
    }
    void runMutation(async () => {
      await api.create(input)
      setDraft(EMPTY_NEW)
      setAdding(false)
    }, `已添加 ${input.name}。`)
  }

  const startEdit = (item: SkillItem): void => {
    setEditing(item)
    setEditCategory(item.category)
    setEditDescription(item.description === '暂无简介' ? '' : item.description)
    setNotice(null)
  }

  const submitEdit = (event: FormEvent): void => {
    event.preventDefault()
    if (api === undefined || editing === null || editDescription.trim().length === 0) return
    const patch = { category: editCategory.trim() || '未分类', description: editDescription.trim() }
    void runMutation(async () => {
      await api.update(editing, patch)
      setEditing(null)
    }, `已更新 ${editing.name}。`)
  }

  const remove = (item: SkillItem): void => {
    if (api === undefined || !item.canDelete) return
    if (!window.confirm(`确认删除 Skill“${item.name}”吗？此操作只会在 API 明确允许时执行。`)) return
    void runMutation(() => api.remove(item), `已删除 ${item.name}。`)
  }

  return (
    <section className={css.section} aria-busy={state.status === 'loading' || busy}>
      <header className={css.header}>
        <div>
          <h2>Skill 资料库</h2>
          <p>整理个人 Skill 的分类与一句话简介；实际生效范围仍由 Harness 的 Skill 目录和会话决定。</p>
        </div>
        <button className={css.primaryButton} type="button" onClick={() => { setAdding(value => !value); setEditing(null) }}>
          {adding ? '取消添加' : '添加 Skill'}
        </button>
      </header>

      {adding ? (
        <form className={css.formCard} onSubmit={submitNew}>
          <h3>添加 Skill</h3>
          <div className={css.formGrid}>
            <label>名称<input required value={draft.name} placeholder="例如：weekly-review" onChange={event => { setDraft(value => ({ ...value, name: event.target.value })) }} /></label>
            <label>分类<input value={draft.category} placeholder="未分类" onChange={event => { setDraft(value => ({ ...value, category: event.target.value })) }} /></label>
          </div>
          <label>一句话简介<input required value={draft.description} placeholder="说明它在什么情况下最有用" onChange={event => { setDraft(value => ({ ...value, description: event.target.value })) }} /></label>
          <label>初始内容<textarea value={draft.content} rows={5} placeholder="Skill 的 Markdown 指令内容（可留空后再编辑）" onChange={event => { setDraft(value => ({ ...value, content: event.target.value })) }} /></label>
          <div className={css.actions}><button className={css.primaryButton} disabled={busy} type="submit">保存</button></div>
        </form>
      ) : null}

      {editing !== null ? (
        <form className={css.formCard} onSubmit={submitEdit}>
          <h3>编辑 {editing.name}</h3>
          <label>分类<input value={editCategory} onChange={event => { setEditCategory(event.target.value) }} /></label>
          <label>一句话简介<input required value={editDescription} onChange={event => { setEditDescription(event.target.value) }} /></label>
          <div className={css.actions}>
            <button type="button" onClick={() => { setEditing(null) }}>取消</button>
            <button className={css.primaryButton} disabled={busy} type="submit">保存修改</button>
          </div>
        </form>
      ) : null}

      <label className={css.search}>
        <span>搜索</span>
        <input type="search" value={query} placeholder="按名称、分类或简介搜索" onChange={event => { setQuery(event.target.value) }} />
      </label>

      {notice !== null ? <p className={css.notice} role="status">{notice}</p> : null}
      {state.status === 'loading' ? <p className={css.status}>正在读取 Skill…</p> : null}
      {state.status === 'error' ? <div className={css.failure}><p role="alert">{state.message}</p><button type="button" onClick={() => { void load() }}>重试</button></div> : null}
      {state.status === 'ready' && state.items.length === 0 ? <p className={css.status}>资料库中还没有 Skill。</p> : null}
      {state.status === 'ready' && state.items.length > 0 && groups.length === 0 ? <p className={css.status}>没有匹配的 Skill。</p> : null}

      <div className={css.groups}>
        {groups.map(group => (
          <section className={css.group} key={group.category}>
            <div className={css.groupHeading}><h3>{group.category}</h3><span>{group.items.length}</span></div>
            <ul className={css.cards}>
              {group.items.map(item => (
                <li className={css.card} key={item.id}>
                  <div className={css.cardCopy}>
                    <strong>{item.name}</strong>
                    <p title={item.description}>{item.description}</p>
                    {item.source !== undefined ? <small>{item.source}</small> : null}
                  </div>
                  <div className={css.cardActions}>
                    <button disabled={!item.canEdit || busy} type="button" onClick={() => { startEdit(item) }}>编辑</button>
                    <button className={css.dangerButton} disabled={!item.canDelete || busy} title={item.canDelete ? '删除' : '此 Skill 未被 API 标记为可删除'} type="button" onClick={() => { remove(item) }}>删除</button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </section>
  )
}
