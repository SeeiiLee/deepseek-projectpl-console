import { clientBundle } from '../../harness-src/packages/client/tsdown.client.ts'
import { pathIndependentCssModulesPlugin } from './build/path-independent-css-modules.mjs'

const BUNDLED_HOST_DEPENDENCY = /^(?:ajv(?:\/|$)|ajv-formats(?:\/|$))/u
const BUNDLED_HOST_PACKAGES = [
  'ajv',
  'ajv-formats',
  'fast-deep-equal',
  'fast-uri',
  'json-schema-traverse',
]

const baseConfig = clientBundle('@cyrus/dsh-project-control', ['src/index.ts'], {
  lib: {
    deps: {
      alwaysBundle: (specifier: string) => BUNDLED_HOST_DEPENDENCY.test(specifier),
      onlyBundle: BUNDLED_HOST_PACKAGES,
    },
  },
})

export default (inlineConfig: Parameters<typeof baseConfig>[0]) => {
  let replacements = 0
  const configs = baseConfig(inlineConfig).map((config) => {
    if (!Array.isArray(config.plugins)) return config
    const plugins = config.plugins.map((plugin) => {
      if (plugin !== null && typeof plugin === 'object' && 'name' in plugin
        && plugin.name === 'dsh-css-modules-inline') {
        replacements += 1
        return pathIndependentCssModulesPlugin('@cyrus/dsh-project-control')
      }
      return plugin
    })
    return { ...config, plugins }
  })
  const includesClient = configs.some(config => config.name === '@cyrus/dsh-project-control/client')
  if (includesClient && replacements !== 1) {
    throw new Error(`Project Control expected exactly one CSS Modules build plugin, found ${String(replacements)}.`)
  }
  return configs
}
