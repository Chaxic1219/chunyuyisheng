"use strict";

/**
 * 社群模块门面：群/成员/消息/归档/入站/风控/工作台/运营草稿。
 */
const eventBus = require("../../shared/eventBus.js");
const service = require("./service.js");
const inbound = require("./inbound.js");
const orchestrate = require("./orchestrate.js");
const moderation = require("./moderation.js");
const workspace = require("./workspace.js");
const campaigns = require("./campaigns.js");
const runtime = require("./runtime.js");
const outbox = require("../outbox");

function archiveQiweInbound(input){
  const out = inbound.archiveQiweInbound(input);
  if(out && out.accepted && !out.deduped){
    try{
      eventBus.emit("community.inbound.archived", {
        doctorId: out.group && out.group.doctorId,
        groupId: out.group && out.group.id,
        messageId: out.messageId,
        source: "qiwe"
      });
    }catch(e){}
  }
  return out;
}

function recordGroupModeration(input){
  const out = moderation.recordGroupModeration(input);
  if(out && out.flagged && !out.deduped){
    try{
      eventBus.emit("community.moderation.flagged", {
        doctorId: input && input.doctorId,
        messageId: out.messageId,
        flag: out.flag,
        level: out.level
      });
    }catch(e){}
  }
  return out;
}

module.exports = {
  findQiweBusinessGroupByRoom: service.findQiweBusinessGroupByRoom,
  findQiweBusinessGroup: service.findQiweBusinessGroup,
  ensureDefaultGroup: service.ensureDefaultGroup,
  suggestGroupName: service.suggestGroupName,
  createGroup: service.createGroup,
  findGroup: service.findGroup,
  upsertMember: service.upsertMember,
  groupOut: service.groupOut,
  buildGroupName: service.buildGroupName,
  isPlaceholderGroupId: service.isPlaceholderGroupId,
  archiveQiweInbound,
  findNearbyPeerMessages: inbound.findNearbyPeerMessages,
  memberHasNearbyMedia: inbound.memberHasNearbyMedia,
  handleInbound: (input)=>orchestrate.handleInbound(input),
  recordGroupModeration,
  scanModeration: moderation.scanModeration,
  resolveModeration: moderation.resolveModeration,
  listOpenModeration: moderation.listOpenModeration,
  combineModeration: moderation.combineModeration,
  coerceModerationAssessment: moderation.coerceModerationAssessment,
  assessModerationLLM: moderation.assessModerationLLM,
  assessAndUpdateModeration: moderation.assessAndUpdateModeration,
  resolveDoctorId: runtime.resolveDoctorId,
  overview: workspace.overview,
  createGroupOnQiwe: workspace.createGroupOnQiwe,
  listContacts: workspace.listContacts,
  updateGroup: workspace.updateGroup,
  reminders: workspace.reminders,
  createWeeklyCampaign: campaigns.createWeeklyCampaign,
  createOpsContentCandidate: campaigns.createOpsContentCandidate,
  generateAssistantDraftForOutbox: campaigns.generateAssistantDraftForOutbox,
  weekIso: campaigns.weekIso,
  runWeeklyAuto: campaigns.runWeeklyAuto,
  enqueue: runtime.enqueue,
  setOutboxStatus: (...a)=>outbox.setOutboxStatus(...a),
  sendOutboxForDecision: (...a)=>outbox.sendOutboxForDecision(...a),
  editOutboxText: (...a)=>outbox.editOutboxText(...a),
  setOutboxAssignee: (...a)=>outbox.setOutboxAssignee(...a),
  outboxOut: runtime.outboxOut,
  outboxForDecision: (id)=>outbox.outboxForDecision(id),
  attachTriageOutboxes: (detail)=>{
    if(!detail || !Array.isArray(detail.decisions)) return detail;
    detail.decisions = detail.decisions.map(d=>({ ...d, outbox:outbox.outboxForDecision(d.id) }));
    return detail;
  },
  repo: service.repo,
  rules: service.rules,
  messageOut: service.messageOut
};
