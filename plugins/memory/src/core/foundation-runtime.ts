// P3-2 运行时 peer 加载：personal-foundation 是个人插件集里的兄弟包。
// 源码态与打包态都不存在「插件内按包名解析」的 node_modules 链接（这正是实测
// 「Cannot find package @cyrus/dsh-personal-foundation」的根因），所以这里沿用
// migrationsDir 的候选路径套路，按文件路径加载其已构建的主机包 lib/index.js。
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** 定位 personal-foundation 主机包入口（源码态 src/core → ../../，打包态 lib → ../）。 */
export function foundationBundleUrl(): string {
  const here = dirname(fileURLToPath(import.meta.url))
  const candidates = [
    resolve(here, '..', '..', '..', 'personal-foundation', 'lib', 'index.js'), // src/core → plugins/
    resolve(here, '..', '..', 'personal-foundation', 'lib', 'index.js'),       // lib → plugins/
  ]
  for (const candidate of candidates) {
    if (existsSync(candidate)) return pathToFileURL(candidate).href
  }
  throw new Error('personal-foundation 主机包未找到（near ' + here + '）。')
}

/** 结构子集：连接存储文档。 */
export interface FoundationStoreDocument {
  connections: ReadonlyArray<{
    id: string
    label: string
    kind: string
    enabled: boolean
    endpointRef: string
    secretRef: string
  }>
}

export type FoundationStoreConstructor = new (filename: string) => { read(): Promise<FoundationStoreDocument> }

/** 加载 personal-foundation 主机包并取出 PersonalStore 构造器（结构校验 + 失败即抛，由调用方吞错）。 */
export async function loadFoundationStoreConstructor(): Promise<FoundationStoreConstructor> {
  const bundle = await import(foundationBundleUrl())
  const PersonalStore = (bundle as { PersonalStore?: unknown }).PersonalStore
  if (typeof PersonalStore !== 'function') {
    throw new Error('personal-foundation 主机包未导出 PersonalStore（lib 版本过旧，请重建插件）。')
  }
  return PersonalStore as FoundationStoreConstructor
}
