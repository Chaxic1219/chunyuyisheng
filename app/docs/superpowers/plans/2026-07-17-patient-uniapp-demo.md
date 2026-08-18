# 患者端 UniApp Demo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (主人要求直接开发，本会话内联执行). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在仓库内落地 `packages/patient-design` + `patient-uniapp`，微信开发者工具可打开并点通 MVP（mock）。

**Architecture:** 共享令牌/图标/类型包；UniApp Vue3 小程序默认 mock API；视觉对齐现网 `app.css`。不改后端、不部署。

**Tech Stack:** UniApp Vue3 + Vite + TypeScript；微信小程序；本地 mock JSON。

**Spec:** `app/docs/superpowers/specs/2026-07-17-patient-uniapp-demo-design.md`

---

## File Map

| Path | Responsibility |
|------|----------------|
| `packages/patient-design/tokens.css` | CSS 变量（对齐 app.css） |
| `packages/patient-design/tokens.json` | 同色板 JSON |
| `packages/patient-design/icons/*.svg` | 线性图标 |
| `packages/patient-design/types/index.ts` | bootstrap 等类型 |
| `packages/patient-design/package.json` | 包名 `@chunyu/patient-design` |
| `patient-uniapp/` | UniApp 工程 |
| `patient-uniapp/src/api/` | mock + request 开关 |
| `patient-uniapp/src/stores/app.ts` | bootstrap / elder / patientKey |
| `patient-uniapp/src/pages/**` | 首页/咨询/我的/表单/文章 |
| `patient-uniapp/src/components/**` | DoctorCard / CoreEntry / FnList 等 |

---

### Task 1: 共享设计包 patient-design

**Files:**
- Create: `packages/patient-design/package.json`
- Create: `packages/patient-design/tokens.css`
- Create: `packages/patient-design/tokens.json`
- Create: `packages/patient-design/types/index.ts`
- Create: `packages/patient-design/icons/` (chat, plus, bed, home, user, form, help, send, back, az, clock, heart)

- [ ] **Step 1:** 从 `app/public/app.css` `:root` 抽出 tokens 写入 css/json
- [ ] **Step 2:** 写入 TypeScript 类型与 package.json
- [ ] **Step 3:** 写入核心 SVG 图标（stroke currentColor）

---

### Task 2: 脚手架 patient-uniapp

**Files:**
- Create: `patient-uniapp/` via `pnpm create uni` or degit `dcloudio/uni-preset-vue#vite-ts`

- [ ] **Step 1:** 在 `chunyu-doctor-review` 下创建 Vue3+TS UniApp 工程名为 `patient-uniapp`
- [ ] **Step 2:** 配置依赖 `@chunyu/patient-design`（file:../packages/patient-design）
- [ ] **Step 3:** `pages.json` 配置 tabBar 与子页；引入 tokens 到 `App.vue`
- [ ] **Step 4:** `pnpm install` 并确认 `pnpm run dev:mp-weixin` 可启动

---

### Task 3: API mock + store

**Files:**
- Create: `patient-uniapp/src/api/config.ts` (`USE_MOCK = true`)
- Create: `patient-uniapp/src/api/mock/bootstrap.ts`
- Create: `patient-uniapp/src/api/patient.ts`
- Create: `patient-uniapp/src/stores/app.ts`

- [ ] **Step 1:** mock bootstrap（一位医生 + 加号/住院/联络表/FAQ/文章）
- [ ] **Step 2:** `getBootstrap` / `sendMessage` / `submitForm` / `getReplies` mock
- [ ] **Step 3:** Pinia store：加载 bootstrap、elderMode、patientKey

---

### Task 4: 首页 + 组件

**Files:**
- Create: `patient-uniapp/src/components/DoctorCard.vue`
- Create: `patient-uniapp/src/components/CoreEntries.vue`
- Create: `patient-uniapp/src/components/FnGroup.vue`
- Modify: `patient-uniapp/src/pages/index/index.vue`

- [ ] **Step 1:** 实现 DoctorCard / CoreEntries / FnGroup，样式用 tokens
- [ ] **Step 2:** 首页组装 + 长辈模式切换（html 类等价：页面根 class `elder`）
- [ ] **Step 3:** 点击入口跳转咨询 tab 或表单/文章页

---

### Task 5: 咨询页

**Files:**
- Modify: `patient-uniapp/src/pages/consult/index.vue`

- [ ] **Step 1:** 消息列表 + 输入框 + 发送（mock 回复分诊卡）
- [ ] **Step 2:** `uni.chooseImage` 最多 3 张，预览缩略图

---

### Task 6: 我的 + 表单 + 文章

**Files:**
- Modify: `patient-uniapp/src/pages/mine/index.vue`
- Create: `patient-uniapp/src/pages/form/add.vue`（加号）
- Create: `patient-uniapp/src/pages/form/admission.vue`（住院）
- Create: `patient-uniapp/src/pages/form/contact.vue`（联络表）
- Create: `patient-uniapp/src/pages/article/detail.vue`
- Create: `patient-uniapp/src/pages/replies/index.vue`
- Create: `patient-uniapp/src/pages/faq/index.vue`

- [ ] **Step 1:** 我的入口列表
- [ ] **Step 2:** 三表单本地校验 + mock 提交 toast
- [ ] **Step 3:** FAQ 手风琴 + 文章详情 mock

---

### Task 7: 验证

- [ ] **Step 1:** `pnpm run build:mp-weixin`（或 dev）成功
- [ ] **Step 2:** 确认 `dist/dev/mp-weixin` 或 `dist/build/mp-weixin` 产出
- [ ] **Step 3:** 在 README 写明用微信开发者工具打开的路径与 mock 说明

---

## Execution note

主人要求直接开发：跳过执行方式询问，本会话按 Task 1→7 内联执行。不自动 git commit（除非主人要求）。
