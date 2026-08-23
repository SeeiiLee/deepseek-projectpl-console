import { createHash } from 'node:crypto'

export const DEFAULT_HARNESS_REPOSITORY = 'deepseek-ai/deepseek-harness'
export const UPDATE_STATE_VERSION = 1
const STRICT_LOOPBACK_HTTP_URL = /^http:\/\/127\.0\.0\.1:(?:[1-9][0-9]{0,3}|[1-5][0-9]{4}|6[0-4][0-9]{3}|65[0-4][0-9]{2}|655[0-2][0-9]|6553[0-5])$/u

/**
 * Accept only the exact raw `http://127.0.0.1:<port>` form. The WHATWG URL
 * parser normalizes 127.1, 2130706433, 0x7f000001, etc. to 127.0.0.1, so any
 * security check must run against the original string, not URL.hostname.
 */
export function isStrictLoopbackHttpUrl(value) {
  return typeof value === 'string' && value === value.trim() && STRICT_LOOPBACK_HTTP_URL.test(value)
}
const OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/u
const REPOSITORY_PATTERN = /^(?!\.{1,2}$)[A-Za-z0-9_.-]{1,100}$/u

/** Validate and split one GitHub owner/repository identifier. */
export function parseRepository(value, { allowEmpty = false } = {}) {
  const normalized = String(value ?? '').trim()
  if (allowEmpty && normalized === '') return undefined
  const segments = normalized.split('/')
  if (segments.length !== 2 || !OWNER_PATTERN.test(segments[0]) || !REPOSITORY_PATTERN.test(segments[1])) {
    throw new TypeError('GitHub repository must use the owner/repository form.')
  }
  const [owner, repository] = segments
  return { owner, repository, fullName: normalized }
}

/** Produce the durable default update-center document. */
export function defaultUpdateDocument(environment = process.env) {
  return {
    schemaVersion: UPDATE_STATE_VERSION,
    settings: {
      desktopRepository: environment.DSH_PERSONAL_UPDATE_REPOSITORY?.trim() ?? 'SeeiiLee/deepseek-projectpl-console',
      harnessRepository: DEFAULT_HARNESS_REPOSITORY,
      pluginRepository: environment.DSH_PERSONAL_PLUGIN_REPOSITORY?.trim() ?? '',
      channel: 'stable',
      autoCheck: true,
    },
    lastCheckedAt: undefined,
    activeHarnessRoot: undefined,
    activeHarnessRepository: undefined,
    previousHarnessRoot: undefined,
    previousHarnessCommit: undefined,
    previousHarnessRepository: undefined,
    preparedHarnessRoot: undefined,
    preparedHarnessCommit: undefined,
    preparedHarnessRepository: undefined,
    downloadedDesktop: undefined,
    knownGoodDesktop: undefined,
    previousDesktop: undefined,
    installPending: undefined,
    rollbackPending: undefined,
  }
}

/** Normalize persisted settings while rejecting unexpected update sources. */
export function normalizeUpdateSettings(value, environment = process.env) {
  const defaults = defaultUpdateDocument(environment).settings
  const candidate = typeof value === 'object' && value !== null ? value : {}
  const desktopRepository = String(candidate.desktopRepository ?? defaults.desktopRepository).trim()
  parseRepository(desktopRepository, { allowEmpty: true })
  const channel = candidate.channel === 'beta' ? 'beta' : 'stable'
  const pluginRepository = String(candidate.pluginRepository ?? defaults.pluginRepository).trim()
  if (pluginRepository !== '') parseRepository(pluginRepository)
  return {
    desktopRepository,
    harnessRepository: DEFAULT_HARNESS_REPOSITORY,
    pluginRepository,
    channel,
    autoCheck: candidate.autoCheck === undefined ? defaults.autoCheck : candidate.autoCheck === true,
  }
}

/** Compare dotted release versions without pulling a semver runtime into the shell. */
export function compareVersions(left, right) {
  const a = parseVersion(left)
  const b = parseVersion(right)
  for (let index = 0; index < 3; index += 1) {
    if (a.numbers[index] !== b.numbers[index]) return a.numbers[index] < b.numbers[index] ? -1 : 1
  }
  if (a.prerelease === b.prerelease) return 0
  if (a.prerelease === '') return 1
  if (b.prerelease === '') return -1
  return a.prerelease.localeCompare(b.prerelease, 'en', { numeric: true })
}

/** Pick the newest non-draft release allowed by the selected channel. */
export function selectRelease(releases, channel) {
  const candidates = releases
    .filter(release => release && release.draft !== true && (channel === 'beta' || release.prerelease !== true))
    .filter(release => {
      try {
        parseVersion(release.tag_name)
        return true
      } catch {
        return false
      }
    })
  return candidates.sort((left, right) => compareVersions(right.tag_name, left.tag_name))[0]
}

/** Select the intended Windows artifact rather than an arbitrary executable asset. */
export function selectWindowsAsset(assets, packaging) {
  const executables = assets.filter(asset => typeof asset?.name === 'string' && asset.name.toLowerCase().endsWith('.exe'))
  if (packaging === 'portable') {
    return executables.find(asset => /portable.*x64|x64.*portable/iu.test(asset.name))
      ?? executables.find(asset => /portable/iu.test(asset.name))
  }
  return executables.find(asset => !/portable/iu.test(asset.name) && /setup.*x64|x64.*setup/iu.test(asset.name))
    ?? executables.find(asset => !/portable/iu.test(asset.name))
}

/** Read a GitHub asset digest or a conventional checksum companion body. */
export function expectedSha256(asset, checksumText) {
  if (typeof asset?.digest === 'string' && asset.digest.startsWith('sha256:')) {
    const digest = asset.digest.slice('sha256:'.length).trim().toLowerCase()
    if (/^[a-f0-9]{64}$/u.test(digest)) return digest
  }
  if (typeof checksumText !== 'string') return undefined
  for (const line of checksumText.split(/\r?\n/u)) {
    const match = /^([A-Fa-f0-9]{64})\s+\*?(.+)$/u.exec(line.trim())
    if (match?.[2] === asset.name) return match[1].toLowerCase()
  }
  return undefined
}

/** Hash a complete downloaded artifact for release-manifest verification. */
export function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

export function parseVersion(value) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/u.exec(String(value).trim())
  if (match === null) throw new TypeError(`Invalid release version: ${String(value)}`)
  return {
    numbers: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] ?? '',
  }
}
