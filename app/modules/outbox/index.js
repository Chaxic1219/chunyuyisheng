"use strict";

/**
 * 出站队列唯一门面。
 * 写入只允许经本模块（repo）；业务侧禁止直接 INSERT/UPDATE/DELETE outbound_queue。
 */
const service = require("./service.js");

module.exports = {
  insert: service.insert,
  enqueue: service.enqueue,
  enqueueDirect: service.enqueueDirect,
  setOutboxStatus: service.setOutboxStatus,
  editOutboxText: service.editOutboxText,
  setOutboxAssignee: service.setOutboxAssignee,
  getById: service.getById,
  updatePendingDraft: service.updatePendingDraft,
  reassignGroup: service.reassignGroup,
  outboxOut: service.outboxOut,
  outboxForDecision: service.outboxForDecision,
  sendOutboxForDecision: service.sendOutboxForDecision,
  listRecentByDoctor: service.listRecentByDoctor,
  overviewOutboxCounts: service.overviewOutboxCounts
};
