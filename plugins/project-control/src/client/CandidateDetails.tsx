import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  createProjectControlApi,
  documentRoleLabel,
  PROJECT_DOCUMENT_ROLES,
  type ProjectCandidate,
  type CandidateDocument,
  type ProjectDocumentRole,
} from './projectControlApi.ts'
import { notifyProjectControlChanged } from './projectControlEvents.ts'
import css from './CandidateDetails.module.css'

const api = createProjectControlApi()
type DocumentChoice = ProjectDocumentRole | 'ignore'

interface DetailReadyState {
  kind: 'ready'
  candidate: ProjectCandidate
}

type DetailState =
  | { kind: 'loading' }
  | DetailReadyState
  | { kind: 'error'; message: string }

export function CandidateDetails({ candidateId }: { candidateId: string }): ReactNode {
  const [reloadKey, setReloadKey] = useState(0)
  const [state, setState] = useState<DetailState>({ kind: 'loading' })
  const [displayName, setDisplayName] = useState('')
  const [documentChoices, setDocumentChoices] = useState<Record<string, DocumentChoice>>({})
  const [submitState, setSubmitState] = useState<
    | { kind: 'idle' }
    | { kind: 'working'; message: string }
    | { kind: 'success'; message: string }
    | { kind: 'error'; message: string }
  >({ kind: 'idle' })

  useEffect(() => {
    const controller = new AbortController()
    setState({ kind: 'loading' })
    setSubmitState({ kind: 'idle' })
    api.getCandidate(candidateId, controller.signal).then(candidate => {
      setState({ kind: 'ready', candidate })
      setDisplayName(candidate.suggestedName)
      setDocumentChoices(Object.fromEntries(
        candidate.documents.map(document => [document.documentId, defaultDocumentChoice(document.suggestedRole)]),
      ))
    }, error => {
      if (controller.signal.aborted) return
      setState({
        kind: 'error',
        message: error instanceof Error ? error.message : '候选项目详情暂时无法读取。',
      })
    })
    return () => { controller.abort() }
  }, [candidateId, reloadKey])

  const effectiveChoices = useMemo(() => {
    if (state.kind !== 'ready') return {}
    return Object.fromEntries(state.candidate.documents.map(document => [
      document.documentId,
      documentChoices[document.documentId] ?? defaultDocumentChoice(document.suggestedRole),
    ]))
  }, [documentChoices, state])

  const roleConflictGroups = useMemo(() => {
    const groups = new Map<ProjectDocumentRole, string[]>()
    if (state.kind !== 'ready' || state.candidate.detectedMode === 'managed') return groups
    for (const document of state.candidate.documents) {
      const role = effectiveChoices[document.documentId]
      if (role === undefined || role === 'ignore') continue
      const list = groups.get(role)
      if (list === undefined) groups.set(role, [document.documentId])
      else list.push(document.documentId)
    }
    for (const [role, ids] of [...groups]) if (ids.length < 2) groups.delete(role)
    return groups
  }, [effectiveChoices, state])

  // 每个重复角色保留证据最强的一份；其余交给用户或「自动处理重复角色」。
  const roleConflictPrimaries = useMemo(() => {
    const primaries = new Map<ProjectDocumentRole, string>()
    if (state.kind !== 'ready') return primaries
    for (const [role, ids] of roleConflictGroups) {
      const ranked = [...ids].sort((leftId, rightId) => {
        const left = state.candidate.documents.find(document => document.documentId === leftId)
        const right = state.candidate.documents.find(document => document.documentId === rightId)
        return (right?.evidence.length ?? 0) - (left?.evidence.length ?? 0)
      })
      primaries.set(role, ranked[0]!)
    }
    return primaries
  }, [roleConflictGroups, state])
  const registrationError = useMemo(() => {
    if (state.kind !== 'ready') return undefined
    if (state.candidate.status === 'ignored') return '请先在项目控制台恢复这个候选，再进行登记。'
    if (state.candidate.status === 'imported') return '这个候选已经加入项目控制台。'
    const name = displayName.trim()
    if (name.length === 0 || name.length > 120) return '显示名称应为 1–120 个字符。'
    if (state.candidate.detectedMode !== 'managed') {
      const missingHash = state.candidate.documents.find(document =>
        documentChoices[document.documentId] !== 'ignore' && document.contentHash === undefined)
      if (missingHash !== undefined) return missingHash.relativePath + ' 缺少内容哈希，请设为“不参与索引”后重试。'
      for (const document of state.candidate.documents) {
        const role = effectiveChoices[document.documentId]
        if (role === undefined || role === 'ignore' || !roleConflictGroups.has(role)) continue
        const ids = roleConflictGroups.get(role)!
        const shown = ids.slice(0, 3).map(id => {
          const doc = state.candidate.documents.find(candidateDocument => candidateDocument.documentId === id)
          return doc?.relativePath ?? id
        })
        const extra = ids.length > 3 ? ' 等 ' + String(ids.length) + ' 份' : ''
        return '“' + documentRoleLabel(role) + '”只能选择一份主文档（冲突：' + shown.join('、') + extra + '），其余请设为其他角色或不参与索引，或使用「自动处理重复角色」。'
      }
    }
    if (state.candidate.issues.some(issue => issue.severity === 'blocking' && issue.status !== 'resolved')) {
      return '这个候选仍有阻断问题，需要先处理或重新扫描。'
    }
    return undefined
  }, [displayName, documentChoices, effectiveChoices, roleConflictGroups, state])

  const roleConflictKind = (documentId: string): 'primary' | 'duplicate' | undefined => {
    for (const [role, ids] of roleConflictGroups) {
      if (!ids.includes(documentId)) continue
      return roleConflictPrimaries.get(role) === documentId ? 'primary' : 'duplicate'
    }
    return undefined
  }

  const roleConflictExtras = [...roleConflictGroups.values()]
    .reduce((count, ids) => count + ids.length - 1, 0)

  const autoResolveRoleConflicts = (): void => {
    if (state.kind !== 'ready') return
    const updates: Record<string, DocumentChoice> = {}
    for (const [role, ids] of roleConflictGroups) {
      const primary = roleConflictPrimaries.get(role)
      for (const id of ids) if (id !== primary) updates[id] = 'ignore'
    }
    setDocumentChoices(current => ({ ...current, ...updates }))
    setSubmitState({ kind: 'idle' })
  }
  const submit = async (): Promise<void> => {
    if (state.kind !== 'ready' || registrationError !== undefined) return
    const candidate = state.candidate
    const documentBindings = candidate.detectedMode === 'managed'
      ? []
      : candidate.documents.flatMap(document => {
          const role = documentChoices[document.documentId] ?? defaultDocumentChoice(document.suggestedRole)
          if (role === 'ignore' || document.contentHash === undefined) return []
          return [{ role, relativePath: document.relativePath, contentHash: document.contentHash }]
        })
    setSubmitState({ kind: 'working', message: '正在生成只关联指令…' })
    try {
      const command = await api.prepareCandidate(candidate.candidateId, {
        registrationMode: candidate.detectedMode === 'managed' ? 'managed' : 'linked_legacy',
        name: displayName.trim(),
        documentBindings,
        expectedRevision: candidate.revision,
      })
      setSubmitState({ kind: 'working', message: '正在登记项目…' })
      const result = await api.submitLifecycle(command)
      if (result.status === 'rejected') {
        setSubmitState({
          kind: 'error',
          message: result.error?.message ?? '只关联指令没有被 Host 接受。',
        })
        return
      }
      setSubmitState({
        kind: 'success',
        message: result.status === 'replayed'
          ? '这项变更此前已完成，状态已同步。'
          : candidate.status === 'relocation_candidate'
            ? '项目位置已重新绑定。'
            : candidate.detectedMode === 'managed'
              ? '现有受管理项目已登记。'
              : '项目已只读关联到控制台。',
      })
      notifyProjectControlChanged()
    } catch (error) {
      setSubmitState({
        kind: 'error',
        message: error instanceof Error ? error.message : '项目登记没有完成。',
      })
    }
  }

  if (state.kind === 'loading') {
    return <DetailMessage title="正在读取候选项目" copy="路径、文档与冲突仍在由 Host 确认。" />
  }
  if (state.kind === 'error') {
    return (
      <DetailMessage title="无法读取候选项目" copy={state.message}>
        <button className={css.secondaryButton} type="button" onClick={() => { setReloadKey(value => value + 1) }}>
          重试
        </button>
      </DetailMessage>
    )
  }

  const { candidate } = state
  const relocation = candidate.status === 'relocation_candidate'
  const managedExisting = candidate.detectedMode === 'managed'
  const actionLabel = relocation
    ? '重新绑定位置'
    : managedExisting
      ? '登记现有受管理项目'
      : '只关联，不修改项目文件'
  return (
    <article className={css.details} data-project-control-candidate-details={candidate.candidateId}>
      <header className={css.header}>
        <div className={css.headerRow}>
          <span className={css.eyebrow}>Gate 2C · 候选审阅</span>
          <span className={css.evidenceBadge} data-level={candidate.evidenceLevel}>
            {evidenceLevelLabel(candidate.evidenceLevel)}证据
          </span>
        </div>
        <h2>{candidate.suggestedName}</h2>
        <p className={css.absolutePath} title={candidate.rootPath}>{candidate.rootPath}</p>
        <div className={css.statusLine}>
          <span>{candidateStatusLabel(candidate.status)}</span>
          <span>{candidate.detectedMode === 'managed' ? '检测到受管理 manifest' : '现有项目'}</span>
          <span>修订 {candidate.revision}</span>
        </div>
      </header>

      <section className={css.section} aria-labelledby={`candidate-${candidate.candidateId}-identity`}>
        <h3 id={`candidate-${candidate.candidateId}-identity`}>名称与摘要</h3>
        <label className={css.field}>
          <span>控制台显示名称</span>
          <input
            value={displayName}
            maxLength={120}
            readOnly={managedExisting}
            aria-readonly={managedExisting}
            onChange={event => { setDisplayName(event.target.value); setSubmitState({ kind: 'idle' }) }}
          />
        </label>
        <SourceLine label="名称依据" source={candidate.nameSource} fallback="项目文件夹名" />
        <div className={css.summaryBox}>
          <span>一句话简介</span>
          <p>{candidate.summary ?? '未识别；当前不会根据普通文档段落猜测目标。'}</p>
          <SourceLine label="摘要依据" source={candidate.summarySource} fallback="无明确结构化来源" />
        </div>
        {candidate.evidence.length > 0 && (
          <ul className={css.evidenceList} aria-label="候选识别证据">
            {candidate.evidence.map((evidence, index) => <li key={`${evidence}-${String(index)}`}>{evidence}</li>)}
          </ul>
        )}
      </section>

      {candidate.issues.length > 0 && (
        <section className={css.section} aria-labelledby={`candidate-${candidate.candidateId}-issues`}>
          <h3 id={`candidate-${candidate.candidateId}-issues`}>问题与冲突</h3>
          <ul className={css.issueList}>
            {candidate.issues.map(issue => (
              <li key={issue.issueId} data-severity={issue.severity}>
                <div><strong>{issue.code}</strong><span>{severityLabel(issue.severity)}</span></div>
                <p>{issue.message}</p>
                {issue.relativePath !== undefined && <code>{issue.relativePath}</code>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className={css.section} aria-labelledby={`candidate-${candidate.candidateId}-documents`}>
        <div className={css.sectionHeading}>
          <h3 id={`candidate-${candidate.candidateId}-documents`}>文档映射</h3>
          <div className={css.sectionHeadingTools}>
            <span>{candidate.documents.length} 项</span>
            {roleConflictExtras > 0 && (
              <button className={css.autoResolveButton} type="button" data-project-control-auto-resolve-roles onClick={autoResolveRoleConflicts}>
                自动处理重复角色（{roleConflictExtras} 份）
              </button>
            )}
          </div>
        </div>
        {candidate.documents.length === 0 ? (
          <p className={css.emptyCopy}>没有发现可安全索引的文档。</p>
        ) : (
          <ul className={css.documentList}>
            {candidate.documents.map(document => (
              <li key={document.documentId} className={css.documentCard + (roleConflictKind(document.documentId) === undefined ? '' : ' ' + css.roleConflict)}>
                <div className={css.documentHeading}>
                  <div>
                    <strong>{document.title ?? fileName(document.relativePath)}</strong>
                    <code title={document.relativePath}>{document.relativePath}</code>
                  </div>
                  {roleConflictKind(document.documentId) !== undefined && (
                    <span className={css.conflictBadge} data-kind={roleConflictKind(document.documentId)} data-project-control-role-conflict={roleConflictKind(document.documentId)}>
                      {roleConflictKind(document.documentId) === 'primary' ? '将保留此份' : '重复角色'}
                    </span>
                  )}
                  {managedExisting ? (
                    <span className={css.lockedBinding}>
                      {manifestLockedRole(document) === undefined
                        ? '未由 manifest 绑定'
                        : `manifest 已锁定：${documentRoleLabel(manifestLockedRole(document)!)}`}
                    </span>
                  ) : (
                    <label>
                      <span className={css.visuallyHidden}>设置 {document.relativePath} 的文档角色</span>
                      <select
                        value={documentChoices[document.documentId] ?? defaultDocumentChoice(document.suggestedRole)}
                        onChange={event => {
                          setDocumentChoices(current => ({
                            ...current,
                            [document.documentId]: event.target.value as DocumentChoice,
                          }))
                          setSubmitState({ kind: 'idle' })
                        }}
                      >
                        {PROJECT_DOCUMENT_ROLES.map(role => (
                          <option key={role} value={role}>{documentRoleLabel(role)}</option>
                        ))}
                        <option value="ignore">不参与索引</option>
                      </select>
                    </label>
                  )}
                </div>
                <div className={css.documentMeta}>
                  <span title={document.contentHash}>{shortHash(document.contentHash)}</span>
                  {document.evidence.map((evidence, index) => (
                    <span key={`${evidence}-${String(index)}`}>{evidence}</span>
                  ))}
                </div>
                {document.preview !== undefined && <pre className={css.preview}>{document.preview}</pre>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <footer className={css.actions}>
        <div className={css.impactNote}>
          <strong>本次影响：{actionLabel}</strong>
          <span>
            {relocation
              ? 'Host 只更新全局位置绑定；不会移动、改名或重写项目资料。'
              : managedExisting
                ? 'Host 将验证现有 manifest 并登记其镜像；不会创建或改写受管理文件。'
                : '名称覆盖和文档映射只保存在 Project Control；不会移动、改名或重写现有资料。'}
          </span>
        </div>
        {registrationError !== undefined && <p className={css.validation} role="alert">{registrationError}</p>}
        {submitState.kind !== 'idle' && (
          <p
            className={submitState.kind === 'error' ? css.submitError : css.submitStatus}
            role={submitState.kind === 'error' ? 'alert' : 'status'}
            aria-live="polite"
          >
            {submitState.message}
          </p>
        )}
        <button
          className={css.primaryButton}
          type="button"
          disabled={registrationError !== undefined || submitState.kind === 'working' || submitState.kind === 'success'}
          onClick={() => { void submit() }}
        >
          {submitState.kind === 'working' ? '正在处理…' : submitState.kind === 'success' ? '已完成' : actionLabel}
        </button>
      </footer>
    </article>
  )
}

function defaultDocumentChoice(role: ProjectDocumentRole | null): DocumentChoice {
  // Files without a confident semantic role remain visible for review, but are
  // not silently indexed as generic project facts.
  return role ?? 'ignore'
}

function manifestLockedRole(document: CandidateDocument): ProjectDocumentRole | undefined {
  return document.suggestedRole !== null
    && document.evidence.some(evidence => evidence.toLocaleLowerCase('en-US').startsWith('manifest:'))
    ? document.suggestedRole
    : undefined
}

function DetailMessage({ title, copy, children }: { title: string; copy: string; children?: ReactNode }): ReactNode {
  return (
    <div className={css.message} role="status">
      <h2>{title}</h2>
      <p>{copy}</p>
      {children}
    </div>
  )
}

function SourceLine({
  label,
  source,
  fallback,
}: {
  label: string
  source: ProjectCandidate['nameSource']
  fallback: string
}): ReactNode {
  return (
    <p className={css.sourceLine}>
      <span>{label}</span>
      <code>{source?.relativePath ?? source?.label ?? fallback}</code>
    </p>
  )
}

function evidenceLevelLabel(level: ProjectCandidate['evidenceLevel']): string {
  switch (level) {
    case 'high': return '高'
    case 'medium': return '中'
    case 'low': return '低'
    case 'unknown': return '未知'
  }
}

function candidateStatusLabel(status: string): string {
  switch (status) {
    case 'discovered': return '待确认'
    case 'ignored': return '已忽略'
    case 'registered': return '已登记'
    case 'imported': return '已登记'
    case 'relocation_candidate': return '位置待重绑'
    case 'conflict': return '需要处理'
    default: return status
  }
}

function severityLabel(severity: ProjectCandidate['issues'][number]['severity']): string {
  switch (severity) {
    case 'blocking': return '阻断'
    case 'error': return '错误'
    case 'warning': return '提醒'
    case 'info': return '信息'
  }
}

function fileName(relativePath: string): string {
  return relativePath.split('/').at(-1) ?? relativePath
}

function shortHash(hash: string | undefined): string {
  return hash === undefined ? '未生成内容哈希' : `${hash.slice(0, 15)}…${hash.slice(-8)}`
}
