# MEMORY_CRYPTO_AND_KEY_RECOVERY.md（加密与密钥恢复合同）

> 状态：P0 交付物 #4（2026-08-15）。依据：手册 v3 第 9.9.2 节与第 11 章决策 3/15（Cyrus 拍板）。
> 本文定义合同与 runbook；实现（SQLCipher 等依赖安装与加密库落地）按手册第 12.3 节执行边界单独申请。

## 1. 硬门槛（决策 15）

**加密不是「Stable 发布前」的最后包装，而是「第一次写入真实个人/商业记忆前」的硬门槛。**

- 加密完成前：P1–P2 只允许合成 fixture 数据。
- 验证失败时：不允许静默以明文库进入 Stable。
- 明文 + ACL 收紧只允许存在于开发期合成数据环境；真实 Sensitive/Private 数据不得进入该回退路径。
- 若最终方案只依赖 BitLocker/ACL，必须由 Cyrus 明确认可其威胁边界（不得静默降级）。

## 2. 密钥分层（envelope encryption）

| 层 | 内容 | 保护方式 |
|---|---|---|
| 分片 data key | 每个分片一个 256-bit 随机密钥 | 由 wrapping key 包裹后存库旁 |
| 日常 wrapping（DPAPI） | 本机 Windows 账户级 | DPAPI/Windows 凭据库；开机登录自动可用 |
| 恢复 wrapping（recovery key） | 跨机器/灾难恢复 | 由 Cyrus 保管的高熵恢复码（24 词或等价）派生/包裹 |

- 备份只携带「被包裹的 data key」；恢复密钥绝不与备份同放。
- catalog.sqlite3 含敏感项目名与路径，同样加密（不能因「无正文」而明文）。
- 密钥永不进 config、日志、导出包、仓库。

## 3. 恢复码生成与保管（决策 3）

- 用经过审计的密码学库生成 256-bit 随机恢复秘密；转成助记词时必须用明确、标准、带校验的编码（如 BIP39 24 词），**不得由模型自行挑选单词**。
- 两份纸质副本，放两个不同安全位置；密码管理器可存附加副本，但**不能是唯一副本**。
- 每年或重大迁移前，做一次「只用恢复密钥解开测试备份」的演练。

## 4. 密钥轮换 runbook（分级处理，不笼统「换钥匙」）

| 事件 | 处理 |
|---|---|
| 纸质副本丢失、未确认泄露 | 生成新 recovery wrapping key，用它重新包裹 data key（data key 不变） |
| recovery secret 可能已泄露 | 重新包裹所有分片 data key；必要时轮换 data key |
| 分片 data key 泄露 | 重加密对应分片（旧密文按保留期销毁） |
| 密钥不可用 | fail closed，不创建明文替代库 |

## 4.4 实现状态（2026-08-16 完成：DPAPI + 恢复口令 + 明文库升级 + 打包规则）

- ✅ live DB 加密引擎已接入 @cyrus/dsh-memory：better-sqlite3-multiple-ciphers 13.0.3（SQLCipher），存储抽象 openEngine 支持 plain/cipher 双引擎；密文落盘、无钥匙打开失败（fail closed）、VACUUM INTO 快照同样加密。
- ✅ 主密钥 v2（每记忆库根目录一把 memory.key.json）：DPAPI 自动解锁（powershell.exe 内建 ProtectedData + 应用专属 entropy，零第三方依赖）+ 恢复口令包裹（12 词 BIP-39 口令 → scrypt(N=16384,r=8,p=1) → AES-256-GCM）。
- ✅ 一次性恢复口令文件：首次生成主密钥时写入 <记忆库根目录>/recovery-passphrase.txt，用户转存（cyrus-keyring）后自行删除；恢复 CLI scripts/memory-recover.mjs <根目录> <口令>（--verify 只校验；无 node 时可用 ELECTRON_RUN_AS_NODE 走应用运行时）。
- ✅ 旧格式迁移：v1 十六进制 .key 自动收养为主密钥后删除；明文旧库在启用加密后经 rekey 原地升级（保留 .pre-encrypt.bak，失败自动还原）。
- ✅ encryptionEnabled 默认开启；启动自检（DSH_MEMORY_SELF_TEST=1）真实走一遍解锁+打开+完整性校验，失败拒绝启动。
- ✅ 打包：files 规则已带 plugins/memory/node_modules/better-sqlite3-multiple-ciphers/**；冒烟新增断言（memory.key.json v2 / recovery-passphrase.txt / catalog 密文落盘）。
- 测试：memory 插件 27/27（新增 DPAPI 往返、口令包裹、主密钥、v1 收养、明文库升级、恢复 CLI 6 组）；冒烟含自检断言全绿。

## 4.5 P1 spike 证据（2026-08-15，临时目录合成验证）

- better-sqlite3-multiple-ciphers 在本机 Node 25 / Windows 原生构建成功（npm 安装 + 原生绑定加载通过）。
- 验证项：密文库写入/读出 ✓；无 key 打开即失败（fail closed）✓；VACUUM INTO 快照同样加密、无 key 不可读 ✓。
- 用法注意：db.pragma("key = '...'") 与 VACUUM INTO 目标必须加单引号。
- 结论：SQLCipher 路线在目标机器可行；正式集成（存储抽象替换 + 恢复演练）在首次真实数据写入前完成。

## 5. 实现选型与验证顺序

1. 候选：SQLCipher（经 better-sqlite3-multiple-ciphers）或 SQLite 官方 SEE；P1 在合成 fixture 上做 spike。
2. Spike 验收项：Windows/Electron 原生构建、WAL 加密、backup() 对加密库的一致性快照、恢复演练（用恢复码解开测试备份）、迁移（明文 fixture → 加密库，或加密库 → 新机器）。
3. 存储层抽象先行：引擎选择不影响上层 schema/工具面；切换引擎不重写业务代码。
4. 导出包加密信息：manifest 记录加密信息；DPAPI 明文密钥、恢复码本体永不进导出包（只携带被包裹的 data key）。

## 6. 与备份/导出/删除的衔接

- 离线快照 = 加密、版本化、不可变；恢复密钥不得与备份同介质。
- 删除语义不变（tombstone + 级联）；加密只改变存储层，不改变删除合同。
