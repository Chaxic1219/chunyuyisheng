# QiWe 分诊台医生归属收口 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 AI 分诊台只显示当前 QiWe 账号作用域内的消息：已加入且可见的企微群消息，以及当前 QiWe 账号对应医生的企微私聊消息。

**Architecture:** 在 QiWe 入站归档链路中收紧医生解析，避免私聊和未命中群回退到任意 active 医生；同时在分诊台查询层对 QiWe 群/私聊增加当前账号医生与 `qiwe_hidden=0` 的双约束。优先复用现有 `_qiwetest.js` 回调路径测试，避免扩大改动面。

**Tech Stack:** Node.js, SQLite, 现有手写测试脚本 `_qiwetest.js`

---

### Task 1: 先写失败测试锁定分诊可见性

**Files:**
- Modify: `c:/Users/11/Desktop/www/chunyu-doctor-review/app/_qiwetest.js`
- Test: `c:/Users/11/Desktop/www/chunyu-doctor-review/app/_qiwetest.js`

- [ ] **Step 1: 写失败测试**

```js
// 目标：
// 1) 当前 QiWe 医生=1 时，只能看到 doctor_id=1 的私聊
// 2) 只显示 qiwe_hidden=0 的企微群消息
// 3) hidden 群和 doctor_id=2 的 QiWe 消息都不能进入分诊列表
```

- [ ] **Step 2: 运行测试，确认先失败**

Run: `node _qiwetest.js`  
Expected: 新增断言失败，证明当前分诊/归档口径过宽。

- [ ] **Step 3: 记录失败原因**

```text
失败应体现为：
- 私聊会被错误归到 fallback 医生
- 或分诊查询未按 qiwe_hidden/currentQiweDoctorId 收紧
```

### Task 2: 收紧 QiWe 当前账号医生解析

**Files:**
- Modify: `c:/Users/11/Desktop/www/chunyu-doctor-review/app/modules/qiwe/shared.js`
- Modify: `c:/Users/11/Desktop/www/chunyu-doctor-review/app/modules/qiwe/callback.js`
- Test: `c:/Users/11/Desktop/www/chunyu-doctor-review/app/_qiwetest.js`

- [ ] **Step 1: 为当前 QiWe 配置增加 fail-closed 医生解析**

```js
// shared.js
function currentQiweDoctorId(cfg){
  const did = Number(cfg && cfg.doctorId);
  return Number.isInteger(did) && did > 0 && db.prepare("SELECT 1 FROM doctors WHERE id=?").get(did) ? did : null;
}
```

- [ ] **Step 2: 群/私聊分开用医生解析**

```js
// 群消息：优先业务群主诊；未命中再回到 currentQiweDoctorId(cfg)
// 私聊消息：只取 currentQiweDoctorId(cfg)，不再掉到 activeDoctorId(cfg)
```

- [ ] **Step 3: 运行测试**

Run: `node _qiwetest.js`  
Expected: 仍可能有分诊查询断言失败，但新增医生归属断言转绿。

### Task 3: 收紧分诊台 QiWe 查询作用域

**Files:**
- Modify: `c:/Users/11/Desktop/www/chunyu-doctor-review/app/routes/messages-admin.js`
- Test: `c:/Users/11/Desktop/www/chunyu-doctor-review/app/_qiwetest.js`

- [ ] **Step 1: 提炼当前 QiWe 医生过滤片段**

```js
// messages-admin.js
// current qiwe doctor = qiwe.loadConfig().doctorId
// 群消息：必须命中 data_source='qiwe' 且 qiwe_hidden=0 的 community_groups
// 私聊消息：doctor_id 必须等于 currentQiweDoctorId
```

- [ ] **Step 2: 只对 QiWe 消息追加过滤，不影响非 QiWe**

```js
// WHERE doctor_id=? + existing triage filter + extra qiwe scope filter
```

- [ ] **Step 3: 运行测试确认通过**

Run: `node _qiwetest.js`  
Expected: 新增断言通过，旧用例不回归。

### Task 4: 最终验证

**Files:**
- Test: `c:/Users/11/Desktop/www/chunyu-doctor-review/app/_qiwetest.js`

- [ ] **Step 1: 跑完整回归**

Run: `node _qiwetest.js`  
Expected: PASS

- [ ] **Step 2: 检查改动文件诊断**

Run: IDE lints on touched files  
Expected: 无新增 lint 错误

- [ ] **Step 3: 如通过，再部署线上验证**

```text
部署后确认：
1) 当前 QiWe 账号分诊台只见当前医生 QiWe 私聊
2) hidden 旧群不出现在分诊台
3) 可见群消息仍正常进入分诊台
4) 医生本体数据不变
```
