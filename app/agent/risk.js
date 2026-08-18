/* 两轴风险：ClinicalRisk × SendPolicy；多信号 + 动作门控 */
const RANK = { low:1, medium:2, high:3 };

function maxRisk(a, b){
  return (RANK[a] || 0) >= (RANK[b] || 0) ? a : b;
}

function clinicalFromSignals(understood, session){
  const floor = (understood && understood.floor) || {};
  let clinical = floor.riskLevel || "low";
  if(floor.emergency) clinical = "high";
  if(floor.sentinel) clinical = maxRisk(clinical, "medium");
  if(understood && understood.medicalIntent) clinical = maxRisk(clinical, clinical === "low" ? "medium" : clinical);
  const slots = Object.assign({}, (session && session.slots) || {}, (understood && understood.slots) || {});
  if(slots.asksMedication) clinical = maxRisk(clinical, "medium");
  if(slots.worsening && slots.hasMedicalCue) clinical = maxRisk(clinical, "medium");
  if(slots.hasReportImage || slots.hasMedImage) clinical = maxRisk(clinical, "medium");
  if((understood.attachmentHints || []).length) clinical = maxRisk(clinical, "medium");

  // 明确服务意图 + 当句无症状/用药线索 → 覆盖「加号」等过宽词表误抬的 medium 地板
  const serviceOnly = !!(understood && understood.service && !understood.medicalIntent
    && !slots.hasMedicalCue && !slots.asksMedication && !(slots.symptoms && slots.symptoms.length)
    && !floor.emergency && !floor.sentinel && floor.riskLevel !== "high");
  if(serviceOnly && clinical === "medium" && floor.riskLevel === "medium"){
    clinical = "low";
  }
  return {
    clinicalRisk: clinical,
    emergency: !!floor.emergency,
    floorTriggers: floor.triggers || [],
    sentinel: !!floor.sentinel
  };
}

/**
 * @param {object} opts
 * @param {string} opts.clinicalRisk
 * @param {boolean} opts.emergency
 * @param {string} opts.intendedAction  reply_service|open_chunyu_card|open_menu|reply_medical_advice|handoff|ask_clarify|emergency_safe
 * @param {boolean} opts.hasMedicalAdviceText
 */
function sendPolicyFor(opts){
  opts = opts || {};
  const clinical = opts.clinicalRisk || "low";
  const action = opts.intendedAction || "reply_service";
  const medText = !!opts.hasMedicalAdviceText;

  if(opts.emergency || clinical === "high"){
    return { sendPolicy:"block", canAutoSend:true, needsHuman:true, reason:"clinical_high" };
    // canAutoSend true = 允许自动发【安全模板】，不是自由医疗建议
  }
  if(action === "reply_medical_advice" || medText){
    // 主人需求：除闲聊外尽量自动发正文；此处仍保留 needsHuman（人工仍会跟进/兜底）
    return { sendPolicy:"auto", canAutoSend:true, needsHuman:true, reason:"medical_advice_auto" };
  }
  // L3/L4 建议话术（无贴片）：可自动发安全建议，仍需人工跟进；不是自由诊疗建议
  if(action === "reply_advice" && !medText){
    return { sendPolicy:"auto", canAutoSend:true, needsHuman:true, reason:"advice_auto" };
  }
  if(action === "health_chat"){
    return { sendPolicy:"auto", canAutoSend:true, needsHuman:true, reason:"health_chat_auto" };
  }
  if(action === "handoff"){
    // 主人需求：打开 medium/handoff 的自动发闸门，避免“生成了但不发”（pending 静默）
    return { sendPolicy:"auto", canAutoSend:true, needsHuman:true, reason:"handoff_auto" };
  }
  if(clinical === "medium"){
    if(action === "open_chunyu_card" && !medText){
      return { sendPolicy:"card_only", canAutoSend:true, needsHuman:true, reason:"medium_card_only" };
    }
    return { sendPolicy:"auto", canAutoSend:true, needsHuman:true, reason:"medium_auto_send" };
  }
  // low
  if(action === "open_chunyu_card" || action === "open_menu" || action === "reply_service" || action === "ask_clarify" || action === "reply_advice"){
    return { sendPolicy:"auto", canAutoSend:true, needsHuman: action === "reply_advice", reason: action === "reply_advice" ? "advice_auto" : "low_service" };
  }
  return { sendPolicy:"review", canAutoSend:false, needsHuman:true, reason:"default_review" };
}

function evaluateRisk(understood, session, planHint){
  const clinical = clinicalFromSignals(understood, session);
  const action = (planHint && planHint.intendedAction) || "reply_service";
  const policy = sendPolicyFor({
    clinicalRisk: clinical.clinicalRisk,
    emergency: clinical.emergency,
    intendedAction: action,
    hasMedicalAdviceText: !!(planHint && planHint.hasMedicalAdviceText)
  });
  return {
    clinicalRisk: clinical.clinicalRisk,
    emergency: clinical.emergency,
    sendPolicy: policy.sendPolicy,
    canAutoSend: policy.canAutoSend,
    needsHuman: policy.needsHuman,
    policyReason: policy.reason,
    floorTriggers: clinical.floorTriggers,
    sentinel: clinical.sentinel,
    // 兼容旧 triage 字段名
    riskLevel: clinical.clinicalRisk,
    suggestedAction: policy.reason
  };
}

module.exports = { evaluateRisk, clinicalFromSignals, sendPolicyFor, maxRisk };
