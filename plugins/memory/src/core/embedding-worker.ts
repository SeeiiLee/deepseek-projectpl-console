// P4-2 embedding worker（独立 tsdown 入口 → lib/embedding-worker.js）。
// 只依赖 @huggingface/transformers 与 node 内置；在 worker thread 内持有 tokenizer + ONNX session，
// 避免阻塞 Harness Host 主线程。运行时强制离线：allowRemoteModels=false + HF_HUB_OFFLINE=1（评审 §2.2E）。
import { env, pipeline } from '@huggingface/transformers'
import { parentPort, type MessagePort } from 'node:worker_threads'

env.allowRemoteModels = false
process.env.HF_HUB_OFFLINE = '1'

interface EmbedTensor {
  dims?: number[]
  data?: Float32Array
}

type Extractor = (inputs: string | string[], options?: Record<string, unknown>) => Promise<EmbedTensor | EmbedTensor[]>

let extractor: Extractor | null = null

function noPort(): never { throw new Error('embedding worker 必须由 worker_threads 启动') }
const port: MessagePort = parentPort === null ? noPort() : parentPort

interface WorkerMessage {
  type: string
  id?: number
  modelDir?: string
  dtype?: string
  texts?: string[]
  purpose?: string
  pooling?: string
  queryInstruction?: string
}

function postError(id: number | undefined, error: unknown): void {
  const message = error instanceof Error && error.message !== '' ? error.message : String(error)
  port.postMessage({ type: 'error', id, error: message.slice(0, 1000) })
}

port.on('message', (message: WorkerMessage) => {
  void handle(message).catch((error: unknown) => { postError(message.id, error) })
})

async function handle(message: WorkerMessage): Promise<void> {
  if (message.type === 'init') {
    if (extractor === null) {
      const started = Date.now()
      const dtype = message.dtype === 'q8' || message.dtype === 'fp32' || message.dtype === 'fp16' || message.dtype === 'int8' || message.dtype === 'uint8'
        ? message.dtype
        : 'q8'
      extractor = await pipeline('feature-extraction', String(message.modelDir ?? ''), {
        dtype,
        device: 'cpu', // 评审结论：CPU 默认；DirectML 实测更慢
      })
      port.postMessage({ type: 'ready', loadedMs: Date.now() - started })
    } else {
      port.postMessage({ type: 'ready', loadedMs: 0 })
    }
    return
  }
  if (message.type === 'embed') {
    if (extractor === null) throw new Error('worker 未初始化')
    const prefix = message.purpose === 'query' && typeof message.queryInstruction === 'string' && message.queryInstruction !== ''
      ? message.queryInstruction
      : ''
    const inputs = (message.texts ?? []).map((text) => prefix + text)
    const output = await extractor(inputs, { pooling: message.pooling, normalize: true })
    if (Array.isArray(output)) {
      const count = output.length
      const dimensions = Number(output[0]?.dims?.[1] ?? 0)
      const collected = new Float32Array(count * dimensions)
      for (let i = 0; i < count; i += 1) {
        const data = output[i]?.data
        if (data !== undefined) collected.set(data, i * dimensions)
      }
      const collectedBuffer = collected.buffer as ArrayBuffer
      port.postMessage({ type: 'embedded', id: message.id, vectors: collectedBuffer, count, dimensions }, [collectedBuffer])
      return
    }
    const count = Number(output.dims?.[0] ?? 1)
    const dimensions = Number(output.dims?.[1] ?? 0)
    const data = output.data ?? new Float32Array(0)
    const dataBuffer = data.buffer as ArrayBuffer
    port.postMessage({ type: 'embedded', id: message.id, vectors: dataBuffer, count, dimensions }, [dataBuffer])
    return
  }
  if (message.type === 'health') {
    port.postMessage({ type: 'health', loaded: extractor !== null, modelDir: String(message.modelDir ?? '') })
    return
  }
  throw new Error('未知 worker 消息：' + String(message.type))
}
