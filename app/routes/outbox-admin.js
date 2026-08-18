"use strict";

/**
 * 出站审核台路由（Phase 3：从 server.js 迁出）。
 */
function registerOutboxAdminRoutes(route, ctx){
  const {
    parseBody, json, gate, rowDoctorId, requireAdminAction,
    db, adminScope, auditRequestId, auditOutboxSnapshot,
    adminAudit, adminAuditBestEffort,
    outboxMod, community
  } = ctx;

  route("POST", /^\/api\/admin\/community\/outbox\/(\d+)\/send$/, async (req,res,m)=>{
    const did = rowDoctorId("outbound_queue", +m[1]);
    const s=gate(req,res,did); if(!s)return;
    if(did==null) return json(res,404,{error:"出站消息不存在"});
    const outRow = db.prepare("SELECT id,group_id,doctor_id FROM outbound_queue WHERE id=?").get(+m[1]);
    if(outRow && outRow.group_id){
      const cgd = require("../community_group_doctors.js");
      const adminCtx = { adminId: s.adminId, scope: adminScope(s) };
      if(!cgd.canAdminSeeGroup(adminCtx, outRow.group_id)){
        return json(res,403,{error:"无权操作该群出站消息"});
      }
    }
    if(!requireAdminAction(req,res,s,"outbox.send",{doctorId:did},"无该出站消息的发送权限")) return;
    const requestId = auditRequestId(req);
    const before = auditOutboxSnapshot(+m[1]);
    adminAudit(req, s, {
      action:"outbox.send", resourceType:"outbox", resourceId:+m[1], doctorId:did,
      channel:(before && before.channelType) || "community", outcome:"requested", requestId,
      before, meta:{ source:before && before.source, priority:before && before.priority }
    });
    try{
      const row = await outboxMod.setOutboxStatus(+m[1], "sent", s.username);
      adminAuditBestEffort(req, s, {
        action:"outbox.send", resourceType:"outbox", resourceId:+m[1], doctorId:did,
        channel:(before && before.channelType) || "community", outcome:"success", requestId,
        before, after:auditOutboxSnapshot(+m[1]), meta:{ status:row.status, sentBy:row.sentBy || "" }
      });
      json(res,200,{ ok:true, outbox:row });
    }
    catch(e){
      adminAuditBestEffort(req, s, {
        action:"outbox.send", resourceType:"outbox", resourceId:+m[1], doctorId:did,
        channel:(before && before.channelType) || "community", outcome:"failed", reason:e.message || "发送失败", requestId,
        before, after:auditOutboxSnapshot(+m[1])
      });
      json(res,400,{error:e.message});
    }
  });

  route("POST", /^\/api\/admin\/community\/outbox\/(\d+)\/cancel$/, async (req,res,m)=>{
    const did = rowDoctorId("outbound_queue", +m[1]);
    const s=gate(req,res,did); if(!s)return;
    if(did==null) return json(res,404,{error:"出站消息不存在"});
    if(!requireAdminAction(req,res,s,"community.outbox.edit",{doctorId:did},"无该出站消息的取消权限")) return;
    try{ json(res,200,{ ok:true, outbox: await outboxMod.setOutboxStatus(+m[1], "cancelled", s.username) }); }
    catch(e){ json(res,400,{error:e.message}); }
  });

  route("POST", /^\/api\/admin\/community\/outbox\/(\d+)\/edit$/, async (req,res,m)=>{
    const did = rowDoctorId("outbound_queue", +m[1]);
    const s=gate(req,res,did); if(!s)return;
    if(did==null) return json(res,404,{error:"出站消息不存在"});
    const b = await parseBody(req);
    if(b.__oversize) return json(res,413,{error:"请求体过大（上限 1MB）"});
    if(!requireAdminAction(req,res,s,"community.outbox.edit",{doctorId:did},"无该出站消息的编辑权限")) return;
    try{ json(res,200,{ ok:true, outbox: outboxMod.editOutboxText(+m[1], b.text, s.username) }); }
    catch(e){ json(res,400,{error:e.message}); }
  });

  route("POST", /^\/api\/admin\/community\/outbox\/(\d+)\/assist-draft$/, async (req,res,m)=>{
    const did = rowDoctorId("outbound_queue", +m[1]);
    const s=gate(req,res,did); if(!s)return;
    if(did==null) return json(res,404,{error:"出站消息不存在"});
    const b = await parseBody(req);
    if(b.__oversize) return json(res,413,{error:"请求体过大（上限 1MB）"});
    if(!requireAdminAction(req,res,s,"assistant_draft.generate",{doctorId:did},"无 AI 改写草稿权限")) return;
    try{ json(res,200, await community.generateAssistantDraftForOutbox(+m[1], { ...b, username:s.username })); }
    catch(e){ json(res,400,{error:e.message}); }
  });

  route("POST", /^\/api\/admin\/community\/outbox\/(\d+)\/assignee$/, async (req,res,m)=>{
    const did = rowDoctorId("outbound_queue", +m[1]);
    const s=gate(req,res,did); if(!s)return;
    if(did==null) return json(res,404,{error:"出站消息不存在"});
    const b = await parseBody(req);
    if(b.__oversize) return json(res,413,{error:"请求体过大（上限 1MB）"});
    if(!requireAdminAction(req,res,s,"community.outbox.edit",{doctorId:did},"无该出站消息的分派权限")) return;
    try{ json(res,200,{ ok:true, outbox: outboxMod.setOutboxAssignee(+m[1], b.assignee, s.username) }); }
    catch(e){ json(res,400,{error:e.message}); }
  });

  route("POST", /^\/api\/admin\/community\/outbox\/(\d+)\/ignore$/, async (req,res,m)=>{
    const did = rowDoctorId("outbound_queue", +m[1]);
    const s=gate(req,res,did); if(!s)return;
    if(did==null) return json(res,404,{error:"出站消息不存在"});
    if(!requireAdminAction(req,res,s,"community.outbox.edit",{doctorId:did},"无该出站消息的忽略权限")) return;
    try{ json(res,200,{ ok:true, outbox: await outboxMod.setOutboxStatus(+m[1], "ignored", s.username) }); }
    catch(e){ json(res,400,{error:e.message}); }
  });
}

module.exports = { registerOutboxAdminRoutes };
