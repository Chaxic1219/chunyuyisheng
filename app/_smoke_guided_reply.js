/* 本地冒烟：群门控 + 中风险引导回复（无需真模型） */
process.env.MEDIUM_LLM_REPLY = "1";
process.env.LOW_RISK_LLM_REPLY = "1";
process.env.TRIAGE_AI_DISABLED = "1"; // 强制走确定性回落，验证仍可自动发引导话术

const g = require("./group_gate");
const t = require("./triage");

function assert(cond, msg){ if(!cond) throw new Error("FAIL: " + msg); console.log("OK", msg); }

(async () => {
  const shrimp = "我吃了虾吃坏肚子里";
  const mosquito = "我现在被蚊子叮了个包，特别痒我想止痒";
  const hi = "你好";

  assert(g.shouldHandleGroupText({ text: shrimp, doctorId: 1 }).ok, "吃坏肚子过门控");
  assert(g.shouldHandleGroupText({ text: mosquito, doctorId: 1 }).ok, "蚊子叮咬过门控");
  assert(!g.shouldHandleGroupText({ text: hi, doctorId: 1 }).ok, "寒暄仍静默");

  for (const text of [shrimp, mosquito]) {
    const r = await t.handleIncoming({
      doctorId: 1,
      text,
      patientName: "测试患者",
      patientKey: "local-test-" + Date.now() + "-" + Math.random(),
      isGroup: true
    });
    console.log("---", text);
    console.log("risk", r.triage.riskLevel, "canAutoSend", r.triage.canAutoSend, "needsHuman", r.triage.needsHuman, "entry", r.entryCode);
    console.log(String(r.response.text).slice(0, 180));
    if (r.triage.riskLevel === "medium") {
      assert(r.triage.canAutoSend === true, text + " medium 开态可自动发");
      assert(r.triage.needsHuman === true, text + " medium 仍需医助");
      // L2 附卡引导 101；L3 仅建议话术不附卡（无 101）
      const has101 = /101/.test(r.response.text) || r.entryCode === "101";
      const adviceOnly = !has101 && /观察|就医|120|转人工|线下/.test(r.response.text || "");
      assert(has101 || adviceOnly, text + " medium：L2→101 或 L3→建议话术");
    }
    if (r.triage.riskLevel === "low") {
      assert(r.triage.canAutoSend === true, text + " low 可自动发");
    }
  }
  console.log("\n全部通过");
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
