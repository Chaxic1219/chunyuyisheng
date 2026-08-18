"use strict";

/**
 * 分诊台后台路由（从 server.js 迁出）。
 */
function registerTriageAdminRoutes(route, ctx){
  const {
    parseBody,
    json,
    gate,
    rowDoctorId,
    requireAdminAction,
    db,
    adminScope,
    now,
    triage,
    community,
    outboxMod,
    decisionDoctorId,
    auditRequestId,
    adminAudit,
    adminAuditBestEffort,
    auditOutboxSnapshot,
    auditDecisionSnapshot,
    auditText,
    triageSessionDeliveryTarget
  } = ctx;


/* AI 分诊台 */
route("GET", /^\/api\/admin\/triage\/sessions$/, (req,res,m,q)=>{ const s=gate(req,res,+q.doctorId); if(!s)return;
  json(res,200, triage.listSessions(+q.doctorId)); });
route("GET", /^\/api\/admin\/triage\/sessions\/(\d+)$/, (req,res,m)=>{ const s=gate(req,res, rowDoctorId("triage_sessions",+m[1])); if(!s)return;
  const detail = triage.sessionDetail(+m[1]);
  detail ? json(res,200,community.attachTriageOutboxes(detail)) : json(res,404,{error:"分诊会话不存在"}); });
route("POST", /^\/api\/admin\/triage\/decisions\/(\d+)\/confirm$/, async (req,res,m)=>{
  const did = decisionDoctorId(+m[1]);
  const s=gate(req,res, did); if(!s) return;
  if(!requireAdminAction(req,res,s,"triage.confirm_send",{doctorId:did},"无该分诊回复的确认发送权限")) return;
  const b = await parseBody(req);
  const requestId = auditRequestId(req);
  const before = auditDecisionSnapshot(+m[1]);
  adminAudit(req, s, {
    action:"triage.confirm_send", resourceType:"triage_decision", resourceId:+m[1], doctorId:did,
    patientId:before && before.patientId, sessionId:before && before.sessionId, riskLevel:before && before.riskLevel,
    channel:"community", outcome:"requested", requestId,
    before, meta:{ text:auditText(b.text || "", 240) }
  });
  try{
    const delivery = await community.sendOutboxForDecision(+m[1], b.text, s.username);
    const finalText = delivery && delivery.outbox && delivery.outbox.text ? delivery.outbox.text : b.text;
    const detail = community.attachTriageOutboxes(triage.confirmDecision(+m[1], finalText, s.username));
    adminAuditBestEffort(req, s, {
      action:"triage.confirm_send", resourceType:"triage_decision", resourceId:+m[1], doctorId:did,
      patientId:before && before.patientId, sessionId:before && before.sessionId, riskLevel:before && before.riskLevel,
      channel:(delivery && delivery.outbox && delivery.outbox.channelType) || "community", outcome:"success", requestId,
      before, after:auditDecisionSnapshot(+m[1]), meta:{ outboxId:delivery && delivery.outbox && delivery.outbox.id, alreadySent:!!(delivery && delivery.alreadySent) }
    });
    json(res,200,{ ok:true, delivery, ...detail });
  }
  catch(e){
    adminAuditBestEffort(req, s, {
      action:"triage.confirm_send", resourceType:"triage_decision", resourceId:+m[1], doctorId:did,
      patientId:before && before.patientId, sessionId:before && before.sessionId, riskLevel:before && before.riskLevel,
      channel:"community", outcome:"failed", reason:e.message || "发送失败", requestId,
      before, after:auditDecisionSnapshot(+m[1])
    });
    json(res,400,{error:e.message});
  }
});
route("POST", /^\/api\/admin\/triage\/sessions\/(\d+)\/status$/, async (req,res,m)=>{
  const did = rowDoctorId("triage_sessions",+m[1]);
  const s=gate(req,res, did); if(!s) return;
  if(!requireAdminAction(req,res,s,"triage.note_status",{doctorId:did},"无该分诊会话的状态处理权限")) return;
  const b = await parseBody(req);
  json(res,200, triage.updateSessionStatus(+m[1], b.status, b.handler || s.username));
});
route("POST", /^\/api\/admin\/triage\/sessions\/(\d+)\/note$/, async (req,res,m)=>{
  const did = rowDoctorId("triage_sessions",+m[1]);
  const s=gate(req,res, did); if(!s) return;
  if(!requireAdminAction(req,res,s,"triage.note_status",{doctorId:did},"无该分诊会话的备注权限")) return;
  const b = await parseBody(req);
  try{ json(res,200, triage.addNote(+m[1], b.text, s.username)); }
  catch(e){ json(res,400,{error:e.message}); }
});

/* [2026-07-13] 手动回复 API：医助在分诊台直接编辑回复并发送到群 */
route("POST", /^\/api\/admin\/triage\/(\d+)\/manual-reply$/, async (req,res,m)=>{
  const sessionId = +m[1];
  const did = rowDoctorId("triage_sessions", sessionId);
  const s=gate(req,res,did); if(!s) return;
  if(!requireAdminAction(req,res,s,"triage.confirm_send",{doctorId:did},"无该分诊回复的发送权限")) return;
  const b = await parseBody(req);
  if(!b.text || !b.text.trim()) return json(res,400,{error:"回复内容不能为空"});
  const sess = db.prepare("SELECT * FROM triage_sessions WHERE id=?").get(sessionId);
  if(!sess) return json(res,404,{error:"分诊会话不存在"});
  const target = triageSessionDeliveryTarget(sess);
  const targetId = target && target.toId ? target.toId : "";
  const outId = outboxMod.enqueueDirect({
    doctorId: sess.doctor_id,
    targetId,
    text: b.text.trim(),
    source: "manual_reply",
    channelType: (target && target.channel === "community") ? "wechat" : "qiwe",
    isGroup: !!(target && target.isGroup),
    atUserId: target && target.atUserId,
    groupId: target && target.groupId,
  });
  let sent = false;
  let sendError = null;
  try {
    // 与社群出站同路：qiwe.loadConfig()（最新在线 GUID），避免 WHERE doctor_id=? 无序取到离线旧实例
    if(!targetId) throw new Error("无法解析发送目标");
    await outboxMod.setOutboxStatus(outId, "sent", s.username || String(s.adminId), { requireRealSend:true });
    sent = true;
    console.log("[manual-reply] sent to", targetId);
  } catch(e){
    sendError = (e && e.message) || String(e);
    console.error("[manual-reply] send failed:", sendError);
  }
  if(sent) triage.updateSessionStatus(sessionId, "closed", s.username||String(s.adminId));
  json(res,200,{ok:true, sent, outboxId:outId, ...(sendError ? { error:sendError } : {})});
});
}

module.exports = { registerTriageAdminRoutes };
