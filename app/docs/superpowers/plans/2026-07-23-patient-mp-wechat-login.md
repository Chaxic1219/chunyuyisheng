# 患者端小程序微信登录 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按 `2026-07-23-patient-mp-wechat-login-design.md`，在档案相关入口完成微信登录 + 绑手机（一键优先 / 短信回退），按已验证手机号解析全平台 `person` 并挂接当前医生 `patient`；无档软推完善；咨询可匿名。

**Architecture:** 新增 `mp_sessions`（openid 级临时/正式会话）与 `persons.mp_openid`；`app/mp_auth.js` 封装 code2session / 手机号 / 匹配合并；`routes` 暴露 `/api/mp/*`；小程序 `stores/auth` + `ensureLogin` 门禁档案入口；开发态 `MP_AUTH_STUB=1` 或 `PHONE_BIND_MODE=sms` 可无真实微信密钥跑通。

**Tech Stack:** Node（零依赖 `app/`）+ SQLite；UniApp Vue3 + Pinia；`node` 脚本测试（`app/_mp_auth_test.js`）+ `patient-uniapp` `pnpm run test:ui`。

**Spec:** `app/docs/superpowers/specs/2026-07-23-patient-mp-wechat-login-design.md`

**Commit 说明：** 若 `chunyu-doctor-review` 无 git 根目录，各 Task 的 Commit 步骤一律跳过。

---

## File Map

| Path | Responsibility |
|------|----------------|
| `app/db.js` | `persons.mp_openid` 列；新建 `mp_sessions` 表与索引 |
| `app/person.js` | `findOrCreateByVerifiedPhone`；绑定/查 `mp_openid` |
| `app/mp_auth.js` | **新建** code2session、getPhoneNumber、会话 CRUD、挂接 patient、`hasProfile` |
| `app/wechat_mp.js` | **新建** 调微信 HTTP（可 stub） |
| `app/routes/mp-auth.js` | **新建** `/api/mp/login|bind-phone|me|logout` |
| `app/server.js` | 注册路由；读 `WECHAT_MP_*` / `MP_AUTH_STUB` |
| `app/_mp_auth_test.js` | **新建** 匹配合并与 hasProfile 单测（stub 微信） |
| `app/load_env.js` / `.env.local` 示例 | 文档化环境变量（密钥不入库） |
| `patient-uniapp/src/api/config.ts` | `PHONE_BIND_MODE` |
| `patient-uniapp/src/api/auth.ts` | **新建** login / bindPhone / me / 带 Bearer 的 request |
| `patient-uniapp/src/stores/auth.ts` | **新建** token、me、ensureLogin |
| `patient-uniapp/src/utils/ensureLogin.ts` | **新建** 门禁助手 |
| `patient-uniapp/src/pages/auth/bind.vue` | **新建** 绑手机 UI |
| `patient-uniapp/src/pages.json` | 注册 `pages/auth/bind` |
| `patient-uniapp/src/pages/index|mine|*.vue` | 档案入口改走 `ensureLogin`；`hasProfile` 推荐条 |
| `patient-uniapp/src/pages/consult/index.vue` | 已登录时 message 带正式 patient 标识 |
| `patient-uniapp/src/api/patient.ts` | request 可选附带 Bearer；登录后同步本地 profile 摘要 |
| `patient-uniapp/tests/ui-contract.test.mjs` | auth 页与门禁契约 |
| Spec 状态行 | 改为「实施计划已出」 |

**不改（一期）：** admin-ui、匿名历史消息回溯、换绑手机、跨医生病历拷贝。

---

### Task 1: 库表与 person 按手机号解析

**Files:**
- Modify: `app/db.js`（persons 列 + mp_sessions）
- Modify: `app/person.js`
- Create: `app/_mp_auth_test.js`（先写失败断言）

- [ ] **Step 1: 在 `_mp_auth_test.js` 写失败测试骨架**

```js
"use strict";
const assert = require("assert");
const path = require("path");
const fs = require("fs");
const os = require("os");

process.env.MP_AUTH_STUB = "1";
process.env.DB_PATH = path.join(os.tmpdir(), `mp-auth-${Date.now()}.db`);
if (fs.existsSync(process.env.DB_PATH)) fs.unlinkSync(process.env.DB_PATH);

const db = require("./db.js");
const personApi = require("./person.js");

function test(name, fn) {
  try { fn(); console.log("ok -", name); }
  catch (e) { console.error("fail -", name); throw e; }
}

test("findOrCreateByVerifiedPhone 同号复用同一 person", () => {
  const a = personApi.findOrCreateByVerifiedPhone({ phone: "13800138000", realName: "甲" });
  const b = personApi.findOrCreateByVerifiedPhone({ phone: "13800138000", realName: "乙" });
  assert.equal(a.id, b.id);
  assert.equal(a.phone_verified, 1);
});

test("bindMpOpenid 写入 persons.mp_openid", () => {
  const p = personApi.findOrCreateByVerifiedPhone({ phone: "13800138001" });
  personApi.bindMpOpenid(p.id, "oid-test-1");
  const row = db.prepare("SELECT mp_openid FROM persons WHERE id=?").get(p.id);
  assert.equal(row.mp_openid, "oid-test-1");
});

console.log("all mp person tests passed");
```

- [ ] **Step 2: 跑测确认失败**

Run:

```bash
cd app
node _mp_auth_test.js
```

Expected: FAIL（`findOrCreateByVerifiedPhone` / `mp_openid` 不存在）

- [ ] **Step 3: `db.js` 增加列与表（放在 persons 定义附近，幂等）**

```js
ensureColumn("persons", "mp_openid", "TEXT");
db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_persons_mp_openid
  ON persons(mp_openid) WHERE mp_openid IS NOT NULL AND trim(mp_openid) != ''`);

db.exec(`CREATE TABLE IF NOT EXISTS mp_sessions (
  token TEXT PRIMARY KEY,
  openid TEXT NOT NULL,
  doctor_id INTEGER,
  person_id INTEGER,
  patient_id INTEGER,
  phone_bound INTEGER NOT NULL DEFAULT 0,
  created_at TEXT,
  expires_at TEXT,
  last_seen_at TEXT
)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_mp_sessions_openid ON mp_sessions(openid)`);
```

- [ ] **Step 4: 在 `person.js` 实现查找/创建与绑 openid**

```js
function findOrCreateByVerifiedPhone({ phone, realName }) {
  const p = String(phone || "").trim();
  if (!/^1\d{10}$/.test(p)) throw new Error("invalid_phone");
  const existing = db.prepare(
    "SELECT * FROM persons WHERE phone=? AND phone_verified=1 ORDER BY id ASC LIMIT 1"
  ).get(p);
  if (existing) {
    if (realName && !existing.real_name) {
      db.prepare("UPDATE persons SET real_name=COALESCE(NULLIF(real_name,''), ?), updated_at=? WHERE id=?")
        .run(String(realName).trim(), nowIso(), existing.id);
      return db.prepare("SELECT * FROM persons WHERE id=?").get(existing.id);
    }
    return existing;
  }
  // 若有未验证同号 person，升级为已验证（避免双 person）
  const unverified = db.prepare(
    "SELECT * FROM persons WHERE phone=? ORDER BY id ASC LIMIT 1"
  ).get(p);
  if (unverified) {
    db.prepare("UPDATE persons SET phone_verified=1, real_name=COALESCE(NULLIF(real_name,''), ?), updated_at=? WHERE id=?")
      .run(realName ? String(realName).trim() : null, nowIso(), unverified.id);
    return db.prepare("SELECT * FROM persons WHERE id=?").get(unverified.id);
  }
  return createPerson({ phone: p, phone_verified: 1, real_name: realName || null });
}

function bindMpOpenid(personId, openid) {
  const oid = String(openid || "").trim();
  if (!oid) throw new Error("invalid_openid");
  const clash = db.prepare("SELECT id FROM persons WHERE mp_openid=? AND id!=?").get(oid, +personId);
  if (clash) throw new Error("openid_bound_other");
  db.prepare("UPDATE persons SET mp_openid=?, updated_at=? WHERE id=?")
    .run(oid, nowIso(), +personId);
}

function findByMpOpenid(openid) {
  return db.prepare("SELECT * FROM persons WHERE mp_openid=?").get(String(openid || "").trim()) || null;
}
```

导出上述三个函数。

- [ ] **Step 5: 再跑测通过**

```bash
cd app
node _mp_auth_test.js
```

Expected: `all mp person tests passed`

- [ ] **Step 6: Commit（有 git 时）**

```bash
git add app/db.js app/person.js app/_mp_auth_test.js
git commit -m "feat(mp): persons mp_openid and findOrCreateByVerifiedPhone"
```

---

### Task 2: `wechat_mp` stub + `mp_auth` 会话与挂接 patient

**Files:**
- Create: `app/wechat_mp.js`
- Create: `app/mp_auth.js`
- Modify: `app/_mp_auth_test.js`

- [ ] **Step 1: 扩展测试 —— 绑手机后同医生复用 patient、跨医生新 patient 同 person**

在 `_mp_auth_test.js` 追加（需先有医生与 `resolvePatient`；沿用项目内创建医生的最小写法，或 `db.prepare("INSERT INTO doctors...")` 测用插入）：

```js
const mpAuth = require("./mp_auth.js");

test("bindPhone 同医生已验证同号 merge 到同一 patient", () => {
  // 准备 doctorId=测试医生、已有 verified patient 同号
  // login stub → bindPhone sms → assert patientId 相同、person 相同
});

test("bindPhone 跨医生复用 person、新建 patient", () => {
  // doctor A bind → doctor B bind 同号 → personId 同、patientId 异
});

test("hasProfile 需姓名+已验证手机", () => {
  // 仅手机 → false；写入 real_name → true
});
```

（实现时把注释换成完整可跑代码，插入医生用现有 `seed` 或临时 SQL。）

- [ ] **Step 2: 实现 `wechat_mp.js`**

```js
"use strict";
const https = require("https");

function stubMode() {
  return process.env.MP_AUTH_STUB === "1" || !process.env.WECHAT_MP_APP_ID;
}

async function code2Session(jsCode) {
  if (stubMode()) {
    const code = String(jsCode || "stub");
    return { openid: `stub-openid-${code.slice(0, 16)}`, session_key: "stub" };
  }
  const appid = process.env.WECHAT_MP_APP_ID;
  const secret = process.env.WECHAT_MP_APP_SECRET;
  const url = `https://api.weixin.qq.com/sns/jscode2session?appid=${encodeURIComponent(appid)}&secret=${encodeURIComponent(secret)}&js_code=${encodeURIComponent(jsCode)}&grant_type=authorization_code`;
  const data = await getJson(url);
  if (!data.openid) throw new Error(data.errmsg || "code2session_failed");
  return { openid: data.openid, session_key: data.session_key, unionid: data.unionid };
}

async function getPhoneNumberByCode(phoneCode) {
  if (stubMode()) {
    return { phone: "13900001111" }; // 测可用 env MP_STUB_PHONE 覆盖
  }
  const token = await getAccessToken();
  // POST https://api.weixin.qq.com/wxa/business/getuserphonenumber?access_token=...
  // body: { code: phoneCode } → phone_info.purePhoneNumber
}

module.exports = { code2Session, getPhoneNumberByCode, stubMode };
```

`getJson` / `getAccessToken` 用 `https` 实现；access_token 可进程内缓存至 `expires_in`。

- [ ] **Step 3: 实现 `mp_auth.js` 核心 API**

```js
async function login({ code, doctorId }) {
  const { openid } = await wechatMp.code2Session(code);
  const person = personApi.findByMpOpenid(openid);
  const token = createMpSession({
    openid,
    doctorId: doctorId ? +doctorId : null,
    personId: person ? person.id : null,
    patientId: null,
    phoneBound: !!(person && person.phone_verified && person.phone),
  });
  // 若已绑手机且带 doctorId：resolveOrAttachPatient 并回写 session
  return summarizeSession(token);
}

async function bindPhone({ token, phoneCode, phone, smsCode, doctorId }) {
  const sess = requireSession(token);
  let mobile;
  if (phoneCode) mobile = (await wechatMp.getPhoneNumberByCode(phoneCode)).phone;
  else {
    // 复用现有 SMS 校验函数（从 server/patient-public 抽出或 require 同模块）
    assertSmsOk(phone, smsCode);
    mobile = String(phone).trim();
  }
  const person = personApi.findOrCreateByVerifiedPhone({ phone: mobile });
  personApi.bindMpOpenid(person.id, sess.openid);
  const did = +(doctorId || sess.doctor_id);
  if (!did) throw new Error("doctor_required");
  const patientId = attachPatientForDoctor({ doctorId: did, person, phone: mobile });
  updateMpSession(token, { personId: person.id, patientId, doctorId: did, phoneBound: true });
  return { ...summarizeSession(token), hasProfile: computeHasProfile(did, patientId, person) };
}

function me(token) { return summarizeSession(token); /* 含 hasProfile、phoneMasked */ }

function logout(token) { db.prepare("DELETE FROM mp_sessions WHERE token=?").run(token); }
```

`attachPatientForDoctor` 逻辑（对齐 spec）：

1. `patients` 上 `doctor_id + person_id` 已有 → 用它，并确保 `phone_verified=1`  
2. 否则 `doctor_id + phone + phone_verified=1` → 挂 `person_id`  
3. 否则未验证同号 → 更新为已验证并挂 `person_id`（自动 merge，不二次确认）  
4. 否则 `resolvePatient` / insert 新 patient，写 phone、person_id、phone_verified=1  

`computeHasProfile`：`person.real_name`（或 patient.real_name/display_name）非空 **且** 已验证手机号。

- [ ] **Step 4: 跑通 `_mp_auth_test.js`**

```bash
cd app
set MP_AUTH_STUB=1
node _mp_auth_test.js
```

Expected: 全部 ok

- [ ] **Step 5: Commit**

```bash
git add app/wechat_mp.js app/mp_auth.js app/_mp_auth_test.js
git commit -m "feat(mp): stub wechat and mp_auth session bind"
```

---

### Task 3: HTTP 路由 `/api/mp/*`

**Files:**
- Create: `app/routes/mp-auth.js`
- Modify: `app/server.js`（register）
- Modify: `app/routes/patient-public.js` 或抽出 `assertSmsCode` 供 mp 复用（避免复制粘贴短信校验）

- [ ] **Step 1: 实现路由**

```js
function registerMpAuthRoutes(ctx) {
  const { appGet, appPost, json, readBody, bearerToken } = ctx;
  appPost("/api/mp/login", async (req, res) => {
    const b = await readBody(req);
    try {
      const out = await mpAuth.login({ code: b.code, doctorId: b.doctorId });
      json(res, 200, out);
    } catch (e) {
      json(res, 400, { error: e.message || "login_failed" });
    }
  });
  appPost("/api/mp/bind-phone", async (req, res) => {
    const token = bearerToken(req);
    const b = await readBody(req);
    try {
      const out = await mpAuth.bindPhone({
        token,
        phoneCode: b.phoneCode,
        phone: b.phone,
        smsCode: b.smsCode,
        doctorId: b.doctorId,
      });
      json(res, 200, out);
    } catch (e) {
      json(res, 400, { error: e.message || "bind_failed" });
    }
  });
  appGet("/api/mp/me", (req, res) => {
    try { json(res, 200, mpAuth.me(bearerToken(req))); }
    catch (e) { json(res, 401, { error: "unauthorized" }); }
  });
  appPost("/api/mp/logout", (req, res) => {
    try { mpAuth.logout(bearerToken(req)); json(res, 200, { ok: true }); }
    catch (e) { json(res, 200, { ok: true }); }
  });
}
```

`bearerToken`：从 `Authorization: Bearer xxx` 解析。

响应字段统一：

```json
{
  "mpToken": "...",
  "phoneBound": true,
  "expiresIn": 7776000,
  "doctorId": 1,
  "patientId": 12,
  "personId": 3,
  "phoneMasked": "138****8000",
  "hasProfile": false,
  "profileSummary": { "name": "" }
}
```

- [ ] **Step 2: 在 `server.js` 注册 `registerMpAuthRoutes`**

与 `registerPatientPublicRoutes` 同级调用。

- [ ] **Step 3: 手工 curl 冒烟（stub）**

```bash
cd app
set MP_AUTH_STUB=1
node server.js
# 另开终端：
curl -s -X POST http://127.0.0.1:3200/api/mp/login -H "Content-Type: application/json" -d "{\"code\":\"dev1\",\"doctorId\":1}"
curl -s -X POST http://127.0.0.1:3200/api/mp/bind-phone -H "Authorization: Bearer <mpToken>" -H "Content-Type: application/json" -d "{\"phone\":\"13800138000\",\"smsCode\":\"<demo>\"}"
curl -s http://127.0.0.1:3200/api/mp/me -H "Authorization: Bearer <mpToken>"
```

短信 demo 模式用现有 `--demo` / `SMS_DEMO=1` 取 code。

- [ ] **Step 4: Commit**

```bash
git add app/routes/mp-auth.js app/server.js
git commit -m "feat(mp): expose /api/mp login bind me logout"
```

---

### Task 4: 小程序 auth API + store + ensureLogin

**Files:**
- Modify: `patient-uniapp/src/api/config.ts`
- Create: `patient-uniapp/src/api/auth.ts`
- Create: `patient-uniapp/src/stores/auth.ts`
- Create: `patient-uniapp/src/utils/ensureLogin.ts`

- [ ] **Step 1: config**

```ts
export const PHONE_BIND_MODE: "auto" | "wechat" | "sms" = "auto";
/** 开发无微信权限时与后端 MP_AUTH_STUB 对齐，可先 sms */
```

- [ ] **Step 2: `api/auth.ts`**

```ts
import { API_BASE } from "./config";

const TOKEN_KEY = "mpToken";

export function getMpToken() {
  return uni.getStorageSync(TOKEN_KEY) || "";
}
export function setMpToken(t: string) {
  if (t) uni.setStorageSync(TOKEN_KEY, t);
  else uni.removeStorageSync(TOKEN_KEY);
}

export async function mpLogin(code: string, doctorId?: number) {
  const data = await post("/api/mp/login", { code, doctorId });
  if (data.mpToken) setMpToken(data.mpToken);
  return data;
}

export async function mpBindPhone(body: {
  phoneCode?: string;
  phone?: string;
  smsCode?: string;
  doctorId?: number;
}) {
  return post("/api/mp/bind-phone", body, true);
}

export async function mpMe() {
  return get("/api/mp/me", true);
}

function headers(auth: boolean) {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (auth) {
    const t = getMpToken();
    if (t) h.Authorization = `Bearer ${t}`;
  }
  return h;
}
// uni.request 封装 post/get，非 2xx throw
```

- [ ] **Step 3: `stores/auth.ts`**

```ts
export const useAuthStore = defineStore("auth", () => {
  const phoneBound = ref(false);
  const hasProfile = ref(false);
  const phoneMasked = ref("");
  const patientId = ref<number | null>(null);

  async function silentLogin(doctorId?: number) {
    const { code } = await uni.login({ provider: "weixin" });
    const data = await mpLogin(code as string, doctorId);
    applyMe(data);
    return data;
  }

  async function refreshMe() {
    const data = await mpMe();
    applyMe(data);
    return data;
  }

  function applyMe(data: any) {
    phoneBound.value = !!data.phoneBound;
    hasProfile.value = !!data.hasProfile;
    phoneMasked.value = data.phoneMasked || "";
    patientId.value = data.patientId ?? null;
  }

  return { phoneBound, hasProfile, phoneMasked, patientId, silentLogin, refreshMe, applyMe };
});
```

- [ ] **Step 4: `ensureLogin.ts`**

```ts
export async function ensureLogin(returnUrl: string): Promise<boolean> {
  const auth = useAuthStore();
  const app = useAppStore();
  const doctorId = app.doctor?.id;
  try {
    if (!getMpToken()) await auth.silentLogin(doctorId);
    else await auth.refreshMe();
  } catch {
    await auth.silentLogin(doctorId);
  }
  if (auth.phoneBound) {
    if (!auth.hasProfile) {
      // 软推：不阻断；调用方可决定是否 toast
    }
    return true;
  }
  uni.navigateTo({
    url: `/pages/auth/bind?returnUrl=${encodeURIComponent(returnUrl)}`,
  });
  return false;
}
```

- [ ] **Step 5: Commit**

```bash
git add patient-uniapp/src/api/config.ts patient-uniapp/src/api/auth.ts patient-uniapp/src/stores/auth.ts patient-uniapp/src/utils/ensureLogin.ts
git commit -m "feat(mp): uniapp auth client and ensureLogin"
```

---

### Task 5: 绑手机页 + pages.json

**Files:**
- Create: `patient-uniapp/src/pages/auth/bind.vue`
- Modify: `patient-uniapp/src/pages.json`

- [ ] **Step 1: 注册页面**（放在 pages 数组靠前非 tab 区）

```json
{
  "path": "pages/auth/bind",
  "style": {
    "navigationBarTitleText": "绑定手机号",
    "navigationBarBackgroundColor": "#FAFBFC"
  }
}
```

- [ ] **Step 2: `bind.vue` 行为**

1. `onLoad` 读 `returnUrl`；调用 `silentLogin`  
2. `PHONE_BIND_MODE !== 'sms'` 时显示：

```html
<button open-type="getPhoneNumber" @getphonenumber="onWxPhone">微信手机号一键绑定</button>
```

`onWxPhone`：若 `e.detail.code` 有值 → `mpBindPhone({ phoneCode, doctorId })`；否则切短信 UI。  

3. 短信区：手机号 input + 获取验证码（`POST /api/sms/send`）+ 确认绑定  
4. 成功：`auth.applyMe`；若 `!hasProfile` toast「建议完善患者档案」；`redirectTo`/`navigateBack` 到 `returnUrl`  
5. 样式对齐现有后台感（白底细边框，无渐变）

- [ ] **Step 3: 契约测试追加**

```js
test("微信登录绑手机页已注册", () => {
  const pages = readJson("src/pages.json");
  assert.ok(pages.pages.some((p) => p.path === "pages/auth/bind"));
  assert.match(read("src/pages/auth/bind.vue"), /getPhoneNumber|sms|绑定手机/);
  assert.match(read("src/utils/ensureLogin.ts"), /ensureLogin/);
});
```

- [ ] **Step 4: `pnpm run test:ui` 先红后绿（本 Task 内补文件使绿）**

- [ ] **Step 5: Commit**

```bash
git add patient-uniapp/src/pages/auth/bind.vue patient-uniapp/src/pages.json patient-uniapp/tests/ui-contract.test.mjs
git commit -m "feat(mp): bind-phone page and ui contract"
```

---

### Task 6: 档案相关入口接门禁 + hasProfile 推荐

**Files:**
- Modify: `patient-uniapp/src/pages/index/index.vue`
- Modify: `patient-uniapp/src/pages/mine/index.vue`
- Modify: `patient-uniapp/src/pages/archive/profile.vue`
- Modify: `patient-uniapp/src/pages/archive/health.vue`
- Modify: `patient-uniapp/src/pages/replies/index.vue`
- Modify: `patient-uniapp/src/pages/form/add.vue`（及 admission、contact）
- Modify: `patient-uniapp/src/pages/invite/form.vue`

- [ ] **Step 1: 统一入口写法**

```ts
async function goProfile() {
  const ok = await ensureLogin("/pages/archive/profile");
  if (!ok) return;
  uni.navigateTo({ url: "/pages/archive/profile" });
}
```

首页「完善档案」、我的列表 `profile|health|replies|add|adm|contact|invite` 均先 `ensureLogin` 再跳转。

表单页 `onShow`：若无 token / 未绑手机 → `ensureLogin` 当前路径（防直链打开）。

- [ ] **Step 2: 首页/我的推荐条**

登录且 `!hasProfile` 时显示一行：

```text
建议完善患者档案，便于医生团队跟进
[去完善]
```

不拦截 Tab 切换与咨询。

- [ ] **Step 3: 档案提交成功后 `auth.refreshMe()`**，并双写本地 `patientProfile`（过渡）。

- [ ] **Step 4: 构建与契约**

```bash
cd patient-uniapp
pnpm run test:ui
pnpm run build:mp-weixin
```

- [ ] **Step 5: Commit**

```bash
git add patient-uniapp/src/pages
git commit -m "feat(mp): gate archive entries with ensureLogin"
```

---

### Task 7: 咨询已登录身份 + 环境变量文档

**Files:**
- Modify: `patient-uniapp/src/pages/consult/index.vue`
- Modify: `patient-uniapp/src/api/patient.ts`（`sendMessage`）
- Modify: `app/.env.local` 示例注释或 `app/README` / 现有 env 说明（**不要提交真实密钥**）
- Modify: Spec 状态为「开发中 / 骨架已落地部分」
- Create: `app/docs/mp-wechat-login-env.md`

- [x] **Step 1: `sendMessage` 若存在 `mpToken`，header 带 Bearer**；body 增加服务端已认识的 `patientId`（若 `/api/message` 已支持从 session 解析则优先服务端 `patientFromMpBearer`，避免客户端伪造）。  

推荐服务端改动（小）：`/api/message` 若带合法 `mp` Bearer 且已 `phone_bound`，用 session 的 `patientId` 覆盖匿名 `patientKey` 解析结果。

- [x] **Step 2: 咨询页不调用 ensureLogin**；`onShow` 可选静默 `refreshMe`（失败忽略）。

- [x] **Step 3: 文档化** → `app/docs/mp-wechat-login-env.md`

```text
WECHAT_MP_APP_ID=
WECHAT_MP_APP_SECRET=
MP_AUTH_STUB=1          # 本地无微信时
# 客户端 PHONE_BIND_MODE=sms|auto|wechat
```

- [x] **Step 4: 端到端手工验收（对照 spec §8）**

1. 未登录点完善档案 → bind 页 → stub/sms 绑定 → 进档案表  
2. 后台已有该手机已验证档案 → `hasProfile=true`  
3. 未登录可发咨询消息  
4. `pnpm run test:ui` + `node app/_mp_auth_test.js` 全绿  

- [ ] **Step 5: Commit**（本轮按指令跳过）

```bash
git add patient-uniapp/src/pages/consult app/routes/patient-public.js
git commit -m "feat(mp): attach consult messages to logged-in patient"
```

---

## Spec coverage checklist

| Spec 项 | Task |
|---------|------|
| wx.login + `/api/mp/login` | 2–4 |
| 绑手机 wechat/sms | 2–3, 5 |
| person 按手机号全平台 | 1–2 |
| 当前医生 patient 挂接/自动 merge | 2 |
| hasProfile 软推 | 6 |
| 档案入口门禁、咨询匿名 | 6–7 |
| MP 与 OA 凭证分离 / stub | 2, 7 |
| 不做换绑/历史回溯/冷启动强登 | 未排期（符合非范围） |

## Placeholder scan

无 TBD；stub 手机号可用 `MP_STUB_PHONE` 覆盖（Task 2 已写）。

## Type consistency

- 客户端/服务端统一字段：`mpToken`、`phoneBound`、`hasProfile`、`phoneMasked`、`patientId`、`personId`、`doctorId`  
- Header：`Authorization: Bearer <mpToken>`  
- 绑手机 body：`phoneCode` **或** `phone`+`smsCode`

---

Plan complete and saved to `app/docs/superpowers/plans/2026-07-23-patient-mp-wechat-login.md`.

**两种执行方式：**

1. **Subagent-Driven（推荐）** — 每 Task 开新子代理，Task 间复审  
2. **Inline Execution** — 本会话按 Task 连续做，设检查点  

您要哪一种？
