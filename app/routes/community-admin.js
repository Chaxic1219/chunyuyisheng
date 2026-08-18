"use strict";

/**
 * 社群管理后台路由（从 server.js 迁出）。
 */
function registerCommunityAdminRoutes(route, ctx){
  const {
    parseBody, json, gate, rowDoctorId, requireAdminAction,
    db, community, adminScope, isSuperSession, allowDoctor, maskPII
  } = ctx;

  route("GET", /^\/api\/admin\/community$/, (req,res,m,q)=>{ const s=gate(req,res,+q.doctorId); if(!s)return;
    try{
      const adminCtx = { adminId: s.adminId, scope: adminScope(s) };
      json(res,200, community.overview(+q.doctorId, adminCtx));
    }
    catch(e){ json(res,400,{error:e.message}); }
  });

  route("POST", /^\/api\/admin\/community\/qiwe\/sync$/, async (req,res)=>{
    const b = await parseBody(req);
    if(b.__oversize) return json(res,413,{error:"请求体过大（上限 1MB）"});
    const did = Number(b.doctorId);
    const s=gate(req,res,did); if(!s)return;
    if(!requireAdminAction(req,res,s,"community.group.manage",{doctorId:did},"无社群配置维护权限")) return;
    const light = b.light === true || b.light === 1 || b.light === "1" || b.light === "true";
    try{ json(res,200,await require("../qiwe_sync.js").syncGroups({ doctorId:did, light })); }
    catch(e){ json(res,400,{error:e.message}); }
  });

  route("GET", /^\/api\/admin\/community\/contacts$/, (req,res,m,q)=>{
    const did = +q.doctorId;
    const s=gate(req,res,did); if(!s)return;
    const scopeAll = String(q.scope || "doctor").toLowerCase() === "all";
    let doctorIds;
    if(scopeAll){
      const sc = adminScope(s);
      doctorIds = sc === null ? null : [...sc];
    }else{
      doctorIds = [did];
    }
    try{ json(res,200, community.listContacts({ doctorIds })); }
    catch(e){ json(res,400,{error:e.message}); }
  });

  route("POST", /^\/api\/admin\/community\/groups$/, async (req,res)=>{
    const b = await parseBody(req);
    if(b.__oversize) return json(res,413,{error:"请求体过大（上限 1MB）"});
    const s=gate(req,res,+b.doctorId); if(!s)return;
    if(!requireAdminAction(req,res,s,"community.group.manage",{doctorId:+b.doctorId},"无社群配置维护权限")) return;
    try{
      const createOnQiwe = b.createOnQiwe === true || b.createOnQiwe === 1 || b.createOnQiwe === "1" || b.createOnQiwe === "true";
      if(createOnQiwe){
        const out = await community.createGroupOnQiwe(b);
        return json(res,200, out);
      }
      json(res,200,{ ok:true, group:community.createGroup(b) });
    }
    catch(e){ json(res,400,{error:e.message}); }
  });

  route("PUT", /^\/api\/admin\/community\/groups\/(\d+)$/, async (req,res,m)=>{
    const did = rowDoctorId("community_groups", +m[1]);
    const s=gate(req,res,did); if(!s)return;
    if(did==null) return json(res,404,{error:"群配置不存在"});
    const b = await parseBody(req);
    if(b.__oversize) return json(res,413,{error:"请求体过大（上限 1MB）"});
    if(!requireAdminAction(req,res,s,"community.group.manage",{doctorId:did},"无社群配置维护权限")) return;
    try{
      const out = await community.updateGroup(+m[1], b);
      json(res,200,{ ok:true, group:out.group, qiweRename:out.qiweRename || null });
    }
    catch(e){ json(res,400,{error:e.message}); }
  });

  route("GET", /^\/api\/admin\/community\/groups\/(\d+)\/doctors$/, (req,res,m)=>{
    const gid = +m[1];
    const g = db.prepare("SELECT * FROM community_groups WHERE id=?").get(gid);
    if(!g) return json(res,404,{error:"群配置不存在"});
    const s=gate(req,res,g.doctor_id); if(!s)return;
    const cgd = require("../community_group_doctors.js");
    const adminCtx = { adminId: s.adminId, scope: adminScope(s) };
    if(!cgd.canAdminSeeGroup(adminCtx, gid)) return json(res,403,{error:"无权查看该群"});
    json(res,200,{
      ok:true,
      groupId: gid,
      primaryDoctorId: cgd.resolvePrimaryDoctorId(gid),
      shareVisibleToCollab: g.share_visible_to_collab == null ? true : !!g.share_visible_to_collab,
      doctors: cgd.listGroupDoctors(gid)
    });
  });

  route("PUT", /^\/api\/admin\/community\/groups\/(\d+)\/doctors$/, async (req,res,m)=>{
    const gid = +m[1];
    const g = db.prepare("SELECT * FROM community_groups WHERE id=?").get(gid);
    if(!g) return json(res,404,{error:"群配置不存在"});
    const primaryId = require("../community_group_doctors.js").resolvePrimaryDoctorId(gid) || g.doctor_id;
    const s=gate(req,res,primaryId); if(!s)return;
    if(!isSuperSession(s) && !allowDoctor(s, primaryId)){
      return json(res,403,{error:"仅主诊医助或超级管理员可修改群协作医生"});
    }
    if(!requireAdminAction(req,res,s,"community.group.manage",{doctorId:primaryId},"无社群配置维护权限")) return;
    const b = await parseBody(req);
    if(b.__oversize) return json(res,413,{error:"请求体过大（上限 1MB）"});
    try{
      const cgd = require("../community_group_doctors.js");
      const doctors = cgd.setGroupDoctors(gid, {
        primaryDoctorId: +b.primaryDoctorId,
        collaboratorIds: b.collaboratorIds || [],
        shareVisibleToCollab: b.shareVisibleToCollab
      });
      json(res,200,{ ok:true, doctors });
    }catch(e){ json(res,400,{error:e.message}); }
  });

  route("GET", /^\/api\/admin\/community\/groups\/suggest-name$/, (req,res,m,q)=>{
    const did = +q.doctorId;
    const s=gate(req,res,did); if(!s)return;
    try{ json(res,200,{ ok:true, ...community.suggestGroupName(did) }); }
    catch(e){ json(res,400,{error:e.message}); }
  });

  route("GET", /^\/api\/admin\/reminders$/, (req,res,m,q)=>{
    const did = +q.doctorId;
    const s=gate(req,res,did); if(!s)return;
    const rem = community.reminders(did);
    rem.items = (rem.items || []).map(it=>({ ...it, summary: maskPII(it.summary || "") }));
    json(res,200, rem);
  });

  route("POST", /^\/api\/admin\/community\/inbound$/, async (req,res)=>{
    const b = await parseBody(req);
    if(b.__oversize) return json(res,413,{error:"请求体过大（上限 1MB）"});
    const did = community.resolveDoctorId(b);
    if(!Number.isInteger(did)) return json(res,400,{error:"缺少有效医生（doctorId 或 doctorSlug）"});
    const s=gate(req,res,did); if(!s)return;
    if(!requireAdminAction(req,res,s,"community.inbound.simulate",{doctorId:did},"无社群模拟入站权限")) return;
    try{ json(res,200, await community.handleInbound({ ...b, dataSource:"simulation" })); }
    catch(e){ json(res,400,{error:e.message}); }
  });

  route("POST", /^\/api\/admin\/community\/campaigns\/weekly$/, async (req,res)=>{
    const b = await parseBody(req);
    if(b.__oversize) return json(res,413,{error:"请求体过大（上限 1MB）"});
    const did = community.resolveDoctorId(b);
    if(!Number.isInteger(did)) return json(res,400,{error:"缺少有效医生（doctorId 或 doctorSlug）"});
    const s=gate(req,res,did); if(!s)return;
    if(!requireAdminAction(req,res,s,"community.campaign.create",{doctorId:did},"无社群运营草稿生成权限")) return;
    try{ json(res,200,{ ok:true, outbox:community.createWeeklyCampaign(b) }); }
    catch(e){ json(res,400,{error:e.message}); }
  });

  route("POST", /^\/api\/admin\/community\/campaigns\/ops-candidate$/, async (req,res)=>{
    const b = await parseBody(req);
    if(b.__oversize) return json(res,413,{error:"请求体过大（上限 1MB）"});
    const did = community.resolveDoctorId(b);
    if(!Number.isInteger(did)) return json(res,400,{error:"缺少有效医生（doctorId 或 doctorSlug）"});
    const s=gate(req,res,did); if(!s)return;
    if(!requireAdminAction(req,res,s,"ops.candidate_generate",{doctorId:did},"无运营候选生成权限")) return;
    try{ json(res,200,{ ok:true, outbox:community.createOpsContentCandidate({ ...b, username:s.username }) }); }
    catch(e){ json(res,400,{error:e.message}); }
  });

  const science = community.scienceReminders;

  route("GET", /^\/api\/admin\/science-reminders$/, (req,res,m,q)=>{
    const did = +q.doctorId;
    const s=gate(req,res,did); if(!s)return;
    try{ json(res,200,{ ok:true, ...science.pageBundle(did) }); }
    catch(e){ json(res,400,{error:e.message}); }
  });

  route("POST", /^\/api\/admin\/science-reminders\/plans$/, async (req,res)=>{
    const b = await parseBody(req);
    if(b.__oversize) return json(res,413,{error:"请求体过大（上限 1MB）"});
    const did = community.resolveDoctorId(b);
    if(!Number.isInteger(did)) return json(res,400,{error:"缺少有效医生（doctorId 或 doctorSlug）"});
    const s=gate(req,res,did); if(!s)return;
    if(!requireAdminAction(req,res,s,"community.campaign.create",{doctorId:did},"无科普提醒计划权限")) return;
    try{ json(res,200,{ ok:true, plan:science.createPlan(b) }); }
    catch(e){ json(res,400,{error:e.message}); }
  });

  route("PUT", /^\/api\/admin\/science-reminders\/plans\/(\d+)$/, async (req,res,m)=>{
    const plan = science.getPlan(+m[1]);
    if(!plan) return json(res,404,{error:"计划不存在"});
    const s=gate(req,res,plan.doctorId); if(!s)return;
    if(!requireAdminAction(req,res,s,"community.campaign.create",{doctorId:plan.doctorId},"无科普提醒计划权限")) return;
    const b = await parseBody(req);
    if(b.__oversize) return json(res,413,{error:"请求体过大（上限 1MB）"});
    try{ json(res,200,{ ok:true, plan:science.updatePlan(+m[1], b) }); }
    catch(e){ json(res,400,{error:e.message}); }
  });

  route("DELETE", /^\/api\/admin\/science-reminders\/plans\/(\d+)$/, (req,res,m)=>{
    const plan = science.getPlan(+m[1]);
    if(!plan) return json(res,404,{error:"计划不存在"});
    const s=gate(req,res,plan.doctorId); if(!s)return;
    if(!requireAdminAction(req,res,s,"community.campaign.create",{doctorId:plan.doctorId},"无科普提醒计划权限")) return;
    try{ json(res,200, science.deletePlan(+m[1])); }
    catch(e){ json(res,400,{error:e.message}); }
  });

  route("POST", /^\/api\/admin\/science-reminders\/run$/, async (req,res)=>{
    const b = await parseBody(req);
    if(b.__oversize) return json(res,413,{error:"请求体过大（上限 1MB）"});
    const plan = b.planId != null ? science.getPlan(+b.planId) : null;
    const did = plan ? plan.doctorId : community.resolveDoctorId(b);
    if(!Number.isInteger(did)) return json(res,400,{error:"缺少有效医生或计划"});
    const s=gate(req,res,did); if(!s)return;
    if(!requireAdminAction(req,res,s,"community.campaign.create",{doctorId:did},"无科普提醒执行权限")) return;
    try{
      const generated = await science.runScienceReminderTick(new Date(), {
        force: true,
        planId: b.planId != null ? +b.planId : null,
        username: s.username
      });
      json(res,200,{ ok:true, generated });
    }catch(e){ json(res,400,{error:e.message}); }
  });

  route("POST", /^\/api\/admin\/science-reminders\/ai-draft$/, async (req,res)=>{
    const b = await parseBody(req);
    if(b.__oversize) return json(res,413,{error:"请求体过大（上限 1MB）"});
    const did = community.resolveDoctorId(b);
    if(!Number.isInteger(did)) return json(res,400,{error:"缺少有效医生（doctorId 或 doctorSlug）"});
    const s=gate(req,res,did); if(!s)return;
    if(!requireAdminAction(req,res,s,"community.campaign.create",{doctorId:did},"无科普文案生成权限")) return;
    try{
      const out = await science.generateAiScienceDraft({ ...b, username:s.username });
      json(res,200,{ ok:true, ...out });
    }catch(e){ json(res,400,{error:e.message}); }
  });
}

module.exports = { registerCommunityAdminRoutes };
