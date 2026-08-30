import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { readFile, readdir, stat } from 'node:fs/promises'
import { win32 } from 'node:path'
import { canonicalJson } from './host/index.js'
import { parseYamlSubset } from './discovery/runtime.js'
import { validateProjectManifest } from './manifest-validator.ts'
import { createPrefixedUuidV7 } from './host/index.js'
import type {
  ImportCandidateInput,
  ImportCandidateView,
  ProjectControlStorage,
  ProjectDocumentBindingInput,
  ProjectView,
  RecordImportScanInput,
} from './host/index.js'
import {
  projectControlHttpError,
  type ProjectControlCandidatePreparation,
  type ProjectControlCreatePreparation,
  type ProjectControlIntakeScanRequest,
  type ProjectControlIntakeService,
  type ProjectControlReferenceResolver,
  type ProjectCreateResolution,
  type ProjectRegistrationResolution,
  type ProjectRebindResolution,
  type ProjectUpgradeResolution,
} from './http.ts'
import { verifyProjectControlSelectionTicket } from './selection-ticket.ts'
import { computePlanHash, stagingRootForPlan, verifyWritePlanHashes } from './filesync/plan-executor.js'
import {
  listTemplateVersions,
  loadTemplate,
  renderTemplate,
  TemplateRegistryError,
} from './templates/registry.js'
import { FileSyncPlanError } from './filesync/plan-executor.js'
import { refreshProjectDocumentIndex } from './document-index.ts'
import {
  isProjectHomeSlug,
  PROJECT_HOME_MANIFEST_PATH,
  PROJECT_HOME_WORKSPACE_PATH,
} from './project-home.ts'

const REFERENCE_SCOPE = 'project-control.lifecycle' as const

interface ScannerOptions {
  maxDepth?: number
}

export interface ProjectControlScanner {
  scanSourceDirectory(rootPath: string, options?: ScannerOptions): Promise<unknown>
  scanProjectDirectory(rootPath: string, options?: ScannerOptions): Promise<unknown>
}

export interface ProjectControlIntakeRuntime {
  intake: ProjectControlIntakeService
  referenceResolver: ProjectControlReferenceResolver
}

export function createProjectControlIntakeRuntime(options: {
  storage: Readonly<ProjectControlStorage>
  scanner: ProjectControlScanner
  selectionSecret: string
  applicationInstanceId: string
  applicationVersion: string
  projectHomeRoot?: string
  now?: () => string
  idFactory?: (prefix: string) => string
}): ProjectControlIntakeRuntime {
  const now = options.now ?? (() => new Date().toISOString())
  const idFactory = options.idFactory ?? ((prefix: string) => createPrefixedUuidV7(prefix as 'prj'))
  const consumedSelections = new Map<string, number>()
  const referenceContext = {
    applicationInstanceId: options.applicationInstanceId,
    scope: REFERENCE_SCOPE,
  }
  const projectHomeRoot = options.projectHomeRoot ?? 'F:\\Projects'

  const intake: ProjectControlIntakeService = {
    async scan(input) {
      authorizeSelection(input, options.selectionSecret, consumedSelections)
      try {
        const scan = requireScanEnvelope(input.mode === 'source-root'
          ? await options.scanner.scanSourceDirectory(input.selection.path, {
              ...(input.maxDepth === undefined ? {} : { maxDepth: input.maxDepth }),
            })
          : await options.scanner.scanProjectDirectory(input.selection.path, {
              ...(input.maxDepth === undefined ? {} : { maxDepth: input.maxDepth }),
            }))
        const expectedMode = input.mode === 'source-root' ? 'source_root' : 'single_project'
        if (scan.mode !== expectedMode || !sameWindowsPath(scan.rootPath.displayPath, input.selection.path)) {
          throw projectControlHttpError(
            'SCAN_BOUNDARY_MISMATCH',
            '扫描器返回了目录选择范围之外的结果。',
            409,
          )
        }
        return options.storage.recordImportScan(await annotateKnownProjects(scan, options.storage))
      } catch (error) {
        consumedSelections.delete(input.selection.authorization.nonce)
        throw publicIntakeError(error)
      }
    },

    listSourceRoots() {
      return options.storage.listSourceRoots({ isEnabled: true, limit: 100 })
    },

    listCandidates(filter) {
      try {
        return options.storage.queryImportCandidates({
          ...(filter.jobId === undefined ? {} : { importJobId: filter.jobId }),
          view: filter.view ?? (filter.jobId === undefined ? 'review' : 'all'),
          search: filter.search ?? '',
          limit: filter.limit ?? 25,
          afterCandidateId: filter.afterCandidateId ?? '',
        })
      } catch (error) {
        throw publicIntakeError(error)
      }
    },

    getCandidate(candidateId) {
      return requireCandidate(options.storage, candidateId)
    },

    setCandidateIgnored(candidateId, input) {
      try {
        return options.storage.setImportCandidateIgnored(
          candidateId,
          input.ignored,
          input.expectedRevision,
        )
      } catch (error) {
        throw publicIntakeError(error)
      }
    },

    setCandidatesIgnored(input) {
      try {
        return options.storage.setImportCandidatesIgnored(input.candidates, input.ignored)
      } catch (error) {
        throw publicIntakeError(error)
      }
    },

    async prepareCandidate(candidateId, input) {
      const candidate = requireCandidate(options.storage, candidateId)
      requireCandidateRevision(candidate, input.expectedRevision)
      if (!['discovered', 'relocation_candidate'].includes(candidate.status)) {
        throw projectControlHttpError(
          'CANDIDATE_NOT_READY',
          '这个项目候选当前不能登记；请先解决冲突或恢复忽略状态。',
          409,
        )
      }
      const fresh = await rescanCandidate(options.scanner, candidate)
      verifyPreparation(candidate, fresh, input)
      let refs
      try {
        refs = options.storage.issueImportCandidateRefs(candidateId, {
          ...referenceContext,
          expectedRevision: input.expectedRevision,
          ttlSeconds: 300,
        })
      } catch (error) {
        throw publicIntakeError(error)
      }
      return signIntakeCommand(buildLifecycleCommand({
        candidate,
        fresh,
        input,
        refs,
        applicationInstanceId: options.applicationInstanceId,
        applicationVersion: options.applicationVersion,
        occurredAt: now(),
        project: candidate.status === 'relocation_candidate'
          ? requireMatchedProject(options.storage, candidate)
          : null,
      }), options.selectionSecret)
    },

    async prepareUpgrade(projectId: string, input: { expectedRevision: number }) {
      const project = options.storage.getProject(projectId)
      if (project === null || project.mode !== 'linked_legacy') {
        throw projectControlHttpError('MODE_CONFLICT', '只有已关联的旧项目可以升级为受管理项目。', 409)
      }
      if (project.revision !== input.expectedRevision) {
        throw projectControlHttpError('REVISION_CONFLICT', '项目已经变化，请刷新后重试。', 409)
      }
      const activeLocation = project.workspaceLocations?.find(location => location.isActive)
      if (activeLocation === undefined) {
        throw projectControlHttpError('REFERENCE_UNRESOLVED', '项目没有可升级的活动位置。', 409)
      }
      const bindings = (project.documentBindings ?? [])
        .map(binding => ({ role: binding.role, relativePath: binding.relativePath, contentHash: binding.contentHash }))
        .sort((left, right) => `${left.role}\u0000${left.relativePath}` < `${right.role}\u0000${right.relativePath}` ? -1 : 1)
      const fingerprintHash = sha256(Buffer.from(canonicalJson({
        projectId,
        documentBindings: bindings,
      }), 'utf8'))
      const manifestYaml = buildUpgradeManifestYaml({
        projectId,
        name: project.name,
        createdAt: project.createdAt,
        documentBindings: bindings.map(binding => ({
          role: binding.role,
          relativePath: binding.relativePath,
          required: Boolean((project.documentBindings ?? []).find(item => item.relativePath === binding.relativePath && item.role === binding.role)?.required),
        })),
      })
      const manifestBytes = Buffer.from(manifestYaml, 'utf8')
      const manifestHash = sha256(manifestBytes)
      let manifestObject: Record<string, unknown>
      try {
        manifestObject = parseYamlSubset(manifestYaml) as Record<string, unknown>
      } catch {
        throw projectControlHttpError('MANIFEST_INVALID', '无法为该项目生成合法 manifest。', 409)
      }
      const manifestValidation = validateProjectManifest(manifestObject)
      if (!manifestValidation.valid) {
        throw projectControlHttpError('MANIFEST_INVALID', '无法为该项目生成合法 manifest。', 409)
      }
      const syncPolicy = 'atomic_additive'
      const operations: Array<
        | { kind: 'create_directory'; relativePath: string; expectedState: 'absent' }
        | { kind: 'create_file'; relativePath: string; expectedState: 'absent'; contentHash: string }
      > = [
        { kind: 'create_directory', relativePath: '.dsh-project', expectedState: 'absent' },
        { kind: 'create_file', relativePath: '.dsh-project/project.yaml', expectedState: 'absent', contentHash: manifestHash },
      ]
      const planHash = computePlanHash({ manifestHash, syncPolicy, operations })
      const planId = idFactory('pln')
      const commandId = idFactory('cmd')
      const createdAt = now()
      const targetDisplayPath = activeLocation.displayPath
      const stagingDisplayPath = stagingRootForPlan({ syncPolicy, planId }, targetDisplayPath)
      options.storage.createFileSyncPlan({
        planId,
        commandId,
        kind: 'upgrade_managed',
        projectId,
        syncPolicy,
        targetDisplayPath,
        targetNormalizedPath: activeLocation.normalizedPath,
        stagingDisplayPath,
        planHash,
        manifestHash,
        operations,
        renderParams: {
          projectId,
          name: project.name,
          createdAt: project.createdAt,
          fingerprintHash,
          documentBindings: bindings,
          expectedRevision: project.revision,
          locationRef: activeLocation.locationId,
          locationRevision: activeLocation.revision,
        },
      })
      const refs = options.storage.issueFileSyncPlanRefs(planId, {
        ...referenceContext,
        targetDisplayPath,
        targetNormalizedPath: activeLocation.normalizedPath,
        parentDisplayPath: win32.dirname(targetDisplayPath),
        parentNormalizedPath: win32.dirname(activeLocation.normalizedPath),
        ttlSeconds: 300,
      })
      const command = signIntakeCommand({
        protocolVersion: 'project-control.dsh/v1alpha1',
        schemaVersion: 'lifecycle-command-envelope/v1alpha1',
        commandId,
        correlationId: `intake:${planId}`,
        idempotencyKey: `intake.upgrade:${planId}`,
        kind: 'project.upgradeManaged',
        occurredAt: createdAt,
        actor: {
          kind: 'human',
          id: 'desktop-user',
          applicationId: 'deepseek-harness-personal',
          displayName: '桌面端用户',
        },
        target: { aggregateType: 'project', projectId },
        expectedRevision: project.revision,
        provenance: {
          sourceType: 'human',
          sourceId: 'project-console:intake-upgrade',
          applicationVersion: options.applicationVersion,
          applicationInstanceId: options.applicationInstanceId,
          observedAt: createdAt,
        },
        payload: {
          locationRef: activeLocation.locationId,
          locationRevision: activeLocation.revision,
          legacyFingerprintHash: fingerprintHash,
          writePlan: { planId, planHash, manifestHash, syncPolicy, operations },
        },
        extensions: {
          'cyrus.project-control.intake': { planId },
        },
      }, options.selectionSecret)
      return {
        projectId,
        name: project.name,
        targetDisplayPath,
        documentCount: bindings.length,
        fingerprintHash,
        expiresAt: refs.expiresAt,
        writePlan: { planId, planHash, manifestHash, syncPolicy, operations },
        command,
      }
    },

    getProjectDocuments(projectId: string) {
      requireRegisteredProject(options.storage, projectId)
      return options.storage.getProjectDocumentIndex(projectId)
    },

    async refreshProjectDocuments(projectId: string) {
      const project = requireRegisteredProject(options.storage, projectId)
      try {
        const payload = await refreshProjectDocumentIndex(options.storage, project)
        return options.storage.recordDocumentIndex(payload)
      } catch (error) {
        if (isPublicHttpError(error)) throw error
        throw publicDocumentIndexError(error)
      }
    },

    async acceptCurrentDocumentBindings(projectId: string, input: {
      expectedRevision: number
      bindings: Array<{
        role: ProjectDocumentBindingInput['role']
        relativePath: string
        expectedContentHash: string | null
        currentContentHash: string
      }>
    }) {
      const project = requireRegisteredProject(options.storage, projectId)
      if (project.mode !== 'linked_legacy') {
        throw projectControlHttpError(
          'MODE_CONFLICT',
          '只有已关联的旧项目可以接受当前文档哈希；受管理项目必须更新 manifest。',
          409,
        )
      }
      if (project.revision !== input.expectedRevision) {
        throw projectControlHttpError('REVISION_CONFLICT', '项目已经变化，请刷新后重试。', 409)
      }
      try {
        const documentIndex = await refreshProjectDocumentIndex(options.storage, project)
        const unsafeState = documentIndex.documentStates.find((state) => (
          state.state === 'missing'
          || state.state === 'unreadable'
          || state.parseIssues.some(issue => issue.severity === 'blocking')
        ))
        if (unsafeState !== undefined || documentIndex.rebindProposals.length > 0) {
          throw projectControlHttpError(
            'DOCUMENT_BINDING_STATE_CONFLICT',
            '文档存在缺失、不可读、阻断诊断或待处理重绑，不能接受当前哈希。',
            409,
          )
        }
        const changedStates = documentIndex.documentStates.filter(state => state.state === 'changed')
        const requestByIdentity = new Map(input.bindings.map(binding => [
          `${binding.role}\u0000${binding.relativePath}`,
          binding,
        ]))
        const registeredByIdentity = new Map((project.documentBindings ?? []).map(binding => [
          `${binding.role}\u0000${binding.relativePath}`,
          binding,
        ]))
        if (changedStates.length !== input.bindings.length) {
          throw projectControlHttpError(
            'DOCUMENT_BINDING_SET_CHANGED',
            '当前发生变化的文档集合与请求不一致，请刷新后重新确认。',
            409,
          )
        }
        for (const state of changedStates) {
          const identity = `${state.role}\u0000${state.relativePath}`
          const requested = requestByIdentity.get(identity)
          const registered = registeredByIdentity.get(identity)
          if (requested === undefined
            || registered === undefined
            || requested.expectedContentHash !== registered.contentHash
            || requested.currentContentHash !== state.contentHash) {
            throw projectControlHttpError(
              'DOCUMENT_BINDING_SET_CHANGED',
              '当前文档哈希或已登记哈希与请求不一致，请刷新后重新确认。',
              409,
            )
          }
        }
        return options.storage.acceptCurrentDocumentBindings(projectId, {
          expectedRevision: input.expectedRevision,
          bindings: input.bindings,
          documentIndex,
        })
      } catch (error) {
        if (isPublicHttpError(error)) throw error
        throw publicDocumentIndexError(error)
      }
    },

    resolveDocumentRebind(projectId: string, proposalId: string, input: {
      expectedRevision: number
      decision: 'accept' | 'reject'
      candidateRelativePath?: string
    }) {
      requireRegisteredProject(options.storage, projectId)
      try {
        return options.storage.resolveDocumentRebindProposal(projectId, proposalId, input)
      } catch (error) {
        if (isPublicHttpError(error)) throw error
        throw publicDocumentIndexError(error)
      }
    },

    listTemplates() {
      try {
        return listTemplateVersions()
      } catch (error) {
        throw publicCreateError(error)
      }
    },

    async prepareCreate(input: ProjectControlCreatePreparation) {
      authorizeCreateSelection(input, options.selectionSecret, consumedSelections)
      try {
        const template = loadTemplate(input.templateId, input.templateVersion)
        const parentDisplayPath = input.selection.path
        if (template.layout !== 'project-home') {
          throw new TemplateRegistryError('TEMPLATE_RETIRED', '旧单根模板只允许历史回放，不能用于新建项目。')
        }
        if (!sameWindowsPath(parentDisplayPath, projectHomeRoot)) {
          throw projectControlHttpError(
            'PROJECT_HOME_ROOT_REQUIRED',
            `新项目必须创建在统一项目根 ${projectHomeRoot}。`,
            409,
          )
        }
        if (!isProjectHomeSlug(input.directoryName)) {
          throw projectControlHttpError(
            'PROJECT_SLUG_INVALID',
            '项目目录名必须是稳定的 ASCII kebab-case slug。',
            409,
          )
        }
        const targetDisplayPath = win32.join(parentDisplayPath, input.directoryName)
        const workspaceDisplayPath = win32.join(targetDisplayPath, PROJECT_HOME_WORKSPACE_PATH)
        await requireEmptyTarget(targetDisplayPath)
        const projectId = idFactory('prj')
        const commandId = idFactory('cmd')
        const planId = idFactory('pln')
        const createdAt = now()
        const rendered = renderTemplate(template, {
          projectId,
          name: input.name,
          slug: input.directoryName,
          createdAt,
        })
        const operations: Array<
          | { kind: 'create_directory'; relativePath: string; expectedState: 'absent' }
          | { kind: 'create_file'; relativePath: string; expectedState: 'absent'; contentHash: string }
        > = template.files.map((entry) => entry.kind === 'directory'
          ? { kind: 'create_directory' as const, relativePath: entry.relativePath, expectedState: 'absent' as const }
          : {
              kind: 'create_file' as const,
              relativePath: entry.relativePath,
              expectedState: 'absent' as const,
              contentHash: sha256(rendered.contents.get(entry.relativePath)!),
            })
        const syncPolicy = 'atomic_create'
        const manifestHash = sha256(rendered.contents.get(PROJECT_HOME_MANIFEST_PATH)!)
        const planHash = computePlanHash({ manifestHash, syncPolicy, operations })
        const stagingDisplayPath = stagingRootForPlan({ syncPolicy, planId }, targetDisplayPath)
        options.storage.createFileSyncPlan({
          planId,
          commandId,
          kind: 'create_from_template',
          projectId,
          syncPolicy,
          targetDisplayPath,
          targetNormalizedPath: targetDisplayPath,
          stagingDisplayPath,
          planHash,
          manifestHash,
          operations,
          renderParams: {
            projectId,
            name: input.name,
            directoryName: input.directoryName,
            slug: input.directoryName,
            createdAt,
            templateId: template.templateId,
            templateVersion: template.templateVersion,
            templateLayout: template.layout,
            manifestPath: template.manifestPath,
            projectHomeRoot,
            workspaceDisplayPath,
          },
        })
        const refs = options.storage.issueFileSyncPlanRefs(planId, {
          ...referenceContext,
          targetDisplayPath,
          locationDisplayPath: workspaceDisplayPath,
          parentDisplayPath,
          ttlSeconds: 300,
        })
        const command = signIntakeCommand({
          protocolVersion: 'project-control.dsh/v1alpha1',
          schemaVersion: 'lifecycle-command-envelope/v1alpha1',
          commandId,
          correlationId: `intake:${planId}`,
          idempotencyKey: `intake.create:${planId}`,
          kind: 'project.createFromTemplate',
          occurredAt: createdAt,
          actor: {
            kind: 'human',
            id: 'desktop-user',
            applicationId: 'deepseek-harness-personal',
            displayName: '桌面端用户',
          },
          target: { aggregateType: 'project', projectId },
          expectedRevision: 0,
          provenance: {
            sourceType: 'human',
            sourceId: 'project-console:intake-create',
            applicationVersion: options.applicationVersion,
            applicationInstanceId: options.applicationInstanceId,
            observedAt: createdAt,
          },
          payload: {
            sourceRootRef: refs.sourceRootRef,
            targetLocationRef: refs.locationRef,
            directoryName: input.directoryName,
            name: input.name,
            template: {
              templateId: template.templateId,
              templateVersion: template.templateVersion,
              templateHash: template.templateHash,
            },
            writePlan: {
              planId,
              planHash,
              manifestHash,
              syncPolicy,
              operations,
            },
          },
          extensions: {
            'cyrus.project-control.intake': { planId },
          },
        }, options.selectionSecret)
        return {
          template: {
            templateId: template.templateId,
            templateVersion: template.templateVersion,
            displayName: template.displayName,
            templateHash: template.templateHash,
          },
          projectId,
          targetDisplayPath,
          directoryName: input.directoryName,
          expiresAt: refs.expiresAt,
          writePlan: { planId, planHash, manifestHash, syncPolicy, operations },
          command,
        }
      } catch (error) {
        consumedSelections.delete(input.selection.authorization.nonce)
        throw publicCreateError(error)
      }
    },
  }

  const referenceResolver: ProjectControlReferenceResolver = {
    authorizeStoredReplay(command): boolean {
      return (command.kind === 'project.registerLegacy'
        || command.kind === 'project.registerManaged'
        || command.kind === 'project.rebindLocation'
        || command.kind === 'project.createFromTemplate'
        || command.kind === 'project.upgradeManaged')
        && verifyIntakeCommandSignature(command, options.selectionSecret)
    },

    async resolveRegistration(command): Promise<ProjectRegistrationResolution | null> {
      if (command.kind !== 'project.registerLegacy' && command.kind !== 'project.registerManaged') return null
      if (!verifyIntakeCommandSignature(command, options.selectionSecret)) return null
      const payload = command.payload as Record<string, unknown>
      const candidateId = requireCommandCandidate(payload.candidateRef)
      const candidateRevision = commandCandidateRevision(command)
      const candidate = requireCandidate(options.storage, candidateId)
      requireLifecycleCandidateRevision(candidate, candidateRevision)
      if (candidate.status !== 'discovered') return null
      const fresh = await rescanCandidate(options.scanner, candidate)
      if (command.kind === 'project.registerLegacy') {
        if (fresh.detectedMode === 'managed'
          || !hostCommandMatches(command, {
            candidateId,
            candidateRevision,
            applicationInstanceId: options.applicationInstanceId,
            applicationVersion: options.applicationVersion,
            projectId: `prj_${candidateId.slice('can_'.length)}`,
            kind: 'project.registerLegacy',
            expectedRevision: 0,
          })) return null
        verifyCommandDocumentBindings(payload.documentBindings, fresh.documents)
        const pair = resolveReferencePair(options.storage, candidateId, payload, referenceContext)
        return {
          location: pair.location,
          candidateId,
          candidateRevision,
          origin: { kind: 'imported' },
        }
      }
      const manifest = requireManagedManifest(fresh)
      if (!hostCommandMatches(command, {
        candidateId,
        candidateRevision,
        applicationInstanceId: options.applicationInstanceId,
        applicationVersion: options.applicationVersion,
        projectId: manifest.projectId,
        kind: 'project.registerManaged',
        expectedRevision: 0,
        manifestHash: manifest.hash,
        manifestRelativePath: manifest.relativePath,
      }) || payload.manifestHash !== manifest.hash) return null
      const pair = resolveReferencePair(options.storage, candidateId, payload, referenceContext)
      return {
        location: pair.location,
        candidateId,
        candidateRevision,
        manifestName: manifest.name,
        manifestHash: manifest.hash,
        manifestDocumentBindings: manifest.documentBindings,
        origin: manifest.origin,
      }
    },

    async resolveRebind(command): Promise<ProjectRebindResolution | null> {
      if (command.kind !== 'project.rebindLocation') return null
      if (!verifyIntakeCommandSignature(command, options.selectionSecret)) return null
      const payload = command.payload as Record<string, unknown>
      const candidateId = commandCandidateIdFromExtensions(command)
      const candidateRevision = commandCandidateRevision(command)
      const candidate = requireCandidate(options.storage, candidateId)
      requireLifecycleCandidateRevision(candidate, candidateRevision)
      if (candidate.status !== 'relocation_candidate') return null
      const fresh = await rescanCandidate(options.scanner, candidate)
      const manifest = requireManagedManifest(fresh)
      const project = requireMatchedProject(options.storage, candidate)
      const expectedIdentityEvidence = rebindIdentityEvidence(project, fresh, manifest)
      if (expectedIdentityEvidence === null
        || !hostCommandMatches(command, {
        candidateId,
        candidateRevision,
        applicationInstanceId: options.applicationInstanceId,
        applicationVersion: options.applicationVersion,
        projectId: manifest.projectId,
        kind: 'project.rebindLocation',
        expectedRevision: project.revision,
        manifestHash: manifest.hash,
        manifestRelativePath: manifest.relativePath,
      })
        || !rebindIdentityEvidenceMatches(payload.identityEvidence, expectedIdentityEvidence)) return null
      const pair = resolveReferencePair(options.storage, candidateId, {
        locationRef: payload.newLocationRef,
        sourceRootRef: payload.sourceRootRef,
      }, referenceContext)
      return {
        newLocation: pair.location,
        candidateId,
        candidateRevision,
      }
    },

    async resolveCreate(command): Promise<ProjectCreateResolution | null> {
      if (command.kind !== 'project.createFromTemplate') return null
      if (!verifyIntakeCommandSignature(command, options.selectionSecret)) return null
      const payload = asObject(command.payload)
      const planId = planIdFromExtensions(command)
      let refs
      try {
        refs = options.storage.resolveFileSyncPlanRefs(
          planId,
          {
            locationRef: requireCommandRef(payload?.targetLocationRef, 'loc'),
            sourceRootRef: requireCommandRef(payload?.sourceRootRef, 'srt'),
          },
          referenceContext,
        )
      } catch {
        return null
      }
      const plan = options.storage.getFileSyncPlan(planId)
      if (plan === null
        || plan.kind !== 'create_from_template'
        || plan.commandId !== command.commandId
        || plan.projectId !== command.target.projectId
        || !['planned', 'rolled_back', 'files_committed'].includes(plan.state)
        || plan.renderParams === null) return null
      const renderParams = plan.renderParams as Record<string, string>
      if (!hostCreateCommandMatches(command, plan, {
        applicationInstanceId: options.applicationInstanceId,
        applicationVersion: options.applicationVersion,
      })) return null
      const templatePayload = asObject(payload?.template)
      if (templatePayload?.templateId !== renderParams.templateId
        || templatePayload?.templateVersion !== renderParams.templateVersion) return null
      const renderSlug = renderParams.slug
      const renderProjectHomeRoot = renderParams.projectHomeRoot
      const renderWorkspaceDisplayPath = renderParams.workspaceDisplayPath
      let template
      try {
        template = loadTemplate(renderParams.templateId ?? '', renderParams.templateVersion ?? '')
      } catch {
        return null
      }
      if (template.templateHash !== templatePayload?.templateHash) return null
      const isProjectHome = template.layout === 'project-home'
      if (isProjectHome && (typeof renderSlug !== 'string'
        || typeof renderProjectHomeRoot !== 'string'
        || typeof renderWorkspaceDisplayPath !== 'string'
        || renderParams.templateLayout !== 'project-home'
        || renderParams.manifestPath !== PROJECT_HOME_MANIFEST_PATH
        || renderSlug !== renderParams.directoryName
        || !isProjectHomeSlug(renderSlug)
        || !sameWindowsPath(renderProjectHomeRoot, projectHomeRoot)
        || !sameWindowsPath(plan.targetDisplayPath, win32.join(projectHomeRoot, renderSlug))
        || !sameWindowsPath(renderWorkspaceDisplayPath, win32.join(plan.targetDisplayPath, PROJECT_HOME_WORKSPACE_PATH))
        || !sameWindowsPath(refs.sourceRoot.displayPath, projectHomeRoot)
        || !sameWindowsPath(refs.location.displayPath, renderWorkspaceDisplayPath))) return null
      const writePlanPayload = asObject(payload?.writePlan)
      if (writePlanPayload?.planId !== planId
        || writePlanPayload?.manifestHash !== plan.manifestHash
        || writePlanPayload?.syncPolicy !== 'atomic_create') return null
      let operationsValid = false
      try {
        operationsValid = verifyWritePlanHashes({
          manifestHash: writePlanPayload.manifestHash,
          syncPolicy: 'atomic_create',
          operations: writePlanPayload.operations,
          planHash: writePlanPayload.planHash,
        })
      } catch {
        operationsValid = false
      }
      if (!operationsValid) return null
      let rendered
      try {
        rendered = renderTemplate(template, {
          projectId: plan.projectId,
          name: renderParams.name ?? '',
          ...(isProjectHome ? { slug: renderParams.slug ?? '' } : {}),
          createdAt: renderParams.createdAt ?? '',
        })
      } catch {
        return null
      }
      const manifestBytes = rendered.contents.get(template.manifestPath)
      const manifestHash = sha256(manifestBytes!)
      if (manifestHash !== plan.manifestHash) return null
      for (const operation of writePlanPayload.operations as Array<Record<string, unknown>>) {
        if (operation.kind !== 'create_file') continue
        const content = rendered.contents.get(String(operation.relativePath))
        if (content === undefined || sha256(content) !== operation.contentHash) return null
      }
      const manifestObject = rendered.manifestObject as {
        metadata: { name: string }
        spec: { documents: { entries: Array<{ role: string; path: string; required?: boolean }> } }
      }
      const manifestDocumentBindings: ProjectDocumentBindingInput[] = manifestObject.spec.documents.entries
        .map(entry => ({
          role: entry.role as ProjectDocumentBindingInput['role'],
          relativePath: entry.path,
          contentHash: null,
          required: entry.required === true,
        }))
      return {
        plan,
        refs,
        template: {
          templateId: template.templateId,
          templateVersion: template.templateVersion,
          templateHash: template.templateHash,
        },
        contents: rendered.contents,
        manifestName: manifestObject.metadata.name,
        manifestHash,
        manifestDocumentBindings,
      }
    },

    async resolveUpgrade(command): Promise<ProjectUpgradeResolution | null> {
      if (command.kind !== 'project.upgradeManaged') return null
      if (!verifyIntakeCommandSignature(command, options.selectionSecret)) return null
      const payload = asObject(command.payload)
      const planId = planIdFromExtensions(command)
      const plan = options.storage.getFileSyncPlan(planId)
      if (plan === null
        || plan.kind !== 'upgrade_managed'
        || plan.commandId !== command.commandId
        || plan.projectId !== command.target.projectId
        || !['planned', 'rolled_back', 'files_committed'].includes(plan.state)
        || plan.renderParams === null) return null
      const renderParams = plan.renderParams as Record<string, any>
      if (!hostUpgradeCommandMatches(command, plan, renderParams, {
        applicationInstanceId: options.applicationInstanceId,
        applicationVersion: options.applicationVersion,
      })) return null
      const writePlanPayload = asObject(payload?.writePlan)
      if (writePlanPayload?.planId !== planId
        || writePlanPayload?.manifestHash !== plan.manifestHash
        || writePlanPayload?.syncPolicy !== 'atomic_additive') return null
      try {
        verifyWritePlanHashes({
          manifestHash: plan.manifestHash,
          syncPolicy: 'atomic_additive',
          operations: writePlanPayload.operations,
          planHash: writePlanPayload.planHash,
        })
      } catch {
        return null
      }
      const project = options.storage.getProject(plan.projectId)
      if (project === null || project.mode !== 'linked_legacy') return null
      if (project.revision !== renderParams.expectedRevision) {
        throw new FileSyncPlanError('WRITE_PLAN_STALE', '项目在准备后发生了变化，请刷新后重新准备升级。', {
          currentRevision: project.revision,
        })
      }
      const bindings = (project.documentBindings ?? [])
        .map(binding => ({ role: binding.role, relativePath: binding.relativePath, contentHash: binding.contentHash }))
        .sort((left, right) => {
          const leftKey = `${left.role}\u0000${left.relativePath}`
          const rightKey = `${right.role}\u0000${right.relativePath}`
          return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0
        })
      const fingerprintHash = sha256(Buffer.from(canonicalJson({
        projectId: plan.projectId,
        documentBindings: bindings,
      }), 'utf8'))
      if (fingerprintHash !== payload?.legacyFingerprintHash || fingerprintHash !== renderParams.fingerprintHash) {
        throw new FileSyncPlanError('WRITE_PLAN_STALE', '项目文档绑定在准备后发生了变化，请刷新后重新准备升级。', {
          currentRevision: project.revision,
        })
      }
      const activeLocation = project.workspaceLocations?.find(location => location.isActive)
      if (activeLocation === undefined) return null
      for (const binding of bindings) {
        let bytes: Buffer
        try {
          bytes = await readFile(win32.join(activeLocation.displayPath, ...binding.relativePath.split('/')))
        } catch {
          throw new FileSyncPlanError('WRITE_PLAN_STALE', '至少一份项目文档当前无法读取，请刷新后重新准备升级。', {
            currentRevision: project.revision,
          })
        }
        if (sha256(bytes) !== binding.contentHash) {
          throw new FileSyncPlanError('WRITE_PLAN_STALE', '至少一份项目文档在准备后发生了变化，请刷新后重新准备升级。', {
            currentRevision: project.revision,
          })
        }
      }
      const manifestYaml = buildUpgradeManifestYaml({
        projectId: plan.projectId,
        name: renderParams.name,
        createdAt: renderParams.createdAt,
        documentBindings: renderParams.documentBindings,
      })
      const manifestBytes = Buffer.from(manifestYaml, 'utf8')
      if (sha256(manifestBytes) !== plan.manifestHash) return null
      let refs
      try {
        refs = options.storage.resolveUpgradePlanRefs(
          planId,
          { locationRef: requireCommandRef(payload?.locationRef, 'loc') },
          referenceContext,
        )
      } catch {
        return null
      }
      return {
        plan,
        refs,
        contents: new Map([['.dsh-project/project.yaml', manifestBytes]]),
        manifestName: renderParams.name,
        manifestHash: plan.manifestHash,
        fingerprintHash,
      }
    },
  }

  return { intake, referenceResolver }
}

function buildUpgradeManifestYaml(options: {
  projectId: string
  name: string
  createdAt: string
  documentBindings: ReadonlyArray<{ role: string; relativePath: string; required: boolean }>
}): string {
  const lines = [
    'apiVersion: project-control.dsh/v1alpha1',
    'kind: ProjectManifest',
    'metadata:',
    `  projectId: ${options.projectId}`,
    `  name: ${JSON.stringify(options.name)}`,
    `  createdAt: ${options.createdAt}`,
    '  createdBy:',
    '    kind: human',
    '    id: cyrus',
    '  origin:',
    '    kind: imported',
    'spec:',
    '  documents:',
    '    docsRoot: .',
    ...(options.documentBindings.length === 0
      ? ['    entries: []']
      : [
          '    entries:',
          ...options.documentBindings.flatMap(binding => [
            `      - role: ${binding.role}`,
            `        path: ${binding.relativePath}`,
            ...(binding.required ? ['        required: true'] : []),
          ]),
        ]),
    '    standardOutputs:',
    '      updatesRoot: .dsh-project/updates',
    '      decisionsRoot: .dsh-project/decisions',
    '      artifactsRoot: .dsh-project/artifacts',
  ]
  return `${lines.join('\n')}\n`
}

function hostUpgradeCommandMatches(
  command: unknown,
  plan: Readonly<{ planId: string; commandId: string; projectId: string }>,
  renderParams: Record<string, any>,
  expected: { applicationInstanceId: string; applicationVersion: string },
): boolean {
  const commandObject = asObject(command)
  if (commandObject === null) return false
  const actor = asObject(commandObject.actor)
  const provenance = asObject(commandObject.provenance)
  const target = asObject(commandObject.target)
  const payload = asObject(commandObject.payload)
  return commandObject.commandId === plan.commandId
    && commandObject.correlationId === `intake:${plan.planId}`
    && commandObject.idempotencyKey === `intake.upgrade:${plan.planId}`
    && commandObject.kind === 'project.upgradeManaged'
    && commandObject.expectedRevision === renderParams.expectedRevision
    && actor?.kind === 'human'
    && actor.id === 'desktop-user'
    && actor.applicationId === 'deepseek-harness-personal'
    && target?.aggregateType === 'project'
    && target.projectId === plan.projectId
    && provenance?.applicationInstanceId === expected.applicationInstanceId
    && provenance.applicationVersion === expected.applicationVersion
    && provenance.sourceType === 'human'
    && provenance.sourceId === 'project-console:intake-upgrade'
    && payload?.locationRef === renderParams.locationRef
    && payload?.locationRevision === renderParams.locationRevision
    && payload?.legacyFingerprintHash === renderParams.fingerprintHash
}

function sha256(bytes: Buffer): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`
}

function authorizeCreateSelection(
  input: ProjectControlCreatePreparation,
  secret: string,
  consumed: Map<string, number>,
): void {
  const nowMs = Date.now()
  for (const [nonce, expiresAt] of consumed) {
    if (expiresAt < nowMs) consumed.delete(nonce)
  }
  if (consumed.has(input.selection.authorization.nonce)
    || !verifyProjectControlSelectionTicket({
      kind: 'create-parent',
      path: input.selection.path,
      authorization: input.selection.authorization,
      secret,
      nowMs,
    })) {
    throw projectControlHttpError(
      'DIRECTORY_SELECTION_REQUIRED',
      '请重新使用系统目录选择器选择新建项目的父目录。',
      403,
    )
  }
  consumed.set(input.selection.authorization.nonce, Date.parse(input.selection.authorization.expiresAt))
}

async function requireEmptyTarget(targetDisplayPath: string): Promise<void> {
  let info
  try {
    info = await stat(targetDisplayPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return
    throw error
  }
  if (!info.isDirectory()) {
    throw projectControlHttpError('TARGET_NOT_EMPTY', '目标路径已被非目录内容占用。', 409)
  }
  const entries = await readdir(targetDisplayPath)
  if (entries.length > 0) {
    throw projectControlHttpError('TARGET_NOT_EMPTY', '目标目录已存在且非空，请选择其他名称或空目录。', 409)
  }
}

function hostCreateCommandMatches(
  command: unknown,
  plan: Readonly<{
    planId: string
    commandId: string
    projectId: string
    renderParams: Record<string, any> | null
  }>,
  expected: { applicationInstanceId: string; applicationVersion: string },
): boolean {
  const commandObject = asObject(command)
  if (commandObject === null || plan.renderParams === null) return false
  const actor = asObject(commandObject.actor)
  const provenance = asObject(commandObject.provenance)
  const target = asObject(commandObject.target)
  const payload = asObject(commandObject.payload)
  return commandObject.commandId === plan.commandId
    && commandObject.correlationId === `intake:${plan.planId}`
    && commandObject.idempotencyKey === `intake.create:${plan.planId}`
    && commandObject.kind === 'project.createFromTemplate'
    && commandObject.expectedRevision === 0
    && actor?.kind === 'human'
    && actor.id === 'desktop-user'
    && actor.applicationId === 'deepseek-harness-personal'
    && target?.aggregateType === 'project'
    && target.projectId === plan.projectId
    && provenance?.applicationInstanceId === expected.applicationInstanceId
    && provenance.applicationVersion === expected.applicationVersion
    && provenance.sourceType === 'human'
    && provenance.sourceId === 'project-console:intake-create'
    && payload?.directoryName === plan.renderParams.directoryName
    && payload?.name === plan.renderParams.name
}

function planIdFromExtensions(command: unknown): string {
  const commandObject = asObject(command)
  const extensions = asObject(commandObject?.extensions)
  const intake = asObject(extensions?.['cyrus.project-control.intake'])
  const planId = typeof intake?.planId === 'string'
    ? intake.planId
    : `pln_${String(commandObject?.commandId ?? '').slice('cmd_'.length)}`
  if (!/^pln_[0-9a-f-]{36}$/u.test(planId)) {
    throw projectControlHttpError('REFERENCE_UNRESOLVED', '写入计划引用无法解析。', 409)
  }
  return planId
}

function publicCreateError(error: unknown): unknown {
  if (isPublicHttpError(error)) return error
  if (error instanceof TemplateRegistryError) {
    if (error.code === 'TEMPLATE_NOT_FOUND') {
      return projectControlHttpError('TEMPLATE_NOT_FOUND', '所选模板不存在或不可用。', 404)
    }
    return projectControlHttpError('TEMPLATE_UNAVAILABLE', '所选模板当前不可用。', 409)
  }
  const details = error instanceof Error
    ? (error as Error & { details?: unknown }).details
    : undefined
  const reason = asObject(details)?.reason
  switch (reason) {
    case 'plan_id_conflict':
      return projectControlHttpError('PLAN_CONFLICT', '写入计划已存在，请重新准备。', 409)
    case 'plan_not_issuable':
    case 'plan_not_found':
    case 'plan_kind_mismatch':
    case 'target_outside_parent':
      return projectControlHttpError('PLAN_PREPARE_FAILED', '写入计划无法签发，请重新选择父目录。', 409)
    default:
      return projectControlHttpError('INTAKE_OPERATION_FAILED', '新建项目准备失败。', 409)
  }
}

function authorizeSelection(
  input: ProjectControlIntakeScanRequest,
  secret: string,
  consumed: Map<string, number>,
): void {
  const nowMs = Date.now()
  for (const [nonce, expiresAt] of consumed) {
    if (expiresAt < nowMs) consumed.delete(nonce)
  }
  if (consumed.has(input.selection.authorization.nonce)
    || !verifyProjectControlSelectionTicket({
      kind: input.mode,
      path: input.selection.path,
      authorization: input.selection.authorization,
      secret,
      nowMs,
    })) {
    throw projectControlHttpError(
      'DIRECTORY_SELECTION_REQUIRED',
      '请重新使用系统目录选择器选择要扫描的目录。',
      403,
    )
  }
  consumed.set(input.selection.authorization.nonce, Date.parse(input.selection.authorization.expiresAt))
}

async function annotateKnownProjects(
  scan: RecordImportScanInput,
  storage: Readonly<ProjectControlStorage>,
): Promise<RecordImportScanInput> {
  return {
    ...scan,
    candidates: await Promise.all(scan.candidates.map(candidate => annotateKnownProject(candidate, storage))),
  }
}

async function annotateKnownProject(
  candidate: ImportCandidateInput,
  storage: Readonly<ProjectControlStorage>,
): Promise<ImportCandidateInput> {
  if (candidate.manifestProjectId === null || candidate.manifestProjectId === undefined) return candidate
  const project = storage.getProject(candidate.manifestProjectId)
  if (project === null) return candidate
  const activeLocations = project.workspaceLocations?.filter(location => location.isActive) ?? []
  const sameLocation = activeLocations.some(location => (
    location.isActive && sameWindowsPath(location.normalizedPath, candidate.root.normalizedPath ?? candidate.root.displayPath)
  ))
  const oldLocationAccessible = !sameLocation
    && (await Promise.all(activeLocations.map(location => isAccessibleDirectory(location.displayPath)))).some(Boolean)
  const isRelocation = !sameLocation && !oldLocationAccessible && activeLocations.length > 0
  return {
    ...candidate,
    status: isRelocation ? 'relocation_candidate' : 'conflict',
    issues: [
      ...candidate.issues,
      {
        code: sameLocation
          ? 'PROJECT_ALREADY_REGISTERED'
          : oldLocationAccessible ? 'DUPLICATE_MANAGED_PROJECT' : 'PROJECT_LOCATION_CHANGED',
        severity: isRelocation ? 'info' : 'blocking',
        details: {
          message: sameLocation
            ? '这个受管理项目已经登记在相同位置。'
            : oldLocationAccessible
              ? '检测到同一受管理项目的两个可访问位置；请先确认哪一份是主项目。'
              : '检测到同一受管理项目的新位置；确认后将重新绑定。',
        },
      },
    ],
  }
}

async function rescanCandidate(
  scanner: ProjectControlScanner,
  candidate: Readonly<ImportCandidateView>,
): Promise<ImportCandidateInput> {
  let scan: RecordImportScanInput
  try {
    scan = requireScanEnvelope(await scanner.scanProjectDirectory(candidate.root.displayPath))
  } catch (error) {
    throw projectControlHttpError(
      'CANDIDATE_RESCAN_FAILED',
      '项目文件当前无法重新核对；没有执行登记。',
      409,
    )
  }
  const fresh = scan.candidates[0]
  if (scan.mode !== 'single_project'
    || fresh === undefined
    || scan.candidates.length !== 1
    || !sameWindowsPath(fresh.root.normalizedPath ?? fresh.root.displayPath, candidate.root.normalizedPath)) {
    throw projectControlHttpError('CANDIDATE_CHANGED', '项目目录身份已经变化，请重新扫描。', 409)
  }
  return fresh
}

function verifyPreparation(
  persisted: Readonly<ImportCandidateView>,
  fresh: ImportCandidateInput,
  input: ProjectControlCandidatePreparation,
): void {
  const managed = fresh.detectedMode === 'managed'
  if ((input.registrationMode === 'managed') !== managed) {
    throw projectControlHttpError('MODE_CONFLICT', '项目模式与最新扫描结果不一致，请重新扫描。', 409)
  }
  if (persisted.detectedMode !== fresh.detectedMode) {
    throw projectControlHttpError('CANDIDATE_CHANGED', '项目识别结果已经变化，请重新扫描。', 409)
  }
  if (managed) {
    const manifest = requireManagedManifest(fresh)
    if (input.documentBindings.length !== 0) {
      throw projectControlHttpError(
        'MANAGED_BINDINGS_LOCKED',
        '受管理项目的文档映射由 manifest 锁定，不能在候选确认时重映射。',
        409,
      )
    }
    if (persisted.manifestProjectId !== manifest.projectId) {
      throw projectControlHttpError('MANIFEST_CHANGED', '项目 manifest 身份已经变化，请重新扫描。', 409)
    }
    return
  }
  verifyCommandDocumentBindings(input.documentBindings, fresh.documents)
}

function verifyCommandDocumentBindings(value: unknown, freshDocuments: ImportCandidateInput['documents']): void {
  if (!Array.isArray(value)) {
    throw projectControlHttpError('DOCUMENT_MAPPING_INVALID', '文档映射无效。', 409)
  }
  const freshByPath = new Map(freshDocuments.map(document => [document.relativePath, document]))
  for (const raw of value) {
    const binding = asObject(raw)
    const relativePath = typeof binding?.relativePath === 'string' ? binding.relativePath : ''
    const contentHash = typeof binding?.contentHash === 'string' ? binding.contentHash : ''
    const fresh = freshByPath.get(relativePath)
    if (fresh === undefined || fresh.sha256 !== contentHash) {
      throw projectControlHttpError(
        'DOCUMENT_CHANGED',
        '至少一份已选择文档在确认前发生了变化，请重新扫描。',
        409,
      )
    }
  }
}

function buildLifecycleCommand(options: {
  candidate: Readonly<ImportCandidateView>
  fresh: ImportCandidateInput
  input: ProjectControlCandidatePreparation
  refs: { candidateRef: string; locationRef: string; sourceRootRef: string }
  applicationInstanceId: string
  applicationVersion: string
  occurredAt: string
  project: Readonly<ProjectView> | null
}): Record<string, unknown> {
  const suffix = options.candidate.candidateId.slice('can_'.length)
  const isRelocation = options.project !== null
  const manifest = options.fresh.detectedMode === 'managed'
    ? requireManagedManifest(options.fresh)
    : null
  const projectId = isRelocation
    ? options.project!.projectId
    : manifest?.projectId ?? `prj_${suffix}`
  const common = {
    protocolVersion: 'project-control.dsh/v1alpha1',
    schemaVersion: 'lifecycle-command-envelope/v1alpha1',
    commandId: `cmd_${suffix}`,
    correlationId: `intake:${options.candidate.candidateId}`,
    idempotencyKey: `intake.register:${options.candidate.candidateId}:r${String(options.input.expectedRevision)}`,
    occurredAt: options.occurredAt,
    actor: {
      kind: 'human',
      id: 'desktop-user',
      applicationId: 'deepseek-harness-personal',
      displayName: '桌面端用户',
    },
    target: { aggregateType: 'project', projectId },
    provenance: {
      sourceType: manifest === null ? 'human' : 'imported_document',
      sourceId: manifest === null
        ? 'project-console:intake-confirmation'
        : `manifest:${manifest.relativePath}`,
      applicationVersion: options.applicationVersion,
      applicationInstanceId: options.applicationInstanceId,
      ...(manifest === null ? {} : { contentHash: manifest.hash }),
      observedAt: options.occurredAt,
    },
    extensions: {
      'cyrus.project-control.intake': {
        candidateId: options.candidate.candidateId,
        candidateRevision: options.input.expectedRevision,
      },
    },
  }
  if (isRelocation) {
    if (manifest === null || options.project === null) {
      throw projectControlHttpError('IDENTITY_EVIDENCE_REQUIRED', '新位置必须提供可验证的受管理项目 manifest。', 409)
    }
    const activeLocation = options.project.workspaceLocations?.find(location => location.isActive)
    if (activeLocation === undefined) {
      throw projectControlHttpError('REFERENCE_UNRESOLVED', '项目当前没有可核对的活动位置。', 409)
    }
    const identityEvidence = rebindIdentityEvidence(options.project, options.fresh, manifest)
    if (identityEvidence === null) {
      throw projectControlHttpError(
        'IDENTITY_EVIDENCE_REQUIRED',
        '新位置没有任何文档与已登记项目的内容哈希一致，不能自动重新绑定。',
        409,
      )
    }
    return {
      ...common,
      kind: 'project.rebindLocation',
      expectedRevision: options.project.revision,
      payload: {
        expectedMode: options.project.mode,
        currentLocationRef: activeLocation.locationId,
        currentLocationRevision: activeLocation.revision,
        newLocationRef: options.refs.locationRef,
        sourceRootRef: options.refs.sourceRootRef,
        reason: 'moved',
        identityEvidence,
      },
    }
  }
  if (manifest !== null) {
    return {
      ...common,
      kind: 'project.registerManaged',
      expectedRevision: 0,
      payload: {
        locationRef: options.refs.locationRef,
        sourceRootRef: options.refs.sourceRootRef,
        candidateRef: options.refs.candidateRef,
        manifestHash: manifest.hash,
      },
    }
  }
  return {
    ...common,
    kind: 'project.registerLegacy',
    expectedRevision: 0,
    payload: {
      locationRef: options.refs.locationRef,
      sourceRootRef: options.refs.sourceRootRef,
      candidateRef: options.refs.candidateRef,
      name: options.input.name,
      documentBindings: options.input.documentBindings,
    },
  }
}

type RebindIdentityEvidence =
  | { kind: 'managed_manifest'; manifestHash: string }
  | { kind: 'legacy_fingerprint'; fingerprintHash: string; contentHashes: string[] }

function rebindIdentityEvidence(
  project: Readonly<ProjectView>,
  fresh: ImportCandidateInput,
  manifest: ManagedManifest,
): RebindIdentityEvidence | null {
  if (project.mode === 'managed') {
    return { kind: 'managed_manifest', manifestHash: manifest.hash }
  }
  const bindings = (project.documentBindings ?? [])
    .map(binding => ({
      role: binding.role,
      relativePath: binding.relativePath,
      contentHash: binding.contentHash,
    }))
    .sort((left, right) => {
      const leftKey = `${left.role}\u0000${left.relativePath}`
      const rightKey = `${right.role}\u0000${right.relativePath}`
      return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0
    })
  const freshHashes = new Set(fresh.documents.flatMap(document => (
    typeof document.sha256 === 'string' ? [document.sha256] : []
  )))
  const contentHashes = [...new Set(bindings.flatMap(binding => (
    typeof binding.contentHash === 'string' && freshHashes.has(binding.contentHash)
      ? [binding.contentHash]
      : []
  )))].sort().slice(0, 50)
  if (contentHashes.length === 0) return null
  return {
    kind: 'legacy_fingerprint',
    fingerprintHash: sha256(Buffer.from(canonicalJson({
      projectId: project.projectId,
      documentBindings: bindings,
    }), 'utf8')),
    contentHashes,
  }
}

function rebindIdentityEvidenceMatches(value: unknown, expected: RebindIdentityEvidence): boolean {
  const actual = asObject(value)
  if (actual?.kind !== expected.kind) return false
  if (expected.kind === 'managed_manifest') return actual.manifestHash === expected.manifestHash
  return actual.fingerprintHash === expected.fingerprintHash
    && Array.isArray(actual.contentHashes)
    && actual.contentHashes.length === expected.contentHashes.length
    && actual.contentHashes.every((hash, index) => hash === expected.contentHashes[index])
}

interface ManagedManifest {
  projectId: string
  hash: string
  name: string
  relativePath: string
  documentBindings: ProjectDocumentBindingInput[]
  origin: {
    kind: 'imported' | 'template' | 'fork'
    templateId?: string
    templateVersion?: string
    forkedFromProjectId?: string
  }
}

function requireManagedManifest(candidate: ImportCandidateInput): ManagedManifest {
  const candidateObject = asObject(candidate)
  const confidence = asObject(candidate.confidence)
  const manifest = asObject(confidence?.manifest)
  const projectId = typeof manifest?.projectId === 'string'
    ? manifest.projectId
    : candidate.manifestProjectId
  const hash = typeof manifest?.hash === 'string'
    ? manifest.hash
    : typeof manifest?.manifestHash === 'string'
      ? manifest.manifestHash
      : typeof candidateObject?.manifestHash === 'string' ? candidateObject.manifestHash : undefined
  const name = typeof manifest?.name === 'string'
    ? manifest.name
    : typeof candidateObject?.manifestName === 'string'
      ? candidateObject.manifestName
      : candidate.suggestedName
  const relativePath = typeof manifest?.relativePath === 'string'
    ? manifest.relativePath
    : '.dsh-project/project.json'
  const manifestBindings = Array.isArray(manifest?.documentBindings)
    ? manifest.documentBindings
    : Array.isArray(candidateObject?.manifestDocumentBindings)
      ? candidateObject.manifestDocumentBindings
      : []
  const bindings: ProjectDocumentBindingInput[] = manifestBindings.length > 0
    ? manifestBindings.map((raw, index): ProjectDocumentBindingInput => {
        const binding = asObject(raw)
        const required = binding?.required === true
        const contentHash = typeof binding?.contentHash === 'string'
          ? binding.contentHash
          : binding?.contentHash === null ? null : undefined
        if (typeof binding?.role !== 'string'
          || !DOCUMENT_ROLES.has(binding.role)
          || typeof binding.relativePath !== 'string'
          || (binding.required !== undefined && typeof binding.required !== 'boolean')
          || (typeof contentHash === 'string' && !/^sha256:[0-9a-f]{64}$/u.test(contentHash))) {
          throw projectControlHttpError(
            'MANIFEST_INVALID',
            `受管理项目 manifest 的第 ${String(index + 1)} 个文档映射无效。`,
            409,
          )
        }
        if (contentHash === undefined || contentHash === null) {
          if (required) {
            throw projectControlHttpError(
              'MANIFEST_REQUIRED_DOCUMENT_UNAVAILABLE',
              `受管理项目 manifest 的必需文档 ${binding.relativePath} 当前不可用。`,
              409,
            )
          }
          // The frozen manifest contract permits an unavailable optional
          // entry. Storage keeps that declaration with a null hash; request
          // mappings remain stricter because legacy user-selected files must
          // always have a verified hash.
          return {
            role: binding.role as ProjectDocumentBindingInput['role'],
            relativePath: binding.relativePath,
            contentHash: null,
            ...(binding.required === undefined ? {} : { required: binding.required }),
          }
        }
        return {
          role: binding.role as ProjectDocumentBindingInput['role'],
          relativePath: binding.relativePath,
          contentHash,
          ...(binding.required === undefined ? {} : { required: binding.required }),
        }
      })
    : []
  if (typeof projectId !== 'string'
    || !/^prj_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(projectId)
    || typeof hash !== 'string'
    || !/^sha256:[0-9a-f]{64}$/u.test(hash)
    || typeof name !== 'string'
    || name.trim() === '') {
    throw projectControlHttpError('MANIFEST_INVALID', '受管理项目 manifest 缺少可验证身份。', 409)
  }
  const originValue = asObject(manifest?.origin ?? candidateObject?.manifestOrigin)
  const originKind = originValue?.kind
  const origin: ManagedManifest['origin'] = originKind === 'template' || originKind === 'fork'
    ? {
        kind: originKind,
        ...(typeof originValue?.templateId === 'string' ? { templateId: originValue.templateId } : {}),
        ...(typeof originValue?.templateVersion === 'string'
          ? { templateVersion: originValue.templateVersion }
          : {}),
        ...(typeof originValue?.forkedFromProjectId === 'string'
          ? { forkedFromProjectId: originValue.forkedFromProjectId }
          : {}),
      }
    : { kind: 'imported' }
  return {
    projectId,
    hash,
    name,
    relativePath,
    documentBindings: bindings,
    origin,
  }
}

function requireRegisteredProject(
  storage: Readonly<ProjectControlStorage>,
  projectId: string,
): Readonly<ProjectView> {
  if (!/^prj_[0-9a-f-]{36}$/u.test(projectId)) {
    throw projectControlHttpError('PROJECT_NOT_FOUND', '项目不存在。', 404)
  }
  const project = storage.getProject(projectId)
  if (project === null) {
    throw projectControlHttpError('PROJECT_NOT_FOUND', '项目不存在。', 404)
  }
  return project
}

function publicDocumentIndexError(error: unknown): unknown {
  if (isPublicHttpError(error)) return error
  const details = error instanceof Error
    ? (error as Error & { details?: unknown }).details
    : undefined
  const reason = asObject(details)?.reason
  switch (reason) {
    case 'project_not_found':
      return projectControlHttpError('PROJECT_NOT_FOUND', '项目不存在。', 404)
    case 'proposal_not_found':
      return projectControlHttpError('REBIND_PROPOSAL_NOT_FOUND', '重绑提案不存在。', 404)
    case 'proposal_not_proposed':
      return projectControlHttpError('REBIND_PROPOSAL_NOT_OPEN', '重绑提案已处理，请刷新。', 409)
    case 'proposal_changed':
      return projectControlHttpError('REBIND_PROPOSAL_CHANGED', '重绑提案已经变化，请刷新后重新确认。', 409)
    case 'proposal_candidate_mismatch':
    case 'proposal_candidate_invalid':
      return projectControlHttpError('REBIND_CANDIDATE_INVALID', '选择的重绑目标与提案不符。', 409)
    case 'proposal_candidate_required':
      return projectControlHttpError('REBIND_AMBIGUOUS', '重绑目标有歧义，必须人工选择其中一个路径。', 409)
    case 'managed_manifest_authoritative':
      return projectControlHttpError('MANAGED_MANIFEST_AUTHORITATIVE', '受管理项目的文档映射以 manifest 为准，请先更新 manifest。', 409)
    case 'binding_not_found':
      return projectControlHttpError('REBIND_BINDING_MISSING', '原文档绑定已不存在，请刷新。', 409)
    case 'binding_conflict':
      return projectControlHttpError('REBIND_BINDING_CONFLICT', '重绑目标已经是已绑定文档路径。', 409)
    case 'revision_conflict':
      return projectControlHttpError('REVISION_CONFLICT', '项目已经变化，请刷新后重试。', 409)
    case 'binding_hash_conflict':
    case 'binding_acceptance_set_mismatch':
      return projectControlHttpError('DOCUMENT_BINDING_SET_CHANGED', '当前文档绑定或哈希已经变化，请刷新后重新确认。', 409)
    case 'mode_conflict':
      return projectControlHttpError('MODE_CONFLICT', '只有已关联的旧项目可以接受当前文档哈希。', 409)
    default:
      return projectControlHttpError('DOCUMENT_INDEX_OPERATION_FAILED', '文档索引操作失败。', 409)
  }
}

function requireCandidate(
  storage: Readonly<ProjectControlStorage>,
  candidateId: string,
): Readonly<ImportCandidateView> {
  const candidate = storage.getImportCandidate(candidateId)
  if (candidate === null) throw projectControlHttpError('CANDIDATE_NOT_FOUND', '项目候选不存在。', 404)
  return candidate
}

function requireCandidateRevision(candidate: Readonly<ImportCandidateView>, revision: number): void {
  if (candidate.revision !== revision) {
    throw projectControlHttpError('CANDIDATE_REVISION_CONFLICT', '候选已经变化，请刷新后重新确认。', 409)
  }
}

function requireLifecycleCandidateRevision(
  candidate: Readonly<ImportCandidateView>,
  revision: number,
): void {
  if (candidate.revision !== revision) {
    throw projectControlHttpError('REVISION_CONFLICT', '候选已经变化，请刷新后重新确认。', 409)
  }
}

function requireMatchedProject(
  storage: Readonly<ProjectControlStorage>,
  candidate: Readonly<ImportCandidateView>,
): Readonly<ProjectView> {
  const project = candidate.manifestProjectId === null
    ? null
    : storage.getProject(candidate.manifestProjectId)
  if (project === null) {
    throw projectControlHttpError('REFERENCE_UNRESOLVED', '找不到候选对应的已登记项目。', 409)
  }
  return project
}

function requireCommandCandidate(value: unknown): string {
  if (typeof value !== 'string' || !/^can_[0-9a-f-]{36}$/u.test(value)) {
    throw projectControlHttpError('REFERENCE_UNRESOLVED', '项目候选引用无法解析。', 409)
  }
  return value
}

function requireCommandRef(value: unknown, prefix: 'loc' | 'srt'): string {
  if (typeof value !== 'string' || !new RegExp(`^${prefix}_[0-9a-f-]{36}$`, 'u').test(value)) {
    throw projectControlHttpError('REFERENCE_UNRESOLVED', '项目位置引用无法解析。', 409)
  }
  return value
}

function resolveReferencePair(
  storage: Readonly<ProjectControlStorage>,
  candidateId: string,
  payload: Record<string, unknown>,
  referenceContext: { applicationInstanceId: string; scope: typeof REFERENCE_SCOPE },
) {
  try {
    return storage.resolveRegistrationRefs(
      candidateId,
      {
        locationRef: requireCommandRef(payload.locationRef, 'loc'),
        sourceRootRef: requireCommandRef(payload.sourceRootRef, 'srt'),
      },
      referenceContext,
    )
  } catch {
    throw projectControlHttpError('REFERENCE_UNRESOLVED', '项目位置引用已失效，请重新确认候选。', 409)
  }
}

function hostCommandMatches(
  command: unknown,
  expected: {
    candidateId: string
    candidateRevision: number
    applicationInstanceId: string
    applicationVersion: string
    projectId: string
    kind: 'project.registerLegacy' | 'project.registerManaged' | 'project.rebindLocation'
    expectedRevision: number
    manifestHash?: string
    manifestRelativePath?: string
  },
): boolean {
  const commandObject = asObject(command)
  if (commandObject === null) return false
  const suffix = expected.candidateId.slice('can_'.length)
  const actor = asObject(commandObject.actor)
  const provenance = asObject(commandObject.provenance)
  const target = asObject(commandObject.target)
  return commandObject.commandId === `cmd_${suffix}`
    && commandObject.correlationId === `intake:${expected.candidateId}`
    && commandObject.idempotencyKey === `intake.register:${expected.candidateId}:r${String(expected.candidateRevision)}`
    && commandObject.kind === expected.kind
    && commandObject.expectedRevision === expected.expectedRevision
    && actor?.kind === 'human'
    && actor.id === 'desktop-user'
    && actor.applicationId === 'deepseek-harness-personal'
    && target?.aggregateType === 'project'
    && target.projectId === expected.projectId
    && provenance?.applicationInstanceId === expected.applicationInstanceId
    && provenance.applicationVersion === expected.applicationVersion
    && provenance.sourceType === (expected.manifestHash === undefined ? 'human' : 'imported_document')
    && provenance.sourceId === (expected.manifestRelativePath === undefined
      ? 'project-console:intake-confirmation'
      : `manifest:${expected.manifestRelativePath}`)
    && (expected.manifestHash === undefined || provenance.contentHash === expected.manifestHash)
    && commandCandidateRevision(command) === expected.candidateRevision
    && commandCandidateIdFromExtensions(command) === expected.candidateId
}

function signIntakeCommand(command: Record<string, unknown>, secret: string): Record<string, unknown> {
  const extensions = asObject(command.extensions) ?? {}
  const intake = asObject(extensions['cyrus.project-control.intake']) ?? {}
  const unsigned = {
    ...command,
    extensions: {
      ...extensions,
      'cyrus.project-control.intake': { ...intake },
    },
  }
  const signature = intakeCommandSignature(unsigned, secret)
  return {
    ...unsigned,
    extensions: {
      ...unsigned.extensions,
      'cyrus.project-control.intake': { ...intake, commandSignature: signature },
    },
  }
}

function verifyIntakeCommandSignature(command: unknown, secret: string): boolean {
  try {
    const commandObject = asObject(command)
    const extensions = asObject(commandObject?.extensions)
    const intake = asObject(extensions?.['cyrus.project-control.intake'])
    const signature = intake?.commandSignature
    if (commandObject === null || extensions === null || intake === null
      || typeof signature !== 'string' || signature.length !== 43) return false
    const { commandSignature: _signature, ...unsignedIntake } = intake
    const unsigned = {
      ...commandObject,
      extensions: {
        ...extensions,
        'cyrus.project-control.intake': unsignedIntake,
      },
    }
    const expected = intakeCommandSignature(unsigned, secret)
    const actualBytes = Buffer.from(signature, 'utf8')
    const expectedBytes = Buffer.from(expected, 'utf8')
    return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes)
  } catch {
    return false
  }
}

function intakeCommandSignature(command: unknown, secret: string): string {
  return createHmac('sha256', secret)
    .update(canonicalCommandJson(command), 'utf8')
    .digest('base64url')
}

function canonicalCommandJson(value: unknown): string {
  return JSON.stringify(canonicalCommandValue(value))
}

function canonicalCommandValue(value: unknown): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Command contains a non-finite number.')
    return Object.is(value, -0) ? 0 : value
  }
  if (Array.isArray(value)) return value.map(canonicalCommandValue)
  if (typeof value !== 'object') throw new TypeError('Command is not lossless JSON.')
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right, 'en'))
    .map(([key, child]) => {
      if (child === undefined || typeof child === 'function' || typeof child === 'symbol') {
        throw new TypeError('Command is not lossless JSON.')
      }
      return [key, canonicalCommandValue(child)]
    }))
}

function commandCandidateIdFromExtensions(command: unknown): string {
  const commandObject = asObject(command)
  const extensions = asObject(commandObject?.extensions)
  const intake = asObject(extensions?.['cyrus.project-control.intake'])
  const candidateId = typeof intake?.candidateId === 'string'
    ? intake.candidateId
    : `can_${String(commandObject?.commandId).slice('cmd_'.length)}`
  return requireCommandCandidate(candidateId)
}

function commandCandidateRevision(command: unknown): number {
  const extensions = asObject(asObject(command)?.extensions)
  const intake = asObject(extensions?.['cyrus.project-control.intake'])
  const revision = intake?.candidateRevision
  if (!Number.isSafeInteger(revision) || (revision as number) < 1) {
    throw projectControlHttpError('REFERENCE_UNRESOLVED', '候选修订引用无法解析。', 409)
  }
  return revision as number
}

function publicIntakeError(error: unknown): unknown {
  if (isPublicHttpError(error)) return error
  const details = error instanceof Error
    ? (error as Error & { details?: unknown }).details
    : undefined
  const reason = asObject(details)?.reason
  switch (reason) {
    case 'candidate_not_found':
      return projectControlHttpError('CANDIDATE_NOT_FOUND', '项目候选不存在。', 404)
    case 'revision_conflict':
      return projectControlHttpError('CANDIDATE_REVISION_CONFLICT', '候选已经变化，请刷新后重试。', 409)
    case 'candidate_cursor_not_found':
      return projectControlHttpError('CANDIDATE_CURSOR_INVALID', '候选列表已经变化，请从第一页重新打开。', 409)
    case 'candidate_not_issuable':
    case 'candidate_already_imported':
    case 'invalid_candidate_transition':
      return projectControlHttpError('CANDIDATE_NOT_READY', '这个项目候选当前不能执行该操作。', 409)
    default:
      return projectControlHttpError('INTAKE_OPERATION_FAILED', '项目扫描或候选操作失败。', 409)
  }
}

function isPublicHttpError(error: unknown): boolean {
  return error instanceof Error
    && (error as Error & { expose?: unknown }).expose === true
}

function sameWindowsPath(left: string, right: string): boolean {
  const key = (value: string): string => win32.normalize(value.replaceAll('/', '\\'))
    .normalize('NFC')
    .toLocaleLowerCase('en-US')
  return key(left) === key(right)
}

async function isAccessibleDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code
    // A relocation is only safe when the old directory is provably gone. Permission
    // failures and other transient I/O errors remain blocking conflicts.
    return code !== 'ENOENT' && code !== 'ENOTDIR'
  }
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function requireScanEnvelope(value: unknown): RecordImportScanInput {
  const candidate = asObject(value)
  if (candidate === null
    || !['source_root', 'single_project'].includes(String(candidate.mode))
    || asObject(candidate.rootPath) === null
    || !Array.isArray(candidate.candidates)) {
    throw projectControlHttpError('SCAN_RESULT_INVALID', '扫描器返回了无法识别的结果。', 409)
  }
  // The storage boundary performs the complete bounded validation before persistence.
  return candidate as unknown as RecordImportScanInput
}

const DOCUMENT_ROLES = new Set([
  'readme',
  'prd',
  'devlog',
  'progress',
  'next',
  'current_architecture',
  'decision',
  'other',
])
