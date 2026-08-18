/* 闲聊门控上下文 + 回复分条单测 */
const os = require("os"), path = require("path"), fs = require("fs");
const TMP = path.join(os.tmpdir(), "chunyu_gate_ctx_test.db");
[TMP, TMP + "-wal", TMP + "-shm"].forEach(f=>{ try{ fs.unlinkSync(f); }catch(e){} });
process.env.DB_PATH = TMP;

const groupGate = require("./group_gate.js");
const sessionStore = require("./agent/session.js");
const { splitReplyBubbles } = require("./reply_bubbles.js");
const { db } = require("./db.js");

let n = 0, fails = [];
const ok = (c, m) => { n++; if(!c){ fails.push(m); console.log("  ✗ " + m); } else console.log("  ✓ " + m); };

const lv = db.prepare("SELECT id FROM doctors WHERE slug='lvfujing'").get();
const doctorId = lv.id;
const patientKey = "qiwe:test-user-ctx";

console.log("== 语义门控 ==");
ok(groupGate.shouldHandleGroupText({ doctorId, text:"帮我整理病史，什么时候开始的" }).ok === true,
  "整理病史不再判闲聊");
ok(groupGate.shouldHandleGroupText({ doctorId, text:"今天天气不错" }).ok === false,
  "纯天气仍静默");
ok(groupGate.shouldHandleGroupText({ doctorId, text:"我打算直接找周主任" }).ok === true,
  "找主任诉求不过闲聊门控");

console.log("== 会话上下文 ==");
sessionStore._clearAllForTests();
const session = sessionStore.getSession(doctorId, patientKey);
sessionStore.updateSession(session, {
  goal:"advice",
  summary:"患者肚子疼，追问部位",
  turn:{ role:"user", text:"我肚子有点痛", goal:"advice", at:Date.now() }
});

ok(groupGate.shouldHandleGroupText({ doctorId, text:"肚脐周围", patientKey }).ok === true,
  "问诊中的「肚脐周围」过门控");
ok(groupGate.shouldHandleGroupText({ doctorId, text:"三天了", patientKey }).ok === true,
  "问诊中的时长补充过门控");
ok(groupGate.shouldHandleGroupText({ doctorId, text:"好的", patientKey }).skipped === "meaningless_noise",
  "问诊中纯寒暄仍无意义静默");
ok(groupGate.isUnrelatedChitchat("应该的配置完了", session) === true,
  "运维口语「应该的配置完了」判无关闲聊");
ok(groupGate.shouldHandleGroupText({ doctorId, text:"应该的配置完了", patientKey }).ok === false,
  "问诊中运维口语不过门控");
ok(groupGate.isUnrelatedChitchat("另外还有点头晕", session) === false,
  "问诊续轮症状补充仍相关");
ok(groupGate.isUnrelatedChitchat("今天天气不错", null) === true,
  "纯天气仍无关闲聊");

console.log("== 回复分条 ==");
{
  const short = splitReplyBubbles("收到，先观察一下。");
  ok(short.length === 1, "短回复不分条");
}
{
  const long = splitReplyBubbles("肚子疼确实难受，先别急。您具体是哪个位置疼？是上腹、下腹还是肚脐周围？疼了多久了？有没有发烧、恶心或者拉肚子？");
  ok(long.length >= 2, "长回复按句分条");
  ok(long.join("").length >= 40, "分条后内容不丢");
}

console.log("\n== 汇总 ==");
console.log("断言 " + n + " 条，失败 " + fails.length);
if(fails.length){
  fails.forEach(f=>console.log("FAIL: " + f));
  process.exit(1);
}
console.log("ALL PASS");
process.exit(0);
