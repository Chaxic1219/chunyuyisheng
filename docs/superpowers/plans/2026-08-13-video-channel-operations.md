# 视频号账号管理与群转发 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在运营中心交付医生视频号绑定、全量视频库、新视频逐条审核、立即转发和单次定时转发闭环。

**Architecture:** 新增聚焦的 `video-channel` 后端模块，官方数据访问经单一 provider 接口注入；账号、视频和定时任务使用三张 SQLite 表。视频发送不另造链路，每个目标群写入现有 `outbound_queue`，payload 复用已有 `feed_video` 投递格式。

**Tech Stack:** Node.js、`node:sqlite`、现有零依赖 HTTP 路由、Vue 3、TypeScript、Element Plus、现有企微出站模块。

---

当前目录没有 `.git`，因此各任务以测试检查点代替无法执行的 commit 步骤。不得为了满足计划创建新的 Git 仓库。

## 文件结构与职责

- Create: `app/modules/video-channel/schema.js` — 三张表和幂等迁移。
- Create: `app/modules/video-channel/provider.js` — 官方 provider 契约、输入输出规范化和显式不可用错误。
- Create: `app/modules/video-channel/repo.js` — 账号、视频、定时任务的唯一 SQL 读写入口。
- Create: `app/modules/video-channel/service.js` — 绑定、同步、审核、群范围、批次幂等和调度。
- Create: `app/modules/video-channel/index.js` — 模块公共入口。
- Create: `app/routes/video-channel-admin.js` — 管理 API 与权限边界。
- Create: `app/_video_channel_test.js` — 临时 SQLite 最小回归测试。
- Create: `app/_video_channel_ui_test.js` — 前端路由、页面和关键安全文案静态检查。
- Modify: `app/server.js` — 注册路由与每分钟调度器。
- Modify: `app/package.json` — 将定向回归测试加入 `test:unit` 尾部。
- Modify: `admin-ui/src/api/chunyu/index.ts` — 视频号类型与 API。
- Modify: `admin-ui/src/router/modules/chunyu.ts` — 新增运营中心菜单。
- Create: `admin-ui/src/views/chunyu/ops/video-channels/index.vue` — 账号管理、所有视频、待审核、任务队列四页签运营界面；三个业务页分别实现已确认原型。
- Modify: `app/_run_deploy_science_ai_wizard.py` — 改为通用运营中心部署清单前，先重命名为 `app/_run_deploy_ops_center.py`；上传本功能文件并沿用备份、哈希和 PM2 检查。

### Task 1: 数据表与失败测试

**Files:**
- Create: `app/_video_channel_test.js`
- Create: `app/modules/video-channel/schema.js`
- Modify: `app/package.json`

- [ ] **Step 1: 写临时数据库失败测试**

测试设置独立 `DB_PATH`，加载 `db.js` 后调用 `ensureSchema(db)`，断言三张表、唯一索引和必要字段：

```js
const accountCols = columns("video_channel_accounts");
for (const name of ["doctor_id", "platform_account_id", "group_scope", "group_ids", "sync_cursor", "initial_sync_completed_at", "last_sync_error"])
  assert.ok(accountCols.includes(name), `missing account column ${name}`);
const videoCols = columns("video_channel_videos");
for (const name of ["platform_video_id", "feed_video_payload", "discovery_kind", "review_status", "review_note"])
  assert.ok(videoCols.includes(name), `missing video column ${name}`);
const scheduleCols = columns("video_channel_schedules");
for (const name of ["execute_at", "group_scope_snapshot", "group_ids_snapshot", "status", "fire_key", "last_error"])
  assert.ok(scheduleCols.includes(name), `missing schedule column ${name}`);
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node app/_video_channel_test.js`

Expected: FAIL，首个错误为找不到 `modules/video-channel/schema.js` 或缺少 `video_channel_accounts`。

- [ ] **Step 3: 实现三张表**

在 `schema.js` 中只创建规格所需字段和索引：

```js
db.exec(`
  CREATE TABLE IF NOT EXISTS video_channel_accounts(
    id INTEGER PRIMARY KEY AUTOINCREMENT, doctor_id INTEGER NOT NULL,
    platform_account_id TEXT NOT NULL, account_name TEXT NOT NULL DEFAULT '', avatar_url TEXT NOT NULL DEFAULT '',
    bind_method TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1,
    group_scope TEXT NOT NULL DEFAULT 'all', group_ids TEXT NOT NULL DEFAULT '[]',
    sync_cursor TEXT NOT NULL DEFAULT '', initial_sync_completed_at TEXT,
    last_synced_at TEXT, last_sync_error TEXT, created_by TEXT, updated_by TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS uq_video_channel_current_doctor
    ON video_channel_accounts(doctor_id) WHERE enabled=1;
  CREATE TABLE IF NOT EXISTS video_channel_videos(
    id INTEGER PRIMARY KEY AUTOINCREMENT, account_id INTEGER NOT NULL, doctor_id INTEGER NOT NULL,
    platform_video_id TEXT NOT NULL, title TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '',
    cover_url TEXT NOT NULL DEFAULT '', published_at TEXT NOT NULL,
    feed_video_payload TEXT NOT NULL DEFAULT '{}', discovery_kind TEXT NOT NULL,
    review_status TEXT NOT NULL, reviewed_by TEXT, reviewed_at TEXT, review_note TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    UNIQUE(account_id, platform_video_id)
  );
  CREATE TABLE IF NOT EXISTS video_channel_schedules(
    id INTEGER PRIMARY KEY AUTOINCREMENT, video_id INTEGER NOT NULL, doctor_id INTEGER NOT NULL,
    execute_at TEXT NOT NULL, group_scope_snapshot TEXT NOT NULL,
    group_ids_snapshot TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'pending',
    fire_key TEXT NOT NULL UNIQUE, last_attempt_at TEXT, last_error TEXT,
    created_by TEXT, executed_by TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_video_channel_review ON video_channel_videos(doctor_id, review_status, published_at);
  CREATE INDEX IF NOT EXISTS idx_video_channel_schedule_due ON video_channel_schedules(status, execute_at);
`);
```

- [ ] **Step 4: 把测试加入单测尾部**

将 `test:unit` 末尾追加 `&& node _video_channel_test.js`，不调整已有测试顺序。

- [ ] **Step 5: 运行定向测试**

Run: `node app/_video_channel_test.js`

Expected: PASS 并输出 `video channel schema ok`。

### Task 2: Provider 契约与同步幂等

**Files:**
- Create: `app/modules/video-channel/provider.js`
- Create: `app/modules/video-channel/repo.js`
- Create: `app/modules/video-channel/service.js`
- Create: `app/modules/video-channel/index.js`
- Modify: `app/_video_channel_test.js`

- [ ] **Step 1: 用内存 fake provider 写失败测试**

fake provider 固定返回一个账号和两页历史视频，再返回一个新增视频：

```js
const fake = {
  async bind(input) { return { accountId: "wx-a", name: "王医生视频号", avatarUrl: "a.jpg", cursor: "c0" }; },
  async listVideos(_, cursor) {
    if (cursor === "c0") return { items: [feed("v2"), feed("v1")], nextCursor: "c1", hasMore: false };
    return { items: [feed("v3")], nextCursor: "c2", hasMore: false };
  }
};
```

断言首次同步得到两个 `not_required`，第二次同步只新增 `v3/pending`，第三次重复同步视频总数仍为 3。

- [ ] **Step 2: 运行测试确认失败**

Run: `node app/_video_channel_test.js`

Expected: FAIL，错误为 `createService is not a function`。

- [ ] **Step 3: 定义 provider 的两个必要方法**

`provider.js` 仅导出规范化和显式错误，不引入多供应商注册器：

```js
function unavailable() {
  const error = new Error("微信视频号官方接口尚未配置");
  error.code = "VIDEO_CHANNEL_PROVIDER_UNAVAILABLE";
  throw error;
}
module.exports = {
  official: { bind: unavailable, listVideos: unavailable },
  normalizeAccount(raw) { /* 返回 accountId/name/avatarUrl/cursor */ },
  normalizeVideo(raw) { /* 返回 videoId/title/description/coverUrl/publishedAt/feedVideo */ }
};
```

`normalizeVideo` 必须调用现有 `modules/outbound/feed-video.js` 的 `normalizeFeedVideo()` 与 `missingFeedVideoFields()`；缺字段时返回 `complete:false`。

- [ ] **Step 4: 实现最小 repo 与同步服务**

`createService({ provider })` 暴露：

```js
bindAccount(input, username)
syncAccount(accountId, options)
listAccounts(doctorId)
listVideos(doctorId, filters)
```

首次绑定在一个事务中分页写历史、标记 `initial/not_required`，完成后才写 `initial_sync_completed_at` 和新游标。增量同步写 `incremental/pending`；卡片字段缺失则写 `incomplete`。使用 `INSERT ... ON CONFLICT(account_id,platform_video_id) DO NOTHING`。

- [ ] **Step 5: 验证同步测试通过**

Run: `node app/_video_channel_test.js`

Expected: PASS；历史 2 条无需审核，新增 1 条待审核，重复同步总数不变。

### Task 3: 官方接口接入门槛与账号策略

**Files:**
- Modify: `app/modules/video-channel/provider.js`
- Modify: `app/modules/video-channel/service.js`
- Modify: `app/_video_channel_test.js`

- [ ] **Step 1: 收集官方接入材料并做只读调用验证**

必须取得四项材料：微信官方接口文档、应用身份、可绑定测试账号、账号与作品读取权限。使用文档规定的测试调用验证能返回唯一账号 ID 和至少一页作品。不得用页面抓取代替。

Expected: 保存脱敏后的请求字段名、响应字段名和错误码映射到本计划同目录的执行记录；凭据只进入生产环境变量，不写进仓库。

- [ ] **Step 2: 用录制的脱敏响应补 provider 测试**

测试断言官方账号响应可规范化为：

```js
{ accountId: "唯一账号标识", name: "账号名", avatarUrl: "头像 URL", cursor: "下一页游标" }
```

视频响应必须规范化成现有发送所需的 `channelName/channelUrl/coverUrl/encodeData/headImgUrl/feedId/feedNo/username` 八个字段。

- [ ] **Step 3: 实现官方 HTTP 调用**

使用 Node 原生 `fetch`，不新增依赖。超时使用 `AbortSignal.timeout(10000)`；非 2xx、微信业务错误码或字段缺失均抛出带 `code` 的错误。只在本步骤拿到真实官方路径和字段后替换 `official.bind/listVideos` 的 fail-closed 实现。

- [ ] **Step 4: 增加账号和群策略校验**

`bindAccount` 只在 `bind()` 和第一页 `listVideos()` 均成功后保存。`groupScope` 只允许 `all/selected`；`selected` 必须至少一个群，且所有群满足：

```sql
SELECT id FROM community_groups WHERE doctor_id=? AND enabled=1 AND id IN (...)
```

换绑先将旧账号 `enabled=0`，再保存新账号；历史数据不删除。

- [ ] **Step 5: 运行 provider 与归属测试**

Run: `node app/_video_channel_test.js`

Expected: PASS；跨医生群、停用群、无法读取账号视频均拒绝绑定。

### Task 4: 审核、立即转发与单次定时

**Files:**
- Modify: `app/modules/video-channel/service.js`
- Modify: `app/_video_channel_test.js`

- [ ] **Step 1: 写三条失败测试**

覆盖：审核同意使用默认群；立即转发可覆盖目标群；定时任务保存群快照且重复 tick 不重复创建队列。

```js
assert.equal(service.approveVideo(videoId, "ops").queued, 2);
assert.equal(countOutbox("video_channel_review"), 2);
assert.equal(service.approveVideo(videoId, "ops").queued, 0);
const schedule = service.createSchedule({ videoId, executeAt: future, groupScope:"selected", groupIds:[groupId] }, "ops");
await service.runDueSchedules(new Date(future));
await service.runDueSchedules(new Date(future));
assert.equal(countOutbox("video_channel_schedule"), 1);
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node app/_video_channel_test.js`

Expected: FAIL，首个缺少函数为 `approveVideo`。

- [ ] **Step 3: 实现统一批次入队函数**

只实现一个共享入口：

```js
enqueueVideoBatch({ video, groups, source, batchKey, username })
```

每群先调用 `modules/outbox/index.js.insert()`，再对该行调用现有异步 `setOutboxStatus(id, "sent", username)` 执行真实投递；发送失败时沿用 outbox 服务的回滚逻辑保留为 `pending`。payload 固定包含：

```js
{
  responses: [{ type: "feed_video", title: video.title || "视频号", feedVideo }],
  videoChannel: { videoId: video.id, accountId: video.accountId, batchKey },
  reviewerRequired: false
}
```

在插入前按 `payload LIKE` 检查同一 `batchKey` 已有记录；已有成功行直接跳过，已有 pending 失败行只重试投递，不再次插入。批次键格式固定为 `video-review:<videoId>`、`video-manual:<uuid>`、`video-schedule:<scheduleId>`。人工批次 UUID 使用 `crypto.randomUUID()`。函数返回逐群 `sent/failed/skipped` 结果，满足“同意后立即发送”而不是只创建待审草稿。

- [ ] **Step 4: 实现审核、拒绝、立即转发和调度**

暴露：

```js
approveVideo(videoId, username)
rejectVideo(videoId, reason, username)
forwardNow(input, username)
createSchedule(input, username)
cancelSchedule(scheduleId, username)
runDueSchedules(nowDate)
```

审核状态更新与待发送行创建放在同一 `BEGIN IMMEDIATE` 事务，提交后逐行异步投递，不能把网络调用放进 SQLite 事务。定时任务用条件更新抢占：`UPDATE ... SET status='running' WHERE id=? AND status IN ('pending','failed')`；所有群成功或已成功时改 `completed`，仍有失败群则改 `failed` 并记录 500 字以内错误。

- [ ] **Step 5: 运行回归测试**

Run: `node app/_video_channel_test.js`

Expected: PASS；三条发送入口 payload 一致，重复审批与重复 tick 均不重复入队。

### Task 5: 管理 API、权限与服务调度

**Files:**
- Create: `app/routes/video-channel-admin.js`
- Modify: `app/server.js`
- Modify: `app/_video_channel_test.js`

- [ ] **Step 1: 写路由与权限静态失败检查**

断言路由文件包含账号、同步、视频列表、审核、立即转发、定时任务 CRUD 路径，以及复用权限 `dashboard.doctor.read`、`ops.strategy.manage` 和 `community.outbox.send`。

- [ ] **Step 2: 实现最小管理接口**

注册以下接口：

```text
GET    /api/admin/video-channels?doctorId=
POST   /api/admin/video-channels/bind
PUT    /api/admin/video-channels/:id
POST   /api/admin/video-channels/:id/sync
DELETE /api/admin/video-channels/:id
GET    /api/admin/video-channel-videos?doctorId=&reviewStatus=&page=&pageSize=
POST   /api/admin/video-channel-videos/:id/approve
POST   /api/admin/video-channel-videos/:id/reject
POST   /api/admin/video-channel-videos/:id/forward
GET    /api/admin/video-channel-schedules?doctorId=
POST   /api/admin/video-channel-schedules
POST   /api/admin/video-channel-schedules/:id/cancel
POST   /api/admin/video-channel-schedules/:id/retry
```

每个写接口先用资源行解析 `doctor_id`，再 `gate()` 和 `requireAdminAction()`；approve/forward/retry 同时要求 `community.outbox.send`。

- [ ] **Step 3: 注册路由和两个定时器**

`server.js` 引入并注册路由。`require.main` 守卫内增加：每 10 分钟调用 `syncEnabledAccounts()`；每分钟调用 `runDueSchedules(new Date())`。两个 tick 都使用 `void tick().catch(...)`，只记录错误，不中断主服务。

- [ ] **Step 4: 运行语法和定向测试**

Run:

```powershell
node app/_video_channel_test.js
node --check app/modules/video-channel/service.js
node --check app/routes/video-channel-admin.js
node --check app/server.js
```

Expected: 全部退出码 0。

### Task 6: 前端类型、路由与运营页面

**Files:**
- Modify: `admin-ui/src/api/chunyu/index.ts`
- Modify: `admin-ui/src/router/modules/chunyu.ts`
- Create: `admin-ui/src/views/chunyu/ops/video-channels/index.vue`
- Create: `app/_video_channel_ui_test.js`

- [ ] **Step 1: 写前端静态失败测试**

断言菜单路径 `/ops/video-channels`、组件 `OpsVideoChannels`、四页签值 `accounts/videos/review/tasks`、按钮文案“同意并发送”“立即转发”“定时转发”“重试失败群”和权限码均存在。

- [ ] **Step 2: 运行测试确认失败**

Run: `node app/_video_channel_ui_test.js`

Expected: FAIL，错误为缺少 `/ops/video-channels`。

- [ ] **Step 3: 增加明确类型和 API**

在 `index.ts` 定义 `VideoChannelAccount`、`VideoChannelVideo`、`VideoChannelSchedule`、分页响应类型，并为 Task 5 的每个接口增加一个 typed 函数。禁止使用新的全局状态库。

- [ ] **Step 4: 新增运营中心菜单**

在“科普提醒”相邻位置增加：

```ts
{
  path: 'video-channels',
  name: 'OpsVideoChannels',
  component: '/chunyu/ops/video-channels/index',
  meta: { title: '视频号运营', icon: 'ri:video-line', keepAlive: true }
}
```

- [ ] **Step 5: 实现单页四页签**

复用当前医生 store、capabilities、`PageShell`、Element Plus 表格/卡片/对话框：

- 账号：绑定、同步、策略、暂停/换绑/解绑。
- 所有视频：筛选、分页、预览、立即和定时转发。
- 待审核：目标群数量、同意二次确认、拒绝原因。
- 任务队列：聚合待审核、待执行、发送失败；支持审核、取消、失败群重试和查看状态。

页面视觉必须分别对应三张已确认原型：

- `review`：审核工作台主从布局。
- `videos`：视频内容库封面网格与详情侧栏。
- `tasks`：运营任务队列主从布局及近期计划/失败列表。

所有按钮用计算权限禁用，并在 `title` 展示拒绝原因。时间输入使用现有 `ElDatePicker type="datetime"`，提交 ISO 时间；显示使用北京时间。

- [ ] **Step 6: 运行静态检查和完整构建**

Run:

```powershell
node app/_video_channel_ui_test.js
Set-Location admin-ui
npm.cmd run build
```

Expected: 静态检查输出 `video channel ui ok`；`vue-tsc --noEmit` 和 Vite 构建退出码 0。

### Task 7: 端到端验收与部署

**Files:**
- Rename/Modify: `app/_run_deploy_science_ai_wizard.py` → `app/_run_deploy_ops_center.py`
- Verify: `app/public/admin-v2/`

- [ ] **Step 1: 更新精确部署清单**

上传 Task 1–6 新增/修改的后端文件、测试文件和完整 `admin-v2` 构建产物。部署前备份目标后端文件、`admin-v2` 和 `/var/lib/chunyu-doctor/data.db*`；新文件不存在时跳过备份，不能令部署失败。

- [ ] **Step 2: 运行发布门槛**

Run:

```powershell
node app/_video_channel_test.js
node app/_video_channel_ui_test.js
node --check app/modules/video-channel/service.js
node --check app/routes/video-channel-admin.js
node --check app/server.js
Set-Location admin-ui
npm.cmd run build
```

Expected: 全部退出码 0。

- [ ] **Step 3: 在接口桩环境做闭环测试**

使用 fake provider：绑定账号 → 首次同步历史不进审核 → 增量出现一条待审核 → 同意后每个目标群一条 pending 出站 → 创建到期定时任务 → 重复 tick 无重复。禁止对真实患者群执行测试发送。

- [ ] **Step 4: 部署并只重启目标服务**

上传完成后只执行：

```bash
pm2 restart chunyu-doctor --update-env
```

- [ ] **Step 5: SSH 只读验收**

核对本地/云端文件 SHA-256、PM2 `online`、三张表字段、历史群/知识/出站计数未减少、启动日志出现视频号同步与定时器状态且无新异常。确认没有因为部署自动生成或发送任何视频。

- [ ] **Step 6: 官方测试账号验收**

在取得官方权限后绑定测试医生账号，确认历史视频只进入所有视频；发布或准备一条官方测试新视频后，确认它只进入待审核。审批测试必须选择专用测试群，验证卡片后再开放真实医生绑定。

## 最终验收清单

- 绑定成功必然代表账号可识别且视频可读取。
- 历史视频与新增视频均可在“所有视频”分页查看。
- 首次历史不进审核，新增视频逐条进审核。
- 审批、立即、定时三条路径均能选全部群或指定群。
- 新视频没有绕过人工同意的自动发送路径。
- 所有目标群归属在服务端校验。
- 重复同步、重复审批和重复调度均不会重复群发。
- 官方接口失败保留旧数据与游标。
- 现有视频号卡片投递和出站审计继续生效。
