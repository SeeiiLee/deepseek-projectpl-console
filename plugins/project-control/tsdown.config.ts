import { clientBundle } from '../../harness-src/packages/client/tsdown.client.ts'

const BUNDLED_HOST_DEPENDENCY = /^(?:ajv(?:\/|$)|ajv-formats(?:\/|$))/u
const BUNDLED_HOST_PACKAGES = [
  'ajv',
  'ajv-formats',
  'fast-deep-equal',
  'fast-uri',
  'json-schema-traverse',
]

export default clientBundle('@cyrus/dsh-project-control', ['src/index.ts'], {
  lib: {
    deps: {
      alwaysBundle: (specifier: string) => BUNDLED_HOST_DEPENDENCY.test(specifier),
      onlyBundle: BUNDLED_HOST_PACKAGES,
    },
  },
})
