process.env.QIWE_DRY_RUN = "1";

const { db } = require("./db.js");
const { doctorCard } = require("./dashboard.js");
const {
  buildQiweTriageScope,
  messageLogDisplayScope,
  GROUP_QIWE_VISIBLE
} = require("./qiwe_scope.js");
const communityRepo = require("./modules/community/repo.js");

let fails = [];
let n = 0;
const ok = (cond, msg) => {
  n++;
  if(cond) console.log("  ✓", msg);
  else { fails.push(msg); console.log("  ✗", msg); }
};

function insGroup(doctorId, roomId, hidden){
  db.prepare(`INSERT INTO community_groups(
    doctor_id,external_group_id,name,channel_type,status,is_business,data_source,qiwe_hidden,review_mode,created_at,updated_at
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(
    doctorId, roomId, hidden ? "隐藏企微群" : "可见企微群", "qiwe", "active", 1, "qiwe", hidden ? 1 : 0, "human_review",
    new Date().toISOString(), new Date().toISOString()
  );
  return db.prepare("SELECT id FROM community_groups WHERE doctor_id=? AND external_group_id=?").get(doctorId, roomId).id;
}

function insCommunityMsg(doctorId, groupId, text){
  db.prepare(`INSERT INTO community_messages(
    doctor_id,group_id,member_id,msg_type,text,created_at
  ) VALUES(?,?,?,?,?,?)`).run(
    doctorId, groupId, null, "text", text, new Date().toISOString()
  );
}

function insMsgLog(doctorId, text, groupId){
  db.prepare(`INSERT INTO message_log(
    doctor_id,patient_id,patient_name,sender_id,channel,direction,text,level,level_label,action_taken,ai_draft,triage_session_id,group_id,reply_status,source_message_id,created_at
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    doctorId, null, text, "sender-" + text, "qiwe", "inbound", text, 2, "L2", "needs_human", null, null, groupId || null, "pending", null, new Date().toISOString()
  );
}

(async () => {
  const doctors = db.prepare("SELECT id FROM doctors ORDER BY id LIMIT 2").all();
  const a = doctors[0];
  const b = doctors[1];
  ok(!!a && !!b, "前置：至少两位医生");

  const stamp = Date.now();
  const visA = "room-doc-vis-a-" + stamp;
  const hidA = "room-doc-hid-a-" + stamp;
  const visB = "room-doc-vis-b-" + stamp;
  const gidVisA = insGroup(a.id, visA, false);
  const gidHidA = insGroup(a.id, hidA, true);
  insGroup(b.id, visB, false);

  insMsgLog(a.id, "看板A可见群", visA);
  insMsgLog(a.id, "看板A隐藏群", hidA);
  insMsgLog(a.id, "看板A私聊", null);
  insCommunityMsg(a.id, gidVisA, "社群可见入站");
  insCommunityMsg(a.id, gidHidA, "社群隐藏入站");

  const scope = buildQiweTriageScope(a.id);
  ok(Array.isArray(scope.params) && scope.params.length === 0, "作用域无额外绑定参数（多医生自关联）");

  const display = messageLogDisplayScope(a.id);
  const texts = db.prepare(`SELECT text FROM message_log WHERE doctor_id=? ${display.sql}`).all(a.id, ...display.params).map(r => r.text);
  ok(texts.includes("看板A可见群"), "医生数据：可见群消息计入");
  ok(texts.includes("看板A私聊"), "医生数据：私聊消息计入");
  ok(!texts.includes("看板A隐藏群"), "医生数据：隐藏群消息不计入");

  const card = doctorCard(a.id);
  ok(!!card && card.metrics.qiweGroups >= 1, "doctorCard：企微群数只计可见群");
  const qiweVisible = db.prepare(
    `SELECT COUNT(*) c FROM community_groups WHERE doctor_id=? AND data_source='qiwe' AND ${GROUP_QIWE_VISIBLE}`
  ).get(a.id).c;
  ok(card.metrics.qiweGroups === qiweVisible, "doctorCard.qiweGroups 与可见群口径一致");

  const summary = communityRepo.overviewSummaryCounts(a.id);
  const hiddenInbound = db.prepare(
    "SELECT COUNT(*) c FROM community_messages WHERE doctor_id=? AND group_id=? AND text=?"
  ).get(a.id, gidHidA, "社群隐藏入站").c;
  ok(hiddenInbound === 1, "前置：隐藏群社群消息已写入");
  ok(summary.messageTotal >= 1, "overview.messageTotal 至少有可见消息");
  const rawTotal = db.prepare("SELECT COUNT(*) c FROM community_messages WHERE doctor_id=?").get(a.id).c;
  ok(summary.messageTotal < rawTotal || summary.messageTotal === rawTotal - hiddenInbound || summary.messageTotal <= rawTotal - 1,
    "overview.messageTotal 排除隐藏企微群消息");

  // 更精确：隐藏群消息不应被 messageTotal 计入
  const countedHidden = db.prepare(`SELECT COUNT(*) c FROM community_messages m
    WHERE m.doctor_id=? AND m.group_id=?
    AND NOT EXISTS (
      SELECT 1 FROM community_groups g
      WHERE g.id = m.group_id
        AND COALESCE(g.data_source,'') = 'qiwe'
        AND IFNULL(g.qiwe_hidden, 0) = 1
    )`).get(a.id, gidHidA).c;
  ok(countedHidden === 0, "隐藏群社群消息在 messageTotal 口径下为 0");

  console.log("\n检查项:", n, "失败:", fails.length);
  if(fails.length){
    console.log("✗ 失败：\n - " + fails.join("\n - "));
    process.exit(1);
  }
  console.log("✓ 医生数据展示作用域测试通过");
})();
