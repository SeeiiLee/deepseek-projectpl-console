/**
 * R-ED：Document Session Store（架构书 §8.10/§8.10.2）。
 * 每个可编辑 Resource 对应一个内存态 Document Session；Tab 只引用 documentId。
 * baseText/baseEtag 只有加载、成功保存或明确 reload 时改变；草稿只在进程内存，
 * 不写入 localStorage/Tab descriptor；selection/scroll 同为内存态。
 * 保存经注入的 DocumentResourceAdapter（W1 用现有 workspaceApi；W2/W5 换 Hub save）。
 */
import type { WorkspaceApi } from './workspaceApi.ts'

export type SaveState = 'idle' | 'saving' | 'saved' | 'conflict' | 'error'

export interface DocumentSelection {
  anchor: number
  head: number
}

export interface DocumentSessionSnapshot {
  documentId: string
  /** 稳定资源标识（W1 为 workspace: 相对路径；W2 后为 Resource Ref）。 */
  resourceKey: string
  baseEtag: string
  baseText: string
  draftText: string
  dirty: boolean
  saveState: SaveState
  externalEtag?: string
  /** 外部更新携带的完整文本（三方比较/重新加载用）。 */
  externalText?: string
  errorMessage?: string
  selection?: DocumentSelection
  scrollTop?: number
  revision: number
}

/** 保存/加载资源适配面（W1 接现有 workspaceApi；W2/W5 切 Hub save，Store 不感知）。 */
export interface DocumentResourceAdapter {
  /** 读取整份文本（256 KiB 截断由现有 API 承担）。 */
  load(resourceKey: string): Promise<{ text: string; etag: string; truncated: boolean }>
  /** expectedEtag 冲突由适配器抛 409 语义错误（FILE_CHANGED）。 */
  saveText(resourceKey: string, draftText: string, expectedEtag: string | undefined): Promise<{ etag: string; byteSize: number }>
}

/** 现有 workspaceApi 到 DocumentResourceAdapter 的适配。 */
export function createWorkspaceResourceAdapter(api: WorkspaceApi): DocumentResourceAdapter {
  return {
    async load(resourceKey) {
      const file = await api.file(resourceKey)
      if (file.kind !== 'text') throw new Error('该文件不是文本，无法在编辑器中打开。')
      return { text: file.content, etag: file.sha256, truncated: file.truncated }
    },
    async saveText(resourceKey, draftText, expectedEtag) {
      const result = await api.save(resourceKey, draftText, expectedEtag)
      return { etag: result.sha256, byteSize: result.byteSize }
    },
  }
}

export interface ExternalUpdate {
  externalEtag: string
  externalText: string
}

export type ExternalUpdateResult =
  | { kind: 'reloaded' }
  | { kind: 'conflict' }

export type ConflictResolution =
  | { kind: 'keep-draft' }
  | { kind: 'reload' }

export class DocumentSessionStore {
  readonly #sessions = new Map<string, DocumentSessionSnapshot>()
  readonly #listeners = new Set<() => void>()

  /** 箭头字段：保证脱绑定调用（useSyncExternalStore 等）仍持有 this。 */
  get = (documentId: string): DocumentSessionSnapshot | undefined => this.#sessions.get(documentId)

  has = (documentId: string): boolean => this.#sessions.has(documentId)

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    return () => { this.#listeners.delete(listener) }
  }

  #commit(next: DocumentSessionSnapshot): void {
    this.#sessions.set(next.documentId, next)
    for (const listener of [...this.#listeners]) listener()
  }

  /** 清除可选字段（exactOptionalPropertyTypes 下不可显式赋 undefined）。 */
  static clearOptional(next: DocumentSessionSnapshot, keys: readonly (keyof DocumentSessionSnapshot)[]): void {
    for (const key of keys) delete next[key]
  }

  #bump(documentId: string, mutate: (draft: DocumentSessionSnapshot) => void): DocumentSessionSnapshot {
    const current = this.#sessions.get(documentId)
    if (current === undefined) throw new Error(`document session 不存在: ${documentId}`)
    const next: DocumentSessionSnapshot = { ...current, revision: current.revision + 1 }
    mutate(next)
    this.#commit(next)
    return next
  }

  /** 打开/加载资源：base 与 draft 一致，与磁盘版本对齐。 */
  open(documentId: string, resourceKey: string, loaded: { text: string; etag: string }): DocumentSessionSnapshot {
    if (this.#sessions.has(documentId)) {
      // 重复 open 视为重新加载：丢弃草稿，回到磁盘版本。
      const current = this.#sessions.get(documentId)
      if (current === undefined) throw new Error(`document session 不存在: ${documentId}`)
      const next: DocumentSessionSnapshot = {
        ...current,
        baseEtag: loaded.etag,
        baseText: loaded.text,
        draftText: loaded.text,
        dirty: false,
        saveState: 'saved',
        revision: current.revision + 1,
      }
      DocumentSessionStore.clearOptional(next, ['externalEtag', 'externalText', 'errorMessage'])
      this.#commit(next)
      return next
    }
    const session: DocumentSessionSnapshot = {
      documentId,
      resourceKey,
      baseEtag: loaded.etag,
      baseText: loaded.text,
      draftText: loaded.text,
      dirty: false,
      saveState: 'saved',
      revision: 1,
    }
    this.#commit(session)
    return session
  }

  /** 编辑器输入：更新草稿（base 不变）。 */
  updateDraft(documentId: string, draftText: string): DocumentSessionSnapshot {
    return this.#bump(documentId, next => {
      next.draftText = draftText
      next.dirty = draftText !== next.baseText
      // clean 即与磁盘一致（saved）；dirty 且此前已保存过则进入待保存（idle）
      if (next.dirty) {
        if (next.saveState === 'saved') next.saveState = 'idle'
      } else {
        next.saveState = 'saved'
      }
      DocumentSessionStore.clearOptional(next, ['errorMessage'])
    })
  }

  /** 切 Tab 时保存 selection（内存态）。 */
  setSelection(documentId: string, selection: DocumentSelection): void {
    this.#bump(documentId, next => { next.selection = selection })
  }

  /** 切 Tab 时保存滚动位置（内存态）。 */
  setScrollTop(documentId: string, scrollTop: number): void {
    this.#bump(documentId, next => { next.scrollTop = scrollTop })
  }

  /** 保存：saving → 成功（base 对齐）/ 409 冲突 / 其他错误。 */
  async save(documentId: string, adapter: DocumentResourceAdapter): Promise<DocumentSessionSnapshot> {
    const current = this.#sessions.get(documentId)
    if (current === undefined) throw new Error(`document session 不存在: ${documentId}`)
    if (current.saveState === 'saving' || current.saveState === 'conflict') return current
    if (!current.dirty) {
      return this.#bump(documentId, next => { next.saveState = 'saved' })
    }
    this.#bump(documentId, next => {
      next.saveState = 'saving'
      DocumentSessionStore.clearOptional(next, ['errorMessage'])
    })
    try {
      const result = await adapter.saveText(current.resourceKey, current.draftText, current.baseEtag)
      return this.#bump(documentId, next => {
        next.baseText = next.draftText
        next.baseEtag = result.etag
        next.dirty = false
        next.saveState = 'saved'
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : '保存失败。'
      const isConflict = error instanceof Error && /FILE_CHANGED|409|冲突/u.test(message)
      return this.#bump(documentId, next => {
        if (isConflict) {
          next.saveState = 'conflict'
          next.errorMessage = message
        } else {
          next.saveState = 'error'
          next.errorMessage = message
        }
      })
    }
  }

  /** 外部更新（Watch/轮询）：clean 自动 reload；dirty 进入 conflict。 */
  markExternalUpdate(documentId: string, update: ExternalUpdate): ExternalUpdateResult {
    const current = this.#sessions.get(documentId)
    if (current === undefined) throw new Error(`document session 不存在: ${documentId}`)
    if (!current.dirty) {
      this.#bump(documentId, next => {
        next.baseEtag = update.externalEtag
        next.baseText = update.externalText
        next.draftText = update.externalText
        next.dirty = false
        next.saveState = 'saved'
        DocumentSessionStore.clearOptional(next, ['externalEtag'])
      })
      return { kind: 'reloaded' }
    }
    this.#bump(documentId, next => {
      next.externalEtag = update.externalEtag
      next.externalText = update.externalText
      next.saveState = 'conflict'
      next.errorMessage = '文件已在外部被修改，需要处理冲突。'
    })
    return { kind: 'conflict' }
  }

  /** 冲突处理：保留草稿继续编辑 / 重新加载外部版本（丢弃草稿）。 */
  resolveConflict(documentId: string, resolution: ConflictResolution): DocumentSessionSnapshot {
    const current = this.#sessions.get(documentId)
    if (current === undefined) throw new Error(`document session 不存在: ${documentId}`)
    if (current.saveState !== 'conflict') return current
    if (resolution.kind === 'reload') {
      const externalText = current.externalText
      const externalEtag = current.externalEtag
      return this.#bump(documentId, next => {
        next.baseEtag = externalEtag ?? next.baseEtag
        next.baseText = externalText ?? next.baseText
        next.draftText = externalText ?? next.baseText
        next.dirty = false
        next.saveState = 'saved'
        DocumentSessionStore.clearOptional(next, ['externalEtag', 'externalText', 'errorMessage'])
      })
    }
    return this.#bump(documentId, next => {
      next.saveState = 'idle'
      DocumentSessionStore.clearOptional(next, ['externalEtag', 'externalText', 'errorMessage'])
    })
  }

  /** 明确 reload：丢弃草稿，回到给定版本（三方比较后选择外部版本时用）。 */
  reload(documentId: string, loaded: { text: string; etag: string }): DocumentSessionSnapshot {
    return this.#bump(documentId, next => {
      next.baseEtag = loaded.etag
      next.baseText = loaded.text
      next.draftText = loaded.text
      next.dirty = false
      next.saveState = 'saved'
      DocumentSessionStore.clearOptional(next, ['externalEtag'])
      DocumentSessionStore.clearOptional(next, ['errorMessage'])
    })
  }

  /** 放弃草稿：回到 base。 */
  discardDraft(documentId: string): DocumentSessionSnapshot {
    return this.#bump(documentId, next => {
      next.draftText = next.baseText
      next.dirty = false
      next.saveState = 'saved'
      DocumentSessionStore.clearOptional(next, ['externalEtag'])
      DocumentSessionStore.clearOptional(next, ['errorMessage'])
    })
  }

  /** 关闭 Tab：移除会话（草稿随内存态丢弃；崩溃恢复 journal 后置）。 */
  close(documentId: string): void {
    if (!this.#sessions.has(documentId)) return
    this.#sessions.delete(documentId)
    for (const listener of [...this.#listeners]) listener()
  }
}
