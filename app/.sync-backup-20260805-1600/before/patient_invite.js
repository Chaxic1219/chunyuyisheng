/* 患者建档邀请链接：令牌、问卷并档决策（策略 B + 同号未验证需确认）、患者会话 Cookie */
const crypto = require("crypto");

function generateInviteToken(){
  return crypto.randomBytes(9).toString("base64url");
}

function isInvitePhone(s){
  return /^1[3-9]\d{9}$/.test(String(s || "").trim());
}

function maskPhone(phone){
  const p = String(phone || "").trim();
  if(p.length < 7) return "***";
  return p.slice(0, 3) + "****" + p.slice(-4);
}

function maskDisplayName(name){
  const n = String(name || "").trim();
  if(!n) return "未命名";
  if(n.length === 1) return n + "*";
  return n.slice(0, 1) + "*".repeat(Math.min(n.length - 1, 3));
}

/**
 * 纯函数：并档决策（策略 B + 强化确认）
 * - 已验证同号 → 自动 merge
 * - 仅未验证同号 → 需用户确认（needs_confirm）；确认后 merge；forceCreate 则新建
 * - 无同号 → create
 */
function decideInviteMerge(input){
  const verifiedId = input && input.verifiedPatientId != null ? +input.verifiedPatientId : null;
  const candidates = Array.isArray(input && input.unverifiedCandidates) ? input.unverifiedCandidates : [];
  const confirmId = input && input.confirmMergePatientId != null ? +input.confirmMergePatientId : null;
  const forceCreate = !!(input && input.forceCreate);

  if(Number.isInteger(verifiedId) && verifiedId > 0){
    return { action: "merge", patientId: verifiedId, reason: "verified" };
  }
  if(forceCreate){
    return { action: "create", reason: "declined" };
  }
  if(Number.isInteger(confirmId) && confirmId > 0){
    const hit = candidates.find(c => +c.id === confirmId);
    if(hit) return { action: "merge", patientId: confirmId, reason: "user_confirm" };
    return { action: "error", error: "合并确认档案无效或不匹配该手机号" };
  }
  if(candidates.length){
    return {
      action: "needs_confirm",
      candidates: candidates.map(c => ({
        id: +c.id,
        displayNameMasked: maskDisplayName(c.displayName || c.realName || c.real_name || c.display_name),
        phoneMasked: maskPhone(c.phone),
        createdAt: c.createdAt || c.created_at || null,
        nameHint: !!(input && input.submitName && String(c.real_name || c.realName || c.display_name || c.displayName || "").trim() === String(input.submitName).trim())
      }))
    };
  }
  return { action: "create", reason: "new" };
}

/** @deprecated 兼容计划初版单测命名 */
function mergeDecision({ verifiedPatientId }){
  const d = decideInviteMerge({ verifiedPatientId, unverifiedCandidates: [] });
  if(d.action === "merge") return "merge:" + d.patientId;
  return "create";
}

function createInviteStore(db){
  function nowIso(){ return new Date().toISOString(); }

  function getActiveLink(doctorId){
    const did = +doctorId;
    const rows = db.prepare(
      "SELECT * FROM patient_invite_links WHERE doctor_id=? AND active=1 ORDER BY id DESC"
    ).all(did);
    const ts = Date.now();
    for(const row of rows){
      if(row.expires_at && new Date(row.expires_at).getTime() < ts) continue;
      if(row.max_uses != null && row.use_count >= row.max_uses) continue;
      return row;
    }
    return null;
  }

  function getByToken(token){
    const t = String(token || "").trim();
    if(!t) return null;
    const row = db.prepare("SELECT * FROM patient_invite_links WHERE token=?").get(t);
    if(!row || !row.active) return null;
    if(row.expires_at && new Date(row.expires_at).getTime() < Date.now()) return null;
    if(row.max_uses != null && row.use_count >= row.max_uses) return null;
    return row;
  }

  function ensureLink(doctorId, opts){
    const did = +doctorId;
    const o = opts || {};
    if(o.rotate){
      db.prepare("UPDATE patient_invite_links SET active=0 WHERE doctor_id=? AND active=1").run(did);
    }else{
      const existing = getActiveLink(did);
      if(existing) return existing;
    }
    const token = generateInviteToken();
    const created = nowIso();
    let expiresAt = null;
    if(o.expiresInDays != null && +o.expiresInDays > 0){
      expiresAt = new Date(Date.now() + (+o.expiresInDays) * 86400000).toISOString();
    }
    const maxUses = o.maxUses != null && +o.maxUses > 0 ? +o.maxUses : null;
    db.prepare(`INSERT INTO patient_invite_links
      (doctor_id,token,note,max_uses,use_count,expires_at,created_by,created_at,last_used_at,active,require_sms)
      VALUES(?,?,?,?,0,?,?,?,NULL,1,0)`).run(
      did, token, o.note || null, maxUses, expiresAt, o.createdBy || null, created
    );
    return getByToken(token);
  }

  function bumpUse(token){
    const t = String(token || "").trim();
    db.prepare("UPDATE patient_invite_links SET use_count=use_count+1, last_used_at=? WHERE token=?")
      .run(nowIso(), t);
  }

  function createSession({ doctorId, patientId, ttlDays }){
    const token = crypto.randomBytes(24).toString("base64url");
    const created = nowIso();
    const days = ttlDays != null && +ttlDays > 0 ? +ttlDays : 90;
    const expires = new Date(Date.now() + days * 86400000).toISOString();
    db.prepare(`INSERT INTO patient_sessions(token,doctor_id,patient_id,created_at,expires_at,last_seen_at)
      VALUES(?,?,?,?,?,?)`).run(token, +doctorId, +patientId, created, expires, created);
    return token;
  }

  function getSession(psid){
    const t = String(psid || "").trim();
    if(!t) return null;
    const row = db.prepare("SELECT * FROM patient_sessions WHERE token=?").get(t);
    if(!row) return null;
    if(row.expires_at && new Date(row.expires_at).getTime() < Date.now()) return null;
    return row;
  }

  function touchSession(psid){
    const t = String(psid || "").trim();
    if(!t) return;
    db.prepare("UPDATE patient_sessions SET last_seen_at=? WHERE token=?").run(nowIso(), t);
  }

  function findVerifiedByPhone(doctorId, phone){
    const r = db.prepare(
      "SELECT id,display_name,real_name,phone,created_at FROM patients WHERE doctor_id=? AND phone=? AND phone_verified=1 LIMIT 1"
    ).get(+doctorId, String(phone || "").trim());
    return r || null;
  }

  function findUnverifiedByPhone(doctorId, phone){
    return db.prepare(
      "SELECT id,display_name,real_name,phone,created_at FROM patients WHERE doctor_id=? AND phone=? AND phone_verified=0 ORDER BY updated_at DESC, id DESC LIMIT 5"
    ).all(+doctorId, String(phone || "").trim());
  }

  /**
   * 解析邀请建档目标 patient_id。
   * @returns {{ status, patientId?, decision?, candidates? }}
   */
  function resolveInvitePatient(resolvePatientFn, input){
    const doctorId = +input.doctorId;
    const phone = String(input.phone || "").trim();
    const name = String(input.name || "").trim();
    const inviteToken = String(input.inviteToken || "").trim();
    const externalUserId = String(input.externalUserId || "").trim();
    const phoneVerified = input.phoneVerified === true;

    if(externalUserId){
      const pid = resolvePatientFn({
        doctorId,
        channel: "qiwe",
        externalId: externalUserId,
        phone,
        displayName: name,
        phoneVerified
      });
      return { status: "ok", patientId: pid, reason: "qiwe_identity" };
    }

    const verified = findVerifiedByPhone(doctorId, phone);
    const unverified = findUnverifiedByPhone(doctorId, phone);
    const decision = decideInviteMerge({
      verifiedPatientId: verified ? verified.id : null,
      unverifiedCandidates: unverified.map(r => ({
        id: r.id,
        displayName: r.display_name,
        realName: r.real_name,
        display_name: r.display_name,
        real_name: r.real_name,
        phone: r.phone,
        createdAt: r.created_at,
        created_at: r.created_at
      })),
      confirmMergePatientId: input.confirmMergePatientId,
      forceCreate: input.forceCreate,
      submitName: name
    });

    if(decision.action === "needs_confirm"){
      return { status: "needs_confirm", decision, candidates: decision.candidates };
    }
    if(decision.action === "error"){
      return { status: "error", error: decision.error };
    }
    if(decision.action === "merge"){
      return { status: "ok", patientId: decision.patientId, reason: decision.reason };
    }

    const hash = crypto.createHash("sha256").update(phone + "|" + inviteToken).digest("hex").slice(0, 16);
    const ext = "invite:" + inviteToken + ":" + hash + ":" + crypto.randomBytes(4).toString("hex");
    const pid = resolvePatientFn({
      doctorId,
      channel: "invite",
      externalId: ext,
      phone,
      displayName: name,
      phoneVerified
    });
    return { status: "ok", patientId: pid, reason: decision.reason || "new" };
  }

  return {
    getActiveLink,
    getByToken,
    ensureLink,
    bumpUse,
    createSession,
    getSession,
    touchSession,
    findVerifiedByPhone,
    findUnverifiedByPhone,
    resolveInvitePatient
  };
}

module.exports = {
  generateInviteToken,
  isInvitePhone,
  maskPhone,
  maskDisplayName,
  decideInviteMerge,
  mergeDecision,
  createInviteStore
};
