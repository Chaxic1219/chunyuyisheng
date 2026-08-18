# 模块化单体 · 架构约定

## 目标

同进程「模块化单体」：模块内高内聚，模块间只通过 **Query / Command / Event** 协作。

## 目录

```text
app/
  shared/          # eventBus、架构约定
  modules/         # 领域门面：outbox / community / qiwe / followup / ops
  routes/          # HTTP 适配层（patient-public / auth-admin / content-admin / channel-bridges / *-admin…）
  agent/           # 对话 Agent（并列模块，勿依赖 community）
  server.js        # 启动 + 中间件 + 挂载路由
```

## 依赖方向（强制）

```text
routes  →  modules.*  →  （懒加载）实现文件 → shared
agent / triage  ↛  community
qiwe_bridge  →  modules/community   （禁止直接 require community.js）
community    →  modules/qiwe        （禁止顶层 require qiwe_bridge）
出站写入     →  仅 modules/outbox
```

## 出站唯一入口（表归属 modules/outbox）

`outbound_queue` **由 outbox 模块自管数据和写入规则**：

| 文件 | 职责 |
|------|------|
| `modules/outbox/repo.js` | **唯一**允许执行 `INSERT`/`UPDATE` 本表核心写入 |
| `modules/outbox/rules.js` | 公开对象整形、闸控常量 |
| `modules/outbox/status.js` | `setOutboxStatus` 真发编排（wecom / modules.qiwe） |
| `modules/outbox/service.js` | `enqueue` / `enqueueDirect` / `insert` + 事件 |

对外 API：

- `outbox.enqueue(...)` — 社群管线入队
- `outbox.enqueueDirect(...)` — 分诊台手动/直发入队
- `outbox.insert(...)` — QiWe 桥接等特殊形态（欢迎审计、媒体转人工等）
- `outbox.setOutboxStatus(...)` — 状态机与真发（已迁入本模块）
- `outbox.editOutboxText` / `setOutboxAssignee` / `sendOutboxForDecision`

禁止在 `qiwe_bridge.js` / `community.js` / `server.js` 等业务文件直接插入或更新出站表。  
`community.enqueue` / `community.setOutboxStatus` / AI 草稿更新等仅作兼容委托。  
群合并重挂：`outbox.reassignGroup(from, to)`。

## 随访模块（表归属 modules/followup）

| 文件 | 职责 |
|------|------|
| `modules/followup/repo.js` | `followups` 表读写；方案配置 Query `doctors.content` |
| `modules/followup/rules.js` | 时间轴 / 节点状态规则 |
| `modules/followup/service.js` | enroll / mine / listQueue / markNode… |

## 社群模块（群/成员/消息表归属 modules/community）

| 文件 | 职责 |
|------|------|
| `modules/community/repo.js` | **唯一**允许写 `community_groups` / `community_members` / `community_messages` |
| `modules/community/rules.js` | groupOut / messageOut、命名模板、占位 ID、枚举 |
| `modules/community/service.js` | findQiwe* / createGroup / findGroup / upsertMember … |
| `modules/community/inbound.js` | `archiveQiweInbound` 事实落库 + 图文锚点（不依赖 community.js） |
| `modules/community/orchestrate.js` | `handleInbound` 入站主编排（agent / 规则 / 意图 / triage） |
| `modules/community/moderation.js` | 群风控词表 / 报警 / AI 只升不降 / 医助处置 |
| `modules/community/runtime.js` | 入站共用话术变量、@名、自动发闸、enqueue 委托 |
| `modules/community/workspace.js` | overview / 真建群 / 通讯录 / 改群 / reminders |
| `modules/community/campaigns.js` | 周运营 / 知识候选 / 医助草稿 / 定时周产 |
| `modules/community/index.js` | 门面（事件 + 聚合导出） |

根目录 `community.js` 为兼容再导出。运营后台：`routes/community-admin.js`。  
overview 读路径经 community/repo + outbox Query；`db.js` 大拆仍待后续（已迁出 `db_message_media.js` 媒资只读助手，零行为再导出）。

## P1 数据安全约定（出站）

- 欢迎语（`source=welcome`）**禁止** `insert({ status:'sent' })`；须先 `pending` 再 `setOutboxStatus(..., 'sent', { requireRealSend:true })`。
- `outbox/repo.insert` 对 welcome+sent 会强制降为 pending（防回归写假 sent）。
- 失败保留 pending 草稿，不删除队列行。

## 企微桥接模块（modules/qiwe）

| 文件 | 职责 |
|------|------|
| `modules/qiwe/shared.js` | db 代理、去重、医生范围闸、通用工具 |
| `modules/qiwe/media.js` | 入站图片预览落地、818 海报素材 |
| `modules/qiwe/cards.js` | 小程序卡 / 链接卡 / 模板采集 / 自动发闸 / 欢迎卡模板 |
| `modules/qiwe/delivery.js` | prepareDelivery / deliverReplyToQiwe / deliverOutbox |
| `modules/qiwe/callback.js` | processEvent / 入群欢迎 / handleCallbackBody |
| `modules/qiwe/index.js` | 门面（出站真发入口） |

根目录 `qiwe_bridge.js` 为兼容再导出。community 出站真发经 `modules/qiwe.deliverOutbox`。

## 运营配置模块（表归属 modules/ops）

| 文件 | 职责 |
|------|------|
| `modules/ops/repo.js` | **唯一**允许 `ops_configs` / `ops_config_audit` 核心写入 |
| `modules/ops/rules.js` | 默认话术 / 校验 / 域元数据 / render |
| `modules/ops/service.js` | published 只读 + saveDraft / publish / rollback / ensure + 事件 |

根目录 `ops_config.js` 为兼容再导出。配置中心 HTTP：`routes/config-center.js`。  
发布后改 doctors/rules/community_groups 的副作用仍由编排层 `apply*` 调用（不跨模块写他人表）。

## 事件

使用 `shared/eventBus.js`。当前：

| 事件 | 时机 |
|------|------|
| `outbox.enqueued` | 入队 |
| `outbox.sent` | 真发成功 |
| `community.inbound.archived` | QiWe 业务群消息归档成功 |
| `community.moderation.flagged` | 群风控报警落库 |
| `followup.enrolled` | 随访入组 |
| `followup.node.updated` | 随访节点状态变更 |
| `ops.config.published` | 配置中心发布 |
| `ops.config.rolled_back` | 配置回滚 |

启动时 `modules/wiring.js` 注册副作用（`setImmediate` 延迟执行，不堵请求）：

- `outbox.*` → 清理过期 `admin_sessions`（只删过期行）
- `community.moderation.flagged` → 写入 `doctor_notifications` 提醒医助
- `MODULAR_EVENT_LOG=1` 可打开详细日志

另：`shared/routeIndex.js` 按 method 分桶 + 精确路径快表；admin 会话滑动续期默认 60s 写库节流（`ADMIN_SESSION_PERSIST_MS`）。

## 演进顺序

1. ~~统一 outbox~~（Phase 0–1）
2. ~~拆 routes 壳~~（Phase 0–1 试点 + Phase 3 出站审核）
3. ~~解 community ↔ qiwe_bridge~~（Phase 2）
4. ~~repo/service 门面~~（Phase 3：followup / ops / community / qiwe）
5. ~~配置平台化（事件）~~（Phase 4）
6. ~~outbox 写入硬闭环 + repo/rules~~
7. ~~outbox 状态机迁入（setOutboxStatus / edit / assignee）~~
7b. ~~outbox UPDATE 硬闭环（AI 草稿 / 群合并 reassignGroup）~~
8. ~~followup 真模块（repo/rules/service）~~
9. ~~ops 真模块（读侧 repo/rules/service）+ moderation 路由迁出~~
10. ~~ops 写路径（draft/publish/rollback）+ config-center 路由迁出~~
11. ~~community 群/成员真模块（repo 硬闭环）~~
11b. ~~community_messages 写入硬闭环（归档/风控/入站委托 repo）~~
11c. ~~archiveQiweInbound 迁入 modules/community/inbound（门面不再懒加载归档）~~
11d. ~~handleInbound → orchestrate；风控 → moderation；community-admin 路由迁出~~
11e. ~~overview/运营草稿/出站兼容收口；community.js 收成兼容壳；overview 读经 repo~~
11f. ~~server 迁出 doctors/patients/triage/messages 后台路由~~
11g. ~~qiwe_bridge 拆入 modules/qiwe（shared / media / cards / delivery / callback）；根 qiwe_bridge.js 为兼容壳~~
11h. ~~server 迁出 patient-public（bootstrap/短信/投稿/邀请/候补/口碑）+ auth-admin（登录/账号/审计）~~
11i. ~~server 迁出 content-admin（rules/FAQ/提交/统计/知识/效果）+ channel-bridges（企微/QiWe 回调与凭证）~~
11j. ~~server 迁出 wecom-sidebar / ops-desk；doctor-notifications 并入 messages-admin~~
12. （可选）轻量 triage 门面、db.js 降级为连接/schema/seed、患者/医生真模块 repo 闭环

## 部署

本地验证通过后再同步云服务器；勿在半成品状态上传。
