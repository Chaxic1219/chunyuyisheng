# 医患通患者档案（前台精简 · 后台可扩展）设计

**日期：** 2026-07-20  
**状态：** 已落地（2026-07-20）；实施计划见 `docs/superpowers/plans/2026-07-20-patient-profile-extensible.md`  
**增量：** 2026-07-20 后台「扩展信息」槽（admin-only，患者不填；见 §4.3.5）  
**目标工程：** `app/`（联络表提交 / 患者档案）、`admin-ui/`（患者档案后台）、`patient-uniapp/`（患者端表单）  
**依据：** 《医患通·患者档案信息收集表》（腾讯文档，对齐横方联络表 + 春雨健康档案取舍版）  
**产品原则：** 患者只填必要项；后台可更全；字段可配置扩展；支持后续病历自动补全。

## 1. 已确认决策

拍板（一期强制遵守）：

1. **患者首版表单 = 医患通 11 项**（见 §3），不多于春雨、略多于横方。
2. **架构采用混合方案 C**：核心列 + 扩展 profile 值 + schema 配置 + 文书附件层；**不**把全量字段硬编码进 `patients` 宽表。
3. **患者可见字段 ⊂ 后台档案字段**；春雨砍掉的体测/生活方式/会员等仅作扩展预留，不进首版患者表。
4. **「您所患的疾病」按医生配置单选**（不同医生选项不同），与现有 `content` / 医生维度配置对齐。
5. **手机号保持必填 + 短信验证**；身份证号选填；敏感字段脱敏存储/展示。
6. **门诊凭证必填上传**：写入 uploads，并同步生成一条可在「患者健康记录」中查看的附件记录（见 §5.3）。
7. **随访方案不挤进这 11 项**：首版联络表以档案收集为主；随访入组改到建档成功后的引导/二期（现有入组逻辑兼容，不强制删除历史配置）。
8. **字段来源可区分**：`patient` | `assistant` | `extract` | `system`；自动抽取不得静默覆盖已验证的姓名/手机。

## 2. 目标与边界

### 2.1 目标

- 用一张压力可控的建档表完成身份识别与用药安全相关信息采集。
- 后台拥有结构化、可扩展的患者档案视图，便于医助完善与后续 AI/病历补全。
- 新增字段以 schema/配置为主，避免每次扩字段都改表发版。

### 2.2 成功标准

1. 患者端联络表展示 §3 的 11 项，必填/选填与表一致，校验通过后方可提交。
2. 提交后 `patients` 核心身份更新，扩展字段写入 profile 层，门诊凭证可下载/预览。
3. 后台患者档案详情可查看并编辑全部 11 项；扩展槽位可展示「未采集」占位。
4. 医生可配置「所患疾病」选项列表，不影响其他医生。
5. 多选字段支持「无」与其它选项互斥；「其他」可填自由文本。
6. 旧联络表（仅姓名/手机/疾病）历史数据仍可读；新提交按新 schema 落库。
7. 相关单测与表单回归通过。

### 2.3 明确不做（一期）

- 春雨级完整体检档案（身高体重 BMI、腰围、烟酒、肝肾功能、婚姻、家族史、个人习惯、智能设备、会员权益等）的患者端采集。
- 病历 OCR / 自动抽取上线（只预留来源与写入管道）。
- 强制采集身份证；不把身份证作为建档门槛。
- 替换或废除 `patient_health_records` 现有十类文书模型。
- 跨医生共享同一份患者主档（仍按 `doctor_id` 隔离，与现网一致）。

## 3. 字段规格（医患通患者档案）

来源：腾讯文档《医患通·患者档案信息收集表》右侧「医患通患者档案」栏。

| # | key（建议） | 中文名 | 必填 | 形式 | 选项 / 规则 |
|---|-------------|--------|------|------|-------------|
| 1 | `name` | 姓名 | 是 | 文本 | 写入 `patients.real_name` |
| 2 | `gender` | 性别 | 是 | 单选 | `男` / `女` |
| 3 | `birthDate` | 出生日期 | 是 | 日期 | 存 `YYYY-MM-DD`；后台可派生年龄 |
| 4 | `phone` | 手机号 | 是 + 验证 | 文本 + 短信 | 现有验证链路；权威键 |
| 5 | `idNumber` | 身份证号 | 否 | 文本 | 选填；校验格式（宽松）；存储脱敏 |
| 6 | `disease` | 您所患的疾病 | 是 | 单选 | 选项来自医生配置；兼容历史自由文本展示 |
| 7 | `pregnancyStatus` | 是否妊娠哺乳 | 否 | 单选 | `否` / `备孕期` / `怀孕中` / `哺乳期` |
| 8 | `foodContactAllergies` | 食物、接触物过敏 | 否 | 多选 + 其他 | 无、黄瓜、化妆品、芒果、花粉、牛奶、油漆、坚果、动物皮毛、海鲜、其他 |
| 9 | `drugAllergies` | 药物过敏 | 否 | 多选 + 其他 | 无、普鲁卡因、维生素B1、青霉素、破伤风抗毒素、地卡因、磺胺类药物、泛影葡胺、阿司匹林、其他 |
| 10 | `diseaseHistory` | 疾病史 | 否 | 多选 + 其他 | 无、高血压、过敏性疾病、哮喘、糖尿病、白癜风、心脏病、癫痫、其他 |
| 11 | `outpatientVoucher` | 请上传门诊凭证 | 是 | 上传 | 图片/PDF；大小与类型服务端限制 |

### 3.1 多选交互规则

- 选项值为稳定英文/拼音 key 或中文枚举均可，**一期采用中文枚举与表格一致**，便于运营对照；schema 内同时保留 `value`/`label`。
- 选「无」时清除同组其它选项；选其它选项时自动取消「无」。
- 「其他」勾选后必须出现文本框；未填「其他」说明则校验失败（若勾选了其他）。

### 3.2 与横方 / 春雨的取舍摘要

| 保留（交集或安全相关） | 砍掉（春雨有、患者不填） |
|------------------------|--------------------------|
| 姓名、性别、出生/年龄语义、手机、疾病、门诊凭证 | 身高体重 BMI、腰围、吸烟饮酒、肝肾功能 |
| 妊娠哺乳、食物/接触过敏、药物过敏、疾病史 | 婚姻、家族史、个人习惯、设备、会员、问诊同步等 |
| 身份证（选填，来自春雨） | 横方「所在的单位」——一期不做 |

## 4. 架构

### 4.1 方案选择

| 方案 | 结论 |
|------|------|
| A. 全塞 `profile_json` | 否：难检索、难溯源 |
| B. 纯 EAV | 否：查询与类型弱 |
| **C. 混合** | **采用**：核心列 + 扩展值表 + schema + 健康文书 |

### 4.2 逻辑分层

```
┌─────────────────────────────────────────────┐
│  Schema（医生/平台配置）                      │
│  - patientVisible / required / type/options │
│  - disease options per doctor               │
└─────────────────┬───────────────────────────┘
                  │
     ┌────────────┼────────────┐
     ▼            ▼            ▼
 patients     profile 扩展层   patient_health_records
 (核心身份)   (性别/生日/过敏…)  (门诊凭证等文书附件)
     ▲            ▲
     └── submissions 联络表 payload（审计快照，兼容旧链路）
```

### 4.3 数据模型（建议）

#### 4.3.1 核心列（`patients` 已有或轻量补列）

继续使用：`real_name`、`phone`、`phone_verified`、`notes`、`tags`、`follow_stage`、`family_*` 等。

一期可补列（高频检索，可选）：

- `gender TEXT`
- `birth_date TEXT`（`YYYY-MM-DD`）

若暂不补列，则二者仅存扩展层；**推荐补列**，列表筛「年龄段/性别」更简单。

#### 4.3.2 扩展值表 `patient_profile_fields`

```sql
CREATE TABLE IF NOT EXISTS patient_profile_fields (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doctor_id INTEGER NOT NULL,
  patient_id INTEGER NOT NULL,
  field_key TEXT NOT NULL,
  field_value TEXT,              -- JSON 字符串：标量或数组/对象
  source TEXT NOT NULL DEFAULT 'patient',  -- patient|assistant|extract|system
  confidence REAL,               -- extract 可用；其它可空
  updated_by TEXT,               -- admin username 或 system
  updated_at TEXT,
  UNIQUE(doctor_id, patient_id, field_key)
);
```

建议首期写入的 `field_key`：

`idNumber`、`pregnancyStatus`、`foodContactAllergies`、`drugAllergies`、`diseaseHistory`、`disease`（若需保留结构化副本）、以及未来扩展键。

多选存 JSON 数组，例如：`["青霉素","其他"]`，另键 `drugAllergiesOther` 存说明文本（或把 other 嵌在对象 `{ values:[], other:"" }`——**推荐对象形态**，一次读写）。

推荐统一值形态：

```json
{ "values": ["青霉素"], "other": "" }
```

妊娠等单选存字符串；身份证存脱敏后原文策略见 §6。

#### 4.3.5 后台扩展槽（2026-07-20 增量）

仅医助可见/可编辑，**不进患者联络表**。写入同一张 `patient_profile_fields`，`source=assistant`（未来 extract 亦可）。

| key | 中文 | 形式 |
|-----|------|------|
| `heightCm` | 身高(cm) | 数字 |
| `weightKg` | 体重(kg) | 数字 |
| `bmi` | BMI | 由身高体重派生并落库快照 |
| `waistCm` | 腰围(cm) | 数字 |
| `smoking` | 吸烟史 | 无 / 已戒 / 仍吸 |
| `drinking` | 饮酒史 | 无 / 偶饮 / 常饮 |
| `familyHistory` | 家族史 | 多行文本 |
| `personalHabits` | 个人习惯 | 多行文本 |

空值在后台展示为「未采集」。API：`GET/PUT .../profile` 增加 `extension` 对象与 `adminOnlyFields` schema。

#### 4.3.3 来源日志（可选一期 / 必做接口形态）

最小一期：仅在 `patient_profile_fields.source` 记当前来源。  
二期可加 `patient_profile_field_events` 审计每次变更。规格要求：**接口与写入函数预留 source 参数**，避免抽取上线时再改契约。

#### 4.3.4 Schema 配置

挂在医生 `content.contactForm`（沿用现有动态表单机制）或独立 `content.patientProfileSchema`：

```json
{
  "title": "医患通患者档案",
  "fields": [
    { "key": "name", "label": "姓名", "type": "text", "required": true, "patientVisible": true },
    { "key": "gender", "label": "性别", "type": "radio", "required": true, "options": ["男","女"], "patientVisible": true },
    { "key": "birthDate", "label": "出生日期", "type": "date", "required": true, "patientVisible": true },
    { "key": "phone", "label": "手机号", "type": "tel", "required": true, "verifySms": true, "patientVisible": true },
    { "key": "idNumber", "label": "身份证号", "type": "text", "required": false, "patientVisible": true, "sensitive": true },
    { "key": "disease", "label": "您所患的疾病", "type": "radio", "required": true, "optionsFrom": "doctor.diseaseOptions", "patientVisible": true },
    { "key": "pregnancyStatus", "label": "是否妊娠哺乳", "type": "radio", "required": false,
      "options": ["否","备孕期","怀孕中","哺乳期"], "patientVisible": true },
    { "key": "foodContactAllergies", "label": "食物、接触物过敏", "type": "checkboxGroup", "required": false,
      "options": ["无","黄瓜","化妆品","芒果","花粉","牛奶","油漆","坚果","动物皮毛","海鲜","其他"],
      "noneValue": "无", "otherValue": "其他", "patientVisible": true },
    { "key": "drugAllergies", "label": "药物过敏", "type": "checkboxGroup", "required": false,
      "options": ["无","普鲁卡因","维生素B1","青霉素","破伤风抗毒素","地卡因","磺胺类药物","泛影葡胺","阿司匹林","其他"],
      "noneValue": "无", "otherValue": "其他", "patientVisible": true },
    { "key": "diseaseHistory", "label": "疾病史", "type": "checkboxGroup", "required": false,
      "options": ["无","高血压","过敏性疾病","哮喘","糖尿病","白癜风","心脏病","癫痫","其他"],
      "noneValue": "无", "otherValue": "其他", "patientVisible": true },
    { "key": "outpatientVoucher", "label": "请上传门诊凭证", "type": "file", "required": true,
      "accept": ["image/jpeg","image/png","image/webp","application/pdf"], "patientVisible": true }
  ],
  "adminOnlyFields": []
}
```

后台可通过同一 schema 渲染；`adminOnlyFields` / `patientVisible:false` 用于未来扩展字段。

### 4.4 提交与读路径

**写（患者提交联络表）：**

1. 校验 schema（必填、短信、多选互斥、文件存在）。
2. `resolvePatient` 收敛身份；更新 `real_name` / `phone` /（可选）`gender`/`birth_date`。
3. upsert `patient_profile_fields`（`source=patient`）。
4. 保存门诊凭证文件 → 关联 patient；插入 `patient_health_records`（见 §5.3）。
5. `submissions` 仍写一条 type=`联络表` 的 payload 快照（审计与旧「提交记录」页兼容）。

**读（后台档案）：**

- 列表：核心列 + 疾病摘要（来自 profile 或 submission）。
- 详情：合并 `patients` + profile_fields + health_records；标明各字段来源。

**写（医助手改）：** 同 upsert，`source=assistant`。  
**写（未来抽取）：** `source=extract`；与 patient 权威字段冲突时进入「待确认」，不直接覆盖姓名/手机。

## 5. 关键与模块落点

### 5.1 患者端

- `patient-uniapp` 联络表 / H5 动态表单：支持 `date`、`radio`、`checkboxGroup`、`file`。
- 上传走既有或新增 `/api/.../upload`（需鉴权/限流）；提交时带文件 id 或在 multipart 中完成。

### 5.2 后端

- 扩展 `/api/submit` 联络表校验与落库；或新增 `/api/patient/profile` 专端点（若上传与 JSON 混排更干净）——实现阶段二选一，**规格要求行为等价**。
- 管理端：`GET/PUT /api/admin/patients/:id/profile` 读写扩展字段。
- 疾病选项：医生内容配置 API / seed。

### 5.3 门诊凭证与健康记录

- 文件存 `public/uploads/patient-vouchers/`（或现有 uploads 规范目录）。
- 同步创建 `patient_health_records`：
  - `category`：建议 `health_checkup` 或新增 `outpatient_voucher`（若新增需扩 `HEALTH_RECORD_CATEGORIES`；**一期优先复用 `medical_certificate` 或 `health_checkup`，避免分类爆炸**——实现时在 plan 中二选一并写死）。
  - `title`：默认「门诊凭证」。
  - `attachments`：文件 URL 列表。
  - `source` 语义可通过 `created_by=patient` 表达。

### 5.4 后台 UI

- `admin-ui` 患者档案详情增加「基础档案」分区：11 项只读/可编辑。
- 列表可继续显示姓名、手机、疾病/主诉；性别、年龄可作次要列（非必须一期）。

## 6. 安全与合规

1. 继续 PIPL：敏感处理单独同意；短信验证门控建档。
2. 身份证：选填；库内可存全文但 API 默认掩码（如保留前 1 后 1）；仅授权角色可揭晓（若一期无揭晓需求，则始终掩码返回）。
3. 上传：类型/大小白名单；病毒扫描非一期；防路径穿越。
4. PII 掩码白名单随新字段 label/key 更新（`submitWhitelistForType`）。
5. 审计：联络表 submission + admin profile 更新记 `admin_audit`（若现网有对应 action）。

## 7. 迁移与兼容

1. 历史联络表 payload（姓名/手机/主要疾病）照常展示；打开详情时映射到新字段（疾病 → `disease`）。
2. 无性别/生日/过敏的老档案：后台显示空，不阻断服务。
3. 医生未配置疾病选项时：回退为文本输入（兼容），但产品默认应 seed 选项。
4. 旧「随访方案」字段：若医生 content 仍配置，可保留在表单底部或成功页引导；**不作为本规格 11 项之一**。

## 8. 测试要点

1. 11 项必填/选填校验；缺门诊凭证不可提交。
2. 短信验证失败不落档。
3. 过敏「无」与其它选项互斥；「其他」必填说明。
4. 提交后后台可见全部字段；文件可打开。
5. 两名医生疾病选项互不污染。
6. 医助手改 profile 后 source=assistant；患者再提交同字段以产品规则为准（**建议：患者提交覆盖非 extract 待确认项；姓名/手机仍走验证链路**）。
7. 旧数据列表不报错。

## 9. 实施分期建议

| 阶段 | 内容 |
|------|------|
| P0 | schema + 提交校验落库 + 上传 + 后台只读详情 |
| P1 | 后台可编辑 profile；疾病选项医生配置 UI |
| P2 | 扩展字段槽位 / 来源展示；抽取管道对接 |

## 10. 开放实现细节（不阻塞规格，计划阶段选定）

1. 门诊凭证的 `patient_health_records.category` 具体枚举值。
2. 上传接口独立 vs 并入 submit。
3. `gender`/`birth_date` 是否物理加列（推荐加）。

---

**规格自检：** 无 TBD 占位；11 项与腾讯文档一致；前后台分层与扩展路径明确；与现有联络表/健康记录边界无冲突；一期不做清单完整。
