# 全局患者主档（跨医生共享档案）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 引入平台级 `persons` 主档，使同一真实患者在所有医生下共享一份档案与健康记录，同时保持群聊/消息按医生隔离。

**Architecture:** 新增 `persons` 表 + `person_id` 外键；`resolvePerson` 按 unionid / 已验证手机号全平台收敛；`patients` 保留为医患关系行；`patient_profile_fields` 与 `patient_health_records` 改挂 `person_id`；`message_log` 不变。现网通过幂等迁移脚本回填 `person_id`。

**Tech Stack:** Node.js (`db.js`, `server.js`, `patient_profile.js`)、SQLite、`admin-ui` Vue3、`_unittest.js` / `_global_person_test.js`

**Spec:** `app/docs/superpowers/specs/2026-07-22-global-person-profile-design.md`（主人已同意 2026-07-22）

**一期写死：**

1. 对外 API 仍用 `patient_id`；内部新增 `person_id` 读写路径
2. 手机号合并仍 **F1 fail-closed**：仅 `phoneVerified===true` 且目标 person 已 `phone_verified=1`
3. `message_log` / `community_messages` **零改动**（不跨医生）
4. 健康记录列表按 `person_id`；响应增加 `sourceDoctorId` / `sourceDoctorName`
5. 人工合并 API：`POST /api/admin/persons/merge`（`super` 角色或新 action `platform.persons.merge`）

---

## File Map

| Path | Responsibility |
|------|----------------|
| `app/db.js` | `persons` 表、`person_id` 列、`resolvePerson`、`resolvePatient` 改造、`mergePersons`、`mergePatients` 升级 |
| `app/person.js` | （新建）person 解析/合并纯逻辑，供 db.js 调用 |
| `app/patient_profile.js` | `createProfileStore` 增加 `upsertPersonFields` / `readPersonFields` |
| `app/server.js` | profile/health/list/submit 切 person；`POST /api/admin/persons/merge` |
| `app/migrate_person_ids.js` | （新建）现网 M2 回填脚本（幂等） |
| `app/_global_person_test.js` | （新建）T1–T8 验收单测 |
| `app/authz.js` | 可选：`platform.persons.merge` action |
| `admin-ui/src/views/chunyu/archive/index.vue` | 健康记录 Tab 增加「来源医生」列 |
| `admin-ui/src/api/chunyu/index.ts` | 类型补充 `sourceDoctorName` |

---

### Task 1: 数据库结构 M1

**Files:**
- Modify: `app/db.js`（`ensureColumn` / `db.exec` 迁移块，约在 `patient_profile_fields` 建表之后）

- [ ] **Step 1: 追加 persons 表与索引**

在 `patient_profile_fields` 建表语句之后插入：

```js
db.exec(`CREATE TABLE IF NOT EXISTS persons(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  real_name TEXT,
  gender TEXT,
  birth_date TEXT,
  phone TEXT,
  phone_verified INTEGER DEFAULT 0,
  unionid TEXT,
  avatar_url TEXT,
  created_at TEXT,
  updated_at TEXT
)`);
db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_persons_phone_verified
  ON persons(phone) WHERE phone_verified = 1 AND phone IS NOT NULL AND trim(phone) != ''`);
db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_persons_unionid
  ON persons(unionid) WHERE unionid IS NOT NULL AND trim(unionid) != ''`);
ensureColumn("patients", "person_id", "INTEGER");
db.exec(`CREATE INDEX IF NOT EXISTS idx_patients_person ON patients(person_id)`);
ensureColumn("patient_profile_fields", "person_id", "INTEGER");
db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_ppf_person_key
  ON patient_profile_fields(person_id, field_key) WHERE person_id IS NOT NULL`);
ensureColumn("patient_health_records", "person_id", "INTEGER");
db.exec(`CREATE INDEX IF NOT EXISTS idx_phr_person ON patient_health_records(person_id, category, recorded_at)`);
db.exec(`CREATE TABLE IF NOT EXISTS person_merge_log(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  keep_person_id INTEGER NOT NULL,
  merged_person_ids TEXT NOT NULL,
  operator TEXT,
  reason TEXT,
  created_at TEXT
)`);
```

- [ ] **Step 2: 本地验证建表**

Run: `cd app; node -e "require('./db.js'); console.log('ok', require('./db.js').db.prepare('SELECT name FROM sqlite_master WHERE name=\\'persons\\'').get())"`  
Expected: `ok { name: 'persons' }`

- [ ] **Step 3: Commit（仅主人要求时）**

```bash
git add app/db.js
git commit -m "feat(db): add persons table and person_id columns"
```

---

### Task 2: `person.js` + `resolvePerson` 单测

**Files:**
- Create: `app/person.js`
- Create: `app/_global_person_test.js`
- Modify: `app/db.js`（`module.exports` 增加 `resolvePerson`, `mergePersons`）

- [ ] **Step 1: 写失败单测 `app/_global_person_test.js`**

```js
const os = require("os"), path = require("path"), fs = require("fs");
const TMP = path.join(os.tmpdir(), "chunyu_global_person_test.db");
[TMP, TMP + "-wal", TMP + "-shm"].forEach((f) => { try { fs.unlinkSync(f); } catch (e) {} });
process.env.DB_PATH = TMP;
const { db, resolvePerson, resolvePatient } = require("./db.js");

let n = 0, fails = [];
const ok = (c, m) => { n++; if (!c) { fails.push(m); console.log("  ✗ " + m); } else console.log("  ✓ " + m); };

const dA = db.prepare("SELECT id FROM doctors LIMIT 1").get().id;
const dB = db.prepare("SELECT id FROM doctors ORDER BY id DESC LIMIT 1").get().id;

// T1: 跨医生 verified phone 收敛
const pA = resolvePatient({ doctorId: dA, channel: "sms", externalId: "phone:13800001001", phone: "13800001001", phoneVerified: true, displayName: "甲" });
const pB = resolvePatient({ doctorId: dB, channel: "sms", externalId: "phone:13800001001", phone: "13800001001", phoneVerified: true, displayName: "乙" });
const rowA = db.prepare("SELECT person_id FROM patients WHERE id=?").get(pA);
const rowB = db.prepare("SELECT person_id FROM patients WHERE id=?").get(pB);
ok(rowA.person_id && rowA.person_id === rowB.person_id, "T1 跨医生 verified phone → 同一 person_id");

// T3: 未验证同号不合并
const u1 = resolvePatient({ doctorId: dA, channel: "wecom", externalId: "u-unv-1", phone: "13800002002" });
const u2 = resolvePatient({ doctorId: dB, channel: "wecom", externalId: "u-unv-2", phone: "13800002002" });
const pu1 = db.prepare("SELECT person_id FROM patients WHERE id=?").get(u1).person_id;
const pu2 = db.prepare("SELECT person_id FROM patients WHERE id=?").get(u2).person_id;
ok(pu1 !== pu2, "T3 未验证同号 → 不同 person_id");

console.log("\n" + (fails.length ? "FAIL " + fails.length : "PASS " + n));
process.exit(fails.length ? 1 : 0);
```

- [ ] **Step 2: 运行确认失败**

Run: `cd app; node _global_person_test.js`  
Expected: FAIL（`resolvePerson` 未实现或 person_id 为空）

- [ ] **Step 3: 实现 `app/person.js`**

```js
function norm(s) { return s == null ? "" : String(s).trim(); }
function isPhone(p) { return /^1[3-9]\d{9}$/.test(p || ""); }

const SOURCE_RANK = { patient: 3, assistant: 2, extract: 1, system: 0 };

function createPersonApi(db) {
  function findByUnionid(unionid) {
    const u = norm(unionid);
    if (!u) return null;
    const r = db.prepare("SELECT id FROM persons WHERE unionid=? LIMIT 1").get(u);
    return r ? r.id : null;
  }
  function findByVerifiedPhone(phone) {
    const p = norm(phone);
    if (!isPhone(p)) return null;
    const r = db.prepare("SELECT id FROM persons WHERE phone=? AND phone_verified=1 LIMIT 1").get(p);
    return r ? r.id : null;
  }
  function insertPerson({ realName, gender, birthDate, phone, phoneVerified, unionid, avatarUrl }) {
    const now = new Date().toISOString();
    const info = db.prepare(`INSERT INTO persons(real_name,gender,birth_date,phone,phone_verified,unionid,avatar_url,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?)`).run(
      norm(realName) || null,
      norm(gender) || null,
      norm(birthDate) || null,
      norm(phone) || null,
      phoneVerified ? 1 : 0,
      norm(unionid) || null,
      norm(avatarUrl) || null,
      now, now
    );
    return info.lastInsertRowid;
  }
  function resolvePerson(input) {
    const unionid = norm(input && input.unionid);
    const phone = norm(input && input.phone);
    const phoneVerified = input && input.phoneVerified === true;
    let pid = findByUnionid(unionid);
    if (!pid && phone && phoneVerified) pid = findByVerifiedPhone(phone);
    if (!pid) {
      pid = insertPerson({
        realName: input && input.realName,
        gender: input && input.gender,
        birthDate: input && input.birthDate,
        phone,
        phoneVerified,
        unionid,
        avatarUrl: input && input.avatarUrl
      });
    } else {
      const now = new Date().toISOString();
      const cur = db.prepare("SELECT * FROM persons WHERE id=?").get(pid);
      db.prepare(`UPDATE persons SET
        real_name=COALESCE(NULLIF(?,''), real_name),
        gender=COALESCE(NULLIF(?,''), gender),
        birth_date=COALESCE(NULLIF(?,''), birth_date),
        phone=CASE WHEN phone IS NULL OR trim(phone)='' THEN ? ELSE phone END,
        unionid=COALESCE(NULLIF(?,''), unionid),
        avatar_url=COALESCE(NULLIF(?,''), avatar_url),
        phone_verified=CASE WHEN ?=1 THEN 1 ELSE phone_verified END,
        updated_at=? WHERE id=?`).run(
        norm(input && input.realName), norm(input && input.gender), norm(input && input.birthDate),
        phone, unionid, norm(input && input.avatarUrl), phoneVerified ? 1 : 0, now, pid
      );
    }
    if (phoneVerified) {
      db.prepare("UPDATE persons SET phone_verified=1, updated_at=? WHERE id=?")
        .run(new Date().toISOString(), pid);
    }
    return pid;
  }
  return { resolvePerson, findByUnionid, findByVerifiedPhone, SOURCE_RANK };
}

module.exports = { createPersonApi, SOURCE_RANK };
```

- [ ] **Step 4: 在 `db.js` 接入 `resolvePerson` 并改造 `resolvePatient`**

在 `resolvePatient` 开头（`doctorId` 校验之后）：

```js
const { createPersonApi } = require("./person.js");
const personApi = createPersonApi(db);
// ... inside resolvePatient, before INSERT patients:
const personId = personApi.resolvePerson({
  realName: norm(input.realName),
  gender: norm(input.gender),
  birthDate: norm(input.birthDate),
  phone,
  phoneVerified,
  unionid,
  avatarUrl: norm(input.avatarUrl)
});
```

将原「同 doctor 手机号/unionid 查找 patients」分支**删除或跳过**；在得到 `pid`（patients.id）后：

```js
db.prepare("UPDATE patients SET person_id=? WHERE id=? AND (person_id IS NULL OR person_id=?)")
  .run(personId, pid, personId);
```

新建 patients 时 `INSERT` 增加 `person_id` 列。

导出：`module.exports = { ..., resolvePerson: personApi.resolvePerson, mergePersons }`

- [ ] **Step 5: 运行单测**

Run: `cd app; node _global_person_test.js`  
Expected: PASS（至少 T1、T3）

- [ ] **Step 6: Commit（仅主人要求时）**

```bash
git add app/person.js app/db.js app/_global_person_test.js
git commit -m "feat: add resolvePerson and cross-doctor patient convergence"
```

---

### Task 3: Profile Store 改 person 级

**Files:**
- Modify: `app/patient_profile.js`
- Modify: `app/_global_person_test.js`（追加 T1 profile 共享断言）

- [ ] **Step 1: 在 `createProfileStore` 增加 person 路径**

```js
const upsertPersonStmt = db.prepare(`
  INSERT INTO patient_profile_fields(person_id, field_key, field_value, source, updated_by, updated_at)
  VALUES(?, ?, ?, ?, ?, ?)
  ON CONFLICT(person_id, field_key) WHERE person_id IS NOT NULL DO UPDATE SET
    field_value = excluded.field_value,
    source = excluded.source,
    updated_by = excluded.updated_by,
    updated_at = excluded.updated_at
`);
```

> SQLite 3.35+ 支持 partial unique index ON CONFLICT；若 node:sqlite 不支持，改用 `INSERT OR REPLACE` + 先 `DELETE` 冲突行。实现时以本地实测为准。

新增：

```js
function upsertPersonFields(personId, fieldsObj, source, updatedBy) { /* 同 upsertFields，键 person_id */ }
function readPersonFields(personId) { /* SELECT WHERE person_id=? */ }
return { upsertFields, readFields, upsertPersonFields, readPersonFields };
```

过渡期 `upsertFields(doctorId, patientId, ...)` 内部：`personId = SELECT person_id FROM patients WHERE id=?`，有则委托 `upsertPersonFields`。

- [ ] **Step 2: 单测 — A 写过敏 B 可读**

在 `_global_person_test.js` 追加：

```js
const pp = require("./patient_profile.js");
const store = pp.createProfileStore(db);
store.upsertPersonFields(rowA.person_id, {
  drugAllergies: { values: ["青霉素"], other: "" }
}, "assistant", "test");
const fieldsB = store.readPersonFields(rowB.person_id);
ok(fieldsB.drugAllergies && fieldsB.drugAllergies.values.includes("青霉素"), "T1 A 写过敏 B 可读");
```

- [ ] **Step 3: 运行单测**

Run: `cd app; node _global_person_test.js`  
Expected: PASS

---

### Task 4: `server.js` 档案 GET/PUT 读写信 person

**Files:**
- Modify: `app/server.js`（`GET/PUT /api/admin/patients/:id/profile`，约 2248–2390 行）

- [ ] **Step 1: GET 从 persons + readPersonFields**

```js
const person = patient.person_id
  ? db.prepare("SELECT * FROM persons WHERE id=?").get(patient.person_id)
  : null;
const fields = patient.person_id
  ? profileStore.readPersonFields(patient.person_id)
  : profileStore.readFields(did, pid);
// patient 块：
name: (person && person.real_name) || patient.real_name || patient.display_name || "",
gender: (person && person.gender) || patient.gender || "",
birthDate: (person && person.birth_date) || patient.birth_date || "",
phone: (person && person.phone) || patient.phone || "",
phoneVerified: !!(person ? person.phone_verified : patient.phone_verified),
```

- [ ] **Step 2: PUT 更新 persons + upsertPersonFields**

身份字段写 `UPDATE persons SET ... WHERE id=?`（`patient.person_id`）；profile patch 调 `profileStore.upsertPersonFields(patient.person_id, profilePatch, "assistant", s.username)`。

手机号已验证逻辑改读 `persons.phone_verified`。

- [ ] **Step 3: 提交联络表路径**（`/api/submit` 内 `profileStore.upsertFields` 调用处）

确保 `resolvePatient` 已设 `person_id`；`upsertFields` 自动走 person 路径。

- [ ] **Step 4: 手动冒烟**

Run: `cd app; node _global_person_test.js && node _unittest.js 2>&1 | Select-String "FAIL|✗"`  
Expected: 无新增 FAIL

---

### Task 5: 健康记录 person 级共享

**Files:**
- Modify: `app/server.js`（`GET/POST/PUT/DELETE .../health-records`，约 2142–2242 行）
- Modify: `admin-ui/src/views/chunyu/archive/index.vue`（健康记录表格加列）
- Modify: `admin-ui/src/api/chunyu/index.ts`

- [ ] **Step 1: 列表查询改 person_id**

```js
const rel = db.prepare("SELECT person_id FROM patients WHERE id=? AND doctor_id=?").get(pid, did);
if (!rel || !rel.person_id) return json(res, 200, { rows: [], counts: {} });
const rows = db.prepare(`SELECT phr.*, d.name AS source_doctor_name
  FROM patient_health_records phr
  LEFT JOIN doctors d ON d.id = phr.doctor_id
  WHERE phr.person_id=? ORDER BY phr.recorded_at DESC, phr.id DESC`).all(rel.person_id);
```

- [ ] **Step 2: 创建/更新双写 person_id**

```js
const personId = rel.person_id;
db.prepare(`INSERT INTO patient_health_records(doctor_id, patient_id, person_id, category, ...)
  VALUES(?,?,?,?,...)`).run(did, pid, personId, ...);
```

- [ ] **Step 3: 患者列表 health_record_count**

```sql
(SELECT COUNT(*) FROM patient_health_records phr WHERE phr.person_id = p.person_id) AS health_record_count
```

需 JOIN persons：`LEFT JOIN persons per ON per.id = p.person_id`；展示 `COALESCE(per.real_name, p.real_name, p.display_name)`。

- [ ] **Step 4: admin-ui 健康记录 Tab 增加「来源医生」列**

在 archive 健康记录 `ElTableColumn` 增加：

```vue
<ElTableColumn label="来源医生" min-width="100">
  <template #default="{ row }">{{ row.sourceDoctorName || '—' }}</template>
</ElTableColumn>
```

映射 API 字段 `source_doctor_name` → `sourceDoctorName`。

- [ ] **Step 5: 单测 T5**

```js
// A 插入 health record on person_id
db.prepare(`INSERT INTO patient_health_records(doctor_id,patient_id,person_id,category,title,created_at,updated_at)
  VALUES(?,?,?,?,?,?,?)`).run(dA, pA, rowA.person_id, "medical_certificate", "门诊凭证", now, now);
const cnt = db.prepare("SELECT COUNT(*) c FROM patient_health_records WHERE person_id=?").get(rowA.person_id).c;
ok(cnt >= 1, "T5 健康记录挂 person_id");
```

- [ ] **Step 6: 构建 admin-ui**

Run: `cd admin-ui; npm run build`  
Expected: exit 0

---

### Task 6: `mergePersons` + 升级 `mergePatients`

**Files:**
- Modify: `app/person.js` 或 `app/db.js`
- Modify: `app/server.js`（新路由）
- Modify: `app/authz.js`

- [ ] **Step 1: 实现 `mergePersons(keepPersonId, mergePersonIds, operator, reason)`**

逻辑见 spec §4.4：

```js
function mergePersons(keepPersonId, mergePersonIds, operator, reason) {
  const keep = +keepPersonId;
  const ids = [...new Set((mergePersonIds || []).map(Number).filter((x) => x > 0 && x !== keep))];
  if (!ids.length) throw new Error("无待合并 person");
  db.exec("BEGIN IMMEDIATE");
  try {
    // 1) profile_fields: 按 SOURCE_RANK + updated_at 合并到 keep
    // 2) UPDATE patient_health_records SET person_id=keep WHERE person_id IN (...)
    // 3) UPDATE patients SET person_id=keep WHERE person_id IN (...); 处理同医生 duplicate → mergePatients
    // 4) DELETE FROM persons WHERE id IN (...);
  // 5) INSERT person_merge_log
    db.exec("COMMIT");
  } catch (e) { db.exec("ROLLBACK"); throw e; }
  return { ok: true, keepPersonId: keep };
}
```

- [ ] **Step 2: `mergePatients` 开头增加 person 合并**

```js
const keepRow = db.prepare("SELECT * FROM patients WHERE id=? AND doctor_id=?").get(keep, did);
for (const mid of ids) {
  const src = db.prepare("SELECT person_id FROM patients WHERE id=?").get(mid);
  if (src && src.person_id && keepRow.person_id && src.person_id !== keepRow.person_id) {
    mergePersons(keepRow.person_id, [src.person_id], "system", "mergePatients");
  }
}
// 刷新 keepRow.person_id 后继续原逻辑
```

- [ ] **Step 3: 新 API**

```js
route("POST", /^\/api\/admin\/persons\/merge$/, async (req, res) => {
  const b = await parseBody(req);
  const s = gate(req, res);
  if (!s) return;
  if (s.role !== "super" && !requireAdminAction(req, res, s, "platform.persons.merge", {}, "仅超管可合并全局患者主档")) return;
  try {
    const result = mergePersons(+b.keepPersonId, b.mergePersonIds || [], s.username, b.reason || "");
    json(res, 200, result);
  } catch (e) { json(res, 400, { error: e.message }); }
});
```

`authz.js` super 角色 actions 数组追加 `"platform.persons.merge"`。

- [ ] **Step 4: 单测 T6/T7**

在 `_global_person_test.js` 增加 `mergePersons` 后 profile 归并、message_log 未迁移断言（T4 消息隔离可 mock：确认无跨 doctor 查询即可）。

---

### Task 7: 现网迁移脚本 M2

**Files:**
- Create: `app/migrate_person_ids.js`

- [ ] **Step 1: 实现幂等回填**

```js
#!/usr/bin/env node
const { db } = require("./db.js");
const { createPersonApi } = require("./person.js");
const personApi = createPersonApi(db);

const patients = db.prepare("SELECT * FROM patients ORDER BY id").all();
let linked = 0;
for (const p of patients) {
  if (p.person_id) continue;
  const personId = personApi.resolvePerson({
    realName: p.real_name,
    gender: p.gender,
    birthDate: p.birth_date,
    phone: p.phone,
    phoneVerified: p.phone_verified === 1,
    unionid: p.unionid,
    avatarUrl: p.avatar_url
  });
  db.prepare("UPDATE patients SET person_id=? WHERE id=?").run(personId, p.id);
  linked++;
}
// 回填 patient_profile_fields.person_id
db.exec(`UPDATE patient_profile_fields SET person_id=(
  SELECT person_id FROM patients WHERE patients.id=patient_profile_fields.patient_id
) WHERE person_id IS NULL AND patient_id IS NOT NULL`);
// 回填 patient_health_records.person_id
db.exec(`UPDATE patient_health_records SET person_id=(
  SELECT person_id FROM patients WHERE patients.id=patient_health_records.patient_id
) WHERE person_id IS NULL AND patient_id IS NOT NULL`);
console.log("migrate_person_ids: linked", linked, "patients");
```

- [ ] **Step 2: 本地二次执行幂等**

Run: `cd app; node migrate_person_ids.js; node migrate_person_ids.js`  
Expected: 第二次 `linked 0` 或仅跳过已链接

- [ ] **Step 3: 单测 T8** — 脚本内嵌或独立断言 `persons` 行数 ≤ `patients` 行数

---

### Task 8: 回归与部署

**Files:**
- Modify: `app/docs/superpowers/specs/2026-07-22-global-person-profile-design.md`（状态 → 已实现）

- [ ] **Step 1: 全量单测**

Run:
```powershell
cd app
node _global_person_test.js
node _unittest.js 2>&1 | Select-String "FAIL|✗|errors"
node _patient_profile_phone_test.js
```
Expected: 全部 PASS

- [ ] **Step 2: 构建并部署**

```powershell
cd admin-ui; npm run build
cd ../app; python _deploy_test_server.py
```

- [ ] **Step 3: 生产迁移（SSH 一次性）**

部署后于服务器执行：

```bash
cd /var/www/chunyu-doctor-review/app && node migrate_person_ids.js
pm2 restart chunyu-doctor
```

- [ ] **Step 4: 验收清单（主人）**

1. 医生 A、B 各选同一已验证手机号患者 → 档案内容一致  
2. A 上传健康记录 → B 可见且显示来源医生  
3. B 消息台无 A 群聊记录  
4. 超管 `POST /api/admin/persons/merge` 可合并重复 person  

---

## Spec Coverage（自检）

| Spec § | Task |
|--------|------|
| 3.1 persons 表 | Task 1 |
| 3.2 patients.person_id | Task 1, 2 |
| 3.3 profile person 级 | Task 3, 4 |
| 3.4 health records 共享 | Task 5 |
| 3.5 消息不共享 | 无代码改动（Task 8 验收 T4） |
| 4.1 resolvePerson | Task 2 |
| 4.2 resolvePatient | Task 2 |
| 4.4 mergePersons | Task 6 |
| 4.5 mergePatients 升级 | Task 6 |
| 5.1–5.3 API | Task 4, 5 |
| 5.4 人工合并 API | Task 6 |
| 6 迁移 M1–M2 | Task 1, 7 |
| 7 前端健康记录列 | Task 5 |
| 8 T1–T8 | Task 2–7 |

**P4（超管合并 UI、去掉 patients 身份列双写）** 留作二期；本计划交付 P1–P3 + 部署。

---

**Plan complete and saved to `app/docs/superpowers/plans/2026-07-22-global-person-profile.md`.**

**两种执行方式：**

1. **Subagent-Driven（推荐）** — 每个 Task 派发独立子代理，任务间做评审，迭代快  
2. **Inline Execution** — 在本会话按 Task 顺序直接实现，阶段性汇报

**你希望用哪种方式开始？**
