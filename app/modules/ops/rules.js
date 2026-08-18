"use strict";

/**
 * 运营配置规则：默认话术、过期值、渲染、脚本取值。
 */
const GLOBAL_DOMAINS = new Set(["prompts", "safety"]);

const LV_DOCX_SCRIPTS = {
  groupWelcome:"👏您好，欢迎加入吕富靖主任建立的【院外公益健康群】\n⭐点击【医患联络表】提交基础信息，便于医生了解您的情况☑\n⭐“1”😄在群里输入数字，查看所有群功能⭐\n💗点击下方小程序观看吕富靖主任给您的视频问候",
  memberVisit:"【新患者到访 · 仅供医助关注，无需发送】{patient} 首次在群内发言，系统已发送入群欢迎。建议医助关注后续消息，必要时确认身份、备注为「姓名+疾病」，并主动引导 101 咨询/201 挂号等入口。",
  code101:"为保护您的隐私，请通过医生小程序主页相关服务进行 1对1 咨询医生，医生利用空闲时间回复，请耐心等待。感谢您的理解和配合[玫瑰][玫瑰]。\n🌻 紧急情况，请及时到医院就诊。",
  code102:"为保护您的隐私，请通过医生小程序主页视频问诊服务进行 1对1 咨询医生，医生利用空闲时间回复，请耐心等待。感谢您的理解和配合[玫瑰][玫瑰]。\n🌻 紧急情况，请及时到医院就诊。",
  code103:"西城院区010-63138585、科室电话：010-63014411，地址 北京市西城区永安路95号。\n通州院区010-80838585，地址 北京市通州区潞苑东路101号院。\n顺义院区010-81608585，地址 北京市顺义区友谊南街1号。",
  code105:"点击问诊小程序，查看医生回复，如果未回复请耐心等待一下。",
  code201:"请您选择合适的时间，通过医院官方挂号平台挂号，挂号成功后持医保卡前往医院取号。",
  code202:"-",
  code301:"注意：本次加号为群内专属，与医院官方发布门诊信息不互通。请留意医院公众号及群内通知，排除医生停诊日，停诊日加号无效。\n📢 【申请加号】操作步骤如下：\n1、打开【小程序链接】，选择【预约就诊】，根据流程操作。\n2、申请加号后，您可通过订单页面查看加号结果。",
  code302:"📝 填写须知：\n1、请填写【住院申请表】，向医生申请住院。最终能否入院及具体入院时间，由院方审核后再行通知。\n2、由于医院床位紧张，请各位朋友提前做好安排，避免错过最佳治疗时机。\n🌻 友情提醒：\n1. 填写完信息后，请在群里【告知医助】，以便及时为您跟进。\n2. 床位安排确定后，住院部医生会提前电话通知，最终住院时间以医生电话通知为准。",
  code501:"-",
  code606:"🌻 吕主任的科普在以下渠道发布，欢迎大家关注\n1、抖音：消化内科吕富靖\n2、小红书：消化内科吕富靖\n3、百家号：消化内科吕富靖\n4、快手：消化内科吕富靖\n5、微信公众号：吃好喝好",
  code616:"直接弹出链接",
  code626:"直接弹出链接",
  code808:"直接弹出链接",
  code818:"🌻 感谢您转发海报，让更多患者获得主任的帮助\n👉🏻 转发方法：保存图片，转发到朋友圈、微信好友或微信群",
  code888:"-",
  code909:"感谢您的信任与认可，祝您后续诊疗一切顺利，早日痊愈。",
  code919:"分享您的就医感受，让更多人了解吕主任。",
  code979:"请点击下方【医患联络表】提交基础信息，便于医生了解您的情况。\n建议将群昵称改为「真实姓名」，方便医助识别跟进。",
  "code联络表":"请点击下方【医患联络表】提交基础信息，便于医生了解您的情况。\n建议将群昵称改为「真实姓名」，方便医助识别跟进。"
};

const STALE_SCRIPT_VALUES = {
  groupWelcome:new Set([
    "🔮 您好，欢迎加入吕富靖医生建立的【院外公益医患群】，点击【医患联络表】提交基础信息\n🌈 建议群昵称修改为：姓名+疾病。在群里输入数字 “1”，查看所有群功能"
  ]),
  code101:new Set([
    "发送 101 后，医助会发送医生春雨主页/咨询入口。请选择适合的问诊方式。",
    "我收到您的咨询需求了。发送 101 后，我会把医生春雨主页/咨询入口发给您，您可以在里面选择图文、电话、视频或预约就诊等合适方式；涉及具体病情时，也会由医助继续跟进，不会把您落下。",
    "为保护您的隐私，关于您的问题请通过下方链接 1对1 咨询医生，医生利用空闲时间回复，请耐心等待。感谢您的理解和配合[玫瑰][玫瑰]。\n🌻 紧急情况，请及时到医院就诊。"
  ]),
  code102:new Set([
    "为保护您的隐私，关于您的问题请通过下方链接 1对1 咨询医生，医生利用空闲时间回复，请耐心等待。感谢您的理解和配合[玫瑰][玫瑰]。\n🌻 紧急情况，请及时到医院就诊。"
  ]),
  code818:new Set([
    "🌻 感谢您转发海报，让更多患者获得主任的帮助\n👉🏻 转发方法：只需1步，保存图片，并转发到朋友圈"
  ]),
  code303:new Set([
    "发送 303 后，医助会回复医院挂号通道、出诊时间与就诊地点。",
    "我来帮您看挂号和出诊相关入口。发送 303 后，医助会回复医院挂号通道、出诊时间与就诊地点；如果页面信息不够明确，也可以继续在群里说明，我会转医助帮您确认。"
  ]),
  memberVisit:new Set([
    "【新患者到访 · 仅供医助关注，无需发送】{patient} 首次在群内发言，系统已发送入群欢迎。建议医助关注后续消息，必要时确认身份、备注为「姓名+疾病」，并主动引导 101 咨询/303 挂号等入口。"
  ])
};

function cleanText(v, max){
  return String(v == null ? "" : v).trim().slice(0, max || 2000);
}

function isStaleScriptValue(key, cur){
  if(STALE_SCRIPT_VALUES[key] && STALE_SCRIPT_VALUES[key].has(cur)) return true;
  if(key === "groupWelcome"){
    return /医生团队和医助共同维护|发送 101 向医生咨询|想了解挂号\/出诊时间/.test(cur);
  }
  return false;
}

function isLvFujing(doctor){
  return !!(doctor && (doctor.slug === "lvfujing" || doctor.name === "吕富靖"));
}

function withDoctorScriptDefaults(cfg, doctor){
  const out = Object.assign({}, cfg || {});
  if(!isLvFujing(doctor)) return out;
  Object.keys(LV_DOCX_SCRIPTS).forEach(k=>{
    const cur = cleanText(out[k], 2400);
    if(!cur || cur === "-" || isStaleScriptValue(k, cur)){
      out[k] = LV_DOCX_SCRIPTS[k];
    }
  });
  return out;
}

function listValues(v, maxItems, maxText){
  if(!Array.isArray(v)) return [];
  const seen = new Set();
  const out = [];
  v.forEach(x=>{
    const t = cleanText(x, maxText || 80);
    if(!t || seen.has(t)) return;
    seen.add(t);
    out.push(t);
  });
  return out.slice(0, maxItems || 80);
}

function textHasTerm(text, term){
  const t = String(text == null ? "" : text);
  const q = String(term == null ? "" : term).trim();
  if(!t || !q) return false;
  return t.toLowerCase().includes(q.toLowerCase());
}

function scriptValue(cfg, codeOrKey){
  if(!cfg || typeof cfg !== "object") return "";
  const key = cleanText(codeOrKey, 40);
  if(!key) return "";
  const direct = cleanText(cfg[key], 2400);
  if(direct && direct !== "-") return direct;
  const code = key.replace(/^code/i, "");
  const codeKey = "code" + code;
  const byCode = cleanText(cfg[codeKey], 2400);
  if(byCode && byCode !== "-") return byCode;
  if(cfg.codes && typeof cfg.codes === "object"){
    const v = cfg.codes[code] || cfg.codes[codeKey] || cfg.codes[key];
    if(typeof v === "string"){
      const t = cleanText(v, 2400);
      return t === "-" ? "" : t;
    }
    if(v && typeof v === "object"){
      const t = cleanText(v.text || v.reply || v.script, 2400);
      return t === "-" ? "" : t;
    }
  }
  if(cfg.codeReplies && typeof cfg.codeReplies === "object"){
    const v = cfg.codeReplies[code] || cfg.codeReplies[codeKey] || cfg.codeReplies[key];
    if(typeof v === "string"){
      const t = cleanText(v, 2400);
      return t === "-" ? "" : t;
    }
    if(v && typeof v === "object"){
      const t = cleanText(v.text || v.reply || v.script, 2400);
      return t === "-" ? "" : t;
    }
  }
  return "";
}

function render(template, vars){
  let out = cleanText(template, 2400);
  out = out
    .replace(/[（(]\s*\{senderId\}\s*[）)]/g, "")
    .replace(/\{senderId\}/g, "");
  const map = vars || {};
  const friendlyKeys = {
    patient:"患者称呼",
    group:"患者群名称",
    doctor:"负责医生",
    dept:"科室",
    hospital:"医院"
  };
  Object.keys(map).forEach(k=>{
    const value = cleanText(map[k], 200);
    out = out.replace(new RegExp("\\{" + k + "\\}", "g"), value);
    if(friendlyKeys[k]) out = out.split("【" + friendlyKeys[k] + "】").join(value);
  });
  return out;
}

const CONFIG_DOMAINS = {
  prompts:{ title:"AI 判断规则", scope:"global", superOnly:true, desc:"约束系统怎样判断风险、整理资料、生成草稿。" },
  scripts:{ title:"患者/医助话术", scope:"doctor", superOnly:false, desc:"欢迎语、编号引导、转人工、急症提醒、图片语音兜底。" },
  safety:{ title:"安全红线", scope:"global", superOnly:true, desc:"红旗词/转人工词 + 风险两轴说明（ClinicalRisk × SendPolicy）。出站以 Dialogue Agent 为准：medium 仅发卡可自动，医疗建议待审。" },
  doctor_group:{ title:"医生与社群", scope:"doctor", superOnly:false, desc:"医生资料、负责社群、新群默认处理方式。" },
  codes_cards:{ title:"编号入口", scope:"doctor", superOnly:false, desc:"患者发哪个编号，对应文字、卡片、链接或问卷入口。" },
  contact_form:{ title:"建档表单", scope:"doctor", superOnly:false, desc:"患者 H5/邀请建档页的疾病选项与成功文案。" }
};
const CONFIG_DOMAIN_ORDER = ["prompts","scripts","safety","doctor_group","contact_form","codes_cards"];
const SECRET_KEY_RE = /(secret|token|password|passwd|authorization|bearer|api[_-]?key|callbackSecret|encodingAESKey|aesKey)/i;

function ownerIdForDomain(domain, doctorId){
  const d = cleanText(domain, 60);
  if(!d) return null;
  const meta = CONFIG_DOMAINS[d];
  if(meta && meta.scope === "global") return 0;
  if(GLOBAL_DOMAINS.has(d)) return 0;
  const ownerId = Number(doctorId);
  if(!Number.isInteger(ownerId) || ownerId < 0) return null;
  return ownerId;
}

function configMeta(domain){
  return CONFIG_DOMAINS[String(domain || "")] || null;
}

function walkConfig(v, fn, path){
  path = path || [];
  if(Array.isArray(v)) return v.forEach((x,i)=>walkConfig(x, fn, path.concat(i)));
  if(v && typeof v === "object") Object.keys(v).forEach(k=>{
    fn(k, v[k], path.concat(k));
    walkConfig(v[k], fn, path.concat(k));
  });
}

function validateOpsConfig(domain, cfg){
  const errors = [], warnings = [];
  if(!cfg || typeof cfg !== "object" || Array.isArray(cfg)) errors.push("配置内容格式不正确");
  walkConfig(cfg, (k,v,p)=>{
    if(SECRET_KEY_RE.test(k)) errors.push("禁止在运营配置中保存密钥字段："+p.join("."));
    if(typeof v === "string" && /Bearer\s+[A-Za-z0-9._-]{12,}/i.test(v)) errors.push("禁止在运营配置中保存 Authorization/Bearer 密钥："+p.join("."));
    const lk = String(k).toLowerCase();
    if(typeof v === "string" && (lk === "regex" || lk.endsWith("regex") || lk === "pattern")){
      try{ new RegExp(v); }catch(e){ errors.push("规则格式不正确："+p.join(".")+"（"+e.message+"）"); }
    }
  });
  if(domain === "safety"){
    if(!Array.isArray(cfg.redFlags) || cfg.redFlags.length === 0) errors.push("安全红线必须填写至少一个高风险词");
    if(!Array.isArray(cfg.humanTriggers) || cfg.humanTriggers.length === 0) errors.push("安全红线必须填写至少一个转人工词");
    ["high","medium","low"].forEach(k=>{ if(!cfg.levels || !cfg.levels[k]) errors.push("安全红线必须保留高/中/低风险处理动作"); });
    if(cfg.levels && cfg.levels.high && cfg.levels.high.modelAllowed !== false) errors.push("高风险必须保持：不交给 AI 自行判断");
    if(cfg.levels && cfg.levels.high){
      const highSp = String(cfg.levels.high.sendPolicy || "");
      if(highSp && !/block|safe_template|safe|human|人工/.test(highSp)){
        warnings.push("高风险 SendPolicy 建议为 block（仅允许固定安全话术）");
      }
    }
    if(cfg.levels && cfg.levels.medium){
      const mediumText = String(cfg.levels.medium.sendPolicy || "") + " " + String(cfg.levels.medium.action || "");
      if(!/card_only|review|发卡|人工|confirm|human/.test(mediumText)){
        warnings.push("中风险应写明：仅发卡可自动（card_only），医疗建议须人工确认（review）");
      }
      if(/生成草稿.*必须人工确认/.test(String(cfg.levels.medium.action || "")) && !/发卡|card_only/.test(mediumText)){
        warnings.push("中风险旧口径已废弃：请改为「仅发卡可自动 / 医疗建议待审」");
      }
    }
    if(cfg.levels && cfg.levels.low){
      const lowText = String(cfg.levels.low.sendPolicy || "") + " " + String(cfg.levels.low.action || "");
      if(lowText && !/auto|服务|发卡|扫描|guarded/.test(lowText)){
        warnings.push("低风险建议对齐 auto：服务引导/发卡可自动，仍过安全扫描");
      }
    }
  }
  if(domain === "contact_form"){
    if(!Array.isArray(cfg.diseaseOptions) || cfg.diseaseOptions.length === 0){
      errors.push("疾病选项至少填写一项");
    }
    if(!String(cfg.title || "").trim()) errors.push("建档页标题不能为空");
  }
  return { ok:errors.length===0, errors, warnings };
}

function parseConfigJson(text, fallback){
  try{
    const v = JSON.parse(text || "null");
    return v && typeof v === "object" && !Array.isArray(v) ? v : (fallback || {});
  }catch(e){
    return fallback || {};
  }
}

function stableJson(v){
  return JSON.stringify(v || {}, null, 2);
}

module.exports = {
  GLOBAL_DOMAINS,
  CONFIG_DOMAINS,
  CONFIG_DOMAIN_ORDER,
  SECRET_KEY_RE,
  LV_DOCX_SCRIPTS,
  cleanText,
  isStaleScriptValue,
  isLvFujing,
  withDoctorScriptDefaults,
  listValues,
  textHasTerm,
  scriptValue,
  render,
  ownerIdForDomain,
  configMeta,
  validateOpsConfig,
  parseConfigJson,
  stableJson
};
