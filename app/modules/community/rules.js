"use strict";

/**
 * 社群群/成员规则：公开整形、枚举、命名模板、占位 ID。
 */

const REVIEW_MODES = new Set(["human_review", "auto_keywords", "paused"]);
const CHANNEL_TYPES = new Set(["wechat", "wecom", "qiwe", "web", "sms"]);
const GROUP_STATUS = new Set(["pilot", "active", "paused", "archived"]);
const DEFAULT_GROUP_NAME_PATTERN = "{医生}医生健康群{序号}";

function cleanText(v, max){
  return String(v == null ? "" : v).trim().slice(0, max || 2000);
}

function cleanInt(v){
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

function isPlaceholderGroupId(ext){
  const s = cleanText(ext, 120);
  if(!s) return true;
  return /^(local-|test-|ft-|admin-sim)/i.test(s);
}

function groupOut(g){
  if(!g) return null;
  return {
    id:g.id, doctorId:g.doctor_id, channelType:g.channel_type, externalGroupId:g.external_group_id || "",
    name:g.name || "", owner:g.owner || "", memberCount:g.member_count || 0, status:g.status || "pilot",
    welcomeEnabled:!!g.welcome_enabled, welcomeText:g.welcome_text || "",
    autoReplyEnabled:!!g.auto_reply_enabled, reviewMode:g.review_mode || "human_review",
    qrcodeUrl:g.qrcode_url || "", notes:g.notes || "", updatedAt:g.updated_at,
    dataSource:g.data_source || "manual", isBusiness:!!g.is_business, lastSyncedAt:g.last_synced_at || null,
    shareVisibleToCollab: g.share_visible_to_collab == null ? true : !!g.share_visible_to_collab
  };
}

function buildGroupName(doctor, content, seq){
  const pattern = cleanText(content && content.groupNaming && content.groupNaming.pattern, 120) || DEFAULT_GROUP_NAME_PATTERN;
  const dname = String((doctor && doctor.name) || "").trim();
  const dept = String((doctor && doctor.dept) || "").trim();
  const n = Number(seq);
  const seqStr = (seq === "" || seq == null) ? "" : (Number.isFinite(n) && n > 0 ? String(n) : "");
  return cleanText(pattern
    .replace(/\{医生\}/g, dname)
    .replace(/\{科室\}/g, dept)
    .replace(/\{序号\}/g, seqStr), 120);
}

function parseDoctorContent(row){
  try{
    const v = JSON.parse((row && row.content) || "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  }catch(e){
    return {};
  }
}

function messageOut(m){
  if(!m) return null;
  return {
    id:m.id, doctorId:m.doctor_id, groupId:m.group_id, memberId:m.member_id,
    senderName:m.sender_name || "", senderRole:m.sender_role || "patient", msgType:m.msg_type || "text",
    text:m.text || "", riskLevel:m.risk_level || "", processStatus:m.process_status || "received",
    matchedSource:m.matched_source || "", triageSessionId:m.triage_session_id || null, decisionId:m.decision_id || null,
    moderationFlag:m.moderation_flag || null, moderationKeys:m.moderation_keys || "",
    moderationLevel:m.moderation_level || null,
    moderationAiRole:m.moderation_ai_role || null, moderationAiReason:m.moderation_ai_reason || null,
    moderationStatus:m.moderation_status || (m.moderation_flag ? "open" : null),
    moderationAction:m.moderation_action || "",
    moderationResolvedAt:m.moderation_resolved_at || null,
    moderationResolvedBy:m.moderation_resolved_by || "",
    createdAt:m.created_at, dataSource:m.data_source || "manual"
  };
}

module.exports = {
  REVIEW_MODES,
  CHANNEL_TYPES,
  GROUP_STATUS,
  DEFAULT_GROUP_NAME_PATTERN,
  cleanText,
  cleanInt,
  isPlaceholderGroupId,
  groupOut,
  messageOut,
  buildGroupName,
  parseDoctorContent
};
