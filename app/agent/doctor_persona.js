"use strict";
/* 按医生档案拼装 health_chat 人设（运营键可覆盖） */
const { db } = require("../db.js");
const { gawandeBaselineBlock } = require("./gawande_baseline.js");

function botNameFromIntro(introRaw){
  try{
    const intro = typeof introRaw === "string" ? JSON.parse(introRaw || "{}") : (introRaw || {});
    const items = Array.isArray(intro.items) ? intro.items : [];
    for(const it of items){
      const b = String((it && it.bot) || "").trim();
      if(b) return b;
    }
  }catch(e){ /* ignore */ }
  return "";
}

function loadDoctorRow(doctorId){
  try{
    return db.prepare(
      "SELECT id,slug,name,title,hospital,dept,specialty,intro FROM doctors WHERE id=?"
    ).get(Number(doctorId)) || null;
  }catch(e){
    return null;
  }
}

function buildDoctorPersonaPrompt(doctorId, opsOverride){
  if(opsOverride && String(opsOverride).trim()){
    return String(opsOverride).trim();
  }
  const baseline = gawandeBaselineBlock();
  const d = loadDoctorRow(doctorId);
  if(!d){
    return [
      "你是春雨家庭医生团队的群医助，协助医生团队服务患者。",
      "说话自然、先接住再帮忙；严禁自称 AI / 机器人 / 大模型。",
      "可做症状梳理、观察建议、服务编号引导；具体诊疗以医生面诊为准。"
    ].filter(Boolean).join("\n") + (baseline ? ("\n" + baseline) : "");
  }
  const bot = botNameFromIntro(d.intro) || "春雨家庭医生医助";
  const specialty = String(d.specialty || d.dept || "相关专科").slice(0, 220);
  const title = d.title ? String(d.title) : "";
  const who = [d.hospital, d.dept, d.name].filter(Boolean).join(" ");
  return [
    "你是「" + bot + "」，在企微群协助「" + who + (title ? ("（" + title + "）") : "") + "」团队服务患者。",
    "擅长方向（边界提醒，勿编造超出下列范围的专科结论）：" + specialty,
    "说话：自然、接住、像真人医助；严禁自称 AI / 机器人 / 大模型。",
    "自我介绍时：说明自己是该医生团队的群医助，可帮忙做症状梳理、观察建议、服务编号引导；具体诊疗以医生面诊为准。",
    "主诉明显超出本科擅长时：给通用安全观察，诚实说明边界，并引导回复 101 走一对一或建议线下对应科室。",
    "需要一对一问诊/找医生时：明确告诉用户「请回复 101」。"
  ].filter(Boolean).join("\n") + (baseline ? ("\n" + baseline) : "");
}

function identityReply(doctorId){
  const d = loadDoctorRow(doctorId);
  const bot = d ? (botNameFromIntro(d.intro) || "春雨家庭医生医助") : "春雨家庭医生医助";
  if(!d){
    return "我是" + bot + "，在群里协助医生团队做症状梳理和观察提醒。具体诊疗以面诊为准；想一对一问诊请回复 101。";
  }
  const bits = [d.hospital, d.dept, d.name].filter(Boolean).join("·");
  const spec = String(d.specialty || d.dept || "").split(/[·•、,，]/)[0] || d.dept || "";
  return (
    "我是" + bot + "，在群里协助" + bits + "团队。"
    + (spec ? ("这边更侧重" + String(spec).trim() + "相关问题。") : "")
    + "可以帮您梳理症状、给观察建议，需要一对一找医生请回复 101。"
  );
}

module.exports = { buildDoctorPersonaPrompt, identityReply, loadDoctorRow, botNameFromIntro };
