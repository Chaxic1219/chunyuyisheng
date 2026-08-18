const assert = require("assert");
const triage = require("./triage.js");
const groupGate = require("./group_gate.js");

function ok(c,m){ assert.ok(c,m); console.log("  OK",m); }

const DID = 1;
process.env.AI_LEVEL_CLASSIFIER = "0";
delete process.env.TRIAGE_AI_DISABLED;

console.log("== mergeLevelDecision ==");
ok(typeof triage.mergeLevelDecision === "function", "exports mergeLevelDecision");

const floorHigh = { riskLevel:"high", emergency:true, triggers:["胸痛"] };
const aiLow = { riskLevel:"low", needsDoctor:false, level:4, source:"ai" };
const mergedH = triage.mergeLevelDecision(floorHigh, aiLow);
ok(mergedH.riskLevel === "high", "floor high blocks AI downgrade");

const floorLow = { riskLevel:"low", sentinel:true, triggers:["常见健康咨询/科普引导"] };
const aiMed = { riskLevel:"medium", needsDoctor:false, level:3, source:"ai" };
const mergedM = triage.mergeLevelDecision(floorLow, aiMed);
ok(mergedM.riskLevel === "medium", "AI can raise low→medium");

const floorMed = { riskLevel:"medium", triggers:["用药处方"] };
const aiL4 = { riskLevel:"low", needsDoctor:false, level:4, source:"ai" };
const mergedNoDown = triage.mergeLevelDecision(floorMed, aiL4);
ok(mergedNoDown.riskLevel === "medium", "AI cannot downgrade medium→low");
ok(mergedNoDown.level === 2, "floorMed + aiL4 → L2 (needsDoctor from 用药处方)");

const aiInvalid = { riskLevel:"banana", needsDoctor:true, level:1, source:"ai" };
const mergedInvalid = triage.mergeLevelDecision(floorLow, aiInvalid);
ok(mergedInvalid.levelSource === "floor", "invalid ai.riskLevel → floor-only");
ok(mergedInvalid.riskLevel === "low", "invalid AI does not raise floor");

const aiNotSource = { riskLevel:"medium", needsDoctor:false, level:3, source:"local" };
const mergedNotAi = triage.mergeLevelDecision(floorLow, aiNotSource);
ok(mergedNotAi.levelSource === "floor", "ai.source !== ai → floor path");
ok(mergedNotAi.riskLevel === "low", "non-ai source does not raise");

const aiHighAlone = { riskLevel:"high", needsDoctor:false, level:1, source:"ai" };
const mergedCap = triage.mergeLevelDecision(floorLow, aiHighAlone);
ok(mergedCap.riskLevel === "medium", "AI high capped at medium");
ok(mergedCap.levelSource === "merged", "capped AI still merges");

console.log("== resolveMessageLevel fallback ==");
ok(typeof triage.resolveMessageLevel === "function", "exports resolveMessageLevel");
const r = triage.resolveMessageLevel("我肚子有点疼", 1, { aiLevel:null });
ok(r.levelInfo.level === 3 || r.levelInfo.level === 4, "fallback classify belly pain L3/L4");
ok(r.source === "local" || r.source === "floor", "null ai → local/floor source");
ok(r.merged.level === r.levelInfo.level, "merged.level === levelInfo.level for belly pain");

const rHigh = triage.resolveMessageLevel("胸痛喘不上气", 1, { aiLevel: aiLow });
ok(rHigh.source === "floor", "high floor + ai low → source floor");
ok(rHigh.levelInfo.level === 1, "high floor → level 1");

console.log("== assessLevelLLM / resolveMessageLevelAsync guards ==");
ok(typeof triage.assessLevelLLM === "function", "exports assessLevelLLM");
ok(typeof triage.resolveMessageLevelAsync === "function", "exports resolveMessageLevelAsync");
ok(typeof triage.aiLevelClassifierEnabled === "function", "exports aiLevelClassifierEnabled");

console.log("== acceptance table (local floor, classifier off) ==");
ok(triage.aiLevelClassifierEnabled() === false, "classifier off for acceptance");

const belly = "我肚子有点疼";
const bellyGate = groupGate.shouldHandleGroupText({ doctorId: DID, text: belly });
ok(bellyGate.ok === true, "我肚子有点疼 → group_gate ok");
const bellyR = triage.resolveMessageLevel(belly, DID, { aiLevel: null });
ok(bellyR.levelInfo.level === 3 || bellyR.levelInfo.level === 4, "我肚子有点疼 → L3 or L4");
ok(!triage.canAttachMiniProgram(bellyR.levelInfo.level), "我肚子有点疼 → !canAttach");

const med = "这个药还能继续吃吗";
const medGate = groupGate.shouldHandleGroupText({ doctorId: DID, text: med });
ok(medGate.ok === true, "用药确认 → group_gate ok");
const medR = triage.resolveMessageLevel(med, DID, { aiLevel: null });
ok(medR.levelInfo.level === 2, "这个药还能继续吃吗 → L2");
ok(triage.canAttachMiniProgram(medR.levelInfo.level) === true, "这个药还能继续吃吗 → canAttach");

const chest = "胸痛喘不上气";
const chestGate = groupGate.shouldHandleGroupText({ doctorId: DID, text: chest });
ok(chestGate.ok === true, "胸痛喘不上气 → group_gate ok");
const chestR = triage.resolveMessageLevel(chest, DID, { aiLevel: null });
ok(chestR.levelInfo.level === 1, "胸痛喘不上气 → L1");
ok(!triage.canAttachMiniProgram(chestR.levelInfo.level), "胸痛喘不上气 → !canAttach");

const weather = "今天天气真好";
const weatherGate = groupGate.shouldHandleGroupText({ doctorId: DID, text: weather });
ok(weatherGate.ok === false && weatherGate.skipped === "group_chitchat", "今天天气真好 → group_chitchat");

process.env.TRIAGE_AI_DISABLED = "1";
process.env.AI_LEVEL_CLASSIFIER = "1";
(async () => {
  const n = await triage.assessLevelLLM("我肚子有点疼", {});
  ok(n === null, "TRIAGE_AI_DISABLED → assessLevelLLM null");
  const asyncR = await triage.resolveMessageLevelAsync("我肚子有点疼", 1, {});
  ok(asyncR.source === "local" || asyncR.source === "floor", "async with disabled AI still local");
  ok(asyncR.levelInfo.level === 3 || asyncR.levelInfo.level === 4, "async belly L3/L4");
  process.env.AI_LEVEL_CLASSIFIER = "0";
  delete process.env.TRIAGE_AI_DISABLED;
  ok(triage.aiLevelClassifierEnabled() === false, "classifier default off after guards");
  console.log("ALL PASS");
})().catch(e=>{ console.error(e); process.exit(1); });
