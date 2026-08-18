# 小程序状态一致性修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复邀请建档回跳、缓存串号、咨询历史串用、首页待跟进错误态伪装为空这 4 类高优先级一致性问题。

**Architecture:** 保持现有页面结构不变，只统一状态边界。登录门禁继续复用 `ensureLogin`，但调用方传完整带参 URL；本地缓存与 AI 会话改为按当前身份命名空间分桶；首页待跟进摘要改为三态结果，避免吞错。

**Tech Stack:** uni-app Vue3、Pinia、现有 `auth/app` stores、本地 `uni` storage、Node test、`build:mp-weixin`

---

### Task 1: 修邀请建档回跳参数

**Files:**
- Modify: `c:\Users\11\Desktop\www\chunyu-doctor-review\patient-uniapp\src\pages\invite\form.vue`
- Modify: `c:\Users\11\Desktop\www\chunyu-doctor-review\patient-uniapp\src\pages\auth\bind.vue`
- Modify: `c:\Users\11\Desktop\www\chunyu-doctor-review\patient-uniapp\src\utils\ensureLogin.ts`
- Test: `c:\Users\11\Desktop\www\chunyu-doctor-review\patient-uniapp\tests\ui-contract.test.mjs`

- [ ] 写/更新断言：邀请建档页回跳应保留 token query
- [ ] 让 `invite/form` 调 `ensureLogin()` 时传完整带参路径
- [ ] 核对 `bind` 页 `goAfterBind()` 保持原 query 回跳

### Task 2: 给本地缓存加命名空间

**Files:**
- Modify: `c:\Users\11\Desktop\www\chunyu-doctor-review\patient-uniapp\src\stores\auth.ts`
- Modify: `c:\Users\11\Desktop\www\chunyu-doctor-review\patient-uniapp\src\api\patient.ts`
- Modify: `c:\Users\11\Desktop\www\chunyu-doctor-review\patient-uniapp\src\pages\mine\index.vue`

- [ ] 提取当前身份 key（优先 patientId/personId，再退化到 token/doctorId）
- [ ] 把头像缓存和本地档案缓存改成按身份 key 存取
- [ ] 在 `auth.clear()` 时清空当前账号相关缓存

### Task 3: 隔离 AI 历史与 session

**Files:**
- Modify: `c:\Users\11\Desktop\www\chunyu-doctor-review\patient-uniapp\src\utils\mpAiSession.ts`
- Modify: `c:\Users\11\Desktop\www\chunyu-doctor-review\patient-uniapp\src\pages\consult\index.vue`

- [ ] 给历史与 `sessionId` 增加命名空间 key
- [ ] 页面恢复历史前校验 identity key
- [ ] 身份变化时自动 rotate session 并清空当前桶

### Task 4: 首页待跟进改三态

**Files:**
- Modify: `c:\Users\11\Desktop\www\chunyu-doctor-review\patient-uniapp\src\api\patient.ts`
- Modify: `c:\Users\11\Desktop\www\chunyu-doctor-review\patient-uniapp\src\pages\index\index.vue`
- Test: `c:\Users\11\Desktop\www\chunyu-doctor-review\patient-uniapp\tests\ui-contract.test.mjs`

- [ ] 将 `getFollowupSummary()` 返回结构扩成 `success / empty / error`
- [ ] 首页区分待跟进加载失败与确实无待办
- [ ] 保持原有 CTA 与待办展示逻辑不回退

### Task 5: 验证与构建

**Files:**
- Test: `c:\Users\11\Desktop\www\chunyu-doctor-review\patient-uniapp\tests\ui-contract.test.mjs`

- [ ] 跑 `node --test tests/ui-contract.test.mjs`
- [ ] 跑 `pnpm run build:mp-weixin`
- [ ] 确认导入目录仍为 `dist/build/mp-weixin`
