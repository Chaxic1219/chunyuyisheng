"use strict";

/**
 * 随访领域服务。
 */
const eventBus = require("../../shared/eventBus.js");
const repo = require("./repo.js");
const rules = require("./rules.js");

function plansFor(doctorId){
  return repo.doctorContent(doctorId).followupPlans || [];
}

function findPlan(doctorId, nameOrKey){
  const k = String(nameOrKey || "").trim();
  return plansFor(doctorId).find(p => p.name === k || p.key === k) || null;
}

function toTimeline(fu){
  return rules.timeline(fu, repo.parseJson);
}

function enroll(doctorId, { name, phone, planKey, enrolledAt }){
  const plan = findPlan(doctorId, planKey);
  if(!plan) return null;
  const nodes = rules.buildInitialNodes(plan);
  if(!nodes.length) return null;
  const at = rules.parseEnrolledAt(enrolledAt, repo.nowIso);
  const row = repo.insertEnroll({
    doctorId,
    patientName: name || "患者",
    patientPhone: phone || "",
    planKey: plan.key,
    planName: plan.name,
    enrolledAt: at,
    nodesJson: JSON.stringify(nodes),
    status: "active"
  });
  try{
    eventBus.emit("followup.enrolled", {
      id: row && row.id,
      doctorId,
      planKey: plan.key
    });
  }catch(e){}
  return row;
}

function mine(doctorId, phone){
  return repo.listByPhone(doctorId, phone).map(toTimeline);
}

function listQueue(doctorId){
  return repo.listByDoctor(doctorId, 100).map(toTimeline);
}

function detail(id){
  const fu = repo.getById(id);
  return fu ? toTimeline(fu) : null;
}

function markNode(id, idx, status, username){
  const fu = repo.getById(id);
  if(!fu) return null;
  const nodes = repo.parseJson(fu.nodes, []);
  if(!nodes[idx]) return toTimeline(fu);
  nodes[idx].status = rules.normalizeNodeStatus(status);
  nodes[idx].doneAt = (nodes[idx].status === "pending") ? null : repo.nowIso();
  const allDone = nodes.length > 0 && nodes.every(n => n.status === "done");
  const nextStatus = allDone ? "completed" : "active";
  repo.updateNodes(id, JSON.stringify(nodes), nextStatus);
  const out = detail(id);
  try{
    eventBus.emit("followup.node.updated", {
      id: +id,
      idx: +idx,
      status: nodes[idx].status,
      followupStatus: nextStatus,
      by: username || ""
    });
  }catch(e){}
  return out;
}

module.exports = {
  enroll,
  mine,
  listQueue,
  detail,
  markNode,
  findPlan,
  plansFor
};
