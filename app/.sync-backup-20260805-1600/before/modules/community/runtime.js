"use strict";

/**
 * 入站/运营共用运行时（话术变量、@名、自动发闸等）。
 * 不依赖 community.js。
 */
const { db } = require("../../db.js");
const opsConfig = require("../../ops_config.js");
const rules = require("./rules.js");
const repo = require("./repo.js");

const cleanText = (v, max) => rules.cleanText(v, max);

function j(v, fallback){
  try{ return JSON.parse(v || ""); }catch(e){ return fallback; }
}

function doctorContent(doctorId){
  const row = db.prepare("SELECT content,name,dept,specialty FROM doctors WHERE id=?").get(+doctorId);
  if(!row) return { content:{}, doctor:null };
  return { content:j(row.content, {}), doctor:row };
}

function resolveDoctorId(input){
  input = input || {};
  if(input.doctorId && db.prepare("SELECT 1 FROM doctors WHERE id=?").get(+input.doctorId)) return +input.doctorId;
  if(input.doctorSlug){
    const d = db.prepare("SELECT id FROM doctors WHERE slug=?").get(cleanText(input.doctorSlug, 80));
    if(d) return d.id;
  }
  return null;
}

function scriptVars(doctorId, group, member){
  const dc = doctorContent(doctorId);
  return {
    patient: member && member.display_name || "",
    group: group && group.name || "",
    doctor: dc.doctor && dc.doctor.name || "",
    dept: dc.doctor && (dc.doctor.dept || dc.doctor.specialty) || "",
    hospital: dc.doctor && dc.doctor.hospital || ""
  };
}

function runtimeScripts(doctorId){
  return opsConfig.scripts(doctorId);
}

function configuredScript(doctorId, key, vars){
  return opsConfig.render(opsConfig.scriptValue(runtimeScripts(doctorId), key), vars);
}

function configuredCodeScript(doctorId, code, vars){
  return opsConfig.render(opsConfig.scriptValue(runtimeScripts(doctorId), "code" + cleanText(code, 40)), vars);
}

function mergeConfiguredReply(configured, fallback){
  const a = cleanText(configured, 2400);
  const b = cleanText(fallback, 2400);
  if(!a) return b;
  if(!b) return a;
  if(b.indexOf(a) >= 0) return b;
  if(a.indexOf(b) >= 0) return a; // 固定话术已覆盖规则文本时不叠发
  return [a, b].join("\n\n");
}

function responseToText(responses, patientName){
  if(!Array.isArray(responses)) return "";
  const patient = cleanText(patientName, 20);
  return responses.map(r=>{
    if(!r) return "";
    if(r.type === "text") return cleanText(r.text, 1200);
    if(r.type === "link") return `请打开：${r.title || "相关链接"}${r.source ? "（"+r.source+"）" : ""}`;
    if(r.type === "mp") return `请打开小程序卡：${r.title || "春雨医生服务"}`;
    if(r.type === "qr") return `请扫码联系：${r.name || "医生团队"}${r.caption ? " - "+r.caption : ""}`;
    if(r.type === "popup") return `请查看群内弹窗/卡片：${r.modal || "详情"}`;
    if(r.type === "image") return `请查看图片/海报：${r.title || "医生资料"}`;
    return cleanText(r.text || r.title || JSON.stringify(r), 600);
  }).filter(Boolean).join("\n\n").replace(/@?\{patient\}\s?/g, patient ? (patient + " ") : "");
}

function triageEntryCardLines(tri){
  const list = Array.isArray(tri && tri.extraResponses) ? tri.extraResponses : [];
  return list.map(r=>{
    if(!r) return "";
    const ext = r.external || {};
    const link = ext.shortLink || ext.urlLink || ext.urlScheme || ext.url || r.url || "";
    const title = cleanText(r.title || "1对1 问诊入口", 80);
    return link ? `【${title}】${link}` : `请打开小程序卡：${title}`;
  }).filter(Boolean).join("\n");
}

function atName(name, text){
  const n = cleanText(name, 40);
  const body = String(text || "").trim();
  if(!n || !body || body.startsWith("@")) return body;
  if(body.startsWith(n)){
    const rest = body.slice(n.length).replace(/^[，,、：:\s]*/, "");
    return rest ? `@${n} ${rest}` : `@${n}`;
  }
  return `@${n} ${body}`;
}

function joinFaqText(doctorId, patientName){
  const { content } = doctorContent(doctorId);
  const faq = content.communityFaq || {};
  const title = cleanText(faq.title, 80) || "群友常见问题";
  const items = Array.isArray(faq.sections) ? faq.sections.slice(0, 6) : [];
  const names = items.map(x=>cleanText(x && x.title, 24)).filter(Boolean);
  const prefix = patientName ? `${patientName}，` : "";
  const parts = [
    `${prefix}${title}已整理好，入群后建议先看这页。`,
    names.length ? `已覆盖：${names.join(" / ")}。` : "已覆盖挂号、加号、住院、手术、病案复印、康复随访等常见问题。",
    cleanText(faq.safeNote, 240) || "涉及诊断、手术决策、用药调整、报告解读或急症风险时，群内不会直接判断，请转医生/医助或线下就医。",
    "发送 626 可再次打开；发送 101 可进入 1对1 咨询入口。"
  ];
  return parts.filter(Boolean).join("\n");
}

function communityGroupAllowsAuto(group){
  if(!group) return false;
  if(group.status === "paused" || group.review_mode === "paused") return false;
  if(group.auto_reply_enabled === false || group.auto_reply_enabled === 0) return false;
  return true;
}

function communityFallbackCanAuto(group, triageLike){
  if(!communityGroupAllowsAuto(group)) return false;
  if(!triageLike) return true;
  if(triageLike.canAutoSend !== true) return false;
  if(triageLike.sendPolicy === "review") return false;
  return true;
}

const SELF_SENDER_ROLES = new Set(["self", "assistant", "system", "app", "operator", "医助", "运营"]);
function isLoopbackInbound(input){
  if(!input) return false;
  if(input.fromSelf === true || input.isEcho === true) return true;
  const role = String(input.senderRole == null ? "" : input.senderRole).trim().toLowerCase();
  return SELF_SENDER_ROLES.has(role) || SELF_SENDER_ROLES.has(String(input.senderRole || "").trim());
}

function inboundLogBase(did, group, member, patientId, text){
  return {
    doctorId: did,
    patientId,
    patientName: member.display_name,
    senderId: member.external_user_id || String(member.id),
    channel: group.channel_type || "wechat",
    groupId: group.external_group_id || String(group.id),
    text
  };
}

function enqueue(args){
  return require("../outbox").enqueue(args);
}

function outboxOut(o){
  const outbox = require("../outbox");
  if(o && o.doctor_id != null) return outbox.outboxOut(o);
  return o;
}

async function setOutboxStatus(id, status, username, options){
  return require("../outbox").setOutboxStatus(id, status, username, options);
}

module.exports = {
  j,
  doctorContent,
  resolveDoctorId,
  scriptVars,
  runtimeScripts,
  configuredScript,
  configuredCodeScript,
  mergeConfiguredReply,
  responseToText,
  triageEntryCardLines,
  atName,
  joinFaqText,
  communityGroupAllowsAuto,
  communityFallbackCanAuto,
  isLoopbackInbound,
  inboundLogBase,
  enqueue,
  outboxOut,
  setOutboxStatus,
  cleanText,
  repo,
  rules
};
