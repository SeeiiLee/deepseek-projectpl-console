/**
 * Client-only continuity seam between Project Control path history and the
 * native DSH Workspace/Session projections. It never reads or rewrites
 * workspace.json, session_projcache.json, or persisted session transcripts.
 */

export interface ProjectWorkspaceContinuityLocation {
  locationId: string
  root: string
  kind: 'primary' | 'mirror' | 'archive'
  active: boolean
  revision: number
  createdAt: string
  updatedAt: string
}

export interface ProjectWorkspaceContinuity {
  projectId: string
  revision: number
  activeRoot: string
  locations: readonly ProjectWorkspaceContinuityLocation[]
}

export interface NativeWorkspaceSummary {
  workspaceId: string
  title?: string
  path: string
  sessionIds: readonly string[]
}

export interface NativeSessionSummary {
  id: string
  cwd?: string
  title?: string
  updatedAt?: string | number
  blank?: boolean
}

export interface NativeWorkspaceHistorySnapshot {
  workspaces: readonly NativeWorkspaceSummary[]
  sessions: readonly NativeSessionSummary[]
  archivedSessionIds: readonly string[]
}

export interface NativeLegacySession {
  sessionId: string
  title: string
  cwd: string
  updatedAt?: string | number
  archived: boolean
  locationId: string
  locationRoot: string
  nativeWorkspaceId?: string
}

export interface NativeLegacyWorkspace {
  locationId: string
  root: string
  nativeWorkspaceId?: string
  title?: string
  sessionCount: number
}

export interface NativeWorkspaceHistoryProjection {
  activeRoot: string
  activeNativeWorkspace?: NativeWorkspaceSummary
  legacyWorkspaces: readonly NativeLegacyWorkspace[]
  legacySessions: readonly NativeLegacySession[]
  issues: readonly ('ACTIVE_NATIVE_WORKSPACE_AMBIGUOUS' | 'LEGACY_NATIVE_WORKSPACE_AMBIGUOUS')[]
}

export type NativeRebindPreflight = {
  status: 'ready' | 'warning' | 'blocked'
  code:
    | 'NATIVE_WORKSPACE_READY'
    | 'NATIVE_HISTORY_WILL_REMAIN_AT_OLD_PATH'
    | 'SOURCE_NATIVE_WORKSPACE_AMBIGUOUS'
    | 'TARGET_NATIVE_WORKSPACE_AMBIGUOUS'
    | 'TARGET_MATCHES_ACTIVE_ROOT'
  sourceHistoryCount: number
  sourceRoot: string
  targetRoot: string
  targetWorkspaceExists: boolean
}

interface ObservableFace<T> {
  getSnapshot(): T
  subscribe(listener: () => void): () => void
}

export interface NativeHistorySessionsFace {
  list: ObservableFace<{
    ids: readonly string[]
    byId: Readonly<Record<string, NativeSessionSummary | undefined>>
  }>
  open(id: string): void
}

export interface NativeHistoryWorkspacesFace {
  list: ObservableFace<{
    items: readonly NativeWorkspaceSummary[]
    archivedSessionIds: readonly string[]
  }>
  create(input: { path: string }): Promise<NativeWorkspaceSummary>
  connectWorkspace(workspaceId: string): Promise<string>
}

export interface NativeWorkspaceHistoryBridge {
  snapshot(): NativeWorkspaceHistorySnapshot
  subscribe(listener: () => void): () => void
  openLegacySession(sessionId: string): void
  continueInActiveWorkspace(
    activeRoot: string,
    source?: { sessionId: string; expectedRoot: string },
  ): Promise<{ sessionId: string; workspaceId: string; createdWorkspace: boolean }>
}

export class NativeWorkspaceHistoryError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'NativeWorkspaceHistoryError'
    this.code = code
  }
}

export function nativePathKey(value: string): string {
  let path = value.trim().replace(/\//gu, '\\')
  while (path.length > 3 && path.endsWith('\\')) path = path.slice(0, -1)
  return path.toLocaleLowerCase('en-US')
}

function samePath(left: string | undefined, right: string): boolean {
  return left !== undefined && nativePathKey(left) === nativePathKey(right)
}

function nonBlankSessionsAt(snapshot: NativeWorkspaceHistorySnapshot, root: string): NativeSessionSummary[] {
  return snapshot.sessions.filter(session => session.blank === false && samePath(session.cwd, root))
}

/**
 * Classify immutable historical sessions using Project Control's inactive
 * location records. Exact path identity only: a sibling or descendant is not
 * silently claimed as history for this project.
 */
export function projectNativeWorkspaceHistory(
  continuity: ProjectWorkspaceContinuity,
  snapshot: NativeWorkspaceHistorySnapshot,
): NativeWorkspaceHistoryProjection {
  const issues: NativeWorkspaceHistoryProjection['issues'][number][] = []
  const activeMatches = snapshot.workspaces.filter(workspace => samePath(workspace.path, continuity.activeRoot))
  if (activeMatches.length > 1) issues.push('ACTIVE_NATIVE_WORKSPACE_AMBIGUOUS')

  const archived = new Set(snapshot.archivedSessionIds)
  const legacySessions: NativeLegacySession[] = []
  const legacyWorkspaces: NativeLegacyWorkspace[] = []
  const seenLocations = new Set<string>()
  const seenSessions = new Set<string>()
  const activeKey = nativePathKey(continuity.activeRoot)

  for (const location of continuity.locations) {
    const key = nativePathKey(location.root)
    if (location.active || key === activeKey || seenLocations.has(key)) continue
    seenLocations.add(key)
    const nativeMatches = snapshot.workspaces.filter(workspace => samePath(workspace.path, location.root))
    if (nativeMatches.length > 1) issues.push('LEGACY_NATIVE_WORKSPACE_AMBIGUOUS')
    const nativeWorkspace = nativeMatches.length === 1 ? nativeMatches[0] : undefined
    const sessions = nonBlankSessionsAt(snapshot, location.root)
    legacyWorkspaces.push({
      locationId: location.locationId,
      root: location.root,
      sessionCount: sessions.length,
      ...(nativeWorkspace === undefined ? {} : {
        nativeWorkspaceId: nativeWorkspace.workspaceId,
        ...(nativeWorkspace.title === undefined ? {} : { title: nativeWorkspace.title }),
      }),
    })
    for (const session of sessions) {
      if (seenSessions.has(session.id) || session.cwd === undefined) continue
      seenSessions.add(session.id)
      legacySessions.push({
        sessionId: session.id,
        title: session.title?.trim() || '未命名旧会话',
        cwd: session.cwd,
        ...(session.updatedAt === undefined ? {} : { updatedAt: session.updatedAt }),
        archived: archived.has(session.id),
        locationId: location.locationId,
        locationRoot: location.root,
        ...(nativeWorkspace === undefined ? {} : { nativeWorkspaceId: nativeWorkspace.workspaceId }),
      })
    }
  }

  legacySessions.sort((left, right) =>
    String(right.updatedAt ?? '').localeCompare(String(left.updatedAt ?? ''))
      || left.sessionId.localeCompare(right.sessionId))
  return {
    activeRoot: continuity.activeRoot,
    ...(activeMatches.length === 1 ? { activeNativeWorkspace: activeMatches[0] } : {}),
    legacyWorkspaces,
    legacySessions,
    issues: [...new Set(issues)],
  }
}

/** Fail-closed client preflight run before either a user-initiated scan or final rebind submit. */
export function assessNativeRebindPreflight(
  continuity: ProjectWorkspaceContinuity,
  snapshot: NativeWorkspaceHistorySnapshot,
  targetRoot: string,
): NativeRebindPreflight {
  const sourceRoot = continuity.activeRoot
  const sourceHistoryCount = nonBlankSessionsAt(snapshot, sourceRoot).length
  const targetMatches = snapshot.workspaces.filter(workspace => samePath(workspace.path, targetRoot))
  const base = {
    sourceHistoryCount,
    sourceRoot,
    targetRoot,
    targetWorkspaceExists: targetMatches.length === 1,
  }
  if (samePath(sourceRoot, targetRoot)) {
    return { ...base, status: 'blocked', code: 'TARGET_MATCHES_ACTIVE_ROOT' }
  }
  const sourceMatches = snapshot.workspaces.filter(workspace => samePath(workspace.path, sourceRoot))
  if (sourceMatches.length > 1) {
    return { ...base, status: 'blocked', code: 'SOURCE_NATIVE_WORKSPACE_AMBIGUOUS' }
  }
  if (targetMatches.length > 1) {
    return { ...base, status: 'blocked', code: 'TARGET_NATIVE_WORKSPACE_AMBIGUOUS' }
  }
  if (sourceHistoryCount > 0) {
    return { ...base, status: 'warning', code: 'NATIVE_HISTORY_WILL_REMAIN_AT_OLD_PATH' }
  }
  return { ...base, status: 'ready', code: 'NATIVE_WORKSPACE_READY' }
}

export function nativeRebindPreflightMessage(preflight: NativeRebindPreflight): string {
  switch (preflight.code) {
    case 'NATIVE_HISTORY_WILL_REMAIN_AT_OLD_PATH':
      return `原生工作区里有 ${String(preflight.sourceHistoryCount)} 个旧会话。换绑只改变项目位置，不会搬迁或改写这些会话；它们会以“旧位置历史”继续显示。是否继续？`
    case 'SOURCE_NATIVE_WORKSPACE_AMBIGUOUS':
      return '项目当前位置对应多个原生工作区，无法安全判断旧会话归属，已停止。'
    case 'TARGET_NATIVE_WORKSPACE_AMBIGUOUS':
      return '目标位置对应多个原生工作区，无法安全承接未来新会话，已停止。'
    case 'TARGET_MATCHES_ACTIVE_ROOT':
      return '选择的目标位置就是项目当前位置，没有需要执行的位置变更。'
    case 'NATIVE_WORKSPACE_READY':
      return '原生工作区连续性预检通过。'
  }
}

/** Adapter over public client-runtime services; all writes stay on official native RPCs. */
export function createNativeWorkspaceHistoryBridge(input: {
  sessions: NativeHistorySessionsFace
  workspaces: NativeHistoryWorkspacesFace
}): NativeWorkspaceHistoryBridge {
  const { sessions, workspaces } = input
  const snapshot = (): NativeWorkspaceHistorySnapshot => {
    const sessionState = sessions.list.getSnapshot()
    const workspaceState = workspaces.list.getSnapshot()
    return {
      workspaces: workspaceState.items,
      sessions: sessionState.ids.flatMap(id => {
        const value = sessionState.byId[id]
        return value === undefined ? [] : [{ ...value, id }]
      }),
      archivedSessionIds: workspaceState.archivedSessionIds,
    }
  }
  return {
    snapshot,
    subscribe(listener) {
      const offSessions = sessions.list.subscribe(listener)
      const offWorkspaces = workspaces.list.subscribe(listener)
      return () => { offSessions(); offWorkspaces() }
    },
    openLegacySession(sessionId) {
      const current = snapshot()
      const session = current.sessions.find(item => item.id === sessionId && item.blank === false)
      if (session === undefined) {
        throw new NativeWorkspaceHistoryError('LEGACY_SESSION_NOT_FOUND', '旧会话已不在原生会话索引中，已停止。')
      }
      if (current.archivedSessionIds.includes(sessionId)) {
        throw new NativeWorkspaceHistoryError('LEGACY_SESSION_ARCHIVED', '该旧会话已归档，请先在原生会话列表恢复。')
      }
      sessions.open(sessionId)
    },
    async continueInActiveWorkspace(activeRoot, source) {
      const before = snapshot()
      if (source !== undefined
        && !before.sessions.some(item => item.id === source.sessionId
          && item.blank === false
          && samePath(item.cwd, source.expectedRoot))) {
        throw new NativeWorkspaceHistoryError('LEGACY_SESSION_NOT_FOUND', '来源旧会话已不在原生会话索引中，已停止。')
      }
      const matches = before.workspaces.filter(workspace => samePath(workspace.path, activeRoot))
      if (matches.length > 1) {
        throw new NativeWorkspaceHistoryError(
          'TARGET_NATIVE_WORKSPACE_AMBIGUOUS',
          '当前项目位置对应多个原生工作区，已停止；没有创建或打开新会话。',
        )
      }
      let workspace = matches[0]
      let createdWorkspace = false
      if (workspace === undefined) {
        workspace = await workspaces.create({ path: activeRoot })
        if (!samePath(workspace.path, activeRoot)) {
          throw new NativeWorkspaceHistoryError(
            'TARGET_NATIVE_WORKSPACE_MISMATCH',
            '原生工作区返回的路径与项目当前位置不一致，已停止。',
          )
        }
        createdWorkspace = true
      }
      const sessionId = await workspaces.connectWorkspace(workspace.workspaceId)
      sessions.open(sessionId)
      return { sessionId, workspaceId: workspace.workspaceId, createdWorkspace }
    },
  }
}
