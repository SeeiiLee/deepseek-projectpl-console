import { accessSync, constants } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveNodeExecutable } from './harness-process.js'

/**
 * Resolve how to invoke pnpm on machines that may have no global pnpm.
 *
 * Order:
 *   1. `DSH_PNPM_CJS` env override (explicit pnpm.cjs path).
 *   2. Vendored pnpm shipped inside the app (`vendor/pnpm/bin/pnpm.cjs`,
 *      resolved relative to this module so it works both in the dev tree and
 *      inside installed `resources/app`).
 *   3. `null` — caller falls back to the PATH `pnpm` / `pnpm.cmd` shim.
 *
 * @param {NodeJS.ProcessEnv} env Environment for the child process.
 * @returns {{ nodeExecutable: string, pnpmCjs: string } | null}
 */
export function resolveVendoredPnpm(env = process.env) {
  const candidates = []
  if (env.DSH_PNPM_CJS) candidates.push(resolve(env.DSH_PNPM_CJS))
  candidates.push(fileURLToPath(new URL('../vendor/pnpm/bin/pnpm.cjs', import.meta.url)))
  for (const candidate of candidates) {
    try {
      accessSync(candidate, constants.R_OK)
      return { nodeExecutable: resolveNodeExecutable(env), pnpmCjs: candidate }
    } catch {
      // try next candidate
    }
  }
  return null
}
