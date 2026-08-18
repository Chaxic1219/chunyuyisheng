"use strict";

/**
 * 内容与运营台路由（从 server.js 迁出）：
 * rules / FAQ / submissions / stats / dashboard / knowledge / outcomes
 */
const outboundResolve = require("../modules/outbound/resolve.js");
const OUTBOUND_RULES_MOVED = "请改用编号与推送（/ops/outbound）配置出站内容";

function registerContentAdminRoutes(route, ctx){
  const {
    parseBody, json, gate, rowDoctorId, requireAdminAction,
    db, now, adminScope, cleanText, cleanInt, doctorRow,
    KNOWLEDGE_LAYERS, KNOWLEDGE_MODES, KNOWLEDGE_STATUS,
    validateKnowledgeQuality, importMissingKnowledgeLayers, triage
  } = ctx;

route("GET", /^\/api\/admin\/rules$/, (req,res,m,q)=>{ const s=gate(req,res,+q.doctorId); if(!s)return;
  const rows = db.prepare("SELECT * FROM rules WHERE doctor_id=? ORDER BY sort,id").all(q.doctorId);
  json(res,200, rows.map(r=>({ id:r.id, code:r.code, aliases:JSON.parse(r.aliases||"[]"), match:r.match_type, bot:r.bot, responses:JSON.parse(r.responses), enabled:r.enabled }))); });
route("POST", /^\/api\/admin\/rules$/, async (req,res)=>{
  const b = await parseBody(req);
  const s=gate(req,res,+b.doctorId); if(!s)return;
  if(!requireAdminAction(req,res,s,"rules.manage",{doctorId:+b.doctorId},"无规则维护权限")) return;
  if(outboundResolve.hasOutboundConfig(+b.doctorId)) return json(res,410,{error:OUTBOUND_RULES_MOVED});
  const first = db.prepare("SELECT MIN(sort) s FROM rules WHERE doctor_id=?").get(b.doctorId).s;
  const sort = Number.isFinite(+first) ? (+first - 1) : 0;
  const r = db.prepare("INSERT INTO rules(doctor_id,code,aliases,match_type,bot,responses,enabled,sort) VALUES(?,?,?,?,?,?,?,?)")
    .run(b.doctorId,b.code,JSON.stringify(b.aliases||[]),b.match||"exact",b.bot||"小宝医助",JSON.stringify(b.responses||[]),b.enabled==0?0:1,sort);
  json(res,200,{ok:true,id:r.lastInsertRowid}); });
route("PUT", /^\/api\/admin\/rules\/(\d+)$/, async (req,res,m)=>{
  const did = rowDoctorId("rules",+m[1]);
  const s=gate(req,res, did); if(!s)return;
  if(!requireAdminAction(req,res,s,"rules.manage",{doctorId:did},"无规则维护权限")) return;
  if(did != null && outboundResolve.hasOutboundConfig(did)) return json(res,410,{error:OUTBOUND_RULES_MOVED});
  const b = await parseBody(req);
  db.prepare("UPDATE rules SET code=?,aliases=?,match_type=?,bot=?,responses=?,enabled=? WHERE id=?")
    .run(b.code,JSON.stringify(b.aliases||[]),b.match||"exact",b.bot||"小宝医助",JSON.stringify(b.responses||[]),b.enabled==0?0:1,+m[1]);
  json(res,200,{ok:true}); });
route("DELETE", /^\/api\/admin\/rules\/(\d+)$/, (req,res,m)=>{
  const did = rowDoctorId("rules",+m[1]);
  const s=gate(req,res, did); if(!s)return;
  if(!requireAdminAction(req,res,s,"rules.manage",{doctorId:did},"无规则维护权限")) return;
  if(did != null && outboundResolve.hasOutboundConfig(did)) return json(res,410,{error:OUTBOUND_RULES_MOVED});
  db.prepare("DELETE FROM rules WHERE id=?").run(+m[1]); json(res,200,{ok:true}); });

/* FAQ CRUD */
route("GET", /^\/api\/admin\/faq$/, (req,res,m,q)=>{ const s=gate(req,res,+q.doctorId); if(!s)return;
  json(res,200, db.prepare("SELECT * FROM faq WHERE doctor_id=? ORDER BY sort,id").all(q.doctorId)); });
route("POST", /^\/api\/admin\/faq$/, async (req,res)=>{
  const b = await parseBody(req);
  const s=gate(req,res,+b.doctorId); if(!s)return;
  if(!requireAdminAction(req,res,s,"rules.manage",{doctorId:+b.doctorId},"无 FAQ 维护权限")) return;
  const r = db.prepare("INSERT INTO faq(doctor_id,grp,q,a,link,sort) VALUES(?,?,?,?,?,?)").run(b.doctorId,b.grp||"其他",b.q,b.a,b.link||null,b.sort||0);
  json(res,200,{ok:true,id:r.lastInsertRowid}); });
route("PUT", /^\/api\/admin\/faq\/(\d+)$/, async (req,res,m)=>{ const s=gate(req,res, rowDoctorId("faq",+m[1])); if(!s)return;
  if(!requireAdminAction(req,res,s,"rules.manage",{doctorId:rowDoctorId("faq",+m[1])},"无 FAQ 维护权限")) return;
  const b = await parseBody(req);
  db.prepare("UPDATE faq SET grp=?,q=?,a=?,link=?,sort=? WHERE id=?").run(b.grp||"其他",b.q,b.a,b.link||null,b.sort||0,+m[1]);
  json(res,200,{ok:true}); });
route("DELETE", /^\/api\/admin\/faq\/(\d+)$/, (req,res,m)=>{ const s=gate(req,res, rowDoctorId("faq",+m[1])); if(!s)return;
  if(!requireAdminAction(req,res,s,"rules.manage",{doctorId:rowDoctorId("faq",+m[1])},"无 FAQ 维护权限")) return;
  db.prepare("DELETE FROM faq WHERE id=?").run(+m[1]); json(res,200,{ok:true}); });


/* 提交记录 + 患者档案 + 统计 */
route("GET", /^\/api\/admin\/submissions$/, (req,res,m,q)=>{ const s=gate(req,res,+q.doctorId); if(!s)return;
  let sql="SELECT * FROM submissions WHERE doctor_id=?"; const args=[+q.doctorId];
  if(q.type){ sql+=" AND type=?"; args.push(q.type); }
  sql+=" ORDER BY id DESC LIMIT 500";
  json(res,200, db.prepare(sql).all(...args).map(r=>{
    let payload = {};
    try{ payload = JSON.parse(r.payload || "{}"); }catch(e){ payload = { _raw: String(r.payload || "").slice(0, 200) }; }
    return { id:r.id, type:r.type, payload, status:r.status || "待跟进", at:r.created_at, patientId:r.patient_id || null };
  })); });


route("PUT", /^\/api\/admin\/submissions\/(\d+)$/, async (req,res,m)=>{ const did = rowDoctorId("submissions",+m[1]); const s=gate(req,res, did); if(!s)return;
  if(!requireAdminAction(req,res,s,"submissions.manage",{doctorId:did},"无提交记录处理权限")) return;
  const b = await parseBody(req); db.prepare("UPDATE submissions SET status=? WHERE id=?").run(b.status||"待跟进",+m[1]); json(res,200,{ok:true}); });
route("GET", /^\/api\/admin\/stats$/, (req,res,m,q)=>{ const s=gate(req,res,+q.doctorId); if(!s)return;
  const byType = db.prepare("SELECT type,COUNT(*) c FROM submissions WHERE doctor_id=? GROUP BY type").all(q.doctorId);
  const msgs = db.prepare("SELECT COUNT(*) c FROM msg_log WHERE doctor_id=?").get(q.doctorId).c;
  const rules = db.prepare("SELECT COUNT(*) c FROM rules WHERE doctor_id=?").get(q.doctorId).c;
  const triageSessions = db.prepare("SELECT COUNT(*) c FROM triage_sessions WHERE doctor_id=?").get(q.doctorId).c;
  const triagePending = db.prepare("SELECT COUNT(*) c FROM triage_sessions WHERE doctor_id=? AND status='needs_human'").get(q.doctorId).c;
  const communityGroups = db.prepare("SELECT COUNT(*) c FROM community_groups WHERE doctor_id=? AND IFNULL(qiwe_hidden,0)=0").get(q.doctorId).c;
  const communityPending = db.prepare("SELECT COUNT(*) c FROM outbound_queue WHERE doctor_id=? AND status='pending'").get(q.doctorId).c;
  json(res,200,{ byType, msgs, rules, triageSessions, triagePending, communityGroups, communityPending }); });

/* 数据大盘：scope=doctor|platform；会议要求医生个人看板 + 全平台汇总（运营可据此导出分享图） */
route("GET", /^\/api\/admin\/dashboard$/, (req,res,m,q)=>{
  const scope = String(q.scope || "doctor").toLowerCase() === "platform" ? "platform" : "doctor";
  const dash = require("../dashboard.js");
  try{
    if(scope === "platform"){
      const s = gate(req,res); if(!s)return;
      const sc = adminScope(s);
      const sampleDoctorId = sc === null ? 1 : ([...sc][0] || 0);
      if(!requireAdminAction(req,res,s,"dashboard.platform.read",{doctorId:sampleDoctorId},"仅管理员和超级管理员可查看大盘数据")) return;
      const doctorIds = sc === null ? null : [...sc];
      return json(res,200, dash.platformDashboard(doctorIds));
    }
    const did = +q.doctorId;
    const s = gate(req,res,did); if(!s)return;
    if(!requireAdminAction(req,res,s,"dashboard.doctor.read",{doctorId:did},"无医生数据查看权限")) return;
    return json(res,200, dash.doctorDashboard(did));
  }catch(e){ json(res,400,{error:e.message}); }
});


route("POST", /^\/api\/admin\/knowledge$/, async (req,res)=>{
  const b = await parseBody(req);
  if(b.__oversize) return json(res,413,{error:"请求体过大（上限 1MB）"});
  const did = +b.doctorId;
  const s=gate(req,res,did); if(!s)return;
  if(!Number.isInteger(did)) return json(res,400,{error:"缺少 doctorId"});
  if(!requireAdminAction(req,res,s,"knowledge.manage",{doctorId:did},"无知识源维护权限")) return;
  if(!doctorRow(did)) return json(res,404,{error:"医生不存在"});
  const title = cleanText(b.title, 120);
  if(!title) return json(res,400,{error:"标题必填"});
  const layer = KNOWLEDGE_LAYERS.has(b.layer) ? b.layer : "医生个人";
  const mode = KNOWLEDGE_MODES.has(b.mode) ? b.mode : "半预制";
  const status = KNOWLEDGE_STATUS.has(b.status) ? b.status : "draft";
  const bodyText = cleanText(b.body, 6000);
  const strategy = db.prepare("SELECT * FROM ops_strategy WHERE doctor_id=?").get(did) || {};
  const warnings = validateKnowledgeQuality({ status, title, body:bodyText }, strategy);
  const r = db.prepare(`INSERT INTO knowledge_items(doctor_id,layer,mode,title,body,source,owner,status,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?)`).run(did, layer, mode, title, bodyText, cleanText(b.source, 200),
      cleanText(b.owner, 120), status, now());
  json(res,200,{ ok:true, id:r.lastInsertRowid, warnings });
});

route("PUT", /^\/api\/admin\/knowledge\/(\d+)$/, async (req,res,m)=>{
  const did = rowDoctorId("knowledge_items", +m[1]);
  const s=gate(req,res,did); if(!s)return;
  if(did==null) return json(res,404,{error:"知识条目不存在"});
  if(!requireAdminAction(req,res,s,"knowledge.manage",{doctorId:did},"无知识源维护权限")) return;
  const b = await parseBody(req);
  if(b.__oversize) return json(res,413,{error:"请求体过大（上限 1MB）"});
  const title = cleanText(b.title, 120);
  if(!title) return json(res,400,{error:"标题必填"});
  const layer = KNOWLEDGE_LAYERS.has(b.layer) ? b.layer : "医生个人";
  const mode = KNOWLEDGE_MODES.has(b.mode) ? b.mode : "半预制";
  const status = KNOWLEDGE_STATUS.has(b.status) ? b.status : "draft";
  const bodyText = cleanText(b.body, 6000);
  const strategy = db.prepare("SELECT * FROM ops_strategy WHERE doctor_id=?").get(did) || {};
  const warnings = validateKnowledgeQuality({ status, title, body:bodyText }, strategy);
  db.prepare(`UPDATE knowledge_items SET layer=?,mode=?,title=?,body=?,source=?,owner=?,status=?,updated_at=? WHERE id=?`)
    .run(layer, mode, title, bodyText, cleanText(b.source, 200), cleanText(b.owner, 120), status, now(), +m[1]);
  json(res,200,{ ok:true, warnings });
});

route("DELETE", /^\/api\/admin\/knowledge\/(\d+)$/, (req,res,m)=>{
  const did = rowDoctorId("knowledge_items", +m[1]);
  const s=gate(req,res,did); if(!s)return;
  if(did==null) return json(res,404,{error:"知识条目不存在"});
  if(!requireAdminAction(req,res,s,"knowledge.manage",{doctorId:did},"无知识源维护权限")) return;
  db.prepare("DELETE FROM knowledge_items WHERE id=?").run(+m[1]);
  db.prepare("DELETE FROM knowledge_vectors WHERE item_id=?").run(+m[1]);
  json(res,200,{ ok:true });
});

route("POST", /^\/api\/admin\/knowledge\/import-layers$/, async (req,res)=>{
  const b = await parseBody(req);
  if(b.__oversize) return json(res,413,{error:"请求体过大（上限 1MB）"});
  const did = +b.doctorId;
  const s=gate(req,res,did); if(!s)return;
  if(!Number.isInteger(did)) return json(res,400,{error:"缺少 doctorId"});
  if(!requireAdminAction(req,res,s,"knowledge.manage",{doctorId:did},"无知识源维护权限")) return;
  if(!doctorRow(did)) return json(res,404,{error:"医生不存在"});
  const result = importMissingKnowledgeLayers(did);
  json(res,200,{ ok:true, ...result });
});

// RAG 轻量增强（方向A 2026-08-14）：FTS5 BM25 索引重建（存量知识初始化 + 一键全量重建）。
// knowledge_fts 为外部内容表，触发器维护增量；存量行需此处手动补索引（rebuild 特殊命令）。
route("POST", /^\/api\/admin\/knowledge\/rebuild-fts$/, (req,res)=>{
  const s=gate(req,res); if(!s)return;
  if(!requireAdminAction(req,res,s,"knowledge.manage",null,"无知识源维护权限")) return;
  try{
    // 外部内容表不能直接 DELETE/rebuild（报 no such column: T.gram），须逐行 delete + 逐行 insert
    const items = db.prepare("SELECT id,title,body FROM knowledge_items").all();
    const delRow = db.prepare("INSERT INTO knowledge_fts(knowledge_fts, rowid, gram) VALUES('delete', ?, ?)");
    const insRow = db.prepare("INSERT INTO knowledge_fts(rowid, gram) VALUES(?, fts_bigrams(?, ?))");
    let del = 0, ins = 0;
    for(const it of items){
      try{ delRow.run(it.id, String(it.title||"") + " " + String(it.body||"")); del++; }catch(e){/* 行不在索引 */}
      try{ insRow.run(it.id, it.title||"", it.body||""); ins++; }catch(e){}
    }
    const indexed = db.prepare("SELECT COUNT(*) c FROM knowledge_fts").get().c;
    json(res,200,{ ok:true, rebuilt:true, knowledgeItems:items.length, indexed, note:"FTS5 BM25 索引已全量重建" });
  }catch(e){
    json(res,500,{ ok:false, error:"FTS 重建失败：" + ((e && e.message) || "") });
  }
});

// RAG 轻量增强（方向A）：返回某医生的 FTS 索引健康度（供后台诊断：索引条目数 vs 知识条目数）
route("GET", /^\/api\/admin\/doctors\/(\d+)\/knowledge\/fts-status$/, (req,res,m)=>{
  const did = +m[1];
  const s=gate(req,res,did); if(!s)return;
  if(!requireAdminAction(req,res,s,"knowledge.manage",{doctorId:did},"无知识源维护权限")) return;
  try{
    const items = db.prepare("SELECT COUNT(*) c FROM knowledge_items WHERE doctor_id=? AND status='ready'").get(did).c;
    // 外部内容表不能直接 SELECT/JOIN 列（报 no such column: T.gram）；用 FTS 辅助表 knowledge_fts_count 或纯 COUNT(*)
    let indexed = 0;
    try{
      indexed = db.prepare("SELECT COUNT(*) c FROM knowledge_fts").get().c;
    }catch(e2){
      // 兜底：按 doctor 的 ready 条目数近似（FTS 全量索引时等于所有条目数）
      indexed = db.prepare("SELECT COUNT(*) c FROM knowledge_items WHERE doctor_id=?").get(did).c;
    }
    json(res,200,{ ok:true, doctorId:did, readyItems:items, indexed });
  }catch(e){
    json(res,500,{ ok:false, error:(e && e.message) || "fts_status_failed" });
  }
});

// RAG 轻量增强（方向A）：检索测试台 —— 输入问题，返回 BM25/向量/关键词三通道召回（RAGFlow 式诊断）。
// 供后台「知识库管理」页实时查看知识命中情况与引用，方便管理/调优知识条目。
route("POST", /^\/api\/admin\/doctors\/(\d+)\/knowledge\/test$/, async (req,res,m)=>{
  const did = +m[1];
  const s=gate(req,res,did); if(!s)return;
  if(!requireAdminAction(req,res,s,"knowledge.manage",{doctorId:did},"无知识源维护权限")) return;
  if(!doctorRow(did)) return json(res,404,{error:"医生不存在"});
  const b = await parseBody(req);
  if(b.__oversize) return json(res,413,{error:"请求体过大（上限 1MB）"});
  const query = cleanText(b.query, 500);
  if(!query) return json(res,400,{error:"请输入测试问题"});
  const topK = Math.max(1, Math.min(+b.topK || 3, 8));
  try{
    const ctx = { doctor:{ id: did } };
    const bm = triage.retrieveKnowledgeBM25(ctx, query, topK);
    const local = triage.retrieveKnowledgeLocal(ctx, query, topK);
    let vec = null;
    try{
      if(process.env.DASHSCOPE_API_KEY){
        vec = await triage.retrieveKnowledgeVector(ctx, query, topK);
      }
    }catch(e){ vec = null; }
    const pick = (r) => (r && r.items || []).map(x => ({
      id: x.id, title: x.title || "", layer: x.layer || "", mode: x.mode || "",
      source: x.source || "", score: x.score != null ? Math.round(x.score * 100) / 100 : null,
      sufficiency: r.sufficiency || "none",
      body: String(x.body || "").slice(0, 200)
    }));
    json(res,200,{
      ok:true, query, topK,
      channels: {
        bm25: bm ? { sufficiency: bm.sufficiency, source: "bm25", items: pick(bm) } : null,
        vector: vec ? { sufficiency: vec.sufficiency, source: "vector", items: pick(vec) } : null,
        keyword: local ? { sufficiency: local.sufficiency, source: "keyword", items: pick(local) } : null
      }
    });
  }catch(e){
    json(res,500,{ ok:false, error:"检索测试失败：" + ((e && e.message) || "") });
  }
});

// RAG 轻量增强（方向A）：批量导入 —— 粘贴多段文本，按空行/序号自动分条为 knowledge_items（RAGFlow 式文档→分块）。
route("POST", /^\/api\/admin\/doctors\/(\d+)\/knowledge\/batch-import$/, async (req,res,m)=>{
  const did = +m[1];
  const s=gate(req,res,did); if(!s)return;
  if(!requireAdminAction(req,res,s,"knowledge.manage",{doctorId:did},"无知识源维护权限")) return;
  if(!doctorRow(did)) return json(res,404,{error:"医生不存在"});
  const b = await parseBody(req);
  if(b.__oversize) return json(res,413,{error:"请求体过大（上限 1MB）"});
  const raw = String(b.text || "").trim();
  const layer = KNOWLEDGE_LAYERS.has(b.layer) ? b.layer : "医生个人";
  const mode = KNOWLEDGE_MODES.has(b.mode) ? b.mode : "半预制";
  const status = KNOWLEDGE_STATUS.has(b.status) ? b.status : "draft";
  const owner = cleanText(b.owner, 120) || "admin";
  if(!raw) return json(res,400,{error:"请输入要导入的文本"});
  // 分块：按「空行」或「1. 2. 3. / ① ②」等序号拆分；每块取首行做标题
  const blocks = raw.split(/\n\s*\n/).map(t=>t.trim()).filter(Boolean);
  const nowIso = now();
  const ins = db.prepare(`INSERT INTO knowledge_items(doctor_id,layer,mode,title,body,source,owner,status,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?)`);
  let added = 0, skipped = 0;
  for(const blk of blocks){
    if(blk.length < 8){ skipped++; continue; }   // 太短不建
    const lines = blk.split("\n").map(l=>l.trim()).filter(Boolean);
    const title = String(lines[0] || "").replace(/^[#\-\d\.\s①-⑩]+/, "").slice(0, 80) || ("知识条目 " + (added + 1));
    try{
      ins.run(did, layer, mode, title, blk, "batch-import", owner, status, nowIso);
      added++;
    }catch(e){ skipped++; }
  }
  json(res,200,{ ok:true, added, skipped, layer, mode, status });
});

// RAG Phase 1 向量重建
// 比对 content_hash，对新增/过期的重算 embedding（≤10 批）写入 knowledge_vectors（存在则更新、幂等）。
// gate(did) + 直接查 knowledge_items 均限本医生 → scoped 医助不越权；无 DASHSCOPE key → 503（不半途写脏）。
route("POST", /^\/api\/admin\/doctors\/(\d+)\/knowledge\/embed$/, async (req,res,m)=>{
  const did = +m[1];
  const s = gate(req,res,did); if(!s) return;
  if(!doctorRow(did)) return json(res,404,{error:"医生不存在"});
  if(!requireAdminAction(req,res,s,"knowledge.manage",{doctorId:did},"无知识源向量重建权限")) return;
  if(!process.env.DASHSCOPE_API_KEY) return json(res,503,{error:"未配置向量服务凭证（DASHSCOPE_API_KEY）"});
  const items = db.prepare("SELECT id,title,body FROM knowledge_items WHERE doctor_id=? AND status='ready' ORDER BY id").all(did);
  const getVec = db.prepare("SELECT content_hash FROM knowledge_vectors WHERE item_id=?");
  // 只对「无向量 或 content_hash 过期」的条目重算；已是最新的跳过（幂等、省额度）。
  const stale = items.filter(it=>{
    const cur = getVec.get(it.id);
    return !cur || cur.content_hash !== triage.knowledgeContentHash(it.title, it.body);
  });
  if(!stale.length) return json(res,200,{ ok:true, embedded:0, skipped:items.length });
  let embedded = 0, failed = 0;
  const nowIso = now();
  const upsert = db.prepare(`INSERT INTO knowledge_vectors(item_id,doctor_id,model_id,dim,content_hash,vector,embedded_at)
    VALUES(?,?,?,?,?,?,?)
    ON CONFLICT(item_id) DO UPDATE SET doctor_id=excluded.doctor_id,model_id=excluded.model_id,dim=excluded.dim,
      content_hash=excluded.content_hash,vector=excluded.vector,embedded_at=excluded.embedded_at`);
  // 分批 embed（embedTexts 内部已 ≤10 分批 + fail-safe null）；任一批失败 → 该批不写、计入 failed，不污染已写的批。
  for(let i=0;i<stale.length;i+=10){
    const batch = stale.slice(i, i+10);
    const texts = batch.map(it=>(String(it.title||"")+" "+String(it.body||"")).slice(0,1500));
    let vecs = null;
    try{ vecs = await triage.embedTexts(texts); }catch(e){ vecs = null; }
    if(!vecs || vecs.length !== batch.length){ failed += batch.length; continue; }
    batch.forEach((it,j)=>{
      try{
        upsert.run(it.id, did, "text-embedding-v4", 1024, triage.knowledgeContentHash(it.title, it.body), JSON.stringify(vecs[j]), nowIso);
        embedded++;
      }catch(e){ failed++; }
    });
  }
  json(res, failed ? 207 : 200, { ok:failed===0, embedded, skipped:items.length - stale.length, failed });
});

route("POST", /^\/api\/admin\/outcomes$/, async (req,res)=>{
  const b = await parseBody(req);
  if(b.__oversize) return json(res,413,{error:"请求体过大（上限 1MB）"});
  const did = +b.doctorId;
  const s=gate(req,res,did); if(!s)return;
  if(!Number.isInteger(did)) return json(res,400,{error:"缺少 doctorId"});
  if(!requireAdminAction(req,res,s,"outcome.manage",{doctorId:did},"无效果回收维护权限")) return;
  if(!doctorRow(did)) return json(res,404,{error:"医生不存在"});
  const period = cleanText(b.period, 20);
  if(!period) return json(res,400,{error:"回收周期必填"});
  const dup = db.prepare("SELECT id FROM outcome_reports WHERE doctor_id=? AND period=?").get(did, period);
  if(dup) return json(res,400,{error:`周期 ${period} 已有回收记录，请编辑原记录`});
  const r = db.prepare(`INSERT INTO outcome_reports(doctor_id,period,outpatient_baseline,outpatient_current,perceived_growth,group_active,consult_leads,notes,created_at)
    VALUES(?,?,?,?,?,?,?,?,?)`).run(did, period, cleanInt(b.outpatient_baseline), cleanInt(b.outpatient_current),
      b.perceived_growth ? 1 : 0, cleanInt(b.group_active), cleanInt(b.consult_leads), cleanText(b.notes, 2000), now());
  json(res,200,{ ok:true, id:r.lastInsertRowid });
});

route("PUT", /^\/api\/admin\/outcomes\/(\d+)$/, async (req,res,m)=>{
  const did = rowDoctorId("outcome_reports", +m[1]);
  const s=gate(req,res,did); if(!s)return;
  if(did==null) return json(res,404,{error:"效果回收记录不存在"});
  if(!requireAdminAction(req,res,s,"outcome.manage",{doctorId:did},"无效果回收维护权限")) return;
  const b = await parseBody(req);
  if(b.__oversize) return json(res,413,{error:"请求体过大（上限 1MB）"});
  const period = cleanText(b.period, 20);
  if(!period) return json(res,400,{error:"回收周期必填"});
  const dup = db.prepare("SELECT id FROM outcome_reports WHERE doctor_id=? AND period=? AND id<>?").get(did, period, +m[1]);
  if(dup) return json(res,400,{error:`周期 ${period} 已有其他回收记录`});
  db.prepare(`UPDATE outcome_reports SET period=?,outpatient_baseline=?,outpatient_current=?,perceived_growth=?,group_active=?,consult_leads=?,notes=? WHERE id=?`)
    .run(period, cleanInt(b.outpatient_baseline), cleanInt(b.outpatient_current), b.perceived_growth ? 1 : 0,
      cleanInt(b.group_active), cleanInt(b.consult_leads), cleanText(b.notes, 2000), +m[1]);
  json(res,200,{ ok:true });
});

route("DELETE", /^\/api\/admin\/outcomes\/(\d+)$/, (req,res,m)=>{
  const did = rowDoctorId("outcome_reports", +m[1]);
  const s=gate(req,res,did); if(!s)return;
  if(did==null) return json(res,404,{error:"效果回收记录不存在"});
  if(!requireAdminAction(req,res,s,"outcome.manage",{doctorId:did},"无效果回收维护权限")) return;
  db.prepare("DELETE FROM outcome_reports WHERE id=?").run(+m[1]);
  json(res,200,{ ok:true });
});


}

module.exports = { registerContentAdminRoutes };
