# 自定义贴片封面与文案 Implementation Plan

> **For agentic workers:** Implement task-by-task. Steps use checkbox syntax.

**Goal:** 企微配置页支持上传自定义封面（同组同步）与按编号编辑标题/描述。

**Architecture:** `weapp_cover_ops` 扩展 applyCustomCover / updateCardCopy；QiWe CDN 上传写入封面三件套；admin 企微页弹窗操作。

**Tech Stack:** Node SQLite, QiWe cdnBigUpload, Vue3 Element Plus

---

### Task 1: Backend ops + CDN helper
- Modify: `qiwe.js`, `modules/qiwe/weapp_cover_ops.js`, `routes/channel-bridges.js`
- Test: `_weapp_cover_ops_test.js`

### Task 2: Admin UI
- Modify: `admin-ui/.../qiwe/index.vue`, `api/chunyu/index.ts`
- Build admin-v2 + deploy
