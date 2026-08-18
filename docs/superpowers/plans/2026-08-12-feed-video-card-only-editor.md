# 视频号仅卡片发送与采样编辑器 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让视频号编号只发送原生卡片，并将编辑页收敛为带封面预览的真机采样面板。

**Architecture:** 在纯文本转换边界排除 `feed_video`，一次修复同步投递和草稿投递。采样状态接口直接复用已持久化参数，前端只负责展示与触发采样。

**Tech Stack:** Node.js、SQLite、Vue 3、Element Plus

---

### Task 1: 视频号不生成文字

**Files:**
- Modify: `app/_feed_video_delivery_test.js`
- Modify: `app/patient_reply.js`

- [ ] 在投递测试中断言视频号计划 `replyText === ''`，先运行并确认失败。
- [ ] 在 `responseToPlainText` 中让 `feed_video` 返回空字符串。
- [ ] 运行 `node app/_feed_video_delivery_test.js`，确认通过。

### Task 2: 采样状态提供预览数据

**Files:**
- Modify: `app/_feed_video_test.js`
- Modify: `app/modules/outbound/feed-video.js`
- Modify: `admin-ui/src/api/chunyu/index.ts`

- [ ] 断言就绪状态返回 `coverUrl` 与 `channelName`，先运行并确认失败。
- [ ] 在 `captureStatus` 返回最小预览字段。
- [ ] 同步前端状态类型并运行测试。

### Task 3: 精简视频号编辑器

**Files:**
- Modify: `admin-ui/src/views/chunyu/ops/outbound/components/AssetEditorDrawer.vue`

- [ ] 视频类型隐藏通用标题、链接和封面 URL 输入。
- [ ] 移除视频链接必填校验，新建时自动生成内部标题。
- [ ] 将采样面板改为封面预览、状态信息和采样按钮布局。
- [ ] 运行 `npm run build`。

### Task 4: 回归与部署

**Files:**
- Verify: `app/_feed_video_test.js`
- Verify: `app/_feed_video_delivery_test.js`
- Verify: `app/_outbound_test.js`

- [ ] 运行三项回归测试与前端生产构建。
- [ ] 备份云端相关文件并上传构建产物。
- [ ] 重启 PM2，验证后台页面、进程和王云程 114 投递计划。

