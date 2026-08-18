"use strict";

/**
 * 配置中心路由（ops 写路径由 modules/ops 自管）。
 */
function registerConfigCenterRoutes(route, ctx){
  const {
    parseBody, json, gate, requireAdminAction, now,
    doctorRow, canAdmin, configIsSuper,
    opsMod, configOut, configAccess, configAudit,
    ensureOpsConfig, parseConfigBody,
    applyDoctorGroupConfig, applyContactFormConfig,
    applyCodesCardsConfig, applyScriptsConfig
  } = ctx;

  route("GET", /^\/api\/admin\/config-center$/, (req,res,m,q)=>{
    const did = Number(q.doctorId);
    if(!Number.isInteger(did) || did <= 0) return json(res,400,{error:"doctorId 非法"});
    const s = gate(req,res,did); if(!s)return;
    if(!doctorRow(did)) return json(res,404,{error:"医生不存在"});
    const isSuper = configIsSuper(s);
    const domains = opsMod.CONFIG_DOMAIN_ORDER.filter(d=>{
      const meta = opsMod.configMeta(d);
      if(!meta) return false;
      if(meta.superOnly && !isSuper) return false;
      if(q.domain && q.domain !== d) return false;
      return true;
    }).map(d=>{
      const row = ensureOpsConfig(d, did);
      return configOut(row, did, isSuper || canAdmin(s, "config.draft", {doctorId:row.doctor_id || did}));
    });
    json(res,200,{ ok:true, doctor:doctorRow(did), domains, order:opsMod.CONFIG_DOMAIN_ORDER });
  });

  route("PUT", /^\/api\/admin\/config-center\/(\d+)\/draft$/, async (req,res,m)=>{
    const { row, s } = configAccess(req,res,+m[1],"config.draft"); if(!row)return;
    const b = await parseBody(req);
    if(b.__oversize) return json(res,413,{error:"请求体过大（上限 1MB）"});
    let cfg;
    try{ cfg = parseConfigBody(b); }catch(e){ return json(res,400,{error:e.message}); }
    const updatedAt = now();
    const saved = opsMod.saveDraft({ id:row.id, domain:row.domain, cfg, actor:s.username, updatedAt });
    if(!saved.ok) return json(res,400,{error:"配置校验失败", errors:saved.check.errors, warnings:saved.check.warnings});
    configAudit(row.id, row.doctor_id, row.domain, "draft", s.username, cfg, saved.check);
    json(res,200,{ ok:true, validation:saved.check, updatedAt, updatedBy:s.username });
  });

  route("POST", /^\/api\/admin\/config-center\/(\d+)\/preview$/, async (req,res,m)=>{
    const { row, s } = configAccess(req,res,+m[1],"config.draft"); if(!row)return;
    const b = await parseBody(req);
    if(b.__oversize) return json(res,413,{error:"请求体过大（上限 1MB）"});
    let cfg = opsMod.parseConfigJson(row.draft_json, {});
    if(b && (b.config || b.json)){
      try{ cfg = parseConfigBody(b); }catch(e){ return json(res,400,{error:e.message}); }
    }
    const check = opsMod.validateOpsConfig(row.domain, cfg);
    const impact = row.doctor_id === 0 ? "全局配置：发布后所有医生和患者群都会使用这版内容。"
      : "医生配置：发布后只有当前医生下的编号、话术或患者群会使用这版内容。";
    configAudit(row.id, row.doctor_id, row.domain, "preview", s.username, cfg, check);
    json(res,200,{ ok:check.ok, validation:check, impact, testResult:check.ok?"校验通过，可发布。":"校验未通过，不允许发布。" });
  });

  route("POST", /^\/api\/admin\/config-center\/(\d+)\/publish$/, async (req,res,m)=>{
    const { row, s } = configAccess(req,res,+m[1],"config.publish"); if(!row)return;
    const cfg = opsMod.parseConfigJson(row.draft_json, {});
    const check = opsMod.validateOpsConfig(row.domain, cfg);
    if(!check.ok) return json(res,400,{error:"配置校验失败，已阻止发布", errors:check.errors, warnings:check.warnings});
    const did = row.doctor_id || 0;
    if(row.domain === "doctor_group" && did > 0) applyDoctorGroupConfig(did, cfg);
    if(row.domain === "contact_form" && did > 0) applyContactFormConfig(did, cfg);
    if(row.domain === "codes_cards" && did > 0) applyCodesCardsConfig(did, cfg);
    if(row.domain === "scripts" && did > 0) applyScriptsConfig(did, cfg);
    const publishedAt = now();
    const r = opsMod.publish({ row, cfg, actor:s.username, publishedAt });
    if(!r.ok) return json(res,400,{error:"配置校验失败，已阻止发布", errors:r.check.errors, warnings:r.check.warnings});
    configAudit(row.id, row.doctor_id, row.domain, "publish", s.username, cfg, { ok:true, version:r.version });
    json(res,200,{ ok:true, version:r.version, validation:check, publishedAt, publishedBy:s.username });
  });

  route("POST", /^\/api\/admin\/config-center\/(\d+)\/rollback$/, async (req,res,m)=>{
    const { row, s } = configAccess(req,res,+m[1],"config.publish"); if(!row)return;
    const publishedAt = now();
    const r = opsMod.rollback({ row, actor:s.username, publishedAt });
    if(!r.ok) return json(res,400,{error:"历史版本校验失败，已阻止回滚", errors:r.check.errors});
    if(row.domain === "doctor_group" && row.doctor_id > 0) applyDoctorGroupConfig(row.doctor_id, r.cfg);
    if(row.domain === "contact_form" && row.doctor_id > 0) applyContactFormConfig(row.doctor_id, r.cfg);
    if(row.domain === "codes_cards" && row.doctor_id > 0) applyCodesCardsConfig(row.doctor_id, r.cfg);
    if(row.domain === "scripts" && row.doctor_id > 0) applyScriptsConfig(row.doctor_id, r.cfg);
    configAudit(row.id, row.doctor_id, row.domain, "rollback", s.username, r.cfg, {
      ok:true, version:r.version, source:r.prev?"previous_publish":"current_published"
    });
    json(res,200,{ ok:true, version:r.version, restoredPrevious:!!r.prev, publishedAt, publishedBy:s.username });
  });

  route("GET", /^\/api\/admin\/config-center\/audit$/, (req,res,m,q)=>{
    const did = Number(q.doctorId);
    if(!Number.isInteger(did) || did <= 0) return json(res,400,{error:"doctorId 非法"});
    const s = gate(req,res,did); if(!s)return;
    const isSuper = configIsSuper(s);
    const rows = opsMod.listAuditRows(did, 80)
      .filter(r=>isSuper || (r.doctor_id !== 0 && !(opsMod.configMeta(r.domain)||{}).superOnly))
      .map(r=>({ id:r.id, configId:r.config_id, doctorId:r.doctor_id, domain:r.domain, title:(opsMod.configMeta(r.domain)||{}).title||r.domain,
        action:r.action, actor:r.actor, result:opsMod.parseConfigJson(r.result_json, {}), createdAt:r.created_at }));
    json(res,200,{ ok:true, rows });
  });
}

module.exports = { registerConfigCenterRoutes };
