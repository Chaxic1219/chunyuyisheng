"use strict";
/**
 * P1 welcome outbox path: pending-first, then setOutboxStatus.
 * Run: node _welcome_outbox_test.js
 */
const fs = require("fs");
const path = require("path");
const os = require("os");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "chunyu-welcome-"));
process.env.DB_PATH = path.join(tmp, "t.db");
process.env.QIWE_AT_MEMBER_EXPERIMENTAL = "0"; // forceAtMember must still @

const { db } = require("./db.js");
const qiwe = require("./qiwe.js");
const bridge = require("./qiwe_bridge.js");

let failed = 0;
function ok(cond, msg){
  if(cond) console.log("  OK", msg);
  else { console.log("  FAIL", msg); failed++; }
}

const doctor = db.prepare("SELECT id FROM doctors LIMIT 1").get();
ok(!!doctor, "seed doctor");
const doctorId = doctor.id;

qiwe.saveConfig({
  enabled:true, autoSend:true, allowGroup:true,
  token:"tok", guid:"guid-test",
  selfUserId:"self-1", testToId:"self-1,room-w1"
});

const realH = qiwe.sendHyperText, realT = qiwe.sendText, realW = qiwe.sendWeapp;
let hCall = null, tCall = null, wCalls = [];
qiwe.sendHyperText = async (toId, text, opts)=>{ hCall = { toId, text, opts }; return { code:0, msg:"ok" }; };
qiwe.sendText = async (toId, text)=>{ tCall = { toId, text }; return { code:0, msg:"ok" }; };
qiwe.sendWeapp = async (toId, tpl)=>{ wCalls.push({ toId, code:tpl && tpl.code }); return { code:0, msg:"ok" }; };

(async ()=>{
  try{
    const before = db.prepare("SELECT COUNT(*) c FROM outbound_queue WHERE source='welcome'").get().c;
    const r = await bridge.fireGroupWelcome(
      { fromRoomId:"room-w1", senderId:"1688857254811415", senderName:"新患者小周" },
      qiwe.loadConfig(),
      doctorId
    );
    ok(!!r.welcomeOutboxId, "welcome outbox id");
    const row = db.prepare("SELECT * FROM outbound_queue WHERE id=?").get(r.welcomeOutboxId);
    ok(row && row.status === "sent", "final status sent via state machine");
    ok(row && row.sent_mode === "real", "sent_mode real");
    const payload = JSON.parse(row.payload || "{}");
    ok(payload.qiwe && payload.qiwe.forceAtMember === true, "forceAtMember on payload");
    ok(hCall && hCall.opts && hCall.opts.atUserIds[0] === "1688857254811415", "sendHyperText @ member");
    ok(!tCall, "no plain text when hypertext ok");
    // 无就绪模板时 deliverOutbox 会记 weapp_error 但仍因文本已发而 markSent；不要求 sendWeapp 必达
    ok(row.status === "sent" && hCall, "text via outbox state machine is enough for sent");

    // fail path: keep pending, never false sent
    hCall = null; tCall = null; wCalls = [];
    qiwe.sendHyperText = async ()=>{ throw new Error("boom-h"); };
    qiwe.sendText = async ()=>{ throw new Error("boom-t"); };
    const r2 = await bridge.fireGroupWelcome(
      { fromRoomId:"room-w2", senderId:"1688857254811999", senderName:"失败患者" },
      Object.assign(qiwe.loadConfig(), { testToId:"self-1,room-w2" }),
      doctorId
    );
    const row2 = db.prepare("SELECT * FROM outbound_queue WHERE id=?").get(r2.welcomeOutboxId);
    ok(row2 && row2.status === "pending", "send fail keeps pending (no false sent)");
    ok(r2.welcomeSent === false, "welcomeSent false on fail");

    // autoSend off → pending only, no send calls
    hCall = null; tCall = null;
    qiwe.sendHyperText = realH; qiwe.sendText = realT; qiwe.sendWeapp = realW;
    qiwe.saveConfig({ autoSend:false, allowGroup:true, token:"tok", guid:"guid-test", selfUserId:"self-1", testToId:"self-1,room-w3" });
    let called = false;
    qiwe.sendText = async ()=>{ called = true; return { code:0 }; };
    qiwe.sendHyperText = async ()=>{ called = true; return { code:0 }; };
    const r3 = await bridge.fireGroupWelcome(
      { fromRoomId:"room-w3", senderId:"1688857254811001", senderName:"待确认" },
      qiwe.loadConfig(),
      doctorId
    );
    const row3 = db.prepare("SELECT * FROM outbound_queue WHERE id=?").get(r3.welcomeOutboxId);
    ok(row3 && row3.status === "pending" && !called, "autoSend off → pending, no send");

    ok(db.prepare("SELECT COUNT(*) c FROM outbound_queue WHERE source='welcome'").get().c === before + 3, "exactly 3 welcome rows added");
  }catch(e){
    console.error(e);
    failed++;
  }finally{
    qiwe.sendHyperText = realH;
    qiwe.sendText = realT;
    qiwe.sendWeapp = realW;
    try{ fs.rmSync(tmp, { recursive:true, force:true }); }catch(e){}
    console.log(failed ? `\nFAILED ${failed}` : "\nALL PASSED");
    process.exit(failed ? 1 : 0);
  }
})();
