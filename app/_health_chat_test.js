/* health_chat 开关 + Planner 分流单测 */
const os = require("os"), path = require("path"), fs = require("fs");
const TMP = path.join(os.tmpdir(), "chunyu_health_chat_test.db");
[TMP, TMP + "-wal", TMP + "-shm"].forEach(f => { try { fs.unlinkSync(f); } catch (e) {} });
process.env.DB_PATH = TMP;
process.env.TRIAGE_AI_DISABLED = "1";
process.env.DIALOGUE_AGENT_ENABLED = "1";
process.env.AGENT_DRY_RUN = "1";
delete process.env.HEALTH_CHAT_ENABLED;

const { db } = require("./db.js");
const { healthChatEnabled } = require("./agent/flags.js");
const { understand } = require("./agent/understand.js");
const { plan } = require("./agent/planner.js");
const sessionStore = require("./agent/session.js");
const hc = require("./agent/health_chat.js");
const { composeHealthChat } = require("./agent/compose_health_chat.js");

let n = 0, fails = [];
const ok = (c, m) => {
  n++;
  if (!c) { fails.push(m); console.log("  ✗ " + m); }
  else console.log("  ✓ " + m);
};

(async () => {
  const doctorId = db.prepare("SELECT id FROM doctors WHERE slug='lvfujing'").get().id;

  console.log("== flags ==");
  ok(healthChatEnabled() === false, "默认 HEALTH_CHAT 关");
  process.env.HEALTH_CHAT_ENABLED = "1";
  ok(healthChatEnabled() === true, "HEALTH_CHAT_ENABLED=1 → 开");
  process.env.HEALTH_CHAT_ENABLED = "0";
  ok(healthChatEnabled() === false, "HEALTH_CHAT_ENABLED=0 → 关");
  process.env.HEALTH_CHAT_ENABLED = "true";
  ok(healthChatEnabled() === false, "HEALTH_CHAT_ENABLED=true → 关（须严格 === 1）");
  process.env.HEALTH_CHAT_ENABLED = "1";

  console.log("== planner health_chat ==");
  const u = understand({ doctorId, text: "我肚子有点疼" });
  ok(u.medicalIntent === true, "肚子疼 → medicalIntent");
  const pOff = plan(u, "medium", false, { level: 3, allowCard: false, healthChat: false });
  ok(pOff.goal !== "health_chat", "healthChat 关 → 非 health_chat goal");
  const pOn = plan(u, "medium", false, { level: 3, allowCard: false, healthChat: true });
  ok(pOn.goal === "health_chat" && pOn.intendedAction === "health_chat", "healthChat 开 → health_chat");
  ok(pOn.preferredCode == null, "intake 默认不带 preferredCode");
  ok(!(pOn.toolCalls || []).some(t => t.name === "open_chunyu_card"), "health_chat plan 初始不附卡");

  const svc = understand({ doctorId, text: "怎么挂号" });
  const pSvc = plan(svc, "low", false, { level: 4, allowCard: true, healthChat: true });
  ok(pSvc.goal === "schedule" || pSvc.intendedAction === "open_chunyu_card", "纯服务仍走服务路径");

  console.log("== asksMedication escalate ==");
  {
    const med = understand({ doctorId, text: "胃痛三天了想开点药" });
    ok(med.slots.asksMedication === true, "开药文案 → asksMedication");
    const pMed = plan(med, "medium", false, { level: 3, allowCard: false, healthChat: true });
    ok(pMed.goal === "health_chat", "开药 + healthChat → health_chat goal");
    ok(pMed.handoff === true, "开药 + healthChat → handoff true");
    ok(pMed.chatPhaseHint === "escalate", "开药 + healthChat → chatPhaseHint escalate");
  }

  console.log("== attachment bypass ==");
  {
    const att = understand({
      doctorId,
      text: "帮看下这个化验单",
      attachments: [{ type: "image", name: "血常规化验报告.jpg" }]
    });
    ok((att.attachmentHints || []).length > 0, "附件 → attachmentHints");
    const pAtt = plan(att, "medium", false, { level: 2, allowCard: true, healthChat: true });
    ok(pAtt.goal !== "health_chat", "有附件 + healthChat → 不走 health_chat");
  }

  console.log("== emergency bypass ==");
  {
    const uEmer = understand({ doctorId, text: "我肚子有点疼" });
    const pHigh = plan(uEmer, "high", false, { level: 3, allowCard: false, healthChat: true });
    ok(pHigh.intendedAction === "emergency_safe", "clinicalRisk high + healthChat → emergency_safe");
    const pEmer = plan(uEmer, "medium", true, { level: 3, allowCard: false, healthChat: true });
    ok(pEmer.intendedAction === "emergency_safe", "emergency true + healthChat → emergency_safe");
  }

  console.log("== session chatPhase + turns ==");
  {
    sessionStore._clearAllForTests();
    const s = sessionStore.getSession(doctorId, "hc:turns");
    sessionStore.updateSession(s, {
      chatPhase: "intake",
      slots: { bodyPart: "上腹" },
      turn: { role: "user", text: "肚子疼", at: Date.now() }
    });
    sessionStore.updateSession(s, {
      turn: { role: "assistant", text: "哪里疼？", at: Date.now() }
    });
    const s2 = sessionStore.getSession(doctorId, "hc:turns");
    ok(s2.chatPhase === "intake", "chatPhase 持久");
    ok((s2.turns || []).some(t => t.role === "assistant"), "turns 含 assistant");
    ok(s2.slots && s2.slots.bodyPart === "上腹", "slots 合并");

    sessionStore._clearMemoryForTests();
    const s3 = sessionStore.getSession(doctorId, "hc:turns");
    ok(s3.chatPhase === "intake", "chatPhase 跨内存重载");
    ok((s3.turns || []).some(t => t.role === "assistant"), "turns 跨内存重载含 assistant");
  }

  console.log("== health_chat phase + evidence ==");
  {
    db.prepare(`INSERT INTO knowledge_items(doctor_id,layer,mode,title,body,source,owner,status,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?)`).run(
      doctorId, "医生个人", "半预制", "胆囊切除术后饮食",
      "胆囊切除术后饮食宜清淡，可逐步恢复鸡蛋等优质蛋白，避免油腻辛辣。仅供参考，请咨询医生。",
      "test", "ops", "ready", new Date().toISOString()
    );

    const r1 = await hc.resolveTurn({
      doctorId, text: "我肚子有点疼",
      session: sessionStore.getSession(doctorId, "hc:p1"),
      understood: understand({ doctorId, text: "我肚子有点疼" }),
      allowCard: false, emergency: false, clinicalRisk: "medium"
    });
    ok(r1.phase === "advise", "有症状主诉 → advise（答主问辅）");
    ok(!r1.attachCode, "advise 不附卡");

    const r2 = await hc.resolveTurn({
      doctorId, text: "胆囊切除后能吃鸡蛋吗",
      session: sessionStore.getSession(doctorId, "hc:p2"),
      understood: understand({ doctorId, text: "胆囊切除后能吃鸡蛋吗" }),
      allowCard: false, emergency: false, clinicalRisk: "low"
    });
    ok(r2.phase === "advise" || r2.evidence.sufficiency !== "none", "饮食问+知识 → advise 或有证据");
    ok(r2.usedRag === true, "饮食问触发 RAG");
    ok(!r2.attachCode, "advise 知识问不附卡");

    const rBelly = await hc.resolveTurn({
      doctorId, text: "我肚子有点疼",
      session: sessionStore.getSession(doctorId, "hc:norag"),
      understood: understand({ doctorId, text: "我肚子有点疼" }),
      allowCard: false, emergency: false, clinicalRisk: "medium"
    });
    ok(rBelly.usedRag === false && rBelly.evidence && rBelly.evidence.source === "skipped", "普通症状不强制 RAG");

    const r3 = await hc.resolveTurn({
      doctorId, text: "给我开点止痛药",
      session: sessionStore.getSession(doctorId, "hc:p3"),
      understood: understand({ doctorId, text: "给我开点止痛药" }),
      allowCard: true, emergency: false, clinicalRisk: "medium", level: 2
    });
    ok(r3.phase === "escalate", "开药 → escalate");

    const sessFever = sessionStore.getSession(doctorId, "hc:fever");
    sessionStore.updateSession(sessFever, { slots: { bodyPart: "下腹" }, chatPhase: "intake" });
    const r4 = await hc.resolveTurn({
      doctorId, text: "持续性的，有发烧",
      session: sessFever,
      understood: understand({ doctorId, text: "持续性的，有发烧" }),
      allowCard: false, emergency: false, clinicalRisk: "medium"
    });
    ok(r4.slots.hasFever === true && r4.slots.painPattern === "持续", "发烧+持续写入槽位");
    ok(r4.phase === "advise", "腹痛+发烧 → advise（给说明，非空 escalate）");
    const edu = await composeHealthChat({
      doctorId, text: "持续性的，有发烧", phase: "advise",
      slots: r4.slots, evidence: r4.evidence, urgent: true, missingSlots: r4.missingSlots,
      recentTurns: [], summary: ""
    });
    ok(/发热|发烧|就医|急诊|120|观察|体温/.test(edu.text), "发烧建议含就医说明");
    ok(edu.text.length <= 500, "建议 ≤500 字");
    ok(!/\*\*/.test(edu.text), "建议无 Markdown 加粗");
    ok(!/^为了更安全的判断，建议今天安排线下就医/.test(edu.text) || /观察|记录|体温|途中|警惕/.test(edu.text), "不只甩一句去医院");
  }

  console.log("== slots duration / topic switch / identity ==");
  {
    ok(understand({ doctorId, text: "半个小时" }).slots.duration === "半个小时", "半个小时 → duration");
    ok(understand({ doctorId, text: "我牙有点疼" }).slots.bodyPart === "牙齿", "牙疼 → bodyPart 牙齿");

    const merged = hc.mergeSlots(
      { bodyPart: "下腹", topicKey: "下腹", adviceDelivered: true, lastAdviceText: "旧建议" },
      understand({ doctorId, text: "我牙有点疼" })
    );
    ok(merged.bodyPart === "牙齿" && merged.topicKey === "牙齿", "话题切换到牙齿");
    ok(!merged.adviceDelivered, "切换话题清空 adviceDelivered");

    const idn = await composeHealthChat({
      doctorId, text: "你是谁", phase: "identity",
      slots: { bodyPart: "下腹" }, evidence: { sufficiency: "none", items: [] },
      recentTurns: [], summary: ""
    });
    ok(/吕富靖|消化/.test(idn.text), "你是谁 → 含医生名或科室");
    ok(!/下腹/.test(idn.text), "你是谁不复读下腹病情");

    const route = await composeHealthChat({
      doctorId, text: "我想找医生", phase: "route",
      slots: { bodyPart: "下腹" }, evidence: { sufficiency: "none", items: [] },
      recentTurns: [], summary: ""
    });
    ok(/请回复\s*101/.test(route.text), "找医生 → 请回复 101");
  }

  console.log("== composeHealthChat soft_template ==");
  {
    const out = await composeHealthChat({
      doctorId, text: "我肚子有点疼", phase: "advise",
      slots: { bodyPart: "腹部", hasMedicalCue: true, topicKey: "腹部" },
      evidence: { sufficiency: "none", items: [] },
      recentTurns: [], summary: ""
    });
    ok(out.ok && out.source === "soft_template", "advise → soft_template（TRIAGE_AI_DISABLED）");
    ok(out.text && /原因|立刻|警惕|观察/.test(out.text), "症状主诉直接给建议结构");
    ok((out.text.match(/[？?]/g) || []).length <= 1, "建议结尾追问≤1");
    ok(!/请发\s*101|发送\s*101/.test(out.text) || /请回复\s*101/.test(out.text), "可用请回复101，不强制请发");

    const dizzy = await composeHealthChat({
      doctorId, text: "我有点头晕", phase: "advise",
      slots: { symptoms: ["头晕"], topicKey: "头晕", hasMedicalCue: true },
      evidence: { sufficiency: "none", items: [] },
      recentTurns: [], summary: ""
    });
    ok(/头晕|休息|警惕/.test(dizzy.text), "头晕走建议模板");
    ok(!/下腹|小腹|肚子/.test(dizzy.text), "头晕建议不粘腹痛");

    const edu = await composeHealthChat({
      doctorId, text: "胆囊切除后能吃鸡蛋吗", phase: "advise",
      slots: {}, evidence: {
        sufficiency: "enough",
        items: [{ title: "术后饮食", body: "可逐步恢复鸡蛋等优质蛋白，避免油腻。仅供参考，请咨询医生。" }]
      },
      recentTurns: [], summary: ""
    });
    ok(edu.ok && edu.source === "soft_template", "advise 知识问 → soft_template");
    ok(/鸡蛋|蛋白|清淡|油腻/.test(edu.text), "advise 引用证据要点");
  }

  console.log("== risk health_chat sendPolicy ==");
  {
    const { sendPolicyFor } = require("./agent/risk.js");
    const p = sendPolicyFor({ clinicalRisk: "medium", intendedAction: "health_chat" });
    ok(p.sendPolicy === "auto" && p.canAutoSend === true, "medium+health_chat 教育可 auto");
    const p2 = sendPolicyFor({ clinicalRisk: "medium", intendedAction: "handoff" });
    ok(p2.sendPolicy === "review", "handoff 仍 review");
  }

  console.log("== runtime health_chat E2E ==");
  {
    process.env.HEALTH_CHAT_ENABLED = "1";
    process.env.TRIAGE_AI_DISABLED = "1";
    sessionStore._clearAllForTests();
    const agent = require("./agent/index.js");

    const r = await agent.runTurn({
      doctorId, text: "我肚子有点疼", patientKey: "hc:e2e1", isGroup: true
    });
    ok(r.source === "dialogue_agent", "仍为 dialogue_agent");
    ok(r.agentMeta && r.agentMeta.path === "health_chat", "path=health_chat");
    ok(!(r.responses || []).some(x => x && x.type === "mp"), "首轮不附小程序卡");
    const plain = (r.responses || []).filter(x => x && x.type === "text").map(x => x.text).join("\n");
    ok(/原因|立刻|警惕|观察|饮食|休息/.test(plain), "首轮直接给建议要点");
    ok((plain.match(/[？?]/g) || []).length <= 2, "首轮不连珠炮追问");

    // 截图同款三轮：发热不得掉进 agent_emergency 空模板
    sessionStore._clearAllForTests();
    const keyFever = "hc:e2e-fever";
    await agent.runTurn({ doctorId, text: "我肚子有点疼", patientKey: keyFever, isGroup: true });
    await agent.runTurn({ doctorId, text: "我小腹疼", patientKey: keyFever, isGroup: true });
    const rFever = await agent.runTurn({ doctorId, text: "持续性的，有发烧", patientKey: keyFever, isGroup: true });
    ok(rFever.agentMeta && rFever.agentMeta.path === "health_chat", "发烧续轮仍 health_chat（非 agent_emergency）");
    ok(rFever.agentMeta.compose && rFever.agentMeta.compose.phase === "advise", "发烧续轮 phase=advise");
    const feverText = (rFever.responses || []).filter(x => x && x.type === "text").map(x => x.text).join(" ");
    ok(/发热|发烧|就医|急诊|120|观察|体温|警惕/.test(feverText), "发烧回复含有用就医说明");
    ok(feverText.length <= 520, "发烧建议篇幅受控");
    ok(!/\*\*/.test(feverText), "E2E 无加粗标记");

    sessionStore._clearAllForTests();
    const keyDz = "hc:e2e-dizzy";
    await agent.runTurn({ doctorId, text: "我肚子有点疼", patientKey: keyDz, isGroup: true });
    const rDz = await agent.runTurn({ doctorId, text: "我有点头晕", patientKey: keyDz, isGroup: true });
    ok(rDz.agentMeta && rDz.agentMeta.compose && rDz.agentMeta.compose.phase === "advise", "头晕 → advise");
    const dzText = (rDz.responses || []).filter(x => x && x.type === "text").map(x => x.text).join(" ");
    ok(/头晕/.test(dzText) && !/下腹|小腹/.test(dzText), "头晕建议不粘下腹");
    const rPalp = await agent.runTurn({ doctorId, text: "我有心慌", patientKey: keyDz, isGroup: true });
    const palpText = (rPalp.responses || []).filter(x => x && x.type === "text").map(x => x.text).join(" ");
    ok(/心慌|休息|警惕/.test(palpText), "心慌给建议");
    ok(!/下腹|小腹/.test(palpText), "心慌不粘腹痛");

    const rWho = await agent.runTurn({ doctorId, text: "你是谁", patientKey: keyDz, isGroup: true });
    ok(rWho.agentMeta && rWho.agentMeta.compose && rWho.agentMeta.compose.phase === "identity", "你是谁 → identity");
    const whoText = (rWho.responses || []).filter(x => x && x.type === "text").map(x => x.text).join(" ");
    ok(/吕富靖|消化/.test(whoText), "人设含医生信息");

    const rDoc = await agent.runTurn({ doctorId, text: "我想找医生", patientKey: keyDz, isGroup: true });
    ok(rDoc.agentMeta && rDoc.agentMeta.compose && rDoc.agentMeta.compose.phase === "route", "找医生 → route");
    const docText = (rDoc.responses || []).filter(x => x && x.type === "text").map(x => x.text).join(" ");
    ok(/请回复\s*101/.test(docText), "找医生文案含请回复 101");

    sessionStore._clearAllForTests();
    await agent.runTurn({ doctorId, text: "我肚子有点疼", patientKey: "hc:e2e1", isGroup: true });
    await agent.runTurn({
      doctorId, text: "上腹，两天了，没加重", patientKey: "hc:e2e1", isGroup: true
    });
    const s = sessionStore.getSession(doctorId, "hc:e2e1");
    ok((s.turns || []).filter(t => t.role === "assistant").length >= 1, "已存 assistant 轮");

    sessionStore._clearAllForTests();
    await agent.runTurn({ doctorId, text: "我肚子有点疼", patientKey: "hc:e2e2", isGroup: true });
    const rCont = await agent.runTurn({
      doctorId, text: "上腹两天没加重", patientKey: "hc:e2e2", isGroup: true
    });
    ok(rCont.agentMeta && rCont.agentMeta.path === "health_chat", "续轮补症状仍 health_chat");
    ok(rCont.agentMeta && (rCont.agentMeta.phase || (rCont.agentMeta.compose && rCont.agentMeta.compose.phase)), "续轮有 phase");

    const rTooth = await agent.runTurn({ doctorId, text: "我牙有点疼", patientKey: "hc:e2e2", isGroup: true });
    const toothText = (rTooth.responses || []).filter(x => x && x.type === "text").map(x => x.text).join(" ");
    ok(/牙/.test(toothText) && !/下腹/.test(toothText), "换话题接住牙疼不粘下腹");

    const rEgg = await agent.runTurn({
      doctorId, text: "胆囊切除后能吃鸡蛋吗", patientKey: "hc:e2e-egg", isGroup: true
    });
    ok(rEgg.agentMeta && rEgg.agentMeta.path === "health_chat", "术后饮食问 → health_chat");
    ok(rEgg.agentMeta && (rEgg.agentMeta.phase === "advise" || rEgg.agentMeta.phase === "intake"
      || (rEgg.agentMeta.compose && (rEgg.agentMeta.compose.phase === "advise" || rEgg.agentMeta.compose.phase === "intake"))),
      "饮食问 phase advise|intake");
    ok(!(rEgg.responses || []).some(x => x && x.type === "mp"), "饮食问不附卡");

    const rMed = await agent.runTurn({
      doctorId, text: "给我开点止痛药", patientKey: "hc:e2e-med", isGroup: true
    });
    ok(rMed.agentMeta && rMed.agentMeta.path === "health_chat", "开药 → health_chat");
    ok(rMed.agentMeta && (rMed.agentMeta.phase === "escalate" || (rMed.agentMeta.compose && rMed.agentMeta.compose.phase === "escalate")), "开药 → escalate");

    ok(understand({ doctorId, text: "上腹两天没加重" }).medicalIntent === true, "上腹补述 → medicalIntent");
    ok(understand({ doctorId, text: "上腹两天没加重" }).slots.worsening === false, "没加重 → worsening false");

    delete process.env.HEALTH_CHAT_ENABLED;
    sessionStore._clearAllForTests();
    const rOld = await agent.runTurn({
      doctorId, text: "我肚子有点疼", patientKey: "hc:old", isGroup: true
    });
    ok(rOld.agentMeta && rOld.agentMeta.path !== "health_chat", "关开关不走 health_chat");
  }

  console.log("\n== 汇总 ==");
  console.log("断言 " + n + " 条，失败 " + fails.length);
  if (fails.length) {
    fails.forEach(f => console.log("FAIL: " + f));
    process.exit(1);
  }
  console.log("ALL PASS");
  process.exit(0);
})().catch(e => {
  console.error(e);
  process.exit(1);
});
