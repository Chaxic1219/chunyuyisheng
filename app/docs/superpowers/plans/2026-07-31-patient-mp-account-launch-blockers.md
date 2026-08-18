# Patient Mini Program Account Launch Blockers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复患者微信小程序正式上线前的账号会话、换绑、邀请冒用、匿名 AI、公开上传、数据权利入口和敏感缓存问题。

**Architecture:** 后端以 `mp_sessions`、OpenID、已验证手机号和当前医生为唯一身份依据，所有身份切换在 SQLite 事务内完成。小程序通过单飞初始化、结构化 API 错误和账号作用域缓存与后端保持一致；安全能力缺失时失败关闭。

**Tech Stack:** Node.js、better-sqlite3、现有自定义路由器、UniApp、Vue 3、Pinia、TypeScript、Node `assert`/`node:test`

**Design:** `app/docs/superpowers/specs/2026-07-31-patient-mp-account-launch-blockers-design.md`

**Repository note:** 当前工作区没有 Git 元数据，因此下列任务以“测试通过 + 文件差异复核”为检查点，不执行 `git commit`。

---

## File Map

### Backend

- Modify: `app/db.js` - 幂等创建数据申请、私有文件和 AI 审计表。
- Modify: `app/mp_auth.js` - 医生校验、OpenID 单会话、原子绑定/换绑和令牌轮换。
- Modify: `app/routes/mp-auth.js` - 稳定 HTTP 错误映射和数据申请路由。
- Modify: `app/routes/mp-ai.js` - AI 授权、限频和元数据审计。
- Modify: `app/routes/patient-public.js` - 邀请身份验证、认证上传和受控下载。
- Create: `app/rate_limit.js` - 小型进程内固定窗口限频器。
- Modify: `app/_mp_auth_test.js` - 登录单会话和原子换绑回归。
- Create: `app/_mp_invite_security_test.js` - 邀请身份验证回归。
- Modify: `app/_mp_ai_test.js` - AI 授权和限频回归。
- Create: `app/_mp_voucher_security_test.js` - 上传和下载权限回归。
- Create: `app/_mp_data_requests_test.js` - 数据申请表与 API 回归。

### Mini Program

- Modify: `patient-uniapp/src/api/auth.ts` - 结构化 API 错误、轮换令牌和数据申请接口。
- Modify: `patient-uniapp/src/stores/auth.ts` - 登录单飞和身份轮换缓存清理。
- Modify: `patient-uniapp/src/utils/ensureLogin.ts` - bootstrap 医生前置和认证恢复单飞。
- Modify: `patient-uniapp/src/pages/index/index.vue` - 合并首页初始化入口。
- Modify: `patient-uniapp/src/pages/auth/bind.vue` - 支持原子 `rebind` 模式。
- Modify: `patient-uniapp/src/pages/settings/index.vue` - 不再预解绑，接入真实导出/删除申请。
- Modify: `patient-uniapp/src/api/patient.ts` - 认证上传、邀请错误处理和安全档案摘要。
- Modify: `patient-uniapp/src/components/PatientForm.vue` - 邀请/上传前认证和生产短信关闭。
- Modify: `patient-uniapp/src/api/aiChat.ts` - AI 授权字段和结构化 401/429。
- Modify: `patient-uniapp/src/utils/mpAiSession.ts` - 不再持久化完整 AI 正文，保存授权版本。
- Modify: `patient-uniapp/src/utils/storageScope.ts` - 清理新增授权键和旧敏感键。
- Modify: `patient-uniapp/src/pages/consult/index.vue` - 发送前登录、首次授权和 401 恢复。
- Modify: `patient-uniapp/src/api/config.ts` - 生产默认只允许微信手机号能力。
- Modify: `patient-uniapp/tests/ui-contract.test.mjs` - 新增源码契约回归。

## Task 1: Backend Session Rotation and Atomic Rebind

**Files:**
- Modify: `app/_mp_auth_test.js`
- Modify: `app/db.js`
- Modify: `app/mp_auth.js`
- Modify: `app/routes/mp-auth.js`
- Create: `app/rate_limit.js`

- [x] **Step 1: Write failing account tests**

Add tests that assert:

```js
await assert.rejects(
  () => mpAuth.login({ code: "missing-doctor" }),
  /doctor_required/
);

const inactive = db.prepare("SELECT id FROM doctors WHERE active=0 ORDER BY id LIMIT 1").get();
if (inactive) {
  await assert.rejects(
    () => mpAuth.login({ code: "inactive-doctor", doctorId: inactive.id }),
    /doctor_unavailable/
  );
}

const first = await mpAuth.login({ code: sharedCode, doctorId: activeDoctor.id });
const second = await mpAuth.login({ code: sharedCode, doctorId: activeDoctor.id });
assert.throws(() => mpAuth.requireSession(first.mpToken), /unauthorized/);
assert.equal(mpAuth.requireSession(second.mpToken).openid, expectedOpenid);
assert.equal(
  db.prepare("SELECT count(*) AS n FROM mp_sessions WHERE openid=? AND revoked_at IS NULL")
    .get(expectedOpenid).n,
  1
);

const before = mpAuth.me(bound.mpToken);
await assert.rejects(
  () => mpAuth.bindPhone({
    token: bound.mpToken,
    phone: conflictingPhone,
    smsCode: "bad",
    doctorId: activeDoctor.id,
  }),
  /invalid_sms_code/
);
assert.deepEqual(mpAuth.me(bound.mpToken), before);
```

Also assert a successful rebind returns a different `mpToken`, invalidates the old token, clears the old person's `mp_openid`, and binds the target person.

- [x] **Step 2: Run the test and verify RED**

Run: `node _mp_auth_test.js`

Working directory: `app`

Expected: FAIL because missing/inactive doctors are accepted, old sessions remain valid, and bind returns the same token.

- [x] **Step 3: Add the fixed-window limiter**

Create `app/rate_limit.js` with:

```js
"use strict";

function createFixedWindowLimiter({ limit, windowMs, maxKeys = 5000 }) {
  const rows = new Map();
  return function consume(key) {
    const now = Date.now();
    const k = String(key || "unknown");
    let row = rows.get(k);
    if (!row || row.resetAt <= now) row = { count: 0, resetAt: now + windowMs };
    row.count += 1;
    rows.set(k, row);
    if (rows.size > maxKeys) {
      for (const [oldKey, old] of rows) {
        if (old.resetAt <= now || rows.size > maxKeys) rows.delete(oldKey);
        if (rows.size <= maxKeys) break;
      }
    }
    return {
      allowed: row.count <= limit,
      retryAfter: Math.max(1, Math.ceil((row.resetAt - now) / 1000)),
    };
  };
}

module.exports = { createFixedWindowLimiter };
```

- [x] **Step 4: Implement doctor validation and token rotation**

In `app/db.js`, add the idempotent column:

```js
ensureColumn("mp_sessions", "revoked_at", "TEXT");
```

In `app/mp_auth.js`, add:

```js
function requireActiveDoctor(doctorId) {
  const did = Number(doctorId);
  if (!Number.isInteger(did) || did <= 0) throw new Error("doctor_required");
  const doctor = db.prepare("SELECT id FROM doctors WHERE id=? AND active=1").get(did);
  if (!doctor) throw new Error("doctor_unavailable");
  return did;
}

function replaceSessionsForOpenid(input) {
  const tx = db.transaction((row) => {
    const revokedAt = nowIso();
    db.prepare(
      "UPDATE mp_sessions SET revoked_at=?, last_seen_at=? WHERE openid=? AND revoked_at IS NULL"
    ).run(revokedAt, revokedAt, String(row.openid));
    const token = createMpSession(row);
    return summarizeSession(token);
  });
  return tx(input);
}
```

`requireSession` treats a non-null `revoked_at` as `unauthorized`. Use `requireActiveDoctor` before patient resolution. Make `login` call `replaceSessionsForOpenid`. Make `bindPhone` perform person selection, conflict check, OpenID transfer, patient attachment, revocation of existing OpenID sessions and creation of the replacement session inside one `db.transaction`. Do not update, revoke or delete the current session before phone verification succeeds.

- [x] **Step 5: Map stable errors and limit login**

In `app/routes/mp-auth.js`, map:

```js
const STATUS_BY_ERROR = {
  unauthorized: 401,
  session_expired: 401,
  doctor_required: 400,
  doctor_unavailable: 403,
  phone_already_bound: 409,
  sms_unavailable: 503,
};
```

Apply the fixed-window limiter to `/api/mp/login` using request IP plus submitted code hash. Return `429 { error: "rate_limited" }` and `Retry-After`.

- [x] **Step 6: Verify GREEN**

Run: `node _mp_auth_test.js`

Expected: all account tests pass, including single active token and rollback on failed rebind.

## Task 2: Invite Submission Identity Verification

**Files:**
- Create: `app/_mp_invite_security_test.js`
- Modify: `app/routes/patient-public.js`
- Modify: `app/patient_invite.js`

- [x] **Step 1: Write failing route tests**

Register patient routes against a temporary database and assert:

```js
const anonymous = await callInviteSubmit({
  headers: {},
  body: validInviteBody(victimPhone),
});
assert.equal(anonymous.status, 401);
assert.equal(anonymous.body.error, "phone_verification_required");

const mismatch = await callInviteSubmit({
  headers: { authorization: `Bearer ${otherPhoneToken}` },
  body: validInviteBody(victimPhone),
});
assert.equal(mismatch.status, 403);
assert.equal(mismatch.body.error, "phone_mismatch");

const matched = await callInviteSubmit({
  headers: { authorization: `Bearer ${victimToken}` },
  body: validInviteBody(victimPhone),
});
assert.equal(matched.status, 200);
assert.equal(matched.body.ok, true);
```

Assert no patient/person/profile/submission row changes after anonymous or mismatched attempts.

- [x] **Step 2: Run the test and verify RED**

Run: `node _mp_invite_security_test.js`

Working directory: `app`

Expected: FAIL because anonymous invite submission currently updates a patient and signs a `psid`.

- [x] **Step 3: Require a trusted phone source before resolving a patient**

In `app/routes/patient-public.js`, split trusted verification into:

```js
function invitePhoneVerification(req, doctorId, phone, smsCode) {
  const bound = trustedPhoneVerification(req, doctorId, phone);
  if (bound) return bound;

  const bearer = bearerSessionPhone(req);
  if (bearer && bearer.phone !== phone) {
    const err = new Error("phone_mismatch");
    err.statusCode = 403;
    throw err;
  }

  if (!smsCode) {
    const err = new Error("phone_verification_required");
    err.statusCode = 401;
    throw err;
  }
  const smsError = verifySms(phone, smsCode);
  if (smsError) {
    const err = new Error(smsError === "短信服务未配置" ? "sms_unavailable" : "invalid_sms_code");
    err.statusCode = smsError === "短信服务未配置" ? 503 : 400;
    throw err;
  }
  return { phone, source: "sms" };
}
```

Call it after basic phone validation but before `resolveInvitePatient`, `applyInviteProfileToPatient`, `bumpUse` or session creation. Pass `phoneVerified: true` into patient resolution so an SMS-verified new patient is not stored as unverified. Remove unauthenticated merge confirmation disclosure.

- [x] **Step 4: Expose capability without patient existence**

Return:

```js
{
  requireSms: true,
  allowBoundSession: true,
  smsAvailable: smsProvider.isConfigured()
}
```

Do not return whether a patient with that phone exists.

- [x] **Step 5: Verify GREEN**

Run: `node _mp_invite_security_test.js`

Expected: anonymous and mismatched requests are rejected without database writes; matching Bearer and valid SMS paths pass.

## Task 3: AI Consent, Rate Limit, and Metadata Audit

**Files:**
- Modify: `app/db.js`
- Modify: `app/_mp_ai_test.js`
- Modify: `app/routes/mp-ai.js`

- [x] **Step 1: Write failing AI tests**

Add route assertions:

```js
await route.fn(authReq(boundToken), res);
assert.equal(lastJson.status, 403);
assert.equal(lastJson.body.error, "ai_consent_required");

await route.fn(authReq(boundToken, {
  text: "你好",
  sensitiveDataConsent: true,
  consentVersion: "2026-07-31",
}), res);
assert.notEqual(lastJson.status, 403);

for (let i = 0; i < configuredLimit + 1; i += 1) {
  await route.fn(authReq(boundToken, consentBody), res);
}
assert.equal(lastJson.status, 429);
assert.equal(lastJson.body.error, "rate_limited");
```

Assert `mp_ai_audit` contains person/patient/session/model/character counts/status but no request text or history JSON.

- [x] **Step 2: Run the test and verify RED**

Run: `node _mp_ai_test.js`

Expected: FAIL because consent, rate limit and audit metadata are not enforced.

- [x] **Step 3: Add the idempotent audit table**

In `app/db.js`:

```sql
CREATE TABLE IF NOT EXISTS mp_ai_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  openid TEXT NOT NULL,
  person_id INTEGER,
  patient_id INTEGER,
  doctor_id INTEGER NOT NULL,
  session_id TEXT,
  model TEXT,
  input_chars INTEGER NOT NULL DEFAULT 0,
  history_turns INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  error_code TEXT,
  created_at TEXT NOT NULL
);
```

Add an index on `(person_id, created_at)`.

- [x] **Step 4: Enforce consent, limit and audit**

In `app/routes/mp-ai.js`:

```js
if (b.sensitiveDataConsent !== true || b.consentVersion !== "2026-07-31") {
  return json(res, 403, { error: "ai_consent_required" });
}
const rate = consumeAi(`${sess.openid}:${token.slice(0, 12)}`);
if (!rate.allowed) {
  res.setHeader("Retry-After", String(rate.retryAfter));
  return json(res, 429, { error: "rate_limited" });
}
```

Insert metadata once per attempted upstream call in `finally`. Never insert `b.text`, `b.history`, generated reply or page context.

- [x] **Step 5: Verify GREEN**

Run: `node _mp_ai_test.js`

Expected: AI tests pass and audit rows contain no conversation content.

## Task 4: Authenticated Private Voucher Storage

**Files:**
- Modify: `app/db.js`
- Create: `app/_mp_voucher_security_test.js`
- Modify: `app/routes/patient-public.js`

- [x] **Step 1: Write failing voucher tests**

Assert:

```js
assert.equal((await upload({ headers: {}, body: validFile })).status, 401);
assert.equal((await upload({
  headers: bearer(boundToken),
  body: { ...validFile, doctorId: otherDoctor.id },
})).status, 403);

const uploaded = await upload({
  headers: bearer(boundToken),
  body: { ...validFile, doctorId: boundDoctor.id },
});
assert.equal(uploaded.status, 200);
assert.match(uploaded.body.url, /^\/api\/patient\/voucher\//);
assert.equal(fs.existsSync(path.join(publicDir, uploaded.body.fileName || "")), false);

assert.equal((await download(uploaded.body.url, {})).status, 401);
assert.equal((await download(uploaded.body.url, bearer(otherPatientToken))).status, 403);
assert.equal((await download(uploaded.body.url, bearer(boundToken))).status, 200);
```

- [x] **Step 2: Run the test and verify RED**

Run: `node _mp_voucher_security_test.js`

Expected: FAIL because upload is anonymous and writes under `public/uploads`.

- [x] **Step 3: Add private file metadata**

In `app/db.js` create:

```sql
CREATE TABLE IF NOT EXISTS mp_private_files (
  id TEXT PRIMARY KEY,
  doctor_id INTEGER NOT NULL,
  person_id INTEGER NOT NULL,
  patient_id INTEGER NOT NULL,
  storage_name TEXT NOT NULL UNIQUE,
  original_name TEXT,
  mime TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
```

Index `(patient_id, created_at)`.

- [x] **Step 4: Authenticate upload and move storage**

Require Bearer session with `phone_bound`, `person_id`, `patient_id`, and matching `doctor_id`. Save to `process.env.PRIVATE_UPLOAD_DIR || path.join(__dirname, "..", "private-uploads", "patient-vouchers")`; create a random file id and return `/api/patient/voucher/<id>`.

Use the fixed-window limiter keyed by session and IP. Keep the existing MIME and 4 MB decoded-size checks.

- [x] **Step 5: Add controlled download**

Implement `GET /api/patient/voucher/:id`. Permit when:

```js
const ownsFile =
  mpSession &&
  +mpSession.person_id === +file.person_id &&
  +mpSession.patient_id === +file.patient_id &&
  +mpSession.doctor_id === +file.doctor_id;
```

Otherwise allow only a valid admin session whose doctor scope includes `file.doctor_id`. Set `Content-Type`, `Content-Length`, `Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff`, and a safe `Content-Disposition`.

- [x] **Step 6: Verify GREEN**

Run: `node _mp_voucher_security_test.js`

Expected: all upload/download permission tests pass and no new file appears under `app/public/uploads/patient-vouchers`.

## Task 5: Real Data Export and Deletion Requests

**Files:**
- Modify: `app/db.js`
- Create: `app/_mp_data_requests_test.js`
- Modify: `app/routes/mp-auth.js`

- [x] **Step 1: Write failing data request tests**

Assert unauthenticated and unbound requests fail. For a bound token:

```js
const first = await createRequest(boundToken, "export");
assert.equal(first.status, 201);
assert.equal(first.body.request.status, "pending");

const second = await createRequest(boundToken, "export");
assert.equal(second.status, 200);
assert.equal(second.body.request.id, first.body.request.id);

const mine = await listMine(boundToken);
assert.equal(mine.body.items.length, 1);
assert.equal(mine.body.items[0].requestType, "export");
```

Reject types outside `export` and `delete`.

- [x] **Step 2: Run the test and verify RED**

Run: `node _mp_data_requests_test.js`

Expected: FAIL because the table and routes do not exist.

- [x] **Step 3: Add idempotent schema**

In `app/db.js` create `mp_data_requests` with the fields and statuses in the design. Add:

```sql
CREATE INDEX IF NOT EXISTS idx_mp_data_requests_person
  ON mp_data_requests(person_id, request_type, status, created_at);
```

- [x] **Step 4: Add authenticated routes**

In `app/routes/mp-auth.js` implement:

```js
POST /api/mp/data-requests
GET  /api/mp/data-requests/mine
```

Require bound `person_id` and `patient_id`. Use a transaction to return an existing `pending`/`processing` request or insert a new `pending` request. Return only owner-safe fields and never execute deletion in this route.

- [x] **Step 5: Verify GREEN**

Run: `node _mp_data_requests_test.js`

Expected: authentication, type validation, deduplication and owner filtering pass.

## Task 6: Mini Program Single-Flight Login and Atomic Rebind UI

**Files:**
- Modify: `patient-uniapp/tests/ui-contract.test.mjs`
- Modify: `patient-uniapp/src/api/auth.ts`
- Modify: `patient-uniapp/src/stores/auth.ts`
- Modify: `patient-uniapp/src/utils/ensureLogin.ts`
- Modify: `patient-uniapp/src/pages/index/index.vue`
- Modify: `patient-uniapp/src/pages/auth/bind.vue`
- Modify: `patient-uniapp/src/pages/settings/index.vue`

- [x] **Step 1: Write failing source contract tests**

Add assertions that:

```js
assert.match(read("src/stores/auth.ts"), /let silentLoginPromise/);
assert.match(read("src/utils/ensureLogin.ts"), /await app\.load\(\)/);
assert.match(read("src/pages/index/index.vue"), /let initializePromise/);
assert.doesNotMatch(read("src/pages/settings/index.vue"), /mpUnbindPhone/);
assert.match(read("src/pages/settings/index.vue"), /rebind=1/);
assert.match(read("src/pages/auth/bind.vue"), /rebind/);
```

Also assert API failures expose numeric `status` and stable `code`.

- [x] **Step 2: Run the test and verify RED**

Run: `pnpm run test:ui`

Working directory: `patient-uniapp`

Expected: FAIL on missing single-flight locks and pre-unbind flow.

- [x] **Step 3: Introduce structured API errors**

In `src/api/auth.ts`:

```ts
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message = code,
  ) {
    super(message);
  }
}
```

Throw `ApiError(status, data.error || "request_failed")`. Ensure `mpBindPhone` stores a returned rotated `mpToken`.

- [x] **Step 4: Make login single-flight**

In `src/stores/auth.ts`:

```ts
let silentLoginPromise: Promise<any> | null = null;

async function silentLogin(doctorId?: number) {
  if (silentLoginPromise) return silentLoginPromise;
  silentLoginPromise = performSilentLogin(doctorId).finally(() => {
    silentLoginPromise = null;
  });
  return silentLoginPromise;
}
```

Keep the existing `uni.login` timeout inside `performSilentLogin`.

- [x] **Step 5: Require bootstrap before login**

In `src/utils/ensureLogin.ts`:

```ts
if (!app.doctor?.id) await app.load();
const doctorId = Number(app.doctor?.id);
if (!Number.isInteger(doctorId) || doctorId <= 0) {
  uni.showToast({ title: "服务信息尚未加载", icon: "none" });
  return false;
}
```

Retry only once after clearing a 401 session.

- [x] **Step 6: Merge homepage initialization**

In `src/pages/index/index.vue`:

```ts
let initializePromise: Promise<void> | null = null;

function initializeHome(force = false) {
  if (initializePromise && !force) return initializePromise;
  initializePromise = (async () => {
    syncSafeHeader();
    await store.load(force);
    await loadHome(force);
    await refreshLocal();
  })().finally(() => {
    initializePromise = null;
  });
  return initializePromise;
}
```

Both lifecycle hooks call `initializeHome`; remove their separate login/refresh calls.

- [x] **Step 7: Change rebind navigation**

Settings opens:

```ts
"/pages/auth/bind?rebind=1&returnUrl=%2Fpages%2Fsettings%2Findex"
```

It must not call `mpUnbindPhone`, `auth.clear`, or show “已解除绑定”. The bind page reads `rebind=1`, explains that the old number remains valid until verification succeeds, and calls the same atomic bind API.

- [x] **Step 8: Verify GREEN**

Run: `pnpm run test:ui`

Expected: new account flow contract tests pass.

## Task 7: Mini Program Invite, Upload, SMS, and Data Rights

**Files:**
- Modify: `patient-uniapp/tests/ui-contract.test.mjs`
- Modify: `patient-uniapp/src/api/config.ts`
- Modify: `patient-uniapp/src/api/patient.ts`
- Modify: `patient-uniapp/src/components/PatientForm.vue`
- Modify: `patient-uniapp/src/api/auth.ts`
- Modify: `patient-uniapp/src/pages/settings/index.vue`

- [x] **Step 1: Write failing UI contract tests**

Assert:

```js
assert.match(read("src/api/config.ts"), /MODE === "production".*"wechat"/s);
assert.match(read("src/api/patient.ts"), /Authorization.*Bearer/s);
assert.match(read("src/components/PatientForm.vue"), /phone_verification_required/);
assert.match(read("src/api/auth.ts"), /createMpDataRequest|getMyMpDataRequests/);
assert.doesNotMatch(read("src/pages/settings/index.vue"), /入口维护中/);
```

- [x] **Step 2: Run the test and verify RED**

Run: `pnpm run test:ui`

Expected: FAIL because upload lacks Bearer, production mode defaults to `auto`, and settings uses toasts.

- [x] **Step 3: Close SMS fallback in production**

In `src/api/config.ts`, resolve:

```ts
const requestedBindMode = import.meta.env.VITE_PHONE_BIND_MODE;
export const PHONE_BIND_MODE =
  import.meta.env.MODE === "production"
    ? "wechat"
    : requestedBindMode || "auto";
```

`PatientForm.vue` only renders SMS controls when the server metadata reports `smsAvailable === true` and the configured bind mode permits SMS.

- [x] **Step 4: Authenticate upload and invite**

`uploadVoucher` must include current Bearer and handle 401/403/429 codes. Before upload, `PatientForm.vue` calls `ensureLogin` for mini-program use.

Invite submission sends `smsCode` only when SMS is truly available. On `phone_verification_required` with no SMS capability, redirect to the bind page while preserving the invite return URL. On `phone_mismatch`, show that the submitted phone must match the verified account.

- [x] **Step 5: Wire data request APIs**

Add:

```ts
export type MpDataRequestType = "export" | "delete";
export async function createMpDataRequest(requestType: MpDataRequestType) {
  return post("/api/mp/data-requests", { requestType }, true);
}
export async function getMyMpDataRequests() {
  return get("/api/mp/data-requests/mine", true);
}
```

Settings calls `ensureLogin`, confirms delete intent, creates the request, and displays request id/status. Export uses the same real endpoint without claiming an immediate file download.

- [x] **Step 6: Verify GREEN**

Run: `pnpm run test:ui`

Expected: production SMS, authenticated upload, invite recovery and real data request contracts pass.

## Task 8: Mini Program AI Consent and Sensitive Cache Reduction

**Files:**
- Modify: `patient-uniapp/tests/ui-contract.test.mjs`
- Modify: `patient-uniapp/src/api/aiChat.ts`
- Modify: `patient-uniapp/src/utils/mpAiSession.ts`
- Modify: `patient-uniapp/src/utils/storageScope.ts`
- Modify: `patient-uniapp/src/api/patient.ts`
- Modify: `patient-uniapp/src/pages/consult/index.vue`

- [x] **Step 1: Write failing privacy contract tests**

Assert:

```js
const aiSession = read("src/utils/mpAiSession.ts");
assert.doesNotMatch(aiSession, /mpAiChatHistory/);
assert.match(aiSession, /AI_CONSENT_VERSION/);
assert.match(read("src/api/aiChat.ts"), /sensitiveDataConsent/);
assert.match(read("src/pages/consult/index.vue"), /ensureAiConsent/);

const patientApi = read("src/api/patient.ts");
assert.doesNotMatch(patientApi, /idNumber:\s*String\(prefill\.idNumber/);
assert.doesNotMatch(patientApi, /phone:\s*payload\\[["']手机号["']\\]/);
```

- [x] **Step 2: Run the test and verify RED**

Run: `pnpm run test:ui`

Expected: FAIL because full AI history, phone and ID data are persisted.

- [x] **Step 3: Store consent, not chat content**

Replace AI history storage with:

```ts
export const AI_CONSENT_VERSION = "2026-07-31";
const CONSENT_KEY = "mpAiConsent";

export function hasMpAiConsent(scope: string): boolean {
  return uni.getStorageSync(`${CONSENT_KEY}:${scope}`) === AI_CONSENT_VERSION;
}

export function saveMpAiConsent(scope: string): void {
  uni.setStorageSync(`${CONSENT_KEY}:${scope}`, AI_CONSENT_VERSION);
}
```

Keep messages only in page memory. Remove `loadMpAiHistory`, `saveMpAiHistory` and the deep watch that writes messages.

- [x] **Step 4: Require consent before appending the user message**

`onSend` first calls `ensureLogin`, then `ensureAiConsent`. The modal states that health questions may be sent to the configured AI service and advises against entering unnecessary identity details. Only after confirmation should the page append the user message and call the API.

Send:

```ts
{
  sensitiveDataConsent: true,
  consentVersion: AI_CONSENT_VERSION,
}
```

On `ApiError` 401, clear auth and route to binding; on 429, show a retry-later message without re-sending.

- [x] **Step 5: Store only display-safe profile summaries**

`saveLocalProfileFromPayload` and `saveLocalProfileFromPrefill` write masked phone and empty `idNumber`. Do not persist full allergies, disease history or AI text beyond what is needed for the home display; server archive remains the source for full details.

Add `mpAiConsent:` to scoped cleanup. Keep legacy `mpAiChatHistory:` in cleanup only so old installations erase it at identity rotation.

- [x] **Step 6: Verify GREEN**

Run: `pnpm run test:ui`

Expected: privacy contract tests pass and no source path writes full AI messages or ID numbers to storage.

## Task 9: Integrated Regression and Build Verification

**Files:**
- Modify only files required to fix regressions found by these commands.

- [x] **Step 1: Run focused backend tests**

Working directory: `app`

Run:

```powershell
node _mp_auth_test.js
node _mp_invite_security_test.js
node _mp_ai_test.js
node _mp_voucher_security_test.js
node _mp_data_requests_test.js
node _mp_v32_test.js
node _mp_archive_replies_test.js
```

Expected: every command exits 0.

- [ ] **Step 2: Run existing backend regression**

Run: `npm test`

Working directory: `app`

Expected: existing unit, API and UI suites exit 0. Any unrelated pre-existing failure must be recorded with its exact command and output; do not weaken new security tests.

- [x] **Step 3: Run mini-program checks**

Working directory: `patient-uniapp`

Run:

```powershell
pnpm run type-check
pnpm run test:ui
pnpm run build:mp-weixin
```

Expected: type check, all UI contracts and production build exit 0.

- [x] **Step 4: Scan production output**

Run:

```powershell
rg -n "http://115\.190\.210\.129|000000|mock://|短信备用|mpAiChatHistory|身份证号.{0,20}setStorage" dist/build/mp-weixin
```

Expected: no production server IP, stub SMS code, mock upload URL, SMS fallback, AI history storage or ID storage markers.

- [x] **Step 5: Review local database and file side effects**

Confirm all tests use temporary `DB_PATH`, test private upload directories are removed, and no production database or remote server was modified.

- [x] **Step 6: Produce deployment checklist without deploying**

Report:

- changed files and verified commands;
- schema additions;
- required environment variable `PRIVATE_UPLOAD_DIR`;
- production backup and migration order;
- legacy session cleanup query counts;
- legacy public voucher migration requirement;
- rollback steps;
- explicit statement that deployment still awaits separate approval.
