process.env.QIWE_DRY_RUN = "1";

const { db } = require("./db.js");
const qiwe = require("./qiwe.js");
const qiweShared = require("./modules/qiwe/shared.js");
const messagesAdmin = require("./routes/messages-admin.js");

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
}

function insMsg(doctorId, text, groupId){
  db.prepare(`INSERT INTO message_log(
    doctor_id,patient_id,patient_name,sender_id,channel,direction,text,level,level_label,action_taken,ai_draft,triage_session_id,group_id,reply_status,source_message_id,created_at
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    doctorId, null, text, "sender-" + text, "qiwe", "inbound", text, 2, "L2", "needs_human", null, null, groupId || null, "pending", null, new Date().toISOString()
  );
}

(async () => {
  const doctors = db.prepare("SELECT id FROM doctors ORDER BY id LIMIT 2").all();
  const active = doctors[0];
  const other = doctors[1];
  ok(!!active && !!other, "前置：测试库中至少有两位医生");

  db.prepare("DELETE FROM qiwe_configs").run();
  db.prepare(`INSERT INTO qiwe_configs(
    doctor_id,token,guid,self_user_id,test_to_id,callback_secret,api_url,enabled,auto_send,allow_group,note,updated_at
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    active && active.id, "seed-token", "seed-guid", "self-user-1", "self-user-1", "", "http://manager.qiweapi.com/qiwe/api/qw/doApi",
    1, 1, 1, "seed", new Date().toISOString()
  );

  qiwe.saveConfig({
    token: "test-token-123456",
    guid: "test-guid-123456",
    selfUserId: "self-user-1",
    testToId: "self-user-1,room-scope-vis",
    enabled: true,
    autoSend: true,
    allowGroup: true
  });

  ok(typeof qiweShared.currentQiweDoctorId === "function", "导出 currentQiweDoctorId");
  ok(typeof qiweShared.resolveDirectDoctorId === "function", "导出 resolveDirectDoctorId");
  ok(typeof messagesAdmin.buildQiweTriageScope === "function", "导出 buildQiweTriageScope");

  if(active && other && typeof messagesAdmin.buildQiweTriageScope === "function"){
    // 配置仍挂医生 A，但医生 B 也有当前账号可见群 —— 无需改绑即可在 B 的分诊台看到
    const visA = "room-scope-vis-a-" + Date.now();
    const hidA = "room-scope-hide-a-" + Date.now();
    const visB = "room-scope-vis-b-" + Date.now();
    insGroup(active.id, visA, false);
    insGroup(active.id, hidA, true);
    insGroup(other.id, visB, false);

    insMsg(active.id, "医生A私聊", null);
    insMsg(other.id, "医生B私聊", null);
    insMsg(active.id, "医生A可见群", visA);
    insMsg(active.id, "医生A隐藏群", hidA);
    insMsg(other.id, "医生B可见群", visB);

    const scopeA = messagesAdmin.buildQiweTriageScope(active.id);
    const rowsA = db.prepare(`SELECT text FROM message_log WHERE doctor_id=? ${scopeA.sql} ORDER BY id`).all(active.id, ...scopeA.params);
    const textsA = rowsA.map(r => r.text);
    ok(textsA.includes("医生A私聊"), "医生A视角：本医生 QiWe 私聊可见（无需二次绑定）");
    ok(textsA.includes("医生A可见群"), "医生A视角：本医生可见企微群消息可见");
    ok(!textsA.includes("医生A隐藏群"), "医生A视角：隐藏旧群消息不可见");
    ok(!textsA.includes("医生B可见群"), "医生A视角：不串入医生B消息");

    const scopeB = messagesAdmin.buildQiweTriageScope(other.id);
    const rowsB = db.prepare(`SELECT text FROM message_log WHERE doctor_id=? ${scopeB.sql} ORDER BY id`).all(other.id, ...scopeB.params);
    const textsB = rowsB.map(r => r.text);
    ok(textsB.includes("医生B私聊"), "医生B视角：即使 QiWe 配置 doctorId=A，B 的私聊仍可见（多医生自动绑定）");
    ok(textsB.includes("医生B可见群"), "医生B视角：本医生可见企微群消息可见（多医生自动绑定）");
    ok(!textsB.includes("医生A可见群"), "医生B视角：不串入医生A消息");
  }

  console.log("\n检查项:", n, "失败:", fails.length);
  if(fails.length){
    console.log("✗ 失败：\n - " + fails.join("\n - "));
    process.exit(1);
  }
  console.log("✓ QiWe 分诊多医生自动绑定测试通过");
})();
