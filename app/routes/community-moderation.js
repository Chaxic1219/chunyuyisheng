"use strict";

/**
 * 群风控处置路由（从 server.js 迁出）。
 */
function registerCommunityModerationRoutes(route, ctx){
  const {
    parseBody, json, gate, requireAdminAction,
    db, community, adminAudit
  } = ctx;

  route("GET", /^\/api\/admin\/community\/moderation$/, (req,res,m,q)=>{
    const did = +q.doctorId;
    const s=gate(req,res,did); if(!s)return;
    json(res,200,{ ok:true, items: community.listOpenModeration(did, q.limit) });
  });

  route("POST", /^\/api\/admin\/community\/moderation\/(\d+)\/resolve$/, async (req,res,m)=>{
    const mid = +m[1];
    const row = db.prepare("SELECT doctor_id FROM community_messages WHERE id=?").get(mid);
    const did = row ? row.doctor_id : null;
    const s=gate(req,res,did); if(!s)return;
    if(did==null) return json(res,404,{error:"报警消息不存在"});
    if(!requireAdminAction(req,res,s,"community.moderation.resolve",{doctorId:did},"无群风控处置权限")) return;
    const b = await parseBody(req);
    try{
      const r = await community.resolveModeration(mid, b.action, {
        actor:s.username, force:!!b.force, resolvedBy:s.username
      });
      adminAudit(req, s, {
        action:"community.moderation.resolve", resourceType:"community_message", resourceId:mid, doctorId:did,
        after:{ action:b.action, status:r.status, ok:r.ok },
        meta:{ force:!!b.force, error:r.error || "" }
      });
      json(res, r.ok ? 200 : 400, r);
    }catch(e){ json(res,400,{error:e.message}); }
  });
}

module.exports = { registerCommunityModerationRoutes };
