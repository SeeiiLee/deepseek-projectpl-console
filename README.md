# DeepSeek Harness Personal Desktop

这是一个仅供个人使用的 Electron 桌面入口。它直接复用本机 DeepSeek Harness 源码版，通过桌面专用 Cordis overlay 加载十四个外置插件包；不会复制或修改 `D:\Deepseek Harness` 的上游代码，也不会影响普通的 `dsh web`。

当前兼容基线是 DeepSeek Harness `0.1.0-rc.5`、提交 `47f943859bef60e4160492346772ded9b24f765a`。本项目已正式移交给 DeepSeek Harness 自主维护；接手必须先读 [`docs/HANDOVER_TO_DEEPSEEK_HARNESS.md`](docs/HANDOVER_TO_DEEPSEEK_HARNESS.md) 和 [`docs/NEXT.md`](docs/NEXT.md)。项目决策、验证状态和后续边界见 [`docs/DEVLOG.md`](docs/DEVLOG.md)、[`docs/compat.json`](docs/compat.json) 与 [`docs/PROJECT_CONTROL_SPEC.md`](docs/PROJECT_CONTROL_SPEC.md)。Project Control 的规范入口为 [`docs/PROJECT_PROTOCOL.md`](docs/PROJECT_PROTOCOL.md)、[`docs/PROJECT_CONTROL_DATA_MODEL.md`](docs/PROJECT_CONTROL_DATA_MODEL.md) 和 [`docs/PROJECT_INTAKE_SPEC.md`](docs/PROJECT_INTAKE_SPEC.md)；Gate 2C 已在 Gate 2B 事务内核上落地现有项目的只读发现、候选审阅和确认关联。Gate 2D 的模板注册表、write plan、crash/retry/replay 与文件↔数据库一致性合同见 [`docs/PROJECT_TEMPLATE_SPEC.md`](docs/PROJECT_TEMPLATE_SPEC.md)，机器 Schema 位于 `protocol/project-control/v1alpha1/templates/`。

## 开发移交

- 唯一移交入口：[`docs/HANDOVER_TO_DEEPSEEK_HARNESS.md`](docs/HANDOVER_TO_DEEPSEEK_HARNESS.md)。
- 下一阶段执行清单：[`docs/NEXT.md`](docs/NEXT.md)。
- 当前下一项：Gate 2D（模板快速新建、原子文件同步、legacy 安全升级、项目文档刷新）。
- Cyrus 不再在 Codex 线程中继续本项目开发；后续由 DeepSeek Harness 依据仓库文档、规范与测试自主推进。

## 已实现功能

### 个人资料与设置

- **个人主题**：全局或按工作区设置字体、字号、界面缩放、强调色、背景色、侧栏色、文字色和面板透明度。
- **Skill 资料库**：搜索、分类、一句话简介、添加和整理 Skill；个人 Skill 支持移动到可恢复回收目录。
- **插件整理**：按官方、个人、第三方或自定义分类展示实时插件清单并维护一句话简介；安装、更新和卸载仍使用 Harness 原生能力。
- **连接中心**：管理飞书机器人、企业微信机器人、通用 Webhook 和 MCP 配置。当前只保存与整理配置，不主动连接或发送请求；个人微信仍是预留位置。
- **桌面设置**：查看托盘与进程守护状态，控制关闭到托盘及桌面/开始菜单快捷方式维护。

### 桌面与会话能力

- **四轨 Personal Shell**：真实布局同时承载 Harness 原生侧栏、Project Console、完整 Conversation 和 Workbench。Project Console 与 Workbench 分别保留 40px/44px 收起轨道，可独立开关、拖拽和记忆宽度；布局菜单提供“专注会话”和“重置布局”，窄窗口按优先级让出辅助栏且不产生横向溢出。
- **Project Control Gate 2C 接入层**：独立用户插件占用真实 `project.control` slot，并由唯一 Host 在稳定的 `PROJECT_CONTROL_HOME` 中管理 SQLite `schemaVersion=7`。除了项目状态与 lifecycle API，现在还可以通过系统目录选择器扫描一个来源目录或单个项目，查看候选、证据、读取问题和文档角色，修改名称/角色映射、忽略或恢复候选，并在确认后只读关联为 `linked_legacy`。有效 manifest 可进入 `managed` 登记；已登记 managed 项目的移动只会在身份一致且旧位置不可访问时提供重新绑定候选。
- **Workbench 基础层**：独立用户插件已经占用真实 `workbench.panel` slot，固定 `Files / Code / Outline / Diff / Browser / Terminal / Details` 七个页签，并提供 viewer registry、统一 open intent、可恢复页签描述符与状态持久化。Gate 2C 新增 `project-control.candidate-details` viewer，在 `Details` 中展示候选证据、问题、文档预览与映射确认；Files、Code、Outline、Diff、Browser 和独立 PTY 工具仍是占位界面。
- **应用图标与 Windows 封装**：EXE、安装器、托盘和快捷方式共用多尺寸图标；支持 NSIS 安装版和 Portable 单文件版。
- **快捷方式维护**：仅在 Windows 已封装版本中维护桌面与开始菜单快捷方式。Portable 会指向外层持久 EXE；EXE 移动后从新位置启动一次即可修复目标。程序只更新自己创建、或原本就指向本应用的快捷方式，不覆盖其他同名快捷方式，也不会在程序未启动时后台搜索新位置。
- **系统托盘**：支持显示/隐藏主窗口、打开当前工作区和桌面设置目录、检查更新、切换关闭到托盘、维护快捷方式，以及“退出并清理后台进程”。
- **会话 PowerShell**：底部可折叠、多标签终端，按 Harness session 绑定工作目录；支持持久进程、命令历史、清屏、中断、重启、关闭和按游标断线重连，并统一使用 UTF-8。终端在面板收起、切换会话或 Renderer 重载后仍由同一 Host 持有；Host 退出后不能跨进程恢复。
- **用量与余额**：显示当前轮次和当前会话的预计费用，并通过 Host 使用官方凭据查询 DeepSeek 余额。费用是基于版本化价格快照的估算，不是账单；未知模型或缺少 usage 时不会虚构金额。
- **轻量充值中心**：在隔离的 BrowserWindow 中打开 DeepSeek 官方充值页面；禁用 Node、启用 sandbox/context isolation，并限制为 DeepSeek HTTPS 域名。页面无法内置加载时才退回系统浏览器。
- **退出清理**：先调用 Harness 的优雅关闭，再由 Windows Job Object 负责父进程退出时清理整棵 Harness 进程树；Job Object 不可用时保留精确 PID 的进程树终止兜底。关闭到托盘不等于退出，必须使用托盘“退出并清理后台进程”或应用退出操作。
- **会话轨迹岛**：顶部透明、可悬停展开的浮层，汇总长会话的轮次、运行、工具、错误与压缩状态；点击后优先按稳定锚点跳到对应聊天位置，缺少锚点时按比例回退定位。
- **GitHub 更新中心**：分别展示 Personal 客户端、Harness 运行时和随客户端发布的个人插件。客户端从 GitHub Releases 检查并只接受带 SHA-256 的 Windows 资产；NSIS 可在确认后退出安装，Portable 下载后由用户替换。Harness 更新会准备到独立版本目录、安装与构建、隔离预检后再重启切换，并保留上一运行时用于回滚，不覆盖当前 `D:\Deepseek Harness`。
- **AnySearch 网络搜索（测试版）**：第三方 `ctx.web` search provider，调用 `https://api.anysearch.com/mcp` JSON-RPC 接口；在 Harness 设置中保存 `ANYSEARCH_API_KEY` 和接口地址后即可让 `web_search` 使用 AnySearch，并支持把返回的 Markdown/JSON 结果规整为可引用来源。

十四个插件包包括两个内部基础模块（共用底座与 Personal Shell），以及主题、桌面设置、Skill 资料库、插件整理、连接中心、会话终端、用量余额、轨迹岛、更新中心、Project Control、Workbench 和 AnySearch 网络搜索十二项用户功能。Project Control 已完成 Gate 2C 的现有项目只读接入；它不会扫描后自动加入项目，也不会修改被扫描目录。Workbench 当前除候选详情 viewer 外仍主要是工具壳、路由和状态契约，七个页签不代表文件、代码、Diff、浏览器或 PTY 业务已经实现。设置类页面位于 Harness“设置”，会话终端、用量余额和轨迹岛出现在聊天界面。

## 当前范围与限制

- **Gate 2C 已实现**：Gate 1 四轨 Shell、Gate 2A 合同、Gate 2B SQLite/事务内核和 Gate 2C 只读接入均已落地。迁移已扩展为 `0001 + 0002 + 0003 + 0004 + 0005 + 0006`；`0003` 保存来源目录、扫描任务、候选、候选文档、问题和限时 `loc_`/`srt_` 引用，`0004_windows_path_nocase.sql` 保留来源级 `import_job_issues` 并作为 v4 阶段的 ASCII `NOCASE` 防线，`0005_windows_unicode_path_key.sql` 引入由 Host 生成的版本化 Unicode `path_key`（Windows 分隔符规范化、NFC、稳定 Unicode lower），统一覆盖 source root、active workspace、候选 latest/ignore 以及 register/rebind 的路径身份判断，`0006_file_sync_plans.sql` 持久化 Gate 2D write plan journal。若 v4 旧库已有 Unicode 等价重复路径，v5 升级会失败回滚并保留 pre-v5 backup，不会静默合并或删除。系统目录选择结果由桌面 Host 签名并绑定用途，Renderer 不能提交任意路径；每次确认前重新扫描并核对文档哈希，候选转为正式项目与 lifecycle 事务原子提交。
- **Project Control 仍不是完整项目管理器**：扫描只产生候选，必须逐项审阅和确认，不会自动导入。Gate 2C 的扫描、预览、忽略、只读关联和安全重绑都不写项目目录；Gate 2D P1/P2 已冻结模板与 write plan 合同并实现受控文件适配器（同盘 staging、fsync、哈希复验、原子 rename、回滚、启动恢复，仅临时 fixture 验证），标准新建与 legacy 升级的 lifecycle 接线仍在 P3/P4，因此 `createFromTemplate` 与 `upgradeManaged` 仍会返回 `CAPABILITY_NOT_NEGOTIATED` 并保留 write plan。当前也没有 Outbox dispatcher、WorkItem 写入、Agent 调度或跨 Harness 已认证 capability handshake。
- **Workbench 仍是契约骨架**：当前可验证页签、viewer 注册、open intent、恢复性持久化和 Details 路由，但不会读取/写入 Workspace 文件，不会加载网页、生成 Diff、启动第二份终端或执行 PTY。底部现有 Session PowerShell 仍是唯一已实现的终端能力。
- **rc.5 Details 边界**：Personal Shell 已把官方 `details` 子树交给 Workbench 的 `Details` 页签，并让 `openDetails/closeDetails` 走同一命令流；但 rc.5 当前 ChatView/工具卡仍没有从真实点击调用 `openDetails`。因此 Gate 1 证明的是兼容路由和唯一详情状态，不代表工具卡详情业务已经接通。
- **更新源限制**：更新中心仅访问公开 GitHub HTTPS 地址。Personal 客户端发布仓库需要先在设置中填写 `owner/repository`；没有发布仓库、Release 或校验文件时只会报告状态，不会安装。
- **终端限制**：当前是有界的纯文本 PowerShell 控制台，不是完整 VT 模拟器；依赖光标寻址的全屏交互程序不在支持范围。Windows rc.5 路径复用上游 `subprocess-local` 已安装的 `node-pty`，因此上游必须先完成 `pnpm install`。
- **Project Control 运行环境限制**：当前使用 Node 内置 `node:sqlite`，Node 会输出 ExperimentalWarning。数据库、目录选择和可信工作区路径拒绝 UNC/extended UNC；但仅凭盘符字符串无法证明映射盘是本地固定磁盘，因此 `PROJECT_CONTROL_HOME` 和签发的工作区位置都必须使用已知的本机固定磁盘，不能把映射网络盘当成本地路径。
- **封装限制**：Portable 仍依赖本机 Harness 源码目录、系统 Node 和现有 `DSH_HOME`，不是把整套 Harness 打进单文件。当前构建配置没有代码签名，Windows 可能显示 SmartScreen 提示。

## 安全与数据位置

- Harness 仅绑定 `127.0.0.1` 随机端口；主 Renderer 禁用 Node integration，启用 context isolation 和 sandbox。
- 主题、分类和连接元数据保存在 `%DSH_HOME%\personal\personal-suite.json`；桌面壳设置与更新状态保存在 Electron userData。
- Project Control 全局数据库已经创建在当前 Windows 用户稳定的 Electron `userData\project-control\project-control.sqlite3`，也可由显式 `PROJECT_CONTROL_HOME` 覆盖。它不跟随 `DSH_HOME`，也不得放入项目目录、Git 仓库、Portable 临时解压目录、网盘或网络盘。来源目录、候选、忽略状态和本机路径只保存在该控制面；扫描器只读项目文件，并阻止链接逃逸、超大/二进制内容和无界递归。
- Renderer 只能使用系统文件夹选择器返回的短期签名授权发起扫描；授权单次使用并绑定“来源目录”或“单个项目”用途。lifecycle 命令只携带 Host 签发的 `loc_`/`srt_` 引用，不把绝对路径作为可伪造的业务输入。
- Webhook URL、MCP 目标和密钥通过 Harness 官方 credentials provider 保存；浏览器只能看到配置状态和脱敏说明。
- 余额查询中的 `DEEPSEEK_API_KEY` 只在 Host 内解析并发送到固定的 DeepSeek 官方余额接口，不返回 Renderer；余额结果有短时缓存。
- 会话终端只能使用 Host 确认的 session 工作目录和 PowerShell 可执行文件；子进程环境会剔除常见密钥、Token、密码和 `DSH_*` 变量，输出、历史、标签数和请求体均有上限。
- 更新下载限制 HTTPS 主机、响应大小和超时，并要求 SHA-256 校验；Harness 候选的安装、构建与预检只继承启动所需的最小环境，使用隔离的 home、temp、npm/Corepack/pnpm 缓存、`DSH_HOME` 和 workspace，不继承用户凭据、SSH Agent 或 npm/git 用户配置。
- 新建 Skill 写入 `%DSH_HOME%\skills`；删除移动到 `%DSH_HOME%\personal\trash\skills`，不是永久擦除。
- 桌面入口只在 `%DSH_HOME%\profiles\web\node_modules\@cyrus` 创建指向本项目插件的目录连接，不改写 profile manifest 或用户 patch。

## 开发运行

前提：`D:\Deepseek Harness` 已执行 `pnpm install` 和 `pnpm run build`，系统可找到 Node.js、pnpm 和 Git。若上游位于其他目录，在启动前设置 `DSH_SOURCE_ROOT`。

```powershell
cd "D:\Deepseek Harness Personal"
pnpm install
pnpm start
```

## 双包体布局（2026-08-15 起）

- **稳定版（正式）**：已安装到 `D:\Cyrus Deepseek Harness`，数据与会话在 `F:\documents\Cyrus Deepseek Harness Data`；通过安装包/更新中心升级，不参与开发，不带开发日志。
- **测试版（开发）**：本仓库 `D:\Deepseek Harness Personal` 就是测试版的根目录；双击分发包 `分发包\测试版\DeepSeek-Harness-Personal-Dev-0.1.0-portable-x64.exe`（桌面「测试版」图标）即可运行，数据独立于稳定版，可同时开启。
- 仓库根目录保留 `一键迁移数据到F盘.cmd`（一次性数据迁移工具，含运行防护与报告）。

首次安装依赖仍只需在终端执行一次 `pnpm install`；打包与门禁不依赖资源管理器 PATH 中的全局 `pnpm`。

## 构建、测试与打包

```powershell
# 单元与插件专项测试
pnpm test

# 编译十三个插件包并检查 Host/Client bundle
pnpm run check:plugins

# 开发版真实 Electron 隔离冒烟
pnpm run smoke

# Windows 解包目录，并对解包 EXE 冒烟
pnpm run pack:win:dir
pnpm run smoke:packed:dir

# 分别生成 NSIS、Portable，或一次生成二者
pnpm run pack:win:installer
pnpm run pack:win:portable
pnpm run pack:win

# 对当前版本号对应的 Portable EXE 冒烟
pnpm run smoke:packed
```

安装版和 Portable 默认输出到 `artifacts\`；封装脚本同时为生成的 EXE 写入 `.sha256` 文件。所有 smoke 使用临时 `DSH_HOME`、Skill 目录、workspace 和 Electron userData，不应读取真实模型密钥或调用模型。

Gate 2C 已完成 scanner、storage、HTTP、Client、Workbench viewer 与桌面目录授权的专项验证，并用四个现有项目进行只读扫描验收：食溯 App 识别 51 份候选文档、Amazon Store 识别 6 份、Cyrus 量化模拟识别 14 份、Cyrus Music 识别 2 份，四项都判断为 `linked_legacy` 候选；验收不保存正文，也未改变项目目录。最终门禁为全量 `241/241`、十三插件构建/类型/语法检查通过，开发态与 `win-unpacked` Electron smoke 均通过 schema 5、Project Control API/UI、优雅退出、端口关闭和进程树清理；Gate 0 的普通 `cmd.exe` 双击入口及真实聊天/双 Session 签收继续作为历史证据。

`artifacts\win-unpacked` 已按 Gate 2C 重建并通过 packed smoke，包内已核对 preload、最新 Host/Client bundle 与 `0005_windows_unicode_path_key.sql`。Portable 与 NSIS 本轮没有重建，仍不能描述为 Gate 2C 制品；`compat.json` 也没有更新，继续记录 rc.5/`47f943` 的兼容基线。更新上游或重新封装后，应重新执行上述检查，并至少完成一次真实聊天与退出清理检查。
