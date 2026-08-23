import type {
  CloseTabResult,
  PersonalShellWorkbench,
  WorkbenchContextProjection,
  WorkbenchDetailsSelection,
  WorkbenchFamily,
  WorkbenchTargetMode,
  WorkbenchOpenIntent,
  WorkbenchScope,
  WorkbenchService,
  WorkbenchSnapshot,
  WorkbenchTabDescriptor,
  WorkbenchTabModel,
} from './contracts.ts'
import { isWorkbenchFamily } from './contracts.ts'
import {
  DEFAULT_VIEWER_IDS,
  FAMILY_TITLES,
  safeIdentifier,
  WorkbenchViewerRegistry,
} from './viewers.ts'

export const WORKBENCH_STORAGE_VERSION = 1
export const WORKBENCH_STORAGE_PREFIX = '@cyrus/dsh-workbench:v1'
/** Separate key for the right-edge Files dock visibility (default: open). */
export const FILES_DOCK_STORAGE_KEY = WORKBENCH_STORAGE_PREFIX + ':files-dock'

export interface WorkbenchStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

interface ScopeState {
  descriptors: WorkbenchTabDescriptor[]
  activeTabId: string
  dirty: Set<string>
}

interface PersistedDescriptor {
  id: string
  family: WorkbenchFamily
  viewerId: string
  title: string
  resourceKey?: string
  workspaceProjectId?: string
  workspaceRoot?: string
}

interface PersistedScope {
  version: typeof WORKBENCH_STORAGE_VERSION
  activeTabId: string
  tabs: PersistedDescriptor[]
}

// 固定页签只保留 legacy Details（控制台/工具联动）；终端使用右下角会话终端，不重复占位。
// 文件审阅由右侧文件树点击打开预览页签。
const PINNED_FAMILIES = [
  'details',
] as const satisfies readonly WorkbenchFamily[]

const PINNED_IDS: Readonly<Record<typeof PINNED_FAMILIES[number], string>> = {
  details: 'workbench:details',
}

const PINNED_ID_SET = new Set<string>(Object.values(PINNED_IDS))

/** Gate 1 state machine and the public ctx.workbench service. */
export class WorkbenchController implements WorkbenchService {
  readonly viewers: WorkbenchViewerRegistry
  readonly #shell: PersonalShellWorkbench
  readonly #storage: WorkbenchStorage | undefined
  readonly #listeners = new Set<() => void>()
  readonly #sessions = new Map<string, ScopeState>()
  #global: ScopeState
  #currentSessionId: string | undefined
  #activeScopeKey: 'global' | 'session'
  #detailsSelection: WorkbenchDetailsSelection | undefined
  #filesDockOpen: boolean
  #projectWorkspace: { projectId: string; root: string } | undefined
  /** W1：workspace-hub Context 投影（在场时成为 projectWorkspace 与 context 的权威来源）。 */
  #hubProjection: WorkbenchContextProjection | undefined
  /** W1：注入的 Hub 命令面（setProjectWorkspace 等旧调用的转译目标）。 */
  #hubCommands: {
    setConsoleProject(projectId: string | undefined): void
    setMode(mode: WorkbenchTargetMode): Promise<void>
    pinMount(mountId: string): Promise<void>
    clearPin(): Promise<void>
  } | undefined
  #snapshot: WorkbenchSnapshot

  /**
   * @param viewers 查看器注册表。生产环境在构造前完成插件查看器注册，
   * 使存储恢复时（canRestore）能看到全部查看器——否则预览等页签会在
   * 启动恢复时被当作未知查看器丢弃、干净的存储再写回，审阅状态永久丢失。
   */
  constructor(
    shell: PersonalShellWorkbench,
    storage: WorkbenchStorage | undefined = browserStorage(),
    viewers: WorkbenchViewerRegistry = new WorkbenchViewerRegistry(),
  ) {
    this.#shell = shell
    this.#storage = storage
    this.viewers = viewers
    this.viewers.installDefaults()
    this.#global = this.#loadScope('global')
    this.#activeScopeKey = 'global'
    this.#filesDockOpen = this.#loadFilesDockOpen()
    this.#snapshot = this.#project()
    this.viewers.onChange(() => { this.#sanitizeLoadedScopes() })
  }

  getSnapshot = (): WorkbenchSnapshot => this.#snapshot

  /** Hub 投影在场时派生 projectWorkspace；否则返回降级旧绑定。 */
  #projectWorkspaceOf(): { projectId: string; root: string } | undefined {
    if (this.#hubProjection !== undefined) {
      const projectId = this.#hubProjection.projectId
      if (projectId === undefined) return undefined
      return { projectId, root: this.#hubProjection.primaryPath ?? this.#hubProjection.primaryLabel ?? '' }
    }
    return this.#projectWorkspace
  }

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    return () => { this.#listeners.delete(listener) }
  }

  open(intent: WorkbenchOpenIntent): WorkbenchTabDescriptor {
    const resolved = this.#resolveIntent(intent)
    const state = this.#stateFor(resolved.scope, resolved.sessionId)
    const pinnedId = pinnedIdFor(resolved.family, resolved.resourceKey, resolved.viewerId)
    const id = intent.tabId ?? pinnedId ?? generatedTabId(resolved)
    if (!safeIdentifier(id)) throw new TypeError('workbench: tab id is invalid')
    const descriptor: WorkbenchTabDescriptor = { ...resolved, id }
    const index = state.descriptors.findIndex(tab => tab.id === id)
    if (index >= 0) state.descriptors[index] = descriptor
    else if (!PINNED_ID_SET.has(id)) state.descriptors.push(descriptor)
    state.activeTabId = id
    this.#activeScopeKey = resolved.scope === 'session' ? 'session' : 'global'
    this.#persist(resolved.scope, resolved.sessionId, state)
    this.#publish()
    this.#shell.openWorkbench()
    return descriptor
  }

  reveal(): void {
    this.#shell.openWorkbench()
  }

  collapse(): void {
    this.#shell.closeWorkbench()
  }

  toggle(): void {
    this.#shell.toggleWorkbench()
  }

  toggleFilesDock(): void {
    this.#filesDockOpen = !this.#filesDockOpen
    this.#persistFilesDock()
    this.#publish()
  }

  toggleFullscreen(): void {
    this.#shell.toggleWorkbenchFullscreen()
  }

  /** W1：workspace-hub 推送 Context 投影；undefined 表示 Hub 断开（清除投影，回退旧绑定）。 */
  applyHubContext(projection: WorkbenchContextProjection | undefined): void {
    this.#hubProjection = projection
    this.#publish()
  }

  /** W1：contextLink 注入 Hub 命令面；旧调用（setProjectWorkspace 等）转译目标。 */
  setHubCommands(commands: {
    setConsoleProject(projectId: string | undefined): void
    setMode(mode: WorkbenchTargetMode): Promise<void>
    pinMount(mountId: string): Promise<void>
    clearPin(): Promise<void>
  } | undefined): void {
    this.#hubCommands = commands
  }

  /** W1：旧调用转译 → follow-console + 设置控制台项目。 */
  setProjectWorkspace(projectId: string, root: string): void {
    if (this.#hubCommands !== undefined) {
      this.#hubCommands.setConsoleProject(projectId)
      void this.#hubCommands.setMode('follow-console')
      return
    }
    this.#projectWorkspace = { projectId, root }
    this.#publish()
  }

  /** W1：旧调用转译 → 回到 follow-session。 */
  clearProjectWorkspace(): void {
    if (this.#hubCommands !== undefined) {
      void this.#hubCommands.setMode('follow-session')
      return
    }
    this.#projectWorkspace = undefined
    this.#publish()
  }

  /** W1：显式切换模式（Hub 在场转译；缺失 no-op）。 */
  setWorkbenchMode(mode: WorkbenchTargetMode): void {
    if (this.#hubCommands === undefined) return
    if (mode === 'pinned') {
      const mountId = this.#hubProjection?.primaryMountId
      if (mountId !== undefined) void this.#hubCommands.pinMount(mountId)
      void this.#hubCommands.setMode('pinned')
      return
    }
    if (mode === 'follow-session') void this.#hubCommands.clearPin()
    void this.#hubCommands.setMode(mode)
  }

  /** W1：固定/取消固定当前主 Mount。 */
  toggleWorkbenchPin(): void {
    if (this.#hubCommands === undefined) return
    if (this.#hubProjection?.mode === 'pinned') {
      void this.#hubCommands.clearPin()
      void this.#hubCommands.setMode('follow-session')
      return
    }
    const mountId = this.#hubProjection?.primaryMountId
    if (mountId !== undefined) void this.#hubCommands.pinMount(mountId)
    void this.#hubCommands.setMode('pinned')
  }

  focusConversation(): void {
    this.#shell.focusConversation()
  }

  resetLayout(): void {
    this.#shell.resetLayout()
  }

  setCurrentSession(sessionId: string | undefined): void {
    if (sessionId === this.#currentSessionId) return
    // 全局页签（文件审阅等）跨会话保持激活：审阅不因切换会话被打断。
    const keepGlobalActive = this.#activeScopeKey === 'global'
    this.#currentSessionId = sessionId
    if (sessionId !== undefined) this.#stateFor('session', sessionId)
    this.#detailsSelection = undefined
    this.#activeScopeKey = sessionId === undefined || keepGlobalActive ? 'global' : 'session'
    this.#publish()
  }

  activateTab(tabId: string): boolean {
    const entry = this.#tabEntry(tabId)
    if (entry !== undefined) {
      entry.state.activeTabId = tabId
      this.#activeScopeKey = entry.scope === 'session' ? 'session' : 'global'
      this.#persist(entry.scope, entry.sessionId, entry.state)
      this.#publish()
      return true
    }
    // 固定页签（Details）不进 descriptors（投影时合成），#tabEntry 找不到；
    // 它始终可激活：落在当前 scope 的 activeTabId 上，作用域键保持不变。
    if (!PINNED_ID_SET.has(tabId)) return false
    const state = this.#activeTabState()
    state.activeTabId = tabId
    const persistScope = this.#activeScopeKey === 'session' && this.#currentSessionId !== undefined ? 'session' : 'global'
    this.#persist(persistScope, persistScope === 'session' ? this.#currentSessionId : undefined, state)
    this.#publish()
    return true
  }

  markDirty(tabId: string, dirty: boolean): boolean {
    const entry = this.#tabEntry(tabId)
    if (entry === undefined) return false
    if (dirty) entry.state.dirty.add(tabId)
    else entry.state.dirty.delete(tabId)
    this.#publish()
    return true
  }

  /** 更新页签可持久化字段（Browser 持久化当前 URL 等）；仅 resourceKey/title。 */
  updateTab(tabId: string, patch: { resourceKey?: string; title?: string }): boolean {
    const entry = this.#tabEntry(tabId)
    if (entry === undefined) return false
    if (patch.resourceKey !== undefined) {
      entry.descriptor.resourceKey = normalizeText(patch.resourceKey, 2048, 'resource key')
    }
    if (patch.title !== undefined) {
      entry.descriptor.title = normalizeText(patch.title, 120, 'title')
    }
    this.#persist(entry.scope, entry.sessionId, entry.state)
    this.#publish()
    return true
  }

  closeTab(tabId: string, options: { force?: boolean } = {}): CloseTabResult {
    if (PINNED_ID_SET.has(tabId)) return { closed: false, reason: 'pinned' }
    const entry = this.#tabEntry(tabId)
    if (entry === undefined) return { closed: false, reason: 'missing' }
    if (entry.state.dirty.has(tabId) && options.force !== true) return { closed: false, reason: 'dirty' }
    const index = entry.state.descriptors.findIndex(tab => tab.id === tabId)
    entry.state.descriptors.splice(index, 1)
    entry.state.dirty.delete(tabId)
    if (entry.state.activeTabId === tabId) entry.state.activeTabId = PINNED_IDS.details
    this.#persist(entry.scope, entry.sessionId, entry.state)
    this.#publish()
    return { closed: true }
  }

  selectDetails(selection: WorkbenchDetailsSelection): void {
    if (!Number.isSafeInteger(selection.requestId) || selection.requestId < 0) {
      throw new TypeError('workbench: details request id is invalid')
    }
    this.#detailsSelection = {
      source: 'legacy-details',
      requestId: selection.requestId,
      ...(selection.sessionId === undefined ? {} : { sessionId: selection.sessionId }),
    }
    this.open({
      family: 'details',
      scope: selection.sessionId === undefined ? 'global' : 'session',
      ...(selection.sessionId === undefined ? {} : { sessionId: selection.sessionId }),
    })
  }

  dismissDetails(): void {
    const state = this.#activeTabState()
    const detailsWasActive = state.activeTabId === PINNED_IDS.details
    if (this.#detailsSelection === undefined && !detailsWasActive) return
    this.#detailsSelection = undefined
    if (detailsWasActive) {
      state.activeTabId = PINNED_IDS.details
      this.#persist(
        this.#activeScopeKey === 'session' && this.#currentSessionId !== undefined ? 'session' : 'global',
        this.#activeScopeKey === 'session' ? this.#currentSessionId : undefined,
        state,
      )
    }
    this.#publish()
  }

  #resolveIntent(intent: WorkbenchOpenIntent): Omit<WorkbenchTabDescriptor, 'id'> {
    if (!isWorkbenchFamily(intent.family)) throw new TypeError('workbench: unsupported intent family')
    // 默认全局 scope：全局页签在任何会话下都可见（快照合并投影），
    // 文件审阅因此跨会话存活，而不是绑死在打开它时的会话上。
    const scope = intent.scope ?? 'global'
    const sessionId = scope === 'session' ? intent.sessionId ?? this.#currentSessionId : undefined
    if (scope === 'session' && (sessionId === undefined || sessionId.length === 0)) {
      throw new Error('workbench: session-scoped intent requires a current or explicit session')
    }
    const viewerId = intent.viewerId ?? DEFAULT_VIEWER_IDS[intent.family]
    const viewer = this.viewers.get(viewerId)
    if (viewer === undefined || viewer.family !== intent.family) {
      throw new Error(`workbench: no ${intent.family} viewer registered as ${viewerId}`)
    }
    const title = normalizeText(intent.title ?? viewer.title ?? FAMILY_TITLES[intent.family], 120, 'title')
    const resourceKey = intent.resourceKey === undefined
      ? undefined
      : normalizeText(intent.resourceKey, 2048, 'resource key')
    // W1 Step D：打开时若未显式指定项目，自动绑定当前浏览目标（hub 投影），
    // Tab 因此固定到自己的项目根，不随控制台/会话切换失效。
    const workspaceProjectId = intent.workspaceProjectId === undefined
      ? this.#hubProjection?.projectId
      : normalizeText(intent.workspaceProjectId, 200, 'workspace project id')
    // 根外文件预览的显式根；存在时查看器优先按它解析（高于项目绑定）。
    const workspaceRoot = intent.workspaceRoot === undefined
      ? undefined
      : normalizeText(intent.workspaceRoot, 2048, 'workspace root')
    return {
      family: intent.family,
      viewerId,
      title,
      scope,
      ...(sessionId === undefined ? {} : { sessionId }),
      ...(resourceKey === undefined ? {} : { resourceKey }),
      ...(workspaceProjectId === undefined ? {} : { workspaceProjectId }),
      ...(workspaceRoot === undefined ? {} : { workspaceRoot }),
    }
  }

  /** 当前持有可见激活页签的 scope 状态（无会话时恒为全局）。 */
  #activeTabState(): ScopeState {
    if (this.#activeScopeKey === 'session' && this.#currentSessionId !== undefined) {
      return this.#stateFor('session', this.#currentSessionId)
    }
    return this.#global
  }

  /** 在「当前会话 scope → 全局 scope」的合并页签列表里定位一个页签。 */
  #tabEntry(tabId: string): { scope: WorkbenchScope; sessionId: string | undefined; state: ScopeState; descriptor: WorkbenchTabDescriptor } | undefined {
    const sessionState = this.#currentSessionId === undefined
      ? undefined
      : this.#stateFor('session', this.#currentSessionId)
    if (sessionState !== undefined) {
      const descriptor = sessionState.descriptors.find(tab => tab.id === tabId)
      if (descriptor !== undefined) {
        return { scope: 'session', sessionId: this.#currentSessionId, state: sessionState, descriptor }
      }
    }
    const descriptor = this.#global.descriptors.find(tab => tab.id === tabId)
    if (descriptor !== undefined) return { scope: 'global', sessionId: undefined, state: this.#global, descriptor }
    return undefined
  }

  #stateFor(scope: WorkbenchScope, sessionId: string | undefined): ScopeState {
    if (scope === 'global') return this.#global
    if (sessionId === undefined) throw new Error('workbench: missing session id')
    let state = this.#sessions.get(sessionId)
    if (state === undefined) {
      state = this.#loadScope('session', sessionId)
      this.#sessions.set(sessionId, state)
    }
    return state
  }

  #loadScope(scope: WorkbenchScope, sessionId?: string): ScopeState {
    const fallback: ScopeState = { descriptors: [], activeTabId: PINNED_IDS.details, dirty: new Set() }
    if (this.#storage === undefined) return fallback
    const key = storageKey(scope, sessionId)
    let raw: string | null
    try {
      raw = this.#storage.getItem(key)
    } catch {
      return fallback
    }
    if (raw === null) return fallback
    let candidate: unknown
    try {
      candidate = JSON.parse(raw)
    } catch {
      this.#removeStorage(key)
      return fallback
    }
    if (!isPersistedScope(candidate)) {
      this.#removeStorage(key)
      return fallback
    }
    const seen = new Set<string>()
    const descriptors = candidate.tabs.flatMap((tab) => {
      const descriptor = sanitizePersisted(tab, scope, sessionId)
      if (descriptor === undefined
        || PINNED_ID_SET.has(descriptor.id)
        || seen.has(descriptor.id)
        || !this.viewers.canRestore(descriptor)) return []
      seen.add(descriptor.id)
      return [descriptor]
    })
    const known = new Set([...PINNED_ID_SET, ...descriptors.map(tab => tab.id)])
    const activeTabId = known.has(candidate.activeTabId) ? candidate.activeTabId : PINNED_IDS.details
    const state: ScopeState = { descriptors, activeTabId, dirty: new Set() }
    if (raw !== this.#serializeScope(state)) {
      this.#persist(scope, sessionId, state)
    }
    return state
  }

  #persist(scope: WorkbenchScope, sessionId: string | undefined, state: ScopeState): void {
    if (this.#storage === undefined) return
    try {
      this.#storage.setItem(storageKey(scope, sessionId), this.#serializeScope(state))
    } catch {
      // Storage denial/quota never breaks the Workbench model.
    }
  }

  #serializeScope(state: ScopeState): string {
    const tabs: PersistedDescriptor[] = state.descriptors.flatMap((descriptor) => {
      if (!this.viewers.canRestore(descriptor)) return []
      return [{
        id: descriptor.id,
        family: descriptor.family,
        viewerId: descriptor.viewerId,
        title: descriptor.title,
        ...(descriptor.resourceKey === undefined ? {} : { resourceKey: descriptor.resourceKey }),
        ...(descriptor.workspaceProjectId === undefined ? {} : { workspaceProjectId: descriptor.workspaceProjectId }),
        ...(descriptor.workspaceRoot === undefined ? {} : { workspaceRoot: descriptor.workspaceRoot }),
      }]
    })
    const recoverableIds = new Set([...PINNED_ID_SET, ...tabs.map(tab => tab.id)])
    const payload: PersistedScope = {
      version: WORKBENCH_STORAGE_VERSION,
      activeTabId: recoverableIds.has(state.activeTabId) ? state.activeTabId : PINNED_IDS.details,
      tabs,
    }
    return JSON.stringify(payload)
  }

  #sanitizeLoadedScopes(): void {
    const sanitize = (scope: WorkbenchScope, sessionId: string | undefined, state: ScopeState): void => {
      const seen = new Set<string>()
      state.descriptors = state.descriptors.filter((tab) => {
        if (PINNED_ID_SET.has(tab.id) || seen.has(tab.id) || !this.viewers.canRestore(tab)) return false
        seen.add(tab.id)
        return true
      })
      state.dirty = new Set([...state.dirty].filter(id => state.descriptors.some(tab => tab.id === id)))
      if (!this.#allDescriptors(scope, sessionId, state).some(tab => tab.id === state.activeTabId)) {
        state.activeTabId = PINNED_IDS.details
      }
      this.#persist(scope, sessionId, state)
    }
    sanitize('global', undefined, this.#global)
    for (const [sessionId, state] of this.#sessions) sanitize('session', sessionId, state)
    this.#publish()
  }

  #allDescriptors(scope: WorkbenchScope, sessionId: string | undefined, state: ScopeState): WorkbenchTabDescriptor[] {
    const pinned = PINNED_FAMILIES.map(family => ({
      id: PINNED_IDS[family],
      family,
      viewerId: DEFAULT_VIEWER_IDS[family],
      title: FAMILY_TITLES[family],
      scope,
      ...(sessionId === undefined ? {} : { sessionId }),
    }))
    return [...pinned, ...state.descriptors]
  }

  /**
   * 合并投影：固定页签 + 当前会话页签 + 全局页签。
   * 全局页签（文件审阅等）在任何会话下都可见，会话切换不打断审阅。
   */
  #project(): WorkbenchSnapshot {
    const sessionState = this.#currentSessionId === undefined
      ? undefined
      : this.#stateFor('session', this.#currentSessionId)
    const activeTabId = this.#activeTabState().activeTabId
    const toModel = (descriptor: WorkbenchTabDescriptor, state: ScopeState): WorkbenchTabModel => ({
      ...descriptor,
      active: descriptor.id === activeTabId,
      dirty: state.dirty.has(descriptor.id),
      pinned: PINNED_ID_SET.has(descriptor.id),
    })
    const pinned: WorkbenchTabModel[] = PINNED_FAMILIES.map(family => {
      const descriptor: WorkbenchTabDescriptor = {
        id: PINNED_IDS[family],
        family,
        viewerId: DEFAULT_VIEWER_IDS[family],
        title: FAMILY_TITLES[family],
        scope: sessionState === undefined ? 'global' : 'session',
        ...(sessionState === undefined ? {} : { sessionId: this.#currentSessionId as string }),
      }
      return {
        ...descriptor,
        active: descriptor.id === activeTabId,
        dirty: false,
        pinned: true,
      }
    })
    const sessionTabs = sessionState === undefined ? [] : sessionState.descriptors.map(tab => toModel(tab, sessionState))
    const globalTabs = this.#global.descriptors.map(tab => toModel(tab, this.#global))
    const projectWorkspace = this.#projectWorkspaceOf()
    const snapshot: WorkbenchSnapshot = {
      scope: sessionState === undefined ? 'global' : 'session',
      ...(sessionState === undefined ? {} : { sessionId: this.#currentSessionId as string }),
      tabs: [...pinned, ...sessionTabs, ...globalTabs],
      activeTabId,
      ...(this.#detailsSelection === undefined ? {} : { detailsSelection: this.#detailsSelection }),
      filesDockOpen: this.#filesDockOpen,
      ...(projectWorkspace === undefined ? {} : { projectWorkspace }),
      ...(this.#hubProjection === undefined ? {} : { context: this.#hubProjection }),
    }
    return snapshot
  }

  #publish(): void {
    this.#snapshot = this.#project()
    for (const listener of [...this.#listeners]) listener()
  }

  #removeStorage(key: string): void {
    try {
      this.#storage?.removeItem(key)
    } catch {
      // Storage failures only disable cleanup.
    }
  }

  #loadFilesDockOpen(): boolean {
    if (this.#storage === undefined) return true
    try {
      return this.#storage.getItem(FILES_DOCK_STORAGE_KEY) !== '0'
    } catch {
      return true
    }
  }

  #persistFilesDock(): void {
    if (this.#storage === undefined) return
    try {
      this.#storage.setItem(FILES_DOCK_STORAGE_KEY, this.#filesDockOpen ? '1' : '0')
    } catch {
      // Storage denial never breaks the dock.
    }
  }
}

export function storageKey(scope: WorkbenchScope, sessionId?: string): string {
  if (scope === 'global') return `${WORKBENCH_STORAGE_PREFIX}:global`
  if (sessionId === undefined || sessionId.length === 0) throw new Error('workbench: session storage requires an id')
  return `${WORKBENCH_STORAGE_PREFIX}:session:${encodeURIComponent(sessionId)}`
}

function browserStorage(): WorkbenchStorage | undefined {
  return typeof localStorage === 'undefined' ? undefined : localStorage
}

function pinnedIdFor(family: WorkbenchFamily, resourceKey: string | undefined, viewerId: string): string | undefined {
  if (resourceKey !== undefined || viewerId !== DEFAULT_VIEWER_IDS[family]) return undefined
  return family in PINNED_IDS ? PINNED_IDS[family as keyof typeof PINNED_IDS] : undefined
}

function generatedTabId(descriptor: Omit<WorkbenchTabDescriptor, 'id'>): string {
  const identity = `${descriptor.family}\u0000${descriptor.viewerId}\u0000${descriptor.resourceKey ?? descriptor.title}`
  return `workbench:${descriptor.family}:${stableHash(identity)}`
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
}

function normalizeText(value: string, maxLength: number, label: string): string {
  const normalized = value.trim()
  if (normalized.length === 0 || normalized.length > maxLength) {
    throw new TypeError(`workbench: ${label} is invalid`)
  }
  return normalized
}

function isPersistedScope(value: unknown): value is PersistedScope {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return candidate.version === WORKBENCH_STORAGE_VERSION
    && typeof candidate.activeTabId === 'string'
    && Array.isArray(candidate.tabs)
}

function sanitizePersisted(
  value: unknown,
  scope: WorkbenchScope,
  sessionId: string | undefined,
): WorkbenchTabDescriptor | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const candidate = value as Record<string, unknown>
  if (typeof candidate.id !== 'string'
    || !safeIdentifier(candidate.id)
    || !isWorkbenchFamily(candidate.family)) return undefined
  if (typeof candidate.viewerId !== 'string' || !safeIdentifier(candidate.viewerId)) return undefined
  if (typeof candidate.title !== 'string' || candidate.title.trim().length === 0 || candidate.title.length > 120) return undefined
  if (candidate.resourceKey !== undefined
    && (typeof candidate.resourceKey !== 'string' || candidate.resourceKey.length === 0 || candidate.resourceKey.length > 2048)) {
    return undefined
  }
  const workspaceProjectId = candidate.workspaceProjectId === undefined
    ? undefined
    : typeof candidate.workspaceProjectId === 'string'
        && candidate.workspaceProjectId.length > 0
        && candidate.workspaceProjectId.length <= 200
      ? candidate.workspaceProjectId
      : undefined
  const workspaceRoot = candidate.workspaceRoot === undefined
    ? undefined
    : typeof candidate.workspaceRoot === 'string'
        && candidate.workspaceRoot.length > 0
        && candidate.workspaceRoot.length <= 2048
      ? candidate.workspaceRoot
      : undefined
  return {
    id: candidate.id as string,
    family: candidate.family,
    viewerId: candidate.viewerId,
    title: candidate.title.trim(),
    scope,
    ...(sessionId === undefined ? {} : { sessionId }),
    ...(candidate.resourceKey === undefined ? {} : { resourceKey: candidate.resourceKey }),
    ...(workspaceProjectId === undefined ? {} : { workspaceProjectId }),
    ...(workspaceRoot === undefined ? {} : { workspaceRoot }),
  }
}
