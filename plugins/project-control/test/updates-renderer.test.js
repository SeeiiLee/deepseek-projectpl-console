import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'

import { parseYamlSubset } from '../src/discovery/runtime.js'
import { renderProgressUpdate } from '../src/updates-renderer.js'

const schemaPath = fileURLToPath(
  new URL('../../../protocol/project-control/v1alpha1/schemas/progress-update-frontmatter.schema.json', import.meta.url),
)
const schema = JSON.parse(readFileSync(schemaPath, 'utf8'))

const ajv = new Ajv2020({ allErrors: true, strict: true })
addFormats(ajv)
const validateFrontmatter = ajv.compile(schema)

const U = '01926331-2d1c-70c1-8a4b-1d2e3f4a5b6c'
const IDS = Object.freeze({
  projectId: `prj_${U}`,
  workItemId: `wrk_${U}`,
  runId: `run_${U}`,
  updateId: `upd_${U}`,
  eventId: `evt_${U}`,
  commandId: `cmd_${U}`,
})

const SHA_A = 'sha256:' + 'a'.repeat(64)
const SHA_B = 'sha256:' + 'b'.repeat(64)

function frontmatterText(markdown) {
  const lines = markdown.split(/\r?\n/u)
  assert.equal(lines[0], '---')
  const end = lines.indexOf('---', 1)
  assert.notEqual(end, -1)
  return lines.slice(1, end).join('\n')
}

function bodyText(markdown) {
  const parts = markdown.split('\n---\n')
  assert.equal(parts.length, 2)
  return parts[1]
}

/** Render once, then verify the emitted YAML parses back to the same object and satisfies the frozen schema. */
function assertRoundTrip(options) {
  const rendered = renderProgressUpdate(options)
  const parsed = parseYamlSubset(frontmatterText(rendered.markdown))
  assert.deepEqual(parsed, rendered.frontmatter)
  assert.equal(validateFrontmatter(parsed), true, ajv.errorsText(validateFrontmatter.errors))
  return rendered
}

function assertSectionOrder(body, summary) {
  const headings = ['# ' + summary, '## 发生了什么', '## 证据', '## 下一步', '## 阻塞与待决定']
  const positions = headings.map((heading) => body.indexOf(heading))
  for (const position of positions) assert.notEqual(position, -1, 'missing heading in body')
  for (let index = 1; index < positions.length; index += 1) {
    assert.ok(positions[index] > positions[index - 1], 'body section order violated')
  }
  for (const heading of headings) {
    assert.equal(body.split(heading).length - 1, 1, `heading appears more than once: ${heading}`)
  }
}

test('a completion declaration round-trips through the frozen frontmatter schema', () => {
  const rendered = assertRoundTrip({
    update: {
      progressUpdateId: IDS.updateId,
      projectId: IDS.projectId,
      workItemId: IDS.workItemId,
      runId: IDS.runId,
      kind: 'completion_declared',
      summary: '双栏工作台改造完成，等待独立验证。',
      acceptanceClaims: ['验收点 A：双栏可拖拽', '验收点 B：会话列表可搜索'],
      evidence: [
        { kind: 'artifact', ref: 'artifact.demo-notes-42', contentHash: SHA_A, title: '必须被丢弃' },
        { kind: 'workspace_file', workspaceRef: 'ws-demo', relativePath: 'docs/workbench-demo.md', contentHash: SHA_B },
      ],
      completionPercent: 100,
      details: '双栏布局、会话搜索与面板折叠均已落地并通过手工冒烟。',
      threadId: 'thr.demo.workbench',
      aggregateRevision: 7,
      commandId: IDS.commandId,
    },
    eventId: IDS.eventId,
    actor: { kind: 'agent', id: 'dsh.demo.agent', applicationId: 'dsh-personal-agent', displayName: '演示代理' },
    occurredAt: '2026-08-15T03:04:05.678Z',
    recordedAt: '2026-08-15T03:04:06.123Z',
    generatedBy: { applicationId: 'dsh-personal-host', applicationVersion: '0.1.0-rc.5', applicationInstanceId: 'project-control-host:1:demo' },
  })

  assert.equal(rendered.relativePath, `.dsh-project/updates/2026/08/20260815T030405Z-${IDS.updateId}.md`)
  assert.equal(rendered.frontmatter.category, 'completion_declared')
  assert.equal(rendered.frontmatter.aggregateRevision, 7)
  assert.equal(typeof rendered.frontmatter.aggregateRevision, 'number')

  // The envelope allows evidence.title, but the frozen frontmatter schema does not.
  assert.equal(Object.hasOwn(rendered.frontmatter.evidence[0], 'title'), false)

  const body = bodyText(rendered.markdown)
  assertSectionOrder(body, '双栏工作台改造完成，等待独立验证。')
  assert.match(body, /## 发生了什么\n双栏布局、会话搜索与面板折叠均已落地并通过手工冒烟。/u)
  assert.match(body, /- artifact \| artifact\.demo-notes-42 \| sha256:a{64}/u)
  assert.match(body, /- workspace_file \| docs\/workbench-demo.md \| sha256:b{64}/u)
  assert.match(body, /## 下一步\n- 验收点 A：双栏可拖拽\n- 验收点 B：会话列表可搜索/u)
  assert.match(body, /## 阻塞与待决定\n无/u)
})

test('a minimal progress report renders 无 for every empty section and stays schema-valid', () => {
  const rendered = assertRoundTrip({
    update: {
      progressUpdateId: IDS.updateId,
      projectId: IDS.projectId,
      workItemId: IDS.workItemId,
      runId: IDS.runId,
      kind: 'progress',
      summary: '整理接线方式，无新增内容。',
      threadId: 'thr.demo.wiring',
      aggregateRevision: 2,
      commandId: IDS.commandId,
    },
    eventId: IDS.eventId,
    actor: { kind: 'agent', id: 'dsh.demo.agent', applicationId: 'dsh-personal-agent' },
    occurredAt: '2026-08-15T04:00:00.000Z',
    recordedAt: '2026-08-15T04:00:01.000Z',
    generatedBy: { applicationId: 'dsh-personal-host', applicationVersion: '0.1.0-rc.5', applicationInstanceId: 'project-control-host:1:demo' },
  })

  assert.deepEqual(rendered.frontmatter.evidence, [])
  const body = bodyText(rendered.markdown)
  assertSectionOrder(body, '整理接线方式，无新增内容。')
  assert.match(body, /## 发生了什么\n无/u)
  assert.match(body, /## 证据\n无/u)
  assert.match(body, /## 下一步\n无/u)
  assert.match(body, /## 阻塞与待决定\n无/u)
})

test('a blocker raise lists needs in 下一步 and reports the block in 阻塞与待决定', () => {
  const rendered = assertRoundTrip({
    update: {
      progressUpdateId: IDS.updateId,
      projectId: IDS.projectId,
      workItemId: IDS.workItemId,
      runId: IDS.runId,
      kind: 'blocker',
      summary: '工作台插槽注册被拒绝，运行暂停。',
      needs: ['需要 UI Slots 最新类型定义', '需要人工确认插槽白名单'],
      details: 'register() 抛出 UNKNOWN_SLOT。',
      threadId: 'thr.demo.blocker',
      aggregateRevision: 3,
      commandId: IDS.commandId,
    },
    eventId: IDS.eventId,
    actor: { kind: 'agent', id: 'dsh.demo.agent', applicationId: 'dsh-personal-agent' },
    occurredAt: '2026-08-15T05:00:00.000Z',
    recordedAt: '2026-08-15T05:00:01.000Z',
    generatedBy: { applicationId: 'dsh-personal-host', applicationVersion: '0.1.0-rc.5', applicationInstanceId: 'project-control-host:1:demo' },
  })

  const body = bodyText(rendered.markdown)
  assertSectionOrder(body, '工作台插槽注册被拒绝，运行暂停。')
  assert.match(body, /## 下一步\n- 需要 UI Slots 最新类型定义\n- 需要人工确认插槽白名单/u)
  assert.match(body, /## 阻塞与待决定\n见上（阻塞中）/u)
})

test('unicode, quoted colons and numeric revisions survive the YAML round-trip', () => {
  const rendered = assertRoundTrip({
    update: {
      progressUpdateId: IDS.updateId,
      projectId: IDS.projectId,
      workItemId: IDS.workItemId,
      runId: IDS.runId,
      kind: 'progress',
      summary: '修复了 "编辑：入口" 的转义问题。',
      details: '包含井号 # 与冒号: 的细节文本。',
      threadId: 'thr.demo.escape',
      aggregateRevision: 42,
      commandId: IDS.commandId,
    },
    eventId: IDS.eventId,
    actor: { kind: 'system', id: 'dsh.demo.system', applicationId: 'dsh-personal-host' },
    occurredAt: '2026-08-15T06:00:00.000Z',
    recordedAt: '2026-08-15T06:00:01.000Z',
    generatedBy: { applicationId: 'dsh-personal-host', applicationVersion: '0.1.0-rc.5', applicationInstanceId: 'project-control-host:1:demo' },
  })

  assert.equal(rendered.frontmatter.aggregateRevision, 42)
  assert.equal(typeof rendered.frontmatter.aggregateRevision, 'number')
  const body = bodyText(rendered.markdown)
  assert.match(body, /包含井号 # 与冒号: 的细节文本。/u)
})
