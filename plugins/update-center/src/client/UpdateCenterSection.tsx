import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import type { UpdateCenterBridge, UpdateCenterState, UpdateSettings, UpdateStatus } from './desktopBridge.ts'
import css from './UpdateCenterSection.module.css'

export interface UpdateCenterSectionInjected {
  bridge: UpdateCenterBridge
}

export type UpdateCenterSectionProps = Partial<UpdateCenterSectionInjected>

type ViewState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; value: UpdateCenterState }

const STATUS_COPY: Record<UpdateStatus, string> = {
  idle: '尚未检查',
  checking: '正在检查',
  current: '已是最新',
  available: '发现更新',
  blocked: '更新被兼容门阻断',
  preparing: '正在准备',
  ready: '可以安装',
  error: '检查失败',
  unsupported: '当前不可用',
}

function messageOf(error: unknown): string {
  return error instanceof Error && error.message.trim().length > 0 ? error.message : '更新操作失败，请稍后重试。'
}

function shortCommit(value: string | undefined): string {
  return value === undefined ? '未知' : value.slice(0, 10)
}

function dateTime(value: string | undefined): string {
  if (value === undefined) return '尚未检查'
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString('zh-CN')
}

/** Settings surface for desktop releases, versioned Harness runtimes, and bundled plugins. */
export function UpdateCenterSection({ bridge }: UpdateCenterSectionProps): ReactNode {
  const [view, setView] = useState<ViewState>({ status: 'loading' })
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [draft, setDraft] = useState<UpdateSettings | null>(null)

  const load = async (): Promise<void> => {
    if (bridge === undefined) {
      setView({ status: 'error', message: '桌面更新服务尚未挂载。' })
      return
    }
    try {
      const value = await bridge.getState()
      setView({ status: 'ready', value })
      setDraft(value.settings)
    } catch (error) {
      setView({ status: 'error', message: messageOf(error) })
    }
  }

  useEffect(() => { void load() }, [bridge])

  const run = async (label: string, operation: () => Promise<UpdateCenterState | void>, success: string): Promise<void> => {
    setBusy(label)
    setNotice(null)
    try {
      const result = await operation()
      if (result !== undefined) {
        setView({ status: 'ready', value: result })
        setDraft(result.settings)
      }
      setNotice(success)
    } catch (error) {
      setNotice(messageOf(error))
    } finally {
      setBusy(null)
    }
  }

  const save = (event: FormEvent): void => {
    event.preventDefault()
    if (bridge === undefined || draft === null) return
    void run('save', () => bridge.configure(draft), '更新设置已保存。')
  }

  const state = view.status === 'ready' ? view.value : undefined
  const desktopSummary = useMemo(() => {
    if (state === undefined) return ''
    return state.desktop.latestVersion === undefined
      ? `当前 ${state.desktop.currentVersion}`
      : `当前 ${state.desktop.currentVersion} · 最新 ${state.desktop.latestVersion}`
  }, [state])

  return (
    <section className={css.section} aria-busy={busy !== null || view.status === 'loading'}>
      <header className={css.header}>
        <div><h2>更新中心</h2><p>分别管理桌面客户端、Harness 运行时和随客户端发布的个人插件。</p></div>
        <button className={css.primary} disabled={bridge === undefined || busy !== null} type="button" onClick={() => {
          if (bridge !== undefined) void run('check', () => bridge.check(), '检查完成。')
        }}>检查更新</button>
      </header>

      {view.status === 'loading' ? <p className={css.status}>正在读取更新状态…</p> : null}
      {view.status === 'error' ? <div className={css.failure}><p role="alert">{view.message}</p><button type="button" onClick={() => { void load() }}>重试</button></div> : null}
      {notice !== null ? <p className={css.notice} role="status">{notice}</p> : null}

      {state !== undefined ? <>
        <div className={css.summary}>
          <span>最近检查</span><strong>{dateTime(state.lastCheckedAt)}</strong>
          <span>更新策略</span><strong>发现后提示，由你确认下载和重启</strong>
        </div>

        <div className={css.cards}>
          <article className={css.card}>
            <div className={css.cardHeader}><div><h3>Personal 客户端</h3><p>{desktopSummary}</p></div><StatusBadge status={state.desktop.status} /></div>
            <dl><div><dt>分发形态</dt><dd>{state.desktop.packaging === 'nsis' ? 'Windows 安装版' : state.desktop.packaging === 'portable' ? 'Portable' : '开发环境'}</dd></div>{state.desktop.publishedAt !== undefined ? <div><dt>发布时间</dt><dd>{dateTime(state.desktop.publishedAt)}</dd></div> : null}</dl>
            {state.desktop.message !== undefined ? <p className={css.detail}>{state.desktop.message}</p> : null}
            {state.desktop.releaseNotes !== undefined ? <details><summary>更新说明</summary><p className={css.releaseNotes}>{state.desktop.releaseNotes}</p></details> : null}
            <div className={css.actions}>
              <button disabled={busy !== null || state.desktop.releaseUrl === undefined} type="button" onClick={() => { if (bridge !== undefined) void run('open-desktop', async () => { await bridge.openRelease('desktop') }, '已打开版本页面。') }}>版本页面</button>
              <button disabled={busy !== null || !state.desktop.canDownload} type="button" onClick={() => { if (bridge !== undefined) void run('download', () => bridge.downloadDesktop(), '更新已下载。') }}>下载更新</button>
              <button className={css.primary} disabled={busy !== null || !state.desktop.canInstall} type="button" onClick={() => { if (bridge !== undefined) void run('install', () => bridge.installDesktop(), '正在退出并安装更新。') }}>重启安装</button>
              <button disabled={busy !== null || !state.desktop.canRollbackDesktop} type="button" onClick={() => { if (bridge !== undefined && window.confirm('确认重装上一已知良好客户端吗？')) void run('rollback-desktop', () => bridge.rollbackDesktop(), '正在退出并回滚客户端。') }}>回滚客户端</button>
            </div>
          </article>

          <article className={css.card}>
            <div className={css.cardHeader}><div><h3>DeepSeek Harness</h3><p>{shortCommit(state.harness.currentCommit)} → {shortCommit(state.harness.remoteCommit)}</p></div><StatusBadge status={state.harness.status} /></div>
            <dl><div><dt>当前目录</dt><dd title={state.harness.sourceRoot}>{state.harness.sourceRoot}</dd></div><div><dt>安全方式</dt><dd>独立版本目录准备，验证后重启切换</dd></div></dl>
            {state.harness.dirty ? <p className={css.warning}>当前上游存在 tracked 修改；更新中心不会覆盖它。</p> : null}
            {state.harness.message !== undefined ? <p className={css.detail}>{state.harness.message}</p> : null}
            <div className={css.actions}>
              <button disabled={busy !== null} type="button" onClick={() => { if (bridge !== undefined) void run('open-harness', async () => { await bridge.openRelease('harness') }, '已打开 Harness 项目页面。') }}>项目页面</button>
              <button disabled={busy !== null || !state.harness.canPrepare} type="button" onClick={() => { if (bridge !== undefined) void run('prepare', () => bridge.prepareHarness(), '新运行时已下载并通过准备检查。') }}>下载并验证</button>
              <button className={css.primary} disabled={busy !== null || !state.harness.canActivate} type="button" onClick={() => { if (bridge !== undefined && window.confirm('切换 Harness 版本需要关闭当前会话并重启客户端，是否继续？')) void run('activate', () => bridge.activateHarness(), '正在重启并切换 Harness。') }}>切换并重启</button>
              <button disabled={busy !== null || !state.harness.canRollback} type="button" onClick={() => { if (bridge !== undefined && window.confirm('确认回到上一套已验证的 Harness 运行时吗？')) void run('rollback', () => bridge.rollbackHarness(), '正在重启并回滚 Harness。') }}>回滚</button>
            </div>
          </article>
        </div>

        <article className={css.pluginCard}>
          <div className={css.cardHeader}><div><h3>个人插件</h3><p>内置集合与独立更新通道分开显示；下载验证通过后重启整批激活。</p></div><StatusBadge status={state.pluginChannel?.status ?? 'idle'} /></div>
          {state.pluginChannel?.message !== undefined ? <p className={css.detail}>{state.pluginChannel.message}</p> : null}
          <ul>{state.plugins.map(plugin => <li key={plugin.packageName}><code>{plugin.packageName}</code><span>{plugin.version}</span><small>{plugin.updateWithDesktop ? '随客户端更新' : '独立更新源'}</small></li>)}</ul>
          {state.pluginChannel?.available !== undefined && state.pluginChannel.available.length > 0 ? <>
            <h4>可更新插件</h4>
            <ul>{state.pluginChannel.available.map(plugin => <li key={plugin.packageName}><code>{plugin.packageName}</code><span>{plugin.currentVersion ?? '未安装'} → {plugin.version}</span></li>)}</ul>
            <div className={css.actions}>
              <button className={css.primary} disabled={busy !== null} type="button" onClick={() => { if (bridge !== undefined) void run('prepare-plugin', () => bridge.preparePluginGeneration(), '插件 generation 已准备，重启后激活。') }}>下载并准备插件更新</button>
              <button disabled={busy !== null || !state.pluginChannel.canRollback} type="button" onClick={() => { if (bridge !== undefined && window.confirm('确认回滚到上一外部 generation 或内置插件基线吗？')) void run('rollback-plugin', () => bridge.rollbackPluginGeneration(), '回滚已记录，重启后生效。') }}>回滚插件</button>
            </div>
          </> : null}
          {state.pluginChannel?.blocked !== undefined && state.pluginChannel.blocked.length > 0 ? <>
            <h4>被兼容门阻断</h4>
            <ul>{state.pluginChannel.blocked.map(plugin => <li key={plugin.packageName}><code>{plugin.packageName}</code><span>{plugin.currentVersion ?? '未安装'} → {plugin.version}</span><small>{plugin.blockedReason}</small></li>)}</ul>
          </> : null}
        </article>

        {draft !== null ? <form className={css.settings} onSubmit={save}>
          <h3>更新设置</h3>
          <label>Personal GitHub 仓库<input value={draft.desktopRepository} placeholder="owner/repository；发布仓库建立后填写" onChange={event => { setDraft(value => value === null ? value : { ...value, desktopRepository: event.target.value }) }} /></label>
          <label>插件 GitHub 仓库<input value={draft.pluginRepository} placeholder="owner/repository；留空则只使用本地 fixture/内置" onChange={event => { setDraft(value => value === null ? value : { ...value, pluginRepository: event.target.value }) }} /></label>
          <label>Harness GitHub 仓库<input readOnly value={draft.harnessRepository} title="为避免执行任意仓库脚本，此来源固定为官方仓库。" /></label>
          <div className={css.settingRow}><label>通道<select value={draft.channel} onChange={event => { setDraft(value => value === null ? value : { ...value, channel: event.target.value as UpdateSettings['channel'] }) }}><option value="stable">稳定版</option><option value="beta">测试版</option></select></label><label className={css.checkbox}><input checked={draft.autoCheck} type="checkbox" onChange={event => { setDraft(value => value === null ? value : { ...value, autoCheck: event.target.checked }) }} /><span>启动后自动检查</span></label></div>
          <div className={css.actions}><button className={css.primary} disabled={busy !== null} type="submit">保存设置</button></div>
        </form> : null}
      </> : null}
    </section>
  )
}

function StatusBadge({ status }: { status: UpdateStatus }): ReactNode {
  return <span className={css.badge} data-status={status}>{STATUS_COPY[status]}</span>
}
