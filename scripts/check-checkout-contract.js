import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, readFileSync } from 'node:fs'
import { extname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPOSITORY_ROOT = resolve(import.meta.dirname, '..')

const CRLF_EXTENSIONS = new Set(['.bat', '.cmd'])
const CRLF_PATHS = new Set(['plugins/memory/src/core/wordlist.ts'])
const BINARY_EXTENSIONS = new Set([
  '.7z', '.asar', '.bin', '.blockmap', '.db', '.dll', '.exe', '.gif', '.gz',
  '.ico', '.jpeg', '.jpg', '.node', '.onnx', '.pdf', '.png', '.sqlite',
  '.sqlite3', '.tgz', '.woff', '.woff2', '.zip',
])

const REQUIRED_ATTRIBUTE_LINES = Object.freeze([
  '* text=auto eol=lf',
  '*.cmd text eol=crlf',
  '*.bat text eol=crlf',
  'plugins/memory/src/core/wordlist.ts text eol=crlf',
])

export function classifyCheckoutPath(relativePath) {
  const normalized = relativePath.replaceAll('\\', '/')
  const extension = extname(normalized).toLowerCase()
  if (BINARY_EXTENSIONS.has(extension)) return 'binary'
  if (CRLF_EXTENSIONS.has(extension) || CRLF_PATHS.has(normalized)) return 'crlf'
  return 'lf'
}

export function inspectEolBytes(bytes, expectedEol) {
  if (expectedEol === 'binary') return []
  const issues = []
  if (expectedEol === 'lf') {
    if (bytes.includes(13)) issues.push('CR_BYTE_IN_LF_FILE')
    return issues
  }
  for (let index = 0; index < bytes.length; index += 1) {
    if (bytes[index] === 10 && (index === 0 || bytes[index - 1] !== 13)) {
      issues.push('BARE_LF_IN_CRLF_FILE')
      break
    }
    if (bytes[index] === 13 && (index + 1 >= bytes.length || bytes[index + 1] !== 10)) {
      issues.push('BARE_CR_IN_CRLF_FILE')
      break
    }
  }
  return issues
}

function listCandidatePaths(repositoryRoot) {
  const output = execFileSync('git', [
    '-C', repositoryRoot, 'ls-files', '-z', '--cached', '--others', '--exclude-standard',
  ])
  return output.toString('utf8').split('\0').filter(Boolean)
}

function checkAttributesFile(repositoryRoot) {
  const path = join(repositoryRoot, '.gitattributes')
  if (!existsSync(path)) return [{ code: 'ATTRIBUTES_MISSING', path: '.gitattributes' }]
  const lines = new Set(readFileSync(path, 'utf8').split(/\r?\n/u).map(line => line.trim()))
  return REQUIRED_ATTRIBUTE_LINES
    .filter(line => !lines.has(line))
    .map(line => ({ code: 'ATTRIBUTE_RULE_MISSING', path: '.gitattributes', detail: line }))
}

export function checkCheckoutContract(repositoryRoot = REPOSITORY_ROOT) {
  const root = resolve(repositoryRoot)
  const failures = checkAttributesFile(root)
  const counts = { scanned: 0, lf: 0, crlf: 0, binary: 0 }
  for (const relativePath of listCandidatePaths(root)) {
    const absolutePath = resolve(root, relativePath)
    const relativeCheck = relative(root, absolutePath)
    if (relativeCheck === '..' || relativeCheck.startsWith(`..${sep}`)) {
      failures.push({ code: 'PATH_OUTSIDE_REPOSITORY', path: relativePath })
      continue
    }
    let stat
    try {
      stat = lstatSync(absolutePath)
    } catch {
      failures.push({ code: 'FILE_UNREADABLE', path: relativePath })
      continue
    }
    if (stat.isSymbolicLink()) {
      failures.push({ code: 'SYMLINK_NOT_ALLOWED', path: relativePath })
      continue
    }
    if (!stat.isFile()) continue
    const expectedEol = classifyCheckoutPath(relativePath)
    counts.scanned += 1
    counts[expectedEol] += 1
    for (const code of inspectEolBytes(readFileSync(absolutePath), expectedEol)) {
      failures.push({ code, path: relativePath })
    }
  }
  return { ok: failures.length === 0, failures, counts }
}

export function renderCheckoutContract(result) {
  if (result.ok) {
    const { scanned, lf, crlf, binary } = result.counts
    return `checkout-contract: PASS (${String(scanned)} files; LF=${String(lf)}; CRLF=${String(crlf)}; binary=${String(binary)})`
  }
  const details = result.failures.slice(0, 50).map(failure => {
    const suffix = failure.detail === undefined ? '' : ` [${failure.detail}]`
    return `checkout-contract: FAIL ${failure.code} ${failure.path}${suffix}`
  })
  if (result.failures.length > details.length) {
    details.push(`checkout-contract: FAIL ${String(result.failures.length - details.length)} more issue(s)`)
  }
  return details.join('\n')
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = checkCheckoutContract()
  process.stdout.write(`${renderCheckoutContract(result)}\n`)
  process.exit(result.ok ? 0 : 1)
}
