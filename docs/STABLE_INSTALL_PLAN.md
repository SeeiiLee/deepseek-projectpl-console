# 稳定版安装与回滚方案（Cyrus 已确认，待执行）

本方案对应双包体拆分的最后一段：把稳定版切换为安装到 D:\\Cyrus Deepseek Harness 的正式安装版，数据与会话全部无损迁移到 F 盘。Cyrus 已确认三处选择：①旧数据复制到 F 盘（旧目录保留作备份）；②会话数据搬到 F 盘；③由 Cyrus 自己双击安装向导选择 D:\\Cyrus Deepseek Harness。

## 一、产物清单（已构建并验证）

| 产物 | 位置 | 说明 |
|---|---|---|
| NSIS 安装版 | 分发包\\稳定版\\DeepSeek-Harness-Personal-0.1.0-setup-x64.exe | NotSigned；含「安装版数据目录 + 会话目录均指向 F 盘」规则；packed smoke 通过 |
| Portable（备选） | 分发包\\稳定版\\DeepSeek-Harness-Personal-0.1.0-portable-x64.exe | 同源构建 |
| 迁移入口 | 一键迁移数据到F盘.cmd（仓库根目录） | 双击执行；带运行中客户端防护、防重跑标记、迁移报告 |

安装版内置规则（已测试）：
- userData → F:\\documents\\Cyrus Deepseek Harness Data
- DSH_HOME（会话/配置）→ F:\\documents\\Cyrus Deepseek Harness Data\\harness-home
- 仅对「已安装 + 稳定版身份」生效；目录式稳定版与测试版不受影响。

## 二、执行顺序（重要）

1. 关闭两个客户端：正在运行的稳定版与测试版全部退出（托盘「退出并清理后台进程」）。
2. 双击 一键迁移数据到F盘.cmd（仓库根目录）：把
   - 旧稳定版用户数据（设置/项目库/更新配置）→ F:\\...\\Data
   - 会话与 Harness 配置（.dsh，含测试版期间的会话——测试版 Portable 直接运行时共用该会话目录）→ F:\\...\\Data\\harness-home（profiles 的 node_modules 由程序启动时重建，不复制）
   - 测试版用户数据 → F:\\...\\Data\\from-test-userdata（存档保留，零丢失）
   全部为复制，源目录一律不动；完成后生成「迁移报告.txt」与防重跑标记。
3. 双击安装向导：分发包\\稳定版\\setup-x64.exe，安装目录填 D:\\Cyrus Deepseek Harness。
4. 启动安装版：从开始菜单/桌面快捷方式打开；自动使用 F 盘数据与会话目录。
5. 逐项核对：会话历史、项目控制台项目、设置。

## 三、数据迁移规则（无损）

- 全部复制、绝不删除/移动源文件；源目录（%APPDATA%\\DeepSeek Harness Personal、%USERPROFILE%\\.dsh、%APPDATA%\\DeepSeek Harness Personal Dev）继续保留作备份。
- 迁移前检测运行中的客户端，检测到即拒绝（防止复制被占用/正在写入的文件）。
- 防重跑：目标目录已有 MIGRATED.marker 或非空且无标记时拒绝，避免新旧数据混合。
- 关键文件 SHA-256 写入迁移报告（project-control 数据库等），安装后可按报告核对。

## 四、回滚方案

1. 卸载：控制面板卸载安装版；卸载不删除任何数据目录（deleteAppDataOnUninstall=false）。
2. 数据回滚：F:\\documents\\Cyrus Deepseek Harness Data 可整体删除；所有源目录完好，可随时重跑迁移或退回旧运行方式。
3. 运行回滚：已按 Cyrus 要求收口——旧目录式副本与启动器已删除；回退可用上一版本安装包重装（分发包\稳定版 保留旧包），数据源目录仍完整保留。
4. 版本回滚：分发包\\稳定版 保留上一版本安装包与 .sha256。

## 五、安装后验收清单

- [ ] 安装版从 D:\\Cyrus Deepseek Harness 启动，窗口/托盘显示 DeepSeek Harness Personal。
- [ ] 数据写入 F:\\documents\\Cyrus Deepseek Harness Data（settings、project-control 在其下；harness-home 下有会话）。
- [ ] 会话历史完整（包括测试版期间的工作会话）。
- [ ] 项目控制台 schema 8、项目列表/模板正常。
- [ ] 更新中心提示「最新安装包人工升级」（未配置发布仓库时的预期状态）。
- [ ] 与测试版可同时运行、互不影响。
