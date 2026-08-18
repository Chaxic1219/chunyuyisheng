"use strict";

/**
 * Agent 群聊沙盒：仅 runTurn，禁止出站。
 */
const agent = require("../agent/index.js");
const sessionStore = require("../agent/session.js");

function cleanSessionId(v){
  return String(v || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64);
}

function bubblesFromReply(reply){
  const list = Array.isArray(reply && reply.responses) ? reply.responses : [];
  return list
    .filter(r => r && r.type === "text" && String(r.text || "").trim())
    .map(r => String(r.text).trim().slice(0, 2000));
}

function patientKeyOf(adminId, doctorId, sessionId){
  return "sandbox:" + Number(adminId || 0) + ":" + Number(doctorId) + ":" + cleanSessionId(sessionId);
}

function registerAgentSandboxAdminRoutes(route, ctx){
  const { parseBody, json, gate } = ctx;

  route("POST", /^\/api\/admin\/agent\/sandbox-turn$/, async (req, res) => {
    const b = await parseBody(req);
    const doctorId = Number(b.doctorId);
    const s = gate(req, res, doctorId);
    if(!s) return;
    if(!agent.agentEnabled()){
      return json(res, 503, { error: "Dialogue Agent 未开启（DIALOGUE_AGENT_ENABLED≠1）" });
    }
    const text = String(b.text || "").trim().slice(0, 1000);
    if(!text) return json(res, 400, { error: "消息不能为空" });
    let sessionId = cleanSessionId(b.sessionId);
    if(!sessionId){
      sessionId = Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
    }
    const patientKey = patientKeyOf(s.adminId, doctorId, sessionId);
    const patientName = String(b.patientName || "测试群友").trim().slice(0, 40) || "测试群友";
    try{
      const reply = await agent.runTurn({
        doctorId,
        text,
        patientKey,
        patientName,
        isGroup: true
      });
      const bubbles = bubblesFromReply(reply);
      json(res, 200, {
        ok: true,
        sessionId,
        bot: (reply && reply.bot) || "医助",
        bubbles,
        silent: !bubbles.length,
        source: (reply && reply.source) || null
      });
    }catch(e){
      const status = e && e.status ? e.status : 500;
      json(res, status, { error: (e && e.message) || "沙盒调用失败" });
    }
  });

  route("POST", /^\/api\/admin\/agent\/sandbox-reset$/, async (req, res) => {
    const b = await parseBody(req);
    const doctorId = Number(b.doctorId);
    const s = gate(req, res, doctorId);
    if(!s) return;
    const sessionId = cleanSessionId(b.sessionId);
    if(!sessionId) return json(res, 400, { error: "缺少 sessionId" });
    const patientKey = patientKeyOf(s.adminId, doctorId, sessionId);
    sessionStore.resetSession(doctorId, patientKey);
    json(res, 200, { ok: true });
  });
}

module.exports = {
  registerAgentSandboxAdminRoutes,
  bubblesFromReply,
  patientKeyOf,
  cleanSessionId
};
