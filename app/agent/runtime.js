/* Dialogue Agent Runtime：编号快路径 + 理解/风险/计划/工具/合成 */
const engine = require("../engine.js");
const triage = require("../triage.js");
const { db } = require("../db.js");
const { buildMenuText, withConfiguredCodeScript, scienceContent } = require("../patient_reply.js");
const sessionStore = require("./session.js");
const { understand } = require("./understand.js");
const { evaluateRisk } = require("./risk.js");
const { plan } = require("./planner.js");
const { runTools } = require("./tools.js");
const { compose } = require("./compose.js");
const { agentDryRun, healthChatEnabled, healthChatFirstReview } = require("./flags.js");
const { createFixedWindowLimiter } = require("../rate_limit.js");

// 企微群侧 LLM 调用限流：按 doctorId::patientKey 固定窗口，默认 30 次/分钟，防群消息洪水打爆上游。
const LLM_RATE_LIMIT = Math.min(Math.max(+(process.env.LLM_RATE_LIMIT || 30), 1), 200);
const llmLimiter = createFixedWindowLimiter({ limit: LLM_RATE_LIMIT, windowMs: 60_000 });
const healthChat = require("./health_chat.js");
const { composeHealthChat } = require("./compose_health_chat.js");
const { isHealthcarePersonaGoal } = require("./persona_router.js");
const { splitReplyBubbles, resolveReplyBubbleConfig } = require("../reply_bubbles.js");
const groupGate = require("../group_gate.js");

function clean(v, n){
  return String(v == null ? "" : v).trim().slice(0, n || 1200);
}

function isPureCodeUtterance(text){
  const t = clean(text, 40);
  if(!t) return false;
  // 纯编号或常见菜单口令 → 硬跳转
  if(/^(菜单|功能|全部功能|群功能|群功能菜单|功能菜单)$/i.test(t)) return true;
  if(/^\d{1,4}$/.test(t)) return true;
  return false;
}

function fillPatient(responses, patientName, omitName){
  const pname = omitName ? "" : clean(patientName, 20);
  const list = JSON.parse(JSON.stringify(Array.isArray(responses) ? responses : []));
  list.forEach(r=>{
    if(r && typeof r.text === "string"){
      r.text = r.text.replace(/@?\{patient\}\s?/g, pname ? (pname + " ") : "");
    }
  });
  return list;
}

const MEDICAL_SESSION_GOALS = new Set([
  "advice", "consult", "health_report", "case_analysis", "care_plan", "medical_handoff", "safety"
]);

function recentUserTurnsSummary(session){
  const turns = Array.isArray(session && session.turns) ? session.turns.filter(t=>t && t.role === "user").slice(-5) : [];
  return turns.map(t=>String(t.text || "").trim()).filter(Boolean).join("；");
}

function knownMedicalFacts(session, understood){
  const slots = Object.assign({}, (session && session.slots) || {}, (understood && understood.slots) || {});
  const facts = [];
  if(slots.duration) facts.push("持续时间：" + String(slots.duration));
  if(slots.symptoms && slots.symptoms.length) facts.push("症状：" + slots.symptoms.slice(0, 6).join("、"));
  if(slots.worsening) facts.push("有加重趋势");
  if(slots.hasMedicalCue) facts.push("患者有明确不适主诉");
  if(slots.asksMedication) facts.push("患者提到用药相关问题");
  return facts.join("；");
}

function shouldSuppressRepeatCard(session, understood, planned){
  if(!session || !understood || !planned) return false;
  if(planned.preferredCode !== "101") return false;
  if(understood.service && understood.service.goal) return false; // 显式服务诉求仍允许开卡
  if(!understood.medicalIntent && !understood.healthcarePersona) return false;
  const prevGoal = session.goal;
  if(!prevGoal || !MEDICAL_SESSION_GOALS.has(prevGoal)) return false;
  const turns = Array.isArray(session.turns) ? session.turns.slice(-3) : [];
  const hasRecentMedicalTurn = turns.some(t=>t && t.goal && MEDICAL_SESSION_GOALS.has(t.goal));
  return hasRecentMedicalTurn;
}

function explicitServiceAllowsCard(understood){
  const svc = understood && understood.service;
  if(!svc || !svc.preferredCode) return false;
  return ["consult", "video", "schedule", "add_clinic", "admission"].includes(svc.goal);
}

function suppressRepeatCardPlan(planned){
  const next = Object.assign({}, planned || {});
  next.toolCalls = (planned.toolCalls || []).filter(t=>t && t.name !== "open_chunyu_card");
  next.preferredCode = null;
  next.intendedAction = "reply_advice";
  next.note = ((planned.note ? planned.note + "|" : "") + "repeat_card_suppressed");
  return next;
}

async function runCodeFastPath(input){
  const doctorId = Number(input.doctorId);
  const text = clean(input.text, 500);
  const matched = engine.match(doctorId, text);
  if(!matched) return null;

  const omit = !!input.isGroup;
  const patientName = clean(input.patientName, 40) || "群友";
  if(matched.menu){
    let content = {};
    try{ content = JSON.parse((db.prepare("SELECT content FROM doctors WHERE id=?").get(doctorId) || {}).content || "{}"); }catch(e){ content = {}; }
    const menuText = buildMenuText(content);
    return {
      bot:"医助",
      source:"code_fast_path",
      menu:true,
      menuText,
      responses:[{ type:"text", text:menuText }],
      triage:{ riskLevel:"low", clinicalRisk:"low", sendPolicy:"auto", canAutoSend:true, needsHuman:false },
      autoSent:true,
      dryRun:agentDryRun(),
      toolCalls:[{ name:"open_menu", args:{} }],
      agentMeta:{ path:"code_fast_path" }
    };
  }

  // 与 buildPatientReply 对齐：101 等规则常只有 mp/qr，运营引导语在 code{N} 脚本里；
  // 漏插脚本 → weappReady 时省略卡/二维码后 replyText 为空 → 群里只见贴片。
  let responses = fillPatient(matched.responses || [], patientName, omit);
  if(matched.code){
    responses = withConfiguredCodeScript(doctorId, matched.code, responses, patientName, { omitPatientName:omit });
    try{
      const row = db.prepare("SELECT content FROM doctors WHERE id=?").get(doctorId);
      responses = scienceContent.gateScienceCodeResponses(matched.code, responses, row && row.content);
    }catch(e){}
  }
  return {
    bot: matched.bot || "医助",
    source:"code_fast_path",
    responses,
    intentCode: matched.code || null,
    triage:{ riskLevel:"low", clinicalRisk:"low", sendPolicy:"auto", canAutoSend:true, needsHuman:false },
    autoSent:true,
    dryRun:agentDryRun(),
    toolCalls: matched.code ? [{ name:"open_chunyu_card", args:{ code:matched.code } }] : [],
    agentMeta:{ path:"code_fast_path", code:matched.code }
  };
}

function buildSilentChitchatReply(input, session, understood, resolved){
  const levelInfo = (resolved && resolved.levelInfo) || { level:6, label:"闲聊", action:"silent" };
  return {
    bot:"医助",
    source:"dialogue_agent",
    responses:[],
    triage:{
      riskLevel:"low",
      clinicalRisk:"low",
      sendPolicy:"silent",
      canAutoSend:false,
      needsHuman:false,
      needsDoctor:false,
      level:6,
      levelSource:(resolved && resolved.source) || "chitchat_gate",
      emergency:false,
      triggers:[],
      suggestedAction:"闲聊静默"
    },
    sessionId: session && session.id ? session.id : null,
    autoSent:false,
    dryRun:agentDryRun(),
    handoff:false,
    agentMeta:{
      path:"chitchat_silent",
      skipped:"group_chitchat",
      level:6,
      levelSource:(resolved && resolved.source) || "chitchat_gate",
      understood:{
        service:understood && understood.service,
        medicalIntent:!!(understood && understood.medicalIntent),
        healthcarePersona:understood && understood.healthcarePersona
      }
    }
  };
}

async function runAgentPath(input){
  const doctorId = Number(input.doctorId);
  const text = clean(input.text, 1000);
  const patientKey = clean(input.patientKey, 120) || ("agent:" + doctorId);
  const patientName = clean(input.patientName, 40) || "群友";
  const omit = !!input.isGroup;

  // 群侧 LLM 限流（fail-open：限流器异常不阻断回复）：真实 Agent 路径每 patientKey 每分钟受 LLM_RATE_LIMIT 约束。
  const rateKey = String(doctorId) + "::" + String(patientKey);
  try{
    const rate = llmLimiter.consume(rateKey);
    if(!rate.allowed){
      console.warn("[agent] LLM rate-limited key=" + rateKey, "retryAfter=" + rate.retryAfter + "s");
      const err = new Error("消息太密集，请稍后再试");
      err.status = 429;
      err.retryAfter = rate.retryAfter;
      throw err;
    }
  }catch(e){
    if(e && e.status === 429) throw e;
  }

  const session = sessionStore.getSession(doctorId, patientKey);

  const understood = understand({
    doctorId,
    text,
    attachments: input.attachments
  });

  // 上下文+画像感知分级的输入构建（2026-08-05）：
  //  - contextBlock：最近对话轮次 + 会话摘要 + 当前主题
  //  - profileBlock：患者档案（单聊用 dm 全档，群聊用脱敏称呼）
  //  - prevRiskLevel：会话历史风险档（供「历史不降级」相对性修正）
  const riskCtx = (()=>{
    try{
      const turns = Array.isArray(session.turns) ? session.turns.slice(-5) : [];
      const ctxLines = [];
      if(Array.isArray(turns) && turns.length){
        for(const t of turns){
          if(!t || !t.text) continue;
          const role = t.role === "user" ? "患者" : "医助";
          ctxLines.push(role + "：" + String(t.text).slice(0, 120));
        }
      }
      if(session.summary) ctxLines.push("摘要：" + String(session.summary).slice(0, 200));
      if(session.slots && session.slots.topicKey) ctxLines.push("当前主题：" + String(session.slots.topicKey).slice(0, 40));
      const contextBlock = ctxLines.join("\n");
      const profileBlock = input.isGroup
        ? (triage.groupPatientProfileBlock ? triage.groupPatientProfileBlock(patientName) : "")
        : (triage.dmPatientProfileBlock && input.patientId
            ? triage.dmPatientProfileBlock(doctorId, input.patientId, patientName)
            : (triage.groupPatientProfileBlock ? triage.groupPatientProfileBlock(patientName) : ""));
      const prevRiskLevel = (session.slots && session.slots.__prevRiskLevel)
        || session.prevRiskLevel || null;
      return { contextBlock, profileBlock, prevRiskLevel };
    }catch(e){
      return { contextBlock:"", profileBlock:"", prevRiskLevel:null };
    }
  })();

  const resolvedEarly = await triage.resolveMessageLevelAsync(text, doctorId, riskCtx);
  const unrelatedChitchat = groupGate.isUnrelatedChitchat(text, session)
    && !understood.medicalIntent
    && !(understood.service && (understood.service.preferredCode || understood.service.goal === "menu"));
  if(unrelatedChitchat){
    return buildSilentChitchatReply(input, session, understood, resolvedEarly);
  }

  // 保留本轮前槽位快照：health_chat 要用旧部位检测话题切换；不可先 merge 污染
  const slotsBeforeTurn = Object.assign({}, session.slots || {});
  sessionStore.updateSession(session, { slots:understood.slots });

  const clinical = evaluateRisk(understood, session, { intendedAction:"reply_service" });
  const resolved = await triage.resolveMessageLevelAsync(text, doctorId, riskCtx);
  // 记录本轮风险档，供下一轮「历史不降级」相对性修正（存 slots，随会话持久化）
  try{
    const rlNow = resolved && resolved.merged && resolved.merged.riskLevel;
    if(rlNow && /^(low|medium|high)$/.test(rlNow)){
      sessionStore.updateSession(session, { slots: Object.assign({}, session.slots || {}, { __prevRiskLevel: rlNow }) });
    }
  }catch(e){}
  const mergedNeedsDoctor = !!(resolved.merged && resolved.merged.needsDoctor)
    || !!(understood.slots && understood.slots.asksMedication)
    || (typeof triage.needsDoctorFromTriggers === "function"
        && triage.needsDoctorFromTriggers(clinical.floorTriggers || clinical.triggers));
  let levelInfo = resolved.levelInfo;
  let planRisk = (triage.rankMax && triage.rankMax(clinical.clinicalRisk, resolved.merged && resolved.merged.riskLevel)) || clinical.clinicalRisk;
  // health_chat 会话中：仅「发热」抬到的 high（非 emergency）不进空安全模板，交给阿福式 educate
  const feverOnlyHigh = healthChatEnabled()
    && planRisk === "high"
    && !clinical.emergency
    && !(resolved.merged && resolved.merged.emergency)
    && (understood.slots && understood.slots.hasFever || /发烧|发热/.test(text))
    && !/(胸痛|喘不上|咯血|呕血|昏迷|抽搐|大出血)/.test(text)
    && (session.chatPhase || session.goal === "health_chat" || (understood.slots && understood.slots.bodyPart) || /腹|肚子|胃/.test(String(session.summary || "")));
  if(feverOnlyHigh) planRisk = "medium";
  if(mergedNeedsDoctor && !(resolved.merged && resolved.merged.needsDoctor)){
    levelInfo = triage.classifyLevel(text, doctorId, {
      riskLevel: planRisk,
      needsDoctor: true,
      needsHuman: true,
      emergency: clinical.emergency || !!(resolved.merged && resolved.merged.emergency),
      riskTriggers: clinical.floorTriggers || clinical.triggers,
      sentinel: !!(resolved.merged && resolved.merged.sentinel)
    });
  }
  const allowCard = triage.canAttachMiniProgram(levelInfo.level) || explicitServiceAllowsCard(understood);
  let planned = plan(understood, planRisk, clinical.emergency || !!(resolved.merged && resolved.merged.emergency), {
    level: levelInfo.level,
    allowCard,
    healthChat: healthChatEnabled(),
    chatPhase: session.chatPhase || null
  });
  // 发热-only 被 plan 成 emergency_safe 时，仍强制回 health_chat
  if(feverOnlyHigh && planned.intendedAction === "emergency_safe"){
    planned = {
      intendedAction: "health_chat",
      goal: "health_chat",
      toolCalls: [{ name: "reply_text", args: { tone: "health_chat" } }],
      preferredCode: null,
      hasMedicalAdviceText: false,
      handoff: false,
      note: "health_chat_fever_keep",
      chatPhaseHint: "intake"
    };
  }
  if(shouldSuppressRepeatCard(session, understood, planned)){
    planned = suppressRepeatCardPlan(planned);
  }
  const levelMeta = {
    levelSource: resolved.source,
    level: levelInfo.level,
    aiReason: resolved.merged && resolved.merged.aiReason
  };

  // 用最终动作重算 SendPolicy
  const risk = evaluateRisk(understood, session, {
    intendedAction: planned.intendedAction,
    hasMedicalAdviceText: planned.hasMedicalAdviceText
  });

  const toolOut = runTools(doctorId, planned.toolCalls, {
    patientName,
    level: levelInfo.level,
    allowCard
  });

  let replyText = "";
  let composeMeta = { source:"none" };

  if(planned.intendedAction === "emergency_safe" || risk.emergency || (risk.clinicalRisk === "high" && planned.intendedAction !== "health_chat")){
    // 复用 triage 安全路径（确定性）
    const tri = await triage.handleIncoming({
      doctorId,
      text,
      patientName: omit ? "群友" : patientName,
      patientKey,
      patientId: input.patientId,
      isGroup: !!input.isGroup
    });
    replyText = (tri.response && tri.response.text) || "";
    const extras = Array.isArray(tri.extraResponses) ? tri.extraResponses : [];
    const responses = [{ type:"text", text:replyText }, ...fillPatient(extras, patientName, omit)];
    sessionStore.updateSession(session, {
      goal:"safety",
      turn:{ role:"user", text, at:Date.now() }
    });
    return {
      bot:"医助",
      source:"dialogue_agent",
      responses,
      intentCode: tri.entryCode || null,
      triage:{
        riskLevel: planRisk || risk.clinicalRisk,
        clinicalRisk: planRisk || risk.clinicalRisk,
        sendPolicy: risk.sendPolicy,
        canAutoSend: true,
        needsHuman: true,
        needsDoctor: !!mergedNeedsDoctor,
        level: levelInfo.level,
        levelSource: resolved.source,
        emergency: !!risk.emergency,
        triggers: risk.floorTriggers,
        suggestedAction: risk.policyReason
      },
      sessionId: session.id || null,
      decisionId: tri.decisionId || null,
      autoSent:true,
      dryRun:agentDryRun(),
      handoff:true,
      toolCalls: planned.toolCalls,
      agentMeta:{ path:"agent_emergency", compose:composeMeta, plan:planned, ...levelMeta, understood:{ service:understood.service, medicalIntent:understood.medicalIntent, healthcarePersona:understood.healthcarePersona } }
    };
  }

  if(planned.intendedAction === "health_chat"){
    const hcResolved = await healthChat.resolveTurn({
      doctorId,
      text,
      session: Object.assign({}, session, { slots: slotsBeforeTurn }),
      understood,
      planned,
      allowCard,
      emergency: risk.emergency || clinical.emergency,
      clinicalRisk: planRisk,
      level: levelInfo.level,
      firstAdviceReview: healthChatFirstReview()
    });
    let hcRisk = evaluateRisk(understood, session, {
      intendedAction: hcResolved.phase === "escalate" ? "handoff" : "health_chat",
      hasMedicalAdviceText: false
    });
    // 首次给建议须人工确认：强制降为 review（落 pending），不让无复核医疗建议自动发出
    if(hcResolved.needHumanReview){
      hcRisk = Object.assign({}, hcRisk, {
        sendPolicy:"review",
        canAutoSend:false,
        needsHuman:true,
        policyReason:"first_advice_review"
      });
    }
    let personaPrompt = "";
    try{
      personaPrompt = triage.configuredPrompt(doctorId, "personaHealthChat") || "";
    }catch(e){
      personaPrompt = "";
    }
    const composed = await composeHealthChat({
      doctorId,
      text,
      phase: hcResolved.phase,
      slots: hcResolved.slots,
      evidence: hcResolved.evidence,
      recentTurns: (session.turns || []).slice(-10),
      summary: session.summary || "",
      personaPrompt,
      missingSlots: hcResolved.missingSlots,
      urgent: hcResolved.urgent,
      lastAdviceText: (hcResolved.slots && hcResolved.slots.lastAdviceText) || ""
    });
    replyText = composed.text || "";
    const outPhase = (composed.meta && composed.meta.phase) || hcResolved.phase;
    composeMeta = {
      source: composed.source,
      fallbackReason: composed.fallbackReason,
      phase: outPhase,
      usedRag: !!hcResolved.usedRag,
      level: levelInfo.level,
      allowCard,
      ...levelMeta,
      ...(composed.meta || {})
    };

    const hcTextResponses = [];
    if(replyText){
      const bubbleCfg = resolveReplyBubbleConfig(doctorId);
      splitReplyBubbles(replyText, bubbleCfg).forEach(part=>{
        if(part) hcTextResponses.push({ type:"text", text:part });
      });
    }

    let hcToolCalls = Array.isArray(planned.toolCalls) ? planned.toolCalls.slice() : [];
    let hcFromTools = [];
    let hcIntentCode = null;
    if(hcResolved.attachCode){
      const cardOut = runTools(doctorId, [{ name:"open_chunyu_card", args:{ code:hcResolved.attachCode } }], {
        patientName,
        level: levelInfo.level,
        allowCard
      });
      hcFromTools = cardOut.responses || [];
      hcIntentCode = hcResolved.attachCode;
      hcToolCalls = hcToolCalls.concat([{ name:"open_chunyu_card", args:{ code:hcResolved.attachCode } }]);
    }

    const hcResponses = [...hcTextResponses, ...hcFromTools];
    const canAuto = !!hcRisk.canAutoSend && hcRisk.sendPolicy !== "review";
    const hcPlan = Object.assign({}, planned, { phase: outPhase });

    const nextSlots = Object.assign({}, hcResolved.slots || {});
    if(outPhase === "advise" && replyText){
      nextSlots.adviceDelivered = true;
      nextSlots.lastAdviceText = String(replyText).slice(0, 500);
      if(hcResolved.urgent || nextSlots.hasFever || nextSlots.painPattern === "持续"){
        nextSlots.urgentRefreshed = true;
      }
    }
    if(outPhase === "identity" || outPhase === "route"){
      // 保留病情槽，但不强制改 advice 标记
    }

    sessionStore.updateSession(session, {
      chatPhase: outPhase,
      slots: nextSlots,
      goal: "health_chat",
      summary: clean((session.summary ? session.summary + "；" : "") + text.slice(0, 80), 800),
      turn:{ role:"user", text, goal:"health_chat", at:Date.now() }
    });
    sessionStore.updateSession(session, {
      turn:{ role:"assistant", text:replyText, goal:"health_chat", at:Date.now() }
    });

    return {
      bot:"医助",
      source:"dialogue_agent",
      responses: fillPatient(hcResponses, patientName, omit),
      intentCode: hcIntentCode,
      triage:{
        riskLevel: planRisk || hcRisk.clinicalRisk,
        clinicalRisk: planRisk || hcRisk.clinicalRisk,
        sendPolicy: hcRisk.sendPolicy,
        canAutoSend: canAuto,
        needsHuman: !!(hcRisk.needsHuman || hcResolved.handoff || planned.handoff),
        needsDoctor: !!mergedNeedsDoctor,
        level: levelInfo.level,
        levelSource: resolved.source,
        emergency: !!hcRisk.emergency,
        triggers: hcRisk.floorTriggers,
        suggestedAction: hcRisk.policyReason,
        policyReason: hcRisk.policyReason
      },
      autoSent: canAuto,
      dryRun: agentDryRun(),
      handoff: !!(hcResolved.handoff || planned.handoff),
      sessionId: session.id || null,
      toolCalls: hcToolCalls,
      agentMeta:{
        path:"health_chat",
        compose:composeMeta,
        plan:hcPlan,
        slots: session.slots,
        phase: outPhase,
        ...levelMeta,
        understood:{ service:understood.service, medicalIntent:understood.medicalIntent, healthcarePersona:understood.healthcarePersona, attachments:understood.attachmentHints }
      }
    };
  }

  const toneArgs = ((planned.toolCalls || []).find(t=>t.name === "reply_text" || t.name === "ask_clarify") || {}).args;
  let composeTone = (toneArgs && toneArgs.tone)
    || (planned.intendedAction === "ask_clarify" ? "clarify" : (planned.handoff ? "handoff_soft" : "service"));
  let cardCode = planned.preferredCode;
  // 非 L2：医疗/子人设交接强制 advice；纯服务保持 service/guide
  if(!allowCard && (understood.medicalIntent || planned.handoff || isHealthcarePersonaGoal(planned.goal)
      || (understood.slots && (understood.slots.hasMedicalCue || understood.slots.asksMedication)))){
    if(!isHealthcarePersonaGoal(planned.goal)) composeTone = "advice";
    cardCode = null;
  }else if(!allowCard){
    cardCode = null;
  }
  const forceAdviceGoal = !allowCard && (composeTone === "advice" || planned.goal === "advice")
    && !isHealthcarePersonaGoal(planned.goal);
  const composed = await compose({
    doctorId,
    text,
    goal: forceAdviceGoal ? "advice" : planned.goal,
    tone: composeTone,
    cardCode,
    summary: session.summary,
    recentTurns: recentUserTurnsSummary(session),
    knownFacts: knownMedicalFacts(session, understood),
    persona: understood.healthcarePersona || null
  });
  replyText = composed.text || "";
  composeMeta = { source:composed.source, fallbackReason:composed.fallbackReason, level: levelInfo.level, allowCard, ...levelMeta };

  // card_only：允许完整引导语 + 卡；仅在无正文时补短交接，避免空消息
  if(risk.sendPolicy === "card_only" && allowCard && !String(replyText || "").trim()){
    replyText = "您的消息已收到。涉及具体病情判断我会交由人工确认；先为您附上对应服务入口，您可在一对一里补充说明。";
  }else if(!allowCard && (understood.medicalIntent || planned.handoff) && !String(replyText || "").trim()){
    replyText = "您的消息已收到。群里不做诊断或用药建议；若症状加重、高热或紧急不适，请优先线下就医或拨打 120。我已转人工关注。";
  }

  const textResponses = [];
  if(replyText){
    const bubbleCfg = resolveReplyBubbleConfig(doctorId);
    splitReplyBubbles(replyText, bubbleCfg).forEach(part=>{
      if(part) textResponses.push({ type:"text", text:part });
    });
  }
  // 工具里若已含菜单长文，避免重复；open_menu 已推 text
  const fromTools = (toolOut.responses || []).filter(r=>{
    if(!replyText) return true;
    if(r && r.type === "text" && toolOut.menuText && r.text === toolOut.menuText) return true;
    if(r && r.type === "text" && planned.goal === "menu") return false; // 菜单介绍由 compose 承担时保留 tools 菜单正文
    return r && r.type !== "text";
  });

  // menu：compose 短引 + menu 正文
  let responses;
  if(planned.goal === "menu" && toolOut.menuText){
    responses = [
      ...(replyText ? [{ type:"text", text:replyText }] : []),
      { type:"text", text:toolOut.menuText }
    ];
  }else{
    responses = [...textResponses, ...fromTools.filter(r=>!(r.type === "text" && textResponses.length))];
  }

  // reply_advice：sendPolicy=auto 且 canAutoSend=true（L3/L4 建议可真发、不附卡）；review 仍拦截
  const canAuto = !!risk.canAutoSend && risk.sendPolicy !== "review";
  sessionStore.updateSession(session, {
    goal: planned.goal,
    summary: clean((session.summary ? session.summary + "；" : "") + text.slice(0, 80), 800),
    turn:{ role:"user", text, goal:planned.goal, at:Date.now() }
  });

  return {
    bot:"医助",
    source:"dialogue_agent",
    responses: fillPatient(responses, patientName, omit),
    intentCode: planned.preferredCode || (toolOut.codes[0] || null),
    triage:{
      riskLevel: planRisk || risk.clinicalRisk,
      clinicalRisk: planRisk || risk.clinicalRisk,
      sendPolicy: risk.sendPolicy,
      canAutoSend: canAuto,
      needsHuman: !!(risk.needsHuman || toolOut.handoff || planned.handoff),
      needsDoctor: !!mergedNeedsDoctor,
      level: levelInfo.level,
      levelSource: resolved.source,
      emergency: !!risk.emergency,
      triggers: risk.floorTriggers,
      suggestedAction: risk.policyReason,
      policyReason: risk.policyReason
    },
    autoSent: canAuto,
    dryRun: agentDryRun(),
    handoff: !!(toolOut.handoff || planned.handoff),
    sessionId: session.id || null,
    toolCalls: planned.toolCalls,
    agentMeta:{
      path:"agent",
      compose:composeMeta,
      plan:planned,
      slots: session.slots,
      ...levelMeta,
      understood:{ service:understood.service, medicalIntent:understood.medicalIntent, healthcarePersona:understood.healthcarePersona, attachments:understood.attachmentHints }
    }
  };
}

async function runTurn(input){
  input = input || {};
  const doctorId = Number(input.doctorId);
  if(!Number.isInteger(doctorId) || doctorId <= 0){
    const err = new Error("缺少 doctorId");
    err.status = 400;
    throw err;
  }
  if(!db.prepare("SELECT 1 FROM doctors WHERE id=?").get(doctorId)){
    const err = new Error("医生不存在");
    err.status = 404;
    throw err;
  }
  const text = clean(input.text, 1000);
  if(!text && !(input.attachments && input.attachments.length)){
    const err = new Error("消息不能为空");
    err.status = 400;
    throw err;
  }

  // 任意文本先试关键词/编号快路径（含「医患联络表」等 aliases）；
  // 仅纯编号口令才硬跳转的旧门闩会导致别名落入 dialogue_agent → 人工审核、群内无回复。
  if(text){
    const fast = await runCodeFastPath(input);
    if(fast) return fast;
  }

  return runAgentPath(input);
}

module.exports = { runTurn, runCodeFastPath, runAgentPath, isPureCodeUtterance };
