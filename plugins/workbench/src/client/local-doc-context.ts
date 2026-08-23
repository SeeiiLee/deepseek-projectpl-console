/**
 * R-ED 本地文档上下文：当前正在编辑/预览的 Markdown 文档所在目录（绝对路径）。
 * ProseMirror NodeView（文件卡片/图片）无法从 React  props 逐层拿到文档路径，
 * 这里用模块级单例承载——工作台同一时刻只挂载一个文档编辑器或一个预览，
 * 由 WorkspacePreviewViewer 在进入/离开时设置与清理。
 */

let currentBaseDir: string | undefined

export function setLocalDocBaseDir(dir: string | undefined): void {
  currentBaseDir = dir === undefined || dir === '' ? undefined : dir
}

export function getLocalDocBaseDir(): string | undefined {
  return currentBaseDir
}

/**
 * 由工作区根（绝对路径）与文档的工作区相对路径推出文档所在目录的绝对路径。
 * 任一缺失返回 undefined（调用方退化为只用绝对路径）。
 */
export function baseDirOfDocument(workspaceRoot: string | undefined, docRelativePath: string | null): string | undefined {
  if (workspaceRoot === undefined || workspaceRoot.trim() === '') return undefined
  if (docRelativePath === null || docRelativePath === '') return undefined
  const root = workspaceRoot.replace(/\\/gu, '/').replace(/\/+$/u, '')
  if (root === '') return undefined
  const rel = docRelativePath.replace(/\\/gu, '/').replace(/^\/+/u, '')
  const cut = rel.lastIndexOf('/')
  return cut < 0 ? root : root + '/' + rel.slice(0, cut)
}
