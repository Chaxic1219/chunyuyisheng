"use strict";

/**
 * outbound_queue 唯一 SQL 读写（本表归属 outbox 模块）。
 */
const { db } = require("../../db.js");

function nowIso(){
  return new Date().toISOString();
}

function insert(row){
  const r = row || {};
  const createdAt = r.createdAt || nowIso();
  let status = r.status || "pending";
  // 防回归：欢迎语禁止直写 sent（须走 setOutboxStatus）；强制改 pending，不丢行、不改表结构
  if(status === "sent" && String(r.source || "") === "welcome"){
    console.warn("[outbox.repo] welcome insert coerced to pending; use setOutboxStatus for real send");
    status = "pending";
    r.sentAt = null;
    r.sentBy = null;
    r.sentMode = null;
  }
  const payload = r.payload == null
    ? "{}"
    : (typeof r.payload === "string" ? r.payload : JSON.stringify(r.payload));
  const text = r.text == null ? "" : String(r.text).slice(0, 2400);
  const result = db.prepare(`INSERT INTO outbound_queue(
    doctor_id,group_id,message_id,target_type,target_name,channel_type,text,payload,
    status,source,priority,created_at,sent_at,sent_by,sent_mode,external_msg_id,data_source
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    r.doctorId,
    r.groupId != null ? r.groupId : null,
    r.messageId != null ? r.messageId : null,
    r.targetType || "group",
    r.targetName != null ? String(r.targetName) : "",
    r.channelType || "wechat",
    text,
    payload,
    status,
    r.source || "manual",
    r.priority || "normal",
    createdAt,
    r.sentAt != null ? r.sentAt : (status === "sent" ? createdAt : null),
    r.sentBy != null ? r.sentBy : (status === "sent" ? "system" : null),
    r.sentMode != null ? r.sentMode : null,
    r.externalMsgId != null ? r.externalMsgId : null,
    r.dataSource != null ? r.dataSource : "manual"
  );
  return Number(result.lastInsertRowid);
}

function getById(id){
  return db.prepare("SELECT * FROM outbound_queue WHERE id=?").get(+id) || null;
}

function updateNonSent(id, status, username){
  db.prepare("UPDATE outbound_queue SET status=?,sent_at=?,sent_by=?,updated_by=?,updated_at=? WHERE id=?")
    .run(status, null, null, username || "admin", nowIso(), +id);
}

function preemptSending(id, username){
  const r = db.prepare("UPDATE outbound_queue SET status='sending',updated_by=?,updated_at=? WHERE id=? AND status='pending'")
    .run(username || "admin", nowIso(), +id);
  return r.changes === 1;
}

function markSentReal(id, username, externalMsgId){
  db.prepare("UPDATE outbound_queue SET status='sent',sent_mode='real',sent_at=?,sent_by=?,external_msg_id=?,send_error=NULL,updated_by=?,updated_at=? WHERE id=?")
    .run(nowIso(), username || "admin", externalMsgId != null ? String(externalMsgId) : null, username || "admin", nowIso(), +id);
}

function markSentManual(id, username){
  db.prepare("UPDATE outbound_queue SET status='sent',sent_mode='manual',sent_at=?,sent_by=?,updated_by=?,updated_at=? WHERE id=?")
    .run(nowIso(), username || "admin", username || "admin", nowIso(), +id);
}

function rollbackSending(id, username, errorMsg){
  db.prepare("UPDATE outbound_queue SET status='pending',send_error=?,attempts=COALESCE(attempts,0)+1,updated_by=?,updated_at=? WHERE id=? AND status='sending'")
    .run(String(errorMsg || "发送失败").slice(0, 500), username || "admin", nowIso(), +id);
}

function updateTextPending(id, text, username){
  const r = db.prepare("UPDATE outbound_queue SET text=?,updated_by=?,updated_at=? WHERE id=? AND status='pending'")
    .run(text, username || "admin", nowIso(), +id);
  return r.changes === 1;
}

function updateAssigneePending(id, assignee, username){
  const r = db.prepare("UPDATE outbound_queue SET assignee=?,updated_by=?,updated_at=? WHERE id=? AND status='pending'")
    .run(assignee, username || "admin", nowIso(), +id);
  return r.changes === 1;
}

/** pending 草稿：同时更新正文与 payload（医助 AI 改写等） */
function updatePendingDraft(id, text, payload, username){
  const payloadText = payload == null
    ? "{}"
    : (typeof payload === "string" ? payload : JSON.stringify(payload));
  const r = db.prepare("UPDATE outbound_queue SET text=?,payload=?,updated_by=?,updated_at=? WHERE id=? AND status='pending'")
    .run(String(text == null ? "" : text).slice(0, 2400), payloadText, username || "admin", nowIso(), +id);
  return r.changes === 1;
}

/** 群合并：把 drop 群上的出站行挂到 keep 群（只改 group_id） */
function reassignGroup(fromGroupId, toGroupId){
  const fromId = +fromGroupId;
  const toId = +toGroupId;
  if(!Number.isInteger(fromId) || fromId <= 0) return 0;
  if(!Number.isInteger(toId) || toId <= 0) return 0;
  if(fromId === toId) return 0;
  const r = db.prepare("UPDATE outbound_queue SET group_id=? WHERE group_id=?").run(toId, fromId);
  return r.changes || 0;
}

function payloadDecisionId(payload){
  const p = payload || {};
  const tri = p.triage || {};
  const raw = p.triageDecisionId || p.decisionId || tri.decisionId;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function parsePayload(text){
  try{
    const v = JSON.parse(text || "{}");
    return v && typeof v === "object" ? v : {};
  }catch(e){
    return {};
  }
}

function findByDecision(decisionId){
  const did = Number(decisionId);
  if(!Number.isInteger(did) || did <= 0) return null;
  const linked = db.prepare(`SELECT o.* FROM outbound_queue o
    JOIN community_messages m ON m.id=o.message_id
    WHERE m.decision_id=? AND o.status IN ('pending','sent')
    ORDER BY CASE WHEN o.status='pending' THEN 0 ELSE 1 END, o.id DESC
    LIMIT 1`).get(did);
  if(linked) return linked;
  const rows = db.prepare(`SELECT * FROM outbound_queue
    WHERE channel_type='qiwe' AND status IN ('pending','sent')
    ORDER BY CASE WHEN status='pending' THEN 0 ELSE 1 END, id DESC
    LIMIT 500`).all();
  for(const row of rows){
    if(payloadDecisionId(parsePayload(row.payload)) === did) return row;
  }
  return null;
}

function findSendingByDecision(decisionId){
  const did = Number(decisionId);
  if(!Number.isInteger(did) || did <= 0) return null;
  const linked = db.prepare(`SELECT o.* FROM outbound_queue o
    JOIN community_messages m ON m.id=o.message_id
    WHERE m.decision_id=? AND o.status='sending' ORDER BY o.id DESC LIMIT 1`).get(did);
  if(linked) return linked;
  const rows = db.prepare(`SELECT * FROM outbound_queue
    WHERE channel_type='qiwe' AND status='sending' ORDER BY id DESC LIMIT 500`).all();
  for(const row of rows){
    if(payloadDecisionId(parsePayload(row.payload)) === did) return row;
  }
  return null;
}

/** Query：从社群群表解析企微群 roomId（用于运营草稿缺 toId 时回填） */
function resolveGroupExternalId(groupId){
  if(groupId == null) return "";
  const g = db.prepare("SELECT external_group_id FROM community_groups WHERE id=?").get(+groupId);
  return g && g.external_group_id ? String(g.external_group_id).trim() : "";
}

/** Query：从社群成员表解析企微单聊 touser（跨模块只读） */
function resolveTouser(row){
  if(!row || !row.message_id) return "";
  const m = db.prepare(`SELECT cm.external_user_id AS uid
    FROM community_messages msg JOIN community_members cm ON cm.id=msg.member_id
    WHERE msg.id=?`).get(+row.message_id);
  const uid = m && m.uid ? String(m.uid).trim() : "";
  if(!uid || uid.startsWith("local-")) return "";
  return uid;
}

function getTriageDecision(decisionId){
  const did = Number(decisionId);
  if(!Number.isInteger(did) || did <= 0) return null;
  return db.prepare(`SELECT x.*, s.doctor_id AS doctor_id, s.status AS session_status
    FROM triage_decisions x JOIN triage_sessions s ON s.id=x.session_id
    WHERE x.id=?`).get(did) || null;
}

function listRecentByDoctor(doctorId, limit){
  const lim = Math.min(Math.max(Number(limit) || 40, 1), 200);
  return db.prepare("SELECT * FROM outbound_queue WHERE doctor_id=? ORDER BY status='pending' DESC,id DESC LIMIT ?")
    .all(+doctorId, lim);
}

function overviewOutboxCounts(doctorId){
  const did = +doctorId;
  return {
    pendingOutbox: db.prepare(`SELECT COUNT(*) c FROM outbound_queue o LEFT JOIN community_groups g ON g.id=o.group_id
      WHERE o.doctor_id=? AND o.status='pending' AND (o.data_source='qiwe' OR g.is_business=1)`).get(did).c,
    sentOutbox: db.prepare(`SELECT COUNT(*) c FROM outbound_queue o LEFT JOIN community_groups g ON g.id=o.group_id
      WHERE o.doctor_id=? AND o.status='sent' AND (o.data_source='qiwe' OR g.is_business=1)`).get(did).c,
    outboxTotal: db.prepare("SELECT COUNT(*) c FROM outbound_queue WHERE doctor_id=?").get(did).c
  };
}

module.exports = {
  insert,
  getById,
  nowIso,
  updateNonSent,
  preemptSending,
  markSentReal,
  markSentManual,
  rollbackSending,
  updateTextPending,
  updateAssigneePending,
  updatePendingDraft,
  reassignGroup,
  findByDecision,
  findSendingByDecision,
  resolveTouser,
  resolveGroupExternalId,
  getTriageDecision,
  parsePayload,
  listRecentByDoctor,
  overviewOutboxCounts
};
