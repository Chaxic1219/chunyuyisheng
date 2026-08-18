"use strict";

/**
 * 消息工作台后台路由（从 server.js 迁出）。
 * 分诊可见口径与医生数据展示共用 qiwe_scope。
 */

const {
  MSGLOG_VISIBLE_IN_TRIAGE,
  buildQiweTriageScope,
  messageLogDisplayScope
} = require("../qiwe_scope.js");

function registerMessagesAdminRoutes(route, ctx){
  const {
    parseBody,
    json,
    gate,
    rowDoctorId,
    requireAdminAction,
    db,
    adminScope,
    now,
    hydrateAdminMessageRow,
    maskPII,
    triage,
    outboxMod,
    qiweBridge,
    friendlyPatientLabel,
    authed,
    allowDoctor,
    decorateAdminPatient,
    gateMessageLog
  } = ctx;

/* [v2.1] 全量消息列表 API（含筛选、分页、待处理计数） */
route("GET", /^\/api\/admin\/messages$/, (req,res,m,q)=>{
  const did = +q.doctorId;
  const s=gate(req,res,did); if(!s) return;
  const level = q.level ? +q.level : null;
  const status = q.status || null;
  const patientId = q.patientId || null;
  const limit = Math.min(+(q.limit||50), 200);
  const offset = +(q.offset||0);

  const qiweScope = buildQiweTriageScope(did);
  // 屏蔽企业微信主体账号（显示名含「 @企业名」，如「医生助手 @春雨家庭医生」）
  let where = "WHERE doctor_id=? " + MSGLOG_VISIBLE_IN_TRIAGE + " " + qiweScope.sql
    + " AND IFNULL(patient_name,'') NOT LIKE '% @%'";
  const params = [did, ...qiweScope.params];
  if(level){ where += " AND level=?"; params.push(level); }
  if(status){ where += " AND reply_status=?"; params.push(status); }
  if(patientId){ where += " AND patient_id=?"; params.push(patientId); }
  params.push(limit, offset);
  
  const rows = db.prepare("SELECT * FROM message_log "+where+" ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?").all(...params);
  const total = db.prepare("SELECT count(*) as c FROM message_log "+where).get(...params.slice(0,-2));
  
  // 待处理计数：仅业务群可见消息（同样屏蔽企业主体号）
  const pending = db.prepare(
    "SELECT count(*) as c FROM message_log WHERE doctor_id=? AND reply_status='pending' " + MSGLOG_VISIBLE_IN_TRIAGE + " " + qiweScope.sql
    + " AND IFNULL(patient_name,'') NOT LIKE '% @%'"
  ).get(did, ...qiweScope.params);
  // 与患者档案同口径：用社群微信名·企微覆盖冻结占位「企微患者」，并回填缺失 patient_id
  const messages = rows.map(r => hydrateAdminMessageRow(did, r));
  
  json(res,200,{ messages, total:total.c, pending:pending.c });
});

/* 分诊台图片：QiWe 换链 + 本地落地后直出（避免 imunion 临时链在浏览器加载失败） */
route("GET", /^\/api\/admin\/messages\/media$/, async (req,res,m,q)=>{
  const s = authed(req);
  if(!s) return json(res,401,{error:"未登录"});
  const cmid = +q.communityMessageId;
  if(!Number.isInteger(cmid) || cmid <= 0) return json(res,400,{error:"communityMessageId 无效"});
  const cm = db.prepare("SELECT doctor_id FROM community_messages WHERE id=?").get(cmid);
  if(!cm) return json(res,404,{error:"消息不存在"});
  if(!allowDoctor(s, +cm.doctor_id)) return json(res,403,{error:"无该医生数据的访问权限"});
  try{
    const out = await require("../qiwe_media.js").serveAdminMessageMedia(req, res, cmid, q.index);
    if(out.status !== 200) return json(res, out.status || 404, { error:out.error || "图片不可用" });
    res.writeHead(200, out.headers || { "Content-Type":"image/jpeg" });
    res.end(out.body);
  }catch(e){ json(res,400,{error:e.message}); }
});

/* [v2.1] 患者消息历史（按患者聚合） */
route("GET", /^\/api\/admin\/messages\/patient\/([^\/]+)$/, (req,res,m,q)=>{
  const did = +q.doctorId;
  const s=gate(req,res,did); if(!s) return;
  const key = decodeURIComponent(m[1]);
  const { patient, lookupKey } = resolvePatientRecord(key, did);
  if(patient && +patient.doctor_id !== did) return json(res,403,{error:"无该医生数据的访问权限"});
  const pid = patient ? String(patient.id) : key;
  const qiweScope = buildQiweTriageScope(did);
  const rows = db.prepare("SELECT * FROM message_log WHERE doctor_id=? AND (patient_id=? OR sender_id=?) " + MSGLOG_VISIBLE_IN_TRIAGE + " " + qiweScope.sql + " ORDER BY created_at DESC LIMIT 50").all(did, pid, lookupKey, ...qiweScope.params);
  json(res,200,{ messages: rows.map(r => hydrateAdminMessageRow(did, r)) });
});

function resolvePatientRecord(patientKey, doctorId){
  const key = decodeURIComponent(String(patientKey || "").trim());
  if(!key) return { patient:null, lookupKey:"" };
  const did = doctorId ? +doctorId : null;
  const num = +key;
  if(Number.isInteger(num) && num > 0){
    const byId = did
      ? db.prepare("SELECT * FROM patients WHERE id=? AND doctor_id=?").get(num, did)
      : db.prepare("SELECT * FROM patients WHERE id=?").get(num);
    if(byId) return { patient:byId, lookupKey:String(num) };
  }
  // 仅按外部 ID 强标识；企微 qiwe/wecom 裂变后找任一命中即可
  const ident = did
    ? db.prepare("SELECT patient_id FROM patient_identities WHERE doctor_id=? AND external_id=? ORDER BY CASE channel WHEN 'qiwe' THEN 0 WHEN 'wecom' THEN 1 ELSE 2 END LIMIT 1").get(did, key)
    : db.prepare("SELECT patient_id FROM patient_identities WHERE external_id=? ORDER BY CASE channel WHEN 'qiwe' THEN 0 WHEN 'wecom' THEN 1 ELSE 2 END LIMIT 1").get(key);
  if(ident){
    const byIdent = db.prepare("SELECT * FROM patients WHERE id=?").get(ident.patient_id);
    if(byIdent) return { patient:byIdent, lookupKey:String(byIdent.id) };
  }
  // 昵称仅做展示检索兜底：同医生下精确匹配；不再跨医生串档
  if(did && key && key !== "企微患者" && key !== "群友"){
    const byName = db.prepare("SELECT * FROM patients WHERE doctor_id=? AND (display_name=? OR real_name=?) ORDER BY updated_at DESC LIMIT 1").get(did, key, key);
    if(byName) return { patient:byName, lookupKey:String(byName.id) };
  }
  return { patient:null, lookupKey:key };
}

/* [v2.1] 患者档案卡片 API */
route("GET", /^\/api\/admin\/messages\/patient\/(.+)\/profile$/, (req,res,m,q)=>{
  const did = +q.doctorId;
  const s=gate(req,res,did); if(!s) return;
  const { patient, lookupKey } = resolvePatientRecord(m[1], did);
  if(patient && +patient.doctor_id !== did) return json(res,403,{error:"无该医生数据的访问权限"});
  const pid = patient ? String(patient.id) : lookupKey;
  const displayScope = messageLogDisplayScope(did);
  const stats = db.prepare(`SELECT count(*) as total,
    sum(case when reply_status='pending' then 1 else 0 end) as pending,
    min(created_at) as first_msg, max(created_at) as last_msg
    FROM message_log WHERE doctor_id=? AND (patient_id=? OR sender_id=?) ` + displayScope.sql).get(did, pid, lookupKey, ...displayScope.params);
  const recentSessions = patient
    ? db.prepare(`SELECT id, status, risk_level, patient_name, created_at,
        (SELECT text FROM triage_messages WHERE session_id=triage_sessions.id AND role='patient' ORDER BY id DESC LIMIT 1) AS last_patient_text
      FROM triage_sessions WHERE doctor_id=? AND patient_id=? ORDER BY created_at DESC LIMIT 8`).all(did, patient.id)
    : db.prepare(`SELECT id, status, risk_level, patient_name, created_at,
        (SELECT text FROM triage_messages WHERE session_id=triage_sessions.id AND role='patient' ORDER BY id DESC LIMIT 1) AS last_patient_text
      FROM triage_sessions WHERE doctor_id=? AND (patient_key LIKE ? OR patient_name=?) ORDER BY created_at DESC LIMIT 8`).all(did, "%"+lookupKey+"%", lookupKey);
  const submissions = patient
    ? db.prepare("SELECT id,type,status,payload,created_at AS at FROM submissions WHERE doctor_id=? AND patient_id=? ORDER BY created_at DESC LIMIT 8").all(did, patient.id)
    : [];
  const followups = patient
    ? db.prepare("SELECT id,plan_name,status,patient_name,patient_phone,created_at FROM followups WHERE doctor_id=? AND patient_id=? ORDER BY created_at DESC LIMIT 5").all(did, patient.id)
    : [];
  const identities = patient
    ? db.prepare("SELECT channel,external_id,group_id,created_at FROM patient_identities WHERE doctor_id=? AND patient_id=? ORDER BY created_at DESC LIMIT 6").all(did, patient.id)
    : [];
  json(res,200,{
    patient: patient ? decorateAdminPatient(did, patient) : null,
    stats: stats||{}, recentSessions, submissions, followups, identities
  });
});

/* [v2.1] 转医生 API */
route("POST", /^\/api\/admin\/messages\/(\d+)\/escalate$/, async (req,res,m)=>{
  const msgId = +m[1];
  const s=gateMessageLog(req,res,msgId); if(!s) return;
  const did = rowDoctorId("message_log", msgId);
  if(!requireAdminAction(req,res,s,"triage.note_status",{doctorId:did},"无该消息转医生权限")) return;
  const b = await parseBody(req);
  const msg = db.prepare("SELECT * FROM message_log WHERE id=?").get(msgId);
  if(!msg) return json(res,404,{error:"消息不存在"});
  
  // 更新消息状态为 escalated
  db.prepare("UPDATE message_log SET reply_status='escalated', action_taken='transfer_doctor' WHERE id=?").run(msgId);
  
  // 写入 doctor_notifications 表
  db.prepare(`INSERT OR IGNORE INTO doctor_notifications(doctor_id, message_log_id, patient_id, patient_name, text, level, level_label, note, status, created_at)
    VALUES(?,?,?,?,?,?,?,?,?,datetime('now'))`).run(
    msg.doctor_id, msgId, msg.patient_id, msg.patient_name, msg.text, msg.level, msg.level_label,
    b.note||"", "pending"
  );
  
  json(res,200,{ok:true, status:"escalated"});
});

/* [v2.1] 医生回复回流 API（医生处理完后回流消息给医助确认） */
route("POST", /^\/api\/admin\/messages\/(\d+)\/doctor-reply$/, async (req,res,m)=>{
  const msgId = +m[1];
  const s=gateMessageLog(req,res,msgId); if(!s) return;
  const did = rowDoctorId("message_log", msgId);
  if(!requireAdminAction(req,res,s,"triage.note_status",{doctorId:did},"无该消息处理权限")) return;
  const b = await parseBody(req);
  if(!b.text || !b.text.trim()) return json(res,400,{error:"回复内容不能为空"});
  const msg = db.prepare("SELECT * FROM message_log WHERE id=?").get(msgId);
  if(!msg) return json(res,404,{error:"消息不存在"});
  
  // 更新通知状态
  db.prepare("UPDATE doctor_notifications SET status='replied', reply_text=?, replied_at=datetime('now') WHERE message_log_id=?").run(b.text.trim(), msgId);
  // 更新消息状态为 doctor_replied（回流给医助确认发送）
  db.prepare("UPDATE message_log SET reply_status='doctor_replied', ai_draft=? WHERE id=?").run(b.text.trim(), msgId);
  
  json(res,200,{ok:true, status:"doctor_replied"});
});

/* [v2.1] 发送回复并更新状态（闭环：点发送→状态实时变 sent） */
route("POST", /^\/api\/admin\/messages\/(\d+)\/send$/, async (req,res,m)=>{
  const msgId = +m[1];
  const s=gateMessageLog(req,res,msgId); if(!s) return;
  const did = rowDoctorId("message_log", msgId);
  if(!requireAdminAction(req,res,s,"triage.confirm_send",{doctorId:did},"无该消息发送权限")) return;
  const b = await parseBody(req);
  if(!b.text || !b.text.trim()) return json(res,400,{error:"回复内容不能为空"});
  const msg = db.prepare("SELECT * FROM message_log WHERE id=?").get(msgId);
  if(!msg) return json(res,404,{error:"消息不存在"});
  
  // 写入出站队列
  const targetId = msg.group_id || msg.sender_id || "";
  const outId = outboxMod.enqueueDirect({
    doctorId: msg.doctor_id,
    targetId,
    text: b.text.trim(),
    source: "msg_center",
    channelType: msg.channel === "community" ? "wechat" : (msg.channel || "qiwe"),
    isGroup: !!msg.group_id,
    atUserId: msg.group_id ? msg.sender_id : null,
  });
  
  // 尝试真发：走 outboxMod.setOutboxStatus（内部 qiwe.loadConfig = 最新在线 GUID）
  // 旧实现 SELECT qiwe_configs WHERE doctor_id=? 无 ORDER BY，会取到最早离线实例 → 422100 客户端不在线
  let sent = false;
  let sendError = null;
  try {
    if(!targetId) throw new Error("无法解析发送目标");
    await outboxMod.setOutboxStatus(outId, "sent", s.username || String(s.adminId), { requireRealSend:true });
    sent = true;
  } catch(e){
    sendError = (e && e.message) || String(e);
    console.error("[msg-send]", sendError);
  }
  
  // 更新消息状态
  const newStatus = sent ? "sent" : "send_failed";
  db.prepare("UPDATE message_log SET reply_status=?, action_taken=? WHERE id=?").run(newStatus, "replied_"+newStatus, msgId);
  
  json(res,200,{ok:true, sent, status:newStatus, outboxId:outId, ...(sendError ? { error:sendError } : {})});
});

/* [v2.1] 消息合并：获取同一患者最近未处理消息（上下文关联） */
route("GET", /^\/api\/admin\/messages\/patient\/(.+)\/pending$/, (req,res,m,q)=>{
  const did = +q.doctorId;
  const s=gate(req,res,did); if(!s) return;
  const patientId = decodeURIComponent(m[1]);
  const qiweScope = buildQiweTriageScope(did);
  const rows = db.prepare("SELECT * FROM message_log WHERE doctor_id=? AND patient_id=? AND reply_status='pending' " + MSGLOG_VISIBLE_IN_TRIAGE + " " + qiweScope.sql + " ORDER BY created_at ASC").all(did, patientId, ...qiweScope.params);
  json(res,200,{ messages:rows.map(r => hydrateAdminMessageRow(did, r)), count:rows.length });
});

/* [v2.1] 批量标记已处理（多条消息合并处理后一次性标记） */
route("POST", /^\/api\/admin\/messages\/batch-resolve$/, async (req,res)=>{
  const s0=authed(req); if(!s0) return json(res,401,{error:"未登录"});
  const b = await parseBody(req);
  if(!b.ids || !Array.isArray(b.ids) || !b.ids.length) return json(res,400,{error:"ids 必填"});
  const ids = b.ids.map(Number).filter(Boolean);
  for(const id of ids){
    const did = rowDoctorId("message_log", id);
    if(did == null) return json(res,404,{error:"消息不存在"});
    if(!allowDoctor(s0, did)) return json(res,403,{error:"无该医生数据的访问权限"});
    if(!requireAdminAction(req,res,s0,"triage.note_status",{doctorId:did},"无该消息处理权限")) return;
  }
  const status = b.status || "resolved";
  const stmt = db.prepare("UPDATE message_log SET reply_status=? WHERE id=?");
  ids.forEach(id => stmt.run(status, id));
  json(res,200,{ok:true, updated:ids.length});
});

/* [v2.1] 删除单条消息记录（从分诊台彻底删除） */
route("DELETE", /^\/api\/admin\/messages\/(\d+)$/, (req,res,m)=>{
  const s=authed(req); if(!s) return json(res,401,{error:"未登录"});
  const id = +m[1];
  const did = rowDoctorId("message_log", id);
  if(did == null) return json(res,404,{error:"消息不存在"});
  if(!allowDoctor(s, did)) return json(res,403,{error:"无该医生数据的访问权限"});
  if(!requireAdminAction(req,res,s,"triage.note_status",{doctorId:did},"无该消息删除权限")) return;
  db.prepare("DELETE FROM message_log WHERE id=?").run(id);
  json(res,200,{ok:true, id});
});
route("GET", /^\/api\/admin\/doctor-notifications$/, (req,res,m,q)=>{
  const did = +q.doctorId;
  const s=gate(req,res,did); if(!s) return;
  const status = q.status || "pending";
  const rows = db.prepare("SELECT dn.*, ml.text as original_text, ml.level, ml.level_label, ml.patient_name FROM doctor_notifications dn LEFT JOIN message_log ml ON dn.message_log_id=ml.id WHERE dn.doctor_id=? AND dn.status=? ORDER BY dn.created_at DESC LIMIT 50").all(did, status);
  json(res,200,{ notifications:rows });
});

}

module.exports = { registerMessagesAdminRoutes, buildQiweTriageScope };
