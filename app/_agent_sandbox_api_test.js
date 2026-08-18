/* 运行: node _agent_sandbox_api_test.js */
process.env.DIALOGUE_AGENT_ENABLED = "1";
process.env.AGENT_DRY_RUN = "1";
if(process.env.TRIAGE_AI_DISABLED == null) process.env.TRIAGE_AI_DISABLED = "1";

const { bubblesFromReply, patientKeyOf, cleanSessionId } = require("./routes/agent-sandbox-admin.js");
const agent = require("./agent/index.js");
const { db } = require("./db.js");

function ok(c, m){
  if(!c) throw new Error(m);
  console.log("OK", m);
}

async function main(){
  ok(cleanSessionId("ab/c..d!!").indexOf("/") < 0, "cleanSessionId 剥非法字符");
  ok(bubblesFromReply({ responses:[{ type:"text", text:"你好" }, { type:"mp", title:"卡" }] }).length === 1, "只抽 text");
  ok(patientKeyOf(9, 1, "abc") === "sandbox:9:1:abc", "patientKey 格式");

  const doctorId = (db.prepare("SELECT id FROM doctors LIMIT 1").get() || {}).id;
  ok(!!doctorId, "有医生");

  const before = db.prepare("SELECT COUNT(*) AS c FROM outbound_queue").get().c;
  const r = await agent.runTurn({
    doctorId,
    text: "我想找医生",
    patientKey: "sandbox:0:test:unit1",
    patientName: "测试群友",
    isGroup: true
  });
  const after = db.prepare("SELECT COUNT(*) AS c FROM outbound_queue").get().c;
  ok(after === before, "runTurn 本身不写出站");
  ok(r && (r.source === "dialogue_agent" || r.source === "code_fast_path"), "有 agent 源");
  const bubbles = bubblesFromReply(r);
  ok(Array.isArray(bubbles), "bubbles 数组");
  console.log("all passed");
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
