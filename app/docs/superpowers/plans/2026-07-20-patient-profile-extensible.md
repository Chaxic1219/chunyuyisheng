# 医患通患者档案（可扩展）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按规格落地 11 项患者档案联络表：混合存储（核心列 + `patient_profile_fields` + 健康记录附件）、患者端可填可传、后台可读写，并预留字段来源。

**Architecture:** 新增 `app/patient_profile.js` 承载 schema 默认值、多选校验、upsert/read；`db.js` 建表并给 `patients` 补 `gender`/`birth_date`；患者先 `POST /api/patient/voucher-upload`（dataUrl）再 `/api/submit` 联络表；门诊凭证写入 `patient_health_records`（`category=medical_certificate`）；管理端 `GET/PUT /api/admin/patients/:id/profile`；H5 `patient.js` + UniApp `PatientForm` + `admin-ui` 档案详情同步。

**Tech Stack:** Node.js（`server.js`/`db.js`）、SQLite、H5 `app/public/src/patient.js`、`patient-uniapp`、`admin-ui` Vue3、`_unittest.js`

**Spec:** `app/docs/superpowers/specs/2026-07-20-patient-profile-extensible-design.md`（主人已同意继续）

**一期拍板（本计划写死）：**

1. `patients.gender`、`patients.birth_date` **物理加列**
2. 门诊凭证健康记录 `category = medical_certificate`，`title = 门诊凭证`
3. 上传独立接口 `/api/patient/voucher-upload`（JSON + base64 dataUrl，文件 ≤4MB）
4. 多选值形态：`{"values":["青霉素"],"other":""}`
5. P0+P1 同计划交付（含后台可编辑）；P2 抽取管道仅预留 `source` 参数

---

## File Map

| Path | Responsibility |
|------|----------------|
| `app/patient_profile.js` | 默认 schema、校验、掩码、upsert/get |
| `app/db.js` | `patient_profile_fields`；`patients.gender`/`birth_date` |
| `app/server.js` | upload、submit 落库、admin profile、seed contactForm |
| `app/_unittest.js` | U-PROFILE 单测 |
| `app/public/src/patient.js` | H5：select/date/checkbox/file 真上传 |
| `packages/patient-design/types/index.ts` | FormField 类型扩展 |
| `patient-uniapp/src/components/PatientForm.vue` | UniApp 表单 |
| `patient-uniapp/src/api/patient.ts` | upload + submit |
| `admin-ui/src/api/chunyu/index.ts` | profile API |
| `admin-ui/src/views/chunyu/archive/index.vue` | 基础档案分区 |

---

### Task 1: `patient_profile.js` 纯函数 + 单测

**Files:**
- Create: `app/patient_profile.js`
- Modify: `app/_unittest.js`

- [ ] **Step 1: 写失败单测**

在 `app/_unittest.js` 追加：

```js
console.log("\n== U-PROFILE. 患者档案 schema / 多选 / 掩码 ==");
try {
  const pp = require("./patient_profile.js");
  const none = pp.normalizeCheckboxGroup(
    { values: ["无", "青霉素"], other: "" },
    { noneValue: "无", otherValue: "其他" }
  );
  ok(JSON.stringify(none.values) === '["无"]' && none.other === "", "选「无」与其它互斥");
  const otherBad = pp.validateCheckboxGroup(
    { values: ["其他"], other: "" },
    { noneValue: "无", otherValue: "其他" }
  );
  ok(!!otherBad, "勾选其他未填说明 → 有错误");
  const otherOk = pp.validateCheckboxGroup(
    { values: ["其他"], other: "自定义" },
    { noneValue: "无", otherValue: "其他" }
  );
  ok(!otherOk, "其他+说明 → 通过");
  ok(pp.maskIdNumber("110101199003074321") === "1****************1", "身份证掩码");
  ok(pp.isLooseIdNumber("110101199003074321") === true, "18 位身份证通过");
  ok(pp.isLooseIdNumber("123") === false, "过短身份证失败");
  const bad = pp.validateContactProfile({
    name: "测", gender: "男", birthDate: "1990-01-01", phone: "13800138000",
    idNumber: "", disease: "消化系统疾病", pregnancyStatus: "",
    foodContactAllergies: { values: [], other: "" },
    drugAllergies: { values: [], other: "" },
    diseaseHistory: { values: [], other: "" },
    outpatientVoucherUrl: ""
  });
  ok(bad.some((x) => /门诊凭证/.test(x)), "缺门诊凭证校验失败");
} catch (e) {
  ok(false, "patient_profile 加载失败: " + (e && e.message));
}
```

- [ ] **Step 2: 运行确认失败**

Run: `cd app; node _unittest.js 2>&1 | Select-String "U-PROFILE|patient_profile"`  
Expected: 加载失败或断言失败

- [ ] **Step 3: 实现 `app/patient_profile.js`**

实现并导出（完整逻辑见规格 §3–§4，函数清单如下）：

- `defaultContactProfileFields(diseaseOptions)` → 11 项 fields 数组（H5 用 `select` 代替 radio；`checkboxGroup`；`file`）
- `normalizeCheckboxGroup` / `validateCheckboxGroup`（「无」互斥；「其他」必填说明）
- `maskIdNumber` / `isLooseIdNumber` / `parseBirthDate`
- `encodeFieldValue` / `decodeFieldValue`
- `extractProfileFromPayload`（兼容 label 键：姓名/性别/出生日期/手机号/身份证号/您所患的疾病/是否妊娠哺乳/食物、接触物过敏/药物过敏/疾病史）
- `validateContactProfile`（11 项规则；凭证 URL 必须以 `/uploads/` 开头）
- `createProfileStore(db)` → `{ upsertFields, readFields }`
  - upsert 键：`idNumber`/`disease`/`pregnancyStatus`/`foodContactAllergies`/`drugAllergies`/`diseaseHistory`
  - `source` ∈ `patient|assistant|extract|system`
  - 姓名/手机/性别/生日写 `patients` 表，不进 profile_fields

选项常量与腾讯文档一致（食物接触过敏 / 药物过敏 / 疾病史 / 妊娠）。

- [ ] **Step 4: 再跑单测**

Run: `cd app; node _unittest.js 2>&1 | Select-String "U-PROFILE"`  
Expected: U-PROFILE 断言通过

- [ ] **Step 5: Commit（仅主人要求时）**

```bash
git add app/patient_profile.js app/_unittest.js
git commit -m "feat: add patient_profile helpers and unit tests"
```

---

### Task 2: 数据库迁移

**Files:**
- Modify: `app/db.js`（`patients` ensureColumn 与 `patient_health_records` 附近）

- [ ] **Step 1: 补列 + 建表**

```js
ensureColumn("patients", "gender", "TEXT");
ensureColumn("patients", "birth_date", "TEXT");

db.exec(`CREATE TABLE IF NOT EXISTS patient_profile_fields(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doctor_id INTEGER NOT NULL,
  patient_id INTEGER NOT NULL,
  field_key TEXT NOT NULL,
  field_value TEXT,
  source TEXT NOT NULL DEFAULT 'patient',
  confidence REAL,
  updated_by TEXT,
  updated_at TEXT,
  UNIQUE(doctor_id, patient_id, field_key),
  FOREIGN KEY(patient_id) REFERENCES patients(id) ON DELETE CASCADE
)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_ppf_patient ON patient_profile_fields(patient_id)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_ppf_doctor ON patient_profile_fields(doctor_id, updated_at)`);
```

- [ ] **Step 2: 冒烟**

Run:  
`cd app; node -e "const db=require('./db'); console.log(db.prepare(\"PRAGMA table_info(patients)\").all().filter(c=>c.name==='gender'||c.name==='birth_date')); console.log(db.prepare(\"SELECT name FROM sqlite_master WHERE name='patient_profile_fields'\").get());"`  
Expected: 两列 + 表存在

- [ ] **Step 3: Commit（可选）**

```bash
git add app/db.js app/patient_profile.js
git commit -m "feat: add patient_profile_fields and gender/birth_date columns"
```

---

### Task 3: 凭证上传 API

**Files:**
- Modify: `app/server.js`

- [ ] **Step 1: 增加 `POST /api/patient/voucher-upload`**

行为对齐头像上传：

- body: `{ doctorId, dataUrl }`
- 允许 mime: `image/jpeg|jpg|png|webp`、`application/pdf`
- 解码后 ≤4MB
- 目录：`public/uploads/patient-vouchers/`
- 返回：`{ ok:true, url:"/uploads/patient-vouchers/...", mime }`
- `parseBody(req, MESSAGE_MAX_BODY)`

- [ ] **Step 2: 本地冒烟（服务已启动时）**

用 1×1 PNG dataUrl POST，期望 `200` 且 url 前缀正确。

- [ ] **Step 3: Commit（可选）**

```bash
git add app/server.js
git commit -m "feat: add patient outpatient voucher upload API"
```

---

### Task 4: 联络表 submit 落库

**Files:**
- Modify: `app/server.js`（`/api/submit` 联络表分支 + 默认 `contactForm` seed）

- [ ] **Step 1: 默认 contactForm 改为 11 项**

```js
contactForm: {
  title: "医患通患者档案",
  desc: "提交基础信息建档（仅医生团队可见）",
  fields: patientProfile.defaultContactProfileFields(["消化系统疾病", "其它"]),
  submitText: "提交建档",
  success: { title: "已提交", desc: "医助会联系您。" }
}
```

随访方案**不要**放进 `fields`。医生 seed 若覆盖 content，同步更新疾病 options。

- [ ] **Step 2: 联络表分支扩展**

在短信/同意校验通过后：

1. `extractProfileFromPayload` + `b.outpatientVoucherUrl`
2. `validateContactProfile`；失败 `400` 首条错误
3. 写 submission 快照（label 键；多选 JSON 字符串；含凭证 url）
4. `resolvePatient` 后：`UPDATE patients SET real_name, gender, birth_date`
5. `profileStore.upsertFields(..., "patient", "patient")`
6. upsert 健康记录：`category=medical_certificate`，`title=门诊凭证`，`attachments=[{url,name}]`，`created_by=patient`

- [ ] **Step 3: 更新 `submitWhitelistForType` 联络表 label 白名单**

纳入：性别、出生日期、身份证号、您所患的疾病、是否妊娠哺乳、食物/接触物过敏、药物过敏、疾病史、请上传门诊凭证及相关 url 键，避免 PII 误掩导致档案空白。

- [ ] **Step 4: Commit（可选）**

```bash
git add app/server.js
git commit -m "feat: persist contact profile fields and outpatient voucher record"
```

---

### Task 5: Admin Profile API

**Files:**
- Modify: `app/server.js`
- Modify: `admin-ui/src/api/chunyu/index.ts`

- [ ] **Step 1: `GET /api/admin/patients/:id/profile?doctorId=`**

返回：`patient`（name/gender/birthDate/phone）+ `profile`（扩展字段；`idNumber` 默认掩码）+ `fieldMeta`（source/updatedAt）。

- [ ] **Step 2: `PUT /api/admin/patients/:id/profile`**

body 含 `doctorId` + 可改字段；`source=assistant`；权限复用现有 `patients.health.update` 或 `patients.family.update`（实现前 grep authz，选已有 action，禁止臆造未注册权限键导致全员 403）。

- [ ] **Step 3: 前端 API 封装**

```ts
export async function chunyuPatientProfile(patientId: number, doctorId: number) {
  return cyGet(`/api/admin/patients/${patientId}/profile?doctorId=${doctorId}`)
}
export async function chunyuUpdatePatientProfile(
  patientId: number,
  doctorId: number,
  body: Record<string, unknown>
) {
  return cyPut(`/api/admin/patients/${patientId}/profile`, { doctorId, ...body })
}
```

- [ ] **Step 4: Commit（可选）**

---

### Task 6: H5 `patient.js`

**Files:**
- Modify: `app/public/src/patient.js`（`fieldHtml` / `openContact`）

- [ ] **Step 1:** `checkboxGroup` 渲染 + 「无」互斥 + 「其他」输入框
- [ ] **Step 2:** `file`/`outpatientVoucher`：FileReader → `/api/patient/voucher-upload` → 存 url
- [ ] **Step 3:** 提交 payload 含结构化键与 `outpatientVoucherUrl`；保留 label 键兼容
- [ ] **Step 4:** 删除「演示不真实上传」占位逻辑
- [ ] **Step 5:** 浏览器手测联络表全流程

---

### Task 7: UniApp + types

**Files:**
- Modify: `packages/patient-design/types/index.ts`
- Modify: `patient-uniapp/src/components/PatientForm.vue`
- Modify: `patient-uniapp/src/api/patient.ts`

- [ ] **Step 1:** FormField 增加 `date` | `checkboxGroup` | `file` | `tel` 及 `noneValue`/`otherValue`/`accept`
- [ ] **Step 2:** PatientForm 实现对应控件与上传
- [ ] **Step 3:** `uploadVoucher(doctorId, dataUrl)` API
- [ ] **Step 4:** 提交带 `outpatientVoucherUrl`；SMS 按现有 H5/接口能力接入（若 UniApp 尚无验证码 UI，至少字段与上传齐全，并在 PR 注明以 H5 为准）

---

### Task 8: Admin UI 基础档案

**Files:**
- Modify: `admin-ui/src/views/chunyu/archive/index.vue`

- [ ] **Step 1:** 打开抽屉加载 `chunyuPatientProfile`
- [ ] **Step 2:** 「基础档案」分区展示 11 项（身份证掩码；凭证从 health-records 标题「门诊凭证」取链接）
- [ ] **Step 3:** 保存调用 `chunyuUpdatePatientProfile`
- [ ] **Step 4:** `npm run build`（admin-ui）通过

---

### Task 9: 列表兼容 + whitelist 回归

**Files:**
- Modify: `app/server.js` 患者列表 disease 映射
- Modify: `app/_unittest.js` whitelist 相关期望（若有）

- [ ] **Step 1:** disease 增加 `您所患的疾病` 与 profile `disease`
- [ ] **Step 2:** 跑全量 `node _unittest.js`，修复因 whitelist/联络表字段变更失败的断言

---

### Task 10: 验收与部署

- [ ] **Step 1:** `cd app; node _unittest.js` 全绿（含 U-PROFILE）
- [ ] **Step 2:** 手测：上传 → 提交 → 后台可见 → 医助手改 → GET source=assistant
- [ ] **Step 3:** 构建 admin-ui；主人要求时 `python app/_deploy_test_server.py`
- [ ] **Step 4:** 规格文首状态改为「已批准 / 实施中」

---

## Spec Coverage

| 规格条目 | Task |
|----------|------|
| 11 字段 schema | 1, 4 |
| 混合存储 C | 2, 4 |
| 上传 + medical_certificate | 3, 4 |
| 多选互斥/其他 | 1, 6, 7 |
| 身份证掩码/选填 | 1, 5 |
| 医生疾病选项 | 1, 4 |
| Admin 读/写 | 5, 8 |
| 旧数据兼容 | 9 |
| source 预留 | 2, 4, 5 |
| 随访不进 11 项 | 4 |
| H5 + UniApp | 6, 7 |

## 计划自检

- 无 TBD；开放三项已在文首写死
- 函数名前后一致：`createProfileStore` / `extractProfileFromPayload` / `validateContactProfile`
- 未覆盖规格「病历 OCR 上线」——明确属 P2，本计划不做
