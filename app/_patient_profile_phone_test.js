/* 患者档案 PUT：手机号应写入 patients.phone（未验证档可改；已验证档拒绝） */
const os = require("os"), path = require("path"), fs = require("fs");
const TMP = path.join(os.tmpdir(), "chunyu_profile_phone_test.db");
[TMP, TMP + "-wal", TMP + "-shm"].forEach((f) => { try { fs.unlinkSync(f); } catch (e) {} });
process.env.DB_PATH = TMP;
const { db } = require("./db.js");
const patientProfile = require("./patient_profile.js");

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

const extraEmpty = patientProfile.extraProfileFields({
  bloodType: "",
  heightCm: "",
  weightKg: "",
  healthNotes: "",
});
ok(Object.keys(extraEmpty).length === 0, "空扩展字段不覆盖已有档案");
const extraFilled = patientProfile.extraProfileFields({
  bloodType: "O型",
  heightCm: "168",
  weightKg: "55",
  healthNotes: "备注",
});
ok(extraFilled.bloodType === "O型" && extraFilled.bmi === "19.5" && extraFilled.healthNotes === "备注", "身高体重计算 BMI");

console.log("\n" + (fails.length ? "FAIL " + fails.length : "PASS " + n));
process.exit(fails.length ? 1 : 0);
