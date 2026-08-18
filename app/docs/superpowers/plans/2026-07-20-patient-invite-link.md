# 患者建档邀请链接 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 医助可复制问卷建档短链；患者无短信填 11 项后落入该医生档案；已验证同号并档、新号未验证新建；签发 `psid` 供同会话后续消息归档。

**Architecture:** 新表 `patient_invite_links` + `patient_sessions`；管理端复用/轮换 token；公开 `GET/POST /api/invite/:token`（与短信版 `/api/submit` 联络表分流）；H5 `/i/:token` 问卷页无验证码；Cookie `psid` 绑定咨询。企微加强靠 `external_userid`，**不**靠企微取号。

**Tech Stack:** Node.js（`server.js`/`db.js`）、SQLite、H5 `patient.js`、`admin-ui` Vue3、`_unittest.js`

**Spec:** `app/docs/superpowers/specs/2026-07-20-patient-invite-link-design.md`（已通过；策略 B + 企微边界）

**一期写死：**

1. 默认复用 active token；`rotate=true` 作废再建；默认 `expires_at=NULL`
2. 邀请提交 **不调用** `verifySms`；手机仅格式校验
3. 并档仅当同医生 `phone` + `phone_verified=1`；否则新建且 `phoneVerified:false`
4. 成功页不跳咨询；`/?p=contact-form` 短信路径不动
5. P0：表 + API + H5 + 档案页复制按钮；第二入口（医生/运营页）可同 PR 或紧随
6. 企微 `external_userid` 落地加强可 P1；**禁止**把企微备注手机当 `phoneVerified`

---

## File Map

| Path | Responsibility |
|------|----------------|
| `app/patient_invite.js` | token 生成、链接解析、问卷提交合并逻辑、session 签发 |
| `app/db.js` | 建表 `patient_invite_links` / `patient_sessions` |
| `app/server.js` | admin invite-link、GET/POST invite、静态 `/i/:token`、消息读 psid |
| `app/public/src/patient.js` | 问卷页路由与无验证码提交 |
| `app/_unittest.js` | U-INVITE 单测 |
| `admin-ui/src/api/chunyu/index.ts` | invite-link API |
| `admin-ui/src/views/chunyu/archive/index.vue` | 「复制建档链接」 |
| `admin-ui/src/views/chunyu/ops/index.vue` 或 `doctors/index.vue` | 第二入口 |

---

### Task 1: `patient_invite.js` 纯函数 + 单测骨架

**Files:**
- Create: `app/patient_invite.js`
- Modify: `app/_unittest.js`

- [ ] **Step 1: 写失败单测**

```js
console.log("\n== U-INVITE. 邀请令牌 / 问卷并档策略 B ==");
try {
  const inv = require("./patient_invite.js");
  ok(/^[A-Za-z0-9_-]{10,24}$/.test(inv.generateInviteToken()), "token 形态");
  ok(inv.isInvitePhone("13800138000") === true, "合法手机");
  ok(inv.isInvitePhone("123") === false, "非法手机");
  // mergeDecision 纯函数：verifiedExist → merge；else → create
  ok(inv.mergeDecision({ verifiedPatientId: 9 }) === "merge:9", "已验证同号 → merge");
  ok(inv.mergeDecision({ verifiedPatientId: null }) === "create", "无已验证 → create");
} catch (e) {
  ok(false, "patient_invite 加载失败: " + (e && e.message));
}
```

- [ ] **Step 2: 跑测确认失败**

Run: `cd app; node _unittest.js 2>&1 | Select-String "U-INVITE|patient_invite"`  
Expected: 加载失败或断言失败

- [ ] **Step 3: 实现 `app/patient_invite.js`**

导出至少：

- `generateInviteToken()` → `crypto.randomBytes(9).toString("base64url")`（约 12 字符）
- `isInvitePhone(s)` → `/^1[3-9]\d{9}$/`
- `mergeDecision({ verifiedPatientId })` → `"merge:{id}"` | `"create"`
- `createInviteStore(db)` →
  - `ensureLink(doctorId, { note, expiresInDays, maxUses, rotate, createdBy })`
  - `getActiveLink(doctorId)` / `getByToken(token)`（校验 active、expires、max_uses）
  - `bumpUse(token)`
  - `createSession({ doctorId, patientId, ttlDays=90 })` → token
  - `getSession(psid)` / `touchSession(psid)`
- `resolveInvitePatient(db, resolvePatient, { doctorId, phone, name, externalUserId? })`：
  1. 若 `externalUserId` → 先 `resolvePatient({ channel:"qiwe", externalId, phone, phoneVerified:false, displayName })`（身份优先）
  2. 否则查 `SELECT id FROM patients WHERE doctor_id=? AND phone=? AND phone_verified=1`
  3. 有 → 返回该 id（不改 phone_verified）
  4. 无 → `resolvePatient({ channel:"invite", externalId:"invite:"+token+":"+phoneHashOrRandom, phone, phoneVerified:false, displayName })`

- [ ] **Step 4: 单测通过**

Run: 同上  
Expected: U-INVITE 通过

- [ ] **Step 5: Commit（仅主人要求时）**

---

### Task 2: DB 迁移

**Files:**
- Modify: `app/db.js`（与现有 `CREATE TABLE IF NOT EXISTS` / `ensureColumn` 风格一致）

- [ ] **Step 1: 建表**

```sql
CREATE TABLE IF NOT EXISTS patient_invite_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doctor_id INTEGER NOT NULL,
  token TEXT NOT NULL UNIQUE,
  note TEXT,
  max_uses INTEGER,
  use_count INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT,
  created_by TEXT,
  created_at TEXT,
  last_used_at TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  require_sms INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY(doctor_id) REFERENCES doctors(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_invite_doctor ON patient_invite_links(doctor_id, active);

CREATE TABLE IF NOT EXISTS patient_sessions (
  token TEXT PRIMARY KEY,
  doctor_id INTEGER NOT NULL,
  patient_id INTEGER NOT NULL,
  created_at TEXT,
  expires_at TEXT,
  last_seen_at TEXT
);
```

- [ ] **Step 2: 单测或启动后 `PRAGMA table_info` 确认表存在**

- [ ] **Step 3: Commit（仅主人要求时）**

---

### Task 3: 管理端 invite-link API

**Files:**
- Modify: `app/server.js`
- Modify: `app/_unittest.js`（可用临时 http 或直接调 store）

- [ ] **Step 1: 路由**

- `GET /api/admin/doctors/:id/invite-link` → 无则 ensure；返回 `{ ok, url, token, expiresAt, useCount }`
- `POST /api/admin/doctors/:id/invite-link` body `{ note?, expiresInDays?, maxUses?, rotate? }`
- `url` = `{publicOrigin}/i/{token}`（复用现有 host/origin 拼法）
- 权限：与 `patients` 列表同级或已有 doctor 读权限（选现有 `authz` action，勿新开过宽键）

- [ ] **Step 2: 单测 ensure 复用 / rotate 作废旧链**

- [ ] **Step 3: Commit（仅主人要求时）**

---

### Task 4: 公开邀请 API + 问卷提交

**Files:**
- Modify: `app/server.js`
- Reuse: `patient_profile.js` extract/validate/upsert；凭证上传仍用 `/api/patient/voucher-upload`

- [ ] **Step 1: `GET /api/invite/:token`**

返回：`{ ok, doctorId, doctorName, requireSms:false, fields }`（`fields` = `defaultContactProfileFields`，**不含**后台扩展字段）  
失效 → `410`

- [ ] **Step 2: `POST /api/invite/:token/submit`**

校验顺序：token 有效 → body.doctorId 与 link.doctor_id 一致 → consent → `isInvitePhone` → `validateContactProfile` → **禁止** `verifySms`。

落库：

1. `resolveInvitePatient(...)`（策略 B）
2. 更新 `patients` 姓名/性别/生日；`profileStore.upsertFields(..., "patient")`；门诊凭证同联络表逻辑
3. `INSERT submissions` type=`联络表`，payload 标明来源 `"建档来源":"邀请问卷"`，**不要**写 `"手机号验证":"已验证"`（除非并入的已是 verified 档且保持原状）；可写 `"手机号验证":"未验证(邀请)"` 若新建
4. `bumpUse`；`createSession`；`Set-Cookie: psid=...; HttpOnly; SameSite=Lax; Path=/; Max-Age=...`
5. 响应 `{ ok, patientSessionSet:true }` — **无** consult 跳转字段

- [ ] **Step 3: 单测**

- 新号 → `phone_verified=0` 新档
- 已有 verified 同号 → 同一 `patient_id`
- 两个未验证同号邀请 → **两个** patient（或不合并到既有未验证）
- 错误 token → 410；doctorId 篡改 → 400

- [ ] **Step 4: Commit（仅主人要求时）**

---

### Task 5: Cookie 会话绑定消息

**Files:**
- Modify: `app/server.js`（患者发消息 / 咨询相关路由）

- [ ] **Step 1: 辅助** `patientFromRequest(req)`：读 `cookies(req).psid` → `getSession`（未过期）→ `{ doctorId, patientId }`

- [ ] **Step 2: 在现有患者消息入口（如 `/api/message` 或等价）优先用 session 的 `patient_id`；`doctorId` 不一致则忽略 cookie（防跨医生）

- [ ] **Step 3: 单测：有 psid 的消息挂对 patient；过期/错医生不挂

- [ ] **Step 4: Commit（仅主人要求时）**

---

### Task 6: H5 `/i/:token` 问卷页

**Files:**
- Modify: `app/server.js`（静态路由：`/i/:token` → 患者壳页，注入 query 或 bootstrap）
- Modify: `app/public/src/patient.js`

- [ ] **Step 1: 服务端** `GET /^\/i\/([A-Za-z0-9_-]+)$/` 返回与患者 H5 同一 index，或 302 到 `/?p=invite&t=TOKEN`（二选一，计划推荐 `/?p=invite&t=` 少动静态资源部署）

- [ ] **Step 2: `patient.js`**

- 新 page `invite`：拉 `GET /api/invite/:token`；渲染 11 项；**无**验证码 UI；consent；凭证先 upload 再 submit
- `POST /api/invite/:token/submit`（credentials: `include` 以收 Cookie）
- 成功态：成功文案；**禁止** `openConsult` / 切咨询 tab

- [ ] **Step 3: 手工或脚本冒烟：打开 `/i/xxx` 无「获取验证码」

- [ ] **Step 4: Commit（仅主人要求时）**

---

### Task 7: admin-ui 两处入口

**Files:**
- Modify: `admin-ui/src/api/chunyu/index.ts` — `fetchInviteLink` / `rotateInviteLink`
- Modify: `admin-ui/src/views/chunyu/archive/index.vue` — toolbar「复制建档链接」
- Modify: `admin-ui/src/views/chunyu/ops/index.vue` 或 `doctors/index.vue` — 同按钮（当前医生上下文）

- [ ] **Step 1: API + 复制** `navigator.clipboard.writeText(url)` + ElMessage

- [ ] **Step 2: 可选：下拉「重新生成」调 `rotate:true`

- [ ] **Step 3: 构建 admin-v2 并确认按钮可见（按现网构建流程）

- [ ] **Step 4: Commit（仅主人要求时）**

---

### Task 8: 验收与部署

- [ ] **Step 1:** `cd app; node _unittest.js` 全绿（含 U-INVITE）
- [ ] **Step 2:** 测服部署 `python app/_deploy_test_server.py`（或现网惯用命令）
- [ ] **Step 3:** 手工：复制链接 → 填问卷（无验证码）→ 档案列表可见 → 同浏览器再提问挂同一人
- [ ] **Step 4:** 回归：旧 `/?p=contact-form` 仍要短信

---

## 企微说明（实现红线）

- **不要**实现「从 QiWe/企微 API 自动取用户手机号并 `phoneVerified:true`」。
- P1 可做：落地页若能拿到 `external_userid`，提交时传入 `resolveInvitePatient` 做身份挂靠。
- `remark_mobiles` 若将来可读：最多预填，且 `phoneVerified:false`。

---

## 执行方式

主人确认计划后，用 **subagent-driven-development** 或 **executing-plans** 按 Task 1→8 推进；每 Task 测过后勾选。
