# Patient MP Account Compat Launch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在约束 B（不批量踢旧会话、不影响非小程序现网主路径）下，补齐兼容开关与发布切片，使 Codex 已完成的小程序账号安全改动可安全联调上线。

**Architecture:** 默认 `MP_SESSION_COMPAT=1` 放宽「仅最新 token」校验，但登录/换绑/解绑仍轮换；将私密上传就绪从全局启动/ready 中拆出；冻结外科手术发布文件清单；小程序对缺失数据申请接口友好降级。生产部署仍按独立清单执行，本计划默认不写生产。

**Tech Stack:** Node.js、better-sqlite3、现有路由、UniApp、Vue 3、Pinia、TypeScript、Node `assert`/`node:test`

**Design:** `app/docs/superpowers/specs/2026-08-03-patient-mp-account-compat-launch-design.md`

**Repository note:** 工作区可能无 Git。检查点改为「测试通过 + 工作区快照复核」，不执行 `git commit`，除非主人另行要求。

---

## File Map

- Modify: `app/mp_runtime_config.js` - `MP_SESSION_COMPAT` 读取；核心就绪与私密上传就绪拆分
- Modify: `app/mp_auth.js` - 兼容期跳过 latest-token 校验；存量读会话医生策略
- Modify: `app/routes/mp-auth.js` 或 `app/server.js` - ready/health 使用核心就绪（若当前绑定全局 readiness）
- Modify: `app/routes/patient-public.js` - 凭证目录失败只影响上传；message 兼容对照后微调
- Modify: `app/_mp_auth_test.js` - 兼容开/关与旧票并存用例
- Create or Modify: `app/_mp_runtime_config_test.js` - 私密目录失败不阻断核心就绪
- Modify: `patient-uniapp/src/pages/settings/index.vue` - 数据申请 404 友好提示
- Modify: `patient-uniapp/tests/ui-contract.test.mjs` 或专项测试 - 404 文案/分支契约
- Create: `app/docs/superpowers/plans/2026-08-03-patient-mp-account-release-slice.md` - 可同步/禁止同步清单模板
- Update: `app/docs/superpowers/plans/2026-07-31-patient-mp-account-deployment-checklist.md` - 增补兼容开关与切片步骤（或另建 2026-08-03 checklist 补丁段）

---

### Task 1: Workspace Snapshot Gate

**Files:**
- Create (outside repo or beside workspace): timestamped full-directory copy instructed in step output

- [ ] **Step 1: Record current tree fingerprint**

Working directory: `C:\Users\11\Desktop\www\chunyu-doctor-review`

Run:

```powershell
Get-Date -Format o
Test-Path .git
(Get-ChildItem -Recurse -File app,patient-uniapp -ErrorAction SilentlyContinue | Measure-Object).Count
```

Expected: prints timestamp; `.git` may be `False`; file count > 0.

- [ ] **Step 2: Create snapshot directory**

Run (adjust stamp):

```powershell
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$dest = "C:\Users\11\Desktop\www\chunyu-doctor-review-snapshot-$stamp"
Copy-Item -Path "C:\Users\11\Desktop\www\chunyu-doctor-review" -Destination $dest -Recurse -Force
Write-Output $dest
```

Expected: snapshot path printed; no production SSH writes.

- [ ] **Step 3: Checkpoint**

Record snapshot path in the agent handoff note. Do not delete the snapshot until主人确认。

---

### Task 2: Session Compat Flag and Auth Tests

**Files:**
- Modify: `app/mp_runtime_config.js`
- Modify: `app/mp_auth.js`
- Modify: `app/_mp_auth_test.js`

- [ ] **Step 1: Write failing compat tests**

In `app/_mp_auth_test.js`, add cases equivalent to:

```js
await test("compat on: older non-revoked token still authenticates", () => {
  process.env.MP_SESSION_COMPAT = "1";
  // create two sessions for same openid without revoking the first
  // (insert second row directly or temporarily bypass revoke for fixture)
  const older = /* first token */;
  const newer = /* second token */;
  assert.equal(mpAuth.requireSession(older).openid, expectedOpenid);
  assert.equal(mpAuth.requireSession(newer).openid, expectedOpenid);
});

await test("compat off: only latest non-revoked token authenticates", () => {
  process.env.MP_SESSION_COMPAT = "0";
  assert.throws(() => mpAuth.requireSession(older), /unauthorized/);
  assert.equal(mpAuth.requireSession(newer).openid, expectedOpenid);
});

await test("login still revokes siblings even when compat on", async () => {
  process.env.MP_SESSION_COMPAT = "1";
  const before = await mpAuth.login({ code: sharedCode, doctorId: activeDoctor.id });
  const after = await mpAuth.login({ code: sharedCode, doctorId: activeDoctor.id });
  assert.throws(() => mpAuth.requireSession(before.mpToken), /unauthorized/);
  assert.equal(mpAuth.requireSession(after.mpToken).openid, expectedOpenid);
});
```

Adapt to existing test helpers; keep doctor active and phone-bound fixtures consistent with file style.

- [ ] **Step 2: Run tests and verify RED**

Working directory: `app`

Run: `node _mp_auth_test.js`

Expected: FAIL because compat flag is ignored and latest-only always applies (or fixture cannot create two valid sessions).

- [ ] **Step 3: Add compat reader in runtime config**

In `app/mp_runtime_config.js` export:

```js
function mpSessionCompatEnabled(env = process.env) {
  if (!Object.prototype.hasOwnProperty.call(env, "MP_SESSION_COMPAT")) {
    // First production ship defaults to compat ON when unset.
    return true;
  }
  return truthyEnvValue(env.MP_SESSION_COMPAT);
}
```

Export `mpSessionCompatEnabled` from `module.exports`.

- [ ] **Step 4: Gate latest-token check in mp_auth.js**

In `readSessionWithoutTouch`, wrap the latest-token block:

```js
const { mpSessionCompatEnabled } = require("./mp_runtime_config.js");
// ...
if (row.revoked_at) throw new Error("unauthorized");
if (!mpSessionCompatEnabled()) {
  const latest = db.prepare(`SELECT token FROM mp_sessions
    WHERE openid=? AND revoked_at IS NULL
    ORDER BY created_at DESC, rowid DESC
    LIMIT 1`).get(String(row.openid || ""));
  if (!latest || String(latest.token) !== t) throw new Error("unauthorized");
}
```

For **read** path doctor checks under compat: if `mpSessionCompatEnabled()` and the session row has a missing/inactive doctor, do **not** throw in `readSessionWithoutTouch` solely for that reason when the caller is a soft read. Prefer: keep hard doctor check for `requireBoundSession` and write routes; for unbound/me soft endpoints, return session with flags rather than 401. Minimal approach accepted by design:

- Keep expiry + revoked checks always
- Latest-token only when compat off
- Keep active-doctor throw for write-oriented `requireBoundSession`; for `requireSession` used by light GETs, if compat on and doctor inactive, still allow session read of `me`-like data that only needs openid/person (implement by moving active-doctor check into `requireBoundSession` / explicit `requireActiveSessionDoctor` used by AI/upload/data-request/bind)

Concrete minimal diff if current code always checks doctor in `readSessionWithoutTouch`:

```js
const doctorId = Number(row.doctor_id);
const hasDoctor = Number.isInteger(doctorId) && doctorId > 0;
if (!mpSessionCompatEnabled()) {
  if (!hasDoctor) throw new Error("unauthorized");
  const doctor = db.prepare("SELECT active FROM doctors WHERE id=?").get(doctorId);
  if (!doctor || +doctor.active !== 1) throw new Error("unauthorized");
} else if (hasDoctor) {
  // optional: leave row as-is; write paths call requireBoundSession which re-checks
}
```

Ensure `requireBoundSession` still verifies active doctor + person/patient consistency.

- [ ] **Step 5: Run tests and verify GREEN**

Run: `node _mp_auth_test.js`

Expected: exit 0, including new compat cases.

- [ ] **Step 6: Checkpoint**

Note: auth compat tests green. No production changes.

---

### Task 3: Split Core Readiness from Private Upload Readiness

**Files:**
- Modify: `app/mp_runtime_config.js`
- Modify: `app/_mp_runtime_config_test.js` (or create if patterns live elsewhere)
- Modify: callers of `assertRuntimeReady` / `runtimeReadiness` in `app/server.js` / routes

- [ ] **Step 1: Write failing readiness tests**

```js
await test("core readiness ok even when private upload dir missing in production", () => {
  const env = {
    NODE_ENV: "production",
    WECHAT_MP_APP_ID: "wx_test",
    WECHAT_MP_APP_SECRET: "secret_test",
    // PRIVATE_UPLOAD_DIR intentionally absent
  };
  const core = runtimeCoreReadiness({ env, prepareDirectory: false });
  assert.equal(core.ok, true);
  const uploads = validatePrivateUploadRuntime(env);
  assert.equal(uploads.ok, false);
});
```

- [ ] **Step 2: Run and verify RED**

Run the runtime config test file. Expected: FAIL because current `runtimeReadiness` merges upload errors into global ok=false.

- [ ] **Step 3: Implement split helpers**

```js
function runtimeCoreReadiness(options = {}) {
  const env = options.env || process.env;
  const wechat = validateWechatRuntime(env);
  const sms = validateSmsRuntime(env, options);
  const errors = [...wechat.errors, ...sms.errors];
  return {
    ok: errors.length === 0,
    status: errors.length === 0 ? 200 : 503,
    errors
  };
}

function runtimeUploadReadiness(options = {}) {
  const uploads = options.prepareDirectory === false
    ? validatePrivateUploadRuntime(options.env || process.env, options)
    : preparePrivateUploadDirectory(options);
  return {
    ok: uploads.ok,
    status: uploads.ok ? 200 : 503,
    errors: uploads.errors.slice(),
    directory: uploads.directory
  };
}

function runtimeReadiness(options = {}) {
  // Backward-compatible aggregate for tests that still want full picture,
  // but server start and /api/ready must use runtimeCoreReadiness.
  const core = runtimeCoreReadiness(options);
  const uploads = runtimeUploadReadiness(options);
  const errors = [...core.errors, ...uploads.errors];
  return { ok: errors.length === 0, status: errors.length === 0 ? 200 : 503, errors };
}
```

Change `assertRuntimeReady` to assert **core** only:

```js
function assertRuntimeReady(options = {}) {
  const result = runtimeCoreReadiness(options);
  if (!result.ok) {
    const error = new Error("runtime_config_invalid");
    error.code = "runtime_config_invalid";
    error.errors = result.errors.slice();
    throw error;
  }
  return result;
}
```

In voucher upload handler, if `runtimeUploadReadiness` fails, return stable `503 private_upload_dir_unavailable` (or existing mapped error), without affecting other routes.

Wire `/api/ready` (or equivalent) to `runtimeCoreReadiness`. Optionally expose upload capability under bootstrap/`/api/ready` details without failing the whole probe.

- [ ] **Step 4: Verify GREEN**

Run: `node _mp_runtime_config_test.js` (and any server lifecycle test touching ready).

Expected: exit 0.

- [ ] **Step 5: Checkpoint**

Private upload misconfig does not block core start/ready.

---

### Task 4: Message Path Compat Guardrail

**Files:**
- Modify: `app/routes/patient-public.js` (only if prod diff shows breakage)
- Modify or Create: `app/_mp_message_identity_test.js`
- Create: notes inside release slice doc of observed prod vs local behavior

- [ ] **Step 1: Capture production vs local message identity behavior**

On a **local** checkout of production-equivalent `patient-public.js` if available from server baseline pack; otherwise SSH **read-only** copy of production file into a temp compare dir (no deploy).

Document:

- Does prod trust client `patientId` / `patientKey`?
- What does local do today?

- [ ] **Step 2: Define compat expectation**

If local already rejects client patient spoofing but still allows anonymous server-generated session keys, keep that. Add/adjust test:

```js
await test("message ignores client patientId for identity writes", async () => {
  const res = await api(port, "POST", "/api/message", {
    text: "你好",
    patientId: 999999,
    patientKey: "forged"
  });
  assert.equal(res.status, 200); // or current success shape
  // assert stored identity is anonymous:* or bound session, never 999999 unless auth proves it
});
```

- [ ] **Step 3: Only change code if tests prove a regression against known prod clients**

If production mini-program/H5 clients never relied on forging patientId, keep strict ignore. If a known internal tool depended on it, gate with `MP_MESSAGE_TRUST_CLIENT_PATIENT=1` default **off** in production, and document — do not silently re-enable trust.

- [ ] **Step 4: Run**

`node _mp_message_identity_test.js` → exit 0

- [ ] **Step 5: Checkpoint**

Message behavior documented; no unexplained prod client break.

---

### Task 5: Mini Program Data-Request 404 Soft Fail

**Files:**
- Modify: `patient-uniapp/src/pages/settings/index.vue`
- Modify: `patient-uniapp/tests/ui-contract.test.mjs` (or task test file)

- [ ] **Step 1: Write failing UI contract**

Assert settings load/create handlers treat HTTP 404 as unavailable, not auth recovery:

```js
// source contract: settings page maps ApiError status 404 to a user message containing 暂不可用
```

- [ ] **Step 2: Implement**

In `loadMyDataRequests` / create handlers:

```ts
if (error instanceof ApiError && error.status === 404) {
  uni.showToast({ title: "数据申请暂不可用", icon: "none" });
  return;
}
```

Do not clear token or call login recovery on 404.

- [ ] **Step 3: Verify**

Working directory: `patient-uniapp`

```powershell
pnpm run test:ui
pnpm run type-check
```

Expected: pass.

- [ ] **Step 4: Checkpoint**

404 soft-fail in place.

---

### Task 6: Freeze Release Slice Document

**Files:**
- Create: `app/docs/superpowers/plans/2026-08-03-patient-mp-account-release-slice.md`

- [ ] **Step 1: Write slice template with concrete commands**

Document must include:

```markdown
# 2026-08-03 发布切片

## 可同步（示例，发布前用生产 diff 最终确认）
- app/mp_auth.js
- app/routes/mp-auth.js
- app/routes/mp-ai.js
- app/routes/patient-public.js
- app/db.js
- app/rate_limit.js
- app/mp_runtime_config.js
- app/sms_provider.js
- app/sms_code_verifier.js
- app/wechat_mp.js
- app/server_lifecycle.js
- （仅当与生产 diff 证明无分诊漂移时）app/server.js 装配片段

## 禁止同步（除非证明与生产一致）
- app/agent/**
- app/triage.js / engine 策略漂移文件
- app/modules/community/** 行为漂移文件
- 任意仅本地存在的实验路由

## 环境
NODE_ENV=production
MP_SESSION_COMPAT=1
PRIVATE_UPLOAD_DIR=/var/lib/chunyu-doctor/private-uploads

## 校验
对每个可同步文件记录生产基线 sha256 与待发布 sha256。
```

- [ ] **Step 2: Fill hashes when production baseline pack is available**

```powershell
Get-FileHash -Algorithm SHA256 path\to\file
```

On server (read-only):

```bash
sha256sum /var/www/chunyu-doctor-review/app/mp_auth.js
```

- [ ] **Step 3: Checkpoint**

Slice doc exists; empty hash table is OK until baseline pack pulled, but file lists must be filled.

---

### Task 7: Focused Regression Bundle

**Files:** none new required

- [ ] **Step 1: Run backend focused suite**

Working directory: `app`

```powershell
node _mp_auth_test.js
node _mp_invite_security_test.js
node _mp_ai_test.js
node _mp_voucher_security_test.js
node _mp_data_requests_test.js
node _mp_message_identity_test.js
node _mp_runtime_config_test.js
```

Expected: all exit 0.

- [ ] **Step 2: Run mini-program checks**

Working directory: `patient-uniapp`

```powershell
pnpm run type-check
pnpm run test:ui
pnpm run build:mp-weixin
```

Expected: all exit 0.

- [ ] **Step 3: Record npm test status without weakening medical policy**

Working directory: `app`

```powershell
npm test
```

Expected: may still fail ~61 legacy triage/community assertions. Record exact summary; **do not** change risk grades to force green.

- [ ] **Step 4: Checkpoint**

Focused green; full npm test status recorded as known gate (business/security sign-off still required before production).

---

### Task 8: Deployment Checklist Patch (No Production Execute)

**Files:**
- Create: `app/docs/superpowers/plans/2026-08-03-patient-mp-account-compat-deployment-checklist.md`

- [ ] **Step 1: Write checklist that extends 2026-07-31 with B constraints**

Must include:

1. Snapshot + slice hashes  
2. DB backup + copy migration  
3. `MP_SESSION_COMPAT=1`  
4. core ready vs upload ready  
5. old token smoke  
6. admin/community/message smoke  
7. mini-program same window  
8. rollback uses pre-deploy DB  
9. explicit: do not close compat in same window unless separately approved  
10. explicit: no production action without主人批准  

- [ ] **Step 2: Stop**

Do **not** SSH write, migrate, or restart production in this task.

- [ ] **Step 3: Final handoff**

Report:

- files changed locally for compat
- test commands and results
- remaining approvals (61-test policy, Linux SIGTERM, production window)

---

## Spec Coverage Check

| Spec section | Tasks |
|---|---|
| §4 Session compat | Task 2 |
| §5.3 Upload readiness split | Task 3 |
| §5.1 / §5.1 message | Task 4 |
| §5.5 data-request 404 | Task 5 |
| §6 release slice | Task 6, 8 |
| §7 snapshot | Task 1 |
| Success / focused tests | Task 7 |
| No auto production deploy | Task 8 Step 2 |

## Placeholder Scan

No TBD steps; commands and code sketches included. Production hash fill is explicitly gated on baseline availability in Task 6 Step 2.
