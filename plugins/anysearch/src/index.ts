/**
 * Register an AnySearch-backed provider in `ctx.web`. The provider reads
 * `ANYSEARCH_API_KEY` through the standard credentials seam (or a literal
 * `apiKey`) and exposes an AnySearch settings section so the key and endpoint
 * can be saved from the Harness settings UI.
 * @module @cyrus/dsh-anysearch
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import type {} from '@deepseek-ai/dsh-web'
import {
  AnySearchSearchProvider,
  ANYSEARCH_DEFAULT_ENDPOINT,
} from './provider.ts'
import type { AnySearchSearchProviderOptions } from './provider.ts'

export {
  AnySearchSearchProvider,
  ANYSEARCH_DEFAULT_ENDPOINT,
  ANYSEARCH_DEFAULT_MAX_RESULTS,
  ANYSEARCH_MAX_RESULTS,
  ANYSEARCH_PROVIDER_ID,
  parseAnySearchText,
} from './provider.ts'
export type { AnySearchSearchProviderOptions } from './provider.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'anysearch'

/** The web seam this provider registers into. */
export const inject = ['web']

const DEFAULT_API_KEY_ENV = 'ANYSEARCH_API_KEY'
const ENDPOINT_ENV = 'ANYSEARCH_ENDPOINT'

/** Plugin config (all optional — `apply` fills env-var and constant defaults). */
export interface Config {
  /** Literal AnySearch API key; prefer {@link apiKeyEnv} so no secret enters configuration files. */
  apiKey?: string
  /** Credential reference resolved for each search; defaults to `ANYSEARCH_API_KEY`. */
  apiKeyEnv?: string
  /** AnySearch JSON-RPC endpoint. */
  endpoint?: string
}

export const Config: z<Config> = z.object({
  apiKey: z.string().role('secret'),
  apiKeyEnv: z.string().role('credential-ref').default(DEFAULT_API_KEY_ENV),
  endpoint: z.string(),
})

/** Settings namespace carrying this provider's endpoint and key reference. */
export const ANYSEARCH_SETTINGS_NAMESPACE = settingsNamespace('anysearch')

function resolveOptions(ctx: Context, config: Config): AnySearchSearchProviderOptions {
  const apiKeyEnv = credentialRef(config.apiKeyEnv !== undefined && config.apiKeyEnv.length > 0
    ? config.apiKeyEnv
    : DEFAULT_API_KEY_ENV)
  const literalApiKey = config.apiKey !== undefined && config.apiKey.length > 0
    ? config.apiKey
    : undefined
  return {
    ...(literalApiKey === undefined ? {} : { apiKey: literalApiKey }),
    resolveApiKey: async () => {
      const credentials = ctx.get('credentials')
      if (credentials !== undefined) return (await credentials.resolve(apiKeyEnv))?.value
      const ambient = launchEnvironmentOf(ctx).get(apiKeyEnv)
      return ambient !== undefined && ambient.value.length > 0 ? ambient.value : undefined
    },
    apiKeyEnv,
    endpoint: config.endpoint
      ?? launchEnvironmentOf(ctx).get(ENDPOINT_ENV)?.value
      ?? ANYSEARCH_DEFAULT_ENDPOINT,
  }
}

/** Register the AnySearch search provider with `ctx.web`. */
export function apply(ctx: Context, config: Config): void {
  let current: () => Config = () => config
  installSettingsSection(ctx, ANYSEARCH_SETTINGS_NAMESPACE, Config, config, {
    setSource: (source) => {
      current = source
    },
    // The provider projects the current settings section per search, so a
    // committed change needs no re-registration.
    onChange: () => {},
  })
  ctx.web.registerSearchProvider(new AnySearchSearchProvider(() => resolveOptions(ctx, current())))
}
