"use strict";

/**
 * 出站领域服务：入队 / 直写 / 状态机。
 */
const eventBus = require("../../shared/eventBus.js");
const repo = require("./repo.js");
const rules = require("./rules.js");
const status = require("./status.js");

function emitEnqueued(id, doctorId, source, statusName, via){
  try{
    eventBus.emit("outbox.enqueued", { id, doctorId, source, status: statusName, via });
  }catch(e){}
}

function insert(row, meta){
  const id = repo.insert(row);
  emitEnqueued(id, row && row.doctorId, row && row.source, row && row.status, (meta && meta.via) || "insert");
  return id;
}

function enqueue({ doctorId, group, messageId, targetName, text, payload, status: st, source, priority, username }){
  const finalStatus = st || "pending";
  const id = repo.insert({
    doctorId: +doctorId,
    groupId: group ? group.id : null,
    messageId: messageId || null,
    targetType: "group",
    targetName: targetName || (group && group.name) || "社群",
    channelType: (group && group.channel_type) || "wechat",
    text,
    payload: payload || {},
    status: finalStatus,
    source: source || "manual",
    priority: priority || "normal",
    sentAt: finalStatus === "sent" ? repo.nowIso() : null,
    sentBy: finalStatus === "sent" ? (username || "system") : null,
    dataSource: rules.communityDataSource(group)
  });
  const out = rules.toPublic(repo.getById(id));
  emitEnqueued(id, out.doctorId, out.source, out.status, "enqueue");
  return out;
}

function enqueueDirect({ doctorId, targetId, text, source, channelType, isGroup, atUserId, groupId }){
  const id = repo.insert({
    doctorId,
    groupId: groupId || null,
    messageId: null,
    targetType: isGroup ? "qiwe_room" : "qiwe_dm",
    targetName: String(targetId || ""),
    channelType: channelType || "qiwe",
    text,
    payload: {
      qiwe: { toId: targetId, ...(atUserId ? { atUserId } : {}) },
      source: source || "direct"
    },
    status: "pending",
    source: source || "direct",
    priority: "normal",
    dataSource: "manual"
  });
  emitEnqueued(id, doctorId, source || "direct", "pending", "enqueueDirect");
  return id;
}

async function setOutboxStatus(id, nextStatus, username, options){
  const out = await status.setOutboxStatus(id, nextStatus, username, options);
  if(out && out.status === "sent"){
    try{
      eventBus.emit("outbox.sent", {
        id: out.id,
        doctorId: out.doctorId,
        source: out.source,
        sentMode: out.sentMode || null
      });
    }catch(e){}
  }
  return out;
}

function editOutboxText(id, text, username){
  return status.editOutboxText(id, text, username);
}

function setOutboxAssignee(id, assignee, username){
  return status.setOutboxAssignee(id, assignee, username);
}

function getById(id){
  return repo.getById(id);
}

/**
 * 更新 pending 草稿正文 + payload；成功返回公开对象，失败返回 null。
 */
function updatePendingDraft(id, patch, username){
  const p = patch || {};
  const ok = repo.updatePendingDraft(id, p.text, p.payload, username);
  if(!ok) return null;
  return rules.toPublic(repo.getById(id));
}

/**
 * 群合并时重挂 group_id（受控维修口）。
 */
function reassignGroup(fromGroupId, toGroupId){
  return repo.reassignGroup(fromGroupId, toGroupId);
}

function outboxOut(row){
  if(row && row.doctor_id != null) return rules.toPublic(row);
  return row;
}

function outboxForDecision(decisionId){
  return status.outboxForDecision(decisionId);
}

async function sendOutboxForDecision(decisionId, text, username){
  return status.sendOutboxForDecision(decisionId, text, username);
}

function listRecentByDoctor(doctorId, limit){
  return repo.listRecentByDoctor(doctorId, limit);
}

function overviewOutboxCounts(doctorId){
  return repo.overviewOutboxCounts(doctorId);
}

module.exports = {
  insert,
  enqueue,
  enqueueDirect,
  setOutboxStatus,
  editOutboxText,
  setOutboxAssignee,
  getById,
  updatePendingDraft,
  reassignGroup,
  outboxOut,
  outboxForDecision,
  sendOutboxForDecision,
  listRecentByDoctor,
  overviewOutboxCounts,
  repo,
  rules
};
