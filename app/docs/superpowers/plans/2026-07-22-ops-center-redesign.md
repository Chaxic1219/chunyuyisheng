# 运营中心大改 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or executing-plans.

**Goal:** 将运营中心重组为「群与话术 / 编号中心 / 知识运营 / 医生运营 / 平台策略」五模块，旧路由兼容跳转。

**Architecture:** 复用 `config/index.vue` 与 `ops/index.vue`，通过 `route.meta` 限定配置域与页面模式；新增 `ops/codes/index.vue` 合并总览与编号配置 Tab；无后端变更。

**Tech Stack:** Vue 3, Element Plus, admin-ui router

---

### Task 1: 路由与兼容跳转

**Files:**
- Modify: `admin-ui/src/router/modules/chunyu.ts`
- Modify: `admin-ui/src/utils/chunyuTabVisibility.ts`

- [ ] 新增 5 子路由 + redirect `/ops` → `/ops/scripts`
- [ ] 旧路径 `strategy/config/group-codes` redirect
- [ ] 更新 TAB 映射 `OpsScripts`/`OpsKnowledge` 等

### Task 2: ConfigCenter 多模式

**Files:**
- Modify: `admin-ui/src/views/chunyu/config/index.vue`

- [ ] `route.meta.opsDomains` 过滤可见域
- [ ] `route.meta.opsHideSwitcher` 隐藏域切换条
- [ ] `route.meta.opsDefaultDomain` 默认域
- [ ] PageShell title/subtitle 随 meta 变化

### Task 3: 知识运营页瘦身

**Files:**
- Modify: `admin-ui/src/views/chunyu/ops/index.vue`

- [ ] `OpsKnowledge` 路由下隐藏策略六宫格、效果回收、策略编辑
- [ ] 更新链接指向新路径
- [ ] 简化顶部提示文案

### Task 4: 编号中心合并页

**Files:**
- Create: `admin-ui/src/views/chunyu/ops/codes/index.vue`
- Modify: `admin-ui/src/views/chunyu/group-codes/index.vue`（链接更新，可选保留为 redirect）

- [ ] Tab「状态总览」嵌入原 group-codes 表格
- [ ] Tab「编号配置」嵌入 config codes_cards（meta 模式）

### Task 5: 全站文案与链接

**Files:**
- Modify: `rules/index.vue`, `dash/doctor.vue`, `community/index.vue`, 等

- [ ] 「运营配置」→ 具体子模块名
- [ ] `goConfig()` 指向 `/ops/scripts` 或 `/ops/codes`

### Task 6: 验证

- [ ] `cd admin-ui && npm run build`
- [ ] 手动检查 redirect 与 Tab 可见性
