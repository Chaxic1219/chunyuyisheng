/* 医患通患者档案：schema 默认值、多选校验、掩码、profile_fields 读写（Task 1 纯函数层） */

const FOOD_CONTACT_OPTIONS = ["无", "黄瓜", "化妆品", "芒果", "花粉", "牛奶", "油漆", "坚果", "动物皮毛", "海鲜", "其他"];
const DRUG_ALLERGY_OPTIONS = ["无", "普鲁卡因", "维生素B1", "青霉素", "破伤风抗毒素", "地卡因", "磺胺类药物", "泛影葡胺", "阿司匹林", "其他"];
const DISEASE_HISTORY_OPTIONS = ["无", "高血压", "过敏性疾病", "哮喘", "糖尿病", "白癜风", "心脏病", "癫痫", "其他"];
const PREGNANCY_OPTIONS = ["否", "备孕期", "怀孕中", "哺乳期"];
const PROFILE_SOURCES = new Set(["patient", "assistant", "extract", "system"]);

const PROFILE_FIELD_KEYS = new Set([
  // 2026-08-13：身份证号已从采集面下线（不写不采）；历史库行可读但不在此集合
  "disease", "pregnancyStatus",
  "foodContactAllergies", "drugAllergies", "diseaseHistory",
  // 后台扩展槽（患者联络表不可见）
  "heightCm", "weightKg", "bmi", "waistCm",
  "smoking", "drinking", "familyHistory", "personalHabits"
]);

const SMOKING_OPTIONS = ["无", "已戒", "仍吸"];
const DRINKING_OPTIONS = ["无", "偶饮", "常饮"];

/** 仅后台可见的扩展字段 schema（患者端不渲染） */
const ADMIN_ONLY_FIELDS = [
  { key: "heightCm", label: "身高(cm)", type: "number", placeholder: "未采集" },
  { key: "weightKg", label: "体重(kg)", type: "number", placeholder: "未采集" },
  { key: "bmi", label: "BMI", type: "computed", placeholder: "未采集", hint: "由身高体重自动计算" },
  { key: "waistCm", label: "腰围(cm)", type: "number", placeholder: "未采集" },
  { key: "smoking", label: "吸烟史", type: "select", options: SMOKING_OPTIONS, placeholder: "未采集" },
  { key: "drinking", label: "饮酒史", type: "select", options: DRINKING_OPTIONS, placeholder: "未采集" },
  { key: "familyHistory", label: "家族史", type: "textarea", placeholder: "未采集" },
  { key: "personalHabits", label: "个人习惯", type: "textarea", placeholder: "未采集" }
];

const ADMIN_ONLY_FIELD_KEYS = ADMIN_ONLY_FIELDS.map((f) => f.key);

function computeBmi(heightCm, weightKg) {
  const h = Number(heightCm);
  const w = Number(weightKg);
  if (!Number.isFinite(h) || !Number.isFinite(w) || h <= 0 || w <= 0) return "";
  const m = h / 100;
  if (m <= 0) return "";
  return (w / (m * m)).toFixed(1);
}

function emptyAdminExtension() {
  return {
    heightCm: "",
    weightKg: "",
    bmi: "",
    waistCm: "",
    smoking: "",
    drinking: "",
    familyHistory: "",
    personalHabits: ""
  };
}

function pickAdminExtension(fields) {
  const src = fields && typeof fields === "object" ? fields : {};
  const out = emptyAdminExtension();
  for (const key of ADMIN_ONLY_FIELD_KEYS) {
    if (src[key] != null && src[key] !== "") out[key] = String(src[key]);
  }
  if (!out.bmi && out.heightCm && out.weightKg) {
    out.bmi = computeBmi(out.heightCm, out.weightKg);
  }
  return out;
}

function validateAdminExtension(patch) {
  const p = patch && typeof patch === "object" ? patch : {};
  const errors = [];
  for (const key of ["heightCm", "weightKg", "waistCm"]) {
    if (!Object.prototype.hasOwnProperty.call(p, key)) continue;
    const raw = String(p[key] == null ? "" : p[key]).trim();
    if (!raw) continue;
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0 || n > 500) {
      const label = (ADMIN_ONLY_FIELDS.find((f) => f.key === key) || {}).label || key;
      errors.push(label + "数值无效");
    }
  }
  if (Object.prototype.hasOwnProperty.call(p, "smoking")) {
    const s = String(p.smoking == null ? "" : p.smoking).trim();
    if (s && !SMOKING_OPTIONS.includes(s)) errors.push("吸烟史选项无效");
  }
  if (Object.prototype.hasOwnProperty.call(p, "drinking")) {
    const s = String(p.drinking == null ? "" : p.drinking).trim();
    if (s && !DRINKING_OPTIONS.includes(s)) errors.push("饮酒史选项无效");
  }
  return errors;
}

const PAYLOAD_ALIASES = {
  name: ["name", "姓名"],
  gender: ["gender", "性别"],
  birthDate: ["birthDate", "出生日期"],
  phone: ["phone", "手机号"],
  idNumber: ["idNumber", "身份证号"],
  disease: ["disease", "您所患的疾病", "主要疾病"],
  pregnancyStatus: ["pregnancyStatus", "是否妊娠哺乳"],
  foodContactAllergies: ["foodContactAllergies", "食物、接触物过敏"],
  drugAllergies: ["drugAllergies", "药物过敏"],
  diseaseHistory: ["diseaseHistory", "疾病史"],
  outpatientVoucherUrl: ["outpatientVoucherUrl", "outpatientVoucher", "请上传门诊凭证"]
};

function checkboxGroupMeta(options) {
  return { options, noneValue: "无", otherValue: "其他" };
}

function defaultContactProfileFields(_diseaseOptions) {
  return [
    { key: "name", label: "姓名", type: "text", required: true, err: "请填写姓名" },
    { key: "gender", label: "性别", type: "select", required: true, options: ["男", "女"], err: "请选择性别" },
    { key: "birthDate", label: "出生日期", type: "date", required: true, err: "请填写出生日期" },
    { key: "phone", label: "手机号", type: "tel", required: true, pattern: "^1[3-9]\\d{9}$", err: "请输入正确手机号" },
    { key: "disease", label: "您所患的疾病", type: "text", required: true, placeholder: "请填写所患疾病", err: "请填写所患疾病" },
    { key: "pregnancyStatus", label: "是否妊娠哺乳", type: "select", required: false, options: PREGNANCY_OPTIONS },
    {
      key: "foodContactAllergies", label: "食物、接触物过敏", type: "checkboxGroup", required: false,
      ...checkboxGroupMeta(FOOD_CONTACT_OPTIONS)
    },
    {
      key: "drugAllergies", label: "药物过敏", type: "checkboxGroup", required: false,
      ...checkboxGroupMeta(DRUG_ALLERGY_OPTIONS)
    },
    {
      key: "diseaseHistory", label: "疾病史", type: "checkboxGroup", required: false,
      ...checkboxGroupMeta(DISEASE_HISTORY_OPTIONS)
    },
    {
      key: "outpatientVoucher", label: "门诊凭证（选填）", type: "file", required: false,
      accept: ["image/jpeg", "image/png", "image/webp", "application/pdf"],
      err: "请上传门诊凭证"
    }
  ];
}

function normalizeCheckboxGroup(raw, meta) {
  const noneValue = meta && meta.noneValue != null ? String(meta.noneValue) : "无";
  const otherValue = meta && meta.otherValue != null ? String(meta.otherValue) : "其他";
  const src = raw && typeof raw === "object" ? raw : {};
  let values = Array.isArray(src.values) ? src.values.map(String) : [];
  let other = src.other != null ? String(src.other) : "";

  if (values.includes(noneValue)) {
    return { values: [noneValue], other: "" };
  }
  if (!values.includes(otherValue)) {
    other = "";
  }
  return { values, other };
}

function validateCheckboxGroup(raw, meta) {
  const otherValue = meta && meta.otherValue != null ? String(meta.otherValue) : "其他";
  const normalized = normalizeCheckboxGroup(raw, meta);
  if (normalized.values.includes(otherValue) && !String(normalized.other || "").trim()) {
    return "请填写「其他」说明";
  }
  return null;
}

function maskIdNumber(id) {
  const s = String(id || "");
  if (s.length <= 1) return s;
  if (s.length === 2) return s[0] + "*";
  return s[0] + "*".repeat(s.length - 2) + s[s.length - 1];
}

function isLooseIdNumber(id) {
  const s = String(id || "").trim();
  if (!s) return true;
  if (/^\d{15}$/.test(s)) return true;
  if (/^\d{17}[\dXx]$/.test(s)) return true;
  return false;
}

function parseBirthDate(v) {
  const s = String(v || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(s + "T00:00:00");
  if (Number.isNaN(d.getTime())) return null;
  const [y, m, day] = s.split("-").map(Number);
  if (d.getFullYear() !== y || d.getMonth() + 1 !== m || d.getDate() !== day) return null;
  return s;
}

function encodeFieldValue(v) {
  if (v == null) return "";
  if (typeof v === "string") return v;
  return JSON.stringify(v);
}

function decodeFieldValue(raw) {
  if (raw == null || raw === "") return "";
  if (typeof raw !== "string") return raw;
  const t = raw.trim();
  if (!t) return "";
  if (t[0] === "{" || t[0] === "[") {
    try { return JSON.parse(t); } catch (e) { /* fall through */ }
  }
  return raw;
}

function parseCheckboxPayload(v) {
  if (v == null || v === "") return { values: [], other: "" };
  if (typeof v === "object" && !Array.isArray(v)) {
    return normalizeCheckboxGroup(v, { noneValue: "无", otherValue: "其他" });
  }
  if (typeof v === "string") {
    const t = v.trim();
    if (!t) return { values: [], other: "" };
    try {
      const parsed = JSON.parse(t);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return normalizeCheckboxGroup(parsed, { noneValue: "无", otherValue: "其他" });
      }
      if (Array.isArray(parsed)) return { values: parsed.map(String), other: "" };
    } catch (e) { /* fall through */ }
    if (t.includes("、")) return { values: t.split("、").map(s => s.trim()).filter(Boolean), other: "" };
    return { values: [t], other: "" };
  }
  if (Array.isArray(v)) return { values: v.map(String), other: "" };
  return { values: [], other: "" };
}

function pickPayloadValue(payload, key) {
  if (!payload || typeof payload !== "object") return undefined;
  const aliases = PAYLOAD_ALIASES[key] || [key];
  for (const k of aliases) {
    if (Object.prototype.hasOwnProperty.call(payload, k) && payload[k] != null && payload[k] !== "") {
      return payload[k];
    }
  }
  return undefined;
}

function extractProfileFromPayload(payload) {
  const p = payload && typeof payload === "object" ? payload : {};
  return {
    name: pickPayloadValue(p, "name") != null ? String(pickPayloadValue(p, "name")).trim() : "",
    gender: pickPayloadValue(p, "gender") != null ? String(pickPayloadValue(p, "gender")).trim() : "",
    birthDate: pickPayloadValue(p, "birthDate") != null ? String(pickPayloadValue(p, "birthDate")).trim() : "",
    phone: pickPayloadValue(p, "phone") != null ? String(pickPayloadValue(p, "phone")).trim() : "",
    idNumber: pickPayloadValue(p, "idNumber") != null ? String(pickPayloadValue(p, "idNumber")).trim() : "",
    disease: pickPayloadValue(p, "disease") != null ? String(pickPayloadValue(p, "disease")).trim() : "",
    pregnancyStatus: pickPayloadValue(p, "pregnancyStatus") != null ? String(pickPayloadValue(p, "pregnancyStatus")).trim() : "",
    foodContactAllergies: parseCheckboxPayload(pickPayloadValue(p, "foodContactAllergies")),
    drugAllergies: parseCheckboxPayload(pickPayloadValue(p, "drugAllergies")),
    diseaseHistory: parseCheckboxPayload(pickPayloadValue(p, "diseaseHistory")),
    outpatientVoucherUrl: pickPayloadValue(p, "outpatientVoucherUrl") != null
      ? String(pickPayloadValue(p, "outpatientVoucherUrl")).trim()
      : ""
  };
}

function validateContactProfile(extracted) {
  const e = extracted && typeof extracted === "object" ? extracted : {};
  const errors = [];

  if (!String(e.name || "").trim()) errors.push("请填写姓名");
  if (!["男", "女"].includes(String(e.gender || ""))) errors.push("请选择性别");
  if (!parseBirthDate(e.birthDate)) errors.push("请填写有效出生日期");
  if (!/^1[3-9]\d{9}$/.test(String(e.phone || ""))) errors.push("请输入正确手机号");
  // 身份证号已下线：旧客户端若仍提交，不校验、不阻断
  if (!String(e.disease || "").trim()) errors.push("请填写所患疾病");
  if (String(e.pregnancyStatus || "").trim() && !PREGNANCY_OPTIONS.includes(String(e.pregnancyStatus))) {
    errors.push("请选择有效的妊娠哺乳状态");
  }

  const foodMeta = checkboxGroupMeta(FOOD_CONTACT_OPTIONS);
  const drugMeta = checkboxGroupMeta(DRUG_ALLERGY_OPTIONS);
  const histMeta = checkboxGroupMeta(DISEASE_HISTORY_OPTIONS);

  const foodErr = validateCheckboxGroup(e.foodContactAllergies, foodMeta);
  if (foodErr) errors.push("食物、接触物过敏：" + foodErr);
  const drugErr = validateCheckboxGroup(e.drugAllergies, drugMeta);
  if (drugErr) errors.push("药物过敏：" + drugErr);
  const histErr = validateCheckboxGroup(e.diseaseHistory, histMeta);
  if (histErr) errors.push("疾病史：" + histErr);

  const voucherUrl = String(e.outpatientVoucherUrl || "").trim();
  if (voucherUrl && !/^\/api\/patient\/voucher\/[A-Za-z0-9_-]+$/.test(voucherUrl)) {
    errors.push("invalid_voucher_url");
  }

  return errors;
}

function isEmptyProfileValue(key, value) {
  if (value == null || value === "") return true;
  if (key === "foodContactAllergies" || key === "drugAllergies" || key === "diseaseHistory") {
    const g = normalizeCheckboxGroup(value, { noneValue: "无", otherValue: "其他" });
    return g.values.length === 0 && !String(g.other || "").trim();
  }
  return false;
}

function createProfileStore(db) {
  const upsertStmt = db.prepare(`
    INSERT INTO patient_profile_fields(doctor_id, patient_id, field_key, field_value, source, updated_by, updated_at)
    VALUES(?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(doctor_id, patient_id, field_key) DO UPDATE SET
      field_value = excluded.field_value,
      source = excluded.source,
      updated_by = excluded.updated_by,
      updated_at = excluded.updated_at
  `);
  const deleteStmt = db.prepare(`
    DELETE FROM patient_profile_fields
    WHERE doctor_id = ? AND patient_id = ? AND field_key = ?
  `);
  const readStmt = db.prepare(`
    SELECT field_key, field_value, source, updated_by, updated_at
    FROM patient_profile_fields
    WHERE doctor_id = ? AND patient_id = ?
  `);

  function runProfileTransaction(fn) {
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      db.exec("COMMIT");
      return result;
    } catch (e) {
      try { db.exec("ROLLBACK"); } catch (e2) { /* ignore */ }
      throw e;
    }
  }

  function upsertPersonFieldsInTransaction(personId, fieldsObj, source, updatedBy) {
    if (!PROFILE_SOURCES.has(source)) {
      throw new Error("invalid profile source: " + source);
    }
    const pid = +personId;
    if (!Number.isInteger(pid) || pid <= 0) throw new Error("personId 非法");
    const link = db.prepare("SELECT doctor_id, id FROM patients WHERE person_id=? ORDER BY id LIMIT 1").get(pid);
    if (!link) throw new Error("person 无关联患者行");
    const fields = fieldsObj && typeof fieldsObj === "object" ? fieldsObj : {};
    const now = new Date().toISOString();
    const readPersonStmt = db.prepare("SELECT id FROM patient_profile_fields WHERE person_id=? AND field_key=?");
    const updatePersonStmt = db.prepare(`
      UPDATE patient_profile_fields SET field_value=?, source=?, updated_by=?, updated_at=?
      WHERE person_id=? AND field_key=?
    `);
    const insertPersonStmt = db.prepare(`
      INSERT INTO patient_profile_fields(person_id, field_key, field_value, source, updated_by, updated_at, doctor_id, patient_id)
      VALUES(?,?,?,?,?,?,?,?)
    `);
    const deletePersonStmt = db.prepare("DELETE FROM patient_profile_fields WHERE person_id=? AND field_key=?");
    for (const key of PROFILE_FIELD_KEYS) {
      if (!Object.prototype.hasOwnProperty.call(fields, key)) continue;
      const raw = fields[key];
      if (isEmptyProfileValue(key, raw)) {
        deletePersonStmt.run(pid, key);
      } else {
        const encoded = encodeFieldValue(raw);
        const existing = readPersonStmt.get(pid, key);
        if (existing) {
          updatePersonStmt.run(encoded, source, updatedBy || null, now, pid, key);
        } else {
          insertPersonStmt.run(pid, key, encoded, source, updatedBy || null, now, link.doctor_id, link.id);
        }
      }
    }
  }

  function upsertPersonFields(personId, fieldsObj, source, updatedBy) {
    return runProfileTransaction(() =>
      upsertPersonFieldsInTransaction(personId, fieldsObj, source, updatedBy)
    );
  }

  function readPersonFields(personId) {
    const pid = +personId;
    if (!Number.isInteger(pid) || pid <= 0) return {};
    const rows = db.prepare(`
      SELECT field_key, field_value
      FROM patient_profile_fields
      WHERE person_id=?
    `).all(pid);
    const out = {};
    for (const row of rows) {
      out[row.field_key] = decodeFieldValue(row.field_value);
    }
    return out;
  }

  function upsertFieldsInTransaction(doctorId, patientId, fieldsObj, updatedBy, source) {
    const personId = db.prepare("SELECT person_id FROM patients WHERE id=?").get(+patientId);
    if (personId && personId.person_id) {
      return upsertPersonFieldsInTransaction(
        personId.person_id,
        fieldsObj,
        source,
        updatedBy
      );
    }
    if (!PROFILE_SOURCES.has(source)) {
      throw new Error("invalid profile source: " + source);
    }
    const fields = fieldsObj && typeof fieldsObj === "object" ? fieldsObj : {};
    const now = new Date().toISOString();
    for (const key of PROFILE_FIELD_KEYS) {
      if (!Object.prototype.hasOwnProperty.call(fields, key)) continue;
      const raw = fields[key];
      if (isEmptyProfileValue(key, raw)) {
        deleteStmt.run(doctorId, patientId, key);
      } else {
        upsertStmt.run(doctorId, patientId, key, encodeFieldValue(raw), source, updatedBy || null, now);
      }
    }
  }

  function upsertFields(doctorId, patientId, fieldsObj, source, updatedBy) {
    return runProfileTransaction(() =>
      upsertFieldsInTransaction(
        doctorId,
        patientId,
        fieldsObj,
        updatedBy,
        source
      )
    );
  }

  function readFields(doctorId, patientId) {
    const personId = db.prepare("SELECT person_id FROM patients WHERE id=?").get(+patientId);
    if (personId && personId.person_id) {
      return readPersonFields(personId.person_id);
    }
    const rows = readStmt.all(doctorId, patientId);
    const out = {};
    for (const row of rows) {
      out[row.field_key] = decodeFieldValue(row.field_value);
    }
    return out;
  }

  return {
    upsertFields,
    upsertFieldsInTransaction,
    readFields,
    upsertPersonFields,
    readPersonFields
  };
}

module.exports = {
  FOOD_CONTACT_OPTIONS,
  DRUG_ALLERGY_OPTIONS,
  DISEASE_HISTORY_OPTIONS,
  PREGNANCY_OPTIONS,
  SMOKING_OPTIONS,
  DRINKING_OPTIONS,
  ADMIN_ONLY_FIELDS,
  ADMIN_ONLY_FIELD_KEYS,
  PROFILE_SOURCES,
  defaultContactProfileFields,
  normalizeCheckboxGroup,
  validateCheckboxGroup,
  maskIdNumber,
  isLooseIdNumber,
  parseBirthDate,
  encodeFieldValue,
  decodeFieldValue,
  extractProfileFromPayload,
  validateContactProfile,
  computeBmi,
  emptyAdminExtension,
  pickAdminExtension,
  validateAdminExtension,
  createProfileStore
};
