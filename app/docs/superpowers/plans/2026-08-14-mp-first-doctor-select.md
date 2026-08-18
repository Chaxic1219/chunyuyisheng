# 小程序首次选医生 Implementation Plan

> **For agentic workers:** 按任务逐步实现；每步先写/改测试再改代码。

**Goal:** 绑手机后按规则决定是否进入入驻医生选择页；已绑定/有来源不打断。

**Architecture:** 后端 `bindPhone` 优先认已有 patients；无来源时允许无 doctor 会话。前端 `ensureLogin` + 绑号成功走统一闸门；新页选医生后 `silentLogin`。

**Tech Stack:** Node `mp_auth.js` / `mp-auth.js`；uni-app `patient-uniapp`

---

### Task 1: 后端 bindPhone 归属 + settled-doctors

**Files:** `app/mp_auth.js`, `app/routes/mp-auth.js`, `app/_mp_auth_test.js`

- [ ] bindPhone：先查已有 patients；无则仅在显式 doctorId 时挂接；否则 phoneBound 且 doctor 可空
- [ ] me/summarizeSession：支持 phoneBound 无 doctor，返回 `needsDoctorSelection`
- [ ] GET `/api/mp/settled-doctors`
- [ ] 测试覆盖三路判定

### Task 2: 前端闸门 + 选医生页

**Files:** `patient-uniapp/src/utils/ensureLogin.ts`, `doctorAffiliation.ts`, `pages/auth/select-doctor.vue`, `pages/auth/bind.vue`, `pages.json`, `api/*`

- [ ] 绑手机不传 bootstrap 默认 doctorId（仅来源）
- [ ] 闸门：已绑医生 / 来源 / 否则进选医生页
- [ ] 选中后 silentLogin + 回 returnUrl

### Task 3: 验证

- [ ] `_mp_auth_test.js` 通过
- [ ] 语法检查；必要时部署后端
