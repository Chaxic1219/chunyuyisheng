/* 全局患者主档：跨医生合并认微信名称 */

const os = require("os"), path = require("path"), fs = require("fs");

const TMP = path.join(os.tmpdir(), "chunyu_global_person_test.db");

[TMP, TMP + "-wal", TMP + "-shm"].forEach((f) => { try { fs.unlinkSync(f); } catch (e) {} });

process.env.DB_PATH = TMP;

const { db, resolvePatient, mergePersons } = require("./db.js");

const patientProfile = require("./patient_profile.js");



const WECHAT_NAME = "王先生+胃炎";

const UID_A = "7881301249033516";

const UID_B = "8992412350144627";



let n = 0, fails = [];

const ok = (c, m) => { n++; if (!c) { fails.push(m); console.log("  ✗ " + m); } else console.log("  ✓ " + m); };



const doctors = db.prepare("SELECT id FROM doctors ORDER BY id").all();

const dA = doctors[0].id;

const dB = doctors.length > 1 ? doctors[doctors.length - 1].id : doctors[0].id;



// T1: 跨医生同微信名、不同 userId → 同一 person

const pA = resolvePatient({ doctorId: dA, channel: "qiwe", externalId: UID_A, displayName: WECHAT_NAME });

const pB = resolvePatient({ doctorId: dB, channel: "qiwe", externalId: UID_B, displayName: WECHAT_NAME });

const rowA = db.prepare("SELECT person_id FROM patients WHERE id=?").get(pA);

const rowB = db.prepare("SELECT person_id FROM patients WHERE id=?").get(pB);

ok(rowA.person_id && rowA.person_id === rowB.person_id, "T1 跨医生同微信名不同 userId → 同一 person_id");

ok(db.prepare("SELECT wechat_group_name FROM persons WHERE id=?").get(rowA.person_id).wechat_group_name === WECHAT_NAME, "T1 persons.wechat_group_name 已写入");



// 档案 real_name 不同也不影响合并键

db.prepare("UPDATE patients SET real_name=? WHERE id=?").run("张三", pB);

const pC = resolvePatient({ doctorId: dB, channel: "qiwe", externalId: UID_B, displayName: WECHAT_NAME, realName: "李四" });

ok(db.prepare("SELECT person_id FROM patients WHERE id=?").get(pC).person_id === rowA.person_id, "T1b 档案姓名不同仍按微信名合并");



const store = patientProfile.createProfileStore(db);

store.upsertPersonFields(rowA.person_id, {

  drugAllergies: { values: ["青霉素"], other: "" }

}, "assistant", "test");

const fieldsB = store.readPersonFields(rowB.person_id);

ok(fieldsB.drugAllergies && fieldsB.drugAllergies.values.includes("青霉素"), "T1 A 写过敏 B 可读");



// 同号不同微信名不合并

const phA = resolvePatient({ doctorId: dA, channel: "sms", externalId: "phone:13800001001", phone: "13800001001", phoneVerified: true, displayName: "甲" });

const phB = resolvePatient({ doctorId: dB, channel: "sms", externalId: "phone:13800001001", phone: "13800001001", phoneVerified: true, displayName: "乙" });

const phRowA = db.prepare("SELECT person_id FROM patients WHERE id=?").get(phA);

const phRowB = db.prepare("SELECT person_id FROM patients WHERE id=?").get(phB);

ok(phRowA.person_id === phRowB.person_id, "已验证同号跨医生 → 共享同一 person_id");



// T3: 不同微信名 → 不同 person

const u1 = resolvePatient({ doctorId: dA, channel: "wecom", externalId: "u-unv-1", displayName: "群友A" });

const u2 = resolvePatient({ doctorId: dB, channel: "wecom", externalId: "u-unv-2", displayName: "群友B" });

ok(db.prepare("SELECT person_id FROM patients WHERE id=?").get(u1).person_id

  !== db.prepare("SELECT person_id FROM patients WHERE id=?").get(u2).person_id, "T3 不同微信名 → 不同 person");



// T5: 健康记录

const now = new Date().toISOString();

db.prepare(`INSERT INTO patient_health_records(doctor_id,patient_id,person_id,category,title,created_at,updated_at)

  VALUES(?,?,?,?,?,?,?)`).run(dA, pA, rowA.person_id, "medical_certificate", "门诊凭证", now, now);

ok(db.prepare("SELECT COUNT(*) c FROM patient_health_records WHERE person_id=?").get(rowA.person_id).c >= 1, "T5 健康记录按 person_id");



// T4: 已验证手机号被另一 person 占用时，企微挂档不得因 UNIQUE persons.phone 抛死
const verifiedPid = resolvePatient({
  doctorId: dA, channel: "sms", externalId: "phone:13900001111",
  phone: "13900001111", phoneVerified: true, displayName: "已验"
});
const qiwePid = resolvePatient({
  doctorId: dB, channel: "qiwe", externalId: "1688856409808606", displayName: "医生助手"
});
ok(verifiedPid && qiwePid, "T4 预置已验号 + 企微成员");
let uniqueThrew = false;
try {
  resolvePatient({
    doctorId: dB, channel: "qiwe", externalId: "1688856409808606",
    displayName: "医生助手", phone: "13900001111", phoneVerified: true
  });
} catch (e) {
  uniqueThrew = /UNIQUE constraint failed: persons\.phone/i.test(String(e && e.message || ""));
  if (!uniqueThrew) throw e;
}
ok(!uniqueThrew, "T4 同号 UNIQUE 不得抛出 persons.phone");

console.log("\n" + (fails.length ? "FAIL " + fails.length : "PASS " + n));

process.exit(fails.length ? 1 : 0);

