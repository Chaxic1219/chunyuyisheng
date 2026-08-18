"use strict";

/**
 * 社群兼容入口：真实现已迁入 modules/community/*。
 * 保留本文件供 server / 旧 require("./community.js") 路径零改动。
 */
const service = require("./modules/community/service.js");
const inbound = require("./modules/community/inbound.js");
const orchestrate = require("./modules/community/orchestrate.js");
const moderation = require("./modules/community/moderation.js");
const workspace = require("./modules/community/workspace.js");
const campaigns = require("./modules/community/campaigns.js");
const runtime = require("./modules/community/runtime.js");
const outbox = require("./modules/outbox");

module.exports = {
  overview: workspace.overview,
  resolveDoctorId: runtime.resolveDoctorId,
  createGroup: service.createGroup,
  createGroupOnQiwe: workspace.createGroupOnQiwe,
  listContacts: workspace.listContacts,
  updateGroup: workspace.updateGroup,
  buildGroupName: service.buildGroupName,
  suggestGroupName: service.suggestGroupName,
  createWeeklyCampaign: campaigns.createWeeklyCampaign,
  createOpsContentCandidate: campaigns.createOpsContentCandidate,
  weekIso: campaigns.weekIso,
  runWeeklyAuto: campaigns.runWeeklyAuto,
  scienceReminders: require("./modules/community/science_reminders.js"),
  handleInbound: (input)=>orchestrate.handleInbound(input),
  archiveQiweInbound: inbound.archiveQiweInbound,
  findQiweBusinessGroup: service.findQiweBusinessGroup,
  findQiweBusinessGroupByRoom: service.findQiweBusinessGroupByRoom,
  findNearbyPeerMessages: inbound.findNearbyPeerMessages,
  memberHasNearbyMedia: inbound.memberHasNearbyMedia,
  generateAssistantDraftForOutbox: campaigns.generateAssistantDraftForOutbox,
  enqueue: runtime.enqueue,
  setOutboxStatus: (...a)=>outbox.setOutboxStatus(...a),
  sendOutboxForDecision: (...a)=>outbox.sendOutboxForDecision(...a),
  editOutboxText: (...a)=>outbox.editOutboxText(...a),
  setOutboxAssignee: (...a)=>outbox.setOutboxAssignee(...a),
  reminders: workspace.reminders,
  groupOut: service.groupOut,
  messageOut: service.messageOut,
  outboxOut: runtime.outboxOut,
  outboxForDecision: (decisionId)=>outbox.outboxForDecision(decisionId),
  attachTriageOutboxes: (detail)=>{
  if(!detail || !Array.isArray(detail.decisions)) return detail;
    detail.decisions = detail.decisions.map(d=>({ ...d, outbox:outbox.outboxForDecision(d.id) }));
  return detail;
  },
  scanModeration: moderation.scanModeration,
  recordGroupModeration: moderation.recordGroupModeration,
  combineModeration: moderation.combineModeration,
  coerceModerationAssessment: moderation.coerceModerationAssessment,
  assessModerationLLM: moderation.assessModerationLLM,
  assessAndUpdateModeration: moderation.assessAndUpdateModeration,
  resolveModeration: moderation.resolveModeration,
  listOpenModeration: moderation.listOpenModeration
};
