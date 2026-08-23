import type { ReactNode } from 'react'
import { UiIcon } from './controls.tsx'

/**
 * 文件类型图标（插件内部公共组件）：
 * 按扩展名给 24 视窗 stroke 线条图标，供文件树 / 路径浮层 / 搜索结果共用。
 * 尺寸由使用方 CSS 控制（svg 宽高压到 13–14px）。
 */

const ICON_FILE = 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6'
const ICON_MD = 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M7 17v-5l2 2 2-2v5 M14 17v-5h2'
const ICON_HTML = 'm8 6-5 6 5 6 M16 6l5 6-5 6'
const ICON_CODE = 'm8 6-5 6 5 6 M16 6l5 6-5 6 M13 4l-2 16'
const ICON_IMAGE = 'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z M9 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z M21 15l-5-5L5 21'
const ICON_JSON = 'M8 3H7a2 2 0 0 0-2 2v4a2 2 0 0 1-2 2 2 2 0 0 1 2 2v4a2 2 0 0 0 2 2h1 M16 3h1a2 2 0 0 1 2 2v4a2 2 0 0 0 2 2 2 2 0 0 0-2 2v4a2 2 0 0 1-2 2h-1'
const ICON_TXT = 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M8 13h8 M8 17h5'
const ICON_PDF = 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M8 15h.01 M12 15c1.5-2 3-3.5 4-4'
const ICON_FOLDER = 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z'

const CODE_EXTENSIONS = new Set(['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'css', 'scss', 'py', 'rs', 'go', 'java', 'c', 'cc', 'cpp', 'h', 'hpp', 'sh', 'ps1', 'bat', 'sql', 'vue', 'svelte'])
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico'])

/** 目录图标。 */
export function FolderIcon(): ReactNode {
  return <UiIcon d={ICON_FOLDER} />
}

/** 按文件名（扩展名）返回文件类型图标。 */
export function FileIcon({ name }: { name: string }): ReactNode {
  const extension = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : ''
  let d = ICON_FILE
  if (extension === 'md' || extension === 'markdown') d = ICON_MD
  else if (extension === 'html' || extension === 'htm') d = ICON_HTML
  else if (extension === 'json' || extension === 'jsonc' || extension === 'yaml' || extension === 'yml' || extension === 'xml' || extension === 'toml') d = ICON_JSON
  else if (extension === 'txt' || extension === 'log') d = ICON_TXT
  else if (extension === 'pdf') d = ICON_PDF
  else if (CODE_EXTENSIONS.has(extension)) d = ICON_CODE
  else if (IMAGE_EXTENSIONS.has(extension)) d = ICON_IMAGE
  return <UiIcon d={d} />
}
