# 发布红线（GitHub 推送规则，Cyrus 定）

任何推送到 GitHub 的内容（Release 资产、Release Notes、README 等）都必须先过 node scripts/preflight-publish.js 门禁。红线如下：

## 绝对禁止包含

1. 会话记录：任何聊天/会话内容、日志正文、对话导出。发布物只包含程序本身。
2. 个人数据：个人文件、项目数据、数据库（*.sqlite3*）、key.txt、secrets.encrypted.json、.credentials.yaml、audit.json 等。
3. 密钥：GitHub PAT（github_pat_* / ghp_*）、OpenAI 风格 sk-*、AWS AKIA*、私钥块、Slack token 等一切凭证。
4. 凭证只存在于 F:\QClawData\workspace\secure（cyrus-keyring 加密库）；使用时从 keyring 读取，绝不写入仓库文件或日志。

## 强制门禁

- scripts/preflight-publish.js：扫描随包发布的全部文件（src/assets/plugins/protocol，295+ 文件），命中任何密钥模式、数据库/密钥文件名即阻断打包（exit 1）。
- 已接入 scripts/pack-desktop.js：stable 身份打包前自动执行；dev 身份打包不受限（不对外发布）。
- docs/ 中的个人路径引用只报告不阻断（发布 Notes 前需人工复核并脱敏）。
- .gitignore 已覆盖 node_modules、artifacts*、分发包、日志、密钥/数据库文件，防止未来 git init 时误提交。

## 发布前人工核对清单

- [ ] node scripts/preflight-publish.js 通过。
- [ ] Release Notes 不含个人路径（F:\QClawData、F:\documents\Cyrus、C:\Users\Administrator 等）。
- [ ] 资产仅限 分发包\稳定版 的 exe + .sha256 + blockmap。
- [ ] GitHub token 从 keyring 读取使用，提交历史中不出现。
- [ ] **P4 嵌入模型随包（2026-08-17 起，路径政策修订）**：模型目录按 flavor 解析，不写死路径——开发版 `F:\Cyrus Dev Harness Data\models\bge-m3-onnx`；稳定版 `F:\documents\Cyrus Deepseek Harness Data\models\bge-m3-onnx`（应用管理，非系统盘）；`DSH_MEMORY_EMBEDDING_MODEL_DIR` 仅作显式覆盖。
- [ ] **发布包模型必须用「干净版」**（Cyrus 拍板）：打包来源 = 与 manifest SHA-256 一致的原下载纯净副本，**绝不使用开发版运行目录中的模型**；打包时重算模型 SHA-256 与 `docs/p4-model-manifests/bge-m3-onnx-int8.json` 比对一致才允许进包（模型 SHA-256 `0826f8c1…b77d`）。
- [ ] **hybrid 默认开**：稳定版 hybrid 召回默认开启（Cyrus 拍板 2026-08-17），`DSH_MEMORY_HYBRID=0` 为保留的一键关断。
- [ ] **统一发布纪律**：P4 不单独发版；待整个记忆系统（P5/P6）完成后统一更新。

## 记忆插件商用剥离（2026-08-17 Cyrus 拍板）

- 记忆插件（@cyrus/dsh-memory）可以整体剥离、单独打包售卖——个人行为、小批量、不走公账；代码归属与平台条款由 Cyrus 自行负责。
- 时机：**不现在做**。等整个插件收尾（统一发布 + 正式版试点/全量导入验收）之后，再整体打包。
- 出包轮核对清单（未核实项一律先核实再出包）：
  - [ ] SQLCipher 社区版条款（better-sqlite3-multiple-ciphers 内嵌加密代码）
  - [ ] bge-m3 模型权重许可（或改为「用户自备模型」模式，绕开权重分发）
  - [ ] 去掉个人定制：食溯硬编码（工具描述/抽样标签/提取提示词）、中文提示词参数化、@cyrus 包名、对 personal-foundation 凭据解析的依赖
  - [ ] 平台 SDK 许可随包声明（cordis MIT；dsh-* BSD-3-Clause）
  - [ ] 依赖许可随包声明（已核实：better-sqlite3-multiple-ciphers MIT、transformers Apache-2.0、onnxruntime MIT、koffi MIT）
