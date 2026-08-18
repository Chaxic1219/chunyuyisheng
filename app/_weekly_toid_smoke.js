"use strict";
/**
 * 周五科普 toId 冒烟：生成草稿必须带群 roomId；旧草稿发送时可回填。
 */
process.env.QIWE_DRY_RUN = process.env.QIWE_DRY_RUN || "1";
process.env.AGENT_DRY_RUN = process.env.AGENT_DRY_RUN || "1";
process.env.TRIAGE_AI_DISABLED = process.env.TRIAGE_AI_DISABLED || "1";

const { db } = require("./db.js");
const community = require("./community.js");
const outbox = require("./modules/outbox");

let failed = 0;
function ok(cond, msg){
  if(cond) console.log("  ✓", msg);
  else { console.log("  ✗", msg); failed++; }
}

(async ()=>{
  console.log("== weekly toId smoke ==");
  const doctor = db.prepare("SELECT id FROM doctors WHERE slug='lvfujing' AND active=1").get()
    || db.prepare("SELECT id FROM doctors WHERE active=1 ORDER BY id LIMIT 1").get();
  if(!doctor) throw new Error("无 active 医生");
  const did = doctor.id;
  const now = new Date().toISOString();
  const ext = "smoke-room-" + Date.now();
  const gid = db.prepare(`INSERT INTO community_groups(
    doctor_id,channel_type,external_group_id,name,owner,member_count,status,
    welcome_enabled,welcome_text,auto_reply_enabled,review_mode,notes,created_at,updated_at,is_business
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)`).run(
    did, "qiwe", ext, "周五科普冒烟群", "医助", 0, "active",
    0, "", 1, "human_review", "smoke", now, now
  ).lastInsertRowid;

  const draft = community.createWeeklyCampaign({ doctorId:did, groupId:gid, topic:"冒烟主题" });
  ok(draft && draft.status === "pending", "生成 pending 周五科普草稿");
  const row = db.prepare("SELECT * FROM outbound_queue WHERE id=?").get(draft.id);
  let payload = {};
  try{ payload = JSON.parse(row.payload || "{}"); }catch(e){}
  ok(payload.qiwe && payload.qiwe.toId === ext, "新草稿 payload.qiwe.toId = external_group_id");
  ok(payload.qiwe && payload.qiwe.needAtAll === true, "新草稿带 needAtAll");

  // 旧草稿：故意不写 toId
  const oldId = db.prepare(`INSERT INTO outbound_queue(
    doctor_id,group_id,message_id,target_type,target_name,channel_type,text,payload,
    status,source,priority,created_at,sent_at,sent_by,data_source
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    did, gid, null, "group", "周五科普冒烟群", "qiwe", "@所有人\n旧稿",
    JSON.stringify({ eventType:"weekly_ops", qiwe:{ needAtAll:true } }),
    "pending", "weekly_ops", "normal", now, null, null, "qiwe"
  ).lastInsertRowid;
  const sent = await outbox.setOutboxStatus(oldId, "sent", "smoke");
  const after = db.prepare("SELECT status,sent_mode,payload FROM outbound_queue WHERE id=?").get(oldId);
  let afterPayload = {};
  try{ afterPayload = JSON.parse(after.payload || "{}"); }catch(e){}
  ok(sent.status === "sent" && after.sent_mode === "real", "旧草稿发送：回填 toId 后真发(real)");
  ok(afterPayload.qiwe && afterPayload.qiwe.toId === ext, "旧草稿发送后 payload 已回填 toId");

  if(failed){
    console.error(`FAIL ${failed}`);
    process.exit(1);
  }
  console.log("OK weekly toId smoke");
})().catch((e)=>{
  console.error(e);
  process.exit(1);
});
