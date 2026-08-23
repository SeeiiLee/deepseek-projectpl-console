import type {
  WorkbenchFamily,
  WorkbenchTabDescriptor,
  WorkbenchViewerDefinition,
  WorkbenchViewerRegistryFace,
} from './contracts.ts'

export const DEFAULT_VIEWER_IDS: Readonly<Record<WorkbenchFamily, string>> = {
  file: 'workbench.files.placeholder',
  preview: 'workbench.code.placeholder',
  outline: 'workbench.outline.placeholder',
  diff: 'workbench.diff.placeholder',
  artifact: 'workbench.artifact.placeholder',
  browser: 'workbench.browser.placeholder',
  terminal: 'workbench.terminal.placeholder',
  details: 'workbench.details.legacy',
}

export const FAMILY_TITLES: Readonly<Record<WorkbenchFamily, string>> = {
  file: 'Files',
  preview: 'Code',
  outline: 'Outline',
  diff: 'Diff',
  artifact: 'Artifact',
  browser: 'Browser',
  terminal: 'Terminal',
  details: 'Details',
}

/** Small runtime registry; viewers remain metadata-only during Gate 1. */
export class WorkbenchViewerRegistry implements WorkbenchViewerRegistryFace {
  readonly #viewers = new Map<string, WorkbenchViewerDefinition>()
  readonly #protected = new Set<string>()
  #onChange: (() => void) | undefined

  installDefaults(): void {
    for (const family of Object.keys(DEFAULT_VIEWER_IDS) as WorkbenchFamily[]) {
      const viewer: WorkbenchViewerDefinition = {
        id: DEFAULT_VIEWER_IDS[family],
        family,
        title: FAMILY_TITLES[family],
        canRestore: descriptor => descriptor.family === family,
      }
      this.#viewers.set(viewer.id, viewer)
      this.#protected.add(viewer.id)
    }
  }

  onChange(listener: () => void): void {
    this.#onChange = listener
  }

  register(viewer: WorkbenchViewerDefinition): () => void {
    validateViewer(viewer)
    if (this.#viewers.has(viewer.id)) {
      throw new Error(`workbench: viewer already registered (${viewer.id})`)
    }
    this.#viewers.set(viewer.id, viewer)
    this.#onChange?.()
    let disposed = false
    return () => {
      if (disposed || this.#protected.has(viewer.id)) return
      disposed = true
      if (this.#viewers.delete(viewer.id)) this.#onChange?.()
    }
  }

  get(id: string): WorkbenchViewerDefinition | undefined {
    return this.#viewers.get(id)
  }

  list(): readonly WorkbenchViewerDefinition[] {
    return [...this.#viewers.values()]
  }

  canRestore(descriptor: WorkbenchTabDescriptor): boolean {
    const viewer = this.#viewers.get(descriptor.viewerId)
    if (viewer === undefined || viewer.family !== descriptor.family) return false
    try {
      return viewer.canRestore(descriptor)
    } catch {
      return false
    }
  }

  /**
   * 文件查看器匹配（preview family）：priority 降序、同序稳定。
   * head 可用时 detect 先于 exts；带 detect 但 head 缺失 → 本轮跳过
   * （sniff-only 不盲认领）；无 detect 且 exts 为空数组 → catch-all 兜底。
   */
  matchViewer(path: string, head?: Uint8Array): WorkbenchViewerDefinition | undefined {
    const extension = extensionOf(path)
    const candidates = [...this.#viewers.values()]
      .filter(viewer => viewer.family === 'preview' && (viewer.exts !== undefined || viewer.detect !== undefined))
      .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
    for (const viewer of candidates) {
      if (head !== undefined && viewer.detect !== undefined) {
        try {
          if (viewer.detect(path, head)) return viewer
        } catch {
          // 嗅探异常视为不匹配，继续尝试下一个查看器。
        }
        continue
      }
      if (viewer.detect !== undefined) continue // sniff-only：无 head 不盲认领
      if (viewer.exts === undefined) continue
      if (viewer.exts.length === 0) return viewer // catch-all
      if (extension !== '' && viewer.exts.includes(extension)) return viewer
    }
    return undefined
  }
}

function extensionOf(path: string): string {
  const slash = path.lastIndexOf('/')
  const name = path.slice(slash + 1)
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return ''
  return name.slice(dot + 1).toLowerCase()
}

function validateViewer(viewer: WorkbenchViewerDefinition): void {
  if (!safeIdentifier(viewer.id)) throw new TypeError('workbench: viewer id is invalid')
  if (viewer.title.trim().length === 0 || viewer.title.length > 120) {
    throw new TypeError('workbench: viewer title is invalid')
  }
  if (typeof viewer.canRestore !== 'function') {
    throw new TypeError('workbench: viewer must declare canRestore')
  }
  if (viewer.render !== undefined && typeof viewer.render !== 'function') {
    throw new TypeError('workbench: viewer render must be a function')
  }
}

export function safeIdentifier(value: string): boolean {
  return value.length > 0 && value.length <= 200 && /^[A-Za-z0-9._:@/-]+$/.test(value)
}
