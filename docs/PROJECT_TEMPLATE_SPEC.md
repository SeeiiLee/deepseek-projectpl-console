# Project Template 与 Gate 2D 文件同步合同

状态：**Gate 2D P1 合同冻结**。模板身份/版本、write plan 语义、crash/retry/replay 与文件↔数据库一致性协议在此冻结；文件适配器（P2）、快速新建（P3）、legacy 升级（P4）与文档刷新（P5）随后按本文件实现。
开发维护：DeepSeek Harness（2026-08-15 起）
协议族：project-control.dsh / project-template.dsh
线版本：v1alpha1
日期：2026-08-15

本文件是 [PROJECT_INTAKE_SPEC.md](PROJECT_INTAKE_SPEC.md) 第 11/12 节的 Gate 2D 执行合同，与 [PROJECT_PROTOCOL.md](PROJECT_PROTOCOL.md) 的 lifecycle Schema 共同构成机器可验证边界。模板的机器合同位于 protocol/project-control/v1alpha1/templates/。

## 1. 模板注册表（Template Registry）

### 1.1 身份与版本

- 模板身份 = templateId（正则 ^[a-z][a-z0-9.-]{1,127}$）+ templateVersion（严格 ^[0-9]+.[0-9]+.[0-9]+$，最大 64 字符）。
- 模板版本一旦随应用发布即不可变：任何内容变化必须产生新的 templateVersion，不得原地改写已发布版本；相同 (templateId, templateVersion) 的模板内容必须逐字节一致。
- templateVersion 与 Project Protocol 线版本相互独立：新建项目记录 origin.templateId/templateVersion；已有项目不因客户端更新自动套用新模板版本，升级模板必须是显式操作并先显示逐文件新增/修改预览。
- 不提供 latest 等浮动别名；客户端必须选择精确版本。Host 只允许使用 metadata.protocolVersion === project-control.dsh/v1alpha1 的模板执行新建。

### 1.2 来源与存放

- v1alpha1 模板是随插件发布的 Host 资产，位于 plugins/project-control/templates/<templateId>/<templateVersion>/template.json；不支持运行时下载或用户自造模板。
- 首批内置模板为 minimal-standard（最小标准项目）、software-standard（软件项目）、research-standard（研究项目）；其具体内容在 P3 实现时按本合同编写并经 Cyrus 审阅。
- 模板清单不进入全局数据库；数据库只保存每个新建项目使用的 templateId/templateVersion/templateHash 事实镜像。

### 1.3 机器合同

每个模板版本一个 template.json，必须通过：

protocol/project-control/v1alpha1/templates/schemas/template-manifest.schema.json

- files 是项目根相对路径 → 文件内容或目录的列表；路径规则复用 lifecycle Schema 的 relativePath（POSIX、无盘符/反斜杠/控制符/./.. 段/双斜杠/尾斜杠）。
- kind=file 必须有 content（UTF-8 文本）；kind=directory 只声明目录本身。
- 上限：files ≤ 64 项，单文件内容 ≤ 64 KiB，全部内容合计 ≤ 256 KiB（Host 规则）。
- 全部 relativePath 必须唯一（无论 kind）；目录与同名文件冲突、或文件缺少祖先目录声明，属于非法模板（Host 规则）。
- 模板必须恰好包含一个 .dsh-project/project.yaml 文件条目（Host 规则）；其余文档（PRD、ARCHITECTURE、DEVLOG、NEXT、ADR 等）由模板决定，且必须包含清晰的待填写提示，不得生成看似已确认的目标、成功标准或进展事实。

### 1.4 占位符与渲染

模板文件内容只允许出现五个占位符，且创建时全部替换：

| 占位符 | 替换值 |
| --- | --- |
| {{PROJECT_ID}} | 本次新建分配的 prj_<uuidv7> |
| {{PROJECT_NAME}} | 用户确认的项目显示名（原样，长度经 Schema 限幅） |
| {{CREATED_AT}} | UTC RFC 3339 毫秒时间（Z 结尾） |
| {{TEMPLATE_ID}} / {{TEMPLATE_VERSION}} | 模板身份与版本 |

- .dsh-project/project.yaml 模板必须使用全部五个占位符；其余文件可用可不用。
- 目录路径不得包含占位符；文件内容不得包含上述五个之外的任何 {{ 或 }} 片段（Host 规则，防止渲染歧义）。
- 替换后的 project.yaml 必须通过 project-manifest.schema.json 与 Host 的 manifest 校验，且 origin.kind=template 携带 {{TEMPLATE_ID}}/{{TEMPLATE_VERSION}} 的替换结果。
- 渲染是纯文本替换，不执行模板宏、条件或包含指令。

### 1.5 templateHash

templateHash 定义为：对 { templateId, templateVersion, files: [按 relativePath 码点升序排序的 { relativePath, kind, content? } 列表] }（目录项无 content 字段）做 RFC 8785 风格 JSON 规范化序列化后的 SHA-256，线格式 sha256: 加 64 位小写十六进制。Host 使用的规范化函数与命令请求哈希一致（plugins/project-control/src/host/canonical-json.js）。files 在模板文件中允许任意顺序，但哈希输入固定排序；排序后集合不同（如重复路径、文件/目录冲突）即模板非法。

## 2. Write Plan 合同

### 2.1 DTO（已冻结，不改）

命令携带的 write plan DTO 是 Gate 2B 已冻结的 lifecycle-command-envelope.schema.json 的 $defs.writePlan，字段不再变化：

- planId：pln_<uuidv7>，单次使用；重试/重放必须携带同一 planId。
- planHash：去掉 planHash 后对 {manifestHash, syncPolicy, operations} 做 RFC 8785 规范化 JSON 的 SHA-256；Host 必须重算，不信任自报值。
- manifestHash：写盘后 project.yaml 的精确 UTF-8 字节 SHA-256。
- syncPolicy：atomic_create（新建，目标整体必须 absent）或 atomic_additive（升级，只新增不存在的路径）。
- operations：仅允许 create_directory / create_file，relativePath 为项目根相对路径，expectedState=absent，create_file 必须带最终字节的 contentHash。

### 2.2 目标根与路径规则

- 目标根永远来自 Host 签发的 targetLocationRef（新建）/ locationRef（升级）；Renderer 与命令 DTO 不携带绝对路径。
- 每个 operation 的 relativePath 解析后必须位于目标根内；执行前后都解析 real path/reparse point 并再次验证 containment。
- 新建：目标根本身必须不存在或为空目录，且在准备与执行之间保持 absent/空。
- 升级：目标根必须仍是已登记的 active location；operation 目标在准备与执行之间必须保持 absent。

### 2.3 Host 领域规则（Schema 之外）

- operations 全部 relativePath 唯一；create_directory 集合必须恰好覆盖“需要创建的”文件祖先目录：每个声明目录必须是至少一个文件的祖先（不得多写无关目录）；atomic_create 中文件的每个祖先都必须声明（目标根是全新的）；atomic_additive 中未声明的祖先必须在磁盘上已存在且是目录（执行期验证），不得把已存在目录声明为 create_directory（其存在会触发 absent 检查失败）。
- 目录操作排在文件操作之前；Host 内部按（目录 → 文件，各自按路径排序）规范化执行顺序，不依赖调用方顺序。
- v1alpha1 禁止覆盖、移动、删除与内容修改；expectedState 只有 absent。任何覆盖策略都属于新协议线版本，不得在 Host 里“默认覆盖”。
- 计划过期：plan 只在签发它的 refs 未过期、未撤销且 planId 未使用过时有效；默认 TTL 300 秒。过期/被占用后必须重新准备并生成新 planId。

## 3. Crash / Retry / Replay 语义（冻结）

新建（createFromTemplate）与升级（upgradeManaged）的执行顺序固定为：**文件先提交并复验 → SQLite 事务后提交**。数据库永远不会在文件未提交或复验失败时写 success。

文件同步内部阶段：planned → staging → staged → files_committed → accepted；回滚阶段 rollback → rolled_back；异常 failed_recovery_required。每个 plan 在全局数据库有持久化 journal（Gate 2D 迁移新增），记录 planId、commandId、目标根、operations、阶段、已创建文件清单与时间戳。

| 崩溃窗口 | 恢复行为 |
| --- | --- |
| W1 准备/暂存中崩溃 | 启动恢复删除本次 staging 残留，journal → rolled_back；重试重新准备/暂存 |
| W2 暂存完成、rename 前崩溃 | 启动恢复校验 staging 哈希后删除残留，journal → rolled_back；相同 commandId 重试从准备重新执行 |
| W3 rename 完成、DB 提交前崩溃 | 文件已按 plan 存在且无 receipt。启动恢复复验全部文件哈希：与 plan 完全一致时允许按原 plan 完成唯一一次 DB 提交（accepted）；不一致时不得写 DB，进入 Quarantine 并返回 rejected |
| W4 DB 提交完成、响应前崩溃 | 相同 commandId 重放从持久化 Receipt 返回原结果，绝不重新执行文件计划 |

- 重放（replayed）只读 Receipt，不重跑文件计划、不重写文件、不产生第二个 Event。
- 同 commandId 不同规范化请求 → IDEMPOTENCY_CONFLICT。
- 启动恢复只处理自己 journal 记录的路径，绝不静默删除未知文件；无法归属的残留进入 Quarantine 待人工处理。
- accepted/replayed 的 fileSync 只能是 committed；planned、rolled_back、failed_recovery_required 只能出现在 rejected。

## 4. 文件 ↔ 数据库一致性协议（冻结）

1. 执行前复验：refs 未过期未撤销、planHash 重算一致、templateHash 与注册表一致、目标根状态仍满足 absent/空、升级的 location revision 与 legacy fingerprint 未变。
2. 内存预渲染：用当前占位符值渲染全部文件，渲染后的 project.yaml 立即通过 Schema 校验；任何失败在写盘前 rejected（MANIFEST_INVALID），磁盘零接触。
3. 同盘 staging：staging 目录位于目标根同卷且以 planId 命名（新建时是父目录下的 .dsh-staging.<planId>；升级时是目标根内的 .dsh-staging.<planId>，全程不越出授权根）；写入每个文件后 fsync 并核对 contentHash。升级的既有父目录（如 docs）在 staging 中仅作为空透传目录镜像，不参与 rename。
4. 原子提交：新建以整树 rename 落入目标根；升级按（目录 → 文件）顺序逐项 rename，每项前后记录到 journal。
5. 复验：落盘后重新读取并核对 manifestHash 与全部 contentHash；任何不一致 → 回滚 → rejected FILE_SYNC_FAILED。
6. DB 事务：只有复验通过后，才在同一事务内提交 Project/location/manifest mirror/bindings/Receipt/Event/Outbox 并推进 revision；accepted 的 fileSync=committed。
7. DB 事务失败（如 revision 冲突）：回滚本次创建的文件（逆序删除，目录最后），journal → rolled_back，rejected；回滚不完整 → failed_recovery_required + Quarantine，绝不把 DB 标成功再假装文件最终会成功。
8. 升级回滚后项目保持 linked_legacy，mode 与 revision 均不变。

## 5. 结果表（冻结）

| 情况 | 结果 |
| --- | --- |
| 用户取消确认 | plan 保持 planned 并到期；零磁盘写入、零 DB 写入、无 Receipt |
| 新建目标已存在或非空 | rejected TARGET_NOT_EMPTY；不写任何内容 |
| 升级 operation 目标已出现 | rejected WRITE_PLAN_STALE；要求重新准备；零写入 |
| 渲染后 manifest 非法 | rejected MANIFEST_INVALID；写盘前失败 |
| 磁盘/权限失败 | rejected FILE_SYNC_FAILED；回滚已创建内容；回滚不完整 → failed_recovery_required + Quarantine |
| 进程崩溃 | 按第 3 节窗口恢复；绝不伪造成功、绝不留下半 manifest、不产生孤儿 Project |
| 相同 commandId 重试 | replayed 原 Receipt；不重跑文件计划 |
| 篡改/不同请求同 commandId | IDEMPOTENCY_CONFLICT |
| 准备后但未执行的 plan 过期 | 不可执行；重新准备生成新 planId |

## 6. 升级为 managed 的补充规则

- 升级只新增缺失的 .dsh-project/project.yaml、标准输出目录与 manifest 声明的缺失文档；不移动、不改名、不重写既有 PRD/DEVLOG/README。
- 升级前固定 legacy fingerprint：sha256: 加规范化 JSON {projectId, documentBindings:[{role, relativePath, contentHash}]}；执行时重新核对，不一致 → WRITE_PLAN_STALE。
- 升级保留原 projectId、原 location、原文档绑定；成功后 mode → managed、revision+1，并写入 manifest 事务镜像。
- 取消、失败或回滚不改变项目文件与数据库 mode。

## 7. P1 验收（2026-08-15 已通过）

- [x] template-manifest Schema 严格编译（Ajv 2020-12 strict + formats）。
- [x] fixtures 全部与 index 声明一致（2 valid + 6 invalid、错误关键字精确匹配）。
- [x] Host 规则测试：唯一 project.yaml、五个占位符、替换后通过 project-manifest Schema、目录集合恰好覆盖文件祖先、重复路径与非法 token 拒绝。
- [x] templateHash 规范化与确定性测试（键序无关、files 排序、目录项无 content、内容/版本敏感）。
- [x] 本文件与 PROJECT_INTAKE_SPEC.md、PROJECT_PROTOCOL.md、PROJECT_CONTROL_DATA_MODEL.md 无冲突（write plan DTO 沿用已冻结 lifecycle Schema，未改动既有 Schema 字节）。
- [x] pnpm test 248/248 与 pnpm run check:plugins 全绿（新增 plugins/project-control/test/template-contract.test.js 7/7）。

P2 起按本合同实现文件适配器（仅临时 fixture）；任何真实项目写入前，预览、覆盖策略、回滚与验收必须交给 Cyrus 确认。
