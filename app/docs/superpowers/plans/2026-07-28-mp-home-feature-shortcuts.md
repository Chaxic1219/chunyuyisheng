# 小程序首页功能补齐实现计划

> **For agentic workers:** 按任务逐步执行；每步完成后勾选。

**Goal:** 首页待办卡下增加「服务申请」「我的资料」两组通用入口。

**Architecture:** 复用 `FnGroup` + `ensureLogin`，与「我的」页路由/门禁对齐；不改后端。

**Tech Stack:** uni-app Vue3、现有 `FnGroup`、`ui-contract` 测试、`build:mp-weixin`

---

### Task 1: 更新契约测试

**Files:** `patient-uniapp/tests/ui-contract.test.mjs`

- [x] 断言首页含加号/住院/档案/健康记录/回复/FAQ，且仍无 DoctorCard/医生姓名拼接
- [x] 先跑测试确认失败（或至少覆盖新断言）

### Task 2: 改首页入口

**Files:** `patient-uniapp/src/pages/index/index.vue`

- [x] 拆成 `serviceItems` / `assetItems`（或等价两组）
- [x] 模板两个 `FnGroup`
- [x] `open` + `gatedKeys` 对齐「我的」页（faq 免登录）

### Task 3: 验证与构建

- [x] 跑 `node --test tests/ui-contract.test.mjs`
- [x] `pnpm run build:mp-weixin`
- [x] 告知导入路径 `dist/build/mp-weixin`
