import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'
import { disposeProjectControlRegistration } from '../src/index.ts'
import {
  createProjectControlApi,
  normalizeCandidate,
} from '../src/client/projectControlApi.ts'
import { parseDirectorySelectionResult } from '../src/client/directoryBridge.ts'

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const host = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8')
const http = readFileSync(new URL('../src/http.ts', import.meta.url), 'utf8')
const lifecycleValidator = readFileSync(new URL('../src/lifecycle-validator.ts', import.meta.url), 'utf8')
const runtimeSchema = readFileSync(new URL('../src/runtime-schema.ts', import.meta.url), 'utf8')
const client = readFileSync(new URL('../src/client/index.ts', import.meta.url), 'utf8')
const contract = readFileSync(new URL('../src/client/contract.ts', import.meta.url), 'utf8')
const component = readFileSync(new URL('../src/client/ProjectControlPlaceholder.tsx', import.meta.url), 'utf8')
const candidateDetails = readFileSync(new URL('../src/client/CandidateDetails.tsx', import.meta.url), 'utf8')
const directoryBridge = readFileSync(new URL('../src/client/directoryBridge.ts', import.meta.url), 'utf8')
const clientApi = readFileSync(new URL('../src/client/projectControlApi.ts', import.meta.url), 'utf8')
const css = readFileSync(new URL('../src/client/ProjectControlPlaceholder.module.css', import.meta.url), 'utf8')
const candidateCss = readFileSync(new URL('../src/client/CandidateDetails.module.css', import.meta.url), 'utf8')
const consoleComponent = readFileSync(new URL('../src/client/ProjectConsole.tsx', import.meta.url), 'utf8')
const consoleCss = readFileSync(new URL('../src/client/ProjectConsole.module.css', import.meta.url), 'utf8')
const updateViewer = readFileSync(new URL('../src/client/ProgressUpdateViewer.tsx', import.meta.url), 'utf8')
const httpSource = readFileSync(new URL('../src/http.ts', import.meta.url), 'utf8')
const hostBundle = readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8')

test('declares the user-visible Project Control plugin and Personal Shell dependency', () => {
  assert.equal(manifest.name, '@cyrus/dsh-project-control')
  assert.match(manifest.description, /项目控制台/)
  assert.deepEqual(manifest.dsh.client.inject, [
    '@cyrus/dsh-personal-shell',
    '@cyrus/dsh-workbench',
    '@deepseek-ai/dsh-client-runtime',
  ])
  assert.equal(manifest.peerDependencies['@cyrus/dsh-workbench'], '*')
  assert.equal(manifest.dependencies.ajv, '8.20.0')
  assert.equal(manifest.dependencies['ajv-formats'], '3.0.1')
  assert.ok(manifest.files.includes('migrations/*.sql'))
  assert.doesNotMatch(hostBundle, /from ["']ajv(?:\/dist\/2020\.js)?["']/)
  assert.doesNotMatch(hostBundle, /from ["']ajv-formats["']/)
})

test('owns one versioned Host API and keeps storage imports out of the HTTP layer', () => {
  assert.match(host, /inject\s*=\s*\['webServer'\]/)
  assert.match(host, /webServer\.register/)
  assert.match(host, /createProjectControlRequestHandler/)
  assert.match(host, /migrationsDirectory:\s*MIGRATIONS_DIRECTORY/)
  assert.match(host, /process\.env\.PROJECT_CONTROL_HOME/)
  assert.match(http, /\/__personal\/project-control\/v1alpha1/)
  assert.match(http, /x-dsh-personal-client/)
  assert.match(http, /resource === '\/lifecycle'/)
  assert.doesNotMatch(http, /node:sqlite|src\/host|project-control\.sqlite3/)
})

test('always closes storage when route disposal fails and aggregates dual failures', () => {
  const calls = []
  disposeProjectControlRegistration(
    () => { calls.push('unregister') },
    () => { calls.push('close') },
  )
  assert.deepEqual(calls, ['unregister', 'close'])

  const unregisterError = new Error('route unregister failed')
  let closeCalls = 0
  assert.throws(
    () => disposeProjectControlRegistration(
      () => { throw unregisterError },
      () => { closeCalls += 1 },
    ),
    error => error === unregisterError,
  )
  assert.equal(closeCalls, 1)

  const closeError = new Error('storage close failed')
  assert.throws(
    () => disposeProjectControlRegistration(
      () => { throw unregisterError },
      () => { throw closeError },
    ),
    error => error instanceof AggregateError
      && error.errors[0] === unregisterError
      && error.errors[1] === closeError,
  )
})

test('loads the canonical lifecycle schema lazily and keeps read routes independent', () => {
  assert.match(runtimeSchema, /protocol\/project-control\/v1alpha1\/lifecycle\/schemas\/lifecycle-command-envelope\.schema\.json/)
  assert.match(runtimeSchema, /protocol\/project-control\/v1alpha1\/lifecycle\/schemas\/lifecycle-command-result\.schema\.json/)
  assert.match(runtimeSchema, /\.\/runtime-schemas\//)
  assert.match(lifecycleValidator, /runtimeSchemaPath\('lifecycleCommand'\)/)
  assert.match(lifecycleValidator, /runtimeSchemaPath\('lifecycleResult'\)/)
  assert.match(lifecycleValidator, /function getCommandValidator[\s\S]*compileSchema<LifecycleCommand>\(COMMAND_SCHEMA_PATH\)/)
  assert.match(lifecycleValidator, /function getResultValidator[\s\S]*compileSchema<LifecycleCommandResult>\(RESULT_SCHEMA_PATH\)/)
  assert.match(lifecycleValidator, /function compileSchema[\s\S]*readFileSync\(schemaPath/)
  assert.match(lifecycleValidator, /strict:\s*true/)
  assert.match(lifecycleValidator, /addFormats\(ajv\)/)
  assert.doesNotMatch(lifecycleValidator, /registerLegacyPayload|rebindLocationPayload|absolutePath/)
  assert.match(http, /COMMAND_VALIDATION_UNAVAILABLE/)
})

test('occupies Project Control and registers one bounded Workbench viewer', () => {
  assert.match(contract, /'project\.control': \{ kind: 'single'; scope: 'root'/)
  assert.match(client, /inject = \['slots', 'workbench'\]/)
  assert.match(client, /slots\.inject\('project\.control'/)
  assert.match(client, /slots\.register\(\{\s*name: 'project\.control'/)
  assert.match(client, /project-control\.candidate-details/)
  assert.match(client, /workbench\.viewers\.register/)
  assert.match(client, /isCandidateResourceKey\(descriptor\.resourceKey\)/)
  assert.doesNotMatch(client, /reflect\.provide|webServer|personalApi/)
})

test('shows truthful Gate 2C intake, candidate and existing project states', () => {
  assert.match(component, /data-personal-project-placeholder/)
  assert.match(component, /data-personal-project-control="gate-2c"/)
  assert.match(component, /扫描来源目录/)
  assert.match(component, /导入单个项目/)
  assert.match(component, /selectProjectDirectory\(mode\)/)
  assert.match(component, /api\.scan\(mode, outcome\.selection\)/)
  assert.doesNotMatch(component, /maxDepth:\s*1/)
  assert.match(component, /api\.listCandidates\(\{[\s\S]*view: candidateView === 'projects' \? 'review' : candidateView/)
  assert.match(component, /项目[\s\S]*待审阅[\s\S]*已忽略[\s\S]*历史记录/)
  assert.match(component, /api\.setCandidatesIgnored\(selected, ignored\)/)
  assert.match(component, /本批次未部分生效/)
  assert.match(component, /candidate\.rootPath/)
  assert.match(component, /statusLabel\(candidate\.status\)/)
  assert.match(component, /已被新扫描取代/)
  assert.match(component, /nextCursor/)
  assert.match(clientApi, /\/intake\/candidates\/bulk-ignore/)
  assert.match(component, /scanIssueMessage\(result\.issues\)/)
  assert.match(component, /workbench\.open\(\{/)
  assert.match(component, /resourceKey: candidate\.candidateId/)
  assert.match(component, /已忽略/)
  assert.match(component, /恢复/)
  assert.match(component, /项目数据库已就绪/)
  assert.match(component, /未打开（版本保护）/)
  assert.match(candidateDetails, /只关联，不修改项目文件/)
  assert.match(candidateDetails, /candidate\.detectedMode === 'managed' \? 'managed' : 'linked_legacy'/)
  assert.match(candidateDetails, /重新绑定位置/)
  assert.match(candidateDetails, /prepareCandidate/)
  assert.match(candidateDetails, /submitLifecycle/)
  assert.match(candidateDetails, /return role \?\? 'ignore'/)
  assert.match(candidateDetails, /显示名称应为 1–120 个字符/)
  assert.match(candidateDetails, /state\.candidate\.detectedMode !== 'managed'/)
  assert.match(candidateDetails, /candidate\.detectedMode === 'managed'\s*\? \[\]/)
  assert.match(candidateDetails, /manifest 已锁定/)
  assert.match(candidateDetails, /readOnly=\{managedExisting\}/)
  assert.match(clientApi, /x-dsh-personal-client/)
  assert.doesNotMatch(component, /示例项目\s*[一二三123]|mockProject|sampleProject/)
})

test('keeps authorized directory selection and Host API boundaries explicit', () => {
  assert.match(directoryBridge, /projectControl\?\.selectDirectory/)
  assert.match(directoryBridge, /authorization\.version !== 1/)
  assert.match(directoryBridge, /目录授权已经过期/)
  assert.match(clientApi, /\/intake\/scan/)
  assert.match(clientApi, /\{ mode, selection,/)
  assert.match(clientApi, /PROJECT_CONTROL_MAX_JSON_BYTES = 262_144/)
  assert.match(clientApi, /\/intake\/candidates\/\$\{encodeURIComponent/)
  assert.match(clientApi, /\/prepare/)
  assert.match(clientApi, /'POST', '\/lifecycle'/)
  assert.doesNotMatch(component, /localStorage|sessionStorage/)
})

test('uses a locally-scoped CSS Module without global selectors', () => {
  assert.match(component, /ProjectControlPlaceholder\.module\.css/)
  assert.match(candidateDetails, /CandidateDetails\.module\.css/)
  assert.doesNotMatch(css, /:global/)
  assert.doesNotMatch(candidateCss, /:global/)
  assert.doesNotMatch(css, /(^|\n)\s*(html|body|button|input|textarea|select)(?:\s|,|\{)/)
  assert.doesNotMatch(candidateCss, /(^|\n)\s*(html|body|button|input|textarea|select)(?:\s|,|\{)/)
  assert.doesNotMatch(consoleCss, /:global/)
  assert.doesNotMatch(consoleCss, /(^|\n)\s*(html|body|button|input|textarea|select)(?:\s|,|\{)/)
  assert.match(candidateCss, /\.details\s*\{[^}]*overflow-y:\s*auto;/s)
  assert.match(candidateCss, /\.actions\s*\{[^}]*position:\s*sticky;[^}]*bottom:\s*0;/s)
})

test('ships the P7 console pages, commands and typed open intents', () => {
  assert.match(consoleComponent, /data-personal-project-console/)
  assert.match(consoleComponent, /data-console-tab=/)
  for (const label of ['总览', '清单', '审阅', '运行', '动态', '文档', '会话']) {
    assert.match(consoleComponent, new RegExp(`label: '${label}'`))
  }
  assert.match(consoleComponent, /api\.listWorkItems|api\.listRuns|api\.listProgressUpdates|api\.listReviews|api\.listDecisions|api\.listEvents|api\.listSessions/)
  assert.match(consoleComponent, /api\.setWorkItemStatus|api\.requestReview|api\.decideReview|api\.commentReview|api\.startRun|api\.createWorkItem/)
  assert.match(consoleComponent, /请求审阅/)
  assert.match(consoleComponent, /通过|要求修改|驳回/)
  assert.match(consoleComponent, /启动/)
  assert.match(consoleComponent, /跟随当前会话/)
  assert.match(consoleComponent, /置顶项目/)
  assert.match(consoleComponent, /loadConsolePreferences|saveConsolePreferences/)
  assert.match(consoleComponent, /viewerId: 'project-control\.progress-update'/)
  assert.match(component, /打开控制台/)
  assert.match(client, /project-control\.progress-update/)
  assert.match(updateViewer, /isProgressUpdateResourceKey/)
  assert.match(updateViewer, /api\.listProgressUpdates/)
  assert.match(httpSource, /CONSOLE_UNAVAILABLE/)
  assert.match(httpSource, /review-request|\/decide|\/comment|\/start|\/status/)
  assert.match(clientApi, /\/progress-updates|\/reviews|\/events|\/sessions|\/quarantine/)
  assert.doesNotMatch(consoleComponent, /示例项目|mockProject|sampleProject/)
})

test('validates directory tickets and rejects expired or mismatched authorization', () => {
  const selected = parseDirectorySelectionResult({
    ok: true,
    canceled: false,
    path: 'D:\\Projects',
    authorization: {
      version: 1,
      kind: 'source-root',
      expiresAt: '2999-08-15T00:00:00.000Z',
      nonce: 'nonce_123',
      signature: 'signed-ticket',
    },
  }, 'source-root')
  assert.equal(selected.kind, 'selected')
  assert.equal(selected.selection.authorization.kind, 'source-root')

  assert.deepEqual(parseDirectorySelectionResult({
    ok: true,
    canceled: false,
    path: 'D:\\Projects',
    authorization: {
      version: 1,
      kind: 'project-root',
      expiresAt: '2999-08-15T00:00:00.000Z',
      nonce: 'nonce_123',
      signature: 'signed-ticket',
    },
  }, 'source-root'), {
    kind: 'error',
    message: '目录选择服务返回了无法识别的响应。',
  })
})

test('normalizes candidate DTOs and rejects a malformed content hash', () => {
  const candidate = candidateFixture()
  const normalized = normalizeCandidate(candidate)
  assert.equal(normalized.documents[0].suggestedRole, 'prd')
  assert.equal(normalized.documentCount, 1)
  assert.equal(normalized.issueCount, 0)
  const compact = normalizeCandidate({
    ...candidate,
    documentCount: 23,
    issueCount: 4,
    documents: [],
    issues: [],
  })
  assert.equal(compact.documentCount, 23)
  assert.equal(compact.issueCount, 4)
  assert.deepEqual(compact.documents, [])
  assert.deepEqual(compact.issues, [])
  const nullable = normalizeCandidate({
    ...candidate,
    nameSource: null,
    summary: null,
    summarySource: null,
    manifestProjectId: null,
    documents: [{
      ...candidate.documents[0],
      suggestedRole: null,
      contentHash: null,
      title: null,
      preview: null,
    }],
    issues: [{
      issueId: 'iss_12345678',
      code: 'REVIEW_REQUIRED',
      severity: 'info',
      status: 'open',
      details: { reason: 'human_confirmation' },
    }],
  })
  assert.equal(nullable.documents[0].suggestedRole, null)
  assert.equal(nullable.issues[0].message, 'reason: human_confirmation')
  assert.throws(
    () => normalizeCandidate({
      ...candidate,
      documents: [{ ...candidate.documents[0], contentHash: 'not-a-hash' }],
    }),
    /文档内容哈希无效/,
  )
})

test('posts an authorized selection envelope instead of a naked directory path', async () => {
  let captured
  const fetchImpl = async (_url, init) => {
    captured = init
    return new Response(JSON.stringify({
      ok: true,
      data: {
        sourceRoot: {
          sourceRootId: 'srt_12345678',
          kind: 'project-root',
          path: 'D:\\Projects\\One',
          revision: 1,
          updatedAt: '2026-08-15T00:00:00.000Z',
        },
        job: {
          jobId: 'job_12345678',
          sourceRootId: 'srt_12345678',
          mode: 'project-root',
          status: 'completed',
          scannerVersion: 'gate2c/v1',
          startedAt: '2026-08-15T00:00:00.000Z',
          completedAt: '2026-08-15T00:00:01.000Z',
          summary: { candidates: 1 },
          issues: [{
            issueId: 'jis_12345678',
            code: 'SCAN_LIMIT_REACHED',
            severity: 'warning',
            status: 'open',
            message: '扫描达到安全上限。',
          }],
        },
        candidates: [candidateFixture()],
        issues: [{
          issueId: 'jis_12345678',
          code: 'SCAN_LIMIT_REACHED',
          severity: 'warning',
          status: 'open',
          message: '扫描达到安全上限。',
        }],
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  const api = createProjectControlApi(fetchImpl)
  const result = await api.scan('project-root', {
    path: 'D:\\Projects\\One',
    authorization: {
      version: 1,
      kind: 'project-root',
      expiresAt: '2999-08-15T00:00:00.000Z',
      nonce: 'nonce_123',
      signature: 'signed-ticket',
    },
  })
  assert.equal(result.candidates.length, 1)
  assert.equal(result.issues[0].code, 'SCAN_LIMIT_REACHED')
  assert.equal(captured.method, 'POST')
  assert.equal(captured.headers['x-dsh-personal-client'], '1')
  const body = JSON.parse(captured.body)
  assert.deepEqual(Object.keys(body).sort(), ['mode', 'selection'])
  assert.equal(body.selection.path, 'D:\\Projects\\One')
  assert.equal(body.selection.authorization.signature, 'signed-ticket')
})

test('W1 Step D：Project Header 提供「在工作台浏览」显式命令', () => {
  const consoleSrc = readFileSync(new URL('../src/client/ProjectConsole.tsx', import.meta.url), 'utf8')
  assert.match(consoleSrc, /data-browse-in-workbench/)
  assert.match(consoleSrc, /在工作台浏览/)
  assert.match(consoleSrc, /setProjectWorkspace\(project\.projectId, ''\)/)
  assert.match(consoleSrc, /workbench\.reveal\(\)/)
})

test('project rows expose recoverable archive and scanner-backed workspace relocation only', () => {
  assert.match(component, /data-project-archive/)
  assert.match(component, /data-project-unarchive/)
  assert.match(component, /data-project-workspace-change/)
  assert.match(component, /selectProjectDirectory\('project-root'\)/)
  assert.match(component, /api\.scan\('project-root', outcome\.selection\)/)
  assert.match(component, /selectUserInitiatedRelocationCandidate/)
  assert.match(component, /data-project-search/)
  assert.match(component, /data-project-page-next/)
  assert.match(component, /data-project-page-previous/)
  assert.doesNotMatch(component, /workspace_locations|UPDATE\s+projects/iu)
})

test('workspace project index consumes every active-project page instead of stopping at 100', () => {
  const hostEntry = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8')
  const workspaceIndex = hostEntry.slice(
    hostEntry.indexOf('listProjectWorkspaces()'),
    hostEntry.indexOf('\n    },', hostEntry.indexOf('listProjectWorkspaces()')) + 7,
  )
  assert.match(workspaceIndex, /storage\.queryProjects\(/)
  assert.match(workspaceIndex, /page\.nextCursor/)
  assert.doesNotMatch(workspaceIndex, /storage\.listProjects\(\{ includeArchived: false, limit: 100 \}\)/)
})

test('ships Host and Client bundle artifacts', async () => {
  for (const file of ['../lib/index.js', '../lib/client.js', '../lib/client.js.map']) {
    assert.equal(existsSync(new URL(file, import.meta.url)), true, `${file} is missing`)
  }
  const bundledHost = await import('../lib/index.js')
  assert.equal(typeof bundledHost.apply, 'function')
  assert.equal(typeof bundledHost.createProjectControlRequestHandler, 'function')
  assert.equal(typeof bundledHost.validateLifecycleCommand, 'function')
  assert.equal(typeof bundledHost.validateLifecycleResult, 'function')
  const bundle = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  assert.match(bundle, /@cyrus\/dsh-project-control/)
  assert.match(bundle, /data-personal-project-placeholder/)
  assert.match(bundle, /Gate 2C/)
  assert.match(bundle, /project-control\.candidate-details/)
})

function candidateFixture() {
  return {
    candidateId: 'can_12345678',
    jobId: 'job_12345678',
    revision: 1,
    rootPath: 'D:\\Projects\\One',
    suggestedName: 'One',
    nameSource: { relativePath: 'PRD.md' },
    summary: 'A real project.',
    summarySource: { relativePath: 'PRD.md' },
    evidenceLevel: 'high',
    evidence: ['PRD.md'],
    status: 'discovered',
    detectedMode: 'linked_legacy',
    ignored: false,
    documents: [{
      documentId: 'doc_12345678',
      relativePath: 'PRD.md',
      suggestedRole: 'prd',
      contentHash: `sha256:${'a'.repeat(64)}`,
      title: 'One PRD',
      preview: '# One',
      evidence: ['exact filename'],
    }],
    issues: [],
  }
}
