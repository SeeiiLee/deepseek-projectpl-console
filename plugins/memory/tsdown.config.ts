import { clientBundle } from '../../harness-src/packages/client/tsdown.client.ts'

export default clientBundle('@cyrus/dsh-memory', ['src/index.ts', 'src/core/embedding-worker.ts'])
