"use strict";
/* 验证知识库检索增强 + escalate 相位判定（本地跑，用内存注入知识，不碰生产） */
const assert = require("assert");
const triage = require("./triage.js");
const { decidePhase } = require("./agent/health_chat.js");
const { softTemplateHealth } = require("./agent/compose_health_chat.js");

let total = 0, fails = [];
function ok(cond, msg){ total++; if(!cond){ fails.push(msg); console.log("  ✗ " + msg); } else console.log("  ✓ " + msg); }

const KB = [
  { id:53, layer:"医生个人", mode:"半预制", title:"服药期间能否饮酒（通用）", body:"服药期间原则上不建议饮酒：酒精可能影响药效、加重肝脏负担，并与多种药物发生相互作用。具体到个人处方，停药/饮酒安排以面诊医生意见为准。", source:"ops" },
  { id:54, layer:"医生个人", mode:"半预制", title:"抗抑郁药（帕罗西汀等）常见副作用与停药须知", body:"帕罗西汀属于 SSRI 类抗抑郁药，常见早期副作用包括头晕、嗜睡、口干、恶心等。是否停药、减量或调整服药时间请务必遵面诊医嘱，不要自行突然停药。", source:"ops" },
  { id:55, layer:"医生个人", mode:"半预制", title:"药物服用时间：饭前/饭后/空腹", body:"不同药物对服用时间要求不同：有的需空腹，有的需随餐或饭后服用以减少胃肠刺激。以您的处方标注和面诊医嘱为准。", source:"ops" },
  { id:56, layer:"医生个人", mode:"半预制", title:"多种药物能否同时服用", body:"中西药联合、多种药同服时可能存在相互影响。一般建议不同药物间隔服用，并如实告知医生全部用药。汤剂与中成药如何安排按医生医嘱执行。", source:"ops" },
  { id:57, layer:"医生个人", mode:"半预制", title:"服药期间出现不适（头晕/胃部不适等）如何处理", body:"服药后出现头晕等副作用，先记录出现时间与程度；轻症可休息观察，明显或持续加重时及时联系医生，不要自行停药或改量。", source:"ops" }
];

console.log("场景1：本地检索增强（用药问询应命中知识库）");
const cases = [
  ["帕罗西汀要不要停药", 54],
  ["周六有酒局 帕罗西汀能不能喝酒", 53],
  ["药是饭前吃还是饭后吃", 55],
  ["今天拿的药明天才取 能一起吃吗", 56],
  ["主任 盐酸帕罗西汀订今晚改吃一片饭后头晕", 54],
];
for(const [q, expectId] of cases){
  const kb = triage.retrieveKnowledgeLocal({ knowledge: KB }, q, 3);
  const hit = kb.items.find(x => x.id === expectId);
  ok(hit && kb.sufficiency !== "none", `「${q}」应命中 id=${expectId}（实际 top=${kb.top}, sufficiency=${kb.sufficiency}, 命中=${(kb.items||[]).map(x=>x.id).join(",")||"无"}）`);
}

console.log("\n场景2：相位判定（用药汇报/禁忌 → escalate 转医生，不科普）");
const escalateCases = [
  "主任 盐酸帕罗西汀订今晚改吃一片饭后头晕",
  "医生 今天开中成药和西药 汤剂明天取 等明天联合一起吃还是今天先吃拿到的",
  "请问周六有酒局，不好退掉。帕罗西汀要不要停药？",
];
for(const t of escalateCases){
  const phase = decidePhase({ understood:{ text:t, slots:{ asksMedication:true } }, slots:{}, evidence:null, emergency:false, clinicalRisk:"low", chatPhaseHint:null, text:t });
  ok(phase === "escalate", `「${t}」→ escalate（实际 ${phase}）`);
}

console.log("\n场景3：escalate 文案（不硬推 101、不科普）");
const esc = softTemplateHealth("escalate", { slots:{}, doctorName:"周玉春主任" });
ok(!/101/.test(esc), "escalate 文案不含 101 硬推：" + esc);
ok(!/帕罗西汀|抗抑郁|副作用/.test(esc), "escalate 文案不科普药名：" + esc);
ok(/医生|团队/.test(esc), "escalate 文案说明转医生：" + esc);

console.log("\n场景4：普通健康咨询仍走 advise（不误伤）");
const adviseText = "我肚子有点疼，昨天开始";
const phase2 = decidePhase({ understood:{ text:adviseText, slots:{} }, slots:{}, evidence:null, emergency:false, clinicalRisk:"low", chatPhaseHint:null, text:adviseText });
ok(phase2 === "advise", `普通腹痛咨询 → advise（实际 ${phase2}）`);

/* 场景5-7 不注入 asksMedication，纯测文本判定（场景2 的 asksMedication 会短路 decidePhase，
   掩盖词表覆盖不足）。处方变更 = 改变用药方案，属医生决定权，与知识库有无证据无关。 */
function phaseOf(t){
  return decidePhase({ understood:{ text:t, slots:{} }, slots:{}, evidence:null,
    emergency:false, clinicalRisk:"low", chatPhaseHint:null, text:t });
}

console.log("\n场景5：处方变更类问询 → escalate（口语化说法，此前漏判）");
for(const t of [
  "周主任 这个药明天能停吗",
  "帕罗西汀能减到半片吗",
  "吃药后拉肚子要停吗",
  "这个药我想换成别的",
  "药量能不能加一点",
  "这个药还要不要继续吃",
]){
  const p = phaseOf(t);
  ok(p === "escalate", `「${t}」→ escalate（实际 ${p}）`);
}

console.log("\n场景6：原用药汇报场景不回退（不依赖 asksMedication）");
for(const t of [
  "主任 盐酸帕罗西汀订今晚改吃一片饭后头晕",
  "主任，帕罗西汀今晚改吃一片",
  "医生 今天开的中成药和西药汤剂明天取",
]){
  const p = phaseOf(t);
  ok(p === "escalate", `「${t}」→ escalate（实际 ${p}）`);
}

console.log("\n场景7：通用用药咨询仍 advise（知识库可答，不得误转）");
for(const t of [
  "服药期间能喝酒吗",
  "这药是饭前吃还是饭后吃",
  "帕罗西汀有什么副作用",
  "中药和西药能一起吃吗",
]){
  const p = phaseOf(t);
  ok(p === "advise", `「${t}」→ advise（实际 ${p}）`);
}

console.log("\n场景8：含停/减/加/换/改字样但非处方变更，不得误转");
for(const t of [
  "吃了药头晕加重了",
  "这个药能改善睡眠吗",
  "吃药后症状减轻了",
  "胆囊手术后能吃鸡蛋吗",
]){
  const p = phaseOf(t);
  ok(p !== "escalate", `「${t}」→ 非 escalate（实际 ${p}）`);
}

console.log(`\n${total - fails.length}/${total} 通过`);
if(fails.length){ console.error("失败:", fails); process.exit(1); }
console.log("OK");
process.exit(0);
