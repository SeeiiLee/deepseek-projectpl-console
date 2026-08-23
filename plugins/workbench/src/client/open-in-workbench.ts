/**
 * R-UX 工作台内打开 Markdown：点击 .md 链接（编辑器附件卡片 / 预览本地链接 /
 * 会话窗文件提及）不再调系统外部应用，而是在工作台内开预览页签。
 * 本模块只放纯函数与补丁机制（不引 React/组件），便于单测；
 * 真正执行打开的 tryOpenMarkdownInWorkbench 定义在 index.ts（需要 getActiveWorkbench）。
 */

/** Markdown 扩展名判定（.md / .markdown / .mdx，大小写不敏感）。 */
export function isMarkdownPath(path: string): boolean {
  return /\.(md|markdown|mdx)$/iu.test(path)
}

/** 路径包含判定（Windows 大小写不敏感；root 必须带尾界）。 */
export function relativeInside(absPath: string, root: string): string | undefined {
  const normalizedPath = absPath.replace(/\\/gu, '/')
  const normalizedRoot = root.replace(/\\/gu, '/').replace(/\/+$/u, '')
  if (normalizedRoot === '') return undefined
  const prefix = normalizedRoot + '/'
  if (!normalizedPath.toLowerCase().startsWith(prefix.toLowerCase())) return undefined
  const rel = normalizedPath.slice(prefix.length)
  return rel === '' ? undefined : rel
}

export interface MarkdownOpenPlan {
  /** 工作区相对路径（正斜杠）。 */
  rel: string
  /** 页签标题（文件名）。 */
  name: string
  /** 实际匹配到的工作区根（正斜杠）：页签必须携带它，保证查看器解析根与规划根一致。 */
  root: string
  /** 命中项目绑定时携带：预览按该项目根解析。 */
  projectId?: string
}

/** planMarkdownOpen 需要的最小快照面（与 WorkbenchSnapshot 结构子集兼容）。 */
export interface MarkdownOpenSnapshot {
  projectWorkspace?: { projectId: string; root: string } | undefined
  context?: { primaryPath?: string | undefined } | undefined
}

/**
 * 决定 .md 绝对路径能否在工作台内打开，以及按哪个根打开。
 * 根的选择与 WorkspacePreviewViewer 的解析规则严格同序（项目绑定 → Hub 浏览目标 →
 * 环境默认根），保证「能拦截」与「查看器能读到」始终一致；
 * 命中高优先级根但未包含时不再降级试探（查看器同样不会降级），返回 undefined。
 */
export function planMarkdownOpen(absPath: string, snapshot: MarkdownOpenSnapshot, ambientRoot?: string): MarkdownOpenPlan | undefined {
  if (!isMarkdownPath(absPath)) return undefined
  const bound = snapshot.projectWorkspace
  if (bound !== undefined && bound.root !== '') {
    return planInside(absPath, bound.root, bound.projectId)
  }
  const primary = snapshot.context?.primaryPath
  if (primary !== undefined && primary !== '') {
    return planInside(absPath, primary, undefined)
  }
  if (ambientRoot !== undefined && ambientRoot !== '') {
    return planInside(absPath, ambientRoot, undefined)
  }
  return undefined
}

function planInside(absPath: string, root: string, projectId: string | undefined): MarkdownOpenPlan | undefined {
  const rel = relativeInside(absPath, root)
  if (rel === undefined) return undefined
  const normalizedRoot = root.replace(/\\/gu, '/').replace(/\/+$/u, '')
  const plan: MarkdownOpenPlan = { rel, name: rel.slice(rel.lastIndexOf('/') + 1), root: normalizedRoot }
  if (projectId !== undefined) plan.projectId = projectId
  return plan
}

export interface AdhocMarkdownOpenPlan {
  /** 相对 ad-hoc 根的路径（即文件名本身）。 */
  rel: string
  /** 页签标题（文件名）。 */
  name: string
  /** 显式工作区根（文件所在目录，正斜杠）。 */
  root: string
}

/**
 * 根外 .md 的最终兜底：所有已知根（项目绑定 / Hub 浏览目标 / 环境默认根）都不包含
 * 该文件时，以「文件所在目录」为显式工作区根打开（descriptor.workspaceRoot 携带，
 * 查看器按此根解析，优先级高于项目绑定）。Host 侧 ?root= 过渡机制支持任意已存在目录。
 */
export function planAdhocMarkdownOpen(absPath: string): AdhocMarkdownOpenPlan | undefined {
  if (!isMarkdownPath(absPath)) return undefined
  const normalized = absPath.replace(/\\/gu, '/').replace(/\/+$/u, '')
  const slash = normalized.lastIndexOf('/')
  if (slash <= 0) return undefined
  let root = normalized.slice(0, slash)
  const name = normalized.slice(slash + 1)
  if (name === '') return undefined
  // Windows 盘符根（'F:/x.md' → root 'F:'）补尾斜杠，避免 resolve 退化成盘符当前目录。
  if (/^[a-zA-Z]:$/u.test(root)) root += '/'
  if (root === '') return undefined
  return { rel: name, name, root }
}

/** 防重复补丁标记（挂在被补丁的服务实例上；重复安装返回 no-op 清理函数）。 */
const OPEN_PATH_PATCH_FLAG = '__wbMarkdownOpenPathPatched'

export interface OpenPathFace {
  openPath(path: string): Promise<void>
}

/**
 * 会话窗 .md 打开拦截：vendor ui-conversation 的 openFile（消息内文件链接、
 * produced-files chips、工具行路径）统一走 workspaces.openPath 这个共享实例方法，
 * 而 cordis 禁止重复 provide 同名服务——因此对共享实例做方法级补丁：
 * tryOpen 命中（.md 且落在当前可解析工作区根内）→ 工作台内开页签；其余原样放行。
 * 返回清理函数：摘掉实例自有属性，还原原型方法。
 */
export function installMarkdownOpenPathInterception(
  workspaces: OpenPathFace,
  tryOpen: (path: string) => Promise<boolean>,
): () => void {
  const target = workspaces as OpenPathFace & Record<string, unknown>
  if (target[OPEN_PATH_PATCH_FLAG] === true || typeof target.openPath !== 'function') return () => {}
  const hadOwn = Object.hasOwn(target, 'openPath')
  const original = target.openPath
  const patched = async function (this: OpenPathFace, path: string): Promise<void> {
    if (typeof path === 'string' && await tryOpen(path).catch(() => false)) return
    return Reflect.apply(original, workspaces, [path]) as Promise<void>
  }
  target.openPath = patched
  target[OPEN_PATH_PATCH_FLAG] = true
  return () => {
    // 还原：原型方法删自有补丁即可重现；自有方法必须写回原值。
    if (target.openPath === patched) {
      if (hadOwn) target.openPath = original
      else Reflect.deleteProperty(target, 'openPath')
    }
    Reflect.deleteProperty(target, OPEN_PATH_PATCH_FLAG)
  }
}

/** 预览文档里链接点击的分流结果。 */
export type WorkspaceLinkAction = 'passthrough' | 'external' | 'local' | 'ignore'

/**
 * 预览链接点击分流（纯函数，便于单测；组件 handler 必须与此保持一致）：
 * 锚点/mailto 放行默认行为；http(s) 外链走系统默认浏览器（宿主拦截渲染进程新窗口）；
 * 其余仅当渲染产物标记为本地文件链接（md-local-link）时才接管，否则不干预。
 */
export function classifyWorkspaceLink(href: string, isLocalLink: boolean): WorkspaceLinkAction {
  if (href.startsWith('#') || /^mailto:/iu.test(href)) return 'passthrough'
  if (/^https?:\/\//iu.test(href)) return 'external'
  if (!isLocalLink) return 'ignore'
  return 'local'
}
