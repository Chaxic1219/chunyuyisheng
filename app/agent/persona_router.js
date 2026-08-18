/* 医疗健康子人设路由：健康报告 / 病例整理 / 护理方案（语义迁移自 CocoLoop 能力，本地重写） */
const triage = require("../triage.js");

const PERSONA_REGISTRY = {
  health_report: {
    key: "health_report",
    goal: "health_report",
    tone: "health_report",
    promptKey: "personaHealthReport",
    label: "健康报告",
    priority: 30
  },
  case_analysis: {
    key: "case_analysis",
    goal: "case_analysis",
    tone: "case_analysis",
    promptKey: "personaCaseAnalysis",
    label: "病例分析",
    priority: 20
  },
  care_plan: {
    key: "care_plan",
    goal: "care_plan",
    tone: "care_plan",
    promptKey: "personaCarePlan",
    label: "护理方案",
    priority: 10
  }
};

const PERSONA_PATTERNS = [
  {
    key: "health_report",
    patterns: [
      /体检报告|化验单|检查报告|检验报告|体检结果|报告单|指标单/i,
      /指标.{0,8}(高|低|升|降|箭头|异常)|偏高|偏低|超标|未达标/i,
      /转氨酶|血红蛋白|白细胞|血小板|血糖|胆固醇|甘油三酯|尿酸|肿瘤标志物|甲功|TSH|肌酐/i,
      /报告.{0,6}(怎么看|什么意思|严不严重|要不要紧|解读|正常吗)/i,
      /箭头.{0,4}(向上|向下|↑|↓)/i
    ]
  },
  {
    key: "case_analysis",
    patterns: [
      /病历|病程|主诉|病史|就诊记录|什么情况|帮我整理|归纳|梳理/i,
      /什么时候.{0,8}(开始|起|疼|不舒服|出现)/i,
      /从开始到现在|一直以来|这些年来/i,
      /(帮我|麻烦).{0,4}(看|理|整理).{0,6}(情况|病史|病历)/i
    ]
  },
  {
    key: "care_plan",
    patterns: [
      /术后|出院后|手术后|护理|照护|照顾|休养/i,
      /饮食.{0,6}(注意|禁忌|怎么吃|能吃)|怎么吃|忌口/i,
      /复查|复诊|随访|日常.{0,4}(注意|保养)|生活方式|康复训练/i
    ]
  }
];

// 排除词：命中则相应 persona 直接否决（0 分），消除「挂号/加号/问诊」等纯服务诉求被误判为医疗子人设的误判。
const PERSONA_EXCLUDE = {
  health_report: [
    /(挂号|挂什么科|出诊|门诊时间|能挂|怎么挂)/i,
    /(加号|住院|转诊|预约|排队)/i,
    /(问诊|咨询|找.{0,6}(医生|主任|大夫))/
  ],
  case_analysis: [
    /(挂号|挂什么科|出诊|门诊时间|能挂|怎么挂)/i,
    /(加号|住院|转诊|预约)/i
  ],
  care_plan: [
    /(挂号|挂什么科|出诊|门诊时间|能挂|怎么挂)/i,
    /(加号|住院|转诊|预约)/i,
    /(问诊|咨询|找.{0,6}(医生|主任|大夫))/
  ]
};

function excludedBy(key, text){
  const list = PERSONA_EXCLUDE[key] || [];
  return list.some(re => re.test(text));
}

function scorePatterns(text, patterns){
  let score = 0;
  for(const re of patterns){
    if(re.test(text)) score++;
  }
  return score;
}

function matchHealthcarePersona(text, slots){
  slots = slots || {};
  const t = String(text || "").trim();
  if(!t && !slots.hasReportImage) return null;

  let best = null;
  let bestWeight = 0;
  for(const row of PERSONA_PATTERNS){
    const def = PERSONA_REGISTRY[row.key];
    if(!def) continue;
    // 排除词硬否决：纯服务诉求（挂号/加号/问诊/住院）不判为医疗子人设
    if(excludedBy(row.key, t)) continue;
    let score = scorePatterns(t, row.patterns);
    if(row.key === "health_report" && slots.hasReportImage) score += 2;
    if(row.key === "case_analysis" && slots.duration) score += 1;
    if(score <= 0) continue;
    const weight = score * 10 + def.priority;
    if(weight > bestWeight){
      bestWeight = weight;
      best = def;
    }
  }
  return best;
}

function personaPromptBlock(doctorId, persona){
  if(!persona || !persona.promptKey) return "";
  return triage.configuredPrompt(doctorId, persona.promptKey);
}

function isHealthcarePersonaGoal(goal){
  return goal === "health_report" || goal === "case_analysis" || goal === "care_plan";
}

module.exports = {
  PERSONA_REGISTRY,
  PERSONA_PATTERNS,
  PERSONA_EXCLUDE,
  excludedBy,
  matchHealthcarePersona,
  personaPromptBlock,
  isHealthcarePersonaGoal
};
