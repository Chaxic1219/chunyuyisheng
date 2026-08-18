/* 本地对话演示：打印 Agent 回合结果（不上线、不真发） */
const os = require("os"), path = require("path"), fs = require("fs");
const TMP = path.join(os.tmpdir(), "chunyu_agent_demo.db");
[TMP, TMP + "-wal", TMP + "-shm"].forEach(f=>{ try{ fs.unlinkSync(f); }catch(e){} });
process.env.DB_PATH = TMP;
process.env.DIALOGUE_AGENT_ENABLED = "1";
process.env.AGENT_DRY_RUN = "1";
// 演示默认打开 health_chat；可 HEALTH_CHAT_ENABLED=0 回旧医疗 handoff
if(process.env.HEALTH_CHAT_ENABLED == null) process.env.HEALTH_CHAT_ENABLED = "1";
// 演示默认可关模型，看软模板；若本机有 key 可 AGENT_DEMO_LLM=1 体验 LLM 文案
if(process.env.AGENT_DEMO_LLM !== "1") process.env.TRIAGE_AI_DISABLED = "1";

const { db } = require("./db.js");
const agent = require("./agent/index.js");
const sessionStore = require("./agent/session.js");
const { healthChatEnabled } = require("./agent/flags.js");

const samples = [
  "101",
  "想找吕主任咨询一下胃不舒服",
  "怎么挂号？出诊时间呢",
  "我想加号",
  "群里都能干什么",
  "胃痛三天了想开点药",
  "帮我弄一下"
];

/** health_chat 验收样例：前两句同会话演示多轮；后两句独立 */
const healthChatSamples = [
  { text: "我肚子有点疼", patientKey: "demo:hc:belly", multi: true },
  { text: "上腹两天没加重", patientKey: "demo:hc:belly", multi: true },
  { text: "胆囊切除后能吃鸡蛋吗", patientKey: "demo:hc:egg" },
  { text: "给我开点止痛药", patientKey: "demo:hc:med" }
];

function previewText(s, n){
  const t = String(s || "").replace(/\s+/g, " ").trim();
  if(t.length <= (n || 120)) return t;
  return t.slice(0, n || 120) + "…";
}

function printTurn(label, text, r){
  const texts = (r.responses || []).filter(x=>x && x.type === "text").map(x=>x.text);
  const cards = (r.responses || []).filter(x=>x && x.type !== "text").map(x=>x.type + (x.title ? ":" + x.title : ""));
  const meta = r.agentMeta || {};
  const phase = meta.phase || (meta.compose && meta.compose.phase) || null;
  console.log("\n" + label + "用户:", text);
  console.log("path:", meta.path || "(none)", "| phase:", phase || "(n/a)");
  console.log("source:", r.source, "| sendPolicy:", r.triage && r.triage.sendPolicy, "| canAuto:", r.triage && r.triage.canAutoSend);
  console.log("tools:", JSON.stringify(r.toolCalls || []));
  console.log("intentCode:", r.intentCode);
  console.log("compose:", meta.compose);
  texts.forEach((t,i)=>console.log("文案" + (i + 1) + ":", t));
  if(texts.length) console.log("preview:", previewText(texts.join(" / ")));
  if(cards.length) console.log("富媒体:", cards.join(", "));
}

(async ()=>{
  const lv = db.prepare("SELECT id,name FROM doctors WHERE slug='lvfujing'").get();
  if(!lv) throw new Error("no doctor");
  sessionStore._clearAllForTests();
  console.log("医生:", lv.name, "id=", lv.id);
  console.log("agentEnabled=", agent.agentEnabled(), "dryRun=", agent.agentDryRun(), "healthChat=", healthChatEnabled());
  console.log("---- 常规样例 ----");
  for(const text of samples){
    // 每句独立会话，避免演示串槽；真实群聊同 patientKey 会累积 slots
    const r = await agent.runTurn({
      doctorId:lv.id,
      text,
      patientKey:"demo:" + Buffer.from(text).toString("hex").slice(0, 16),
      isGroup:true,
      patientName:"演示患者"
    });
    printTurn("", text, r);
  }

  if(healthChatEnabled()){
    // 可选：塞一条 ready 知识，便于「能吃鸡蛋」走 educate
    try{
      db.prepare(`INSERT INTO knowledge_items(doctor_id,layer,mode,title,body,source,owner,status,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?)`).run(
        lv.id, "医生个人", "半预制", "胆囊切除术后饮食",
        "胆囊切除术后饮食宜清淡，可逐步恢复鸡蛋等优质蛋白，避免油腻辛辣。仅供参考，请咨询医生。",
        "demo", "ops", "ready", new Date().toISOString()
      );
    }catch(e){ /* 表结构差异时跳过，仍可演示 path/phase */ }

    console.log("\n---- health_chat 样例 (HEALTH_CHAT_ENABLED=1) ----");
    for(const item of healthChatSamples){
      const r = await agent.runTurn({
        doctorId:lv.id,
        text:item.text,
        patientKey:item.patientKey,
        isGroup:true,
        patientName:"演示患者"
      });
      printTurn("[hc] ", item.text, r);
    }
  }else{
    console.log("\n---- health_chat 样例跳过（HEALTH_CHAT_ENABLED≠1）----");
  }
})().catch(e=>{ console.error(e); process.exit(1); });
