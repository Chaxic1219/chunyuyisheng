"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const TMP = path.join(os.tmpdir(), `chunyu-patient-archive-${Date.now()}.db`);
[TMP, TMP + "-wal", TMP + "-shm"].forEach((f) => { try { fs.unlinkSync(f); } catch (e) {} });
process.env.DB_PATH = TMP;
process.env.DB_FREEZE_EXISTING_DATA = "1";

const { db, preferDisplayName, mergePersons, patientArchive } = require("./db.js");

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

function seedDoctor() {
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO doctors(slug,name,title,hospital,dept,specialty,group_name,member_count,bots,clinic,accounts,content,intro,active)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,1)`).run(
    "t-archive", "测医生", "主任", "测医院", "测科", "专科", "测群", 0,
    "[]", "{}", "{}", "{}", "{}",
  );
  return db.prepare("SELECT id FROM doctors WHERE slug=?").get("t-archive").id;
}

function insertPatient(did, fields) {
  const now = new Date().toISOString();
  const info = db.prepare(`INSERT INTO patients(
    doctor_id, display_name, real_name, phone, phone_verified, notes, gender, birth_date,
    created_at, updated_at
  ) VALUES(?,?,?,?,?,?,?,?,?,?)`).run(
    did,
    fields.display_name || "",
    fields.real_name || "",
    fields.phone || "",
    fields.phone_verified ? 1 : 0,
    fields.notes || null,
    fields.gender || null,
    fields.birth_date || null,
    now, now
  );
  return info.lastInsertRowid;
}

const deps = { preferDisplayName, mergePersons };
const did = seedDoctor();

console.log("\n[patient_archive]");

const idA = insertPatient(did, {
  display_name: "邀请建档",
  real_name: "张三",
  phone: "13800138001",
  phone_verified: 1,
  notes: "邀请填写",
  gender: "男"
});
const idB = insertPatient(did, {
  display_name: "灿烂的阳光",
  real_name: "",
  phone: "",
  notes: "群聊发言",
  gender: "女"
});
db.prepare(`INSERT INTO message_log(doctor_id,patient_id,direction,text,created_at)
  VALUES(?,?,?,?,?)`).run(did, String(idB), "in", "你好", new Date().toISOString());

const preview = patientArchive.buildMergePreview(db, deps, did, idA, idB);
ok(preview.suggestedKeepId === idA, "预览建议保留已验证手机档");
ok(preview.defaultResolutions.real_name === "张三", "默认姓名取非空");
ok(preview.preview.displayName || preview.defaultResolutions.display_name, "预览有显示名");

const merged = patientArchive.softMergePatients(db, deps, {
  doctorId: did,
  keepId: idA,
  sourceId: idB,
  fieldResolutions: {
    display_name: "灿烂的阳光",
    real_name: "张三",
    notes: "邀请填写\n群聊发言"
  },
  createdBy: 1
});
ok(merged.ok && merged.opId, "软合并成功并写 ops");
const keepAfter = db.prepare("SELECT * FROM patients WHERE id=?").get(idA);
const srcAfter = db.prepare("SELECT * FROM patients WHERE id=?").get(idB);
ok(keepAfter.display_name === "灿烂的阳光", "字段决议写入保留档");
ok(!!srcAfter.archived_at, "源档软归档");
const msgMoved = db.prepare("SELECT patient_id FROM message_log WHERE doctor_id=? LIMIT 1").get(did);
ok(String(msgMoved.patient_id) === String(idA), "消息迁到保留档");

const bin = patientArchive.listRecycleBin(db, did);
ok(bin.length === 1 && bin[0].opType === "merge", "回收站可见合并项");

const undone = patientArchive.undoArchiveOp(db, deps, did, merged.opId);
ok(undone.ok, "撤销合并成功");
const srcRestored = db.prepare("SELECT * FROM patients WHERE id=?").get(idB);
const msgBack = db.prepare("SELECT patient_id FROM message_log WHERE doctor_id=? LIMIT 1").get(did);
ok(!srcRestored.archived_at, "源档恢复可见");
ok(String(msgBack.patient_id) === String(idB), "消息迁回源档");

const idC = insertPatient(did, { display_name: "待删", real_name: "李四", phone: "13900139000" });
const del = patientArchive.softDeletePatient(db, { doctorId: did, patientId: idC, createdBy: 1 });
ok(del.ok && del.opId, "软删除成功");
ok(!!db.prepare("SELECT archived_at FROM patients WHERE id=?").get(idC).archived_at, "删除后 archived_at 有值");
const bin2 = patientArchive.listRecycleBin(db, did);
ok(bin2.some((x) => x.opType === "delete"), "回收站可见删除项");
patientArchive.undoArchiveOp(db, deps, did, del.opId);
ok(!db.prepare("SELECT archived_at FROM patients WHERE id=?").get(idC).archived_at, "撤销删除恢复");

// 过期拒绝
const idD = insertPatient(did, { display_name: "过期测", phone: "13700137000" });
const del2 = patientArchive.softDeletePatient(db, { doctorId: did, patientId: idD, createdBy: 1 });
db.prepare("UPDATE patient_archive_ops SET expires_at=? WHERE id=?")
  .run(new Date(Date.now() - 1000).toISOString(), del2.opId);
let expiredOk = false;
try {
  patientArchive.undoArchiveOp(db, deps, did, del2.opId);
} catch (e) {
  expiredOk = /24|期限|过期|410/.test(String(e && e.message || e));
}
ok(expiredOk, "过期撤销被拒绝");

console.log(`\n${total - fails.length}/${total} passed`);
if (fails.length) {
  console.log("FAILED:\n" + fails.map((x) => " - " + x).join("\n"));
  process.exit(1);
}
process.exit(0);
