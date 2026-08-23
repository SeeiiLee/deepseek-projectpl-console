import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { createImageVisionApi, type ImageVisionResult, type ModelConnectionSummary } from './imageVisionApi.ts'
import css from './ImageVisionDock.module.css'

const api = createImageVisionApi()

const MAX_IMAGE_BYTES = 15 * 1024 * 1024
const MODEL_PREFS_KEY = '@cyrus/dsh-image-vision:model:v1'

export type ImageVisionDockProps = PropsRuntime<'shell.overlay'>

interface DraftImage {
  blob: Blob
  name: string
  preview: string
}

function loadSavedModel(): string {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(MODEL_PREFS_KEY)
    return typeof raw === 'string' && raw.trim() !== '' ? raw.trim().slice(0, 200) : 'qwen-vl-plus'
  } catch {
    return 'qwen-vl-plus'
  }
}

function saveModel(model: string): void {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(MODEL_PREFS_KEY, model.trim().slice(0, 200))
  } catch {
    // Storage denial never breaks the dock.
  }
}

/**
 * Chat-adjacent image vision dock: pick an image, pick a configured model
 * connection, and read the omnibus result (OCR + description + UI analysis)
 * beside the conversation. Results are copyable and reusable in follow-ups.
 */
export function ImageVisionDock({ useSessions }: ImageVisionDockProps): ReactNode {
  const sessionId = useSessions(state => state.current)
  const [expanded, setExpanded] = useState(false)
  const [connections, setConnections] = useState<readonly ModelConnectionSummary[]>([])
  const [connectionId, setConnectionId] = useState<string>('')
  const [model, setModel] = useState(loadSavedModel)
  const [image, setImage] = useState<DraftImage>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [result, setResult] = useState<ImageVisionResult & { connectionLabel?: string }>()
  const fileInput = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!expanded) return
    const controller = new AbortController()
    api.listConnections(controller.signal)
      .then(items => {
        if (controller.signal.aborted) return
        setConnections(items)
        setConnectionId(current => items.some(item => item.id === current) ? current : items[0]?.id ?? '')
      })
      .catch(() => { if (!controller.signal.aborted) setError('模型连接列表读取失败。') })
    return () => { controller.abort() }
  }, [expanded])

  const pickImage = (): void => { fileInput.current?.click() }

  const onFileChosen = (files: FileList | null): void => {
    const file = files?.[0]
    setError(undefined)
    setResult(undefined)
    if (file === undefined) return
    if (!file.type.startsWith('image/')) {
      setError('请选择图片文件。')
      return
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setError('图片超过 15 MiB 上限。')
      return
    }
    setImage({ blob: file, name: file.name, preview: URL.createObjectURL(file) })
  }

  const run = async (): Promise<void> => {
    if (busy || image === undefined) return
    if (sessionId === undefined) {
      setError('当前没有活动会话。')
      return
    }
    const selected = connections.find(item => item.id === connectionId)
    if (selected === undefined) {
      setError('请先在连接中心配置一个“模型服务（识图等）”连接。')
      return
    }
    if (model.trim() === '') {
      setError('请填写模型名。')
      return
    }
    setBusy(true)
    setError(undefined)
    setResult(undefined)
    try {
      await api.upload(String(sessionId), image.blob)
      const analyzed = await api.analyze(String(sessionId), selected.id, model.trim())
      setResult({ ...analyzed.result, connectionLabel: analyzed.connectionLabel })
      saveModel(model)
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : '识别没有完成。')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={css.dock} data-personal-image-vision data-expanded={expanded || undefined}>
      {expanded ? (
        <div className={css.panel} role="dialog" aria-label="识图面板">
          <div className={css.header}>
            <strong>🖼 识图</strong>
            <button className={css.closeButton} type="button" aria-label="收起识图面板" onClick={() => { setExpanded(false) }}>×</button>
          </div>
          <div className={css.field}>
            <span>模型连接</span>
            <select value={connectionId} disabled={busy} onChange={event => { setConnectionId(event.target.value) }}>
              {connections.length === 0 && <option value="">暂无模型连接</option>}
              {connections.map(item => (
                <option key={item.id} value={item.id}>
                  {item.label}{item.enabled ? '' : '（已停用）'}
                </option>
              ))}
            </select>
            {connections.length === 0 && (
              <small>请先在「连接中心」添加“模型服务（识图等）”。</small>
            )}
          </div>
          <label className={css.field}>
            <span>模型名（视觉模型）</span>
            <input type="text" maxLength={200} value={model} disabled={busy} placeholder="例如 qwen-vl-plus / gpt-4o-mini" onChange={event => { setModel(event.target.value) }} />
          </label>
          <div className={css.field}>
            <span>图片（≤ 15 MiB，单张）</span>
            <input ref={fileInput} className={css.fileInput} type="file" accept="image/*" onChange={event => { onFileChosen(event.target.files); event.target.value = '' }} />
            {image === undefined ? (
              <button className={css.pickButton} type="button" disabled={busy} onClick={pickImage}>选择图片</button>
            ) : (
              <div className={css.imageRow}>
                <img className={css.thumbnail} src={image.preview} alt="待识别图片" />
                <span>{image.name}</span>
                <button className={css.pickButton} type="button" disabled={busy} onClick={pickImage}>更换</button>
              </div>
            )}
          </div>
          <button
            className={css.analyzeButton}
            type="button"
            disabled={busy || image === undefined || sessionId === undefined || connectionId === ''}
            onClick={() => { void run() }}
          >
            {busy ? '识别中…' : '开始识别'}
          </button>
          {error !== undefined && <p className={css.error} role="alert">{error}</p>}
          {result !== undefined && (
            <div className={css.result} data-image-vision-result>
              <div className={css.resultMeta}>
                <span>{result.connectionLabel ?? '模型'}</span>
                <span>{result.model}</span>
                <span>{result.provider}</span>
              </div>
              <ResultSection title="概括" text={result.summary} />
              {result.ocr !== '' && <ResultSection title="OCR 文字" text={result.ocr} />}
              {result.uiAnalysis !== '' && result.uiAnalysis !== '不适用' && <ResultSection title="界面分析" text={result.uiAnalysis} />}
              <p className={css.hint}>结果已显示在这里，可逐段复制后回到聊天继续追问。</p>
            </div>
          )}
        </div>
      ) : (
        <button className={css.toggle} type="button" aria-label="打开识图面板" onClick={() => { setExpanded(true) }}>
          🖼 识图
        </button>
      )}
    </div>
  )
}

function ResultSection({ title, text }: { title: string; text: string }): ReactNode {
  const [copied, setCopied] = useState(false)
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => { setCopied(false) }, 1200)
    } catch {
      // clipboard may be unavailable; the text remains selectable
    }
  }
  return (
    <section className={css.resultSection}>
      <div className={css.resultSectionHeader}>
        <strong>{title}</strong>
        <button className={css.copyButton} type="button" onClick={() => { void copy() }}>{copied ? '已复制' : '复制'}</button>
      </div>
      <p className={css.resultText}>{text}</p>
    </section>
  )
}