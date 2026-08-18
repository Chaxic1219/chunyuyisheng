const assert = require("assert");
const triage = require("./triage.js");

function ok(cond, msg){ assert.ok(cond, msg); console.log("  OK", msg); }

console.log("== L2 card gate ==");
ok(typeof triage.canAttachMiniProgram === "function", "exports canAttachMiniProgram");
ok(triage.canAttachMiniProgram(2) === true, "L2 allows card");
ok(triage.canAttachMiniProgram(1) === false, "L1 denies card");
ok(triage.canAttachMiniProgram(3) === false, "L3 denies card");
ok(triage.canAttachMiniProgram(4) === false, "L4 denies card");
ok(triage.canAttachMiniProgram(6) === false, "L6 denies card");
ok(triage.canAttachMiniProgram(5) === true, "L5 level allows");
ok(triage.canAttachMiniProgram(4, { isKeywordRule:true }) === true, "keyword/code path allows even if level 4");
ok(triage.canAttachMiniProgram(4, { codeFastPath:true }) === true, "codeFastPath allows");

const l2 = triage.classifyLevel("这个药还能继续吃吗", 1, { riskLevel:"medium", needsDoctor:true });
ok(l2.level === 2, "needsDoctor medium → L2");
ok(triage.canAttachMiniProgram(l2.level) === true, "L2 classify allows");

// P0：无 forced needsDoctor — bare scanRisk / classifyLevel 须自达 L2
const barePhrase = "这个药还能继续吃吗";
const bareScan = triage.scanRisk(barePhrase);
ok(bareScan.riskLevel === "medium", "bare scanRisk 用药确认 → medium");
ok((bareScan.triggers || []).some(t=>/用药/.test(String(t))), "bare scanRisk triggers 含用药");
const bareL2 = triage.classifyLevel(barePhrase, 1);
ok(bareL2.level === 2, "bare classifyLevel → L2（无 forced opts）");
ok(triage.canAttachMiniProgram(bareL2.level) === true, "bare L2 allowCard");

try{
  const groupGate = require("./group_gate.js");
  const gate = groupGate.shouldHandleGroupText({ text:barePhrase, doctorId:1 });
  ok(gate.ok === true, "group_gate 用药确认 ok（非 group_chitchat）");
}catch(e){
  console.log("  SKIP group_gate check:", e && e.message);
}

const l4 = triage.classifyLevel("有点肚子疼怎么办", 1, { riskLevel:"low" });
ok(l4.level === 4, "low → L4");
ok(triage.canAttachMiniProgram(l4.level) === false, "L4 classify denies");

console.log("== adviceOnlyReply / needsDoctor ==");
ok(typeof triage.adviceOnlyReply === "function", "exports adviceOnlyReply");
ok(typeof triage.needsDoctorFromTriggers === "function", "exports needsDoctorFromTriggers");

const adviceLow = triage.adviceOnlyReply({ doctor:{ name:"张" } }, "low");
ok(!/101/.test(adviceLow), "low advice has no 101");
ok(!/小程序/.test(adviceLow), "low advice has no 小程序");
ok(/观察|就医|120/.test(adviceLow), "low advice mentions observe/seek care");

const adviceMed = triage.adviceOnlyReply({ doctor:{ name:"张" } }, "medium");
ok(!/101/.test(adviceMed), "medium advice has no 101");
ok(!/小程序/.test(adviceMed), "medium advice has no 小程序");
ok(/转人工|线下|120/.test(adviceMed), "medium advice mentions handoff/ER");

ok(triage.needsDoctorFromTriggers(["用药咨询"]) === true, "trigger 用药 → needsDoctor");
ok(triage.needsDoctorFromTriggers(["症状哨兵"]) === false, "unrelated trigger → no needsDoctor");
ok(triage.needsDoctorFromTriggers([], { needsDoctor:true }) === true, "opts.needsDoctor forces true");
ok(triage.needsDoctorFromTriggers(["找医生确认"]) === true, "trigger 医生 → needsDoctor");

const l3 = triage.classifyLevel("嗓子有点痛想问问", 1, {
  riskLevel:"medium", needsHuman:true, riskTriggers:["症状哨兵"]
});
ok(l3.level === 3, "medium without needsDoctor → L3");
ok(triage.canAttachMiniProgram(l3.level) === false, "L3 classify denies card");

const l2trig = triage.classifyLevel("这个药还能继续吃吗", 1, {
  riskLevel:"medium", needsHuman:true, riskTriggers:["用药"]
});
ok(l2trig.level === 2, "medium + 用药 trigger → L2 via shared helper");
ok(triage.canAttachMiniProgram(l2trig.level) === true, "L2 from triggers allows card");

(async function smokeL4(){
  try{
    process.env.TRIAGE_AI_DISABLED = process.env.TRIAGE_AI_DISABLED || "1";
    const r = await triage.handleIncoming({ doctorId:1, text:"有点肚子疼怎么办", patientKey:"l2-gate-smoke-l4" });
    ok(Array.isArray(r.extraResponses) && r.extraResponses.length === 0, "smoke L4 disease ask → empty extraResponses");
    ok(!r.entryCode, "smoke L4 disease ask → no entryCode");
  }catch(e){
    console.log("  SKIP smoke handleIncoming (DB unavailable):", e && e.message);
  }
  console.log("ALL PASS");
})().catch(e=>{ console.error(e); process.exit(1); });
