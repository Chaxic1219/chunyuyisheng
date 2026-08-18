"use strict";

/**
 * 患者档案后台路由（从 server.js 迁出）。
 * 消息计数/往期对话与 AI 分诊台同口径（业务群 + 企微可见群）。
 */
const { messageLogDisplayScope } = require("../qiwe_scope.js");

function registerPatientsAdminRoutes(route, ctx){
  const {
    parseBody,
    json,
    gate,
    rowDoctorId,
    requireAdminAction,
    db,
    adminScope,
    now,
    profileStore,
    autoMergePatientsByUserId,
    reconcileVerifiedPhonePersons,
    reconcileQiweIdentityPersons,
    mergePersons,
    mergePatients,
    preferDisplayName,
    patientArchive,
    decorateAdminPatient,
    hydrateAdminMessageRow,
    friendlyPatientLabel,
    patientArchiveLabel,
    allocateStaffId,
    stripChannelSuffix,
    isPlaceholderDisplayName,
    resolvePersonWechatName,
    maskPII,
    patientProfile,
    personRowForPatient
  } = ctx;

  function isPhoneLike(v){
    return /^1[3-9]\d{9}$/.test(String(v || "").trim());
  }

  function pickPhoneMergeKeep(rows){
    const list = Array.isArray(rows) ? rows.slice() : [];
    list.sort((a,b)=>{
      const av = a.verified ? 1 : 0, bv = b.verified ? 1 : 0;
      if(av !== bv) return bv - av;
      const ap = a.hasPerson ? 1 : 0, bp = b.hasPerson ? 1 : 0;
      if(ap !== bp) return bp - ap;
      const am = +a.msgCount || 0, bm = +b.msgCount || 0;
      if(am !== bm) return bm - am;
      const au = Date.parse(a.updatedAt || "") || 0, bu = Date.parse(b.updatedAt || "") || 0;
      if(au !== bu) return bu - au;
      return (+a.id || 0) - (+b.id || 0);
    });
    return list[0] || null;
  }

  function autoMergePatientsByVerifiedPhone(doctorId){
    const did = +doctorId;
    if(!Number.isInteger(did) || did <= 0) return [];
    const rows = db.prepare(`SELECT p.id, p.person_id, p.updated_at,
      COALESCE(per.phone, p.phone) AS phone_resolved,
      COALESCE(per.phone_verified, p.phone_verified, 0) AS verified_resolved,
      (SELECT COUNT(*) FROM message_log ml WHERE ml.doctor_id=p.doctor_id AND (
         ml.patient_id=CAST(p.id AS TEXT)
         OR ml.sender_id IN (SELECT external_id FROM patient_identities WHERE patient_id=p.id)
      )) AS msg_count
      FROM patients p
      LEFT JOIN persons per ON per.id = p.person_id
      WHERE p.doctor_id=?`).all(did);
    const byPhone = new Map();
    for(const r of rows){
      const phone = String(r.phone_resolved || "").trim();
      if(!isPhoneLike(phone)) continue;
      if(!byPhone.has(phone)) byPhone.set(phone, []);
      byPhone.get(phone).push({
        id:+r.id,
        verified:+r.verified_resolved === 1,
        hasPerson:!!r.person_id,
        msgCount:+r.msg_count || 0,
        updatedAt:r.updated_at || ""
      });
    }
    const merged = [];
    for(const [phone, group] of byPhone.entries()){
      if(group.length < 2) continue;
      if(!group.some(x=>x.verified)) continue; // 未验证同号不自动并
      const keep = pickPhoneMergeKeep(group);
      if(!keep) continue;
      const mergeIds = group.map(x=>x.id).filter(id=>id !== keep.id);
      if(!mergeIds.length) continue;
      try{
        mergePatients(did, keep.id, mergeIds);
        merged.push({ phone, keepId:keep.id, mergeIds });
      }catch(e){
        console.error("[patients] autoMergeByVerifiedPhone", phone, e && e.message);
      }
    }
    return merged;
  }

/* 统一患者档案列表（企微入站建档 + 联络表）；按最后对话时间排序 */
route("GET", /^\/api\/admin\/patients$/, (req,res,m,q)=>{
  const did = +q.doctorId;
  const s = gate(req,res,did); if(!s) return;
  // 跨医生已验证同号 → 同一 person（不合并 patient）
  try{ reconcileVerifiedPhonePersons(); }catch(e){ console.error("[patients] reconcileVerifiedPhone", e && e.message); }
  // 跨医生同企微 userId / external_id → 同一 person
  try{ reconcileQiweIdentityPersons(); }catch(e){ console.error("[patients] reconcileQiweIdentity", e && e.message); }
  // 同 userId 自动合并（幂等，无需人工审查）
  try{ autoMergePatientsByUserId(did); }catch(e){ console.error("[patients] autoMerge", e && e.message); }
  const phoneMerged = autoMergePatientsByVerifiedPhone(did);
  const phoneMergedByKeep = new Map();
  for(const g of phoneMerged){
    if(!phoneMergedByKeep.has(g.keepId)) phoneMergedByKeep.set(g.keepId, []);
    phoneMergedByKeep.get(g.keepId).push(...g.mergeIds);
  }
  const mlScope = messageLogDisplayScope(did, "ml").sql;
  const rows = db.prepare(`
    SELECT p.id, p.display_name, p.real_name, p.phone, p.phone_verified, p.follow_stage, p.notes, p.created_at, p.updated_at,
      p.family_role, p.family_household_id, p.family_doctor_enrolled, p.avatar_url, p.person_id,
      COALESCE(per.real_name, p.real_name) AS resolved_real_name,
      COALESCE(per.phone, p.phone) AS resolved_phone,
      COALESCE(per.phone_verified, p.phone_verified) AS resolved_phone_verified,
      (SELECT GROUP_CONCAT(DISTINCT channel) FROM patient_identities WHERE patient_id=p.id) AS channels,
      (SELECT COUNT(*) FROM message_log ml WHERE ml.doctor_id=p.doctor_id AND (
         ml.patient_id=CAST(p.id AS TEXT)
         OR ml.sender_id IN (SELECT external_id FROM patient_identities WHERE patient_id=p.id)
       ) ${mlScope}) AS msg_count,
      (SELECT MAX(created_at) FROM message_log ml WHERE ml.doctor_id=p.doctor_id AND (
         ml.patient_id=CAST(p.id AS TEXT)
         OR ml.sender_id IN (SELECT external_id FROM patient_identities WHERE patient_id=p.id)
       ) ${mlScope}) AS last_msg_at,
      (SELECT text FROM message_log ml WHERE ml.doctor_id=p.doctor_id AND (
         ml.patient_id=CAST(p.id AS TEXT)
         OR ml.sender_id IN (SELECT external_id FROM patient_identities WHERE patient_id=p.id)
       ) ${mlScope} ORDER BY ml.created_at DESC, ml.id DESC LIMIT 1) AS last_msg_text,
      (SELECT COALESCE(
          (SELECT g.name FROM message_log ml
            LEFT JOIN community_groups g ON g.doctor_id=p.doctor_id
              AND (g.external_group_id=ml.group_id OR CAST(g.id AS TEXT)=ml.group_id)
              AND IFNULL(g.qiwe_hidden,0)=0
            WHERE ml.doctor_id=p.doctor_id AND (
              ml.patient_id=CAST(p.id AS TEXT)
              OR ml.sender_id IN (SELECT external_id FROM patient_identities WHERE patient_id=p.id)
            ) AND ml.group_id IS NOT NULL AND trim(ml.group_id)!=''
            ${mlScope}
            ORDER BY ml.created_at DESC, ml.id DESC LIMIT 1),
          (SELECT g2.name FROM community_messages cm
            JOIN community_members mb ON mb.id=cm.member_id
            JOIN community_groups g2 ON g2.id=cm.group_id
            WHERE mb.doctor_id=p.doctor_id AND IFNULL(g2.qiwe_hidden,0)=0 AND (
              mb.patient_id=p.id
              OR mb.external_user_id IN (SELECT external_id FROM patient_identities WHERE patient_id=p.id)
            )
            ORDER BY cm.created_at DESC, cm.id DESC LIMIT 1)
        )) AS last_group_name,
      (SELECT COUNT(*) FROM patient_health_records phr WHERE phr.person_id = p.person_id OR (p.person_id IS NULL AND phr.patient_id = p.id)) AS health_record_count,
      COALESCE(
        NULLIF(trim(p.avatar_url),''),
        (SELECT avatar_url FROM community_members cm
          WHERE cm.doctor_id=p.doctor_id AND cm.patient_id=p.id
            AND cm.avatar_url IS NOT NULL AND trim(cm.avatar_url)!=''
          ORDER BY cm.id DESC LIMIT 1),
        (SELECT avatar_url FROM community_members cm
          WHERE cm.doctor_id=p.doctor_id
            AND cm.external_user_id IN (SELECT external_id FROM patient_identities WHERE patient_id=p.id)
            AND cm.avatar_url IS NOT NULL AND trim(cm.avatar_url)!=''
          ORDER BY cm.id DESC LIMIT 1)
      ) AS resolved_avatar
    FROM patients p
    LEFT JOIN persons per ON per.id = p.person_id
    WHERE p.doctor_id=? AND (p.archived_at IS NULL OR trim(p.archived_at)='')
    ORDER BY CASE WHEN last_msg_at IS NULL OR last_msg_at='' THEN 1 ELSE 0 END,
             last_msg_at DESC,
             p.updated_at DESC,
             p.id DESC
    LIMIT 500`).all(did);
  const contactForms = db.prepare(`SELECT patient_id, payload, created_at FROM submissions
    WHERE doctor_id=? AND type='联络表' AND patient_id IS NOT NULL ORDER BY id DESC LIMIT 500`).all(did);
  const formByPid = new Map();
  for(const f of contactForms){
    if(!formByPid.has(f.patient_id)){
      try{ formByPid.set(f.patient_id, JSON.parse(f.payload || "{}")); }catch(e){ formByPid.set(f.patient_id, {}); }
    }
  }
  const diseaseByPid = new Map();
  try{
    db.prepare(`SELECT p.id AS patient_id, ppf.field_value FROM patients p
      JOIN patient_profile_fields ppf ON ppf.person_id = p.person_id AND ppf.field_key='disease'
      WHERE p.doctor_id=? AND p.person_id IS NOT NULL`).all(did)
      .forEach((row)=>{
        const v = patientProfile.decodeFieldValue(row.field_value);
        if(v != null && String(v).trim()) diseaseByPid.set(+row.patient_id, String(v).trim());
      });
    db.prepare("SELECT patient_id, field_value FROM patient_profile_fields WHERE doctor_id=? AND field_key='disease' AND (person_id IS NULL OR person_id=0)")
      .all(did)
      .forEach((row)=>{
        const v = patientProfile.decodeFieldValue(row.field_value);
        if(v != null && String(v).trim()) diseaseByPid.set(+row.patient_id, String(v).trim());
      });
  }catch(e){}

  const mapped = rows.map(r=>{
    const form = formByPid.get(r.id) || {};
    let externalId = "";
    try{
      const idn = db.prepare("SELECT external_id FROM patient_identities WHERE patient_id=? AND channel IN ('qiwe','wecom') ORDER BY id DESC LIMIT 1").get(r.id);
      if(idn) externalId = idn.external_id || "";
    }catch(e){}
    const channels = r.channels || (externalId ? "qiwe" : "");
    const displayName = patientArchiveLabel({
      doctorId:did, patientId:r.id, displayName:r.display_name, realName:r.resolved_real_name || r.real_name || form["姓名"] || "",
      channels, externalId
    });
    const wechatName = resolvePersonWechatName(r.person_id, did, r.id) || "";
    return {
      id:r.id,
      displayName,
      wechatName,
      realName:r.resolved_real_name || r.real_name || form["姓名"] || "",
      phone:r.resolved_phone || r.phone || form["手机号"] || "",
      disease:form["您所患的疾病"] || form["主要疾病 / 主诉"] || form["主要疾病"] || diseaseByPid.get(r.id) || "",
      city:form["所在城市"] || "",
      channels,
      followStage:r.follow_stage || "",
      notes:r.notes || "",
      msgCount:r.msg_count || 0,
      lastMsgAt:r.last_msg_at || null,
      lastMsgText:r.last_msg_text || "",
      lastGroupName:r.last_group_name || "",
      avatarUrl:r.resolved_avatar || r.avatar_url || "",
      createdAt:r.created_at,
      updatedAt:r.updated_at,
      phoneVerified:!!(r.resolved_phone_verified != null ? r.resolved_phone_verified : r.phone_verified),
      hasContactForm:formByPid.has(r.id),
      externalIdTail: externalId ? String(externalId).slice(-4) : "",
      externalId: externalId || "",
      familyRole:r.family_role || "",
      familyHouseholdId:r.family_household_id || "",
      familyDoctorEnrolled:!!r.family_doctor_enrolled,
      healthRecordCount:r.health_record_count || 0,
      personId:r.person_id || null,
      autoMergedPhoneIds: phoneMergedByKeep.get(r.id) || [],
      autoMergedPhoneCount: (phoneMergedByKeep.get(r.id) || []).length,
      _baseName: (()=>{
        const n = stripChannelSuffix(displayName || r.real_name || form["姓名"] || r.display_name || "");
        return n && !isPlaceholderDisplayName(n) ? n.toLowerCase() : "";
      })(),
      // 企业微信主体账号标记（「医生助手 @春雨家庭医生」）
      _isCorpAccount: /\s@[^\s·]+/.test(String(r.display_name||"")) || /\s@[^\s·]+/.test(String(r.real_name||"")) || /\s@[^\s·]+/.test(String(displayName||""))
    };
  }).filter(r => !r._isCorpAccount);

  // 批量查询每个患者跨医生咨询记录（按 person_id）
  const personIds = [...new Set(mapped.map(r=>r.personId).filter(Boolean))];
  const consultingDoctorsByPerson = new Map();
  if(personIds.length){
    const ph = personIds.map(()=>"?").join(",");
    const cdRows = db.prepare(`
      SELECT p.person_id, d.id AS doctorId, d.name AS doctorName
      FROM patients p JOIN doctors d ON d.id=p.doctor_id
      WHERE p.person_id IN (${ph})
      ORDER BY p.person_id, d.id
    `).all(...personIds);
    for(const r of cdRows){
      if(!consultingDoctorsByPerson.has(r.person_id)) consultingDoctorsByPerson.set(r.person_id,[]);
      consultingDoctorsByPerson.get(r.person_id).push({ doctorId:r.doctorId, doctorName:r.doctorName||"" });
    }
  }
  for(const r of mapped){
    r.consultingDoctors = r.personId ? (consultingDoctorsByPerson.get(r.personId) || []) : [];
    r.consultingDoctorCount = r.consultingDoctors.length;
  }

  // 列表兜底：同真实 userId 只保留一条（合并失败时仍不重复展示）
  const byEid = new Map();
  const list = [];
  for(const r of mapped){
    const eid = String(r.externalId || "").trim();
    const realEid = eid && !/^phone:/i.test(eid) && !/^local-/i.test(eid) && !/^join-name:/i.test(eid);
    if(!realEid){ list.push(r); continue; }
    const prev = byEid.get(eid);
    if(!prev){
      byEid.set(eid, r);
      list.push(r);
      continue;
    }
    // 保留消息更多的；被丢掉的 id 记入保留行的合并提示
    const keep = (r.msgCount || 0) > (prev.msgCount || 0) ? r : prev;
    const drop = keep === r ? prev : r;
    if(keep === r){
      const idx = list.indexOf(prev);
      if(idx >= 0) list[idx] = r;
      byEid.set(eid, r);
    }
    keep._dedupeDropIds = keep._dedupeDropIds || [];
    keep._dedupeDropIds.push(drop.id);
  }

  // 疑似同一人：同名但 userId 不同（真同 userId 已在上方/自动合并收敛）
  const byName = new Map();
  for(const r of list){
    if(!r._baseName || r._baseName.length < 2) continue;
    if(!byName.has(r._baseName)) byName.set(r._baseName, []);
    byName.get(r._baseName).push(r.id);
  }
  for(const r of list){
    const peers = r._baseName ? (byName.get(r._baseName) || []) : [];
    const namePeers = peers.filter(id => id !== r.id);
    r.suspectDuplicateIds = namePeers;
    r.suspectDuplicateCount = namePeers.length;
    delete r._baseName;
    delete r._dedupeDropIds;
  }

  // 同号未验证：仅提示，不自动合并（由医助在列表页确认合并）
  const byPhone = new Map();
  for(const r of list){
    const phone = String(r.phone || "").trim();
    if(!isPhoneLike(phone)) continue;
    if(!byPhone.has(phone)) byPhone.set(phone, []);
    byPhone.get(phone).push(r);
  }
  for(const [phone, group] of byPhone.entries()){
    if(group.length < 2) continue;
    if(group.some(x=>!!x.phoneVerified)) continue;
    const keep = pickPhoneMergeKeep(group.map(x=>({
      id:x.id,
      verified:!!x.phoneVerified,
      hasPerson:!!x.personId,
      msgCount:x.msgCount || 0,
      updatedAt:x.updatedAt || x.createdAt || ""
    })));
    const suggestedKeepId = keep ? keep.id : group[0].id;
    const groupIds = group.map(x=>x.id);
    group.forEach((r)=>{
      r.duplicatePhonePending = true;
      r.duplicatePhone = phone;
      r.duplicatePhoneGroupIds = groupIds;
      r.duplicatePhoneGroupSize = group.length;
      r.duplicatePhoneSuggestedKeepId = suggestedKeepId;
    });
  }

  const kw = String(q.q || "").trim().toLowerCase();
  let filtered = list;
  if(kw){
    filtered = list.filter((r) => JSON.stringify(r).toLowerCase().includes(kw));
  }
  const total = filtered.length;
  const paginate = q.q !== undefined || q.offset !== undefined || q.limit !== undefined;
  if(paginate){
    const offset = Math.max(0, Number(q.offset) || 0);
    const pageLimit = Math.min(100, Math.max(1, Number(q.limit) || 50));
    return json(res, 200, { ok: true, items: filtered.slice(offset, offset + pageLimit), total, offset, limit: pageLimit });
  }
  json(res,200, list);
});

/* 该患者通过 person_id 关联的所有医生（跨医生咨询记录） */
route("GET", /^\/api\/admin\/patients\/(\d+)\/doctors$/, (req,res,m,q)=>{
  const did = +q.doctorId;
  const s = gate(req,res,did); if(!s) return;
  const pid = +m[1];
  const patient = db.prepare("SELECT id, person_id FROM patients WHERE id=? AND doctor_id=?").get(pid, did);
  if(!patient) return json(res,404,{ error:"患者不存在" });
  if(!patient.person_id) return json(res,200,{ ok:true, doctors:[], personId:null });
  const rows = db.prepare(`
    SELECT d.id, d.name AS doctorName,
      (SELECT hospital FROM hospitals WHERE id=d.id LIMIT 1) AS hospital,
      p.id AS patientId,
      p.display_name AS displayName,
      p.real_name AS realName,
      p.updated_at AS lastAt,
      (SELECT COUNT(*) FROM message_log ml
        WHERE ml.doctor_id=d.id AND ml.patient_id=CAST(p.id AS TEXT)) AS msgCount
    FROM patients p
    JOIN doctors d ON d.id = p.doctor_id
    WHERE p.person_id = ?
    ORDER BY p.doctor_id = ? DESC, p.updated_at DESC
  `).all(patient.person_id, did);
  const doctors = rows.map(r=>({
    doctorId: r.id,
    doctorName: r.doctorName || "",
    hospital: r.hospital || "",
    patientId: r.patientId,
    displayName: r.displayName || r.realName || "",
    isCurrent: r.id === did,
    msgCount: r.msgCount || 0,
    lastAt: r.lastAt || ""
  }));
  json(res,200,{ ok:true, doctors, personId:patient.person_id });
});

route("POST", /^\/api\/admin\/patients\/merge-preview$/, async (req,res)=>{
  const b = await parseBody(req);
  const did = Number(b.doctorId);
  const s = gate(req,res,did); if(!s) return;
  if(!requireAdminAction(req,res,s,"patients.merge",{doctorId:did},"无患者合并权限")) return;
  try{
    const result = patientArchive.buildMergePreview(db, { preferDisplayName, mergePersons }, did, b.patientIdA, b.patientIdB);
    json(res,200, result);
  }catch(e){
    json(res,400,{ error: String(e && e.message || e) });
  }
});

route("POST", /^\/api\/admin\/patients\/merge$/, async (req,res)=>{
  const b = await parseBody(req);
  const did = Number(b.doctorId);
  const s = gate(req,res,did); if(!s) return;
  if(!requireAdminAction(req,res,s,"patients.merge",{doctorId:did},"无患者合并权限")) return;
  try{
    const mergeIds = Array.isArray(b.mergeIds) ? b.mergeIds.map(Number).filter((x)=>Number.isInteger(x) && x > 0) : [];
    const sourceId = b.sourceId != null ? Number(b.sourceId) : mergeIds[0];
    // 手动两档 + 字段决议 / 要可撤销 → 软合并
    if(b.soft !== false && (b.fieldResolutions || mergeIds.length <= 1)){
      if(!sourceId || mergeIds.length > 1){
        return json(res,400,{ error:"本期手动合并仅支持恰好两份档案" });
      }
      const result = patientArchive.softMergePatients(db, {
        preferDisplayName,
        mergePersons
      }, {
        doctorId: did,
        keepId: b.keepId,
        sourceId,
        fieldResolutions: b.fieldResolutions || {},
        createdBy: s && (s.adminId || s.id) || null
      });
      return json(res,200, result);
    }
    const result = mergePatients(did, b.keepId, mergeIds);
    json(res,200, result);
  }catch(e){
    const status = e && e.status || 400;
    json(res, status, { error: String(e && e.message || e) });
  }
});

route("POST", /^\/api\/admin\/patients\/(\d+)\/archive$/, async (req,res,m)=>{
  const b = await parseBody(req);
  const did = Number(b.doctorId);
  const s = gate(req,res,did); if(!s) return;
  if(!requireAdminAction(req,res,s,"patients.archive",{doctorId:did},"无患者删除权限")) return;
  try{
    const result = patientArchive.softDeletePatient(db, {
      doctorId: did,
      patientId: +m[1],
      createdBy: s && (s.adminId || s.id) || null
    });
    json(res,200, result);
  }catch(e){
    json(res,400,{ error: String(e && e.message || e) });
  }
});

route("GET", /^\/api\/admin\/patients\/recycle-bin$/, (req,res,m,q)=>{
  const did = +q.doctorId;
  const s = gate(req,res,did); if(!s) return;
  if(!requireAdminAction(req,res,s,"patients.merge",{doctorId:did},"无回收站权限")) return;
  try{
    const items = patientArchive.listRecycleBin(db, did);
    json(res,200,{ ok:true, items });
  }catch(e){
    json(res,400,{ error: String(e && e.message || e) });
  }
});

route("POST", /^\/api\/admin\/patients\/archive-ops\/(\d+)\/undo$/, async (req,res,m)=>{
  const b = await parseBody(req);
  const did = Number(b.doctorId);
  const s = gate(req,res,did); if(!s) return;
  const oid = +m[1];
  const op = db.prepare("SELECT op_type FROM patient_archive_ops WHERE id=? AND doctor_id=?").get(oid, did);
  if(!op) return json(res,404,{ error:"操作记录不存在" });
  const action = op.op_type === "delete" ? "patients.archive" : "patients.merge";
  if(!requireAdminAction(req,res,s,action,{doctorId:did},"无撤销权限")) return;
  try{
    const result = patientArchive.undoArchiveOp(db, {
      preferDisplayName,
      mergePersons
    }, did, oid);
    json(res,200, result);
  }catch(e){
    json(res, e && e.status || 400, { error: String(e && e.message || e) });
  }
});

route("PUT", /^\/api\/admin\/patients\/(\d+)\/family$/, async (req,res,m)=>{
  const b = await parseBody(req);
  const did = Number(b.doctorId);
  const s=gate(req,res,did); if(!s)return;
  if(!requireAdminAction(req,res,s,"patients.family.update",{doctorId:did},"无家庭医生档案编辑权限")) return;
  const pid = +m[1];
  const patient = db.prepare("SELECT id FROM patients WHERE id=? AND doctor_id=?").get(pid, did);
  if(!patient) return json(res,404,{error:"患者不存在"});
  const ROLE_OK = new Set(["","self","spouse","child","parent","other"]);
  const role = String(b.familyRole == null ? "" : b.familyRole).trim();
  if(!ROLE_OK.has(role)) return json(res,400,{error:"familyRole 非法"});
  let household = String(b.familyHouseholdId == null ? "" : b.familyHouseholdId).trim().slice(0, 80);
  if(b.enrollFamilyDoctor && !household) household = "hh-" + did + "-" + pid;
  const enrolled = b.familyDoctorEnrolled === true || b.familyDoctorEnrolled === 1 || b.enrollFamilyDoctor === true ? 1 : 0;
  db.prepare("UPDATE patients SET family_role=?,family_household_id=?,family_doctor_enrolled=?,updated_at=? WHERE id=?")
    .run(role || null, household || null, enrolled, new Date().toISOString(), pid);
  const householdMembers = household
    ? db.prepare("SELECT id,display_name,real_name,family_role,family_doctor_enrolled FROM patients WHERE doctor_id=? AND family_household_id=? ORDER BY id").all(did, household)
    : [];
  json(res,200,{
    ok:true,
    patient:{ id:pid, familyRole:role, familyHouseholdId:household, familyDoctorEnrolled:!!enrolled },
    householdMembers
  });
});

/* 患者往期全部对话（档案子页） */
route("GET", /^\/api\/admin\/patients\/(\d+)\/messages$/, (req,res,m,q)=>{
  const did = +q.doctorId;
  const s = gate(req,res,did); if(!s) return;
  const pid = +m[1];
  const patient = db.prepare("SELECT * FROM patients WHERE id=? AND doctor_id=?").get(pid, did);
  if(!patient) return json(res,404,{ error:"患者不存在" });
  const exteriors = db.prepare("SELECT external_id FROM patient_identities WHERE patient_id=?").all(pid).map(x=>x.external_id).filter(Boolean);
  const limit = Math.min(Math.max(+(q.limit || 500), 1), 1000);
  const displayScope = messageLogDisplayScope(did);
  let rows = [];
  if(exteriors.length){
    const ph = exteriors.map(()=>"?").join(",");
    rows = db.prepare(`SELECT * FROM message_log
      WHERE doctor_id=? AND (patient_id=? OR sender_id IN (${ph})) ${displayScope.sql}
      ORDER BY created_at ASC, id ASC LIMIT ?`).all(did, String(pid), ...exteriors, ...displayScope.params, limit);
  }else{
    rows = db.prepare(`SELECT * FROM message_log
      WHERE doctor_id=? AND patient_id=? ${displayScope.sql}
      ORDER BY created_at ASC, id ASC LIMIT ?`).all(did, String(pid), ...displayScope.params, limit);
  }
  const groupNameCache = new Map();
  function resolveMsgGroupName(gid){
    const key = String(gid == null ? "" : gid).trim();
    if(!key) return "";
    if(groupNameCache.has(key)) return groupNameCache.get(key);
    let name = "";
    try{
      const g = db.prepare(`SELECT name FROM community_groups
        WHERE doctor_id=? AND (external_group_id=? OR CAST(id AS TEXT)=?)
        LIMIT 1`).get(did, key, key);
      name = (g && g.name) || "";
    }catch(e){}
    if(!name) name = key.length > 16 ? ("群 " + key.slice(-6)) : ("群 " + key);
    groupNameCache.set(key, name);
    return name;
  }
  const messages = rows.map(r=>{
    const groupId = r.group_id || "";
    const direction = String(r.direction || "inbound").toLowerCase();
    const outbound = direction === "outbound" || direction === "out" || direction === "reply";
    return {
      id:r.id,
      direction: outbound ? "outbound" : "inbound",
      text:r.text || "",
      channel:r.channel || "",
      level:r.level || "",
      levelLabel:r.level_label || "",
      replyStatus:r.reply_status || "",
      actionTaken:r.action_taken || "",
      aiDraft:r.ai_draft || "",
      patientName:r.patient_name || "",
      senderId:r.sender_id || "",
      groupId,
      groupName: groupId ? resolveMsgGroupName(groupId) : "企微私聊",
      createdAt:r.created_at || ""
    };
  });
  const groupCount = new Map();
  for(const m of messages){
    const k = m.groupId || "__none__";
    const label = m.groupName || "企微私聊";
    if(!groupCount.has(k)) groupCount.set(k, { id:k, name:label, count:0 });
    groupCount.get(k).count++;
  }
  json(res,200,{
    patient:{
      id:patient.id,
      displayName:patientArchiveLabel({
        doctorId:did, patientId:patient.id, displayName:patient.display_name, realName:patient.real_name || "",
        channels: exteriors.length ? "qiwe" : "", externalId:exteriors[0] || ""
      }),
      realName:patient.real_name || "",
      phone:patient.phone || "",
      notes:patient.notes || "",
      followStage:patient.follow_stage || "",
      familyRole:patient.family_role || "",
      familyHouseholdId:patient.family_household_id || "",
      familyDoctorEnrolled:!!patient.family_doctor_enrolled,
      avatarUrl:patient.avatar_url || ""
    },
    householdMembers: (patient.family_household_id
      ? db.prepare("SELECT id,display_name,real_name,family_role,family_doctor_enrolled FROM patients WHERE doctor_id=? AND family_household_id=? ORDER BY id")
          .all(did, patient.family_household_id)
      : []).map(x=>({
        id:x.id, displayName:x.display_name||"", realName:x.real_name||"",
        familyRole:x.family_role||"", familyDoctorEnrolled:!!x.family_doctor_enrolled
      })),
    groups: [...groupCount.values()].sort((a,b)=>b.count - a.count),
    messages,
    total:messages.length
  });
});

/* 患者健康记录：分类目录 + CRUD（运营档案，非完整 EHR） */
const phr = require("../patient_health_records.js");

route("GET", /^\/api\/admin\/patients\/(\d+)\/health-records$/, (req,res,m,q)=>{
  const did = +q.doctorId;
  const s = gate(req,res,did); if(!s) return;
  const pid = +m[1];
  const patient = db.prepare("SELECT id, person_id FROM patients WHERE id=? AND doctor_id=?").get(pid, did);
  if(!patient) return json(res,404,{ error:"患者不存在" });
  const personId = patient.person_id;
  const catFilter = String(q.category || "").trim();
  let rows;
  if(personId){
    if(catFilter){
      if(!phr.HEALTH_RECORD_CATEGORY_KEYS.has(catFilter)) return json(res,400,{ error:"category 非法" });
      rows = db.prepare(`SELECT phr.*, d.name AS source_doctor_name
        FROM patient_health_records phr
        LEFT JOIN doctors d ON d.id = phr.doctor_id
        WHERE phr.person_id=? AND phr.category=?
        ORDER BY COALESCE(phr.recorded_at,'') DESC, phr.id DESC`).all(personId, catFilter);
    }else{
      rows = db.prepare(`SELECT phr.*, d.name AS source_doctor_name
        FROM patient_health_records phr
        LEFT JOIN doctors d ON d.id = phr.doctor_id
        WHERE phr.person_id=?
        ORDER BY COALESCE(phr.recorded_at,'') DESC, phr.id DESC`).all(personId);
    }
  }else if(catFilter){
    if(!phr.HEALTH_RECORD_CATEGORY_KEYS.has(catFilter)) return json(res,400,{ error:"category 非法" });
    rows = db.prepare(`SELECT phr.*, d.name AS source_doctor_name
      FROM patient_health_records phr
      LEFT JOIN doctors d ON d.id = phr.doctor_id
      WHERE phr.doctor_id=? AND phr.patient_id=? AND phr.category=?
      ORDER BY COALESCE(phr.recorded_at,'') DESC, phr.id DESC`).all(did, pid, catFilter);
  }else{
    rows = db.prepare(`SELECT phr.*, d.name AS source_doctor_name
      FROM patient_health_records phr
      LEFT JOIN doctors d ON d.id = phr.doctor_id
      WHERE phr.doctor_id=? AND phr.patient_id=?
      ORDER BY COALESCE(phr.recorded_at,'') DESC, phr.id DESC`).all(did, pid);
  }
  const counts = {};
  for(const c of phr.HEALTH_RECORD_CATEGORIES) counts[c.key] = 0;
  const countRows = personId
    ? db.prepare(`SELECT category, COUNT(*) AS c FROM patient_health_records WHERE person_id=? GROUP BY category`).all(personId)
    : db.prepare(`SELECT category, COUNT(*) AS c FROM patient_health_records WHERE doctor_id=? AND patient_id=? GROUP BY category`).all(did, pid);
  for(const r of countRows) counts[r.category] = r.c || 0;
  json(res,200,{
    categories: phr.HEALTH_RECORD_CATEGORIES.map(c=>({
      ...c,
      count: counts[c.key] || 0
    })),
    items: rows.map(phr.mapHealthRecordRow),
    total: rows.length
  });
});

route("POST", /^\/api\/admin\/patients\/(\d+)\/health-records$/, async (req,res,m)=>{
  const b = await parseBody(req);
  const did = Number(b.doctorId);
  const s = gate(req,res,did); if(!s) return;
  if(!requireAdminAction(req,res,s,"patients.health.update",{doctorId:did},"无健康记录编辑权限")) return;
  const pid = +m[1];
  const patient = db.prepare("SELECT id, person_id FROM patients WHERE id=? AND doctor_id=?").get(pid, did);
  if(!patient) return json(res,404,{ error:"患者不存在" });
  const category = String(b.category || "").trim();
  if(!phr.HEALTH_RECORD_CATEGORY_KEYS.has(category)) return json(res,400,{ error:"category 非法" });
  const title = String(b.title == null ? "" : b.title).trim().slice(0, 200);
  const summary = String(b.summary == null ? "" : b.summary).trim().slice(0, 4000);
  const recordedAt = String(b.recordedAt == null ? "" : b.recordedAt).trim().slice(0, 40);
  const extra = b.extra && typeof b.extra === "object" ? b.extra : {};
  const attachments = Array.isArray(b.attachments) ? b.attachments.slice(0, 20) : [];
  const now = new Date().toISOString();
  const createdBy = (s && (s.username || s.displayName || s.adminName)) || "";
  const info = db.prepare(`INSERT INTO patient_health_records
    (doctor_id,patient_id,person_id,category,title,summary,recorded_at,extra,attachments,created_by,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    did, pid, patient.person_id || null, category, title, summary, recordedAt || null,
    JSON.stringify(extra), JSON.stringify(attachments),
    String(createdBy).slice(0, 80), now, now
  );
  const row = db.prepare("SELECT * FROM patient_health_records WHERE id=?").get(info.lastInsertRowid);
  json(res,200,{ ok:true, item: phr.mapHealthRecordRow(row) });
});

route("PUT", /^\/api\/admin\/patients\/(\d+)\/health-records\/(\d+)$/, async (req,res,m)=>{
  const b = await parseBody(req);
  const did = Number(b.doctorId);
  const s = gate(req,res,did); if(!s) return;
  if(!requireAdminAction(req,res,s,"patients.health.update",{doctorId:did},"无健康记录编辑权限")) return;
  const pid = +m[1];
  const rid = +m[2];
  const patient = db.prepare("SELECT person_id FROM patients WHERE id=? AND doctor_id=?").get(pid, did);
  if(!patient) return json(res,404,{ error:"患者不存在" });
  const row = patient.person_id
    ? db.prepare("SELECT * FROM patient_health_records WHERE id=? AND person_id=?").get(rid, patient.person_id)
    : db.prepare("SELECT * FROM patient_health_records WHERE id=? AND patient_id=? AND doctor_id=?").get(rid, pid, did);
  if(!row) return json(res,404,{ error:"记录不存在" });
  let category = row.category;
  if(b.category != null){
    category = String(b.category || "").trim();
    if(!phr.HEALTH_RECORD_CATEGORY_KEYS.has(category)) return json(res,400,{ error:"category 非法" });
  }
  const title = b.title != null ? String(b.title).trim().slice(0, 200) : (row.title || "");
  const summary = b.summary != null ? String(b.summary).trim().slice(0, 4000) : (row.summary || "");
  const recordedAt = b.recordedAt != null ? String(b.recordedAt).trim().slice(0, 40) : (row.recorded_at || "");
  const extra = b.extra && typeof b.extra === "object" ? b.extra : (()=>{ try{ return JSON.parse(row.extra||"{}"); }catch(e){ return {}; } })();
  const attachments = Array.isArray(b.attachments) ? b.attachments.slice(0, 20)
    : (()=>{ try{ return JSON.parse(row.attachments||"[]"); }catch(e){ return []; } })();
  const now = new Date().toISOString();
  db.prepare(`UPDATE patient_health_records SET category=?,title=?,summary=?,recorded_at=?,extra=?,attachments=?,updated_at=?
    WHERE id=?`).run(category, title, summary, recordedAt || null, JSON.stringify(extra), JSON.stringify(attachments), now, rid);
  const next = db.prepare("SELECT * FROM patient_health_records WHERE id=?").get(rid);
  json(res,200,{ ok:true, item: phr.mapHealthRecordRow(next) });
});

route("DELETE", /^\/api\/admin\/patients\/(\d+)\/health-records\/(\d+)$/, (req,res,m,q)=>{
  const did = +q.doctorId;
  const s = gate(req,res,did); if(!s) return;
  if(!requireAdminAction(req,res,s,"patients.health.update",{doctorId:did},"无健康记录编辑权限")) return;
  const pid = +m[1];
  const rid = +m[2];
  const patient = db.prepare("SELECT person_id FROM patients WHERE id=? AND doctor_id=?").get(pid, did);
  if(!patient) return json(res,404,{ error:"患者不存在" });
  const row = patient.person_id
    ? db.prepare("SELECT id FROM patient_health_records WHERE id=? AND person_id=?").get(rid, patient.person_id)
    : db.prepare("SELECT id FROM patient_health_records WHERE id=? AND patient_id=? AND doctor_id=?").get(rid, pid, did);
  if(!row) return json(res,404,{ error:"记录不存在" });
  db.prepare("DELETE FROM patient_health_records WHERE id=?").run(rid);
  json(res,200,{ ok:true });
});

/* 患者基础档案（医患通 11 项：核心列 + profile 扩展层） */

route("GET", /^\/api\/admin\/patients\/(\d+)\/profile$/, (req,res,m,q)=>{
  const did = +q.doctorId;
  const s = gate(req,res,did); if(!s) return;
  const pid = +m[1];
  const patient = db.prepare("SELECT * FROM patients WHERE id=? AND doctor_id=?").get(pid, did);
  if(!patient) return json(res,404,{ error:"患者不存在" });
  const person = personRowForPatient(patient);
  const fields = patient.person_id
    ? profileStore.readPersonFields(patient.person_id)
    : profileStore.readFields(did, pid);
  const metaRows = patient.person_id
    ? db.prepare(
      "SELECT field_key, source, updated_by, updated_at FROM patient_profile_fields WHERE person_id=?"
    ).all(patient.person_id)
    : db.prepare(
      "SELECT field_key, source, updated_by, updated_at FROM patient_profile_fields WHERE doctor_id=? AND patient_id=?"
    ).all(did, pid);
  const fieldMeta = {};
  for(const r of metaRows){
    fieldMeta[r.field_key] = {
      source: r.source || "",
      updatedBy: r.updated_by || "",
      updatedAt: r.updated_at || ""
    };
  }
  const extension = patientProfile.pickAdminExtension(fields);
  const wechatName = resolvePersonWechatName(patient.person_id, did, pid) || "";
  json(res,200,{
    ok:true,
    patient:{
      id: patient.id,
      name: (person && person.real_name) || patient.real_name || patient.display_name || "",
      wechatName,
      wechatGroupName: wechatName,
      gender: (person && person.gender) || patient.gender || "",
      birthDate: (person && person.birth_date) || patient.birth_date || "",
      phone: (person && person.phone) || patient.phone || "",
      phoneVerified: person ? !!person.phone_verified : !!patient.phone_verified
    },
    profile:{
      disease: fields.disease || "",
      pregnancyStatus: fields.pregnancyStatus || "",
      foodContactAllergies: fields.foodContactAllergies || { values: [], other: "" },
      drugAllergies: fields.drugAllergies || { values: [], other: "" },
      diseaseHistory: fields.diseaseHistory || { values: [], other: "" }
    },
    extension,
    adminOnlyFields: patientProfile.ADMIN_ONLY_FIELDS,
    fieldMeta
  });
});

route("PUT", /^\/api\/admin\/patients\/(\d+)\/profile$/, async (req,res,m)=>{
  const b = await parseBody(req);
  const did = Number(b.doctorId);
  const s = gate(req,res,did); if(!s) return;
  if(!requireAdminAction(req,res,s,"patients.health.update",{doctorId:did},"无患者档案编辑权限")) return;
  const pid = +m[1];
  const patient = db.prepare("SELECT * FROM patients WHERE id=? AND doctor_id=?").get(pid, did);
  if(!patient) return json(res,404,{ error:"患者不存在" });
  const person = personRowForPatient(patient);
  const personId = patient.person_id;

  let nextName = (person && person.real_name) || patient.real_name || "";
  let nextGender = (person && person.gender) || patient.gender || "";
  let nextBirth = (person && person.birth_date) || patient.birth_date || "";
  let nextPhone = (person && person.phone) || patient.phone || "";
  let identityChanged = false;
  if(b.name != null){
    nextName = String(b.name).trim().slice(0, 80);
    identityChanged = true;
  }
  if(b.gender != null){
    const g = String(b.gender).trim();
    if(g && g !== "男" && g !== "女") return json(res,400,{ error:"性别无效" });
    nextGender = g;
    identityChanged = true;
  }
  if(b.birthDate != null){
    const raw = String(b.birthDate).trim();
    if(raw){
      const parsed = patientProfile.parseBirthDate(raw);
      if(!parsed) return json(res,400,{ error:"出生日期无效" });
      nextBirth = parsed;
    }else{
      nextBirth = "";
    }
    identityChanged = true;
  }
  const phoneVerified = person ? !!person.phone_verified : !!patient.phone_verified;
  if(Object.prototype.hasOwnProperty.call(b, "phone")){
    if(phoneVerified){
      const incoming = String(b.phone == null ? "" : b.phone).trim();
      const cur = String(nextPhone || "").trim();
      if(incoming !== cur) return json(res,400,{ error:"手机号已验证，不可修改" });
    }else{
      const raw = String(b.phone == null ? "" : b.phone).trim();
      if(raw && !isPhone(raw)) return json(res,400,{ error:"手机号格式不正确" });
      nextPhone = raw;
      identityChanged = true;
    }
  }
  if(identityChanged){
    const ts = new Date().toISOString();
    if(personId){
      db.prepare("UPDATE persons SET real_name=?, gender=?, birth_date=?, phone=?, updated_at=? WHERE id=?")
        .run(nextName || null, nextGender || null, nextBirth || null, nextPhone || null, ts, personId);
    }
    db.prepare("UPDATE patients SET real_name=?, gender=?, birth_date=?, phone=?, updated_at=? WHERE id=?")
      .run(nextName || null, nextGender || null, nextBirth || null, nextPhone || null, ts, pid);
  }

  const foodMeta = { options: patientProfile.FOOD_CONTACT_OPTIONS, noneValue: "无", otherValue: "其他" };
  const drugMeta = { options: patientProfile.DRUG_ALLERGY_OPTIONS, noneValue: "无", otherValue: "其他" };
  const histMeta = { options: patientProfile.DISEASE_HISTORY_OPTIONS, noneValue: "无", otherValue: "其他" };
  const profilePatch = {};

  // 2026-08-13：身份证号采集已下线，忽略客户端传入的 idNumber
  if(Object.prototype.hasOwnProperty.call(b, "disease")){
    profilePatch.disease = String(b.disease == null ? "" : b.disease).trim();
  }
  if(Object.prototype.hasOwnProperty.call(b, "pregnancyStatus")){
    const ps = String(b.pregnancyStatus == null ? "" : b.pregnancyStatus).trim();
    if(ps && !patientProfile.PREGNANCY_OPTIONS.includes(ps)){
      return json(res,400,{ error:"妊娠哺乳状态无效" });
    }
    profilePatch.pregnancyStatus = ps;
  }
  if(Object.prototype.hasOwnProperty.call(b, "foodContactAllergies")){
    const g = patientProfile.normalizeCheckboxGroup(b.foodContactAllergies, foodMeta);
    const err = patientProfile.validateCheckboxGroup(g, foodMeta);
    if(err) return json(res,400,{ error:"食物、接触物过敏：" + err });
    profilePatch.foodContactAllergies = g;
  }
  if(Object.prototype.hasOwnProperty.call(b, "drugAllergies")){
    const g = patientProfile.normalizeCheckboxGroup(b.drugAllergies, drugMeta);
    const err = patientProfile.validateCheckboxGroup(g, drugMeta);
    if(err) return json(res,400,{ error:"药物过敏：" + err });
    profilePatch.drugAllergies = g;
  }
  if(Object.prototype.hasOwnProperty.call(b, "diseaseHistory")){
    const g = patientProfile.normalizeCheckboxGroup(b.diseaseHistory, histMeta);
    const err = patientProfile.validateCheckboxGroup(g, histMeta);
    if(err) return json(res,400,{ error:"疾病史：" + err });
    profilePatch.diseaseHistory = g;
  }

  // 后台扩展槽（患者不可见）
  const extSrc = (b.extension && typeof b.extension === "object") ? b.extension : b;
  const extPatch = {};
  for(const key of patientProfile.ADMIN_ONLY_FIELD_KEYS){
    if(!Object.prototype.hasOwnProperty.call(extSrc, key)) continue;
    if(key === "bmi") continue; // 由身高体重派生
    extPatch[key] = String(extSrc[key] == null ? "" : extSrc[key]).trim().slice(0, key === "familyHistory" || key === "personalHabits" ? 2000 : 40);
  }
  if(Object.keys(extPatch).length){
    const extErrs = patientProfile.validateAdminExtension(extPatch);
    if(extErrs.length) return json(res,400,{ error: extErrs[0] });
    if(Object.prototype.hasOwnProperty.call(extPatch, "heightCm") || Object.prototype.hasOwnProperty.call(extPatch, "weightKg")){
      const cur = personId ? profileStore.readPersonFields(personId) : profileStore.readFields(did, pid);
      const nextH = Object.prototype.hasOwnProperty.call(extPatch, "heightCm") ? extPatch.heightCm : (cur.heightCm || "");
      const nextW = Object.prototype.hasOwnProperty.call(extPatch, "weightKg") ? extPatch.weightKg : (cur.weightKg || "");
      extPatch.bmi = patientProfile.computeBmi(nextH, nextW);
    }
    Object.assign(profilePatch, extPatch);
  }

  if(Object.keys(profilePatch).length){
    if(personId) profileStore.upsertPersonFields(personId, profilePatch, "assistant", s.username || "");
    else profileStore.upsertFields(did, pid, profilePatch, "assistant", s.username || "");
  }
  json(res,200,{ ok:true });
});

route("POST", /^\/api\/admin\/persons\/merge$/, async (req,res)=>{
  const b = await parseBody(req);
  const s = gate(req,res);
  if(!s) return;
  if(s.role !== "super" && !requireAdminAction(req,res,s,"platform.persons.merge",{},"仅超管可合并全局患者主档")) return;
  try{
    const result = mergePersons(+b.keepPersonId, b.mergePersonIds || [], s.username || "", b.reason || "");
    json(res,200, result);
  }catch(e){ json(res,400,{ error:e.message }); }
});
}

module.exports = { registerPatientsAdminRoutes };
