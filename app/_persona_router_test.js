/* 医疗健康子人设路由单测 */
const { matchHealthcarePersona, isHealthcarePersonaGoal } = require("./agent/persona_router.js");
const { understand } = require("./agent/understand.js");
const { plan } = require("./agent/planner.js");

let n = 0, fails = [];
const ok = (c, m) => { n++; if(!c){ fails.push(m); console.log("  ✗ " + m); } else console.log("  ✓ " + m); };

console.log("== persona_router ==");
{
  const p = matchHealthcarePersona("体检报告转氨酶偏高怎么办", {});
  ok(p && p.key === "health_report", "识别 health_report");
}
{
  const p = matchHealthcarePersona("帮我整理一下病史，从什么时候开始疼的", { duration:"三天" });
  ok(p && p.key === "case_analysis", "识别 case_analysis");
}
{
  const p = matchHealthcarePersona("术后饮食要注意什么", {});
  ok(p && p.key === "care_plan", "识别 care_plan");
}
{
  const p = matchHealthcarePersona("", { hasReportImage:true });
  ok(p && p.key === "health_report", "报告附件 → health_report");
}
{
  const p = matchHealthcarePersona("怎么挂号", {});
  ok(p === null, "纯服务不命中子人设");
}
ok(isHealthcarePersonaGoal("health_report") === true, "isHealthcarePersonaGoal true");
ok(isHealthcarePersonaGoal("advice") === false, "isHealthcarePersonaGoal false");

console.log("== understand 集成 ==");
{
  const u = understand({ doctorId:1, text:"化验单白细胞偏高严重吗" });
  ok(u.healthcarePersona && u.healthcarePersona.key === "health_report", "understand 带出 health_report");
  ok(u.medicalIntent === true, "报告类算医疗意图");
}
{
  const u = understand({ doctorId:1, text:"想找主任咨询一下" });
  ok(!u.healthcarePersona && u.service && u.service.goal === "consult", "咨询优先服务意图");
}

console.log("== planner 子人设 ==");
{
  const u = understand({ doctorId:1, text:"术后出院饮食怎么吃" });
  const p = plan(u, "low", false, { level:4 });
  ok(p.goal === "care_plan" && p.personaKey === "care_plan", "care_plan goal");
  ok(p.handoff === false, "低风险 care_plan 可不 handoff");
}
{
  const u = understand({ doctorId:1, text:"体检报告血糖偏高" });
  const p = plan(u, "low", false, { level:4 });
  ok(p.goal === "health_report" && p.handoff === true, "health_report 转人工");
}

console.log("\n== 汇总 ==");
console.log("断言 " + n + " 条，失败 " + fails.length);
if(fails.length){
  fails.forEach(f=>console.log("FAIL: " + f));
  process.exit(1);
}
console.log("ALL PASS");
process.exit(0);
