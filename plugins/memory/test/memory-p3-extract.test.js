// P3-2 提取管线测试：需求门 / 解析有界 / 上下文预算 / 幂等写入 / 轮末管线 / 项目绑定桥。
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createMemoryContextRequestHandler, MEMORY_CONTEXT_API_PREFIX } from '../src/core/context-bridge.ts'
import {
  buildExtractionContext,
  extractCandidates,
  ExtractorError,
  extractionGate,
  parseExtractionResult,
} from '../src/core/extractor.ts'
import { foundationBundleUrl, loadFoundationStoreConstructor } from '../src/core/foundation-runtime.ts'
import { DEEPSEEK_OFFICIAL_ENDPOINT, officialExtractionConnection } from '../src/core/official-fallback.ts'
import { MemoryService } from '../src/core/service.ts'
import { createTurnEndExtractor } from '../src/core/turn-extractor.ts'

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'dsh-memory-ext-'))
  const service = new MemoryService({ dbRoot: join(root, 'memory-live'), encrypted: false })
  return { root, service }
}

// ---------- 需求门 ----------

test('extractionGate fires on lessons or explicit remember, skips trivial turns', () => {
  assert.equal(extractionGate('帮我看看这个报错', '报错原因是锁表，根因是事务没提交，修复方法是先提交再删除。这是教训。'), true)
  assert.equal(extractionGate('记住以后导出都用 UTF-8', '好的，以后所有导出统一使用 UTF-8 编码。'), true)
  assert.equal(extractionGate('翻译：hello', '你好。'), false) // 跳过类
  assert.equal(extractionGate('今天天气怎么样', '晴天。'), false) // 助手回复过短
  assert.equal(extractionGate('', ''), false)
})

test('extractionGate skips memory-administration turns to prevent self-feedback loops', () => {
  const rejectionSummary = '已拒绝 3 条候选并归档，包括 SQLite 并发写入解法、单写者模型等。之后想重新记录 SQLite 那条经验，随时可以手动写入。'
  assert.equal(extractionGate('拒绝', rejectionSummary), false) // 短管理指令
  assert.equal(extractionGate('memory_review confirm', '已确认该候选为 active + user_confirmed。'), false) // 工具名
  assert.equal(extractionGate('用 memory_candidates 把候选列出来', '当前候选队列有 2 条待处理候选。'), false)
  assert.equal(extractionGate('看看记忆库里的评审记录', '评审记录都在 promotion_events 里。'), false)
  // 正常「记住」不受影响
  assert.equal(extractionGate('记住以后发布流程先测试再打包', '好的，发布流程约定已记录：先跑完整测试和预检，再打包出包。'), true)
})

// ---------- 上下文预算 ----------

test('buildExtractionContext caps at budget and keeps the assistant tail', () => {
  const user = '用户输入一句话'
  const assistant = 'A'.repeat(3000)
  const context = buildExtractionContext(user, assistant, 1500)
  assert.ok(context.length <= 1500)
  assert.ok(context.includes('助手：…'))
  assert.equal(context.includes('A'.repeat(500)), true) // 尾部保留
  const small = buildExtractionContext('短', '回答', 1500)
  assert.equal(small, '用户：短\n助手：回答')
})

// ---------- 解析有界 ----------

test('parseExtractionResult accepts fenced/plain/array JSON and drops invalid candidates', () => {
  const fenceOpen = String.fromCharCode(96).repeat(3)
  const fenced = '好的，以下是结果：\n' + fenceOpen + 'json\n{"candidates":[{"kind":"pattern","scope":"global_user","text":"导出统一使用 UTF-8 编码","confidence":70}]}\n' + fenceOpen
  const parsed = parseExtractionResult(fenced)
  assert.equal(parsed.length, 1)
  assert.deepEqual(parsed[0], { kind: 'pattern', scope: 'global_user', text: '导出统一使用 UTF-8 编码', confidence: 70 })

  const bare = '[{"kind":"pattern","scope":"global_user","text":"数据库迁移必须先备份再执行变更"}]'
  assert.equal(parseExtractionResult(bare).length, 1)

  assert.deepEqual(parseExtractionResult('完全不是 JSON 的内容'), [])
  assert.deepEqual(parseExtractionResult(''), [])
})

test('parseExtractionResult enforces pairing, sensitivity, bounds, dedupe and cap', () => {
  const raw = JSON.stringify({ candidates: [
    { kind: 'project_fact', scope: 'global_user', text: '项目事实冒充全局，必须丢弃' },
    { kind: 'pattern', scope: 'global_user', text: '密钥是 sk-abcdefghijklmnopqrstuvwx，会被硬拦截' },
    { kind: 'pattern', scope: 'global_user', text: '太短' },
    { kind: 'pattern', scope: 'global_user', text: '可复用的方法：发布前先跑完整预检再打包' },
    { kind: 'pattern', scope: 'global_user', text: '可复用的方法：发布前先跑完整预检再打包' },
    { kind: 'event', scope: 'project', text: '项目事件：回滚后需手动恢复索引' },
  ] })
  const parsed = parseExtractionResult(raw)
  assert.equal(parsed.length, 1) // 唯一合法候选（项目候选因未绑定被丢弃）
  assert.equal(parsed[0].text, '可复用的方法：发布前先跑完整预检再打包')

  const withProject = parseExtractionResult(raw, 'proj-A')
  assert.equal(withProject.length, 2) // 绑定项目后项目事件合法
  assert.equal(withProject[1].scope, 'project')

  const many = JSON.stringify(Array.from({ length: 5 }, (_, index) => ({
    kind: 'pattern', scope: 'global_user', text: '候选编号 ' + String(index) + ' 的内容足够长', confidence: 50,
  })))
  assert.equal(parseExtractionResult(many).length, 2) // ≤2 封顶
})

// ---------- 模型调用 ----------

test('extractCandidates posts one bounded chat/completions call and maps provider errors', async () => {
  let captured
  const fakeFetch = async (input, init = {}) => {
    captured = {
      url: String(input),
      headers: init.headers ?? {},
      body: JSON.parse(String(init.body ?? '{}')),
    }
    return new Response(JSON.stringify({
      model: 'deepseek-chat',
      choices: [{ message: { content: '{"candidates":[{"kind":"pattern","scope":"global_user","text":"轮末提取必须设置超时上限防止卡死","confidence":80}]}' } }],
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  const output = await extractCandidates(
    { endpoint: 'https://api.example.com/v1', apiKey: 'sk-test', model: 'deepseek-v4-flash', context: '对话内容', projectId: undefined, disableThinking: true },
    { fetchImpl: fakeFetch },
  )
  assert.equal(output.provider, 'api.example.com')
  assert.equal(output.candidates.length, 1)
  assert.equal(captured.url, 'https://api.example.com/v1/chat/completions')
  assert.equal(captured.headers.authorization, 'Bearer sk-test')
  assert.deepEqual(captured.body.thinking, { type: 'disabled' }) // 官方规范：思考开到最低
  assert.equal(captured.body.model, 'deepseek-v4-flash')
  assert.match(captured.body.messages[0].content, /记忆提取助手/u)
  assert.match(captured.body.messages[0].content, /对话内容/u)

  // 不传 disableThinking 时不上 thinking 字段（自定义连接按服务端默认）
  const plainFetch = async () => new Response(JSON.stringify({
    choices: [{ message: { content: '{"candidates":[]}' } }],
  }), { status: 200, headers: { 'content-type': 'application/json' } })
  let plainCaptured
  await extractCandidates(
    { endpoint: 'https://api.example.com/v1', apiKey: 'sk-test', model: 'deepseek-v4-flash', context: 'x' },
    { fetchImpl: async (input, init = {}) => { plainCaptured = JSON.parse(String(init.body ?? '{}')); return plainFetch() } },
  )
  assert.equal('thinking' in plainCaptured, false)

  const unauthorized = async () => new Response('{}', { status: 401 })
  await assert.rejects(
    () => extractCandidates({ endpoint: 'https://api.example.com/v1', apiKey: 'bad', model: 'm', context: 'x' }, { fetchImpl: unauthorized }),
    (error) => error instanceof ExtractorError && error.code === 'PROVIDER_AUTH_FAILED',
  )
  await assert.rejects(
    () => extractCandidates({ endpoint: 'not a url', apiKey: 'k', model: 'm', context: 'x' }),
    (error) => error instanceof ExtractorError && error.code === 'INVALID_ENDPOINT',
  )
})

// ---------- record 幂等 ----------

test('record with the same idempotency key writes only once', () => {
  const { root, service } = fixture()
  try {
    const first = service.record({
      kind: 'pattern', text: '幂等键防重复提取的方法', scope: 'global_user',
      idempotencyKey: 'global|s-1|1|v1|1', evidenceKind: 'session', evidence: 'session://s-1#1',
    })
    assert.match(first, /已暂存为候选/u)
    const second = service.record({
      kind: 'pattern', text: '幂等键防重复提取的方法', scope: 'global_user',
      idempotencyKey: 'global|s-1|1|v1|1', evidenceKind: 'session', evidence: 'session://s-1#1',
    })
    assert.match(second, /幂等键已存在/u)
    const listed = service.listCandidates({ scope: 'global_user' })
    assert.equal((listed.match(/幂等键防重复提取的方法/gu) ?? []).length, 1)
  } finally {
    service.close()
    rmSync(root, { recursive: true, force: true })
  }
})

// ---------- 运行时 peer 加载 ----------

test('foundation runtime resolves the sibling built bundle by file path', async () => {
  const url = foundationBundleUrl()
  assert.match(url, /personal-foundation/u)
  const Ctor = await loadFoundationStoreConstructor()
  assert.equal(typeof Ctor, 'function')
})

// ---------- 官方回退 ----------

test('officialExtractionConnection uses DEEPSEEK_API_KEY style input and rejects empty', () => {
  const connection = officialExtractionConnection(' sk-official-test ')
  assert.equal(connection.endpoint, DEEPSEEK_OFFICIAL_ENDPOINT)
  assert.equal(connection.apiKey, 'sk-official-test')
  const custom = officialExtractionConnection('k', 'https://proxy.example.com/v1 ')
  assert.equal(custom.endpoint, 'https://proxy.example.com/v1')
  assert.equal(officialExtractionConnection(''), null)
  assert.equal(officialExtractionConnection(undefined), null)
})

// ---------- 轮末管线 ----------

const TURN_SESSION = { header: { id: 'session-1' } }
const SUBAGENT_SESSION = { header: { id: 'session-sub', delegationDepth: 1 } }

function userEvent(text, source = 'user') {
  return { type: 'user/message', data: { source: { kind: source }, content: [{ type: 'text', text }] } }
}
function assistantEvent(text) {
  return { type: 'assistant/message', data: { turn: 1, step: 1, message: { content: [{ type: 'text', text }] } } }
}
function turnEndEvent(turn = 1, kind = 'completed') {
  return { type: 'turn/end', data: { turn, reason: { kind } } }
}

test('turn-end pipeline extracts candidates, binds project, and is idempotent per turn', async () => {
  const { root, service } = fixture()
  try {
    service.registerProject('proj-A')
    const fetchImpl = async () => new Response(JSON.stringify({
      choices: [{ message: { content: '{"candidates":[{"kind":"pattern","scope":"global_user","text":"轮末提取管线全链路运转正常","confidence":60},{"kind":"event","scope":"project","text":"项目事件：修复了同步任务的锁冲突"}]}' } }],
    }), { status: 200, headers: { 'content-type': 'application/json' } })
    const outcomes = []
    const extractor = createTurnEndExtractor({
      service,
      runtime: () => Promise.resolve({ findConnection: async () => ({ endpoint: 'https://api.example.com/v1', apiKey: 'k', label: '提取模型' }) }),
      bindings: new Map([['session-1', 'proj-A']]),
      model: 'deepseek-v4-flash',
      maxContextChars: 1500,
      timeoutMs: 30_000,
      fetchImpl,
      disableThinking: true,
      onOutcome: (outcome) => { outcomes.push(outcome) },
    })
    extractor.onEvent(TURN_SESSION, userEvent('帮我修一下这个同步任务，注意以后别犯这个坑'))
    extractor.onEvent(TURN_SESSION, assistantEvent('已修复。根因是锁没释放，教训是事务结束必须显式提交或回滚。'))
    extractor.onEvent(TURN_SESSION, turnEndEvent(7))
    await extractor.flush()
    assert.equal(outcomes.length, 1)
    assert.equal(outcomes[0].kind, 'ok')
    assert.match(outcomes[0].detail, /写入 2 条候选/u)
    const globalCandidates = service.listCandidates({ scope: 'global_user' })
    const projectCandidates = service.listCandidates({ scope: 'project', projectId: 'proj-A' })
    assert.match(globalCandidates, /轮末提取管线全链路运转正常/u)
    assert.match(projectCandidates, /同步任务的锁冲突/u)
    // 同轮重放（幂等键相同）不产生重复
    extractor.onEvent(TURN_SESSION, userEvent('帮我修一下这个同步任务，注意以后别犯这个坑'))
    extractor.onEvent(TURN_SESSION, assistantEvent('已修复。根因是锁没释放，教训是事务结束必须显式提交或回滚。'))
    extractor.onEvent(TURN_SESSION, turnEndEvent(7))
    await extractor.flush()
    assert.equal(outcomes.length, 2)
    assert.equal(outcomes[1].kind, 'ok')
    assert.match(outcomes[1].detail, /写入 0 条候选/u)
    assert.equal((globalCandidates.match(/轮末提取管线全链路运转正常/gu) ?? []).length, 1)
    assert.equal((projectCandidates.match(/同步任务的锁冲突/gu) ?? []).length, 1)
  } finally {
    service.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test('turn-end pipeline gates: paused, subagent, injected source, error turns, no connection', async () => {
  const { root, service } = fixture()
  try {
    const fakeFetch = async () => {
      throw new Error('fetch 不应被调用')
    }
    let connectionCalls = 0
    const outcomes = []
    const extractor = createTurnEndExtractor({
      service,
      runtime: () => Promise.resolve({
        findConnection: async () => {
          connectionCalls += 1
          return { endpoint: 'https://api.example.com/v1', apiKey: 'k', label: 'm' }
        },
      }),
      bindings: new Map(),
      model: 'm',
      maxContextChars: 1500,
      timeoutMs: 30_000,
      fetchImpl: fakeFetch,
      onOutcome: (outcome) => { outcomes.push(outcome) },
    })
    const lesson = '记住这个教训：X 之后要清理缓存'
    const reply = '好的，已记录：X 之后必须清理缓存，否则会出现脏数据。'
    // 1) 暂停态：连连接查找都不发生
    service.setPaused(true)
    extractor.onEvent(TURN_SESSION, userEvent(lesson))
    extractor.onEvent(TURN_SESSION, assistantEvent(reply))
    extractor.onEvent(TURN_SESSION, turnEndEvent(1))
    await extractor.flush()
    assert.equal(connectionCalls, 0)
    service.setPaused(false)
    // 2) 子代理会话
    extractor.onEvent(SUBAGENT_SESSION, userEvent(lesson))
    extractor.onEvent(SUBAGENT_SESSION, assistantEvent(reply))
    extractor.onEvent(SUBAGENT_SESSION, turnEndEvent(1))
    await extractor.flush()
    assert.equal(connectionCalls, 0)
    // 3) 插件注入的 user/message 不进入提取
    extractor.onEvent(TURN_SESSION, userEvent('系统注入的上下文', 'plugin'))
    extractor.onEvent(TURN_SESSION, assistantEvent('收到了。这段回复足够长，但用户文本为空所以需求门不满足。'))
    extractor.onEvent(TURN_SESSION, turnEndEvent(2))
    await extractor.flush()
    assert.equal(connectionCalls, 0)
    // 4) 报错轮
    extractor.onEvent(TURN_SESSION, userEvent(lesson))
    extractor.onEvent(TURN_SESSION, assistantEvent(reply))
    extractor.onEvent(TURN_SESSION, turnEndEvent(3, 'error'))
    await extractor.flush()
    assert.equal(connectionCalls, 0)
    // 5) 无连接 → 静默跳过
    const noConn = createTurnEndExtractor({
      service,
      runtime: () => Promise.resolve({ findConnection: async () => null }),
      bindings: new Map(),
      model: 'm',
      maxContextChars: 1500,
      timeoutMs: 30_000,
      fetchImpl: fakeFetch,
      onOutcome: (outcome) => { outcomes.push(outcome) },
    })
    noConn.onEvent(TURN_SESSION, userEvent(lesson))
    noConn.onEvent(TURN_SESSION, assistantEvent(reply))
    noConn.onEvent(TURN_SESSION, turnEndEvent(4))
    await noConn.flush()
    assert.equal(service.listCandidates({ scope: 'global_user' }), '当前没有待处理候选（scope: global_user/user:cyrus）。')
    // 观测断言：暂停 / 无连接两处留下 outcome，其余门不产出
    assert.deepEqual(outcomes.map((o) => o.kind), ['paused', 'no-connection'])
  } finally {
    service.close()
    rmSync(root, { recursive: true, force: true })
  }
})

// ---------- 失败观测 ----------

test('failed extraction reports an outcome instead of throwing', async () => {
  const { root, service } = fixture()
  try {
    const outcomes = []
    const extractor = createTurnEndExtractor({
      service,
      runtime: () => Promise.resolve({ findConnection: async () => ({ endpoint: 'https://api.example.com/v1', apiKey: 'k', label: 'm' }) }),
      bindings: new Map(),
      model: 'm',
      maxContextChars: 1500,
      timeoutMs: 30_000,
      fetchImpl: async () => { throw new ExtractorError('PROVIDER_TIMEOUT', '提取模型服务响应超时。') },
      onOutcome: (outcome) => { outcomes.push(outcome) },
    })
    extractor.onEvent(TURN_SESSION, userEvent('记住这个教训：发布前必须先跑完整预检'))
    extractor.onEvent(TURN_SESSION, assistantEvent('好的，教训是发布前必须先跑完整预检，否则会出现打包事故。'))
    extractor.onEvent(TURN_SESSION, turnEndEvent(9))
    await extractor.flush()
    assert.equal(outcomes.length, 1)
    assert.equal(outcomes[0].kind, 'failed')
    assert.match(outcomes[0].detail, /响应超时/u)
    assert.equal(service.listCandidates({ scope: 'global_user' }), '当前没有待处理候选（scope: global_user/user:cyrus）。')
  } finally {
    service.close()
    rmSync(root, { recursive: true, force: true })
  }
})

// ---------- 项目绑定桥 ----------

async function postJson(port, body, headers = {}) {
  const response = await fetch('http://127.0.0.1:' + String(port) + MEMORY_CONTEXT_API_PREFIX, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-dsh-console': '1', ...headers },
    body: JSON.stringify(body),
  })
  return { status: response.status, payload: await response.json() }
}

test('context bridge binds session to project, registers it, and rejects bad input', async () => {
  const registered = []
  const bindings = new Map()
  const handler = createMemoryContextRequestHandler({
    service: { registerProject: (id) => { registered.push(id); return { projectId: id, shardLocator: 'x' } } },
    bindings,
  })
  const server = createServer(handler)
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const { port } = server.address()
  try {
    const ok = await postJson(port, { sessionId: 's-1', projectId: 'proj-A' })
    assert.equal(ok.status, 200)
    assert.equal(ok.payload.data.projectId, 'proj-A')
    assert.deepEqual(registered, ['proj-A'])
    assert.equal(bindings.get('s-1'), 'proj-A')

    // 解绑
    const unbind = await postJson(port, { sessionId: 's-1', projectId: null })
    assert.equal(unbind.status, 200)
    assert.equal(bindings.get('s-1'), undefined)

    // 缺控制台头 → 403
    const noHeader = await fetch('http://127.0.0.1:' + String(port) + MEMORY_CONTEXT_API_PREFIX, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 's-1' }),
    })
    assert.equal(noHeader.status, 403)

    // 非法 projectId → 400
    const bad = await postJson(port, { sessionId: 's-1', projectId: 'a/b' })
    assert.equal(bad.status, 400)

    // GET → 405
    const get = await fetch('http://127.0.0.1:' + String(port) + MEMORY_CONTEXT_API_PREFIX, {
      headers: { 'x-dsh-console': '1' },
    })
    assert.equal(get.status, 405)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})
