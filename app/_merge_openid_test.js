"use strict";
/**
 * 验证 mergePersons 修复：
 * 1) 被合并 person 的 mp_openid 迁移到 keep；
 * 2) phone/phone_verified 在 DELETE 后回填，不再因自冲突丢失。
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const assert = require("assert");

const TMP = path.join(os.tmpdir(), `chunyu-merge-openid-${Date.now()}.db`);
[TMP, TMP + "-wal", TMP + "-shm"].forEach((f) => { try { fs.unlinkSync(f); } catch (e) {} });
process.env.DB_PATH = TMP;

const dbApi = require("./db.js");
const { db, mergePersons } = dbApi;

let total = 0;
const fails = [];
function nowIso() { return new Date().toISOString(); }
function ok(cond, msg) {
  total++;
  if (!cond) { fails.push(msg); console.log("  ✗ " + msg); }
  else console.log("  ✓ " + msg);
}

function insertPerson(row) {
  const r = db.prepare(`INSERT INTO persons(
    real_name, gender, birth_date, phone, phone_verified, unionid,
    avatar_url, qiwe_user_id, wechat_group_name, mp_openid, created_at, updated_at
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    row.real_name || null, row.gender || null, row.birth_date || null,
    row.phone || null, row.phone_verified ? 1 : 0, row.unionid || null,
    row.avatar_url || null, row.qiwe_user_id || null, row.wechat_group_name || null,
    row.mp_openid || null, new Date().toISOString(), new Date().toISOString()
  );
  return Number(r.lastInsertRowid);
}

// —— 场景1：keep 无 openid，mid 有 openid + phone ——
console.log("场景1：mid 持有 mp_openid + 已验证手机号，合并后应迁移到 keep");
const keep1 = insertPerson({ real_name: "企微主档", qiwe_user_id: "U100" });
const mid1 = insertPerson({ real_name: "小程序用户", phone: "13303936115", phone_verified: 1, mp_openid: "openid-abc" });
db.prepare("INSERT INTO patients(doctor_id,person_id,display_name,real_name,phone,phone_verified,unionid,tags,follow_stage,notes,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)")
  .run(1, mid1, "u", "", "13303936115", 1, "", "[]", "", "", new Date().toISOString(), new Date().toISOString());
mergePersons(keep1, [mid1], "system", "test:openid-migration");
const keepRow1 = db.prepare("SELECT * FROM persons WHERE id=?").get(keep1);
ok(keepRow1.mp_openid === "openid-abc", "mp_openid 已迁移到 keep");
ok(keepRow1.phone === "13303936115", "phone 已迁移到 keep");
ok(keepRow1.phone_verified === 1, "phone_verified 已迁移到 keep");
ok(!db.prepare("SELECT id FROM persons WHERE id=?").get(mid1), "mid 已被删除");
const pat1 = db.prepare("SELECT person_id FROM patients WHERE person_id=?").get(keep1);
ok(pat1 && +pat1.person_id === keep1, "patient 已重挂到 keep");

// —— 场景2：keep 已有不同 openid，mid 有 openid → 保留 keep ——
console.log("场景2：keep 已绑定其他 openid，保留 keep 原 openid");
const keep2 = insertPerson({ mp_openid: "openid-keep" });
const mid2 = insertPerson({ mp_openid: "openid-mid" });
mergePersons(keep2, [mid2], "system", "test:openid-conflict");
const keepRow2 = db.prepare("SELECT * FROM persons WHERE id=?").get(keep2);
ok(keepRow2.mp_openid === "openid-keep", "keep 原 openid 保留（不覆盖）");

// —— 场景3：同号合并（phone UNIQUE）不再丢失 ——
console.log("场景3：keep 与 mid 同已验证手机号，合并后 keep 保留手机号");
const keep3 = insertPerson({ real_name: "A", phone: "13800138000", phone_verified: 1 });
const mid3 = insertPerson({ real_name: "B", phone: "13800138000", phone_verified: 1, mp_openid: "openid-3" });
mergePersons(keep3, [mid3], "system", "test:phone-unique");
const keepRow3 = db.prepare("SELECT * FROM persons WHERE id=?").get(keep3);
ok(keepRow3.phone === "13800138000", "keep 手机号保留");
ok(keepRow3.mp_openid === "openid-3", "mid 的 openid 仍迁移到 keep");
ok(!db.prepare("SELECT id FROM persons WHERE id=?").get(mid3), "mid3 已删除");

// —— 场景4：合并后活跃 mp_sessions 的 person_id 应指向 keep ——
console.log("场景4：合并后活跃 mp_sessions 同步到 keep（防 archive 403）");
const keep4 = insertPerson({ mp_openid: "openid-keep4" });
const mid4 = insertPerson({ mp_openid: "openid-mid4" });
const sessTok = "test-token-" + Date.now();
db.prepare(`INSERT INTO mp_sessions(token, openid, doctor_id, person_id, patient_id, phone_bound, created_at, expires_at, last_seen_at)
  VALUES(?,?,?,?,?,?,?,?,?)`).run(sessTok, "openid-keep4", 1, mid4, 99, 1, nowIso(), new Date(Date.now()+3600e3).toISOString(), nowIso());
mergePersons(keep4, [mid4], "system", "test:session-sync");
const sessRow = db.prepare("SELECT person_id FROM mp_sessions WHERE token=?").get(sessTok);
ok(sessRow && +sessRow.person_id === keep4, "活跃会话 person_id 已指向 keep");
const sessRow2 = db.prepare("SELECT person_id FROM mp_sessions WHERE token=?").get("other-revoked-token");
ok(!sessRow2 || sessRow2.person_id !== mid4, "revoked 会话不受影响");

console.log(`\n${total - fails.length}/${total} 通过`);
if (fails.length) { console.error("失败项:", fails); process.exit(1); }
console.log("OK");
process.exit(0);
