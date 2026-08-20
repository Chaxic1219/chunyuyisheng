/* 群消息接管门控：只处理明确业务需求，普通群内闲聊静默。
   纯确定性函数，不调用 LLM；QiWe 真回调与本地 community 通道共用。 */
const { db } = require("./db.js");
const engine = require("./engine.js");
const triage = require("./triage.js");
const keywordLexicon = require("./keyword_lexicon.js");

function clean(v, n){
  return String(v == null ? "" : v).trim().slice(0, n || 1000);
}

function norm(v){
  return clean(v, 1000).replace(/\s+/g, " ").toLowerCase();
}

function asList(v){
  if(v == null || v === "") return [];
  if(Array.isArray(v)) return v;
  if(typeof v === "object") return [v];
  const s = String(v).trim();
  if(!s) return [];
  if((s[0] === "[" && s[s.length - 1] === "]") || (s[0] === "{" && s[s.length - 1] === "}")){
    try{ return asList(JSON.parse(s)); }catch(e){}
  }
  return s.split(/[,\s;；]+/).filter(Boolean);
}

function collectMentionIds(v, out, depth){
  if(depth > 3 || v == null) return;
  if(Array.isArray(v)){
    v.forEach(x=>collectMentionIds(x, out, depth + 1));
    return;
  }
  if(typeof v === "object"){
    const keys = ["userId","userid","user_id","id","uid","externalUserId","external_userid","text","name"];
    for(const k of keys){
      if(v[k] != null && String(v[k]).trim()) out.push(clean(v[k], 160));
    }
    for(const k of ["atUserIds","at_user_ids","atUsers","at_users","atList","at_list","mentionList","mentions","mentionIds","mentionedUserIds","userIds","user_ids"]){
      if(v[k] != null) collectMentionIds(v[k], out, depth + 1);
    }
    return;
  }
  for(const item of asList(v)) out.push(clean(item, 160));
}

function rawMentionsSelf(evt, cfg){
  const raw = (evt && evt.raw) || {};
  const msgData = (evt && evt.msgData) || raw.msgData || {};
  if(raw.isAtMe === true || raw.atMe === true || raw.mentionedMe === true || raw.mentionMe === true || msgData.isAtMe === true || msgData.atMe === true) return true;
  const selfIds = new Set([
    clean(cfg && cfg.selfUserId, 160),
    clean(evt && evt.loggedInUserId, 160),
    clean(evt && evt.receiverId, 160),
    clean(raw.userId, 160)
  ].filter(Boolean));
  if(!selfIds.size) return false;
  const ids = [];
  for(const k of ["atUserIds","at_user_ids","atUsers","at_users","atList","at_list","mentionList","mentions","mentionIds","mentionedUserIds","userIds","user_ids"]){
    collectMentionIds(raw[k], ids, 0);
    collectMentionIds(msgData[k], ids, 0);
  }
  return ids.some(x=>selfIds.has(clean(x, 160)));
}

function doctorMentionTokens(doctorId){
  const out = ["小助手","医助","医生","主任","机器人","客服","助理","春雨","医患通"];
  try{
    const d = db.prepare("SELECT name,dept,hospital,group_name FROM doctors WHERE id=?").get(+doctorId);
    if(d){
      if(d.name) out.push(d.name);
      const name = clean(d.name, 80);
      if(name.length >= 2){
        out.push(name + "医生", name + "主任");
        out.push(name.slice(0, 1) + "主任");
      }
      if(d.group_name) out.push(d.group_name);
    }
  }catch(e){}
  return Array.from(new Set(out.map(x=>clean(x, 80)).filter(Boolean)));
}

function textMentionsTarget(text, doctorId){
  const t = clean(text, 1000);
  if(!/@/.test(t)) return false;
  return doctorMentionTokens(doctorId).some(token=>t.indexOf("@" + token) >= 0 || t.indexOf("@ " + token) >= 0);
}

function codeBoundaryRe(code){
  const c = String(code).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp("(^|[^0-9A-Za-z])" + c + "($|[^0-9A-Za-z])");
}

function parseAliases(s){
  try{
    const a = JSON.parse(s || "[]");
    return Array.isArray(a) ? a : [];
  }catch(e){
    return [];
  }
}

function hasKnownCodeOrMenu(doctorId, text){
  const raw = clean(text, 1000);
  const t = norm(raw);
  if(!t) return false;
  if(["1","菜单","功能","全部功能","群功能","群功能菜单","功能菜单"].includes(t)) return true;
  if(/(?:发送|发|回复|输入|查看|看)\s*(?:1|菜单|功能|全部功能|群功能菜单)/.test(t)) return true;
  if(/(?:菜单|功能).{0,4}(?:是什么|有哪些|列表|大全)/.test(t)) return true;
  if(engine.match(doctorId, raw)) return true;
  let rows = [];
  try{
    rows = db.prepare("SELECT code,aliases FROM rules WHERE doctor_id=? AND enabled=1").all(+doctorId);
  }catch(e){}
  for(const r of rows){
    const code = clean(r.code, 40);
    if(!code) continue;
    if(t === code.toLowerCase()) return true;
    if(/^\d$/.test(code)){
      const c = code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if(new RegExp("(?:发送|发|回复|输入|查看|看)\\s*" + c + "(?:$|[^0-9A-Za-z])").test(t)) return true;
    }else if(codeBoundaryRe(code).test(t)){
      return true;
    }
    const aliases = parseAliases(r.aliases);
    for(const a of aliases){
      const al = norm(a);
      if(al && (t === al || t.indexOf(al) >= 0)) return true;
    }
  }
  return false;
}

const BUSINESS_INTENT_RE = /咨询|问诊|问医生|找医生|找.{0,8}(?:医生|主任|大夫|教授)|联系医生|联系医助|打算.{0,8}找|直接找|想要找|要见|想见|人工|转人工|客服|挂号|加号|住院|入院|预约|门诊|出诊|就诊|联络表|联系表|建档|档案|随访|复诊|报告|检查|检验|化验|用药|吃药|开药|处方|投诉|病历|病案|病史|整理|复印|胃镜|肠镜|胃肠镜|息肉|幽门|螺杆菌|hp\b|饮食|忌口|保养|调理|留意|注意|复查|严重吗|怎么办|咋办|怎么(?:办|处理|治疗|调理|保养|复查|预约|挂号|联系)|如何(?:办|处理|治疗|看|弄|调理)|需要.*(?:看医生|就医|挂号|加号|复查|手术|住院|用药|吃药|检查)|可以.*(?:问|咨询|挂号|加号|预约|用药|吃药|检查)|想(?:止痒|止痛|消肿|消炎)|怎么止痒|如何止痒/i;
const MENU_QUESTION_RE = /(?:这里|这群|这个群|群里|进群|新人|第一次|你|机器人|医助|助手|小助手|春雨|医患通).{0,12}(?:能干嘛|干什么|做什么|可以干嘛|可以做什么|有什么用|怎么用|如何用|怎么玩|怎么开始|怎么操作|操作说明|使用说明|新手引导|有哪些功能|有什么功能|功能介绍|有什么服务|能帮(?:我)?什么|能提供什么)/i;
/* 常见症状/疾病短句在群内应进分诊，不能被当作闲聊静默。
   词表集中维护于 keyword_lexicon.js（急诊共识 + 消化道/皮肤等口语）。 */
const SYMPTOM_ASK_RE = keywordLexicon.buildSymptomAskRe();

/* 无实际表达意义（A∪B）：寒暄应承 / 极短无办事意图 → 群内不调 AI */
const MEANINGLESS_EXACT_RE = /^(?:好的?|好哒|好滴|好呢|行|嗯+|恩+|嗯嗯|哦+|噢+|噢嗯|收到|知晓|知道了|明白(?:了)?|了解(?:了)?|谢谢|多谢|感谢|辛苦(?:了|啦)?|没事(?:了)?|不用了|早安|早上好|晚安|再见|拜拜|bye+|哈哈+|嘿嘿|呵呵|嘿+|嗨|hi+|hello|ok+|okay|\+1)+$/i;

function hasBusinessIntent(text){
  const t = clean(text, 1000);
  if(!t) return false;
  if(BUSINESS_INTENT_RE.test(t)) return true;
  try{
    const { matchServiceIntent } = require("./agent/understand.js");
    const svc = matchServiceIntent(t);
    return !!(svc && svc.preferredCode);
  }catch(e){
    return false;
  }
}
function hasSymptomAsk(text){
  return SYMPTOM_ASK_RE.test(clean(text, 1000));
}

function hasMenuQuestion(text){
  return MENU_QUESTION_RE.test(clean(text, 1000));
}

function compactNoiseText(text){
  return clean(text, 1000)
    .replace(/\[(?:动画表情|表情|超级表情|emoji)[^\]]*\]/gi, "")
    .replace(/[\s\-_=+~`|\\/*（）()【】\[\]{}<>《》「」『』"'“”‘’。，、！？!?；;：:…·•，]+/g, "")
    .trim();
}

/* 问病/症状类（优先引导 101）；纯挂号/加号等服务流程不算问病硬套。
   含「痒/叮/肿 + 求助/止痒」等轻症自述，避免 L6 静默误杀。 */
const MEDICATION_ASK_RE = /(开药|停药|换药|药量|剂量|这个药|还能.{0,4}吃|继续吃.{0,4}药|吃什么药|用什么药)/i;

const MEDICAL_SESSION_GOALS = new Set([
  "advice", "consult", "clarify", "health_report", "case_analysis", "care_plan", "medical_handoff", "safety"
]);

const CONTEXTUAL_BODY_RE = /^(?:上腹|下腹|肚脐|肚皮|肚子|胃部|心口|胸口|腰背|后腰|左边|右边|左侧|右侧|周围|里面|外面|全腹|小腹|中腹)(?:疼|痛|闷|胀|不舒服|周围)?$/;
const CONTEXTUAL_BODY_ANY_RE = /(?:上腹|下腹|肚脐|肚皮|肚子|胃|心口|胸口|腰|左|右|侧|全腹|小腹|中腹)/;
const CONTEXTUAL_SYMPTOM_WORD_RE = /疼|痛|胀|闷|痒|麻|酸|乏力|没劲|恶心|吐|泻|烧|晕|慌|抽|硬|肿|坠|紧|吃|喝|睡|拉/;
const CONTEXTUAL_DURATION_RE = /^(?:\d+|[一二三四五六七八九十两半个]+)(?:天|周|个月|月|小时|分钟|年左右?)(?:了|左右)?$/;
const CONTEXTUAL_SYMPTOM_SHORT_RE = /发烧|发热|恶心|呕吐|拉肚子|腹泻|便秘|出血|头晕|乏力|瘙痒|止痒|频繁|尿频|尿急/;
const CONTEXTUAL_RHYTHM_RE = /^(?:一阵一阵|时好时坏|间断|偶尔|经常|有时|持续|一直|越来越)/;
const CONTEXTUAL_ENTRY_ASK_RE = /^(?:入口|联系(?:方式|入口)?).{0,8}(?:在哪|哪里|怎么)|^怎么联系(?:医生|团队)/;

/* 运维/技术/群务口语：与问诊上下文无逻辑关系 → 应判 L6 静默（即便仍在 health_chat 会话中） */
const OPS_CHITCHAT_RE = /(?:配置|部署|上线|测试|调试|搞定|弄完|弄好了|可以了|发完了|采完了|更新完|重启|验图|验一下|后台|服务器|接口|回调|token|patch|seed|脚本|代码|bug|修复完|改完|覆盖完|贴图|封面|采集|好了没|行不行|能用吗|生效了吗|看到了吗)/i;
const UNRELATED_SOCIAL_RE = /(?:天气|股票|电影|游戏|吃饭了吗|下班|周末去哪|旅游|八卦)/i;
const MEDICAL_CONTINUATION_RE = /疼|痛|药|症状|不舒服|难受|加重|减轻|发烧|发热|恶心|呕吐|拉肚子|腹泻|头晕|心慌|胸闷|报告|检查|化验|指标|饮食|忌口|术后|复查|医生|挂号|咨询|怎么办|咋办|还有|另外|顺便|对了.{0,8}(?:疼|痛|药|不舒服)|一阵|频繁|尿频|尿急|上厕/;
const IDENTITY_ASK_RE = /你是谁|你叫什么|你是什么|什么身份|介绍一下你(?:自己)?|你是(?:不是)?(?:机器人|ai|AI)|你能(?:干|做)什么/i;

function loadConversationContext(input){
  const doctorId = Number(input && input.doctorId);
  const patientKey = input && (input.patientKey || input.conversationKey);
  if(!Number.isFinite(doctorId) || !patientKey) return null;
  try{
    const sessionStore = require("./agent/session.js");
    const s = sessionStore.getSession(doctorId, patientKey);
    if(!s) return null;
    const age = Date.now() - (s.updatedAt || 0);
    if(age > 45 * 60 * 1000) return null;
    return s;
  }catch(e){
    return null;
  }
}

function isActiveMedicalSession(session){
  if(!session) return false;
  const goal = session.goal;
  if(goal && MEDICAL_SESSION_GOALS.has(goal)) return true;
  if(goal === "service" || goal === "schedule" || goal === "menu" || goal === "profile") return false;
  const slots = session.slots || {};
  if(slots.hasMedicalCue || slots.asksMedication || (slots.symptoms && slots.symptoms.length)) return true;
  if(session.summary && /疼|痛|病史|报告|术后|症状|不舒服|化验|指标/.test(session.summary)) return true;
  const turns = Array.isArray(session.turns) ? session.turns.slice(-6) : [];
  return turns.some(t=>{
    const g = t && t.goal;
    return g && MEDICAL_SESSION_GOALS.has(g);
  });
}

function isContextualMedicalReply(text, session){
  const raw = clean(text, 200);
  if(!raw || !session) return false;
  if(hasBusinessIntent(raw) || isDiseaseConsultAsk(raw) || isMedicationAsk(raw)) return true;
  try{
    const { matchHealthcarePersona } = require("./agent/persona_router.js");
    if(matchHealthcarePersona(raw, session.slots || {})) return true;
  }catch(e){}
  const compact = compactNoiseText(raw);
  if(!compact) return false;
  if(compact.length > 48) return false;
  if(CONTEXTUAL_BODY_RE.test(compact)) return true;
  if(CONTEXTUAL_DURATION_RE.test(compact)) return true;
  if(/^(?:有|没有|会|不会|是|不是|还好|有点|轻微|加重|减轻了?|是的?|对的?|嗯嗯?)$/.test(compact)) return true;
  if(CONTEXTUAL_SYMPTOM_SHORT_RE.test(raw) && compact.length <= 24) return true;
  if(CONTEXTUAL_RHYTHM_RE.test(compact) && compact.length <= 20) return true;
  if(CONTEXTUAL_ENTRY_ASK_RE.test(raw)) return true;
  if(/频繁|次数|偏多|增多|多/.test(raw) && /上厕|小便|大便|尿|便|夜起|起夜|排便/.test(raw) && compact.length <= 32) return true;
  if(/^(?:大概|约|差不多|一直|最近|今天|昨天|前天)/.test(compact) && !UNRELATED_SOCIAL_RE.test(raw)) return true;
  // 活跃医疗会话中，含部位词或症状/生活词（吃/睡/疼/胀等）→ 视为医疗续聊
  // （防「肚脐下面一点」「是的，吃了饭更明显」等被误判闲聊；运维/社会闲聊除外）
  if(isActiveMedicalSession(session)
    && (CONTEXTUAL_BODY_ANY_RE.test(raw) || CONTEXTUAL_SYMPTOM_WORD_RE.test(raw))
    && !OPS_CHITCHAT_RE.test(raw)
    && !UNRELATED_SOCIAL_RE.test(raw)){
    return true;
  }
  return false;
}

function isUnrelatedChitchat(text, session){
  const raw = clean(text, 1000);
  if(!raw) return true;
  if(IDENTITY_ASK_RE.test(raw)) return false;
  if(hasBusinessIntent(raw) || hasSymptomAsk(raw) || isDiseaseConsultAsk(raw) || isMedicationAsk(raw)) return false;
  if(hasMenuQuestion(raw)) return false;
  try{
    const { matchServiceIntent } = require("./agent/understand.js");
    const svc = matchServiceIntent(raw);
    if(svc && (svc.preferredCode || svc.goal === "menu")) return false;
  }catch(e){}

  const compact = compactNoiseText(raw);
  if(OPS_CHITCHAT_RE.test(raw) && !/(?:药|饮食|康复|护理|忌口).{0,6}(?:配置|设置)/.test(raw)) return true;
  if(UNRELATED_SOCIAL_RE.test(raw)) return true;
  if(isMeaninglessNoise(raw)) return true;

  if(!session || !isActiveMedicalSession(session)){
    if(MEDICAL_CONTINUATION_RE.test(raw)) return false;
    if(OPS_CHITCHAT_RE.test(raw) || UNRELATED_SOCIAL_RE.test(raw)) return true;
    if(isMeaninglessNoise(raw)) return true;
    return false;
  }

  if(isContextualMedicalReply(raw, session)) return false;
  if(MEDICAL_CONTINUATION_RE.test(raw)) return false;
  if(/(?:配置|部署|上线|测试|调试|封面|贴图|采集|重启).{0,8}(?:完|好|了|完毕|ok)/i.test(raw)) return true;
  if(/^(?:应该?)?(?:都|已经)?(?:配|设|弄|搞|整|改|调|测|发|采|更|覆)(?:置|完|好了|完了|完毕|ok)+$/i.test(compact)) return true;
  if(compact.length <= 16 && /(?:完|好|了|完毕|ok)$/i.test(compact) && !MEDICAL_CONTINUATION_RE.test(raw)) return true;
  return false;
}

function hasConversationMedicalContext(input){
  const session = loadConversationContext(input);
  if(!isActiveMedicalSession(session)) return null;
  const text = clean((input && (input.rawText || input.text)) || "", 1000);
  if(!text) return null;
  if(isMeaninglessNoise(text)) return null;
  if(isUnrelatedChitchat(text, session)) return null;
  if(isContextualMedicalReply(text, session)) return session;
  return null;
}

function isMedicationAsk(text){
  return MEDICATION_ASK_RE.test(clean(text, 1000));
}

function isDiseaseConsultAsk(text){
  const t = clean(text, 1000);
  if(!t) return false;
  if(hasSymptomAsk(t)) return true;
  if(isMedicationAsk(t)) return true;
  if(/挂号|加号|出诊|建档|病案复印|住院须知|预约住院|预约门诊/.test(t) && !hasSymptomAsk(t)) return false;
  // 饮食致病自述（即便未写「怎么办」）也应进分诊，避免「吃了虾吃坏肚子里」被 L6 静默
  if(/吃坏|闹肚子|食物中毒|吃错东西|吃了不干净|坏肚子|肚子坏了/.test(t)) return true;
  const hasBodySignal = /(?:病|症|炎|疼|痛|烧|咳|泻|吐|晕|闷|慌|疹|凉|感|痒|肿|叮|咬|蜇|包)(?:了|吗|呢|啊|咋|怎么|如何|怎么办|咋办)?/.test(t);
  const hasHelpSeek = /怎么办|咋办|怎么(?:办|处理|治|看|弄|止)|严重吗|要不要紧|是不是|会不会|想(?:止|消|治|看)|止痒|止痛|消肿|消炎|有没有.*(?:药|办法|方法)|该怎么/.test(t);
  if(hasBodySignal && hasHelpSeek) return true;
  // 部位 + 不适自述（无「怎么办」也算问病）：「我肚子有点疼」「有点尿急」「上厕所比较频繁」
  const hasBodyPart = /肚子|胃|腹|头|胸|腰|背|嗓子|喉咙|牙|眼睛|耳朵|鼻子|腿|脚|手|关节|小便|大便|尿|便|上厕|厕所/.test(t);
  const hasDiscomfort = /疼|痛|胀|闷|慌|烧|咳|痒|肿|急|频|酸|麻|恶心|难受|不舒服|不适|多/.test(t);
  if(/上厕|尿频|尿急|起夜|夜尿|排便次数|大便次数/.test(t) && /频繁|次数|多|增加|偏多|增多/.test(t)) return true;
  return hasBodyPart && hasDiscomfort;
}

function isMeaninglessNoise(text){
  const raw = clean(text, 1000);
  if(!raw) return true;
  if(hasBusinessIntent(raw) || hasSymptomAsk(raw) || hasMenuQuestion(raw) || isDiseaseConsultAsk(raw) || isMedicationAsk(raw)) return false;
  if(/^\d{1,4}$/.test(raw.trim()) || /(?:发送|发|回复|输入)\s*\d{1,4}/.test(raw)) return false;
  const compact = compactNoiseText(raw);
  if(!compact) return true;
  if(CONTEXTUAL_DURATION_RE.test(compact) || CONTEXTUAL_BODY_RE.test(compact)) return false;
  if(MEANINGLESS_EXACT_RE.test(compact)) return true;
  if(compact.length <= 3) return true;
  return false;
}

function shouldHandleGroupText(input){
  input = input || {};
  const text = clean(input.rawText || input.text, 1000);
  const doctorId = Number(input.doctorId);
  const evt = input.evt || {};
  const cfg = input.cfg || null;
  if(!text) return { ok:false, reason:"group_empty", skipped:"group_chitchat", riskLevel:"low" };
  if(rawMentionsSelf(evt, cfg) || textMentionsTarget(text, doctorId)){
    return { ok:true, reason:"mention" };
  }
  if(Number.isFinite(doctorId) && hasKnownCodeOrMenu(doctorId, text)){
    return { ok:true, reason:"code_or_menu" };
  }
  if(hasMenuQuestion(text)){
    return { ok:true, reason:"menu_question" };
  }
  if(hasBusinessIntent(text)){
    return { ok:true, reason:"business_intent" };
  }
  if(hasSymptomAsk(text)){
    return { ok:true, reason:"symptom_ask" };
  }
  // 问病求助句（症状词表未穷举时的兜底）：不得落 L6 闲聊静默
  if(isDiseaseConsultAsk(text)){
    return { ok:true, reason:"disease_consult" };
  }
  // 用药确认/开药类：不得落 group_chitchat（即便尚未命中 HUMAN_TRIGGERS）
  if(isMedicationAsk(text)){
    return { ok:true, reason:"medication_ask" };
  }
  const convo = hasConversationMedicalContext(input);
  if(convo){
    return {
      ok:true,
      reason:"conversation_context",
      riskLevel:"low",
      conversationGoal: convo.goal || null
    };
  }
  const risk = Number.isFinite(doctorId) ? triage.scanRisk(text, doctorId) : triage.scanRisk(text);
  if(risk && risk.riskLevel && risk.riskLevel !== "low"){
    return { ok:true, reason:"medical_risk", riskLevel:risk.riskLevel, triggers:risk.triggers || [] };
  }
  // 症状自述（有点疼/尿急等）：scanRisk.sentinel=true 时必须进分诊，不得因缺少「怎么办」落 L6 静默
  if(risk && risk.sentinel){
    return {
      ok:true,
      reason:"symptom_sentinel",
      riskLevel:(risk && risk.riskLevel) || "low",
      triggers:risk.triggers || [],
      sentinel:true
    };
  }
  if(isMeaninglessNoise(text)){
    return { ok:false, reason:"meaningless_noise", skipped:"meaningless_noise", riskLevel:"low" };
  }
  return { ok:false, reason:"group_chitchat", skipped:"group_chitchat", riskLevel:(risk && risk.riskLevel) || "low", triggers:(risk && risk.triggers) || [] };
}

module.exports = {
  shouldHandleGroupText, hasBusinessIntent, hasSymptomAsk, hasKnownCodeOrMenu, hasMenuQuestion,
  textMentionsTarget, isMeaninglessNoise, isDiseaseConsultAsk, isMedicationAsk,
  loadConversationContext, isActiveMedicalSession, isContextualMedicalReply, hasConversationMedicalContext,
  isUnrelatedChitchat
};
