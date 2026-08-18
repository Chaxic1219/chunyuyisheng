/* Dialogue Agent 本地单测：无网络、TRIAGE_AI_DISABLED=1 */
const os = require("os"), path = require("path"), fs = require("fs");
const TMP = path.join(os.tmpdir(), "chunyu_agent_test.db");
[TMP, TMP + "-wal", TMP + "-shm"].forEach(f=>{ try{ fs.unlinkSync(f); }catch(e){} });
process.env.DB_PATH = TMP;
process.env.TRIAGE_AI_DISABLED = "1";
process.env.DIALOGUE_AGENT_ENABLED = "1";
process.env.AGENT_DRY_RUN = "1";
delete process.env.HEALTH_CHAT_ENABLED; // 本文件断言旧 reply_advice 路径，勿被本机 .env 打开 health_chat

const { db } = require("./db.js");
const agent = require("./agent/index.js");
const { evaluateRisk, sendPolicyFor } = require("./agent/risk.js");
const { understand } = require("./agent/understand.js");
const { isPureCodeUtterance } = require("./agent/runtime.js");
const sessionStore = require("./agent/session.js");

let n = 0, fails = [];
const ok = (c, m) => { n++; if(!c){ fails.push(m); console.log("  ✗ " + m); } else console.log("  ✓ " + m); };

(async ()=>{
  const lv = db.prepare("SELECT id FROM doctors WHERE slug='lvfujing'").get();
  ok(!!lv, "种子医生 lvfujing 存在");
  const doctorId = lv.id;
  sessionStore._clearAllForTests();

  console.log("== 开关 ==");
  ok(agent.agentEnabled() === true, "DIALOGUE_AGENT_ENABLED=1");
  ok(agent.agentDryRun() === true, "AGENT_DRY_RUN=1 时演练开");

  console.log("== 编号快路径 ==");
  ok(isPureCodeUtterance("101") === true, "101 视为纯编号");
  ok(isPureCodeUtterance("想咨询一下") === false, "自然语言不是纯编号");
  {
    const r = await agent.runTurn({ doctorId, text:"101", patientKey:"t:code", isGroup:true });
    ok(r.source === "code_fast_path", "101 → code_fast_path");
    ok(r.intentCode === "101" || (r.responses && r.responses.length > 0), "101 有响应/intentCode");
    const texts = (r.responses || []).filter(x=>x && x.type === "text").map(x=>String(x.text || ""));
    ok(texts.some(t=>/为保护您的隐私|1对1 咨询|一对一/.test(t)), "101 快路径须带运营引导语");
    ok((r.responses || []).some(x=>x && (x.type === "mp" || (x.external && x.external.mode === "mini_program"))), "101 快路径仍附小程序卡");
  }
  {
    const r = await agent.runTurn({ doctorId, text:"1", patientKey:"t:menu", isGroup:true });
    ok(r.source === "code_fast_path" && (r.menu || (r.responses && r.responses[0])), "菜单口令走快路径");
  }
  {
    const r = await agent.runTurn({ doctorId, text:"医患联络表", patientKey:"t:contact", isGroup:true });
    ok(r.source === "code_fast_path", "医患联络表别名 → code_fast_path（不得落入 dialogue_agent）");
    ok(r.intentCode === "979" || r.intentCode === "联络表" || (r.responses || []).some(x=>x && (x.type === "mp" || x.type === "link")), "医患联络表快路径有联络表卡");
  }

  console.log("== 风险两轴 ==");
  {
    const p = sendPolicyFor({ clinicalRisk:"low", intendedAction:"open_chunyu_card" });
    ok(p.sendPolicy === "auto" && p.canAutoSend === true, "low+发卡 → auto");
  }
  {
    const p = sendPolicyFor({ clinicalRisk:"medium", intendedAction:"open_chunyu_card", hasMedicalAdviceText:false });
    ok(p.sendPolicy === "card_only" && p.canAutoSend === true, "medium+仅发卡 → card_only 可自动");
  }
  {
    const p = sendPolicyFor({ clinicalRisk:"medium", intendedAction:"reply_medical_advice", hasMedicalAdviceText:true });
    ok(p.sendPolicy === "review" && p.canAutoSend === false, "medium+医疗建议 → review");
  }
  {
    const p = sendPolicyFor({ clinicalRisk:"medium", intendedAction:"reply_advice", hasMedicalAdviceText:false });
    ok(p.sendPolicy === "auto" && p.canAutoSend === true && p.needsHuman === true, "medium+建议话术 → auto 可真发仍需人工");
  }
  {
    const p = sendPolicyFor({ clinicalRisk:"high", emergency:true, intendedAction:"reply_service" });
    ok(p.sendPolicy === "block", "high/emergency → block(安全模板)");
  }

  console.log("== 自然语言服务 ==");
  {
    const r = await agent.runTurn({ doctorId, text:"想找吕主任咨询一下", patientKey:"t:consult", isGroup:true, patientName:"测试" });
    ok(r.source === "dialogue_agent", "自然语言 → dialogue_agent");
    // L4 但明确服务诉求（咨询/找医生）→ 自动附贴片
    const hasCardTool = (r.toolCalls || []).some(t=>t.name === "open_chunyu_card");
    const hasMp = (r.responses || []).some(x=>x && (x.type === "mp" || x.type === "link" || (x.external && (x.external.mode === "mini_program" || x.external.shortLink || x.external.url))));
    ok(hasCardTool || hasMp, "明确咨询意图自动附卡");
    const text = (r.responses || []).filter(x=>x.type === "text").map(x=>x.text).join("\n");
    ok(text.length > 40, "有自然引导文案");
    ok(!/请您?发送\s*「?101」?/.test(text) && !/发「101」/.test(text), "引导文案不强迫发编号口令");
    ok(r.agentMeta && r.agentMeta.compose && r.agentMeta.compose.source, "记录 compose 来源");
  }
  {
    const r = await agent.runTurn({ doctorId, text:"怎么挂号看出诊时间", patientKey:"t:sched", isGroup:true });
    ok(r.source === "dialogue_agent", "挂号意图走 agent");
    ok(r.agentMeta && r.agentMeta.plan && r.agentMeta.plan.goal === "schedule", "映射 schedule 目标");
    const hasMp = (r.responses || []).some(x=>x && (x.type === "mp" || x.type === "link"));
    ok(hasMp || (r.toolCalls || []).some(t=>t.name === "open_chunyu_card"), "明确挂号意图自动附卡");
    const text = (r.responses || []).filter(x=>x.type === "text").map(x=>x.text).join("");
    ok(!/转人工关注|拨打\s*120/.test(text), "纯挂号文案不含医疗转人工/120");
    ok(r.agentMeta && r.agentMeta.plan && r.agentMeta.plan.handoff === false, "纯挂号不 handoff");
  }
  {
    const r = await agent.runTurn({ doctorId, text:"看看医生简介", patientKey:"t:profile", isGroup:true });
    ok(r.agentMeta && r.agentMeta.plan && r.agentMeta.plan.goal === "profile", "简介意图映射 profile（不被看看医生截胡）");
    const text = (r.responses || []).filter(x=>x.type === "text").map(x=>x.text).join("");
    ok(text.length >= 40, "简介/服务引导语足够");
    ok(!(r.toolCalls || []).some(t=>t.name === "open_chunyu_card"), "非 L2 简介不附卡");
    ok(!/转人工关注|拨打\s*120/.test(text), "纯简介文案不含医疗转人工/120");
  }

  console.log("== 医疗交接 ==");
  {
    const triage = require("./triage.js");
    const u = understand({ doctorId, text:"胃痛三天了想开点药" });
    ok(u.medicalIntent === true && u.slots.asksMedication === true, "识别开药医疗意图");
    // 与 runtime 相同 opts：asksMedication → needsDoctor → L2
    const clinicalPre = evaluateRisk(u, { slots:{} }, { intendedAction:"reply_service" });
    const lvlMed = triage.classifyLevel("胃痛三天了想开点药", doctorId, {
      riskLevel: clinicalPre.clinicalRisk,
      needsHuman: clinicalPre.needsHuman,
      emergency: clinicalPre.emergency,
      riskTriggers: clinicalPre.floorTriggers || clinicalPre.triggers,
      needsDoctor: !!(u.slots && u.slots.asksMedication)
        || (typeof triage.needsDoctorFromTriggers === "function"
            && triage.needsDoctorFromTriggers(clinicalPre.floorTriggers || clinicalPre.triggers))
    });
    ok(lvlMed.level === 2 && triage.canAttachMiniProgram(lvlMed.level), "开药 asksMedication → L2 可附卡");
    const r = await agent.runTurn({ doctorId, text:"胃痛三天了想开点药", patientKey:"t:med", isGroup:true });
    ok(r.source === "dialogue_agent", "开药 → agent");
    ok(r.triage && r.triage.needsHuman === true, "需要人工");
    ok(r.handoff === true || r.triage.sendPolicy === "card_only" || r.triage.sendPolicy === "review", "handoff 或 card_only/review");
    const text = (r.responses || []).filter(x=>x.type === "text").map(x=>x.text).join("");
    ok(text.length >= 48, "医疗交接引导语足够丰富");
    ok(!/吃点|服用|开药吧|可能是胃炎/.test(text), "交接语不含诊断用药");
    const allowCard = r.agentMeta && r.agentMeta.compose && r.agentMeta.compose.allowCard === true;
    const hasCardTool = (r.toolCalls || []).some(t=>t.name === "open_chunyu_card");
    const hasMp = (r.responses || []).some(x=>x && (x.type === "mp" || x.type === "link" || (x.external && x.external.mode === "mini_program")));
    ok(allowCard || hasCardTool || hasMp || r.intentCode === "101", "开药 E2E：L2 allowCard / 附卡 / preferred 101");
  }
  {
    const r = await agent.runTurn({ doctorId, text:"我肚子疼怎么办", patientKey:"t:belly", isGroup:true });
    const text = (r.responses || []).filter(x=>x.type === "text").map(x=>x.text).join("");
    ok(text.length >= 48, "肚子疼场景引导语足够丰富");
    ok(/观察|人工|急诊|120|就医|加重/.test(text), "肚子疼场景含建议与安全提示");
    const hasMp = (r.responses || []).some(x=>x && (x.type === "mp" || x.type === "link" || (x.external && (x.external.mode === "mini_program" || x.external.shortLink))));
    ok(!hasMp, "L4/非 L2 肚子疼不附 mp/link 卡");
    ok(!(r.toolCalls || []).some(t=>t.name === "open_chunyu_card"), "肚子疼不调度 open_chunyu_card");
    ok(!/小程序|发\s*101|附上.*入口/.test(text), "建议文案不引流小程序/101");
    ok(r.triage && r.triage.canAutoSend === true, "肚子疼建议话术可自动发到群（不静默）");
    ok(r.agentMeta && r.agentMeta.plan && r.agentMeta.plan.intendedAction === "reply_advice", "肚子疼 → reply_advice");
  }
  {
    sessionStore._clearAllForTests();
    const key = "t:repeat-card";
    const first = await agent.runTurn({ doctorId, text:"我肚子疼怎么办", patientKey:key, isGroup:true });
    const second = await agent.runTurn({ doctorId, text:"我牙疼怎么办", patientKey:key, isGroup:true });
    ok(second.source === "dialogue_agent", "连续症状补充仍走 agent");
    ok(!(second.toolCalls || []).some(t=>t.name === "open_chunyu_card"), "活跃医疗会话内抑制重复 101 贴片");
    const txt = (second.responses || []).filter(x=>x.type === "text").map(x=>x.text).join(" ");
    ok(/牙疼|疼|症状|变化|多久/.test(txt), "后续回复继续围绕当前补充追问，不只贴片");
  }
  {
    const groupGate = require("./group_gate.js");
    const gate = groupGate.shouldHandleGroupText({ doctorId, text:"我打算直接找周主任", patientKey:"t:find-director" });
    ok(gate.ok === true, "找主任诉求不过闲聊门控");
    sessionStore._clearAllForTests();
    const key = "t:find-director";
    await agent.runTurn({ doctorId, text:"你好医生，我最近感觉有点失眠", patientKey:key, isGroup:true });
    const r = await agent.runTurn({ doctorId, text:"我打算直接找周主任", patientKey:key, isGroup:true });
    ok(r.source === "dialogue_agent", "找主任走 agent");
    ok((r.toolCalls || []).some(t=>t.name === "open_chunyu_card"), "找主任自动附 101 贴片");
    const txt = (r.responses || []).filter(x=>x.type === "text").map(x=>x.text).join(" ");
    ok(/问诊|一对一|入口|主任/.test(txt), "找主任引导语自然");
    ok(!/最想先办哪一件|挂号\/出诊、加号、简介或问诊/.test(txt), "找主任不应落澄清模板");
  }
  {
    // L2 需医生：用药确认类 — 无 forced needsDoctor，understand + bare classify + E2E
    const triage = require("./triage.js");
    const groupGate = require("./group_gate.js");
    const phrase = "这个药还能继续吃吗";
    const u = understand({ doctorId, text:phrase });
    ok(u.slots.asksMedication === true, "understand asksMedication（无 forced opts）");
    ok(u.medicalIntent === true, "understand medicalIntent via asksMedication");
    const bareScan = triage.scanRisk(phrase);
    ok(bareScan.riskLevel === "medium", "scanRisk bare → medium");
    const bareLvl = triage.classifyLevel(phrase, doctorId);
    ok(bareLvl.level === 2 && triage.canAttachMiniProgram(bareLvl.level), "bare classify → L2 可附卡");
    const gate = groupGate.shouldHandleGroupText({ text:phrase, doctorId });
    ok(gate.ok === true, "group_gate 用药确认 ok");
    const r = await agent.runTurn({ doctorId, text:phrase, patientKey:"t:med-continue", isGroup:true });
    const allowCard = r.agentMeta && r.agentMeta.compose && r.agentMeta.compose.allowCard === true;
    const hasCardTool = (r.toolCalls || []).some(t=>t.name === "open_chunyu_card");
    const hasMp = (r.responses || []).some(x=>x && (x.type === "mp" || x.type === "link" || (x.external && x.external.mode === "mini_program")));
    ok(allowCard || hasCardTool || hasMp || (r.triage && r.triage.level === 2), "用药确认 E2E：L2/allowCard/附卡（无 forced opts）");
  }

  console.log("== 闲聊静默 ==");
  {
    process.env.HEALTH_CHAT_ENABLED = "1";
    sessionStore._clearAllForTests();
    const key = "t:ops-chitchat";
    await agent.runTurn({ doctorId, text:"我肚子有点疼", patientKey:key, isGroup:true });
    const r = await agent.runTurn({ doctorId, text:"应该的配置完了", patientKey:key, isGroup:true });
    ok(r.agentMeta && r.agentMeta.path === "chitchat_silent", "问诊中运维口语 → chitchat_silent");
    ok(!(r.responses || []).length, "无关闲聊不产出回复");
    ok(r.triage && r.triage.level === 6, "无关闲聊 L6");
    delete process.env.HEALTH_CHAT_ENABLED;
  }

  console.log("== 澄清 ==");
  {
    const r = await agent.runTurn({ doctorId, text:"帮我弄一下那个事", patientKey:"t:clarify", isGroup:true });
    ok(r.source === "dialogue_agent", "模糊诉求走 agent");
    const text = (r.responses || []).map(x=>x.text || "").join("");
    ok(/问诊|挂号|加号|住院|哪一项|需求/.test(text), "澄清引导可选服务");
  }

  console.log("== 会话持久化 ==");
  {
    sessionStore._clearAllForTests();
    const key = "persist:user-a";
    await agent.runTurn({ doctorId, text:"想咨询", patientKey:key, isGroup:true });
    const mem = sessionStore.getSession(doctorId, key);
    ok(!!mem.goal || (mem.turns && mem.turns.length > 0), "内存会话已更新");
    const row = db.prepare("SELECT * FROM agent_sessions WHERE doctor_id=? AND patient_key=?").get(doctorId, key);
    ok(!!row, "agent_sessions 已落库");
    sessionStore._clearMemoryForTests(); // 只清内存，保留 DB
    const again = sessionStore.getSession(doctorId, key);
    ok(!!again && (again.goal || (again.turns && again.turns.length)), "清内存后可从 DB 恢复会话");
  }

  console.log("== 附件信号 ==");
  {
    sessionStore._clearAllForTests();
    const r = await agent.runTurn({
      doctorId,
      text:"帮看下这个化验单",
      patientKey:"t:attach",
      isGroup:true,
      attachments:[{ type:"image", name:"血常规化验报告.jpg" }]
    });
    ok(r.source === "dialogue_agent", "带附件走 agent");
    ok(r.handoff === true || (r.triage && r.triage.needsHuman), "附件转人工");
    // 附件仅在 L2 可附卡；非 L2 走建议+交接
    const hasCard = (r.toolCalls || []).some(t=>t.name === "open_chunyu_card")
      || (r.responses || []).some(x=>x && (x.type === "mp" || x.type === "link"));
    if(r.agentMeta && r.agentMeta.compose && r.agentMeta.compose.allowCard){
      ok(hasCard || r.intentCode === "101", "L2 附件可附问诊卡");
    }else{
      ok(!hasCard, "非 L2 附件不附卡");
    }
    ok(r.agentMeta && r.agentMeta.understood && r.agentMeta.understood.attachments
      && r.agentMeta.understood.attachments.some(a=>a.hint === "report_like"), "识别报告类附件");
  }

  console.log("== evaluateRisk 集成 ==");
  {
    const u = understand({ doctorId, text:"想咨询" });
    const risk = evaluateRisk(u, { slots:{} }, { intendedAction:"open_chunyu_card" });
    ok(risk.clinicalRisk === "low" && risk.sendPolicy === "auto", "纯咨询服务 low+auto");
  }

  console.log("== 医疗健康子人设 ==");
  {
    const r = await agent.runTurn({ doctorId, text:"体检报告转氨酶偏高严重吗", patientKey:"t:report", isGroup:true });
    ok(r.source === "dialogue_agent", "报告解读 → dialogue_agent");
    ok(r.agentMeta && r.agentMeta.plan && r.agentMeta.plan.goal === "health_report", "plan goal health_report");
    ok(r.agentMeta && r.agentMeta.understood && r.agentMeta.understood.healthcarePersona
      && r.agentMeta.understood.healthcarePersona.key === "health_report", "meta 记录子人设");
    const text = (r.responses || []).filter(x=>x.type === "text").map(x=>x.text).join("");
    ok(text.length >= 40, "报告场景有足够引导语");
    ok(/报告|指标|原件|医助|线下/.test(text), "报告引导含关键口径");
    ok(!/可能是|诊断为|吃药/.test(text), "报告引导不诊断用药");
  }
  {
    const r = await agent.runTurn({ doctorId, text:"帮我整理病史，什么时候开始的", patientKey:"t:case", isGroup:true });
    ok(r.agentMeta && r.agentMeta.plan && r.agentMeta.plan.goal === "case_analysis", "病例整理 goal");
    const text = (r.responses || []).filter(x=>x.type === "text").map(x=>x.text).join("");
    ok(/开始|时间|症状|医助/.test(text), "病例整理追问时间线");
  }
  {
    const r = await agent.runTurn({ doctorId, text:"术后饮食要注意什么", patientKey:"t:care", isGroup:true });
    ok(r.agentMeta && r.agentMeta.plan && r.agentMeta.plan.goal === "care_plan", "护理 goal");
    const text = (r.responses || []).filter(x=>x.type === "text").map(x=>x.text).join("");
    ok(/饮食|休息|急诊|医助/.test(text), "护理建议口径");
  }

  console.log("== AI 档位分类器 (stub) ==");
  {
    const triageMod = require("./triage.js");
    const prevClassifier = process.env.AI_LEVEL_CLASSIFIER;
    const prevDisabled = process.env.TRIAGE_AI_DISABLED;
    process.env.AI_LEVEL_CLASSIFIER = "1";
    process.env.TRIAGE_AI_DISABLED = "0";
    const origAssess = triageMod.assessLevelLLM;
    triageMod.assessLevelLLM = async () => ({ riskLevel:"medium", needsDoctor:false, reason:"test" });
    try{
      const r = await agent.runTurn({ doctorId, text:"我肚子疼怎么办", patientKey:"t:belly-ai", isGroup:true });
      ok(r.source === "dialogue_agent", "AI classifier stub → dialogue_agent");
      ok(r.agentMeta && r.agentMeta.level === 3, "AI 抬 medium+!needsDoctor → L3");
      ok(r.agentMeta && r.agentMeta.compose && r.agentMeta.compose.levelSource, "记录 levelSource");
      ok(r.agentMeta && r.agentMeta.plan && r.agentMeta.plan.intendedAction === "reply_advice", "L3 → reply_advice");
      ok(r.triage && r.triage.canAutoSend === true, "L3 建议话术可自动发");
      ok(r.triage && r.triage.needsDoctor === false, "stub needsDoctor=false");
      ok(r.triage && r.triage.level === 3, "triage.level L3");
      ok(r.triage && r.triage.riskLevel === "medium", "triage.riskLevel AI-raised medium");
      const hasMp = (r.responses || []).some(x=>x && (x.type === "mp" || x.type === "link" || (x.external && (x.external.mode === "mini_program" || x.external.shortLink))));
      ok(!hasMp, "L3 不附 mp/link 卡");
    }finally{
      triageMod.assessLevelLLM = origAssess;
      if(prevClassifier === undefined) delete process.env.AI_LEVEL_CLASSIFIER;
      else process.env.AI_LEVEL_CLASSIFIER = prevClassifier;
      if(prevDisabled === undefined) delete process.env.TRIAGE_AI_DISABLED;
      else process.env.TRIAGE_AI_DISABLED = prevDisabled;
    }
  }

  console.log("== 禁模板句清洗 + 找医生必附卡 ==");
  {
    const { scrubBannedPhrases, lightCleanLlmText } = require("./agent/compose.js");
    const dirty = "头疼啊。我先帮您记一下，您说头有点疼。这位朋友，请您补充以下信息。";
    const cleaned = scrubBannedPhrases(dirty);
    ok(!/我先帮您记一下|这位朋友|请您补充以下信息/.test(cleaned), "scrubBannedPhrases 去掉机械句");
    ok(/头疼|头有点疼/.test(cleaned), "scrubBannedPhrases 保留有效内容");
    const llmClean = lightCleanLlmText("好的，我先记下了。您方便说说哪里不舒服吗？");
    ok(!/我先记下了/.test(llmClean), "lightCleanLlmText 同步清洗禁句");
  }
  {
    const { runTools } = require("./agent/tools.js");
    // 模拟 L4 + allowCard=true（显式找医生）：不得被 level 二次否决
    const out = runTools(doctorId, [{ name:"open_chunyu_card", args:{ code:"101" } }], { level:4, allowCard:true });
    ok((out.codes || []).includes("101") || (out.responses || []).length > 0, "allowCard=true 时 L4 仍附 101");
    const blocked = runTools(doctorId, [{ name:"open_chunyu_card", args:{ code:"101" } }], { level:4, allowCard:false });
    ok(!(blocked.codes || []).includes("101"), "allowCard=false 时 L4 不附卡");
  }
  {
    sessionStore._clearAllForTests();
    const key = "t:find-online";
    await agent.runTurn({ doctorId, text:"我头有点疼", patientKey:key, isGroup:true });
    const r = await agent.runTurn({ doctorId, text:"我想线上找周医生", patientKey:key, isGroup:true });
    ok(r.source === "dialogue_agent", "线上找医生走 agent");
    ok((r.toolCalls || []).some(t=>t.name === "open_chunyu_card"), "线上找医生必调度 open_chunyu_card");
    const hasMp = (r.responses || []).some(x=>x && (x.type === "mp" || x.type === "link" || (x.external && x.external.mode === "mini_program")));
    ok(hasMp || (r.toolCalls || []).some(t=>t.name === "open_chunyu_card"), "线上找医生应附贴片或保留开卡工具");
    const txt = (r.responses || []).filter(x=>x.type === "text").map(x=>x.text).join(" ");
    ok(!/我先记下了|我先帮您记一下|请您补充以下信息/.test(txt), "找医生回复不含禁模板句");
  }

  console.log("\n== 汇总 ==");
  console.log("断言 " + n + " 条，失败 " + fails.length);
  if(fails.length){
    fails.forEach(f=>console.log("FAIL: " + f));
    process.exit(1);
  }
  console.log("ALL PASS");
  process.exit(0);
})().catch(e=>{
  console.error(e);
  process.exit(1);
});
