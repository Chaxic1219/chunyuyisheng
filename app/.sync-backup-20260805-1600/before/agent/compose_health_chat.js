"use strict";
/* health_chat 文案：intake 短追问；advise 结构化长建议（≤500，无 Markdown）；按医生人设 */
const triage = require("../triage.js");
const {
  pick,
  extractCue,
  doctorInfo,
  lightCleanLlmText,
  scrubBannedPhrases,
  scrubForbiddenSentences,
  scrubTemplateResidue
} = require("./compose.js");
const { buildDoctorPersonaPrompt, identityReply } = require("./doctor_persona.js");

function stripMarkdownBold(text){
  return String(text || "")
    .replace(/\*\*/g, "")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/```[\s\S]*?```/g, "")
    .trim();
}

function clipToLimit(text, maxLen){
  let s = String(text || "").trim();
  const lim = maxLen || 500;
  if(s.length <= lim) return s;
  const cut = s.slice(0, lim);
  const m = cut.match(/^[\s\S]*[。！？!?]/);
  return (m ? m[0] : cut).trim();
}

function evidenceSnippet(evidence, maxLen){
  const items = (evidence && evidence.items) || [];
  const body = String((items[0] && items[0].body) || "").trim();
  if(!body) return "";
  const lim = maxLen || 160;
  let s = body.replace(/\s+/g, " ").trim();
  if(s.length > lim){
    const cut = s.slice(0, lim);
    const m = cut.match(/^[\s\S]*[。！？!?；;]/);
    s = (m ? m[0] : cut).trim();
  }
  return stripMarkdownBold(s);
}

function formatRecentTurns(recentTurns){
  if(!Array.isArray(recentTurns) || !recentTurns.length) return "";
  return recentTurns.slice(-10).map(t => {
    const role = t.role === "assistant" ? "医助" : "患者";
    return role + "：" + String(t.text || "").slice(0, 200);
  }).join("\n");
}

function knownSummary(slots){
  const s = slots || {};
  const bits = [];
  if(s.bodyPart) bits.push(s.bodyPart + "不适");
  else if(s.topicKey && !/腹|胃|牙|头|胸|腰/.test(String(s.topicKey))) bits.push(String(s.topicKey));
  else if(Array.isArray(s.symptoms) && s.symptoms.length) bits.push(s.symptoms.slice(0, 3).join("、"));
  if(s.duration) bits.push("大概" + s.duration);
  if(s.painPattern) bits.push(s.painPattern);
  if(s.hasFever) bits.push("有发热");
  if(s.hasDiarrhea) bits.push("有腹泻");
  if(s.worsening === true) bits.push("有加重");
  if(s.worsening === false) bits.push("暂无明显加重");
  return bits.join("、");
}

function nextAsk(slots, missingSlots){
  // 答主问辅：默认不再强制追问；仅完全无主诉时才问一句
  const s = slots || {};
  if(s.bodyPart || s.topicKey || (Array.isArray(s.symptoms) && s.symptoms.length) || s.hasMedicalCue){
    return "";
  }
  const miss = Array.isArray(missingSlots) ? missingSlots : [];
  if(miss.includes("bodyPart")) return "哪里最不舒服？";
  return "您最明显的不适是什么？";
}

function similarAdvice(a, b){
  const x = String(a || "").replace(/\s+/g, "");
  const y = String(b || "").replace(/\s+/g, "");
  if(!x || !y) return false;
  if(x === y) return true;
  const n = Math.min(80, x.length, y.length);
  return n >= 40 && x.slice(0, n) === y.slice(0, n);
}

function primaryTopic(ctx){
  const slots = (ctx && ctx.slots) || {};
  const t = String((ctx && ctx.text) || "");
  if(/头晕|眩晕/.test(t) || slots.topicKey === "头晕" || (slots.symptoms || []).includes("头晕")) return "头晕";
  if(/心慌|心悸/.test(t) || slots.topicKey === "心慌" || (slots.symptoms || []).includes("心慌")) return "心慌";
  if(slots.bodyPart) return slots.bodyPart;
  if(slots.topicKey) return String(slots.topicKey);
  return "";
}

function adviseSoftTemplate(ctx){
  const slots = ctx.slots || {};
  const known = knownSummary(slots);
  const snippet = evidenceSnippet(ctx.evidence, 120);
  const topic = primaryTopic(ctx);
  const urgent = !!ctx.urgent || !!slots.hasFever || slots.painPattern === "持续" || slots.worsening === true;
  const dept = ctx.dept || "相关科室";

  if(snippet && needsKnowledgeish(ctx.text)){
    return clipToLimit(
      (known ? ("明白了，关于" + known + "。") : "收到。")
      + "按我们团队常用说明：" + snippet
      + " 以上仅供参考，具体以面诊为准。若还想一对一问"
      + (ctx.doctorName || "主任") + "，请回复 101。",
      500
    );
  }

  const head = known
    ? ("听到了，您提到" + known + "。先别太慌，我按常见情况帮您捋一捋。")
    : ("听到了" + (ctx.cue ? ("「" + ctx.cue + "」") : "") + "。先别太慌，我按常见情况帮您捋一捋。");

  let body;
  if(topic === "头晕"){
    body = [
      head,
      "",
      "最常见的原因（按概率，非诊断）：",
      "1. 睡眠不足、疲劳、脱水或久蹲后突然站起。",
      "2. 颈椎紧张、盯屏过久导致的头晕不适。",
      "3. 低血压倾向、感冒初期或焦虑紧张。",
      "",
      "您现在可以立刻做的：",
      "1. 找安全处坐下或躺下，避免突然起身。",
      "2. 喝一点温水，休息 10～15 分钟再观察。",
      "3. 记录是否天旋地转、眼前发黑、伴恶心。",
      "",
      "需要警惕（出现请尽快就医或急诊）：",
      "1. 剧烈天旋地转伴呕吐、说话不清、肢体无力。",
      "2. 突发剧烈头痛、意识变差。",
      "3. 头晕同时胸痛、大汗、呼吸困难。",
      "",
      "若排除紧急情况，可先观察。若持续或加重，告诉我是旋转感还是眼前发黑，我再帮您收窄；一对一请回复 101。"
    ].join("\n");
  }else if(topic === "心慌"){
    body = [
      head,
      "",
      "最常见的原因（按概率，非诊断）：",
      "1. 紧张、咖啡因、睡眠差引起的心悸感。",
      "2. 贫血、低血糖、脱水或劳累。",
      "3. 心律失常等需当面评估的情况（不能在群里定论）。",
      "",
      "您现在可以立刻做的：",
      "1. 坐下休息，放慢呼吸，避免继续剧烈活动。",
      "2. 回想是否刚喝浓茶/咖啡、熬夜或情绪激动。",
      "3. 若方便，可测一下脉搏是否整齐。",
      "",
      "需要警惕（出现请尽快急诊或打120）：",
      "1. 心慌伴胸痛、冷汗、气促、晕厥。",
      "2. 心跳极快且持续不缓解、脸色苍白。",
      "3. 伴意识模糊或抽搐。",
      "",
      "排除紧急情况后可先休息观察。还可补充持续多久、有无胸闷，我再帮您梳理；一对一请回复 101。"
    ].join("\n");
  }else if(topic === "牙齿" || topic === "头部" || topic === "胸部" || topic === "腰部"){
    body = [
      head + "我这边是" + dept + "团队医助，对" + topic + "先给通用观察，不能当专科结论。",
      "",
      "您现在可以先做的：",
      "1. 记录开始时间、是否加重、有无发热。",
      "2. 避免自行乱用药。",
      "3. 若明显影响进食/睡眠或持续加重，尽快对应专科当面看。",
      "",
      "需要警惕：剧痛难忍、高热、呼吸困难、意识变差。",
      "",
      "想找" + (ctx.doctorName || "主任") + "团队一对一，请回复 101。"
    ].join("\n");
  }else if(urgent){
    body = [
      head + "若腹痛变成持续性并伴发热，更建议尽快线下当面评估。",
      "",
      "最常见需留意的方向（非诊断）：",
      "1. 肠道感染或不适伴发热。",
      "2. 消化系统炎症刺激。",
      "3. 其他急腹症可能（需当面排除）。",
      "",
      "您现在可以立刻做的：",
      "1. 量体温并记下。",
      "2. 记下疼痛开始时间、有无呕吐腹泻。",
      "3. 暂勿随意吃止痛药掩盖病情。",
      "",
      "需要警惕（出现请尽快急诊或打120）：",
      "1. 剧痛突然加重、频繁呕吐。",
      "2. 持续高热、意识变差、出冷汗。",
      "3. 便血、呕血或腹胀明显加重。",
      "",
      "排除紧急情况后，仍建议尽快门诊或急诊当面看。"
    ].join("\n");
  }else{
    body = [
      head + "很多情况与饮食、受凉、劳累有关，简单调整常能缓解。",
      "",
      "最常见的原因（按概率，非诊断）：",
      "1. 饮食不当或受凉引起的胃肠不适。",
      "2. 消化功能紊乱、胀气。",
      "3. 劳累、压力影响身体敏感。",
      "",
      "您现在可以立刻做的：",
      "1. 清淡饮食，少油辣。",
      "2. 观察是否发热、呕吐、腹泻或加重。",
      "3. 休息，记录不适变化。",
      "",
      "需要警惕（出现请尽快就医）：",
      "1. 持续剧痛、高热、黄疸。",
      "2. 呕血、黑便、频繁呕吐。",
      "3. 疼痛进行性加重。",
      "",
      "排除紧急情况可先观察；想一对一请回复 101。"
    ].join("\n");
  }
  return clipToLimit(stripMarkdownBold(body), 500);
}

function needsKnowledgeish(text){
  return /能吃|可以吃|忌口|术后|复查|饮食|鸡蛋/.test(String(text || ""));
}

function softTemplateHealth(phase, ctx){
  ctx = ctx || {};
  const slots = ctx.slots || {};
  const known = knownSummary(slots);
  const ask = nextAsk(slots, ctx.missingSlots);
  const p = phase === "educate" ? "advise" : phase;

  if(p === "identity"){
    return identityReply(ctx.doctorId);
  }

  if(p === "route"){
    return (
      (known ? ("收到，关于" + known + "。") : "收到。")
      + "一对一问诊更合适细聊。请回复 101，我发"
      + (ctx.doctorName || "主任")
      + "团队的咨询入口给您。"
    );
  }

  if(p === "escalate"){
    return pick([
      (known ? ("收到，" + known + "。") : "收到。")
        + "开药和诊断得医生看，我不在群里替您定。需要的话请回复 101，我帮您转给"
        + (ctx.doctorName || "主任") + "团队；若剧痛加重或急症表现，请优先急诊。",
      (known ? ("关于" + known + "，") : "")
        + "用药我不给建议。请回复 101 走一对一；急就先线下就医。"
    ]);
  }

  if(p === "followup"){
    if(similarAdvice(ctx.lastAdviceText, ctx.prevEcho)){
      /* no-op */
    }
    const tip = slots.hasFever || slots.painPattern === "持续"
      ? "若疼痛或发热没有缓解，请尽快线下就医；途中剧痛加重或持续高热请直接急诊或打120。"
      : "先按上次说的观察与调整；若加重、发热或持续不缓解，尽快当面看医生。";
    return (known ? ("了解，还是" + known + "。") : "了解。") + tip
      + " 想一对一找" + (ctx.doctorName || "主任") + "，请回复 101。";
  }

  if(p === "advise"){
    if(ctx.lastAdviceText && similarAdvice(ctx.lastAdviceText, adviseSoftTemplate(ctx))){
      return softTemplateHealth("followup", ctx);
    }
    return adviseSoftTemplate(ctx);
  }

  // intake：尽量少用；若已有不适线索则直接给建议模板
  if(slots.hasMedicalCue || slots.bodyPart || slots.topicKey || (slots.symptoms && slots.symptoms.length)){
    return adviseSoftTemplate(ctx);
  }
  const head = known
    ? ("听到了，目前是" + known + "。")
    : ("听到了" + (ctx.cue ? ("，关于「" + ctx.cue + "」") : "") + "。");
  if(ask) return head + "想再确认一句：" + ask;
  return head + "您再补充一句最不舒服的感觉就行。";
}

async function composeViaFetch(input){
  if(process.env.TRIAGE_AI_DISABLED === "1") return { ok:false, reason:"disabled" };
  const cfg = triage.modelConfig({});
  if(!cfg) return { ok:false, reason:"no_key" };

  const info = doctorInfo(input.doctorId);
  const cue = extractCue(input.text);
  let phase = input.phase || "intake";
  if(phase === "educate") phase = "advise";
  const evidence = input.evidence || { sufficiency: "none", items: [] };
  const snippet = evidenceSnippet(evidence, 400);
  const personaPrompt = buildDoctorPersonaPrompt(
    input.doctorId,
    input.personaPrompt != null ? input.personaPrompt : null
  );
  const turnsBlock = formatRecentTurns(input.recentTurns);
  const slots = input.slots || {};
  const known = knownSummary(slots);
  const ask = nextAsk(slots, input.missingSlots);
  const urgent = !!input.urgent || !!slots.hasFever || slots.painPattern === "持续" || slots.worsening === true;

  const phaseGuide = {
    intake: "信息极少才追问。半句接住 + 最多 1 个问题。有任何症状主诉时不要用本相位。",
    advise: "像通用大模型一样先答后问：直接给有用说明（常见原因→立刻可做→红旗就医），全文≤500字，纯文本无**。结尾最多1个轻问。严禁问卷式连问；严禁把已切换掉的旧主诉硬扯进来。以本轮用户话为当前主题。",
    followup: "短答补一点观察，禁止复读整段，禁止再开一轮问诊问卷。",
    route: "用户要找医生/一对一。明确写：请回复 101。",
    escalate: "开药/诊断诉求：拒绝给药与诊断，引导回复 101 或急诊。",
    identity: "回答你是谁：带出当前医生姓名与科室。勿复读病情。"
  };

  const system = [
    personaPrompt,
    "你的目标是通用大模型式健康问答：先给建议与解释，再可选轻问一句；不要变成填槽问诊机器人。",
    "【格式】禁止输出 **加粗**、# 标题、代码块；用纯文本分段与数字列表。",
    "【证据】有证据块才可据实改写；无证据用通用安全观察，禁止编造确诊病名。",
    "【红旗】发热、持续剧痛、心慌伴胸痛大汗、剧烈眩晕伴神经症状：写清何时急诊/120。",
    "禁止客服套话；非 route/escalate 不强推编号；route/escalate 必须提示「请回复 101」。",
    "当前相位：" + phase + (urgent ? "（偏急）" : ""),
    phaseGuide[phase] || phaseGuide.advise,
    info.line ? ("背景：" + info.line) : ""
  ].filter(Boolean).join("\n");

  const user = [
    "患者本轮（当前主题以本句为准）：" + String(input.text || "").slice(0, 1200),
    known ? ("已知信息（可引用，勿再盘问）：" + known) : "已知信息：尚少（仍请直接给常见情况建议）",
    phase === "intake" && ask ? ("本轮唯一可追问：" + ask) : "本轮以回答为主；结尾最多 1 个轻问，禁止一次问多个症状点",
    cue ? ("线索：" + cue) : "",
    input.summary ? ("会话摘要（旧话题仅供参考，勿强行串联）：" + String(input.summary).slice(0, 400)) : "",
    turnsBlock ? ("最近对话：\n" + turnsBlock.slice(0, 800)) : "",
    slots.lastAdviceText ? ("上次建议摘要（禁止复读）：" + String(slots.lastAdviceText).slice(0, 120)) : "",
    "证据充分度：" + String(evidence.sufficiency || "none"),
    snippet ? ("证据块：\n" + snippet) : "证据块：无",
    "直接输出回复正文。"
  ].filter(Boolean).join("\n");

  const body = {
    model: cfg.model,
    messages: [{ role: "system", content: system }, { role: "user", content: user }],
    thinking: { type: "disabled" },
    temperature: 0.55,
    top_p: 0.9,
    stream: false
  };
  body[cfg.maxTokenField || "max_tokens"] = phase === "advise" ? 900 : 500;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), +(process.env.TRIAGE_AI_TIMEOUT_MS || 20000));
  try{
    const res = await fetch(cfg.url, {
      method: "POST",
      headers: cfg.headers,
      signal: controller.signal,
      body: JSON.stringify(body)
    });
    clearTimeout(timer);
    if(!res.ok) return { ok: false, reason: "http_" + res.status };
    const data = await res.json();
    const raw = String((((data.choices || [])[0] || {}).message || {}).content || "").trim();
    let text = lightCleanLlmText(raw);
    text = scrubTemplateResidue(text);
    text = scrubForbiddenSentences(text);
    text = scrubBannedPhrases(text);
    text = stripMarkdownBold(text);
    if(phase !== "route" && phase !== "escalate" && phase !== "identity"){
      // 非路由相位不强留教号句；若模型写了也不删 route 需要的——此处仅清理误教
      if(!/请回复\s*101/.test(text) && /请发\s*101|发送\s*101/.test(text)){
        text = text.replace(/请发\s*101[。．.!！]?/g, "").replace(/发送\s*101[。．.!！]?/g, "").trim();
      }
    }
    text = clipToLimit(text, phase === "advise" ? 500 : 280);
    if(!text) return { ok: false, reason: "empty" };
    if(phase === "followup" && input.slots && similarAdvice(input.slots.lastAdviceText, text)){
      return { ok: false, reason: "repeat" };
    }
    return { ok: true, text, source: "llm" };
  }catch(e){
    clearTimeout(timer);
    return { ok: false, reason: (e && e.name === "AbortError") ? "timeout" : "fetch_error" };
  }
}

async function composeHealthChat(input){
  input = input || {};
  let phase = input.phase || "intake";
  if(phase === "educate") phase = "advise";
  const info = doctorInfo(input.doctorId);
  const cue = extractCue(input.text);
  const slots = input.slots || {};
  const ctx = {
    doctorId: input.doctorId,
    doctorName: info.name,
    dept: info.dept,
    specialty: info.specialty,
    cue,
    text: input.text,
    slots,
    evidence: input.evidence || { sufficiency: "none", items: [] },
    missingSlots: input.missingSlots,
    urgent: input.urgent,
    lastAdviceText: slots.lastAdviceText || input.lastAdviceText || ""
  };

  let opsPersona = input.personaPrompt;
  if(opsPersona == null){
    try{
      opsPersona = triage.configuredPrompt(input.doctorId, "personaHealthChat") || "";
    }catch(e){
      opsPersona = "";
    }
  }
  // configuredPrompt 带【运营补充口径】前缀时仍作覆盖；空则走医生档案自动人设
  input.personaPrompt = opsPersona;

  if(phase === "identity"){
    const text = identityReply(input.doctorId);
    return { ok: true, text, source: "persona", meta: { phase, cue, known: knownSummary(slots) } };
  }

  if(phase === "intake"){
    const llm = await composeViaFetch(Object.assign({}, input, { phase }));
    if(llm.ok && llm.text){
      const qmarks = (llm.text.match(/[？?]/g) || []).length;
      if(qmarks <= 1){
        return { ok: true, text: llm.text, source: "llm", meta: { phase, cue, known: knownSummary(slots) } };
      }
    }
  }else if(phase === "advise" || phase === "followup" || phase === "route" || phase === "escalate"){
    const llm = await composeViaFetch(Object.assign({}, input, { phase }));
    if(llm.ok && llm.text){
      return { ok: true, text: llm.text, source: "llm", meta: { phase, cue, known: knownSummary(slots) } };
    }
  }

  let text = scrubBannedPhrases(softTemplateHealth(phase, ctx));
  text = stripMarkdownBold(text);
  if(phase === "advise") text = clipToLimit(text, 500);
  return {
    ok: true,
    text,
    source: "soft_template",
    fallbackReason: "phase_stable_or_llm_skip",
    meta: { phase, cue, known: knownSummary(slots) }
  };
}

module.exports = {
  composeHealthChat, softTemplateHealth, evidenceSnippet, knownSummary, nextAsk,
  stripMarkdownBold, clipToLimit, adviseSoftTemplate
};
