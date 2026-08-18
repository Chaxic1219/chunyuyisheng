"use strict";

/**
 * 运营台：群编号总览 + 运营策略（从 server.js 迁出）。
 */
function registerOpsDeskRoutes(route, ctx){
  const {
    parseBody, json, gate, requireAdminAction,
    db, now, cleanText,
    doctorRow, doctorContent, parseConfigJson, opsMod,
    ensureOpsAssets, knowledgeOut, outcomeOut,
    opsStrategyDefaults, opsMetricsHint
  } = ctx;

route("GET", /^\/api\/admin\/group-codes$/, (req,res,m,q)=>{
  const did = Number(q.doctorId);
  if(!Number.isInteger(did) || did <= 0) return json(res,400,{error:"doctorId 非法"});
  const s = gate(req,res,did); if(!s)return;
  const doctor = doctorRow(did);
  if(!doctor) return json(res,404,{error:"医生不存在"});
  let scripts = {};
  try{
    const row = opsMod.getScriptsJson(did);
    scripts = parseConfigJson((row && (row.published_json || row.draft_json)) || "{}", {});
  }catch(e){ scripts = {}; }
  const content = doctorContent(did);
  const homeShort = String((content.chunyuIntegration && content.chunyuIntegration.doctorHomeShortLink) || scripts.doctorHomeShortLink || "").trim();
  let templates = [];
  try{ templates = require("../qiwe.js").loadWeappTemplates(did) || []; }catch(e){ templates = []; }
  const tplByCode = new Map(templates.map(t=>[String(t.code), t]));
  const menuItems = ((content.menu && content.menu.items) || []).reduce((m,it)=>{
    if(it && it.code) m[String(it.code)] = String(it.label || "");
    return m;
  }, {});
  const rules = db.prepare("SELECT id,code,aliases,enabled,responses,sort FROM rules WHERE doctor_id=? ORDER BY sort,id").all(did);
  const rows = rules.map(r=>{
    let responses = [];
    try{ responses = JSON.parse(r.responses || "[]"); }catch(e){ responses = []; }
    const scriptKey = "code" + r.code;
    const scriptRaw = scripts[scriptKey];
    const scriptText = scriptRaw == null || scriptRaw === "-" ? "" : String(scriptRaw);
    let jumpType = "none";
    let shortLink = "";
    const hasMp = (Array.isArray(responses) ? responses : []).some(x=>{
      if(!x) return false;
      if(x.type === "mp") return true;
      if(x.external && (x.external.mode === "mini_program" || x.external.shortLink)) return true;
      return false;
    });
    const hasLink = (Array.isArray(responses) ? responses : []).some(x=>x && (x.type === "link" || (x.external && x.external.url)));
    const textBlob = (Array.isArray(responses) ? responses : []).filter(x=>x && x.type === "text").map(x=>String(x.text||"")).join("\n");
    if(hasMp){
      jumpType = "home_mp";
      const mp = responses.find(x=>x && (x.type === "mp" || (x.external && x.external.shortLink)));
      shortLink = String((mp && mp.external && mp.external.shortLink) || "").trim();
    }else if(hasLink){
      jumpType = "h5_link";
    }else if(/#小程序:\/\//.test(textBlob)){
      jumpType = "mp_text";
    }else if(scriptText || textBlob){
      jumpType = "text_only";
    }
    const tpl = tplByCode.get(String(r.code));
    let weappStatus = "na";
    if(jumpType === "home_mp"){
      weappStatus = tpl && tpl.ready ? "ready" : "pending_capture";
    }else if(tpl){
      weappStatus = tpl.ready ? "ready" : "pending_capture";
    }
    return {
      id: r.id,
      code: String(r.code),
      label: menuItems[String(r.code)] || String(r.code),
      enabled: !!r.enabled,
      scriptSummary: scriptText.slice(0, 80),
      jumpType,
      shortLink,
      weappStatus,
      weappMissing: tpl && tpl.missing ? tpl.missing : []
    };
  });
  json(res,200,{
    ok:true,
    doctor,
    doctorHomeShortLink: homeShort,
    rows
  });
});

route("GET", /^\/api\/admin\/ops-strategy$/, (req,res,m,q)=>{ const s=gate(req,res,+q.doctorId); if(!s)return;
  const did = +q.doctorId;
  if(!Number.isInteger(did)) return json(res,400,{error:"缺少 doctorId"});
  const doctor = ensureOpsAssets(did);
  if(!doctor) return json(res,404,{error:"医生不存在"});
  const strategy = db.prepare("SELECT * FROM ops_strategy WHERE doctor_id=?").get(did) || null;
  const getVec = db.prepare("SELECT content_hash, embedded_at FROM knowledge_vectors WHERE item_id=?");
  const knowledge = db.prepare(`SELECT * FROM knowledge_items WHERE doctor_id=?
    ORDER BY CASE layer WHEN '医院通用' THEN 1 WHEN '医院/科室通用' THEN 2 WHEN '医生个人' THEN 3 ELSE 4 END, id`).all(did)
    .map(k=>knowledgeOut(k, getVec.get(k.id)));
  const outcomes = db.prepare("SELECT * FROM outcome_reports WHERE doctor_id=? ORDER BY period DESC,id DESC LIMIT 24").all(did).map(outcomeOut);
  const summary = {
    knowledgeTotal: knowledge.length,
    knowledgeReady: knowledge.filter(x=>x.status==="ready").length,
    knowledgeDraft: knowledge.filter(x=>x.status==="draft").length,
    knowledgeEmbedded: knowledge.filter(x=>x.status==="ready" && x.embedded).length,
    knowledgeNeedsEmbed: knowledge.filter(x=>x.needsEmbed).length,
    embedServiceConfigured: !!process.env.DASHSCOPE_API_KEY,
    outcomeReports: outcomes.length,
    perceivedGrowthReports: outcomes.filter(x=>x.perceived_growth).length,
    latestOutcome: outcomes[0] || null,
    outcomeCurrentMonthMissing: !outcomes.some(x=>x.period === new Date().toISOString().slice(0, 7))
  };
  const rulesCount = db.prepare("SELECT COUNT(*) c FROM rules WHERE doctor_id=?").get(did).c || 0;
  const enabledRules = db.prepare("SELECT COUNT(*) c FROM rules WHERE doctor_id=? AND enabled=1").get(did).c || 0;
  const existingLayers = new Set(knowledge.map(k=>k.layer));
  const missingLayers = ["医院通用","医院/科室通用","医生个人","群运营动态"].filter(l=>!existingLayers.has(l));
  const configLink = {
    rulesCount:+rulesCount || 0,
    enabledRules:+enabledRules || 0,
    readyKnowledge: summary.knowledgeReady,
    needsEmbed: summary.knowledgeNeedsEmbed,
    missingLayers
  };
  json(res,200,{
    doctor,
    strategy,
    knowledge,
    outcomes,
    summary,
    defaults: opsStrategyDefaults(doctor),
    metricsHint: opsMetricsHint(did),
    configLink
  });
});

route("PUT", /^\/api\/admin\/ops-strategy$/, async (req,res)=>{
  const b = await parseBody(req);
  if(b.__oversize) return json(res,413,{error:"请求体过大（上限 1MB）"});
  const did = +b.doctorId;
  const s=gate(req,res,did); if(!s)return;
  if(!Number.isInteger(did)) return json(res,400,{error:"缺少 doctorId"});
  if(!requireAdminAction(req,res,s,"ops.strategy.manage",{doctorId:did},"无运营策略维护权限")) return;
  if(!ensureOpsAssets(did)) return json(res,404,{error:"医生不存在"});
  db.prepare(`INSERT INTO ops_strategy(doctor_id,group_mode,private_chat_policy,doctor_profile,specialty_fit,pharma_value,notes,updated_at)
    VALUES(?,?,?,?,?,?,?,?)
    ON CONFLICT(doctor_id) DO UPDATE SET group_mode=excluded.group_mode, private_chat_policy=excluded.private_chat_policy,
      doctor_profile=excluded.doctor_profile, specialty_fit=excluded.specialty_fit, pharma_value=excluded.pharma_value,
      notes=excluded.notes, updated_at=excluded.updated_at`).run(
      did,
      cleanText(b.group_mode, 2000),
      cleanText(b.private_chat_policy, 2000),
      cleanText(b.doctor_profile, 2000),
      cleanText(b.specialty_fit, 2000),
      cleanText(b.pharma_value, 2000),
      cleanText(b.notes, 2000),
      now()
    );
  json(res,200,{ ok:true });
});


}

module.exports = { registerOpsDeskRoutes };
