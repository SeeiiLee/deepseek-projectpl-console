// 项目工作区有界读取：为「已登记项目」服务目录树/文件内容（workbench 文件树绑定项目用）。
// 与 workbench 工作区远端同约束：根目录由 Project Control 存储的 activeLocation 决定，
// 客户端永远不能命名任意根；读取有界（条目/字节上限）、符号链接逃逸检查、忽略目录黑名单。
import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"
import { readdir, readFile, realpath, stat } from "node:fs/promises"
import type { ServerResponse } from "node:http"
import { isAbsolute, resolve, sep } from "node:path"
import { projectControlHttpError } from "./http.ts"

export const PROJECT_WORKSPACE_MAX_TREE_ENTRIES = 200
export const PROJECT_WORKSPACE_MAX_SEARCH_DEPTH = 8
export const PROJECT_WORKSPACE_MAX_SEARCH_RESULTS = 100
export const PROJECT_WORKSPACE_MAX_TEXT_BYTES = 262_144
export const PROJECT_WORKSPACE_MAX_BLOB_BYTES = 5 * 1024 * 1024

const IGNORED_DIRECTORIES = new Set([
  '.git', '.hg', '.svn', 'node_modules', 'dist', 'build', 'out', 'target',
  'coverage', '.next', 'artifacts', '.cache', 'cache', '__pycache__',
  '.pnpm-store', '.yarn', 'tmp', '$recycle.bin', 'lib', '分发包',
])

const TEXT_EXTENSIONS = new Set(['.md', '.markdown', '.mdx', '.txt', '.rst', '.json', '.jsonc', '.yml', '.yaml', '.toml', '.ini', '.cfg', '.env', '.gitignore', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.css', '.html', '.htm', '.xml', '.csv', '.log', '.sql', '.sh', '.ps1', '.bat', '.cmd', '.py', '.rs', '.go', '.java', '.c', '.h', '.cpp', '.hpp', '.cs', '.rb', '.php', '.swift', '.kt', '.vue', '.svelte', '.scss', '.less'])

function workspaceHttpError(code: string, message: string, status: number): Error {
  return projectControlHttpError(code, message, status)
}

function safeRelativePath(_root: string, relativePath: string): string {
  if (typeof relativePath !== 'string' || relativePath.length > 2048) {
    throw workspaceHttpError('PATH_INVALID', '工作区路径无效。', 400)
  }
  if (relativePath.includes('\u0000') || relativePath.startsWith('/') || relativePath.startsWith('\\') || isAbsolute(relativePath)) {
    throw workspaceHttpError('PATH_INVALID', '工作区路径无效。', 400)
  }
  return relativePath
}

async function resolveInside(root: string, relativePath: string): Promise<string> {
  const safe = safeRelativePath(root, relativePath)
  const absolute = resolve(root, safe)
  const below = absolute === root || absolute.startsWith(root + sep)
  if (!below) throw workspaceHttpError('PATH_OUTSIDE_WORKSPACE', '路径超出工作区。', 403)
  const realRoot = await realpath(root)
  const real = await realpath(absolute).catch(() => null)
  if (real !== null && real !== realRoot && !real.startsWith(realRoot + sep)) {
    throw workspaceHttpError('SYMLINK_ESCAPE', '路径通过符号链接逃出了工作区。', 403)
  }
  return absolute
}

function sha256(buffer: Buffer): string {
  return 'sha256:' + createHash('sha256').update(buffer).digest('hex')
}

function mimeFor(relativePath: string): string {
  const extension = relativePath.slice(relativePath.lastIndexOf('.')).toLowerCase()
  switch (extension) {
    case '.png': return 'image/png'
    case '.jpg': case '.jpeg': return 'image/jpeg'
    case '.webp': return 'image/webp'
    case '.gif': return 'image/gif'
    case '.svg': return 'image/svg+xml'
    case '.pdf': return 'application/pdf'
    case '.txt': case '.md': case '.log': return 'text/plain; charset=utf-8'
    default: return 'application/octet-stream'
  }
}

export async function listProjectWorkspaceTree(root: string, relativePath: string): Promise<{ entries: Array<{ name: string; kind: 'directory' | 'file'; byteSize?: number }>; truncated: boolean }> {
  const target = await resolveInside(root, relativePath)
  const info = await stat(target).catch(() => null)
  if (info === null || !info.isDirectory()) throw workspaceHttpError('NOT_A_DIRECTORY', '目标不是目录。', 404)
  const names = await readdir(target, { withFileTypes: true })
  const entries: Array<{ name: string; kind: 'directory' | 'file'; byteSize?: number }> = names
    .filter((entry) => !entry.name.startsWith('.dsh-staging.') && !IGNORED_DIRECTORIES.has(entry.name.toLowerCase()))
    .slice(0, PROJECT_WORKSPACE_MAX_TREE_ENTRIES)
    .map((entry) => ({
      name: entry.name,
      kind: entry.isDirectory() ? 'directory' as const : 'file' as const,
      ...(entry.isDirectory() ? {} : { byteSize: 0 }),
    }))
  const sorted = entries.sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === 'directory' ? -1 : 1
    return left.name.localeCompare(right.name, 'en')
  })
  return { entries: sorted, truncated: names.length > PROJECT_WORKSPACE_MAX_TREE_ENTRIES }
}

export async function readProjectWorkspaceFile(root: string, relativePath: string): Promise<Record<string, unknown>> {
  const target = await resolveInside(root, relativePath)
  const info = await stat(target).catch(() => null)
  if (info === null || !info.isFile()) throw workspaceHttpError('NOT_A_FILE', '目标不是文件。', 404)
  if (info.size > PROJECT_WORKSPACE_MAX_BLOB_BYTES) {
    return { kind: 'binary', byteSize: info.size, tooLarge: true, mime: mimeFor(target) }
  }
  const extension = target.slice(target.lastIndexOf('.')).toLowerCase()
  if (!TEXT_EXTENSIONS.has(extension)) {
    return { kind: 'binary', byteSize: info.size, mime: mimeFor(target) }
  }
  const buffer = await readFile(target)
  if (buffer.includes(0)) {
    return { kind: 'binary', byteSize: info.size, mime: mimeFor(target) }
  }
  const truncated = buffer.length > PROJECT_WORKSPACE_MAX_TEXT_BYTES
  const content = buffer.subarray(0, PROJECT_WORKSPACE_MAX_TEXT_BYTES).toString('utf8')
  return { kind: 'text', content, truncated, byteSize: info.size, sha256: sha256(buffer) }
}

export async function searchProjectWorkspaceFiles(root: string, query: string): Promise<Array<{ path: string; name: string }>> {
  const results: Array<{ path: string; name: string }> = []
  const queue: string[] = ['']
  while (queue.length > 0 && results.length < PROJECT_WORKSPACE_MAX_SEARCH_RESULTS) {
    const dirPath = queue.shift() ?? ''
    const depth = dirPath === '' ? 0 : dirPath.split('/').length
    if (depth >= PROJECT_WORKSPACE_MAX_SEARCH_DEPTH) continue
    const target = await resolveInside(root, dirPath)
    const info = await stat(target).catch(() => null)
    if (info === null || !info.isDirectory()) continue
    const names = await readdir(target, { withFileTypes: true })
    for (const entry of names) {
      if (entry.name.startsWith('.dsh-staging.') || IGNORED_DIRECTORIES.has(entry.name.toLowerCase())) continue
      const child = dirPath === '' ? entry.name : dirPath + '/' + entry.name
      if (entry.isDirectory()) {
        if (queue.length < PROJECT_WORKSPACE_MAX_TREE_ENTRIES * PROJECT_WORKSPACE_MAX_SEARCH_DEPTH) queue.push(child)
      } else if (entry.name.toLowerCase().includes(query)) {
        results.push({ path: child, name: entry.name })
        if (results.length >= PROJECT_WORKSPACE_MAX_SEARCH_RESULTS) break
      }
    }
  }
  return results
}

export async function streamProjectWorkspaceBlob(response: ServerResponse, root: string, relativePath: string): Promise<void> {
  const target = await resolveInside(root, relativePath)
  const info = await stat(target).catch(() => null)
  if (info === null || !info.isFile()) throw workspaceHttpError('NOT_A_FILE', '目标不是文件。', 404)
  if (info.size > PROJECT_WORKSPACE_MAX_BLOB_BYTES) throw workspaceHttpError('BLOB_TOO_LARGE', '文件超过预览上限。', 413)
  response.writeHead(200, {
    'content-type': mimeFor(target),
    'content-length': String(info.size),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  await new Promise<void>((resolveStream, rejectStream) => {
    const stream = createReadStream(target)
    stream.once('error', rejectStream)
    stream.once('end', () => { resolveStream() })
    stream.pipe(response)
  })
}
