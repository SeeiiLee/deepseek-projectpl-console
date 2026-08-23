// scripts/check-governance.js — 治理门禁（Wave 0 可观测 + Wave 1 路径/进程守卫在位检查）
// 只读聚合检查，任何一项 FAIL 即 exit 1。接入：npx pnpm run check:governance
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { CANONICAL_PATH } from './project-global-agents.js'
import { PROTECTED_ROOTS, REPOSITORY_ROOT } from './protected-paths.js'

const failures = []
const checks = []
function check(name, ok, detail = '') {
  checks.push({ name, ok, detail })
  if (!ok) failures.push(name)
}

// 1. 受保护根
check('protected roots defined (>=5)', PROTECTED_ROOTS.length >= 5)
for (const root of PROTECTED_ROOTS) {
  check('protected root listed: ' + root, typeof root === 'string' && root.length > 2)
}

// 2. System Policy 插件四处上架 + 产物
const personalPlugins = readFileSync(join(REPOSITORY_ROOT, 'src', 'personal-plugins.js'), 'utf8')
const patch = readFileSync(join(REPOSITORY_ROOT, 'plugins', 'cordis.patch.yml'), 'utf8')
const policySource = readFileSync(join(REPOSITORY_ROOT, 'plugins', 'personal-policy', 'src', 'index.ts'), 'utf8')
check('policy listed in personal-plugins.js', personalPlugins.includes("@cyrus/dsh-personal-policy"))
check('policy listed in cordis.patch.yml', patch.includes("'@cyrus/dsh-personal-policy'"))
check('policy section name unique', policySource.includes("SECTION_NAME = 'personal:cross-project-policy'"))
check('policy order -50', policySource.includes('SECTION_ORDER = -50'))
check('policy host bundle built', existsSync(join(REPOSITORY_ROOT, 'plugins', 'personal-policy', 'lib', 'index.js')))
check('policy client bundle built', existsSync(join(REPOSITORY_ROOT, 'plugins', 'personal-policy', 'lib', 'client.js')))

// 3. AGENTS 投影哈希
const devHome = join(process.env.USERPROFILE ?? '', '.dsh')
const agentsTarget = join(devHome, 'AGENTS.md')
if (existsSync(agentsTarget)) {
  const hash = (p) => createHash('sha256').update(readFileSync(p, 'utf8')).digest('hex')
  check('AGENTS projection hash matches canonical', hash(CANONICAL_PATH) === hash(agentsTarget), devHome)
} else {
  check('AGENTS projection present', false, '未投影：node scripts/project-global-agents.js <dev-home>')
}

// 4. 密扫：从安全区读取存储的 GitHub token，断言其完整值不出现在仓库任何位置；
//    凭据模式只允许出现在规则定义文件里。token 值绝不打印。
const SECURE_TOKEN_PATH = 'F:\\QClawData\\workspace\\secure\\github_token.txt'
let secureToken = null
try {
  const candidate = readFileSync(SECURE_TOKEN_PATH, 'utf8').trim()
  if (candidate.length >= 20 && candidate.startsWith('github_pat_')) secureToken = candidate
} catch {}
const CREDENTIAL_PATTERN = /github_pat_[A-Za-z0-9_]{20,}|ghp_[A-Za-z0-9]{20,}|gho_[A-Za-z0-9]{20,}|ghs_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/u
const BENIGN_RULE_FILES = new Set([
  join(REPOSITORY_ROOT, 'scripts', 'preflight-publish.js'),
  join(REPOSITORY_ROOT, 'test', 'preflight-publish.test.js'),
  join(REPOSITORY_ROOT, 'docs', 'PUBLISHING_RULES.md'),
  join(REPOSITORY_ROOT, 'docs', 'DEVLOG.md'),
  join(REPOSITORY_ROOT, 'docs', 'memory', 'MEMORY_DATA_CLASSIFICATION.md'),
])
const SKIP_DIRS = new Set(['node_modules', 'artifacts', 'artifacts-dev', '分发包', '.git', 'lib', 'lib-temp', 'harness-src', 'refs'])
function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) { if (!SKIP_DIRS.has(entry.name)) walk(join(dir, entry.name), out) }
    else out.push(join(dir, entry.name))
  }
  return out
}
const files = walk(REPOSITORY_ROOT)
let tokenHits = 0
const patternHits = []
for (const file of files) {
  let text
  try { text = readFileSync(file, 'utf8') } catch { continue }
  if (secureToken !== null && text.includes(secureToken)) tokenHits += 1
  const isTestFixture = /[\\/]test[\\/]/u.test(file)
  if (CREDENTIAL_PATTERN.test(text) && !BENIGN_RULE_FILES.has(file) && !isTestFixture) patternHits.push(file)
}
if (secureToken === null) {
  check('secure store token readable for exact-value scan', false, '安全区 token 未找到，跳过精确比对')
} else {
  check('stored token value absent from repository', tokenHits === 0, String(tokenHits) + ' hit(s)')
}
check('credential patterns only in rule files', patternHits.length === 0, patternHits.join('; '))

// 5. Git 状态
check('git repository initialized', existsSync(join(REPOSITORY_ROOT, '.git')))
let remotes = ''
try { remotes = execFileSync('git', ['-C', REPOSITORY_ROOT, 'remote'], { encoding: 'utf8' }).trim() } catch {}
check('no git remote configured', remotes === '', remotes)

// 6. 自动化脚本在位守卫
const stage = readFileSync(join(REPOSITORY_ROOT, 'scripts', 'stage-releases.js'), 'utf8')
const smoke = readFileSync(join(REPOSITORY_ROOT, 'scripts', 'smoke.js'), 'utf8')
const orphans = readFileSync(join(REPOSITORY_ROOT, 'scripts', 'kill-smoke-orphans.js'), 'utf8')
check('stage-releases uses path guard', stage.includes('assertAutomationSafe'))
check('smoke uses path guard', smoke.includes('assertAutomationSafe'))
check('smoke orphan cleanup is marker+PID based', orphans.includes('dsh-desktop-smoke-') && orphans.includes('/PID') && orphans.includes('PROTECTED_ROOTS'))

// 报告
for (const { name, ok, detail } of checks) {
  process.stdout.write((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  [' + detail + ']' : '') + '\n')
}
process.stdout.write('governance: ' + (failures.length === 0 ? 'ALL PASS (' + checks.length + ' checks)' : failures.length + ' FAILURES') + '\n')
process.exit(failures.length === 0 ? 0 : 1)
