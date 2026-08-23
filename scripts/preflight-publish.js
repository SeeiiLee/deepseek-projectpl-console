import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

// Pre-publish red line (Cyrus's rule): nothing pushed to GitHub may contain
// sessions, personal data, keys or tokens. This guard scans the exact files
// that electron-builder ships inside the packaged app and BLOCKS the build on
// any credential-shaped content; personal-path references in the repo docs
// are reported (not blocked) so release notes can be sanitized by a human.

const projectRoot = resolve(process.env.DSH_PREFLIGHT_PROJECT_ROOT ?? join(import.meta.dirname, '..'))

const BLOCKING_PATTERNS = [
  { label: 'GitHub fine-grained PAT', pattern: /github_pat_[A-Za-z0-9_]{20,}/u },
  { label: 'GitHub classic PAT', pattern: /ghp_[A-Za-z0-9]{20,}/u },
  { label: 'GitHub OAuth token', pattern: /gho_[A-Za-z0-9]{20,}/u },
  { label: 'GitHub app token', pattern: /ghs_[A-Za-z0-9]{20,}/u },
  { label: 'OpenAI-style API key', pattern: /sk-[A-Za-z0-9]{20,}/u },
  { label: 'AWS access key', pattern: /AKIA[0-9A-Z]{16}/u },
  { label: 'private key block', pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u },
  { label: 'Slack token', pattern: /xox[baprs]-[A-Za-z0-9-]{10,}/u },
]

const REPORT_PATTERNS = [
  { label: 'personal data path', pattern: /F:\\QClawData|F:\\documents\\Cyrus|D:\\Cyrus Deepseek Harness|C:\\Users\\Administrator/u },
]

const SHIPPED_ROOTS = [
  join(projectRoot, 'src'),
  join(projectRoot, 'assets'),
  join(projectRoot, 'plugins'),
  join(projectRoot, 'protocol'),
]

const FORBIDDEN_SHIPPED_NAMES = ['.credentials.yaml', 'key.txt', 'secrets.encrypted.json', 'audit.json']
const FORBIDDEN_SHIPPED_EXTENSIONS = ['.sqlite3', '.sqlite3-wal', '.sqlite3-shm']

function walkFiles(root, output = []) {
  if (!existsSync(root)) return output
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue
    const path = join(root, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'test' && relative(projectRoot, root).startsWith('plugins')) continue
      walkFiles(path, output)
    } else if (entry.isFile()) {
      output.push(path)
    }
  }
  return output
}

const shippedFiles = SHIPPED_ROOTS.flatMap((root) => walkFiles(root))
const blocking = []
for (const path of shippedFiles) {
  const name = path.split('\\').at(-1) ?? path
  if (FORBIDDEN_SHIPPED_NAMES.includes(name)) {
    blocking.push(path + ' (forbidden data file name)')
  }
  if (FORBIDDEN_SHIPPED_EXTENSIONS.some((extension) => name.toLowerCase().endsWith(extension))) {
    blocking.push(path + ' (database file must not ship)')
  }
  let text
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    continue
  }
  for (const { label, pattern } of BLOCKING_PATTERNS) {
    if (pattern.test(text)) {
      blocking.push(path + ' contains ' + label)
      break
    }
  }
}

const reports = []
for (const path of walkFiles(join(projectRoot, 'docs'))) {
  let text
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    continue
  }
  for (const { label, pattern } of REPORT_PATTERNS) {
    if (pattern.test(text)) {
      reports.push(relative(projectRoot, path) + ' references ' + label)
      break
    }
  }
}

if (blocking.length > 0) {
  process.stderr.write('publish preflight BLOCKED:\n')
  for (const line of blocking) process.stderr.write('  - ' + line + '\n')
  process.exit(1)
}
if (reports.length > 0) {
  process.stdout.write('publish preflight: no secrets shipped; ' + String(reports.length) + ' doc file(s) reference personal paths for human review before writing release notes:\n')
  for (const line of reports) process.stdout.write('  - ' + line + '\n')
}
process.stdout.write('publish preflight passed: ' + String(shippedFiles.length) + ' shipped files scanned, zero secrets.\n')
