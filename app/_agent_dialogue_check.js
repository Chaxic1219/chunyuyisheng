// 端到端验证：群聊 agent「对话内容错位」是否已解决。
// 跑 resolveTurn + composeHealthChat，打印真正会发给患者的文案。
const fs = require("fs");
const KB = JSON.parse(fs.readFileSync(process.env.KB_JSON, "utf-8"));
const { db } = require("./db.js");
const hc = require("./agent/health_chat.js");
const { composeHealthChat } = require("./agent/compose_health_chat.js");
const DOCTOR = 4;

db.exec("DELETE FROM knowledge_items; DELETE FROM faq;");
const ins = db.prepare(`INSERT INTO knowledge_items(id,doctor_id,layer,mode,title,body,source,status,updated_at)
  VALUES(?,?,?,?,?,?,?,?,?)`);
for (const it of KB.items) {
  ins.run(it.id, it.doctor_id, it.layer, it.mode || "半预制", it.title, it.body,
    it.source || "prod", it.status, new Date().toISOString());
}
const insFaq = db.prepare("INSERT INTO faq(id,doctor_id,q,a,sort) VALUES(?,?,?,?,?)");
for (const f of KB.faq) { try { insFaq.run(f.id, f.doctor_id, f.q, f.a, 0); } catch (e) {} }

// 原始事故消息（桌面\群聊对话.txt）+ 同类变体
const CASES = [
  "主任 盐酸帕罗西汀订今晚改吃一片饭后头晕",
  "主任，帕罗西汀今晚改吃一片",
  "周主任 这个药明天能停吗",
  "帕罗西汀能减到半片吗",
  "医生 今天开的中成药和西药汤剂明天取",
  "吃药后拉肚子要停吗",
  "胆囊手术后能吃鸡蛋吗",
];

const BAD = [
  [/SSRI|抗抑郁药属于|选择性5|再摄取抑制/, "科普了药理"],
  [/常见副作用包括|副作用有[:：]/, "科普了副作用清单"],
  [/剂量|服用剂量|建议服用/, "给了剂量建议"],
];

(async () => {
  for (const text of CASES) {
    const r = await hc.resolveTurn({
      doctorId: DOCTOR, text, session: { slots: {} },
      understood: { text, slots: {} }, allowCard: true
    });
    const c = await composeHealthChat({
      doctorId: DOCTOR, text, phase: r.phase, slots: r.slots,
      evidence: r.evidence, recentTurns: [], summary: "",
      missingSlots: r.missingSlots, urgent: r.urgent
    });
    const t = c.text || "";
    const issues = BAD.filter(([re]) => re.test(t)).map(([, n]) => n);
    if (/101/.test(t)) issues.push("推了101");
    console.log("\n" + "─".repeat(88));
    console.log("患者：" + text);
    console.log("相位：" + r.phase + "   转医生=" + r.handoff + "   来源=" + c.source
      + "   证据=" + r.evidence.sufficiency + "/" + (r.evidence.source || "-"));
    console.log("医助：" + t.replace(/\n/g, "\n      "));
    if (issues.length) console.log(">>> 问题：" + issues.join("、"));
  }
  console.log("\n" + "─".repeat(88));
})();
