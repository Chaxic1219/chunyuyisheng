/* 患者档案 PUT：手机号应写入 patients.phone（未验证档可改；已验证档拒绝） */
const os = require("os"), path = require("path"), fs = require("fs");
const TMP = path.join(os.tmpdir(), "chunyu_profile_phone_test.db");
[TMP, TMP + "-wal", TMP + "-shm"].forEach((f) => { try { fs.unlinkSync(f); } catch (e) {} });
process.env.DB_PATH = TMP;
const { db } = require("./db.js");
const patientProfile = require("./patient_profile.js");
const profileStore = patientProfile.createProfileStore(db);

function isPhone(phone) { return /^1[3-9]\d{9}$/.test(phone || ""); }

function applyProfilePut(patient, b) {
  let nextName = patient.real_name || "";
  let nextGender = patient.gender || "";
  let nextBirth = patient.birth_date || "";
  let nextPhone = patient.phone || "";
  let patientColsChanged = false;
  if (b.name != null) { nextName = String(b.name).trim().slice(0, 80); patientColsChanged = true; }
  if (b.gender != null) {
    const g = String(b.gender).trim();
    if (g && g !== "男" && g !== "女") throw new Error("性别无效");
    nextGender = g;
    patientColsChanged = true;
  }
  if (b.birthDate != null) {
    const raw = String(b.birthDate).trim();
    if (raw) {
      const parsed = patientProfile.parseBirthDate(raw);
      if (!parsed) throw new Error("出生日期无效");
      nextBirth = parsed;
    } else nextBirth = "";
    patientColsChanged = true;
  }
  if (Object.prototype.hasOwnProperty.call(b, "phone")) {
    if (patient.phone_verified) {
      const incoming = String(b.phone == null ? "" : b.phone).trim();
      const cur = String(patient.phone || "").trim();
      if (incoming !== cur) throw new Error("手机号已验证，不可修改");
    } else {
      const raw = String(b.phone == null ? "" : b.phone).trim();
      if (raw && !isPhone(raw)) throw new Error("手机号格式不正确");
      nextPhone = raw;
      patientColsChanged = true;
    }
  }
  if (patientColsChanged) {
    db.prepare("UPDATE patients SET real_name=?, gender=?, birth_date=?, phone=?, updated_at=? WHERE id=?")
      .run(nextName || null, nextGender || null, nextBirth || null, nextPhone || null, new Date().toISOString(), patient.id);
  }
}

let n = 0, fails = [];
const ok = (c, m) => { n++; if (!c) { fails.push(m); console.log("  ✗ " + m); } else console.log("  ✓ " + m); };

const did = db.prepare("SELECT id FROM doctors LIMIT 1").get().id;
const ins = db.prepare("INSERT INTO patients(doctor_id,display_name,phone,phone_verified,created_at,updated_at) VALUES(?,?,?,?,?,?)");
const pid = ins.run(did, "测试", "", 0, new Date().toISOString(), new Date().toISOString()).lastInsertRowid;
let patient = db.prepare("SELECT * FROM patients WHERE id=?").get(pid);

applyProfilePut(patient, { phone: "13800138000" });
patient = db.prepare("SELECT * FROM patients WHERE id=?").get(pid);
ok(patient.phone === "13800138000", "仅改手机号 → patients.phone 持久化");

applyProfilePut(patient, { name: "张三", phone: "13900139000" });
patient = db.prepare("SELECT * FROM patients WHERE id=?").get(pid);
ok(patient.real_name === "张三" && patient.phone === "13900139000", "姓名+手机号同时更新");

db.prepare("UPDATE patients SET phone_verified=1 WHERE id=?").run(pid);
patient = db.prepare("SELECT * FROM patients WHERE id=?").get(pid);
let blocked = false;
try { applyProfilePut(patient, { phone: "13700137000" }); } catch (e) { blocked = /不可修改/.test(e.message); }
ok(blocked, "已验证手机号 → 拒绝修改");

const doctors = db.prepare("SELECT id FROM doctors ORDER BY id LIMIT 2").all();
const doctorA = doctors[0].id;
const doctorB = doctors[1] ? doctors[1].id : doctors[0].id;
const anchorNow = new Date().toISOString();
const personId = Number(db.prepare(
  `INSERT INTO persons(real_name,created_at,updated_at)
   VALUES(?,?,?)`
).run("事务锚点患者", anchorNow, anchorNow).lastInsertRowid);
const anchorPatientId = Number(db.prepare(
  `INSERT INTO patients(
    doctor_id,person_id,display_name,tags,follow_stage,notes,created_at,updated_at
  ) VALUES(?,?,?,?,?,?,?,?)`
).run(
  doctorA,
  personId,
  "最早关联患者",
  "[]",
  "",
  "",
  anchorNow,
  anchorNow
).lastInsertRowid);
const laterPatientId = Number(db.prepare(
  `INSERT INTO patients(
    doctor_id,person_id,display_name,tags,follow_stage,notes,created_at,updated_at
  ) VALUES(?,?,?,?,?,?,?,?)`
).run(
  doctorB,
  personId,
  "后关联患者",
  "[]",
  "",
  "",
  anchorNow,
  anchorNow
).lastInsertRowid);

const canonicalFields = {
  disease: "canonical disease",
  drugAllergies: { values:["青霉素"], other:"" },
  unsupportedInviteField: "must be ignored"
};
profileStore.upsertFields(
  doctorB,
  laterPatientId,
  canonicalFields,
  "patient",
  "same-updater"
);
const canonicalRows = db.prepare(
  `SELECT person_id,doctor_id,patient_id,field_key,field_value,source,updated_by
   FROM patient_profile_fields
   WHERE person_id=?
   ORDER BY field_key`
).all(personId);
ok(
  canonicalRows.length === 2
    && canonicalRows.every((row) =>
      +row.person_id === personId
      && +row.doctor_id === doctorA
      && +row.patient_id === anchorPatientId
    ),
  "canonical upsert 使用同一 person 的最早关联患者作为锚点"
);

db.prepare("DELETE FROM patient_profile_fields WHERE person_id=?").run(personId);
ok(
  typeof profileStore.upsertFieldsInTransaction === "function",
  "profile store 暴露无嵌套事务的 canonical upsert"
);
if(typeof profileStore.upsertFieldsInTransaction === "function"){
  db.exec("BEGIN IMMEDIATE");
  try {
    profileStore.upsertFieldsInTransaction(
      doctorB,
      laterPatientId,
      canonicalFields,
      "same-updater",
      "patient"
    );
    db.exec("COMMIT");
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch (_rollbackError) {}
    throw error;
  }
  const transactionRows = db.prepare(
    `SELECT person_id,doctor_id,patient_id,field_key,field_value,source,updated_by
     FROM patient_profile_fields
     WHERE person_id=?
     ORDER BY field_key`
  ).all(personId);
  ok(
    JSON.stringify(transactionRows) === JSON.stringify(canonicalRows),
    "事务内 upsert 与 canonical upsert 的锚点、编码和元数据一致"
  );
  ok(
    !transactionRows.some((row) => row.field_key === "unsupportedInviteField"),
    "事务内 upsert 与 canonical upsert 一致忽略未知字段"
  );

  let canonicalSourceError = "";
  let transactionSourceError = "";
  try {
    profileStore.upsertFields(
      doctorB,
      laterPatientId,
      { disease:"invalid source" },
      "not-a-source",
      "tester"
    );
  } catch (error) {
    canonicalSourceError = error.message;
  }
  try {
    profileStore.upsertFieldsInTransaction(
      doctorB,
      laterPatientId,
      { disease:"invalid source" },
      "tester",
      "not-a-source"
    );
  } catch (error) {
    transactionSourceError = error.message;
  }
  ok(
    canonicalSourceError === "invalid profile source: not-a-source"
      && transactionSourceError === canonicalSourceError,
    "事务内 upsert 与 canonical upsert 的非法 source 处理一致"
  );
}

console.log("\n" + (fails.length ? "FAIL " + fails.length : "PASS " + n));
process.exit(fails.length ? 1 : 0);
