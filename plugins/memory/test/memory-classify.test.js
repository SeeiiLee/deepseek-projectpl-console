import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { classifyRecordIntent } from '../src/core/gates.ts'
import { assertKindScopePairing, MemoryService } from '../src/core/service.ts'

test('classify: project facts vs global lessons vs generic facts', () => {
  const project = classifyRecordIntent('我们正在开发饮食管理 APP，项目代号食溯')
  assert.equal(project.scope, 'project')
  assert.equal(project.kind, 'project_fact')
  const lessonWithProject = classifyRecordIntent('上次发布后修过导出乱码的坑，根因是 GBK 代码页', '食溯')
  assert.equal(lessonWithProject.scope, 'project')
  assert.equal(lessonWithProject.kind, 'event')
  assert.ok(lessonWithProject.dual, 'project incident with a generalizable lesson proposes a global pattern twin')
  assert.equal(lessonWithProject.dual?.kind, 'pattern')
  const globalLesson = classifyRecordIntent('所有项目的导出统一用 UTF-8，避免 GBK 乱码')
  assert.equal(globalLesson.scope, 'global_user')
  assert.equal(globalLesson.kind, 'pattern')
  const generic = classifyRecordIntent('本机没有全局 pnpm')
  assert.equal(generic.scope, 'global_user')
  assert.equal(generic.kind, 'global_fact')
})

test('kind-scope pairing: project kinds refuse global scope and vice versa', () => {
  for (const kind of ['project_fact', 'event', 'task']) {
    assert.throws(() => assertKindScopePairing('global_user', kind), /归类拒绝/u)
  }
  for (const kind of ['global_fact', 'user_profile']) {
    assert.throws(() => assertKindScopePairing('project', kind), /归类拒绝/u)
  }
  assert.doesNotThrow(() => assertKindScopePairing('global_user', 'pattern'))
  assert.doesNotThrow(() => assertKindScopePairing('project', 'pattern'))
})

test('record enforces the pairing end to end', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-memory-classify-'))
  const service = new MemoryService({ dbRoot: join(root, 'memory-live') })
  try {
    assert.throws(() => service.record({ kind: 'project_fact', text: '食溯定位', scope: 'global_user', confirm: true }), /归类拒绝/u)
    assert.throws(() => service.record({ kind: 'global_fact', text: '通用规范', scope: 'project', projectId: 'x', confirm: true }), /归类拒绝/u)
    assert.throws(() => service.record({ kind: 'event', text: '未登记项目事件', scope: 'project', projectId: 'x', confirm: true }), /未登记/u)
    service.registerProject('proj-A')
    assert.throws(() => service.record({ kind: 'global_fact', text: '通用规范', scope: 'project', projectId: 'proj-A', confirm: true }), /归类拒绝/u)
    const okEvent = service.record({ kind: 'event', text: '上次导出乱码坑', scope: 'project', projectId: 'proj-A', confirm: true })
    assert.match(okEvent, /active/u)
    const okPattern = service.record({ kind: 'pattern', text: '导出统一 UTF-8，避免 GBK 乱码', scope: 'global_user', confirm: true })
    assert.match(okPattern, /active/u)
  } finally {
    service.close()
    rmSync(root, { recursive: true, force: true })
  }
})
