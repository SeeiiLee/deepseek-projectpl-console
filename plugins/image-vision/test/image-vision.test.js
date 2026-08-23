import assert from 'node:assert/strict'
import { createServer, request as httpRequest } from 'node:http'
import test from 'node:test'

import {
  analyzeImage,
  ImageVisionError,
  parseOmnibusResult,
} from '../src/image-vision.ts'
import { createImageVisionRequestHandler, foundationBundleUrl, IMAGE_VISION_API_PREFIX } from '../src/index.ts'

test('foundation bundle resolves by file path and exports PersonalStore', async () => {
  const url = foundationBundleUrl()
  assert.match(url, /personal-foundation/u)
  const bundle = await import(url)
  assert.equal(typeof bundle.PersonalStore, 'function')
})

test('parseOmnibusResult accepts JSON, fenced JSON and degrades to raw text', () => {
  assert.deepEqual(parseOmnibusResult('{"summary":"一张票","ocr":"票价 5 元","uiAnalysis":"不适用"}'), {
    summary: '一张票',
    ocr: '票价 5 元',
    uiAnalysis: '不适用',
  })
  const fenced = '好的，以下是结果：\n```json\n{"summary":"登录页","ocr":"登录","uiAnalysis":"表单布局"}\n```'
  assert.deepEqual(parseOmnibusResult(fenced), {
    summary: '登录页',
    ocr: '登录',
    uiAnalysis: '表单布局',
  })
  assert.deepEqual(parseOmnibusResult(''), {
    summary: '（模型返回为空）',
    ocr: '',
    uiAnalysis: '不适用',
  })
  const plain = parseOmnibusResult('这是一张日落的照片。')
  assert.equal(plain.summary, '这是一张日落的照片。')
})

test('analyzeImage posts an OpenAI-compatible vision call and maps provider errors', async () => {
  let captured
  const fakeFetch = async (input, init = {}) => {
    captured = {
      url: String(input),
      headers: init.headers ?? {},
      body: JSON.parse(String(init.body ?? '{}')),
    }
    return new Response(JSON.stringify({
      model: 'qwen-vl-plus',
      choices: [{ message: { content: '{"summary":"界面截图","ocr":"保存","uiAnalysis":"按钮布局"}' } }],
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  const result = await analyzeImage({
    endpoint: 'https://api.example.com/v1',
    apiKey: 'sk-test',
    model: 'qwen-vl-plus',
    mimeType: 'image/png',
    base64: 'aGVsbG8=',
  }, { fetchImpl: fakeFetch })
  assert.equal(result.summary, '界面截图')
  assert.equal(result.uiAnalysis, '按钮布局')
  assert.equal(result.provider, 'api.example.com')
  assert.equal(result.model, 'qwen-vl-plus')
  assert.equal(captured.url, 'https://api.example.com/v1/chat/completions')
  assert.equal(captured.headers.authorization, 'Bearer sk-test')
  const contentBlocks = captured.body.messages[0].content
  assert.equal(contentBlocks[0].type, 'text')
  assert.equal(contentBlocks[1].type, 'image_url')
  assert.deepEqual(contentBlocks[1].image_url, { url: 'data:image/png;base64,aGVsbG8=' })

  const unauthorized = async () => new Response('{}', { status: 401 })
  await assert.rejects(
    () => analyzeImage({ endpoint: 'https://api.example.com/v1', apiKey: 'bad', model: 'm', mimeType: 'image/png', base64: 'x' }, { fetchImpl: unauthorized }),
    error => error instanceof ImageVisionError && error.code === 'PROVIDER_AUTH_FAILED',
  )
})

const FAKE_CONNECTIONS = [
  { id: 'conn-model-1', label: '我的视觉模型', kind: 'model', enabled: true, endpointRef: 'personal:conn-model-1:ENDPOINT', secretRef: 'personal:conn-model-1:SECRET' },
  { id: 'conn-model-2', label: '停用的模型', kind: 'model', enabled: false, endpointRef: 'personal:conn-model-2:ENDPOINT', secretRef: 'personal:conn-model-2:SECRET' },
  { id: 'conn-webhook-1', label: '机器人', kind: 'webhook', enabled: true, endpointRef: 'personal:conn-webhook-1:ENDPOINT', secretRef: 'personal:conn-webhook-1:SECRET' },
]

function fakeRuntime(providerOrigin) {
  return {
    store: {
      read: async () => ({ connections: FAKE_CONNECTIONS }),
    },
    credentials: {
      describe: async () => ({ configured: true, writable: true }),
      resolve: async reference => ({
        value: String(reference).includes('ENDPOINT') ? providerOrigin : 'sk-local-test',
        source: 'file',
      }),
    },
    uploads: new Map(),
  }
}

async function serve(runtime) {
  const server = createServer(createImageVisionRequestHandler(runtime))
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  assert.equal(typeof address, 'object')
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () => new Promise(resolve => { server.close(resolve) }),
  }
}

async function api(origin, resource, init = {}) {
  const response = await fetch(`${origin}${IMAGE_VISION_API_PREFIX}${resource}`, {
    ...init,
    headers: { 'x-dsh-image-vision': '1', ...init.headers },
  })
  return { response, payload: await response.json() }
}

test('serves the upload → analyze flow against a mock provider', async t => {
  const provider = createServer((request, response) => {
    let body = ''
    request.on('data', chunk => { body += chunk })
    request.on('end', () => {
      assert.equal(request.headers.authorization, 'Bearer sk-local-test')
      const parsed = JSON.parse(body)
      assert.equal(parsed.model, 'qwen-vl-plus')
      assert.deepEqual(parsed.messages[0].content.map(block => block.type), ['text', 'image_url'])
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ model: 'qwen-vl-plus', choices: [{ message: { content: '{"summary":"收据","ocr":"合计 12 元","uiAnalysis":"不适用"}' } }] }))
    })
  })
  await new Promise((resolve, reject) => { provider.once('error', reject); provider.listen(0, '127.0.0.1', resolve) })
  const providerAddress = provider.address()
  assert.equal(typeof providerAddress, 'object')
  const providerOrigin = `http://127.0.0.1:${providerAddress.port}/v1`
  const runtime = fakeRuntime(providerOrigin)
  const { origin, close } = await serve(runtime)
  t.after(() => {
    void close()
    provider.close()
  })

  const unauthorized = await fetch(`${origin}${IMAGE_VISION_API_PREFIX}/connections`)
  assert.equal(unauthorized.status, 403)

  const connections = await api(origin, '/connections')
  assert.equal(connections.response.status, 200)
  const listed = connections.payload.data.connections
  assert.equal(listed.length, 2, 'only model connections are listed')
  assert.deepEqual(listed.map(item => item.label), ['我的视觉模型', '停用的模型'])

  const upload = await fetch(`${origin}${IMAGE_VISION_API_PREFIX}/upload`, {
    method: 'POST',
    headers: { 'x-dsh-image-vision': '1', 'x-session-id': 'session-1', 'content-type': 'image/png' },
    body: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  })
  const uploadPayload = await upload.json()
  assert.equal(upload.status, 200)
  assert.equal(uploadPayload.data.bytes, 8)

  const analyzed = await api(origin, '/analyze', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: 'session-1', connectionId: 'conn-model-1', model: 'qwen-vl-plus' }),
  })
  assert.equal(analyzed.response.status, 200)
  assert.equal(analyzed.payload.data.result.summary, '收据')
  assert.equal(analyzed.payload.data.result.ocr, '合计 12 元')
  assert.equal(analyzed.payload.data.connectionLabel, '我的视觉模型')
})

test('guards the missing image, disabled connections and absent credentials', async t => {
  const runtime = fakeRuntime('http://127.0.0.1:1/v1')
  const { origin, close } = await serve(runtime)
  t.after(() => { void close() })

  const noImage = await api(origin, '/analyze', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: 'session-none', connectionId: 'conn-model-1', model: 'm' }),
  })
  assert.equal(noImage.response.status, 404)
  assert.equal(noImage.payload.error.code, 'NO_IMAGE')

  await api(origin, '/upload', {
    method: 'POST',
    headers: { 'x-session-id': 'session-2', 'content-type': 'image/png' },
    body: Buffer.from([1, 2, 3]),
  })
  const disabled = await api(origin, '/analyze', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: 'session-2', connectionId: 'conn-model-2', model: 'm' }),
  })
  assert.equal(disabled.response.status, 409)
  assert.equal(disabled.payload.error.code, 'CONNECTION_DISABLED')

  // fetch enforces content-length itself, so the oversized header needs a raw request
  const oversized = await new Promise((resolve, reject) => {
    const target = new URL(`${origin}${IMAGE_VISION_API_PREFIX}/upload`)
    const request = httpRequest(target, {
      method: 'POST',
      headers: { 'x-dsh-image-vision': '1', 'x-session-id': 'session-3', 'content-type': 'image/png', 'content-length': String(15 * 1024 * 1024 + 1) },
    }, response => {
      const chunks = []
      response.on('data', chunk => { chunks.push(chunk) })
      response.once('end', () => { resolve({ status: response.statusCode, payload: JSON.parse(Buffer.concat(chunks).toString('utf8')) }) })
    })
    request.once('error', reject)
    request.end()
  })
  assert.equal(oversized.status, 413)
  assert.equal(oversized.payload.error.code, 'IMAGE_TOO_LARGE')
})