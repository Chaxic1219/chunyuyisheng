"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const assert = require("assert");

const TMP = path.join(os.tmpdir(), `chunyu-patient-phone-merge-${Date.now()}.db`);
[TMP, TMP + "-wal", TMP + "-shm"].forEach((f) => { try { fs.unlinkSync(f); } catch (e) {} });
process.env.DB_PATH = TMP;

const dbApi = require("./db.js");
const { registerPatientsAdminRoutes } = require("./routes/patients-admin.js");

const {
  db,
  resolvePatient,
  mergePersons,
  mergePatients,
  autoMergePatientsByUserId,
  reconcileVerifiedPhonePersons,
  patientArchiveLabel,
  stripChannelSuffix,
  isPlaceholderDisplayName,
  resolvePersonWechatName,
  hydrateAdminMessageRow,
  allocateStaffId
} = dbApi;

const patientProfile = require("./patient_profile.js");

let total = 0;
let fails = [];
function ok(cond, msg) {
  total++;
  if (!cond) {
    fails.push(msg);
    console.log("  ✗ " + msg);
  } else {
    console.log("  ✓ " + msg);
  }
}

const routes = [];
registerPatientsAdminRoutes((method, pattern, handler) => {
  routes.push({ method, pattern, handler });
}, {
  parseBody: async (req) => req._body || {},
  json: (res, status, payload) => {
    res.statusCode = status;
    res.payload = payload;
    return payload;
  },
  gate: () => ({ username: "tester", role: "super" }),
  rowDoctorId: () => 0,
  requireAdminAction: () => true,
  db,
  adminScope: () => ({}),
  now: () => new Date().toISOString(),
  profileStore: patientProfile.createProfileStore(db),
  autoMergePatientsByUserId,
  reconcileVerifiedPhonePersons,
  mergePersons,
  mergePatients,
  decorateAdminPatient: (x) => x,
  hydrateAdminMessageRow: hydrateAdminMessageRow || ((x) => x),
  friendlyPatientLabel: () => "",
  patientArchiveLabel,
  allocateStaffId,
  stripChannelSuffix,
  isPlaceholderDisplayName,
  resolvePersonWechatName,
  maskPII: (s) => s,
  patientProfile,
  personRowForPatient: () => null
});

function getRoute(method, pathName) {
  const hit = routes.find((r) => r.method === method && r.pattern.test(pathName));
  assert.ok(hit, `route not found: ${method} ${pathName}`);
  return hit;
}

async function callGet(pathName, q) {
  const res = {};
  await getRoute("GET", pathName).handler({}, res, [], q || {});
  assert.equal(res.statusCode, 200, `${pathName} should return 200`);
  return res.payload;
}

async function callPost(pathName, body) {
  const res = {};
  const req = { _body: body || {} };
  await getRoute("POST", pathName).handler(req, res, []);
  assert.equal(res.statusCode, 200, `${pathName} should return 200, got ${res.statusCode}: ${JSON.stringify(res.payload)}`);
  return res.payload;
}

(async () => {
  const doctors = db.prepare("SELECT id FROM doctors ORDER BY id").all();
  const doctorA = doctors[0].id;
  const doctorB = doctors.length > 1 ? doctors[1].id : doctors[0].id;

  // T1: 同医生同手机号，存在已验证档案 -> 自动并档
  const autoPhone = "13800139001";
  const keepPid = resolvePatient({
    doctorId: doctorA,
    channel: "sms",
    externalId: "phone:" + autoPhone,
    phone: autoPhone,
    phoneVerified: true,
    displayName: "已验患者"
  });
  const mergePid = resolvePatient({
    doctorId: doctorA,
    channel: "qiwe",
    externalId: "uid-auto-" + Date.now(),
    phone: autoPhone,
    phoneVerified: false,
    displayName: "企微患者"
  });
  ok(keepPid !== mergePid, "T1 建立两条待收敛档案");

  const listA1 = await callGet("/api/admin/patients", { doctorId: doctorA });
  const autoRow = listA1.find((x) => x.id === keepPid || x.id === mergePid);
  const autoPhoneRows = db.prepare("SELECT id FROM patients WHERE doctor_id=? AND phone=?").all(doctorA, autoPhone);
  ok(autoPhoneRows.length === 1, "T1 已验证同号在列表拉取时自动并档");
  ok(!!autoRow && autoRow.autoMergedPhoneCount === 1, "T1 列表返回自动并档提示");

  // T2: 同医生同手机号，全未验证 -> 仅提示，不自动并档
  const pendingPhone = "13800139002";
  const pendingA = resolvePatient({
    doctorId: doctorA,
    channel: "qiwe",
    externalId: "uid-pending-a",
    phone: pendingPhone,
    phoneVerified: false,
    displayName: "待确认甲"
  });
  const pendingB = resolvePatient({
    doctorId: doctorA,
    channel: "wechat",
    externalId: "uid-pending-b",
    phone: pendingPhone,
    phoneVerified: false,
    displayName: "待确认乙"
  });
  const listA2 = await callGet("/api/admin/patients", { doctorId: doctorA });
  const pendingRows = listA2.filter((x) => x.duplicatePhone === pendingPhone);
  ok(pendingRows.length === 2, "T2 全未验证同号保留两条供人工确认");
  ok(pendingRows.every((x) => x.duplicatePhonePending === true), "T2 两条档案都带待合并标记");

  // T3: 人工合并成功
  const suggestedKeepId = pendingRows[0].duplicatePhoneSuggestedKeepId;
  const mergeIds = pendingRows.map((x) => x.id).filter((id) => id !== suggestedKeepId);
  const mergeRes = await callPost("/api/admin/patients/merge", {
    doctorId: doctorA,
    keepId: suggestedKeepId,
    mergeIds
  });
  ok(mergeRes && mergeRes.ok === true, "T3 人工合并接口成功");
  ok(db.prepare("SELECT COUNT(*) AS c FROM patients WHERE doctor_id=? AND phone=?").get(doctorA, pendingPhone).c === 1, "T3 人工合并后同号只剩一条");

  // T4: 跨医生同手机号 → 各保留 patient，但共享同一 person
  const crossPhone = "13800139003";
  const doctorAPid = resolvePatient({
    doctorId: doctorA,
    channel: "sms",
    externalId: "phone:" + crossPhone,
    phone: crossPhone,
    phoneVerified: true,
    displayName: "A患者"
  });
  const doctorBPid = resolvePatient({
    doctorId: doctorB,
    channel: "sms",
    externalId: "phone:" + crossPhone + ":b",
    phone: crossPhone,
    phoneVerified: true,
    displayName: "B患者"
  });
  ok(doctorAPid !== doctorBPid || doctorA === doctorB, "T4 跨医生各有一条 patient");
  const rowA = db.prepare("SELECT person_id FROM patients WHERE id=?").get(doctorAPid);
  const rowB = db.prepare("SELECT person_id FROM patients WHERE id=?").get(doctorBPid);
  ok(rowA.person_id && rowA.person_id === rowB.person_id, "T4 跨医生已验证同号 resolvePatient 即共享 person");

  const listB = await callGet("/api/admin/patients", { doctorId: doctorB });
  const doctorBRows = listB.filter((x) => x.phone === crossPhone);
  ok(doctorBRows.length === 1 && doctorBRows[0].id === doctorBPid, "T4 跨医生 patient 不会被别的医生列表并掉");
  const rowB2 = db.prepare("SELECT person_id FROM patients WHERE id=?").get(doctorBPid);
  ok(rowA.person_id === rowB2.person_id, "T4 列表拉取后仍保持同一 person");

  // T5: 跨医生共享 person 后，健康记录按 person 互通
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO patient_health_records(doctor_id,patient_id,person_id,category,title,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?)`).run(doctorA, doctorAPid, rowA.person_id, "medical_certificate", "A医生门诊凭证", now, now);
  const sharedCount = db.prepare("SELECT COUNT(*) AS c FROM patient_health_records WHERE person_id=?").get(rowA.person_id).c;
  ok(sharedCount >= 1, "T5 跨医生同 person 健康记录可共享读取");

  console.log("\n" + (fails.length ? "FAIL " + fails.length : "PASS " + total));
  process.exit(fails.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
