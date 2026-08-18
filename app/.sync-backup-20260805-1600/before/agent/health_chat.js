"use strict";
const triage = require("../triage.js");
const { db } = require("../db.js");

const CLINICAL_SLOT_KEYS = [
  "bodyPart", "duration", "worsening", "painPattern",
  "hasFever", "hasDiarrhea", "symptoms", "asksMedication", "hasMedicalCue"
];

function isIdentityAsk(text){
  return /你是谁|你叫什么|你是什么|什么身份|介绍一下你(?:自己)?|你是(?:不是)?(?:机器人|ai|AI)|你能(?:干|做)什么/.test(String(text || ""));
}

function wantsDoctorRoute(text, understood){
  if(understood && understood.service && understood.service.goal === "consult") return true;
  return /(想)?(找|联系|看).{0,6}(医生|主任|大夫)|一对一|图文咨询|在线问诊|我想去找/.test(String(text || ""));
}

function needsKnowledge(text){
  return /能吃|可以吃|忌口|术后|复查|护理|注意事项|怎么喝|喝什么|饮食|能喝|喝牛奶|吃鸡蛋/.test(String(text || ""));
}

function topicKeyFrom(slots, text){
  const s = slots || {};
  if(s.bodyPart) return String(s.bodyPart);
  const t = String(text || "");
  if(/头晕|眩晕/.test(t)) return "头晕";
  if(/心慌|心悸|心跳快/.test(t)) return "心慌";
  if(/牙.{0,6}(疼|痛)|牙齿|牙痛|牙疼/.test(t)) return "牙齿";
  if(/头.{0,4}(疼|痛)|头痛|头疼|偏头痛/.test(t)) return "头部";
  if(/胸(闷|痛|口)|胸口/.test(t)) return "胸部";
  if(/腰.{0,4}(疼|痛|酸)|腰痛/.test(t)) return "腰部";
  if(/上腹|胃/.test(t)) return "上腹";
  if(/下腹|小腹/.test(t)) return "下腹";
  if(/腹|肚子|胃痛|腹痛/.test(t)) return "腹部";
  const locSym = (Array.isArray(s.symptoms) ? s.symptoms : []).find(x =>
    /腹痛|胃痛|牙痛|头痛|胸痛|头晕|心慌|胸闷/.test(String(x || ""))
  );
  if(locSym) return String(locSym);
  return s.topicKey || null;
}

function isTopicSwitch(oldTopic, newTopic, incoming, text, prevSlots){
  const prevPart = prevSlots && prevSlots.bodyPart;
  const nextPart = incoming && incoming.bodyPart;
  const t = String(text || "");
  const incomingTopic = newTopic || topicKeyFrom(incoming, t);
  if(incomingTopic && oldTopic && incomingTopic !== oldTopic){
    const ab = (k) => /腹|胃|肚子|小腹|下腹|上腹/.test(String(k || ""));
    if(ab(oldTopic) && ab(incomingTopic)) return false;
    return true;
  }
  if(nextPart && prevPart && nextPart !== prevPart){
    const ab = (k) => /腹|胃|肚子|小腹|下腹|上腹/.test(String(k || ""));
    if(ab(prevPart) && ab(nextPart)) return false;
    return true;
  }
  if(!newTopic || !oldTopic || newTopic === oldTopic) return false;
  if(nextPart && nextPart !== oldTopic) return true;
  if(/头晕|眩晕|心慌|心悸|牙.{0,6}(疼|痛)|头.{0,4}(疼|痛)|胸(闷|痛)|腰.{0,4}(疼|痛)/.test(t)){
    const ab = (k) => /腹|胃|肚子|小腹|下腹|上腹/.test(String(k || ""));
    if(ab(oldTopic) && ab(newTopic)) return false;
    return true;
  }
  return false;
}

function resetClinicalSlots(base){
  const next = Object.assign({}, base || {});
  for(const k of CLINICAL_SLOT_KEYS) delete next[k];
  next.adviceDelivered = false;
  next.lastAdviceText = "";
  delete next.__chatPhase;
  return next;
}

function mergeSlots(prev, understood){
  const prevSlots = Object.assign({}, prev || {});
  delete prevSlots.__chatPhase;
  const incoming = (understood && understood.slots) || {};
  const t = String((understood && understood.text) || "");

  let next = Object.assign({}, prevSlots);
  const incomingTopic = topicKeyFrom(incoming, t);
  const oldTopic = prevSlots.topicKey || topicKeyFrom(prevSlots, "");
  const switching = isTopicSwitch(
    oldTopic,
    incomingTopic || topicKeyFrom(Object.assign({}, prevSlots, incoming), t),
    incoming,
    t,
    prevSlots
  );

  if(switching){
    next = resetClinicalSlots(prevSlots);
  }

  next = Object.assign({}, next, incoming);
  // 合并后再用全文规则巩固部位（发烧续轮保留旧 bodyPart）
  if(/牙.{0,6}(疼|痛)|牙齿|牙痛|牙疼/.test(t)) next.bodyPart = "牙齿";
  else if(/头.{0,4}(疼|痛)|头痛|头疼|偏头痛/.test(t)) next.bodyPart = "头部";
  else if(/胸(闷|痛|口)|胸口/.test(t)) next.bodyPart = "胸部";
  else if(/腰.{0,4}(疼|痛|酸)|腰痛/.test(t)) next.bodyPart = "腰部";
  else if(/上腹|胃[部口]?|肚脐上/.test(t)) next.bodyPart = "上腹";
  else if(/下腹|小腹/.test(t)) next.bodyPart = "下腹";
  else if(/肚子|腹痛|胃痛/.test(t) && !next.bodyPart) next.bodyPart = "腹部";
  if(/发烧|发热|低热|高热/.test(t)) next.hasFever = true;
  if(/拉肚子|腹泻/.test(t)) next.hasDiarrhea = true;
  if(/持续性|一直疼|持续疼|不停/.test(t)) next.painPattern = "持续";
  else if(/阵发|一阵一阵|间歇/.test(t)) next.painPattern = "阵发";
  if(Array.isArray(prevSlots.symptoms) || Array.isArray(next.symptoms)){
    if(switching){
      next.symptoms = [].concat(incoming.symptoms || []);
    }else{
      next.symptoms = [...new Set([].concat(prevSlots.symptoms || [], next.symptoms || []))];
    }
  }
  next.topicKey = topicKeyFrom(next, t) || oldTopic || next.topicKey || null;
  if(switching){
    next.adviceDelivered = false;
    next.lastAdviceText = "";
    next.urgentRefreshed = false;
  }else{
    if(prevSlots.adviceDelivered) next.adviceDelivered = true;
    if(prevSlots.lastAdviceText) next.lastAdviceText = prevSlots.lastAdviceText;
    if(prevSlots.urgentRefreshed) next.urgentRefreshed = true;
    // 续轮补信息时保留未再出现的 bodyPart
    if(!next.bodyPart && prevSlots.bodyPart) next.bodyPart = prevSlots.bodyPart;
  }
  delete next.__chatPhase;
  return next;
}

function buildQuery(text, slots){
  const s = slots || {};
  return [text, s.bodyPart, s.duration, s.hasFever ? "发热" : "", s.painPattern || "", s.worsening ? "加重" : ""]
    .filter(Boolean).join(" ").slice(0, 500);
}

function missingSlotKeys(slots){
  const s = slots || {};
  const miss = [];
  if(!s.bodyPart) miss.push("bodyPart");
  if(!s.duration) miss.push("duration");
  if(s.worsening == null && !s.painPattern) miss.push("pattern");
  if(s.hasFever == null && s.hasDiarrhea == null) miss.push("assoc");
  return miss;
}

function decidePhase({ understood, slots, evidence, emergency, clinicalRisk, chatPhaseHint, text }){
  const s = slots || {};
  const t = String(text || (understood && understood.text) || "");
  if(isIdentityAsk(t)) return "identity";
  if(emergency || clinicalRisk === "high") return "escalate";
  if(s.asksMedication || chatPhaseHint === "escalate") return "escalate";
  if(/确诊|是不是癌|开药|吃什么药|剂量/.test(t)) return "escalate";
  if(wantsDoctorRoute(t, understood) || chatPhaseHint === "route") return "route";

  const specificQ = needsKnowledge(t);
  const hasComplaint = !!(
    s.hasMedicalCue || s.bodyPart || (Array.isArray(s.symptoms) && s.symptoms.length)
    || /疼|痛|晕|慌|烧|吐|泻|不舒服|难受|术后|能吃|忌口/.test(t)
  );
  const urgentCue = !!(s.hasFever || s.worsening === true || s.painPattern === "持续");

  // 已发过长建议：同话题短跟进；新红旗可再答一轮
  if(s.adviceDelivered){
    const refreshUrgent = urgentCue && !s.urgentRefreshed && /发烧|发热|持续|加重|更疼|更痛|心慌|头晕加重/.test(t);
    if(refreshUrgent) return "advise";
    // 同话题追问细节 → followup；否则若仍有主诉也走 advise（答主问辅）
    if(/会不会|严不严重|怎么办|怎么缓解|好些了|还是|然后呢|还有呢/.test(t) && hasComplaint){
      return "followup";
    }
  }

  // 答主问辅：有症状/不适主诉 → 直接给建议，不再卡在 intake 填槽
  if(hasComplaint || specificQ) return "advise";
  if(evidence && evidence.sufficiency !== "none" && specificQ) return "advise";
  return "intake";
}

function matchFaq(doctorId, text, limit){
  const q = String(text || "").trim();
  if(!q) return [];
  const qGrams = new Set();
  for(let i = 0; i < q.length - 1; i++) qGrams.add(q.slice(i, i + 2));
  const rows = db.prepare("SELECT q,a FROM faq WHERE doctor_id=? ORDER BY sort,id LIMIT 80").all(Number(doctorId));
  const scored = [];
  for(const f of rows){
    const blob = String(f.q || "") + String(f.a || "");
    let hit = 0;
    for(let i = 0; i < blob.length - 1; i++){
      if(qGrams.has(blob.slice(i, i + 2))) hit++;
    }
    if(hit >= 2) scored.push({ hit, title: f.q, body: f.a });
  }
  return scored.sort((a, b) => b.hit - a.hit).slice(0, limit || 2).map((x, i) => ({
    id: "faq" + i,
    layer: "FAQ",
    title: x.title,
    body: x.body,
    source: "faq"
  }));
}

function faqStrongHit(doctorId, text){
  const items = matchFaq(doctorId, text, 1);
  return items.length > 0;
}

async function retrieveEvidence(doctorId, text, slots){
  const ctx = {
    doctor: { id: Number(doctorId) },
    knowledge: db.prepare(
      "SELECT id,layer,mode,title,body,source,status FROM knowledge_items WHERE doctor_id=? AND status='ready' ORDER BY id LIMIT 50"
    ).all(Number(doctorId))
  };
  let kb;
  try{
    kb = await triage.retrieveKnowledge(ctx, buildQuery(text, slots), 3);
  }catch(e){
    kb = { sufficiency: "none", items: [], top: 0, source: "fallback" };
  }
  const faqItems = matchFaq(doctorId, text, 2);
  if(faqItems.length && (!kb.items || !kb.items.length)){
    kb = { sufficiency: "partial", items: faqItems, top: 1, source: "faq" };
  }else if(faqItems.length){
    kb.items = (kb.items || []).concat(faqItems).slice(0, 4);
    if(kb.sufficiency === "none") kb.sufficiency = "partial";
  }
  return kb;
}

async function resolveTurn(input){
  const doctorId = Number(input.doctorId);
  const text = String(input.text || "").trim();
  const session = input.session || {};
  const understood = input.understood;
  const slots = mergeSlots(session.slots, understood);
  const wantKb = needsKnowledge(text) || faqStrongHit(doctorId, text);
  const evidence = wantKb
    ? await retrieveEvidence(doctorId, text, slots)
    : { sufficiency: "none", items: [], top: 0, source: "skipped" };
  let phase = decidePhase({
    understood, slots, evidence,
    emergency: !!input.emergency,
    clinicalRisk: input.clinicalRisk || "low",
    chatPhaseHint: (input.planned && input.planned.chatPhaseHint) || null,
    text
  });
  // 兼容旧名：测例/日志可读 educate
  const phaseOut = phase === "advise" ? "advise" : phase;
  let attachCode = null;
  if((phaseOut === "escalate" || phaseOut === "route") && input.allowCard) attachCode = "101";
  return {
    phase: phaseOut,
    slots,
    evidence,
    attachCode,
    handoff: phaseOut === "escalate" || phaseOut === "route",
    missingSlots: missingSlotKeys(slots),
    urgent: !!(slots.hasFever || slots.worsening === true || slots.painPattern === "持续"),
    usedRag: wantKb,
    needsKnowledge: wantKb
  };
}

module.exports = {
  resolveTurn, mergeSlots, decidePhase, buildQuery, retrieveEvidence, matchFaq, missingSlotKeys,
  needsKnowledge, isIdentityAsk, wantsDoctorRoute, topicKeyFrom, resetClinicalSlots
};
