import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import css from './AppFrame.module.css'

type ProjectSidebarActionProps = PropsRuntime<'sidebar.footer.action'> & {
  toggleProject: () => void
}

/** Native-sidebar entry that toggles the Project Console without covering chat. */
export function ProjectSidebarAction({ wide, toggleProject }: ProjectSidebarActionProps) {
  return (
    <button
      className={css.sidebarProjectAction}
      type="button"
      data-wide={wide}
      data-personal-project-entry="sidebar"
      aria-label="切换项目控制台"
      {...(!wide ? { title: '项目控制台' } : {})}
      onClick={toggleProject}
    >
      <svg className={css.sidebarProjectIcon} viewBox="0 0 20 20" aria-hidden="true">
        <rect x="3" y="3" width="14" height="14" rx="3" />
        <path d="M7.25 3v14M7.25 8h9.75" />
      </svg>
      {wide && <span className={css.sidebarProjectLabel}>项目控制台</span>}
    </button>
  )
}
