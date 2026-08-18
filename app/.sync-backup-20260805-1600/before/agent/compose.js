/* 文案合成：优先 LLM；仅当无模型/失败/空文时用软模板。
 * 不做「模型有返回 → 本地红旗/医疗词表扫描不过 → 丢弃改模板」的降级。 */
const triage = require("../triage.js");
const { maskPIIStrict } = require("../pii.js");
const { personaPromptBlock, isHealthcarePersonaGoal } = require("./persona_router.js");

function doctorInfo(doctorId){
  try{
    const d = require("../db.js").db.prepare("SELECT name,hospital,dept,specialty FROM doctors WHERE id=?").get(Number(doctorId));
    if(!d) return { name:"主任", hospital:"", dept:"", specialty:"", line:"" };
    const line = [d.name, d.hospital, d.dept].filter(Boolean).join(" · ");
    return { name:d.name || "主任", hospital:d.hospital || "", dept:d.dept || "", specialty:d.specialty || "", line };
  }catch(e){
    return { name:"主任", hospital:"", dept:"", specialty:"", line:"" };
  }
}

function extractCue(text){
  let t = String(text || "").replace(/[@＠]\S+/g, "").trim();
  t = t.replace(/[？?！!。．.，,、；;：:\s]+$/g, "").trim();
  if(!t) return "";
  if(t.length > 24) t = t.slice(0, 24) + "…";
  return t;
}

function pick(list){
  const arr = Array.isArray(list) && list.length ? list : ["收到，我这就帮您处理。"];
  return arr[Math.floor(Math.random() * arr.length)];
}

function softTemplate(goal, tone, ctx){
  ctx = ctx || {};
  const doctor = ctx.doctorName || "主任";
  const dept = ctx.dept ? ("（" + ctx.dept + "）") : "";
  const cue = ctx.cue || "";
  const cueBit = cue ? (`关于「${cue}」，`) : "";

  if(tone === "clarify" || goal === "clarify"){
    return pick([
      "您是想问诊、查挂号出诊，还是加号/住院？直接说一句就行，我帮您开入口。",
      "问诊、挂号、加号、住院预约、医生简介——您更想先办哪一件？",
      "收到。您最想办的事说一句即可，比如「想问诊」「看出诊」。"
    ]);
  }

  if(tone === "advice" || goal === "advice"){
    return pick([
      "收到，" + (cue || "你说的情况") + "。先留意有没有加重、发热或持续不缓解；诊断和用药我不在群里下结论。你再补部位、多久了，我帮你转团队；情况明显加重请及时就医。",
      "看到了。" + (cue ? ("关于「" + cue + "」，") : "") + "具体判断得医生看。你方便说下哪里不舒服、多久了、有没有加重吗？我这边先帮你记下并转团队关注。",
      "嗯，先接住了。" + (cue ? ("关于「" + cue + "」，") : "") + "用药和诊断我不给建议。你再补一句细节（部位、多久、是否加重），我帮你转团队；若剧痛或急症表现请优先线下就医。"
    ]);
  }

  if((tone === "service" || tone === "guide") && ctx.noCard){
    return pick([
      "收到。" + cueBit + "您用日常说法说清楚想办的事（挂号、简介、问诊都行），医助会帮您对接。",
      "好的。" + cueBit + "您补充一下具体想了解或办理的内容，我这边帮您转给医助。",
      cueBit + "您最想先办哪一件？挂号/出诊、加号、简介或问诊，说一句就行。"
    ]);
  }

  if(tone === "handoff_soft"){
    return pick([
      cueBit + "群里不方便下结论。我给您开" + doctor + "团队一对一入口，您把开始时间、部位和变化写清楚；若剧痛加重或呕血黑便，直接去急诊。",
      "听到了。" + (cue || "您的不适") + "得医生看，我不在群里猜。下面是一对一入口，医助同步跟进；紧急就先线下就医。",
      "收到。群聊不便细聊病情，我先给您一对一入口；把症状变化写清楚即可。急症请直接去急诊或打 120。"
    ]);
  }

  if(goal === "menu"){
    return pick([
      "常用能力在下面。您也可以直接说「想问诊」「看出诊」「加号」，我按您的话开入口。",
      "功能一览在下面；更省事的是直接告诉我您想办的事。"
    ]);
  }

  if(goal === "consult" || goal === "video"){
    return pick([
      "了解，您想找" + doctor + dept + "咨询。" + cueBit + "群里不便细聊，一对一入口在下面，隐私也更好。",
      "好的。" + cueBit + "建议走一对一图文/问诊，医生和医助能看得更全。入口在下面；急症请优先线下就医。",
      "收到。" + cueBit + "我帮您开" + doctor + "问诊入口，把主要不适、时间和想解决的问题写清楚就行。"
    ]);
  }

  if(goal === "schedule"){
    return pick([
      "挂号出诊入口在下面，以页面最新说明为准。看完若还要问诊或加号，跟我说一声。",
      "门诊时间与挂号渠道在下面。有疑问再在群里说，我转医助帮您确认。"
    ]);
  }

  if(goal === "add_clinic"){
    return pick([
      "加号入口在下面，按页面提示填写；满号可能候补，有结果医助会通知您。",
      "了解您想加号。请走下方入口提交，我们按规则处理。"
    ]);
  }

  if(goal === "admission"){
    return pick([
      "住院预约入口在下面，填好后医助会跟进评估；急症请优先线下就医。",
      "收到住院相关需求。请通过下方入口提交资料，我们按流程处理。"
    ]);
  }

  if(goal === "profile"){
    return pick([
      "想了解" + doctor + "简介对吧，入口在下面。看完若要问诊或挂号，跟我说「想问诊」或「看出诊」就行。",
      doctor + "的介绍入口在下面。需要一对一咨询或挂号时，直接说一声。",
      "这是" + doctor + "的主页/风采入口" + (dept ? dept : "") + "。需要看病方面的帮助，随时跟我说。"
    ]);
  }

  if(goal === "health_report" || tone === "health_report"){
    return pick([
      cueBit + "报告我先帮你看大意。群里不做正式解读，您说下最担心的指标或箭头项；明显异常或持续加重，线下让医生看原件，医助会跟进。",
      "收到。" + (cue || "这份报告") + "群里不便下结论。您标一下最在意的几项；若数值很高或身体明显不适，尽快线下复核，我转医助帮您对接。",
      cueBit + "化验/体检结果得结合原件看。您先说哪几项让您不放心；急或持续加重就去急诊，平时我帮您记着要补充的资料。"
    ]);
  }

  if(goal === "case_analysis" || tone === "case_analysis"){
    return pick([
      cueBit + "我帮您理一下：从什么时候开始、哪里不舒服、中间有没有加重？您回我这三点，医助好整理给医生看。",
      "收到。" + (cue || "您的情况") + "先捋时间线：起病时间、主要症状、做过什么检查或用药？群里不下诊断，整理完交医助跟进。",
      cueBit + "麻烦补充：什么时候开始的、现在最难受的是哪一块、有没有越来越重？我记好交给医助，不耽误您后面问诊。"
    ]);
  }

  if(goal === "care_plan" || tone === "care_plan"){
    return pick([
      cueBit + "照护可以先抓三件事：休息节奏、饮食清淡易消化、留意发热腹痛加重。有红旗症状就去急诊，细一点医助会跟进。",
      "收到。" + (cue || "术后/日常") + "一般先别劳累，少食油腻辛辣，按时复查。若出血、高热或剧痛，别等，直接去急诊。",
      cueBit + "日常保养重在观察：吃得下、睡得着、症状没往坏里走。具体医嘱以医生面诊为准；拿不准的我帮您转医助。"
    ]);
  }

  return pick([
    "好的，" + cueBit + "对应入口在下面，按提示操作即可；病情细节建议走一对一。",
    "收到。入口在下面；若还想换办别的事，直接说，我帮您切换。"
  ]);
}

const BANNED_TEMPLATE_RES = [
  /我先记下了[，,]?/g,
  /我先帮您记一下[，,]?/g,
  /我帮您记录一下[，,]?/g,
  /我先记下这个情况[。．.!！]?/g,
  /请您补充以下信息[：:]?/g,
  /为了更好地帮您[，,]?/g,
  /我先帮您梳理一下[，,]?/g,
  /我先帮您理一下[——\-]*/g,
  /反馈给(?:主任)?团队(?:医助)?[关注跟进]*/g,
  /这位朋友[，,]?/g
];

function scrubBannedPhrases(text){
  let t = String(text || "");
  if(!t) return "";
  for(const re of BANNED_TEMPLATE_RES) t = t.replace(re, "");
  t = t.replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  // 清掉句首残留的顿号/逗号
  t = t.replace(/^[，,、；;：:\s]+/, "").trim();
  return t;
}

function lightCleanLlmText(raw){
  let t = String(raw || "").trim();
  if(!t) return "";
  t = t.replace(/^```(?:json|markdown|text)?\s*/i, "").replace(/```$/i, "").trim();
  t = t.replace(/^\s*#{1,6}\s+/gm, "").trim();
  // 企微友好：去掉 Markdown 加粗/斜体与无序项目符号，保留正文
  t = t.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/\*([^*]+)\*/g, "$1");
  t = t.replace(/^\s*[-*•]\s+/gm, "");
  t = t.replace(/\n{3,}/g, "\n\n").trim();
  if(triage.LLM_REPLY_LEAK && triage.LLM_REPLY_LEAK.test(t)) return "";
  try{ t = maskPIIStrict(t); }catch(e){}
  t = scrubBannedPhrases(t);
  return t;
}

/** 只撕违禁句，不整段作废：关键词屏蔽的确定性落地 */
function scrubForbiddenSentences(text){
  let t = String(text || "").trim();
  if(!t) return "";
  const rules = Array.isArray(triage.LLM_REPLY_FORBIDDEN) ? triage.LLM_REPLY_FORBIDDEN : [];
  if(!rules.length) return t;
  const parts = t.split(/(?<=[。！？!?；;\n])/);
  const kept = [];
  for(const part of parts){
    const s = String(part || "");
    if(!s.trim()){ kept.push(s); continue; }
    let hit = false;
    for(const rule of rules){
      if(rule && rule.re && rule.re.test(s)){ hit = true; break; }
    }
    if(!hit) kept.push(s);
  }
  return kept.join("").replace(/\n{3,}/g, "\n\n").replace(/[ \t]{2,}/g, " ").replace(/^[，,、；;：:\s]+/, "").trim();
}

function scrubTemplateResidue(text){
  return String(text || "")
    .replace(/我是[^。！？\n]{0,30}(主任|医生)[^。！？\n]{0,12}医助[，,]?/g, "")
    .replace(/咱们群里主要聊[^。！？\n]{0,40}[。！？]?/g, "")
    .replace(/群里主要聊[^。！？\n]{0,40}[。！？]?/g, "")
    .replace(/我不是医生[，,]?不能[^。！？\n]{0,40}[。！？]?/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^[，,、；;：:\s]+/, "")
    .trim();
}

async function composeViaFetch(input){
  if(process.env.TRIAGE_AI_DISABLED === "1") return { ok:false, reason:"disabled" };
  const cfg = triage.modelConfig({});
  if(!cfg) return { ok:false, reason:"no_key" };

  const info = doctorInfo(input.doctorId);
  const cue = extractCue(input.text);
  const tone = input.tone || "service";
  const goal = input.goal || "service";
  const withCard = !!input.cardCode;
  const persona = input.persona || null;
  const personaBlock = personaPromptBlock(input.doctorId, persona);
  const personaGoal = isHealthcarePersonaGoal(goal);

  const personaRules = personaGoal === "health_report"
    ? "本轮偏报告：可自由聊，但不要解读成诊断、不要判良恶性。"
    : personaGoal === "case_analysis"
      ? "本轮偏病程整理：可自由追问与归纳，不要下诊断。"
      : personaGoal === "care_plan"
        ? "本轮偏日常照护：可自由给生活建议，不要开药、不要替代医嘱。"
        : "";

  const system = [
    "你在医生患者企微群里回复患者，像普通真人聊天即可。",
    "严禁自称或暗示自己是 AI / 机器人 / 大模型。",
    personaBlock || "",
    info.line ? ("背景信息（可选用，禁止每次自我介绍）：" + info.line) : "",
    "唯一限制——内容关键词/越权屏蔽（触碰则改写避开，其余一律不限制）：",
    "禁止：确诊或诊断断言；开药/点名药名剂量；判断良恶性；承诺疗效；指导手术细节。",
    "除此之外：不限制字数、不限制句数、不限制结构、不要求共情、不要求免责声明、不要求红旗清单、不要求追问、不要求自我介绍、不要求科室范围说明。",
    "严禁套话模板：不要写「我是××主任/医生团队医助」；不要写「咱们群里主要聊××」；不要固定「先别急/确实挺难受」开场；不要为了凑段落而分段。",
    "不要输出 Markdown、JSON、代码块。",
    withCard ? "本轮系统可能附带服务入口，正文里轻轻提一句即可，不要推销。" : "不要提小程序/服务入口/发编号。",
    personaRules,
    "语调：" + tone + "；目标：" + goal + "。"
  ].filter(Boolean).join("\n");

  const user = [
    "患者原话：" + String(input.text || "").slice(0, 1200),
    cue ? ("线索：" + cue) : "",
    input.summary ? ("会话摘要：" + String(input.summary).slice(0, 400)) : "",
    input.recentTurns ? ("最近患者补充：" + String(input.recentTurns).slice(0, 500)) : "",
    input.knownFacts ? ("已知信息：" + String(input.knownFacts).slice(0, 400)) : "",
    withCard ? ("将附带入口码（勿让患者发编号）：" + input.cardCode) : "",
    "直接输出回复正文。无模板、无强制结构；只避开上面的屏蔽词/越权。"
  ].filter(Boolean).join("\n");

  const body = {
    model: cfg.model,
    messages:[{ role:"system", content:system }, { role:"user", content:user }],
    thinking:{ type:"disabled" },
    temperature: 0.9,
    top_p:0.95,
    stream:false
  };
  body[cfg.maxTokenField || "max_tokens"] = 1200;

  const controller = new AbortController();
  const timer = setTimeout(()=>controller.abort(), +(process.env.TRIAGE_AI_TIMEOUT_MS || 20000));
  try{
    const res = await fetch(cfg.url, {
      method:"POST",
      headers: cfg.headers,
      signal:controller.signal,
      body:JSON.stringify(body)
    });
    clearTimeout(timer);
    if(!res.ok) return { ok:false, reason:"http_" + res.status };
    const data = await res.json();
    const raw = String((((data.choices || [])[0] || {}).message || {}).content || "").trim();
    let text = lightCleanLlmText(raw);
    text = scrubTemplateResidue(text);
    text = scrubForbiddenSentences(text);
    if(text.length > 2000){
      const cut = text.slice(0, 2000);
      const m = cut.match(/^[\s\S]*[。！？!?]/);
      text = (m ? m[0] : cut).trim();
    }
    if(!text) return { ok:false, reason:"empty" };
    return { ok:true, text, source:"llm" };
  }catch(e){
    clearTimeout(timer);
    return { ok:false, reason:(e && e.name === "AbortError") ? "timeout" : "fetch_error" };
  }
}

async function compose(input){
  input = input || {};
  if(input.tone === "emergency") return { ok:true, text:"", source:"defer_safe" };

  const info = doctorInfo(input.doctorId);
  const cue = extractCue(input.text);
  const ctx = {
    doctorName: info.name,
    dept: info.dept,
    specialty: info.specialty,
    cue,
    text: input.text,
    noCard: !input.cardCode
  };

  const llm = await composeViaFetch(input);
  if(llm.ok && llm.text) return llm;

  const text = scrubBannedPhrases(softTemplate(input.goal, input.tone, ctx));
  return {
    ok:true,
    text,
    source:"soft_template",
    fallbackReason: llm.reason || "llm_skip"
  };
}

module.exports = { compose, softTemplate, pick, extractCue, doctorInfo, lightCleanLlmText, scrubBannedPhrases, scrubForbiddenSentences, scrubTemplateResidue };
