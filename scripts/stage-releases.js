import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { assertAutomationSafe } from './protected-paths.js'

// Stages verified artifacts into clearly named user-facing folders:
//   分发包/测试版  (dev packages, -Dev- identity, its own data directory)
//   分发包/稳定版  (stable packages, formal identity, the daily data directory)
// Each staged folder gets 说明.txt describing what the package is and where
// its data lives, so the two package bodies can never be confused.
// Run only after the matching packed smoke has passed.

const projectRoot = resolve(process.env.DSH_STAGE_PROJECT_ROOT ?? join(import.meta.dirname, '..'))
const stageRoot = resolve(process.env.DSH_STAGE_DIR ?? join(projectRoot, '分发包'))
assertAutomationSafe(stageRoot, '发布暂存根目录')

const groups = [
  {
    label: '测试版',
    source: 'artifacts-dev',
    appName: 'DeepSeek Harness Personal Dev',
    dataDir: '%APPDATA%\DeepSeek Harness Personal Dev',
    purpose: '开发/验收用的独立桌面包体。日常维护、新功能验收都在这个包里进行；它与稳定版完全隔离，可以同时运行。验收通过后，同一份代码才会被打成稳定版包。',
  },
  {
    label: '稳定版',
    source: 'artifacts',
    appName: 'DeepSeek Harness Personal',
    dataDir: '%APPDATA%\DeepSeek Harness Personal',
    purpose: '正式日常使用的桌面包体。只有测试版验收通过后才更新；升级优先走应用内更新中心，没有发布通道时用这里的安装包人工升级。',
  },
]

const labelAliases = new Map([
  ['dev', '测试版'],
  ['test', '测试版'],
  ['beta', '测试版'],
  ['stable', '稳定版'],
])
const onlyLabel = labelAliases.get(process.argv[2] ?? '') ?? process.argv[2] ?? null
if (onlyLabel !== null && !groups.some(group => group.label === onlyLabel)) {
  process.stderr.write(`usage: node scripts/stage-releases.js [测试版|稳定版|dev|stable]\n`)
  process.exit(2)
}

let staged = 0
const busyFailures = []
for (const group of groups) {
  if (onlyLabel !== null && group.label !== onlyLabel) continue
  const sourceDir = join(projectRoot, group.source)
  if (!existsSync(sourceDir)) {
    console.log(`skip ${group.label}: ${sourceDir} does not exist yet.`)
    continue
  }
  const targetDir = join(stageRoot, group.label)
  assertAutomationSafe(targetDir, '发布暂存目标目录')
  mkdirSync(targetDir, { recursive: true })
  const files = readdirSync(sourceDir, { withFileTypes: true })
    .filter(entry => entry.isFile()
      && (entry.name.endsWith('.exe') || entry.name.endsWith('.sha256') || entry.name.endsWith('.blockmap')))
  for (const entry of files) {
    const sourcePath = join(sourceDir, entry.name)
    const targetPath = join(targetDir, entry.name)
    assertAutomationSafe(targetPath, '发布暂存文件')
    try {
      copyFileSync(sourcePath, targetPath)
      staged += 1
    } catch (error) {
      busyFailures.push({
        file: targetPath,
        code: String(error?.code ?? 'UNKNOWN'),
      })
      process.stderr.write(`staging warning: ${entry.name} is busy (${String(error?.code ?? 'UNKNOWN')}); skipped, re-run later.\n`)
    }
  }
  const lines = [
    '这是「' + group.label + '」桌面包体（' + group.appName + '）。',
    '',
    group.purpose,
    '',
    '如何分辨两个包体：',
    '- 文件名带 -Dev- 的是测试版；不带的是稳定版。',
    '- 运行后，托盘提示与设置页显示的应用名也不同（' + group.appName + '）。',
    '- 本包的数据目录：' + group.dataDir + '（与另一个包体完全独立）。',
    '',
    '使用方式：',
    '- Portable 单文件：双击运行，替换新版 = 替换这个 exe。',
    '- 安装版（稳定版）：运行 setup exe 安装，之后从开始菜单/桌面快捷方式启动。',
    '- 校验完整性：目录里的 .sha256 文件与本包 exe 的 SHA-256 一一对应。',
    '',
    '注意：两个包体可以同时运行、互不干扰；不要把测试版的 exe 当作稳定版分发。',
  ]
  writeFileSync(join(targetDir, '说明.txt'), lines.join('\r\n'), 'utf8')
  console.log(`staged ${group.label}: ${files.length} file(s) -> ${targetDir}`)
}
if (busyFailures.length > 0) {
  process.stderr.write(`release staging partial: ${busyFailures.length} file(s) were busy. Re-run once the running package is closed.\n`)
  process.exit(2)
}
console.log(`release staging complete (${staged} files).`)
