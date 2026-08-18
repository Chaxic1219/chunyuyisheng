"use strict";

/**
 * 出站模块规则：行整形、闸控常量（不碰投递 IO）。
 */
const SEND_MAX_ATTEMPTS = 5;
const ALLOWED_STATUS = new Set(["sent", "cancelled", "pending", "ignored"]);

function parsePayload(text){
  try{
    const v = JSON.parse(text || "{}");
    return v && typeof v === "object" ? v : {};
  }catch(e){
    return {};
  }
}

function toPublic(o){
  if(!o) return null;
  return {
    id: o.id,
    doctorId: o.doctor_id,
    groupId: o.group_id,
    messageId: o.message_id || null,
    targetType: o.target_type || "group",
    targetName: o.target_name || "",
    channelType: o.channel_type || "wechat",
    text: o.text || "",
    payload: parsePayload(o.payload),
    status: o.status || "pending",
    source: o.source || "",
    priority: o.priority || "normal",
    assignee: o.assignee || null,
    createdAt: o.created_at,
    sentAt: o.sent_at,
    sentBy: o.sent_by || "",
    updatedBy: o.updated_by || "",
    updatedAt: o.updated_at || "",
    dataSource: o.data_source || "manual",
    sentMode: o.sent_mode || null,
    externalMsgId: o.external_msg_id || null
  };
}

function communityDataSource(group){
  return group && group.data_source === "qiwe" && group.is_business ? "qiwe" : "manual";
}

function canRealSendWecom(cfg){
  return !!(cfg && cfg.corpId && cfg.secret && cfg.agentId);
}

function realSendUnavailable(row){
  const ch = row && row.channel_type || "";
  if(ch === "qiwe") return "缺少 QiWe token/guid 或 toId，未执行真实发送";
  if(ch === "wecom") return "缺少企微应用凭证或 touser，未执行真实发送";
  return "该出站渠道没有真实发送实现，未执行真实发送";
}

function cleanText(v, max){
  return String(v == null ? "" : v).trim().slice(0, max || 2000);
}

function normalizeStatus(status){
  return ALLOWED_STATUS.has(status) ? status : "sent";
}

module.exports = {
  SEND_MAX_ATTEMPTS,
  ALLOWED_STATUS,
  toPublic,
  parsePayload,
  communityDataSource,
  canRealSendWecom,
  realSendUnavailable,
  cleanText,
  normalizeStatus
};
