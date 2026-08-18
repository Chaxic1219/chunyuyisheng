# 科普提醒 Implementation Plan

> **For agentic workers:** 按任务顺序实现；一期不自动发群。

**Goal:** 运营中心新增「科普提醒」页：计划 + 草稿管理 + 快捷生成；社群工作台去掉旧按钮。

**Architecture:** SQLite 计划表 + `modules/community/science_reminders.js` 负责 CRUD/到点生成；复用 `createWeeklyCampaign` / `createOpsContentCandidate` 与出站 API；admin-ui 新页挂 `/ops/science-reminders`。

**Tech Stack:** Node SQLite、现有 community/outbox、Vue3 Element Plus admin-ui

---

### Task 1: Schema + 模块 + API + tick

- Create: `app/modules/community/science_reminders.js`
- Modify: `app/db.js`（建表）、`app/routes/community-admin.js` 或新 route、`app/server.js`（tick）、`app/community.js` 导出
- Self-check: 无 ready 时 ops 模式报错；幂等不重复入队

### Task 2: 前端页 + 路由 + API 封装

- Create: `admin-ui/src/views/chunyu/ops/science-reminders/index.vue`
- Modify: `admin-ui/src/router/modules/chunyu.ts`、`admin-ui/src/api/chunyu/index.ts`

### Task 3: 社群工作台去按钮

- Modify: `admin-ui/src/views/chunyu/community/index.vue`（及旧 `admin.js` 若仍暴露）

### Task 4: 部署验证

- build admin-v2、上传、pm2 restart
- 打开 `/ops/science-reminders` 能建计划、快捷生成
