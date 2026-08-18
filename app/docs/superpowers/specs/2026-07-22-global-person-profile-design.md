# 全局患者主档（跨医生共享档案）· 设计说明

**日期：** 2026-07-22  
**状态：** 已实现（2026-07-22）；实施计划见 `docs/superpowers/plans/2026-07-22-global-person-profile.md`  
**前置：** `2026-07-20-patient-profile-extensible-design.md`（§2.3「不跨医生共享」由本规格**取代**）  
**目标工程：** `app/`（db、server、patient_profile）、`admin-ui/`（档案/合并/健康记录）、`patient-uniapp/`（建档提交）

---

## 1. 已确认决策

| # | 决策 |
|---|------|
| 1 | **方案 A**：引入全局 `persons` 主档；`patients` 降为「医生–患者关系」 |
| 2 | **合并键**：**仅企微成员 userId（senderId，如 `7881301249033516`）**；同 userId 跨医生直接合并 person；手机号/unionid 只更新字段、不触发跨医生合并 |
| 3 | **健康记录（`patient_health_records`）跨医生共享**：同一 `person_id` 下所有医生看到相同文书列表 |
| 4 | **群聊/消息不跨医生共享**：`message_log`、`community_messages` 仍按 `doctor_id` + 本医生 `patient_id` 隔离展示 |
| 5 | 医患通 11 项 + 后台扩展槽写入 **person 级** profile；医生侧备注/跟进/标签仍 **per-doctor** |

---

## 2. 目标与边界

### 2.1 目标

- 真实世界中**同一人**在平台只有**一份**结构化患者档案（姓名、性别、出生、手机、过敏、疾病史等）。
- 医生 A 补全档案后，医生 B 打开该患者（已建立医患关系）看到**相同主档与健康记录**。
- 不同医生微信群里的对话记录**互不可见**，避免隐私与运营混乱。

### 2.2 成功标准

1. 两名医生各自名下患者经**已验证手机号**或 **unionid** 自动收敛到同一 `person_id`；档案 GET 返回一致。
2. 患者在医生 A 上传的门诊凭证，医生 B 健康记录 Tab 可见（需存在 `patients(doctor_id=B, person_id)` 关系）。
3. 医生 B **不能**在消息台看到该患者在医生 A 企微群里的历史发言。
4. 平台管理员可对疑似重复 `person` 执行人工合并；合并后 profile 与健康记录归并到保留档。
5. 现有单医生内 `mergePatients` 仍可用，且会同步合并底层 `person`（若尚未同一 person）。
6. 迁移脚本对现网 `data.db` 幂等执行，不丢 profile 字段与健康记录。

### 2.3 非目标（一期）

- 跨医生共享**私信/群聊**原文、分诊会话、出站队列、随访计划（仍 per-doctor）。
- 跨医生共享**运营备注、跟进阶段、标签**（仍写在 `patients` 关系行）。
- 患者端小程序「我的档案」跨医生统一登录体系（仍按邀请 `doctor_id` 会话；提交结果写入全局 person）。
- 平台级患者自助查看「所有看过我的医生列表」。

---

## 3. 数据模型

### 3.1 新表 `persons`（全局主档）

```sql
CREATE TABLE IF NOT EXISTS persons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  real_name TEXT,
  gender TEXT,              -- 男 | 女
  birth_date TEXT,          -- YYYY-MM-DD
  phone TEXT,
  phone_verified INTEGER DEFAULT 0,
  unionid TEXT,
  avatar_url TEXT,
  created_at TEXT,
  updated_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_persons_phone_verified
  ON persons(phone) WHERE phone_verified = 1 AND phone IS NOT NULL AND trim(phone) != '';
CREATE UNIQUE INDEX IF NOT EXISTS idx_persons_unionid
  ON persons(unionid) WHERE unionid IS NOT NULL AND trim(unionid) != '';
```

**权威字段（person 级）：** `real_name`、`gender`、`birth_date`、`phone`、`phone_verified`、`unionid`、`avatar_url`。

### 3.2 `patients`（医生–患者关系，保留现表）

新增列：

```sql
ALTER TABLE patients ADD COLUMN person_id INTEGER REFERENCES persons(id);
```

**保留 per-doctor：** `doctor_id`、`display_name`（群昵称/展示名）、`notes`、`tags`、`follow_stage`、`family_role`、`family_household_id`、`family_doctor_enrolled`。

**弃用（迁移后只读镜像，写入走 persons）：** `real_name`、`gender`、`birth_date`、`phone`、`phone_verified`、`unionid` 在 `patients` 上的直接写入逐步停止；读取时 **person 优先**，`patients` 列作过渡期 fallback。

索引：

```sql
CREATE INDEX IF NOT EXISTS idx_patients_person ON patients(person_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_patients_doctor_person ON patients(doctor_id, person_id);
```

> 同一 `person_id` 在同一 `doctor_id` 下只允许一条 `patients` 关系行。

### 3.3 `patient_profile_fields` → person 级

**方案：** 增加 `person_id`，唯一约束改为 `(person_id, field_key)`；`doctor_id` / `patient_id` 保留可空列用于迁移审计，新写入只填 `person_id`。

```sql
ALTER TABLE patient_profile_fields ADD COLUMN person_id INTEGER;
CREATE UNIQUE INDEX IF NOT EXISTS idx_ppf_person_key
  ON patient_profile_fields(person_id, field_key) WHERE person_id IS NOT NULL;
```

扩展字段（过敏、疾病、身份证、后台 BMI 等）全部 person 级共享。

**`disease` 字段：** 存 person 级单值；各医生配置的疾病选项列表仍 per-doctor，写入时校验「值须落在**当前操作医生**配置的 options 内」或允许保留历史自由文本（与现网一致）。

### 3.4 `patient_health_records` → person 级共享

```sql
ALTER TABLE patient_health_records ADD COLUMN person_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_phr_person ON patient_health_records(person_id, category, recorded_at);
```

- **查询：** `WHERE person_id = ?`（不再要求 `doctor_id` 匹配）。
- **写入：** 记录 `doctor_id` = 操作医生（来源/上传者），`person_id` = 患者全局主档。
- **权限：** 调用方医生须存在 `patients(doctor_id, person_id)` 关系。

`patient_id` 列过渡期保留（指向本医生关系行），新写入双写；列表 API 以 `person_id` 为准。

### 3.5 不变：消息与群聊（per-doctor 隔离）

| 表 | 隔离键 | 说明 |
|----|--------|------|
| `message_log` | `doctor_id` + `patient_id`（本医生关系行 id） | 含 `group_id` 的群消息仅在该医生消息台出现 |
| `community_messages` | `group_id` → 群归属医生/主诊 | 不跨医生聚合 |
| `triage_sessions` | `doctor_id` | 分诊会话 per-doctor |
| `followups` | `doctor_id` | 随访 per-doctor |
| `submissions` | `doctor_id` | 联络表快照 per-doctor（审计）；profile 写入 person |

档案详情页的「消息/群聊」Tab **仅查当前 `doctorId` 下的 `message_log`**，不因 person 合并而展示他医消息。

### 3.6 人工合并审计（可选一期表）

```sql
CREATE TABLE IF NOT EXISTS person_merge_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  keep_person_id INTEGER NOT NULL,
  merged_person_ids TEXT NOT NULL,   -- JSON 数组
  operator TEXT,
  reason TEXT,
  created_at TEXT
);
```

---

## 4. 身份解析与合并

### 4.1 `resolvePerson(input)`（新，平台级）

输入：`phone`、`phoneVerified`、`unionid`、`displayName`（仅用于新建 person 时的占位，不进主档真名）。

顺序（fail-closed 与现网 F1 一致）：

1. **`unionid`** → `SELECT id FROM persons WHERE unionid=?`
2. **已验证手机号**（`phoneVerified===true` 且格式合法）→ `SELECT id FROM persons WHERE phone=? AND phone_verified=1`
3. **新建 person** → `INSERT INTO persons (...)`

可信来路置 `phone_verified=1`；不可信来路**不**用手机号合并 person。

### 4.2 `resolvePatient(input)`（改造）

在现有逻辑上包一层：

```
personId = resolvePerson({ phone, phoneVerified, unionid, ... })
确保 patients(doctor_id, person_id) 存在（无则 INSERT 关系行）
返回 patients.id（对外 API 仍用 patient_id，兼容前端）
```

**变更点：** 手机号/unionid 合并从「同 doctor_id」改为「全平台 persons」。

### 4.3 自动合并规则汇总

| 触发 | 条件 | 动作 |
|------|------|------|
| 短信验证建档 | `phoneVerified=true` 且已有 `persons.phone_verified=1` | 收敛到同一 person |
| 微信 unionid | 任意渠道上报 unionid | 收敛到同一 person |
| 同医生重复档 | 现有 `mergePatients` / `autoMergePatientsByUserId` | 先合并 person（若不同），再合并 patients 行 |

### 4.4 `mergePersons(keepPersonId, mergePersonIds, operator)`（新，平台/超管）

迁移并归并：

- `patient_profile_fields` → keep person（字段冲突：`patient` 来源 > `assistant` > `extract`；同来源取 `updated_at` 最新）
- `patient_health_records` → 更新 `person_id`
- `patients` → 全部指向 keep person；若同医生出现 duplicate `(doctor_id, person_id)` 则再调 `mergePatients`
- 删除被合并的 `persons` 行
- 写 `person_merge_log`

**不迁移：** `message_log`、`community_messages`（仍挂在原 doctor 的 patient_id 上）。

### 4.5 同医生 `mergePatients` 升级

合并患者行时：

1. 若 `keep.person_id !== merge.person_id` → 先 `mergePersons(keep.person_id, [merge.person_id])`
2. 再执行现有身份/消息/提交迁移逻辑（消息仍只在本 doctor 内改 `patient_id` 指针）

---

## 5. API 与权限

### 5.1 档案 GET/PUT（`/api/admin/patients/:id/profile`）

1. `patient = patients WHERE id=? AND doctor_id=?`（关系校验）
2. `person = persons WHERE id = patient.person_id`
3. **GET** 核心身份来自 `person`；profile fields 来自 `patient_profile_fields WHERE person_id=?`
4. **PUT** 更新 `persons` + `patient_profile_fields(person_id)`；**不**写他医 `patients.notes`

已验证手机号修改规则不变（person 级 `phone_verified=1` 时拒绝改号）。

### 5.2 健康记录（`/api/admin/patients/:id/health-records`）

- 列表/详情：`person_id` 来自 patient 关系行；`WHERE person_id=?`
- 创建/更新：写 `person_id` + `doctor_id`（操作者）
- 权限：`patients.health.read` / `patients.health.update` + 存在医患关系

### 5.3 患者列表 GET `/api/admin/patients`

- 仍 `WHERE doctor_id=?`（只列本医生关系）
- 展示字段从 `persons` JOIN 取 `real_name`、`phone` 等
- `health_record_count` 改为按 `person_id` 计数（跨医生上传的也算）

### 5.4 人工合并 API（新）

`POST /api/admin/persons/merge`（`platform.patients.merge` 或超管）

```json
{ "keepPersonId": 1, "mergePersonIds": [2, 3], "reason": "运营核实同一人" }
```

后台患者档案页：同医生重复档仍用现有合并；**新增**「跨档疑似同一人」入口（按同名+同号未验证等）跳转平台合并（一期可仅超管菜单）。

### 5.5 患者端提交（联络表 / 小程序建档）

- `resolvePatient` → 更新 **person** 主档 + profile fields
- `submissions` 仍记 `doctor_id` 快照
- 门诊凭证 → `patient_health_records(person_id, doctor_id=提交医生)`

---

## 6. 迁移计划（现网 `data.db`）

**阶段 M1 — 加表加列（幂等）**

1. `CREATE persons`、各表 `ADD COLUMN person_id`
2. 部署可读新列、双写关闭（只加结构）

**阶段 M2 — 回填 person_id**

对每个 `patients` 行：

1. 若 `phone_verified=1` 且 phone 非空 → 查找/创建 person by phone
2. 否则若 `unionid` 非空 → 查找/创建 person by unionid
3. 否则 → 新建独立 person
4. `UPDATE patients SET person_id=?`

**合并冲突：** 多行映射到同一 person 时，按 §4.4 字段优先级合并 profile；health records 改 `person_id`。

**阶段 M3 — 切换读写**

1. `resolvePatient` / profile API / health API 切 person 路径
2. `patient_profile_fields` 新写入只写 `person_id`
3. 停止向 `patients.real_name/phone/...` 写入（只读 fallback 一至两个版本）

**阶段 M4 — 清理（可选）**

- 去掉 `patient_profile_fields` 上 `(doctor_id, patient_id, field_key)` 唯一约束的旧数据列
- 文档标注 `patients` 身份列 deprecated

---

## 7. 前端改动摘要

| 端 | 改动 |
|----|------|
| `admin-ui` 档案抽屉 | 无交互变化；数据源已是 profile API，后端改 JOIN person |
| `admin-ui` 健康记录 | 列表可能变长（含他医上传）；展示「上传医生」列（`doctor_id` → 医生名） |
| `admin-ui` 消息/群聊 | **无改动**；仍按当前 doctor 过滤 |
| `admin-ui` 合并 | 同医生合并保留；超管增加 person 级合并（可选一期） |
| `patient-uniapp` | 提交逻辑不变；服务端写 person |

---

## 8. 测试要点

| # | 场景 | 期望 |
|---|------|------|
| T1 | 医生 A、B 各建档，同一 verified phone | 同一 `person_id`；A 改过敏，B 可见 |
| T2 | 仅 unionid 相同 | 收敛同一 person |
| T3 | 未验证手机号相同 | **不**自动合并；两条 person |
| T4 | 医生 A 群消息 | 医生 B 消息台无记录 |
| T5 | A 上传健康记录 | B 健康记录 Tab 可见，带来源医生 |
| T6 | `mergePersons` | profile + health 归并；message_log 不乱迁 |
| T7 | 同医生 `mergePatients` 不同 person | 先 person 合并再 patient 合并 |
| T8 | 迁移脚本二次执行 | 幂等，无重复 person |

---

## 9. 风险与对策

| 风险 | 对策 |
|------|------|
| 手机号撞号（未验证） | 维持 F1：仅 verified 合并 |
| 两医生对同一字段同时编辑 | 最后写入 wins；来源优先级与现网一致 |
| `disease` 选项不一致 | 存 person 级原值；展示不强制映射他医选项 |
| 迁移误合并 | `person_merge_log` + 备份；合并前 dry-run 报告 |
| API 兼容 | 对外仍用 `patient_id`；文档注明内部 person_id |

---

## 10. 实施分期建议

| 期 | 内容 |
|----|------|
| **P1** | db 迁移 + `resolvePerson` + `resolvePatient` 改造 + profile 读写 person 级 |
| **P2** | health records person 级 + 列表 count + 来源医生展示 |
| **P3** | `mergePersons` API + 迁移脚本 M2 + 回归测试 |
| **P4** | 后台 person 合并 UI（超管）；去掉 patients 身份列双写 |

---

**请确认本规格后，再进入 `writing-plans` 生成实施计划。**
