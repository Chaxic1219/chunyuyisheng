"use strict";

const { db } = require("./db.js");
const {
  messageLogTriageDoctorWhere,
  MSGLOG_VISIBLE_IN_TRIAGE,
  buildQiweTriageScope,
  isQiweDmRow,
  messageLogChannelFilterSql
} = require("./qiwe_scope.js");

let fails = [];
const ok = (cond, msg) => {
  if (cond) console.log("  ✓", msg);
  else { fails.push(msg); console.log("  ✗", msg); }
};

const doctors = db.prepare("SELECT id FROM doctors ORDER BY id LIMIT 2").all();
const a = doctors[0];
const b = doctors[1];
ok(!!a && !!b, "至少两位医生");

const stamp = Date.now();
const ins = db.prepare(`INSERT INTO message_log(
  doctor_id,patient_id,patient_name,sender_id,channel,direction,text,level,level_label,action_taken,group_id,reply_status,created_at
) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`);

ins.run(a.id, null, "A私聊", "dm-user-" + stamp, "qiwe", "inbound", "A私聊", 2, "L2", "needs_human", null, "pending", new Date().toISOString());
ins.run(b.id, null, "B私聊", "dm-user-b-" + stamp, "qiwe", "inbound", "B私聊", 2, "L2", "needs_human", null, "pending", new Date().toISOString());
ins.run(b.id, null, "B群", "grp-user-" + stamp, "qiwe", "inbound", "B群", 2, "L2", "needs_human", "room-" + stamp, "pending", new Date().toISOString());

const scopeA = buildQiweTriageScope(a.id);
const rowsA = db.prepare(
  `SELECT text FROM message_log WHERE ${messageLogTriageDoctorWhere()} ${MSGLOG_VISIBLE_IN_TRIAGE} ${scopeA.sql} ORDER BY id`
).all(a.id, ...scopeA.params).map(r => r.text);
ok(rowsA.includes("A私聊"), "医生A可见自己的私聊");
ok(rowsA.includes("B私聊"), "医生A可见医生B的私聊");
ok(!rowsA.includes("B群"), "医生A不可见医生B的群消息");

const dmOnly = db.prepare(
  `SELECT text FROM message_log WHERE ${messageLogTriageDoctorWhere()} ${MSGLOG_VISIBLE_IN_TRIAGE} ${scopeA.sql} ${messageLogChannelFilterSql("dm")} ORDER BY id`
).all(a.id, ...scopeA.params).map(r => r.text);
ok(dmOnly.includes("A私聊") && dmOnly.includes("B私聊") && !dmOnly.includes("B群"), "channel=dm 仅私聊");

ok(isQiweDmRow({ channel: "qiwe", group_id: null }), "isQiweDmRow 识别私聊");

if (fails.length) {
  console.error("\n失败:", fails.join("; "));
  process.exit(1);
}
console.log("✓ 企微私聊分诊作用域自测通过");
