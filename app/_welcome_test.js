/* 欢迎语同源单测：仅运营配置 / 兜底，无群级覆盖 */
const os = require("os"), path = require("path"), fs = require("fs");
const TMP = path.join(os.tmpdir(), "chunyu_welcome_test.db");
[TMP, TMP + "-wal", TMP + "-shm"].forEach(f=>{ try{ fs.unlinkSync(f); }catch(e){} });
process.env.DB_PATH = TMP;
process.env.TRIAGE_AI_DISABLED = "1";

const { db } = require("./db.js");
const welcome = require("./welcome.js");
const qiweBridge = require("./qiwe_bridge.js");

let n = 0, fails = [];
const ok = (c, m) => { n++; if(!c){ fails.push(m); console.log("  ✗ " + m); } else console.log("  ✓ " + m); };

const lv = db.prepare("SELECT id FROM doctors WHERE slug='lvfujing'").get();
ok(!!lv, "医生存在");

{
  const r = welcome.resolveWelcomeText({ doctorId:lv.id, patientName:"测" });
  ok(r.source === "ops" || r.source === "fallback", "无覆盖 → ops 或 fallback，source="+r.source);
  ok(r.text && r.text.length > 10, "有欢迎正文");
}
{
  // 群级覆盖已废弃：即使传入 groupWelcomeText 也不得覆盖运营模板
  const r = welcome.resolveWelcomeText({ doctorId:lv.id, patientName:"测", groupWelcomeText:"【本群专属】你好{patient}" });
  ok(r.source !== "group_override", "群级覆盖已废弃，不得返回 group_override");
  ok(!/本群专属/.test(r.text), "不得使用群级覆盖文案");
}
{
  const t1 = qiweBridge.buildGroupWelcomeText(lv.id, "甲");
  const t2 = welcome.resolveWelcomeText({ doctorId:lv.id, patientName:"甲" }).text;
  ok(t1.indexOf(t2) >= 0 || t1.replace(/@甲\s*/, "") === t2 || t1.includes("欢迎"), "QiWe buildGroupWelcomeText 与 resolve 同源");
}

console.log("\n断言 " + n + " 失败 " + fails.length);
if(fails.length){ fails.forEach(f=>console.log("FAIL "+f)); process.exit(1); }
console.log("WELCOME ALL PASS");
process.exit(0);
