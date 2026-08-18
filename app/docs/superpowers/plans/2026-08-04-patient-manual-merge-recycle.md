# 患者手动合并与回收站 Implementation Plan

> **For agentic workers:** Use executing-plans or implement task-by-task. Steps use checkbox syntax.

**Goal:** admin-ui 支持任意 2 档字段决议合并（含预览）、软删除与 24h 回收站撤销。

**Architecture:** 新模块 `patient_archive.js` + 表 `patient_archive_ops`；手动合并走软归档；自动 `mergePatients` 仍物理删源。前端在 `archive/index.vue` 增加向导与回收站。

**Tech Stack:** Node sqlite、Express 风格 route 注册、Vue3 + Element Plus admin-ui

---

### Task 1: Schema + patient_archive 核心

**Files:**
- Create: `app/patient_archive.js`
- Modify: `app/db.js`（建表、archived_at、export）
- Test: `app/_patient_archive_ops_test.js`

- [ ] 建表 `patient_archive_ops`，`patients.archived_at`
- [ ] `resolveFields` / `buildMergePreview` / `softMergePatients` / `softDeletePatient` / `undoArchiveOp` / `listRecycleBin` / `expireArchiveOps`
- [ ] 单测覆盖预览、软并、撤销、软删、过期拒绝

### Task 2: API + 权限

**Files:**
- Modify: `app/routes/patients-admin.js`
- Modify: `app/authz.js`
- Modify: GET patients SQL 过滤 `archived_at`

- [ ] merge-preview / merge(扩展) / archive / recycle-bin / undo
- [ ] `patients.archive` 权限

### Task 3: admin-ui

**Files:**
- Modify: `admin-ui/src/api/chunyu/index.ts`
- Modify: `admin-ui/src/views/chunyu/archive/index.vue`
- Optional: `MergeWizard.vue` / `RecycleBinDrawer.vue`

- [ ] API 封装
- [ ] 勾选 2 人合并、字段向导、删除、回收站
- [ ] 疑似/同号入口进同一向导

### Task 4: 部署验证

- [ ] 本地跑 `_patient_archive_ops_test.js`
- [ ] 部署后端到生产（若主人需要）
