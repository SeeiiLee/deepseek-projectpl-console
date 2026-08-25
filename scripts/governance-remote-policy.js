import { spawnSync } from 'node:child_process'

const REMOTE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u
const PUSH_POLICY = 'explicit-user-authorization'

function outputLines(value) {
  return value.split(/\r?\n/u).map(line => line.trim()).filter(Boolean)
}

function runGit(repositoryRoot, args, allowExitOne = false) {
  const result = spawnSync('git', ['-C', repositoryRoot, ...args], {
    encoding: 'utf8',
    windowsHide: true,
  })
  if (result.status === 0) return result.stdout.trim()
  if (allowExitOne && result.status === 1) return ''
  throw new Error(`git ${args.join(' ')} failed with exit ${String(result.status)}`)
}

export function readGitRemoteSnapshot(repositoryRoot) {
  const names = outputLines(runGit(repositoryRoot, ['remote']))
  return names.map(name => {
    if (!REMOTE_NAME.test(name)) {
      return { name, fetchUrls: [], effectivePushUrls: [], explicitPushUrls: [] }
    }
    return {
      name,
      fetchUrls: outputLines(runGit(repositoryRoot, ['remote', 'get-url', '--all', name])),
      effectivePushUrls: outputLines(runGit(repositoryRoot, ['remote', 'get-url', '--push', '--all', name])),
      explicitPushUrls: outputLines(runGit(
        repositoryRoot,
        ['config', '--get-all', `remote.${name}.pushurl`],
        true,
      )),
    }
  })
}

export function validateGitRemotePolicy(actualRemotes, approvedRemotes) {
  const failures = []
  if (!Array.isArray(actualRemotes)) {
    return { ok: false, failures: [{ code: 'ACTUAL_REMOTES_INVALID' }] }
  }
  if (!Array.isArray(approvedRemotes)) {
    return { ok: false, failures: [{ code: 'APPROVED_REMOTES_INVALID' }] }
  }

  const approvedByName = new Map()
  for (const remote of approvedRemotes) {
    if (remote === null || typeof remote !== 'object'
      || !REMOTE_NAME.test(remote.name ?? '')
      || typeof remote.fetchUrl !== 'string'
      || remote.fetchUrl.length === 0
      || /[\u0000-\u0020\u007f]/u.test(remote.fetchUrl)
      || remote.pushPolicy !== PUSH_POLICY) {
      failures.push({ code: 'APPROVED_REMOTE_INVALID', name: remote?.name ?? null })
      continue
    }
    if (approvedByName.has(remote.name)) {
      failures.push({ code: 'APPROVED_REMOTE_DUPLICATE', name: remote.name })
      continue
    }
    approvedByName.set(remote.name, remote)
  }

  const actualByName = new Map()
  for (const remote of actualRemotes) {
    if (remote === null || typeof remote !== 'object' || !REMOTE_NAME.test(remote.name ?? '')) {
      failures.push({ code: 'ACTUAL_REMOTE_INVALID', name: remote?.name ?? null })
      continue
    }
    if (actualByName.has(remote.name)) {
      failures.push({ code: 'ACTUAL_REMOTE_DUPLICATE', name: remote.name })
      continue
    }
    actualByName.set(remote.name, remote)
    if (!approvedByName.has(remote.name)) {
      failures.push({ code: 'UNDECLARED_REMOTE', name: remote.name })
    }
  }

  for (const [name, approved] of approvedByName) {
    const actual = actualByName.get(name)
    if (actual === undefined) {
      failures.push({ code: 'APPROVED_REMOTE_MISSING', name })
      continue
    }
    if (actual.fetchUrls?.length !== 1 || actual.fetchUrls[0] !== approved.fetchUrl) {
      failures.push({ code: 'FETCH_URL_MISMATCH', name })
    }
    if (actual.explicitPushUrls?.length !== 0) {
      failures.push({ code: 'EXPLICIT_PUSH_URL_FORBIDDEN', name })
    }
    if (actual.effectivePushUrls?.length !== 1 || actual.effectivePushUrls[0] !== approved.fetchUrl) {
      failures.push({ code: 'EFFECTIVE_PUSH_URL_MISMATCH', name })
    }
  }

  return { ok: failures.length === 0, failures }
}

export const GOVERNANCE_PUSH_POLICY = PUSH_POLICY
