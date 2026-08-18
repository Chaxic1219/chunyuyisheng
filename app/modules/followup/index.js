"use strict";

/**
 * 随访模块门面：自管 followups 表与节点规则。
 */
const service = require("./service.js");

module.exports = {
  enroll: service.enroll,
  mine: service.mine,
  listQueue: service.listQueue,
  detail: service.detail,
  markNode: service.markNode,
  findPlan: service.findPlan,
  plansFor: service.plansFor
};
