import {
  createDefaultThemeDocument,
  DEFAULT_THEME_CONFIG,
  effectiveThemeConfig,
  normalizeThemeDocument,
  normalizeWorkspaceKey,
  type PersonalThemeConfig,
  type PersonalThemeDocument,
  type PersonalThemeField,
} from './theme-document.ts'

export interface ThemePersistence {
  read(): Promise<PersonalThemeDocument>
  write(document: PersonalThemeDocument): Promise<PersonalThemeDocument>
}

export type ThemeEditorScope = 'global' | 'workspace'
export type ThemeLoadStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface PersonalThemeState {
  status: ThemeLoadStatus
  document: PersonalThemeDocument
  workspaceCwd: string | undefined
  workspaceKey: string
  scope: ThemeEditorScope
  dirty: boolean
  saving: boolean
  error: string | undefined
  savedAt: number | undefined
}

export class PersonalThemeController {
  private readonly persistence: ThemePersistence
  private readonly listeners = new Set<() => void>()
  private state: PersonalThemeState = {
    status: 'idle',
    document: createDefaultThemeDocument(),
    workspaceCwd: undefined,
    workspaceKey: '',
    scope: 'global',
    dirty: false,
    saving: false,
    error: undefined,
    savedAt: undefined,
  }
  private editRevision = 0
  private loadPromise: Promise<void> | undefined

  constructor(persistence: ThemePersistence) {
    this.persistence = persistence
  }

  getSnapshot = (): PersonalThemeState => this.state

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  load(): Promise<void> {
    this.loadPromise ??= this.performLoad()
    return this.loadPromise
  }

  setWorkspace(cwd: string | undefined): void {
    const workspaceKey = normalizeWorkspaceKey(cwd)
    if (workspaceKey === this.state.workspaceKey && cwd === this.state.workspaceCwd) return
    this.publish({
      ...this.state,
      workspaceCwd: cwd,
      workspaceKey,
      scope: workspaceKey === '' ? 'global' : this.state.scope,
    })
  }

  setScope(scope: ThemeEditorScope): void {
    if (scope === 'workspace' && this.state.workspaceKey === '') return
    if (scope === this.state.scope) return
    this.publish({ ...this.state, scope })
  }

  hasWorkspaceOverride(state: PersonalThemeState = this.state): boolean {
    return state.workspaceKey !== '' && state.document.workspaces[state.workspaceKey] !== undefined
  }

  editingConfig(state: PersonalThemeState = this.state): PersonalThemeConfig {
    if (state.scope === 'workspace') {
      return state.document.workspaces[state.workspaceKey] ?? state.document.global
    }
    return state.document.global
  }

  effectiveConfig(state: PersonalThemeState = this.state): PersonalThemeConfig {
    return effectiveThemeConfig(state.document, state.workspaceKey)
  }

  enableWorkspaceOverride(): void {
    const key = this.state.workspaceKey
    if (key === '' || this.state.document.workspaces[key] !== undefined) return
    this.commitDocument({
      ...this.state.document,
      workspaces: {
        ...this.state.document.workspaces,
        [key]: { ...this.state.document.global },
      },
    })
  }

  disableWorkspaceOverride(): void {
    const key = this.state.workspaceKey
    if (key === '' || this.state.document.workspaces[key] === undefined) return
    const workspaces = { ...this.state.document.workspaces }
    delete workspaces[key]
    this.commitDocument({ ...this.state.document, workspaces })
  }

  updateField<K extends PersonalThemeField>(field: K, value: PersonalThemeConfig[K]): void {
    const state = this.state
    if (state.scope === 'workspace') {
      const current = state.document.workspaces[state.workspaceKey]
      if (current === undefined) return
      this.commitDocument({
        ...state.document,
        workspaces: {
          ...state.document.workspaces,
          [state.workspaceKey]: { ...current, [field]: value },
        },
      })
      return
    }
    this.commitDocument({
      ...state.document,
      global: { ...state.document.global, [field]: value },
    })
  }

  restoreDefaults(): void {
    if (this.state.scope === 'workspace') {
      this.disableWorkspaceOverride()
      return
    }
    this.commitDocument({
      ...this.state.document,
      global: { ...DEFAULT_THEME_CONFIG },
    })
  }

  async save(): Promise<void> {
    if (this.state.saving) return
    const revision = this.editRevision
    const document = normalizeThemeDocument(this.state.document)
    this.publish({ ...this.state, document, saving: true, error: undefined })
    try {
      const stored = normalizeThemeDocument(await this.persistence.write(document))
      if (this.editRevision === revision) {
        this.publish({
          ...this.state,
          document: stored,
          status: 'ready',
          dirty: false,
          saving: false,
          error: undefined,
          savedAt: Date.now(),
        })
      } else {
        this.publish({ ...this.state, status: 'ready', saving: false, error: undefined })
      }
    } catch (error) {
      this.publish({
        ...this.state,
        saving: false,
        error: errorMessage(error, '主题保存失败。'),
      })
    }
  }

  private async performLoad(): Promise<void> {
    this.publish({ ...this.state, status: 'loading', error: undefined })
    try {
      const document = normalizeThemeDocument(await this.persistence.read())
      this.publish({
        ...this.state,
        status: 'ready',
        document,
        dirty: false,
        error: undefined,
      })
    } catch (error) {
      this.publish({
        ...this.state,
        status: 'error',
        error: errorMessage(error, '个人主题读取失败，当前使用默认值。'),
      })
    }
  }

  private commitDocument(document: PersonalThemeDocument): void {
    this.editRevision += 1
    this.publish({ ...this.state, document, dirty: true, error: undefined })
  }

  private publish(state: PersonalThemeState): void {
    this.state = state
    for (const listener of [...this.listeners]) listener()
  }
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim() !== '') return error.message
  return fallback
}
