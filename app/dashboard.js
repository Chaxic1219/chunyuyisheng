/* 运营数据大盘：医生个人看板 + 全平台汇总（会议 2026-07-15）
 * 大盘图表 = 各医生数据综合，呈现结构与医生看板一致
 * 企微相关计数与 AI 分诊台同口径：隐藏群（qiwe_hidden=1）不计入 */
const { db } = require("./db.js");
const {
  GROUP_QIWE_VISIBLE,
  messageLogDisplayScope,
  communityMessagesVisibleSql
} = require("./qiwe_scope.js");

function isoDaysAgo(n){
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

function dayKey(d){
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,"0");
  const day = String(d.getDate()).padStart(2,"0");
  return `${y}-${m}-${day}`;
}

function countSafe(sql, ...args){
  try{ return db.prepare(sql).get(...args).c || 0; }
  catch(e){ return 0; }
}

function allSafe(sql, ...args){
  try{ return db.prepare(sql).all(...args); }
  catch(e){ return []; }
}

/** 解析医生范围：null=全部；[]=空；number[]=限定 */
function resolveDoctorIds(doctorIds){
  if(Array.isArray(doctorIds)){
    return doctorIds.map(Number).filter(n=>Number.isInteger(n) && n>0);
  }
  return db.prepare("SELECT id FROM doctors ORDER BY id").all().map(d=>d.id);
}

function doctorFilter(ids, col="doctor_id"){
  if(!ids || !ids.length) return { sql:"1=0", args:[] };
  if(ids.length === 1) return { sql:`${col}=?`, args:[ids[0]] };
  const ph = ids.map(()=>"?").join(",");
  return { sql:`${col} IN (${ph})`, args:ids };
}

function latestOutcome(doctorId){
  try{
    return db.prepare(`SELECT period, outpatient_baseline, outpatient_current, perceived_growth,
      group_active, consult_leads, notes, created_at
      FROM outcome_reports WHERE doctor_id=? ORDER BY period DESC, id DESC LIMIT 1`).get(+doctorId) || null;
  }catch(e){ return null; }
}

function doctorCard(doctorId){
  const did = +doctorId;
  const d = db.prepare("SELECT id,slug,name,title,hospital,dept,active FROM doctors WHERE id=?").get(did);
  if(!d) return null;
  const since7 = isoDaysAgo(7);
  const displayScope = messageLogDisplayScope(did);
  const cmVisible = communityMessagesVisibleSql("community_messages");
  const patients = countSafe("SELECT COUNT(*) c FROM patients WHERE doctor_id=?", did);
  const groupsTotal = countSafe(
    `SELECT COUNT(*) c FROM community_groups WHERE doctor_id=? AND ${GROUP_QIWE_VISIBLE}`,
    did
  );
  const businessGroups = countSafe(
    `SELECT COUNT(*) c FROM community_groups WHERE doctor_id=? AND is_business=1 AND ${GROUP_QIWE_VISIBLE}`,
    did
  );
  const qiweGroups = countSafe(
    `SELECT COUNT(*) c FROM community_groups WHERE doctor_id=? AND data_source='qiwe' AND ${GROUP_QIWE_VISIBLE}`,
    did
  );
  const members = countSafe(
    `SELECT COUNT(DISTINCT m.external_user_id) c FROM community_members m
      LEFT JOIN community_groups g ON g.id=m.group_id
      WHERE m.doctor_id=? AND IFNULL(m.status,'active')='active'
        AND m.external_user_id IS NOT NULL AND trim(m.external_user_id)!=''
        AND (g.id IS NULL OR IFNULL(g.qiwe_hidden, 0) = 0)`,
    did
  );
  const inbound7 = countSafe(
    `SELECT COUNT(*) c FROM community_messages WHERE doctor_id=? AND created_at>=? ${cmVisible}`,
    did, since7
  );
  const msgLog7 = countSafe(
    `SELECT COUNT(*) c FROM message_log WHERE doctor_id=? AND created_at>=? ${displayScope.sql}`,
    did, since7, ...displayScope.params
  );
  const pendingTriage = countSafe(
    `SELECT COUNT(*) c FROM message_log WHERE doctor_id=? AND IFNULL(reply_status,'pending')='pending' ${displayScope.sql}`,
    did, ...displayScope.params
  );
  const pendingOutbox = countSafe(
    `SELECT COUNT(*) c FROM outbound_queue WHERE doctor_id=? AND status='pending'`,
    did
  );
  const submissions = countSafe("SELECT COUNT(*) c FROM submissions WHERE doctor_id=?", did);
  const consultLeads = countSafe(
    `SELECT COUNT(*) c FROM submissions WHERE doctor_id=? AND (
      type LIKE '%加号%' OR type LIKE '%住院%' OR type LIKE '%联络%' OR type LIKE '%建档%' OR type LIKE '%感谢%'
    )`,
    did
  );
  const followups = countSafe("SELECT COUNT(*) c FROM followups WHERE doctor_id=?", did);
  const outcome = latestOutcome(did);
  return {
    doctorId:d.id,
    slug:d.slug,
    name:d.name,
    title:d.title || "",
    hospital:d.hospital || "",
    dept:d.dept || "",
    active:d.active === 1,
    metrics:{
      patients,
      groupsTotal,
      businessGroups,
      qiweGroups,
      members,
      inbound7d:inbound7,
      patientMessages7d:msgLog7,
      pendingTriage,
      pendingOutbox,
      submissions,
      consultLeads,
      followups
    },
    outcome:outcome ? {
      period:outcome.period,
      outpatientBaseline:outcome.outpatient_baseline || 0,
      outpatientCurrent:outcome.outpatient_current || 0,
      perceivedGrowth:!!outcome.perceived_growth,
      groupActive:outcome.group_active || 0,
      consultLeads:outcome.consult_leads || 0,
      notes:outcome.notes || ""
    } : null,
    generatedAt:new Date().toISOString()
  };
}

function sumMetrics(rows){
  const keys = [
    "patients","groupsTotal","businessGroups","qiweGroups","members",
    "inbound7d","patientMessages7d","pendingTriage","pendingOutbox",
    "submissions","consultLeads","followups"
  ];
  const out = {};
  for(const k of keys) out[k] = 0;
  for(const r of rows){
    const m = r.metrics || {};
    for(const k of keys) out[k] += Number(m[k]) || 0;
  }
  return out;
}

/** 与医生看板图表结构一致的综合数据（单医/多医共用） */
function chartsBundle(doctorIds){
  const ids = resolveDoctorIds(doctorIds);
  const f = doctorFilter(ids);
  const since7 = isoDaysAgo(7);
  const since30 = isoDaysAgo(30);
  const displayScope = messageLogDisplayScope(null);
  const cmVisible = communityMessagesVisibleSql("community_messages");

  const byType = allSafe(
    `SELECT IFNULL(NULLIF(trim(type),''),'未分类') AS type, COUNT(*) AS c
     FROM submissions WHERE ${f.sql} GROUP BY 1 ORDER BY c DESC LIMIT 12`,
    ...f.args
  );

  const rawTrend = allSafe(
    `SELECT substr(created_at,1,10) AS day, COUNT(*) AS c
     FROM message_log WHERE ${f.sql} AND created_at>=? ${displayScope.sql}
     GROUP BY 1 ORDER BY 1`,
    ...f.args, since7, ...displayScope.params
  );
  const trendMap = Object.fromEntries(rawTrend.map(r=>[r.day, r.c]));
  const trend7d = [];
  for(let i=6;i>=0;i--){
    const d = new Date();
    d.setDate(d.getDate()-i);
    const k = dayKey(d);
    trend7d.push({ day:k.slice(5), c:trendMap[k] || 0 });
  }

  const recentMsgs = allSafe(
    `SELECT id, doctor_id, text, level, reply_status, created_at
     FROM message_log WHERE ${f.sql} ${displayScope.sql} ORDER BY id DESC LIMIT 80`,
    ...f.args, ...displayScope.params
  );
  const levelBuckets = { L1:0, L2:0, L3:0, L4:0, L5:0, L6:0 };
  const levelRows = allSafe(
    `SELECT level, COUNT(*) AS c FROM message_log WHERE ${f.sql} ${displayScope.sql} GROUP BY level`,
    ...f.args, ...displayScope.params
  );
  for(const row of levelRows){
    const raw = String(row.level ?? "").toUpperCase().replace(/^L/,"").trim();
    const n = Number(raw);
    // 与分诊台一致：1急症 2需医生 3需医助 4低风险 5编号指令 6闲聊
    const key = (Number.isInteger(n) && n >= 1 && n <= 6) ? ("L" + n) : "L4";
    levelBuckets[key] += Number(row.c) || 0;
  }
  const statusRows = allSafe(
    `SELECT IFNULL(reply_status,'pending') AS st, COUNT(*) AS c
     FROM message_log WHERE ${f.sql} ${displayScope.sql} GROUP BY 1`,
    ...f.args, ...displayScope.params
  );
  const statusLabel = {
    pending:"待回复",
    sent:"已自动回复",
    escalated:"已转医生",
    doctor_replied:"医生已回复",
    resolved:"已处理完",
    replied:"已回复",
    ignored:"已忽略"
  };
  const statusRing = statusRows.length
    ? statusRows.map(r=>({ name:statusLabel[r.st]||r.st, value:Number(r.c)||0 }))
    : [{ name:"待处理", value:0 }];

  const groups = countSafe(
    `SELECT COUNT(*) c FROM community_groups WHERE ${f.sql} AND ${GROUP_QIWE_VISIBLE}`,
    ...f.args
  );
  const qiwe = countSafe(
    `SELECT COUNT(*) c FROM community_groups WHERE ${f.sql} AND data_source='qiwe' AND ${GROUP_QIWE_VISIBLE}`,
    ...f.args
  );
  const inbound7d = countSafe(
    `SELECT COUNT(*) c FROM community_messages WHERE ${f.sql} AND created_at>=? ${cmVisible}`,
    ...f.args, since7
  );
  const sent7d = countSafe(
    `SELECT COUNT(*) c FROM outbound_queue WHERE ${f.sql} AND status='sent' AND created_at>=?`,
    ...f.args, since7
  );
  const flagged = countSafe(
    `SELECT COUNT(*) c FROM community_messages WHERE ${f.sql} AND flagged=1 ${cmVisible}`,
    ...f.args
  );
  const rules = countSafe(`SELECT COUNT(*) c FROM reply_rules WHERE ${f.sql}`, ...f.args);

  const remFollow = countSafe(
    `SELECT COUNT(*) c FROM followups WHERE ${f.sql}
      AND IFNULL(status,'pending') IN ('pending','due') AND due_at IS NOT NULL AND due_at<=datetime('now','+3 days')`,
    ...f.args
  );
  const remWait = countSafe(
    `SELECT COUNT(*) c FROM waitlist WHERE ${f.sql}
      AND IFNULL(status,'waiting')='waiting' AND IFNULL(priority,0)>=2`,
    ...f.args
  );
  const remTriage = countSafe(
    `SELECT COUNT(*) c FROM message_log WHERE ${f.sql} AND IFNULL(reply_status,'pending')='pending' ${displayScope.sql}`,
    ...f.args, ...displayScope.params
  );
  const remFlag = countSafe(
    `SELECT COUNT(*) c FROM community_messages WHERE ${f.sql} AND flagged=1 AND created_at>=? ${cmVisible}`,
    ...f.args, since30
  );
  const remOutFail = countSafe(
    `SELECT COUNT(*) c FROM outbound_queue WHERE ${f.sql} AND status='failed' AND created_at>=?`,
    ...f.args, since30
  );
  const reminderCounts = {
    followup_due: remFollow,
    waitlist_hot: remWait,
    triage_pending: remTriage,
    community_flag: remFlag,
    outbox_fail: remOutFail
  };
  const remindersTotal = remFollow + remWait + remTriage + remFlag + remOutFail;

  const patients = countSafe(`SELECT COUNT(*) c FROM patients WHERE ${f.sql}`, ...f.args);
  const followups = countSafe(`SELECT COUNT(*) c FROM followups WHERE ${f.sql}`, ...f.args);
  const waitlist = countSafe(`SELECT COUNT(*) c FROM waitlist WHERE ${f.sql}`, ...f.args);
  const msgs = countSafe(
    `SELECT COUNT(*) c FROM message_log WHERE ${f.sql} ${displayScope.sql}`,
    ...f.args, ...displayScope.params
  );
  const triageSessions = countSafe(`SELECT COUNT(*) c FROM triage_sessions WHERE ${f.sql}`, ...f.args);
  const triagePending = remTriage;
  const communityPending = countSafe(
    `SELECT COUNT(*) c FROM outbound_queue WHERE ${f.sql} AND status='pending'`,
    ...f.args
  );
  const submissions = countSafe(`SELECT COUNT(*) c FROM submissions WHERE ${f.sql}`, ...f.args);

  return {
    byType,
    trend7d,
    levelBuckets,
    statusRing,
    ops:{ groups, qiwe, inbound7d, sent7d, flagged, rules },
    reminderCounts,
    remindersTotal,
    patients,
    followups,
    waitlist,
    msgs,
    triageSessions,
    triagePending,
    communityPending,
    submissions,
    recentMessages: recentMsgs.slice(0, 12).map(m=>({
      id:m.id,
      doctorId:m.doctor_id,
      content:m.text || "",
      level:m.level || "L2",
      replyStatus:m.reply_status || "pending",
      createdAt:m.created_at
    }))
  };
}

/** doctorIds=null 全部；number[] 限定范围（子管理员） */
function platformDashboard(doctorIds){
  let docs;
  if(Array.isArray(doctorIds)){
    const ids = doctorIds.map(Number).filter(n=>Number.isInteger(n) && n>0);
    if(!ids.length){
      return {
        ok:true, scope:"platform", doctors:[], totals:sumMetrics([]),
        charts:chartsBundle([]), doctorCount:0, activeDoctorCount:0,
        generatedAt:new Date().toISOString()
      };
    }
    const ph = ids.map(()=>"?").join(",");
    docs = db.prepare(`SELECT id FROM doctors WHERE id IN (${ph}) ORDER BY id`).all(...ids);
  }else{
    docs = db.prepare("SELECT id FROM doctors ORDER BY id").all();
  }
  const doctors = docs.map(d=>doctorCard(d.id)).filter(Boolean);
  const ids = doctors.map(d=>d.doctorId);
  return {
    ok:true,
    scope:"platform",
    doctorCount:doctors.length,
    activeDoctorCount:doctors.filter(d=>d.active).length,
    totals:sumMetrics(doctors),
    doctors,
    charts:chartsBundle(ids),
    generatedAt:new Date().toISOString()
  };
}

function doctorDashboard(doctorId){
  const card = doctorCard(doctorId);
  if(!card) throw new Error("医生不存在");
  return {
    ok:true,
    scope:"doctor",
    doctor:card,
    charts:chartsBundle([+doctorId]),
    generatedAt:card.generatedAt
  };
}

module.exports = { doctorCard, doctorDashboard, platformDashboard, sumMetrics, chartsBundle };
