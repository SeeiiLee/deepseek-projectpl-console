import { useEffect, useState, type ReactNode } from 'react'
import type { WorkbenchTabDescriptor } from '@cyrus/dsh-workbench/client'
import { createProjectControlApi, type ProjectProgressUpdate } from './projectControlApi.ts'
import css from './ProjectConsole.module.css'

const api = createProjectControlApi()

export const PROGRESS_UPDATE_RESOURCE_PATTERN = /^prj_[0-9a-f-]+:upd:upd_[0-9a-f-]+$/u

export function isProgressUpdateResourceKey(value: unknown): value is string {
  return typeof value === 'string' && PROGRESS_UPDATE_RESOURCE_PATTERN.test(value)
}

/**
 * Plugin-owned artifact viewer for accepted external runtime updates.
 * It reads only from the bounded Host projections — it never re-imports
 * rendered Markdown or re-implements other Workbench viewers.
 */
export function ProgressUpdateViewer({ descriptor }: { descriptor: WorkbenchTabDescriptor }): ReactNode {
  const resourceKey = descriptor.resourceKey ?? ''
  const separator = resourceKey.indexOf(':upd:')
  const projectId = separator > 0 ? resourceKey.slice(0, separator) : ''
  const updateId = separator > 0 ? resourceKey.slice(separator + 5) : ''
  const [update, setUpdate] = useState<ProjectProgressUpdate>()
  const [error, setError] = useState<string>()

  useEffect(() => {
    if (projectId === '' || updateId === '') {
      setError('更新标识无效。')
      return
    }
    const controller = new AbortController()
    api.listProgressUpdates(projectId, controller.signal)
      .then(page => {
        if (controller.signal.aborted) return
        const found = page.items.find(item => item.progressUpdateId === updateId)
        if (found === undefined) setError('这条更新已不在项目投影中。')
        else setUpdate(found)
      })
      .catch(() => { if (!controller.signal.aborted) setError('更新读取失败。') })
    return () => { controller.abort() }
  }, [projectId, updateId])

  if (error !== undefined) {
    return <div className={css.tabNotice} role="alert" data-kind="error">{error}</div>
  }
  if (update === undefined) {
    return <div className={css.tabNotice} role="status" data-kind="loading">正在读取进展更新…</div>
  }
  return (
    <div className={css.activity} data-progress-update-viewer data-kind={update.kind}>
      <div className={css.itemCard}>
        <div className={css.itemTopline}>
          <strong>{update.summary}</strong>
          <span className={css.updateKindBadge} data-kind={update.kind}>{updateKindLabel(update.kind)}</span>
        </div>
        <span className={css.itemMeta}>
          <span>{'聚合修订 ' + String(update.aggregateRevision)}</span>
          <span>{update.aggregateType + ' ' + update.aggregateId}</span>
          <span>{update.createdAt}</span>
        </span>
        {update.details !== null && <p className={css.itemInstruction}>{update.details}</p>}
        {update.needs.length > 0 && (
          <ul className={css.acceptanceList}>
            {update.needs.map((need, index) => <li key={String(index)}>{'需要：' + need}</li>)}
          </ul>
        )}
        {update.acceptanceClaims.length > 0 && (
          <ul className={css.acceptanceList}>
            {update.acceptanceClaims.map((claim, index) => <li key={String(index)}>{'验收声明：' + claim}</li>)}
          </ul>
        )}
        {update.threadId !== null && (
          <span className={css.itemMeta}><span>{'线程 ' + update.threadId}</span></span>
        )}
      </div>
    </div>
  )
}

function updateKindLabel(kind: ProjectProgressUpdate['kind']): string {
  switch (kind) {
    case 'progress': return '进展'
    case 'blocker': return '阻塞'
    case 'completion_declared': return '完成声明'
  }
}