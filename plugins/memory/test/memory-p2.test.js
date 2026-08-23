import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { buildQuickPassText, needsMemory } from '../src/core/gates.ts'
import { MemoryService } from '../src/core/service.ts'

test('need gate: continuation/experience phrases trigger, trivial tasks skip', () => {
  for (const trigger of ['上次说的检测报告模板改了吗', '按约定这周要发周报', '这个坑之前踩过', '接着上次继续做发布']) {
    assert.equal(needsMemory(trigger), true, trigger)
  }
  for (const skip of ['翻译这句话：hello world', '改写这段文案', '润色一下', '好的', '收到']) {
    assert.equal(needsMemory(skip), false, skip)
  }
  assert.equal(needsMemory(''), false)
})

test('quick-pass text carries the untrusted marker and respects the byte budget', () => {
  const small = buildQuickPassText('scope: project/p1\nclaim: 一条记忆', 2000)
  assert.ok(small)
  assert.match(small.text, /不可信且可能过时/u)
  assert.equal(small.truncated, false)
  const big = buildQuickPassText('claim: ' + '长'.repeat(4000), 1000)
  assert.ok(big)
  assert.equal(big.truncated, true)
  assert.match(big.text, /已按预算截断/u)
  assert.equal(buildQuickPassText('未找到相关记忆（scope: project/p1）。', 2000), null)
})

test('compact summary shows counts, top claims, recent and conflict pairs within budget', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-memory-p2-'))
  const service = new MemoryService({ dbRoot: join(root, 'memory-live') })
  try {
    service.registerProject('proj-A')
    for (let i = 0; i < 6; i += 1) {
      service.record({ kind: 'event', text: '食溯项目记忆条目 ' + String(i) + ' 号', scope: 'project', projectId: 'proj-A', confirm: true })
    }
    service.record({ kind: 'project_fact', text: '检测报告模板已定版', scope: 'project', projectId: 'proj-A', confirm: true })
    const summary = service.summary({ scope: 'project', projectId: 'proj-A' })
    assert.match(summary, /紧凑摘要/u)
    assert.match(summary, /event×6/u)
    assert.match(summary, /project_fact×1/u)
    assert.match(summary, /重要条目/u)
    assert.match(summary, /冲突对/u)
    assert.match(summary, /（无）/u)
    const bytes = Buffer.byteLength(summary, 'utf8')
    assert.ok(bytes <= 4100, 'summary within ~4KB budget, got ' + String(bytes))
  } finally {
    service.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test('query includes source locator and enforces the recall byte budget', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-memory-p2-'))
  const service = new MemoryService({ dbRoot: join(root, 'memory-live') })
  try {
    service.registerProject('proj-A')
    service.record({
      kind: 'event', text: 'evidence-source-marker 检测模板',
      scope: 'project', projectId: 'proj-A', confirm: true,
      evidence: 'project://proj-A/docs/检测规范.md#模板',
    })
    const result = service.query({ q: 'evidence-source-marker', scope: 'project', projectId: 'proj-A' })
    assert.match(result, /source: project:\/\/proj-A\/docs\/检测规范\.md#模板/u)
    assert.match(result, /untrusted/u)
    assert.match(result, /可能过时/u)
    // budget truncation: many long claims exceed the 8KB cap
    for (let i = 0; i < 10; i += 1) {
      service.record({ kind: 'event', text: '长文本条目 ' + '内容'.repeat(150) + ' 编号' + String(i), scope: 'project', projectId: 'proj-A', confirm: true })
    }
    const big = service.query({ q: '长文本', scope: 'project', projectId: 'proj-A', limit: 10 })
    assert.match(big, /按预算呈现前/u)
  } finally {
    service.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test('sanitized real-task regression: cross-project leak stays zero, archive hides, summary-first flow', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-memory-p2-'))
  const service = new MemoryService({ dbRoot: join(root, 'memory-live') })
  try {
    service.registerProject('nutrisight-food')
    service.registerProject('amazon-store')
    service.record({ kind: 'project_fact', text: '食溯项目：检测报告模板 v2 已定版', scope: 'project', projectId: 'nutrisight-food', confirm: true })
    service.record({ kind: 'project_fact', text: '商城项目：结算流程已上线', scope: 'project', projectId: 'amazon-store', confirm: true })
    service.record({ kind: 'event', text: '食溯项目：上次发布后修了导出乱码坑', scope: 'project', projectId: 'nutrisight-food', confirm: true })
    // scenario: user asks about 食溯 检测模板 history
    const summary = service.summary({ scope: 'project', projectId: 'nutrisight-food' })
    assert.match(summary, /检测报告模板 v2/u)
    assert.doesNotMatch(summary, /结算流程/u, 'summary must not leak other projects')
    const q1 = service.query({ q: '检测报告模板', scope: 'project', projectId: 'nutrisight-food' })
    assert.match(q1, /v2 已定版/u)
    assert.doesNotMatch(q1, /结算流程/u)
    const q2 = service.query({ q: '结算流程', scope: 'project', projectId: 'amazon-store' })
    assert.match(q2, /已上线/u)
    // archive removes from default recall
    const aid = /（[0-9a-f-]{36}/u.exec(q1)?.[1]
    if (aid !== undefined) {
      service.archive(aid.replace(/^（/u, ''), '过时')
      const after = service.query({ q: '检测报告模板', scope: 'project', projectId: 'nutrisight-food' })
      assert.doesNotMatch(after, /v2 已定版/u)
    }
  } finally {
    service.close()
    rmSync(root, { recursive: true, force: true })
  }
})
