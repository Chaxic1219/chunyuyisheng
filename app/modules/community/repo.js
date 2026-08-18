"use strict";

/**
 * community_groups / community_members 唯一 SQL 写入口（表归属 community）。
 */
const { db } = require("../../db.js");

function nowIso(){
  return new Date().toISOString();
}

function getGroupById(id){
  return db.prepare("SELECT * FROM community_groups WHERE id=?").get(+id) || null;
}

function getGroupByDoctorAndId(doctorId, id){
  return db.prepare("SELECT * FROM community_groups WHERE id=? AND doctor_id=?").get(+id, +doctorId) || null;
}

function getGroupByDoctorChannelExt(doctorId, channel, ext){
  return db.prepare("SELECT * FROM community_groups WHERE doctor_id=? AND channel_type=? AND external_group_id=?")
    .get(+doctorId, channel, ext) || null;
}

function findByExternalGroupId(ext){
  // 企微 roomId 存在 8 位（内部 roomid）与 17 位（chat_id）两种形态：先精确匹配，
  // 未命中时按前缀兜底（短 ID 是长 ID 前 8 位），保证新增群无论回调来哪种形态都能命中同一群。
  const exact = db.prepare(`SELECT * FROM community_groups WHERE external_group_id=?
    ORDER BY CASE WHEN data_source='qiwe' THEN 0 ELSE 1 END, is_business DESC, id LIMIT 1`).get(ext);
  if(exact) return exact;
  const s = String(ext || "").trim();
  if(!s || s.length < 8) return null;
  return db.prepare(`SELECT * FROM community_groups WHERE external_group_id LIKE ?
    ORDER BY CASE WHEN data_source='qiwe' THEN 0 ELSE 1 END, is_business DESC, id LIMIT 1`).get(s + "%") || null;
}

function firstGroupByDoctor(doctorId){
  return db.prepare("SELECT * FROM community_groups WHERE doctor_id=? ORDER BY id LIMIT 1").get(+doctorId) || null;
}

function countGroupsByDoctor(doctorId){
  return db.prepare("SELECT COUNT(*) c FROM community_groups WHERE doctor_id=?").get(+doctorId).c;
}

function countBusinessForPrimary(primaryId){
  return db.prepare(
    `SELECT COUNT(*) c FROM community_groups WHERE is_business=1 AND (
       id IN (SELECT group_id FROM community_group_doctors WHERE doctor_id=?)
       OR doctor_id=?
     )`
  ).get(+primaryId, +primaryId).c;
}

function insertGroup(cols){
  const c = cols || {};
  const createdAt = c.createdAt || nowIso();
  const updatedAt = c.updatedAt || createdAt;
  const extended = c.dataSource != null || c.isBusiness != null || c.lastSyncedAt != null
    || c.syncVersion != null || c.shareVisibleToCollab != null;
  if(extended){
    const r = db.prepare(`INSERT INTO community_groups(
      doctor_id,channel_type,external_group_id,name,owner,member_count,status,welcome_enabled,welcome_text,
      auto_reply_enabled,review_mode,qrcode_url,notes,created_at,updated_at,data_source,is_business,last_synced_at,sync_version,share_visible_to_collab
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      c.doctorId,
      c.channelType || "wechat",
      c.externalGroupId != null ? c.externalGroupId : null,
      c.name || "",
      c.owner != null ? c.owner : "",
      c.memberCount != null ? c.memberCount : 0,
      c.status || "pilot",
      c.welcomeEnabled === false || c.welcomeEnabled === 0 ? 0 : 1,
      c.welcomeText != null ? c.welcomeText : "",
      c.autoReplyEnabled === false || c.autoReplyEnabled === 0 ? 0 : 1,
      c.reviewMode || "human_review",
      c.qrcodeUrl != null ? c.qrcodeUrl : null,
      c.notes != null ? c.notes : "",
      createdAt,
      updatedAt,
      c.dataSource != null ? c.dataSource : "manual",
      c.isBusiness ? 1 : 0,
      c.lastSyncedAt != null ? c.lastSyncedAt : null,
      c.syncVersion != null ? c.syncVersion : 0,
      c.shareVisibleToCollab === 0 || c.shareVisibleToCollab === false ? 0 : 1
    );
    return getGroupById(r.lastInsertRowid);
  }
  const r = db.prepare(`INSERT INTO community_groups(
    doctor_id,channel_type,external_group_id,name,owner,member_count,status,welcome_enabled,welcome_text,
    auto_reply_enabled,review_mode,qrcode_url,notes,created_at,updated_at
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    c.doctorId,
    c.channelType || "wechat",
    c.externalGroupId != null ? c.externalGroupId : null,
    c.name || "",
    c.owner != null ? c.owner : "",
    c.memberCount != null ? c.memberCount : 0,
    c.status || "pilot",
    c.welcomeEnabled === false || c.welcomeEnabled === 0 ? 0 : 1,
    c.welcomeText != null ? c.welcomeText : "",
    c.autoReplyEnabled === false || c.autoReplyEnabled === 0 ? 0 : 1,
    c.reviewMode || "human_review",
    c.qrcodeUrl != null ? c.qrcodeUrl : null,
    c.notes != null ? c.notes : "",
    createdAt,
    updatedAt
  );
  return getGroupById(r.lastInsertRowid);
}

function setManualDefaults(id){
  db.prepare("UPDATE community_groups SET data_source='manual',is_business=0 WHERE id=?").run(+id);
  return getGroupById(id);
}

function updateGroupCore(id, fields){
  const f = fields || {};
  db.prepare(`UPDATE community_groups SET channel_type=?,external_group_id=?,name=?,owner=?,member_count=?,status=?,
    welcome_enabled=?,welcome_text=?,auto_reply_enabled=?,review_mode=?,qrcode_url=?,notes=?,updated_at=? WHERE id=?`).run(
    f.channelType, f.externalGroupId, f.name, f.owner, f.memberCount, f.status,
    f.welcomeEnabled, f.welcomeText != null ? f.welcomeText : "", f.autoReplyEnabled, f.reviewMode,
    f.qrcodeUrl, f.notes, f.updatedAt || nowIso(), +id
  );
  return getGroupById(id);
}

function setShareVisible(id, share){
  db.prepare("UPDATE community_groups SET share_visible_to_collab=? WHERE id=?").run(share ? 1 : 0, +id);
}

function setDataSource(id, dataSource){
  db.prepare("UPDATE community_groups SET data_source=? WHERE id=?").run(dataSource, +id);
}

function setIsBusiness(id, isBusiness){
  db.prepare("UPDATE community_groups SET is_business=? WHERE id=?").run(isBusiness ? 1 : 0, +id);
}

function setWelcomeFlags(id, opts){
  const o = opts || {};
  db.prepare(`UPDATE community_groups SET welcome_enabled=?, auto_reply_enabled=?, review_mode=? WHERE id=?`)
    .run(o.welcomeEnabled === false ? 0 : 1, o.autoReplyEnabled ? 1 : 0, String(o.reviewMode || "human_review"), +id);
}

function setWeeklyAutoLastWeek(id, weekKey){
  db.prepare("UPDATE community_groups SET weekly_auto_last_week=? WHERE id=?").run(weekKey, +id);
}

function bumpMemberCount(groupId){
  db.prepare("UPDATE community_groups SET member_count=member_count+1,updated_at=? WHERE id=?").run(nowIso(), +groupId);
}

function setMemberCountSynced(groupId, count, syncedAt){
  const ts = syncedAt || nowIso();
  db.prepare("UPDATE community_groups SET member_count=?,last_synced_at=?,updated_at=? WHERE id=?")
    .run(count, ts, ts, +groupId);
}

function syncUpdateGroupFromQiwe(id, patch){
  const p = patch || {};
  db.prepare(`UPDATE community_groups SET channel_type='qiwe',data_source='qiwe',is_business=1,name=?,owner=?,member_count=?,status=CASE WHEN status='archived' THEN 'pilot' ELSE status END,last_synced_at=?,updated_at=? WHERE id=?`)
    .run(p.name, p.owner, p.memberCount, p.syncedAt, p.syncedAt, +id);
  return getGroupById(id);
}

function syncGroupNameFromQiwe(id, name, syncedAt){
  const ts = syncedAt || nowIso();
  db.prepare("UPDATE community_groups SET name=?,last_synced_at=?,updated_at=? WHERE id=?")
    .run(String(name || "").trim(), ts, ts, +id);
  return getGroupById(id);
}

function setGroupDoctorId(id, doctorId, updatedAt){
  if(updatedAt){
    db.prepare("UPDATE community_groups SET doctor_id=?, updated_at=? WHERE id=?").run(+doctorId, updatedAt, +id);
  }else{
    db.prepare("UPDATE community_groups SET doctor_id=? WHERE id=?").run(+doctorId, +id);
  }
}

/* 合并重复企微群后提升 data_source，并纳入业务范围（不再由管理员勾选） */
function setQiweBusinessFlags(id){
  db.prepare(`UPDATE community_groups
    SET data_source='qiwe', is_business=1, updated_at=COALESCE(updated_at, datetime('now'))
    WHERE id=?`).run(+id);
}

function getMemberByKey(doctorId, groupId, externalUserId){
  return db.prepare("SELECT * FROM community_members WHERE doctor_id=? AND group_id=? AND external_user_id=?")
    .get(+doctorId, +groupId, externalUserId) || null;
}

function getMemberById(id){
  return db.prepare("SELECT * FROM community_members WHERE id=?").get(+id) || null;
}

function insertMember(cols){
  const c = cols || {};
  const r = db.prepare(`INSERT INTO community_members(doctor_id,group_id,external_user_id,display_name,phone,tags,joined_at,status,data_source,last_synced_at)
    VALUES(?,?,?,?,?,?,?,?,?,?)`).run(
    +c.doctorId,
    +c.groupId,
    c.externalUserId,
    c.displayName || "",
    c.phone != null ? c.phone : "",
    typeof c.tags === "string" ? c.tags : JSON.stringify(c.tags || []),
    c.joinedAt || nowIso(),
    c.status || "active",
    c.dataSource || "manual",
    c.lastSyncedAt != null ? c.lastSyncedAt : null
  );
  return getMemberById(r.lastInsertRowid);
}

function updateMemberActive(id, patch){
  const p = patch || {};
  if(p.joinedAt != null || p.lastSyncedAt != null){
    db.prepare("UPDATE community_members SET display_name=?,joined_at=COALESCE(joined_at,?),status='active',data_source=?,last_synced_at=? WHERE id=?")
      .run(p.displayName, p.joinedAt || null, p.dataSource || "qiwe", p.lastSyncedAt || nowIso(), +id);
  }else{
    db.prepare("UPDATE community_members SET display_name=?,status='active',data_source=? WHERE id=?")
      .run(p.displayName, p.dataSource || "manual", +id);
  }
  return getMemberById(id);
}

function markMemberLeft(id, lastSyncedAt){
  db.prepare("UPDATE community_members SET status='left',last_synced_at=? WHERE id=?").run(lastSyncedAt || nowIso(), +id);
}

function setMemberPatientId(id, patientId){
  db.prepare("UPDATE community_members SET patient_id=? WHERE id=?").run(patientId, +id);
}

function setMemberDisplayAvatar(id, displayName, avatarUrl){
  db.prepare("UPDATE community_members SET display_name=?, avatar_url=? WHERE id=?")
    .run(displayName, avatarUrl != null ? avatarUrl : null, +id);
}

function reassignMemberGroup(memberId, toGroupId){
  db.prepare("UPDATE community_members SET group_id=? WHERE id=?").run(+toGroupId, +memberId);
}

function deleteMember(id){
  db.prepare("DELETE FROM community_members WHERE id=?").run(+id);
}

function deleteGroup(id){
  db.prepare("DELETE FROM community_groups WHERE id=?").run(+id);
}

function listActiveQiweMembers(groupId){
  return db.prepare("SELECT id,external_user_id FROM community_members WHERE group_id=? AND data_source='qiwe' AND status='active'").all(+groupId);
}

function countActiveQiweMembers(groupId){
  return db.prepare("SELECT COUNT(*) c FROM community_members WHERE group_id=? AND data_source='qiwe' AND status='active'").get(+groupId).c;
}

function doctorExists(doctorId){
  return !!db.prepare("SELECT 1 FROM doctors WHERE id=?").get(+doctorId);
}

function getDoctorBrief(doctorId){
  return db.prepare("SELECT id,name,group_name,member_count,dept,content FROM doctors WHERE id=?").get(+doctorId) || null;
}

/* —— community_messages —— */

function getMessageById(id){
  return db.prepare("SELECT * FROM community_messages WHERE id=?").get(+id) || null;
}

function findMessageByExternalMsgId(doctorId, externalMsgId){
  return db.prepare("SELECT id,moderation_level FROM community_messages WHERE doctor_id=? AND external_msg_id=? ORDER BY id DESC LIMIT 1")
    .get(+doctorId, externalMsgId) || null;
}

function getLatestMessageByExternal(doctorId, externalMsgId){
  return db.prepare("SELECT * FROM community_messages WHERE doctor_id=? AND external_msg_id=? ORDER BY id DESC LIMIT 1")
    .get(+doctorId, externalMsgId) || null;
}

function getMessageByExternal(doctorId, externalMsgId){
  return db.prepare("SELECT * FROM community_messages WHERE doctor_id=? AND external_msg_id=? LIMIT 1")
    .get(+doctorId, externalMsgId) || null;
}

function listNearbyPeerMessages(doctorId, memberId, excludeMessageId, windowSec){
  const did = +doctorId;
  const mid = +memberId;
  const exclude = +excludeMessageId || 0;
  const win = Math.max(30, Math.min(600, Number(windowSec) || 180));
  const out = { texts:[], images:[] };
  if(!Number.isInteger(did) || did <= 0 || !Number.isInteger(mid) || mid <= 0) return out;
  try{
    const rows = db.prepare(`
      SELECT id, msg_type, text, created_at, raw_payload
      FROM community_messages
      WHERE doctor_id=? AND member_id=? AND id!=?
        AND created_at >= datetime('now', ?)
      ORDER BY id DESC LIMIT 20`).all(did, mid, exclude, `-${win} seconds`);
    for(const r of rows){
      const mt = String(r.msg_type || "");
      if(mt === "image" || mt === "media" || mt === "file" || mt === "video") out.images.push(r);
      else if(mt === "text" && String(r.text || "").trim()) out.texts.push(r);
    }
  }catch(e){
    try{
      const rows = db.prepare(`
        SELECT id, msg_type, text, created_at, raw_payload
        FROM community_messages
        WHERE doctor_id=? AND member_id=? AND id!=?
        ORDER BY id DESC LIMIT 12`).all(did, mid, exclude);
      const nowMs = Date.now();
      for(const r of rows){
        const t = Date.parse(r.created_at || "");
        if(Number.isFinite(t) && Math.abs(nowMs - t) > win * 1000) continue;
        const mt = String(r.msg_type || "");
        if(mt === "image" || mt === "media" || mt === "file" || mt === "video") out.images.push(r);
        else if(mt === "text" && String(r.text || "").trim()) out.texts.push(r);
      }
    }catch(e2){}
  }
  return out;
}

function findMemberIdByGroupUser(doctorId, groupId, externalUserId){
  const row = db.prepare("SELECT id FROM community_members WHERE doctor_id=? AND group_id=? AND external_user_id=? LIMIT 1")
    .get(+doctorId, +groupId, externalUserId);
  return row || null;
}

function findLatestMemberIdByUser(doctorId, externalUserId){
  return db.prepare("SELECT id FROM community_members WHERE doctor_id=? AND external_user_id=? ORDER BY id DESC LIMIT 1")
    .get(+doctorId, externalUserId) || null;
}

function insertMessage(cols){
  const c = cols || {};
  const createdAt = c.createdAt || nowIso();
  if(c.dataSource != null){
    const r = db.prepare(`INSERT INTO community_messages(
      doctor_id,group_id,member_id,external_msg_id,sender_name,sender_role,msg_type,text,raw_payload,process_status,created_at,data_source
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      +c.doctorId, c.groupId, c.memberId, c.externalMsgId != null ? c.externalMsgId : null,
      c.senderName || "", c.senderRole || "patient", c.msgType || "text", c.text || "",
      typeof c.rawPayload === "string" ? c.rawPayload : JSON.stringify(c.rawPayload || {}),
      c.processStatus || "received", createdAt, c.dataSource
    );
    return getMessageById(r.lastInsertRowid);
  }
  const r = db.prepare(`INSERT INTO community_messages(
    doctor_id,group_id,member_id,external_msg_id,sender_name,sender_role,msg_type,text,raw_payload,process_status,created_at
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(
    +c.doctorId, c.groupId, c.memberId, c.externalMsgId != null ? c.externalMsgId : null,
    c.senderName || "", c.senderRole || "patient", c.msgType || "text", c.text || "",
    typeof c.rawPayload === "string" ? c.rawPayload : JSON.stringify(c.rawPayload || {}),
    c.processStatus || "received", createdAt
  );
  return getMessageById(r.lastInsertRowid);
}

function setModerationFlag(id, flag, keys, level){
  db.prepare("UPDATE community_messages SET moderation_flag=?,moderation_keys=?,moderation_level=? WHERE id=?")
    .run(flag, keys, level, +id);
}

function setModerationFlagOpen(id, flag, keys, level){
  db.prepare("UPDATE community_messages SET moderation_flag=?,moderation_keys=?,moderation_level=?,moderation_status=COALESCE(NULLIF(moderation_status,''),'open') WHERE id=?")
    .run(flag, keys, level, +id);
}

function setModerationResolved(id, status, action, resolvedAt, resolvedBy){
  db.prepare(`UPDATE community_messages SET moderation_status=?,moderation_action=?,moderation_resolved_at=?,moderation_resolved_by=? WHERE id=?`)
    .run(status, action, resolvedAt, resolvedBy, +id);
}

function setModerationAiFields(id, level, role, reason){
  db.prepare("UPDATE community_messages SET moderation_level=?,moderation_ai_role=?,moderation_ai_reason=? WHERE id=?")
    .run(level, role, reason, +id);
}

function setModerationAiUpsert(id, level, role, reason){
  db.prepare("UPDATE community_messages SET moderation_flag=COALESCE(moderation_flag,'offtopic'),moderation_keys=COALESCE(NULLIF(moderation_keys,''),'AI语义天网'),moderation_level=?,moderation_ai_role=?,moderation_ai_reason=? WHERE id=?")
    .run(level, role, reason, +id);
}

function setModerationFull(id, flag, keys, level, role, reason){
  db.prepare("UPDATE community_messages SET moderation_flag=?,moderation_keys=?,moderation_level=?,moderation_ai_role=?,moderation_ai_reason=? WHERE id=?")
    .run(flag, keys, level, role, reason, +id);
}

function setProcessStatus(id, status){
  db.prepare("UPDATE community_messages SET process_status=? WHERE id=?").run(status, +id);
}

function setProcessMatched(id, status, matchedSource){
  db.prepare("UPDATE community_messages SET process_status=?,matched_source=? WHERE id=?").run(status, matchedSource, +id);
}

function setRiskProcess(id, riskLevel, processStatus, matchedSource){
  db.prepare("UPDATE community_messages SET risk_level=?,process_status=?,matched_source=? WHERE id=?")
    .run(riskLevel, processStatus, matchedSource, +id);
}

function setRiskProcessTriage(id, riskLevel, processStatus, matchedSource, triageSessionId, decisionId){
  db.prepare(`UPDATE community_messages SET risk_level=?,process_status=?,matched_source=?,triage_session_id=?,decision_id=? WHERE id=?`)
    .run(riskLevel, processStatus, matchedSource, triageSessionId, decisionId, +id);
}

function setRawPayload(id, payloadJson){
  db.prepare("UPDATE community_messages SET raw_payload=? WHERE id=?").run(payloadJson, +id);
}

function reassignMessageGroup(fromGroupId, toGroupId){
  const r = db.prepare("UPDATE community_messages SET group_id=? WHERE group_id=?").run(+toGroupId, +fromGroupId);
  return r.changes || 0;
}

function listGroupsForDoctorOrdered(doctorId){
  return db.prepare(`SELECT * FROM community_groups WHERE doctor_id=?
    AND IFNULL(qiwe_hidden, 0) = 0
    ORDER BY is_business DESC, CASE WHEN data_source='qiwe' THEN 0 ELSE 1 END, status='active' DESC, id`).all(+doctorId);
}

function listCollaboratorSharedGroups(doctorId){
  return db.prepare(`
    SELECT g.* FROM community_groups g
    JOIN community_group_doctors d ON d.group_id=g.id AND d.role='collaborator'
    WHERE d.doctor_id=? AND IFNULL(g.qiwe_hidden, 0) = 0
  `).all(+doctorId);
}

function listRecentMessagesByDoctor(doctorId, limit){
  const lim = Math.min(Math.max(Number(limit) || 40, 1), 200);
  return db.prepare(`SELECT m.* FROM community_messages m
    WHERE m.doctor_id=?
    AND NOT EXISTS (
      SELECT 1 FROM community_groups g
      WHERE g.id = m.group_id
        AND COALESCE(g.data_source,'') = 'qiwe'
        AND IFNULL(g.qiwe_hidden, 0) = 1
    )
    ORDER BY m.id DESC LIMIT ?`).all(+doctorId, lim);
}

function overviewSummaryCounts(doctorId){
  const did = +doctorId;
  return {
    businessGroups: db.prepare("SELECT COUNT(*) c FROM community_groups WHERE doctor_id=? AND is_business=1 AND IFNULL(qiwe_hidden,0)=0").get(did).c,
    qiweGroups: db.prepare("SELECT COUNT(*) c FROM community_groups WHERE doctor_id=? AND data_source='qiwe' AND IFNULL(qiwe_hidden,0)=0").get(did).c,
    members: db.prepare(`SELECT COUNT(*) c FROM community_members m JOIN community_groups g ON g.id=m.group_id
      WHERE m.doctor_id=? AND m.status='active' AND m.data_source='qiwe' AND g.is_business=1 AND IFNULL(g.qiwe_hidden,0)=0`).get(did).c,
    inbound: db.prepare(`SELECT COUNT(*) c FROM community_messages m JOIN community_groups g ON g.id=m.group_id
      WHERE m.doctor_id=? AND m.data_source='qiwe' AND g.is_business=1 AND IFNULL(g.qiwe_hidden,0)=0`).get(did).c,
    flagged: db.prepare(`SELECT COUNT(*) c FROM community_messages m JOIN community_groups g ON g.id=m.group_id
      WHERE m.doctor_id=? AND g.is_business=1 AND IFNULL(g.qiwe_hidden,0)=0 AND m.moderation_flag IS NOT NULL`).get(did).c,
    messageTotal: db.prepare(`SELECT COUNT(*) c FROM community_messages m
      WHERE m.doctor_id=?
      AND NOT EXISTS (
        SELECT 1 FROM community_groups g
        WHERE g.id = m.group_id
          AND COALESCE(g.data_source,'') = 'qiwe'
          AND IFNULL(g.qiwe_hidden, 0) = 1
      )`).get(did).c
  };
}

function listActiveGroupsForWeeklyAuto(){
  return db.prepare(`SELECT g.id AS gid, g.doctor_id AS did, g.weekly_auto_last_week AS lastWeek
    FROM community_groups g
    WHERE g.status='active' AND IFNULL(g.qiwe_hidden,0)=0`).all();
}

function listMemberContacts(doctorIds){
  if(Array.isArray(doctorIds) && doctorIds.length){
    const ph = doctorIds.map(()=>"?").join(",");
    return db.prepare(`SELECT doctor_id, external_user_id, display_name FROM community_members
      WHERE doctor_id IN (${ph}) AND external_user_id IS NOT NULL AND trim(external_user_id) != ''`).all(...doctorIds);
  }
  return db.prepare(`SELECT doctor_id, external_user_id, display_name FROM community_members
    WHERE external_user_id IS NOT NULL AND trim(external_user_id) != ''`).all();
}

function contactActivityScore(userId){
  const uid = String(userId || "");
  const active = db.prepare(`SELECT COUNT(*) c FROM community_members WHERE external_user_id=? AND IFNULL(status,'active')='active'`).get(uid).c;
  const left = db.prepare(`SELECT COUNT(*) c FROM community_members WHERE external_user_id=? AND status='left'`).get(uid).c;
  const ml = db.prepare(`SELECT COUNT(*) c FROM message_log WHERE sender_id=?`).get(uid).c;
  const cm = db.prepare(`SELECT COUNT(*) c FROM community_messages msg
    JOIN community_members m ON m.id=msg.member_id WHERE m.external_user_id=?`).get(uid).c;
  let s = Math.min(ml, 100) * 20 + Math.min(cm, 50) * 10 + active * 3;
  if(active === 0 && left > 0 && ml === 0 && cm === 0) s -= 1000;
  return s;
}

module.exports = {
  nowIso,
  getGroupById,
  getGroupByDoctorAndId,
  getGroupByDoctorChannelExt,
  findByExternalGroupId,
  firstGroupByDoctor,
  countGroupsByDoctor,
  countBusinessForPrimary,
  insertGroup,
  setManualDefaults,
  updateGroupCore,
  setShareVisible,
  setDataSource,
  setIsBusiness,
  setWelcomeFlags,
  setWeeklyAutoLastWeek,
  bumpMemberCount,
  setMemberCountSynced,
  syncUpdateGroupFromQiwe,
  syncGroupNameFromQiwe,
  setGroupDoctorId,
  setQiweBusinessFlags,
  getMemberByKey,
  getMemberById,
  insertMember,
  updateMemberActive,
  markMemberLeft,
  setMemberPatientId,
  setMemberDisplayAvatar,
  reassignMemberGroup,
  deleteMember,
  deleteGroup,
  listActiveQiweMembers,
  countActiveQiweMembers,
  doctorExists,
  getDoctorBrief,
  getMessageById,
  findMessageByExternalMsgId,
  getLatestMessageByExternal,
  getMessageByExternal,
  listNearbyPeerMessages,
  findMemberIdByGroupUser,
  findLatestMemberIdByUser,
  insertMessage,
  setModerationFlag,
  setModerationFlagOpen,
  setModerationResolved,
  setModerationAiFields,
  setModerationAiUpsert,
  setModerationFull,
  setProcessStatus,
  setProcessMatched,
  setRiskProcess,
  setRiskProcessTriage,
  setRawPayload,
  reassignMessageGroup,
  listGroupsForDoctorOrdered,
  listCollaboratorSharedGroups,
  listRecentMessagesByDoctor,
  overviewSummaryCounts,
  listActiveGroupsForWeeklyAuto,
  listMemberContacts,
  contactActivityScore
};
