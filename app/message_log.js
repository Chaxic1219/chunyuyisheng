/* 全量消息归档：L1-L6 分级写入 message_log，供分诊台与后台查询 */
const { db } = require("./db.js");
const triage = require("./triage.js");

function cleanText(v, max){
  return String(v == null ? "" : v).trim().slice(0, max || 1000);
}

/** 统一写入 message_log（L1-L6 分级，供分诊台/后台全量归档） */
function logInboundMessage(opts){
  if(!opts || !opts.doctorId) return null;
  const text = cleanText(opts.text || "", 1000);
  const cl = triage.classifyLevel(text, opts.doctorId, {
    isKeywordRule: !!opts.isKeywordRule,
    isSilent: !!opts.isSilent,
    riskLevel: opts.riskLevel || null,
    needsHuman: !!opts.needsHuman,
    needsDoctor: !!opts.needsDoctor,
    riskTriggers: opts.riskTriggers || null,
    emergency: !!opts.emergency,
    sentinel: !!opts.sentinel
  });
  let replyStatus = opts.replyStatus;
  if(!replyStatus){
    if(cl.level === 6) replyStatus = "silent";
    else if(cl.level <= 3) replyStatus = "pending";
    else replyStatus = opts.autoSent ? "sent" : "pending";
  }
  const action = opts.actionTaken || (cl.level === 6 ? "silent" : cl.level === 5 ? "rule_hit" : cl.action || "");
  const pid = opts.patientId != null ? String(opts.patientId) : null;
  const sourceMessageId = Number(opts.sourceMessageId);
  try{
    const existing = Number.isInteger(sourceMessageId) && sourceMessageId > 0
      ? db.prepare("SELECT id FROM message_log WHERE source_message_id=?").get(sourceMessageId)
      : null;
    if(existing){
      db.prepare(`UPDATE message_log SET doctor_id=?,patient_id=?,patient_name=?,sender_id=?,channel=?,text=?,level=?,level_label=?,action_taken=?,
        ai_draft=COALESCE(?,ai_draft),triage_session_id=COALESCE(?,triage_session_id),group_id=?,reply_status=? WHERE id=?`).run(
        opts.doctorId,pid,opts.patientName || null,opts.senderId || null,opts.channel || "community",text,
        cl.level,cl.label,action,opts.aiDraft || null,opts.triageSessionId || null,opts.groupId || null,replyStatus,existing.id
      );
      return cl;
    }
    // 显式写 ISO(Z)：避免仅依赖 SQLite datetime('now')（UTC 无时区）导致后台按字面显示成「差 8 小时」
    const createdAt = new Date().toISOString();
    db.prepare(`INSERT INTO message_log(doctor_id,patient_id,patient_name,sender_id,channel,direction,text,level,level_label,action_taken,ai_draft,triage_session_id,group_id,reply_status,source_message_id,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      opts.doctorId, pid, opts.patientName || null, opts.senderId || null,
      opts.channel || "community", "inbound", text,
      cl.level, cl.label, action,
      opts.aiDraft || null, opts.triageSessionId || null, opts.groupId || null, replyStatus,
      Number.isInteger(sourceMessageId) && sourceMessageId > 0 ? sourceMessageId : null,
      createdAt
    );
  }catch(e){ console.error("[logInboundMessage]", e.message); }
  return cl;
}

module.exports = { logInboundMessage };
