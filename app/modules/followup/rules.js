"use strict";

/**
 * 随访规则：时间轴、节点状态（不碰 SQL）。
 */
const DAY = 86400000;
const NODE_STATUSES = new Set(["pending", "pushed", "done"]);

function buildInitialNodes(plan){
  return (plan.nodes || []).map(n => ({
    day: n.day,
    title: n.title,
    edu: n.edu || "",
    reminder: n.reminder || "",
    action: n.action || "consult",
    status: "pending",
    doneAt: null
  }));
}

function normalizeNodeStatus(status){
  return NODE_STATUSES.has(status) ? status : "pushed";
}

function timeline(fu, parseJson){
  let start = new Date(fu.enrolled_at).getTime();
  if(isNaN(start)) start = Date.now();
  const today = Date.now();
  const nodes = parseJson(fu.nodes, []).map((n, idx) => {
    const due = start + (n.day || 0) * DAY;
    let state;
    if(n.status === "done") state = "done";
    else if(n.status === "pushed") state = "pushed";
    else if(due <= today) state = "due";
    else state = "upcoming";
    return {
      idx,
      day: n.day,
      title: n.title,
      edu: n.edu,
      reminder: n.reminder,
      action: n.action,
      status: n.status,
      doneAt: n.doneAt,
      dueDate: isNaN(due) ? "" : new Date(due).toISOString().slice(0, 10),
      state
    };
  });
  const total = nodes.length;
  const done = nodes.filter(n => n.status === "done").length;
  const next = nodes.find(n => n.state === "due")
    || nodes.find(n => n.state === "upcoming")
    || nodes.find(n => n.state === "pushed")
    || null;
  return {
    id: fu.id,
    planName: fu.plan_name,
    planKey: fu.plan_key,
    patientName: fu.patient_name,
    phoneTail: String(fu.patient_phone || "").slice(-4),
    enrolledAt: String(fu.enrolled_at || "").slice(0, 10),
    status: fu.status,
    total,
    done,
    next,
    nodes
  };
}

function parseEnrolledAt(enrolledAt, nowIso){
  if(enrolledAt && /^\d{4}-\d{2}-\d{2}/.test(enrolledAt)){
    return new Date(enrolledAt).toISOString();
  }
  return nowIso();
}

module.exports = {
  DAY,
  NODE_STATUSES,
  buildInitialNodes,
  normalizeNodeStatus,
  timeline,
  parseEnrolledAt
};
