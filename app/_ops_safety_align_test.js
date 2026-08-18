/**
 * 运营配置安全等级与 Agent 两轴对齐回归
 * 运行：node _ops_safety_align_test.js
 */
const fs = require("fs");
const path = require("path");
const { sendPolicyFor } = require("./agent/risk.js");

let failed = 0;
function ok(cond, msg){
  if(cond) console.log("  ✓", msg);
  else { failed++; console.log("  ✗", msg); }
}

const serverSrc = fs.readFileSync(path.join(__dirname, "server.js"), "utf8");

console.log("== 默认文案 ==");
ok(serverSrc.includes('sendPolicy:"block"'), "high → block");
ok(serverSrc.includes('sendPolicy:"card_only_or_review"'), "medium → card_only_or_review");
ok(serverSrc.includes('sendPolicy:"auto"'), "low → auto");
ok(serverSrc.includes("仅发卡（短交接语+春雨卡）可自动"), "medium action 文案含仅发卡");
ok(serverSrc.includes("ClinicalRisk（low/medium/high）"), "riskAssessment 含两轴");
ok(serverSrc.includes("不要只教患者发送编号口令"), "lowRiskReply 去口令说明书");
ok(serverSrc.includes('["prompts","scripts","safety"]'), "safety 纳入自动升级");
ok(!/中风险建议保持人工确认策略/.test(serverSrc), "已移除旧 medium 校验文案");
ok(serverSrc.includes("中风险应写明：仅发卡可自动"), "新 medium 校验文案");

console.log("== Agent 出站仍两轴 ==");
ok(sendPolicyFor({ clinicalRisk:"medium", intendedAction:"open_chunyu_card", hasMedicalAdviceText:false }).sendPolicy === "card_only", "medium+发卡 → card_only");
ok(sendPolicyFor({ clinicalRisk:"medium", intendedAction:"reply_medical_advice", hasMedicalAdviceText:true }).sendPolicy === "review", "medium+医疗 → review");
ok(sendPolicyFor({ clinicalRisk:"high", emergency:true, intendedAction:"reply_service" }).sendPolicy === "block", "high → block");

console.log("== admin-ui 字段 ==");
const fieldsSrc = fs.readFileSync(path.join(__dirname, "../admin-ui/src/views/chunyu/config/fields.ts"), "utf8");
ok(fieldsSrc.includes("card_only / review"), "admin-ui medium 摘要");
ok(fieldsSrc.includes("SendPolicy=auto"), "admin-ui low 摘要");
ok(fieldsSrc.includes("不要只教编号口令"), "admin-ui lowRiskReply");

console.log("\n断言失败", failed);
process.exit(failed ? 1 : 0);
