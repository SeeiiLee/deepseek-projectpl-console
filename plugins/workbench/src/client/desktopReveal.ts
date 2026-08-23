declare global {
  interface Window {
    deepseekHarnessPersonal?: {
      desktop?: {
        revealInExplorer(path: string): Promise<{ ok: boolean }>
        openPath(path: string): Promise<{ ok: boolean; error?: string }>
        openExternal(url: string): Promise<{ ok: boolean; error?: string }>
        readFileAsDataURL(path: string): Promise<{ ok: boolean; dataUrl?: string; error?: string }>
        getPathForFile(file: File): string
      }
    }
  }
}

/** 本地绝对路径判定（Windows 盘符 / POSIX 根；UNC/网络路径不视作可打开目标）。 */
export function isAbsoluteLocalPath(path: string): boolean {
  if (/^[A-Za-z]:[\\/]/u.test(path)) return true
  return path.startsWith('/') && !path.startsWith('//')
}

/** 远程/内联图片源判定：http(s)、blob:、data: 都不需要本地文件桥。 */
export function isRemoteImageSrc(src: string): boolean {
  return /^https?:\/\//iu.test(src) || src.startsWith('blob:') || src.startsWith('data:')
}

/** 解码 Markdown URL 编码后的路径（%20 等）；非法编码原样返回。 */
export function decodePath(path: string): string {
  try { return decodeURIComponent(path) } catch { return path }
}

/** 落盘用的本地路径规范化：解码转义 + 统一正斜杠（多次保存不漂移、人类可读）。 */
export function canonicalLocalPath(path: string): string {
  return decodePath(path).replace(/\\/gu, '/')
}

/**
 * 解析 Markdown 里的本地引用路径：
 * - 已是绝对路径：统一为正斜杠后返回；
 * - file:/// URL（Typora 等工具会写出这种形式）：剥掉 scheme 还原为普通路径；
 * - 相对路径（./ ../ 裸相对名）：基于文档所在目录 baseDir 拼接，并归一化 . 与 ..；
 * - baseDir 缺失时返回解码后的原样（后续打开会给出失败反馈，而不是静默吞掉）。
 */
export function resolveLocalPath(rawHref: string, baseDir: string | undefined): string {
  let decoded = decodePath(rawHref).replace(/\\/gu, '/')
  if (/^file:\/\//iu.test(decoded)) {
    decoded = decoded.replace(/^file:\/\//iu, '')
    // file:///F:/x → /F:/x → F:/x；file:///home/x → /home/x（POSIX 保留前导斜杠）
    decoded = decoded.replace(/^\/(?=[A-Za-z]:\/)/u, '')
  }
  if (isAbsoluteLocalPath(decoded)) return normalizeSegments(decoded)
  const base = (baseDir ?? '').replace(/\\/gu, '/').replace(/\/+$/u, '')
  if (base === '') return normalizeSegments(decoded)
  return normalizeSegments(base + '/' + decoded)
}

/** 归一化 POSIX 风格路径中的 . 与 .. 段（保留盘符/前导斜杠；.. 不越过根）。 */
function normalizeSegments(path: string): string {
  const isDrive = /^[A-Za-z]:\//u.test(path)
  const prefix = isDrive ? path.slice(0, 3) : path.startsWith('/') ? '/' : ''
  const rest = path.slice(prefix.length)
  const output: string[] = []
  for (const segment of rest.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      if (output.length > 0 && output[output.length - 1] !== '..') output.pop()
      else if (prefix === '') output.push('..')
      continue
    }
    output.push(segment)
  }
  return prefix + output.join('/')
}

/** 在资源管理器中显示本地绝对路径（主进程校验后执行；桥不可用时静默跳过）。 */
export function revealInExplorer(path: string): void {
  const bridge = window.deepseekHarnessPersonal?.desktop
  if (bridge === undefined || typeof bridge.revealInExplorer !== 'function') return
  void bridge.revealInExplorer(path).catch(() => {})
}

/** 用系统默认应用打开本地路径（主进程 shell.openPath）；返回是否成功，供调用方给失败反馈。 */
export async function openPath(path: string): Promise<boolean> {
  const bridge = window.deepseekHarnessPersonal?.desktop
  if (bridge === undefined || typeof bridge.openPath !== 'function') return false
  try {
    const result = await bridge.openPath(path)
    return result.ok === true
  } catch {
    return false
  }
}

/** 用系统默认浏览器打开 http(s) 链接（主进程 shell.openExternal；宿主拦截了渲染进程的一切新窗口）。 */
export async function openExternal(url: string): Promise<boolean> {
  const bridge = window.deepseekHarnessPersonal?.desktop
  if (bridge === undefined || typeof bridge.openExternal !== 'function') return false
  try {
    const result = await bridge.openExternal(url)
    return result.ok === true
  } catch {
    return false
  }
}

/** 读取本地文件为 data URL（用于编辑器内显示本地图片；桥不可用/失败时返回 undefined）。 */
export async function readFileAsDataURL(path: string): Promise<string | undefined> {
  const bridge = window.deepseekHarnessPersonal?.desktop
  if (bridge === undefined || typeof bridge.readFileAsDataURL !== 'function') return undefined
  try {
    const result = await bridge.readFileAsDataURL(path)
    return result.ok === true ? result.dataUrl : undefined
  } catch {
    return undefined
  }
}
