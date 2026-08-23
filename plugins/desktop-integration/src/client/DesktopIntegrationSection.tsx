import { useEffect, useState, type ReactNode } from 'react'
import type { DesktopIntegrationBridge, DesktopIntegrationState } from './desktopBridge.ts'
import css from './DesktopIntegrationSection.module.css'

export interface DesktopIntegrationSectionInjected { bridge: DesktopIntegrationBridge }
export type DesktopIntegrationSectionProps = Partial<DesktopIntegrationSectionInjected>

type LoadState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; value: DesktopIntegrationState }

function messageOf(error: unknown): string {
  return error instanceof Error && error.message.trim() !== '' ? error.message : '桌面设置操作失败。'
}

/** Native desktop settings and process-guardian status. */
export function DesktopIntegrationSection({ bridge }: DesktopIntegrationSectionProps): ReactNode {
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const load = async (): Promise<void> => {
    if (bridge === undefined) {
      setState({ status: 'error', message: '桌面集成服务尚未挂载。' })
      return
    }
    try { setState({ status: 'ready', value: await bridge.getState() }) } catch (error) { setState({ status: 'error', message: messageOf(error) }) }
  }
  useEffect(() => { void load() }, [bridge])

  const configure = async (patch: Partial<Pick<DesktopIntegrationState, 'closeToTray' | 'maintainShortcuts'>>): Promise<void> => {
    if (bridge === undefined || state.status !== 'ready') return
    setBusy(true); setNotice(null)
    try {
      const current = state.value
      const value = await bridge.configure({
        closeToTray: patch.closeToTray ?? current.closeToTray,
        maintainShortcuts: patch.maintainShortcuts ?? current.maintainShortcuts,
      })
      setState({ status: 'ready', value })
      setNotice('桌面设置已保存。')
    } catch (error) { setNotice(messageOf(error)) } finally { setBusy(false) }
  }

  const repair = async (): Promise<void> => {
    if (bridge === undefined) return
    setBusy(true); setNotice(null)
    try { setState({ status: 'ready', value: await bridge.repairShortcuts() }); setNotice('快捷方式检查完成。') }
    catch (error) { setNotice(messageOf(error)) } finally { setBusy(false) }
  }

  return <section className={css.section} aria-busy={busy || state.status === 'loading'}>
    <header><div><h2>桌面集成</h2><p>管理托盘、快捷方式和退出时的后台进程清理。</p></div><span className={css.builtin}>内置必需</span></header>
    {notice !== null ? <p className={css.notice} role="status">{notice}</p> : null}
    {state.status === 'loading' ? <p>正在读取桌面状态…</p> : null}
    {state.status === 'error' ? <p className={css.error} role="alert">{state.message}</p> : null}
    {state.status === 'ready' ? <>
      <div className={css.identity}><div className={css.mark}>H</div><div><strong>{state.value.appName}</strong><span>{state.value.appVersion} · {state.value.packaging === 'nsis' ? '安装版' : state.value.packaging === 'portable' ? 'Portable' : '开发环境'}</span></div></div>
      <div className={css.grid}>
        <article><h3>托盘行为</h3><p>{state.value.trayAvailable ? '托盘图标已启动，可快速显示、隐藏或退出。' : '当前环境没有可用托盘。'}</p><label><input checked={state.value.closeToTray} disabled={busy || !state.value.trayAvailable} type="checkbox" onChange={event => { void configure({ closeToTray: event.target.checked }) }} /><span>关闭窗口时最小化到托盘</span></label></article>
        <article><h3>进程守护</h3><p>{state.value.processGuardian.strategy === 'windows-job-object' ? 'Windows Job Object 已接管 Helper 进程树；应用异常关闭时也会清理。' : '使用 Harness 优雅退出和 PID 进程树强制清理。'}</p><dl><div><dt>守护状态</dt><dd>{state.value.processGuardian.active ? '运行中' : '未启动'}</dd></div><div><dt>Helper</dt><dd>{state.value.processGuardian.helperAssigned ? '已纳入守护' : '等待启动'}</dd></div></dl></article>
      </div>
      <article className={css.shortcuts}><div><h3>快捷方式维护</h3><p>只维护带有本应用所有权标记的快捷方式，不覆盖同名的其他应用链接。</p></div><div className={css.options}><label><input checked={state.value.maintainShortcuts.desktop} disabled={busy || state.value.packaging === 'development'} type="checkbox" onChange={event => { void configure({ maintainShortcuts: { ...state.value.maintainShortcuts, desktop: event.target.checked } }) }} /><span>桌面</span></label><label><input checked={state.value.maintainShortcuts.startMenu} disabled={busy || state.value.packaging === 'development'} type="checkbox" onChange={event => { void configure({ maintainShortcuts: { ...state.value.maintainShortcuts, startMenu: event.target.checked } }) }} /><span>开始菜单</span></label><button disabled={busy || state.value.packaging === 'development'} type="button" onClick={() => { void repair() }}>立即检查并修复</button></div><ul>{state.value.shortcuts.map(item => <li key={item.location}><span>{item.location === 'desktop' ? '桌面' : '开始菜单'}</span><code title={item.path}>{item.path}</code><small>{item.exists ? item.managed ? '由本应用维护' : '已存在但不属于本应用' : '尚未创建'}</small></li>)}</ul></article>
    </> : null}
  </section>
}
