/* community + agent 冒烟（本地） */
const os = require("os"), path = require("path"), fs = require("fs");
const TMP = path.join(os.tmpdir(), "chunyu_agent_community.db");
[TMP, TMP + "-wal", TMP + "-shm"].forEach(f=>{ try{ fs.unlinkSync(f); }catch(e){} });
process.env.DB_PATH = TMP;
process.env.TRIAGE_AI_DISABLED = "1";
process.env.DIALOGUE_AGENT_ENABLED = "1";
process.env.AGENT_DRY_RUN = "1";

const { db } = require("./db.js");
const community = require("./community.js");

(async ()=>{
  const d = db.prepare("SELECT id FROM doctors WHERE slug='lvfujing'").get();
  let g = db.prepare("SELECT * FROM community_groups WHERE doctor_id=? LIMIT 1").get(d.id);
  if(!g){
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO community_groups(
      doctor_id,name,channel_type,status,auto_reply_enabled,review_mode,welcome_enabled,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?)`).run(d.id, "agent-test", "qiwe", "pilot", 1, "auto_keywords", 0, now, now);
    g = db.prepare("SELECT * FROM community_groups WHERE doctor_id=? ORDER BY id DESC LIMIT 1").get(d.id);
  }else{
    db.prepare("UPDATE community_groups SET auto_reply_enabled=1,review_mode='auto_keywords' WHERE id=?").run(g.id);
    g = db.prepare("SELECT * FROM community_groups WHERE id=?").get(g.id);
  }
  const r = await community.handleInbound({
    doctorId:d.id,
    groupId:g.id,
    text:"想找主任咨询",
    senderName:"测",
    externalUserId:"u-agent-1",
    externalMsgId:"m-agent-" + Date.now(),
    dataSource:"manual"
  });
  const ok = !!(r.agent && r.agent.source === "dialogue_agent" && r.outbox);
  console.log(ok ? "PASS" : "FAIL", {
    agentSource: r.agent && r.agent.source,
    outboxSource: r.outbox && r.outbox.source,
    status: r.outbox && r.outbox.status
  });
  process.exit(ok ? 0 : 1);
})().catch(e=>{ console.error(e); process.exit(1); });
