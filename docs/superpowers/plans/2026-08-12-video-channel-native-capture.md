# 视频号原生卡片真机采样 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为视频号素材增加真机采样，并让王云程 114 通过 `/msg/sendFeedVideo` 发送微信原生视频号卡片。

**Architecture:** 复用现有小程序真机采样模式，但将采样结果直接写入 `outbound_assets.payload`，只新增一张短时采样会话表。回调识别 `msgType=141` 后绑定当前素材；解析与投递层使用独立 `feed_video` 类型，禁止降级为普通链接。

**Tech Stack:** Node.js、SQLite、Vue 3、Element Plus、现有 QiWe REST 适配层。

---

### Task 1: 视频号模板与采样状态

**Files:**
- Create: `app/modules/outbound/feed-video.js`
- Modify: `app/modules/outbound/schema.js`
- Test: `app/_feed_video_test.js`

- [ ] **Step 1: 写失败测试**

覆盖 `normalizeFeedVideo`、必填字段检查、创建/过期/取消采样会话，以及 `msgType=141` 只绑定当前医生和素材。

- [ ] **Step 2: 运行测试确认失败**

Run: `node app/_feed_video_test.js`
Expected: 因 `feed-video.js` 尚不存在或导出缺失而失败。

- [ ] **Step 3: 写最小实现**

新增 `qiwe_feed_video_captures(asset_id, doctor_id, started_at, expires_at, started_by)`；模块只导出模板标准化、就绪检查、准备/查询/取消/消费采样函数。消费成功时合并更新素材 payload，并保存完整 `rawPayload`。

- [ ] **Step 4: 运行测试确认通过**

Run: `node app/_feed_video_test.js`
Expected: 全部断言通过。

### Task 2: 管理接口与素材编辑页

**Files:**
- Modify: `app/routes/outbound-admin.js`
- Modify: `admin-ui/src/api/chunyu/index.ts`
- Modify: `admin-ui/src/views/chunyu/ops/outbound/components/AssetEditorDrawer.vue`

- [ ] **Step 1: 添加采样接口**

增加准备、状态、取消三个端点；所有端点校验登录权限、`doctorId`、素材归属和素材类型必须为 `video`。

- [ ] **Step 2: 添加前端 API 与最小界面**

视频号编辑区增加“开始真机采样”“刷新状态”“取消采样”，展示就绪时间和缺失字段。未保存的新素材先保存后才能采样。

- [ ] **Step 3: 构建验证**

Run: `npm run build`（目录 `admin-ui`）
Expected: Vue/TypeScript 构建成功。

### Task 3: 回调采集原生视频号消息

**Files:**
- Modify: `app/qiwe.js`
- Modify: `app/modules/qiwe/callback.js`
- Test: `app/_feed_video_test.js`

- [ ] **Step 1: 写失败测试**

构造 `cmd=15000,msgType=141` 的托管账号自发报文，断言当前采样素材被绑定；非本人、无采样会话及过期会话不得绑定。

- [ ] **Step 2: 运行测试确认失败**

Run: `node app/_feed_video_test.js`
Expected: `isFeedVideo` 或采样处理断言失败。

- [ ] **Step 3: 写最小实现**

`normalizeEvent` 增加 `isFeedVideo`；回调在普通非文本分流前消费待采样会话。只接受当前托管账号自发的 `msgType=141`，完整保存 `msgData/raw`，随后返回采样完成状态，不触发自动回复。

- [ ] **Step 4: 运行测试确认通过**

Run: `node app/_feed_video_test.js`
Expected: 全部断言通过。

### Task 4: 原生视频号投递

**Files:**
- Modify: `app/qiwe.js`
- Modify: `app/modules/outbound/resolve.js`
- Modify: `app/modules/qiwe/delivery.js`
- Test: `app/_feed_video_test.js`

- [ ] **Step 1: 写失败测试**

断言已就绪视频素材解析为 `feed_video`，投递调用 `/msg/sendFeedVideo`；未就绪时不生成 `linkCards`，并返回明确缺失字段。

- [ ] **Step 2: 运行测试确认失败**

Run: `node app/_feed_video_test.js`
Expected: 仍解析为 `link` 或没有原生发送调用。

- [ ] **Step 3: 写最小实现**

新增 `qiwe.sendFeedVideo(toId, template, cfg)`，严格校验供应商要求字段；`resolve.js` 输出 `feed_video`；`prepareDelivery` 收集 `feedVideos`；自动投递与 outbox 投递均顺序调用原生接口。禁止视频素材进入普通链接卡片循环。

- [ ] **Step 4: 全量相关验证**

Run: `node app/_feed_video_test.js && node app/_outbound_test.js && npm run build`
Expected: 后端断言及前端构建全部通过，101 小程序回归通过。

### Task 5: 云端部署与真机闭环

**Files:**
- Deploy: `app/` 相关修改文件
- Deploy: `app/public/admin-v2/`

- [ ] **Step 1: 备份并上传必要文件**

部署前在服务器生成带时间戳备份，只上传本次修改与管理端构建产物。

- [ ] **Step 2: 重启并验证健康状态**

Run: `pm2 restart chunyu-doctor && curl http://127.0.0.1:<port>/health`
Expected: 进程 online，健康接口返回成功。

- [ ] **Step 3: 真机采样**

在王云程 114 素材点击开始采样，然后使用王云程托管企业微信向已接入群发送目标原生视频号卡片。刷新状态应显示模板就绪；若缺少 `feedId/feedNo`，记录真实报文字段后按供应商实际结构补齐映射。

- [ ] **Step 4: 真机发送验证**

在王云程测试群发送 114。Expected: QiWe `isSendSuccess=1`，群内显示原生视频号大卡片；发送 101 仍显示原有小程序卡片。
