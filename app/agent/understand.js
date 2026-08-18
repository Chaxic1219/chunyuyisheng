/* 理解层：服务意图 + 医疗意图 + 轻量抽槽（规则优先，可扩展 LLM） */
const triage = require("../triage.js");
const { matchHealthcarePersona } = require("./persona_router.js");

function clean(v, n){
  return String(v == null ? "" : v).trim().slice(0, n || 1000);
}

const SERVICE_PATTERNS = [
  { goal:"profile", code:"808", re:/(医生简介|个人主页|主任主页|了解一下(吕|医生)|看看医生简介|医生介绍)/i },
  { goal:"video", code:"102", re:/(视频|当面|远程).{0,4}(问诊|咨询)|视频问诊/i },
  { goal:"schedule", code:"303", re:/(挂号|门诊时间|出诊|几点出诊|怎么挂号|挂号渠道)/i },
  { goal:"add_clinic", code:"404", re:/(加号|门诊加号|能加号吗|求加号)/i },
  { goal:"admission", code:"414", re:/(住院|办住院|住院预约)/i },
  { goal:"thanks", code:"909", re:/(感谢|送心意|打赏)/i },
  { goal:"review", code:"919", re:/(评价|口碑|好评)/i },
  { goal:"menu", code:null, re:/(能干嘛|能干什么|能做什么|有什么功能|怎么用|全部功能|群功能|有哪些服务|都能干什么|都可以做什么)/i },
  // 咨询放后：避免「看看医生简介」被「看看…医生」截胡
  { goal:"consult", code:"101", re:/(想)?(咨询|问诊|看病|看一下|找|联系).{0,8}(医生|主任|大夫|教授)|一对一|图文咨询|在线问诊|(找|联系).{0,6}(吕|周|主任)|打算.{0,8}找|直接找|想要找|要见|想见/i }
];

const MEDICAL_HINT = /(疼|痛|发烧|发热|黄疸|呕吐|出血|便血|黑便|胸闷|心慌|心悸|头晕|眩晕|呼吸困难|开药|吃什么药|是不是癌|报告|化验|B超|CT|MRI|要不要手术|确诊|诊断|上腹|下腹|小腹|肚子|腹痛|胃痛|牙疼|牙痛|头痛|头疼|胆囊|术后|能吃|可以吃|饮食|忌口|复查|不舒服|难受)/i;
const MEDICATION_ASK = /(开药|吃什么药|用什么药|开点药|开些药|止痛药|开点.{0,4}药|药量|剂量|停药|换药|还能(?:不能)?(?:继续)?吃|可以继续吃|要不要继续吃|这个药|那种药|药还能|继续吃药|还吃(?:不吃)?药)/i;

function extractSlots(text){
  const t = clean(text, 1000);
  const slots = {};
  if(!t) return slots;
  const dur = t.match(/(\d+)\s*(天|周|个月|月|小时|分钟)/);
  if(dur) slots.duration = dur[0];
  else if(/半\s*(个)?\s*(小时|钟头)/.test(t)) slots.duration = "半个小时";
  else if(/一会儿|一下|刚没多久|没多久/.test(t)) slots.duration = (t.match(/一会儿|一下|刚没多久|没多久/) || ["一会儿"])[0];
  else if(/刚开始|刚刚|今天|昨[天晚]|这几天|好几天|一段时间/.test(t)) slots.duration = t.match(/刚开始|刚刚|今天|昨[天晚]|这几天|好几天|一段时间/)[0];
  if(/没加重|没有加重|未加重|不加重/.test(t)) slots.worsening = false;
  else if(/加重|越来越|突然/.test(t)) slots.worsening = true;
  if(MEDICAL_HINT.test(t)) slots.hasMedicalCue = true;
  if(MEDICATION_ASK.test(t)) slots.asksMedication = true;
  if(/牙.{0,6}(疼|痛)|牙齿|牙痛|牙疼/.test(t)) slots.bodyPart = "牙齿";
  else if(/头.{0,4}(疼|痛)|头痛|头疼|偏头痛|脑袋/.test(t)) slots.bodyPart = "头部";
  else if(/胸(闷|痛|口)|胸口/.test(t)) slots.bodyPart = "胸部";
  else if(/腰.{0,4}(疼|痛|酸)|腰痛/.test(t)) slots.bodyPart = "腰部";
  else if(/上腹|胃[部口]?|肚脐上/.test(t)) slots.bodyPart = "上腹";
  else if(/下腹|小腹/.test(t)) slots.bodyPart = "下腹";
  else if(/肚子|腹痛|胃痛/.test(t)) slots.bodyPart = "腹部";
  if(/发烧|发热|低热|高热|体温/.test(t)) slots.hasFever = true;
  if(/拉肚子|腹泻|稀便/.test(t)) slots.hasDiarrhea = true;
  if(/持续性|一直疼|持续疼|不停/.test(t)) slots.painPattern = "持续";
  else if(/阵发|一阵一阵|一抽一抽|间歇/.test(t)) slots.painPattern = "阵发";
  const symptomBits = [];
  ["胃痛","腹痛","腹胀","腹泻","便秘","恶心","呕吐","黄疸","发热","发烧","胸痛","头痛","头疼","牙疼","牙痛","头晕","眩晕","心慌","心悸","胸闷"].forEach(w=>{
    if(t.indexOf(w) >= 0){
      let n = w;
      if(w === "发烧") n = "发热";
      else if(w === "牙疼" || w === "牙痛") n = "牙痛";
      else if(w === "头疼") n = "头痛";
      else if(w === "眩晕") n = "头晕";
      else if(w === "心悸") n = "心慌";
      symptomBits.push(n);
    }
  });
  if(symptomBits.length) slots.symptoms = [...new Set(symptomBits)];
  if(slots.bodyPart) slots.topicKey = slots.bodyPart;
  else if(symptomBits.find(x => /头晕|心慌|腹痛|胃痛|牙痛|头痛|胸痛|胸闷/.test(x))){
    slots.topicKey = symptomBits.find(x => /头晕|心慌|腹痛|胃痛|牙痛|头痛|胸痛|胸闷/.test(x));
  }
  return slots;
}

function matchServiceIntent(text){
  const t = clean(text, 1000);
  if(!t) return null;
  for(const p of SERVICE_PATTERNS){
    if(p.re.test(t)) return { goal:p.goal, preferredCode:p.code, source:"rule" };
  }
  return null;
}

function normalizeAttachments(list){
  if(!Array.isArray(list) || !list.length) return [];
  return list.slice(0, 6).map(a=>{
    const type = String((a && (a.type || a.msgType || a.kind)) || "image").toLowerCase();
    const name = String((a && (a.name || a.fileName || a.filename)) || "").slice(0, 120);
    const hint = /报告|化验|检验|ct|mri|b超|超声|片子|影像/i.test(name) ? "report_like"
      : /药|处方|盒/i.test(name) ? "med_like"
      : (type.indexOf("image") >= 0 || type === "img" || type === "pic") ? "image"
      : type;
    return { type, name, hint };
  });
}

function understand(input){
  const text = clean(input && input.text, 1000);
  const doctorId = Number(input && input.doctorId);
  const floor = triage.scanRisk(text, doctorId);
  const service = matchServiceIntent(text);
  const slots = extractSlots(text);
  const attachmentHints = normalizeAttachments(input && input.attachments);
  if(attachmentHints.length){
    slots.hasAttachment = true;
    if(attachmentHints.some(h=>h.hint === "report_like")) slots.hasReportImage = true;
    if(attachmentHints.some(h=>h.hint === "med_like")) slots.hasMedImage = true;
  }
  const healthcarePersona = matchHealthcarePersona(text, slots);
  // 医疗意图看症状/用药/哨兵/急危/附件报告/子人设；不把「加号」等过宽 HUMAN_TRIGGERS 地板单独当成医疗意图
  const medicalIntent = !!(slots.hasMedicalCue || slots.asksMedication || floor.emergency || floor.sentinel
    || (floor.riskLevel === "high")
    || slots.hasReportImage || slots.hasMedImage
    || healthcarePersona
    || (floor.humanTrigger && (slots.hasMedicalCue || slots.asksMedication)));
  return {
    text,
    floor,
    service,
    slots,
    medicalIntent,
    healthcarePersona,
    attachmentHints
  };
}

module.exports = { understand, matchServiceIntent, extractSlots, normalizeAttachments, SERVICE_PATTERNS };
