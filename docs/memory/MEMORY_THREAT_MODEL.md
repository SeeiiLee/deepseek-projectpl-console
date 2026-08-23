# MEMORY_THREAT_MODEL.md（威胁模型）

> 状态：P0 交付物 #7（2026-08-15）。依据：手册 v3 第 9.9.1 节。单人本机 Windows 桌面为唯一场景。

## 1. 资产

1. 记忆正文（claims，含 Sensitive：商业策略/个人偏好）与 provenance。
2. embeddings（继承原文敏感等级）。
3. catalog（项目名、路径、敏感等级——本身也是敏感元数据）。
4. 备份/导出包（离开本机后风险面扩大）。
5. 密钥材料（data key、恢复码、GitHub PAT——单独威胁面）。
6. 有效 prompt / 诊断 manifest（治理规则与记忆召回的组合视图）。

## 2. 攻击者与威胁

| # | 威胁 | 控制 | 状态 |
|---|---|---|---|
| T1 | 其他本地进程读未加密库 | 静态加密（硬门槛）+ ACL 收紧 | P1 落地 |
| T2 | 备份盘丢失/被盗 | 加密+版本化不可变快照；恢复密钥与备份分离 | P1 |
| T3 | A 项目会话召回 B 项目敏感内容 | scope 硬过滤在检索前；跨项目默认关闭；cross-project leak=0 验收 | P1/P2 |
| T4 | 仓库文档/历史记忆含 prompt injection | 结构化字段+delimiter+转义；召回不进 System；不可调用工具/改权限；注入文本降权隔离 | P1/P2 |
| T5 | 自动提取保存密钥/健康/身份 | 写入门禁（secret/PII 扫描硬拒绝）+ 默认关闭 + 敏感类永不自动 | P1/P3 |
| T6 | embedding endpoint 配错到远程 | Ollama 仅精确 loopback；禁凭据/路径/宽松 loopback；不跟随重定向；远程需单独授权 | P4 |
| T7 | 恶意 symlink/reparse point 跨目录读 | 路径解析规范 + 受保护路径守卫（复用 Project Control path_key 纪律） | P1 |
| T8 | 日志/诊断泄露内部规则与记忆 | recall_log 默认 hash-only；诊断默认 manifest、全文显式开启+加密+过期 | P1 |
| T9 | vendor 依赖漏洞/未预期联网 | P4/P5 引入前审计许可/联网/锁 commit；preflight 扫描 | P4/P5 |
| T10 | 库被篡改且哈希被重算 | manifest + HMAC/签名（P6 硬化，密钥入凭据库）；append-only 审计 | P6 |
| T11 | 过时记忆被当成当前事实 | 双权威链 + last_verified_at + 引用义务 + superseded 退出召回 | P1/P2 |
| T12 | 删除请求只删 live、备份永久保留 | 删除语义写明备份按保留期过期 + tombstone 证明 | P1 |
| T13 | Renderer 越权/任意 SQL | Host 侧有界 API；参数白名单；SQL 参数化；每次写重新验证项目与授权 | P1 |

## 3. 信任边界

- Host/Renderer 边界：Renderer 无库路径、无任意 SQL。
- flavor 边界：Dev/Test 不直接读写 Stable live DB；受保护路径守卫。
- 网络边界：loopback-only（Ollama）；更新中心仅 api.github.com/github.com/objects.githubusercontent.com + 最终域名白名单；外发动作逐项授权。
- 发布边界：preflight 扫描阻断密钥/数据库/会话进包。

## 4. 残余风险（接受或待定，需 Cyrus 知情）

1. 构建未签名（codeSigningStatus: not-configured）——SmartScreen 提示；签名证书属采购决策。
2. 公开仓库代码可见性——已由 Cyrus 主动转公开（更新通道需要）；包内无密钥/个人数据/会话（preflight 保证）。
3. HMAC/签名防篡改排到 P6——本机单用户模型下攻击者若可改文件并重算哈希，大概率也可读本机密钥；先接受 SHA-256 + append-only 审计。
4. 物理接触本机且能登录账户 = 可解密（DPAPI 边界）；恢复码纸质副本的物理安全由 Cyrus 负责。
5. BitLocker/ACL 若作为正式方案需 Cyrus 明确认可边界（不静默降级）。
