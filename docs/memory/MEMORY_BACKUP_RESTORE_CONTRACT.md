# MEMORY_BACKUP_RESTORE_CONTRACT.md（备份与恢复合同）

> 状态：P0 交付物 #5（2026-08-15）。依据：手册 v3 第 9.9.4/9.9.5 节与第 11 章决策 1/2（Cyrus 拍板）。

## 1. 目标（决策 1 拍板）

| 项 | 值 |
|---|---|
| 普通 RPO | ≤ 24 小时 |
| 危险变更前 RPO | 0（快照完成并暂停相关 writer 后再变更） |
| 单项目 RTO | ≤ 2 小时 |
| 恢复演练 | 每季度一次真实演练，留有证据 |

## 2. 快照触发

- 每日：一次完整、经 integrity_check 的在线一致性快照。
- 事件触发：大升级、schema migration、批量导入/删除前立即一次（RPO=0）。
- 节流触发：用户确认高价值记忆批次/重要 promotion 后可触发一次增量/快照任务。

## 3. 快照方法

- 首选 better-sqlite3 backup()（Online Backup API）；满足条件时可用 VACUUM INTO。
- 禁止 writer 运行时直接复制 WAL 主库文件。
- 快照后必做：隔离连接打开 → PRAGMA integrity_check → schema 版本校验 → claims/evidence/relations/FTS 数量对账 → manifest + SHA-256 → 记录 snapshot id/时间/来源 revision。

## 4. 保留期（拍板起点；磁盘成本 P0 用合成规模测算后确认）

每日 14 份 · 每周 8 份 · 每月 12 份 · 迁移前快照保留至验收后至少 30 天 · 项目归档包按项目生命周期。

## 5. 异物理副本（决策 2 拍板）

- 只写加密、版本化、带 manifest 的**不可变 snapshot** 到另一物理设备。
- 不做镜像、不做删除同步、不覆盖唯一旧备份。
- standing authorization 必须限定：设备标识、目标根、数据等级、保留期、停止开关。
- 等级规则：Internal 允许进加密移动盘；Sensitive 需项目级 allowlist；Restricted 正文不进记忆库故不进入普通备份；云端暂不启用（未来单独审批，只传客户端已加密包）。
- 3-2-1 本地个人版：3 份逻辑副本、2 种介质/故障域、1 份离线或异机加密副本；同一 F 盘不同目录不构成独立故障域。

## 6. 目录拓扑（与 9.12 一致）

- live：<数据根>/memory-live/
- 同机快照：<数据根>/memory-snapshots/（与 live 不同目录、同一故障域）
- 离线：<另一物理设备>/memory-offline/

## 7. 恢复流程

停止目标 writer → 保留损坏现场与日志 → 选择已验证 snapshot → 恢复到临时目录 → 解密并校验 manifest/hash → integrity_check + schema/FTS/关系对账 → 召回回归 + 人工抽样 → 原子切换 active pointer → 只读验证 → 恢复写入 → 记录 incident 与恢复证据。禁止先覆盖唯一损坏库再调查。

## 8. 验收断言（P1 必须可测）

1. 快照在 writer 活跃时完成且隔离打开 integrity_check = ok。
2. 快照后 claims/evidence/relations/FTS 数量与原库一致。
3. 危险变更前快照存在且时间戳先于变更。
4. 恢复演练全流程 ≤ 2h 且有回执记录。
5. 离线副本与 live 不在同一故障域；删除 live 文件不影响既有版本化快照。
