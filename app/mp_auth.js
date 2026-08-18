"use strict";
/**
 * 患者端小程序会话：wx.login → 绑手机 → 挂接当前医生 patient。
 * 短信真实验证由 server 注入；仅显式非生产 stub 允许本地格式校验。
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { db, resolvePatient } = require("./db.js");
const personApi = require("./person.js");
const wechatMp = require("./wechat_mp.js");
const { mpSessionCompatEnabled } = require("./mp_runtime_config.js");

const SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000;

function nowIso() {
  return new Date().toISOString();
}

function maskPhone(phone) {
  const p = String(phone || "").trim();
  if (!/^1\d{10}$/.test(p)) return p || null;
  return p.slice(0, 3) + "****" + p.slice(-4);
}

/** 归一化大陆手机号，便于与网页端存量数据匹配 */
function normalizeMobile(phone) {
  let p = String(phone || "").trim().replace(/[\s-]/g, "");
  if (p.startsWith("+86")) p = p.slice(3);
  else if (/^86\d{11}$/.test(p)) p = p.slice(2);
  return p;
}

function createMpSession({ openid, doctorId, personId, patientId, phoneBound }) {
  const token = crypto.randomBytes(24).toString("base64url");
  const created = nowIso();
  const expires = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  db.prepare(`INSERT INTO mp_sessions(
    token, openid, doctor_id, person_id, patient_id, phone_bound, created_at, expires_at, last_seen_at
  ) VALUES(?,?,?,?,?,?,?,?,?)`).run(
    token,
    String(openid),
    doctorId != null ? +doctorId : null,
    personId != null ? +personId : null,
    patientId != null ? +patientId : null,
    phoneBound ? 1 : 0,
    created,
    expires,
    created
  );
  return token;
}

function runInTransaction(fn) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch (rollbackError) {}
    throw error;
  }
}

function requireActiveDoctor(doctorId) {
  const did = doctorId != null && doctorId !== "" ? +doctorId : null;
  if (!Number.isInteger(did) || did <= 0) throw new Error("doctor_required");
  // 2026-08-13 患者端已废弃 doctors.active 上下线；登录只要求医生仍在库中
  const doctor = db.prepare("SELECT id FROM doctors WHERE id=?").get(did);
  if (!doctor) throw new Error("doctor_unavailable");
  return did;
}

function revokeOpenidSessions(openid) {
  const revokedAt = nowIso();
  db.prepare(`UPDATE mp_sessions
    SET revoked_at=?, last_seen_at=?
    WHERE openid=? AND revoked_at IS NULL`
  ).run(revokedAt, revokedAt, String(openid || ""));
}

function assertActiveSessionDoctor(row) {
  const doctorId = Number(row && row.doctor_id);
  if (!Number.isInteger(doctorId) || doctorId <= 0) {
    // 已绑手机、待选医生：允许会话暂无 doctor_id
    if (row && +row.phone_bound === 1) return null;
    throw new Error("unauthorized");
  }
  const doctor = db.prepare("SELECT id FROM doctors WHERE id=?").get(doctorId);
  if (!doctor) throw new Error("unauthorized");
  return doctorId;
}

function readSessionWithoutTouch(token) {
  const t = String(token || "").trim();
  if (!t) throw new Error("unauthorized");
  const row = db.prepare("SELECT * FROM mp_sessions WHERE token=?").get(t);
  if (!row) throw new Error("unauthorized");
  if (row.revoked_at) throw new Error("unauthorized");
  if (!mpSessionCompatEnabled()) {
    const latest = db.prepare(`SELECT token FROM mp_sessions
      WHERE openid=? AND revoked_at IS NULL
      ORDER BY created_at DESC, rowid DESC
      LIMIT 1`).get(String(row.openid || ""));
    if (!latest || String(latest.token) !== t) throw new Error("unauthorized");
  }
  const expiresAt = Date.parse(String(row.expires_at || ""));
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    throw new Error("session_expired");
  }
  if (!mpSessionCompatEnabled()) {
    assertActiveSessionDoctor(row);
  }
  return row;
}

function requireSession(token) {
  const t = String(token || "").trim();
  const row = readSessionWithoutTouch(t);
  db.prepare("UPDATE mp_sessions SET last_seen_at=? WHERE token=?").run(nowIso(), t);
  return row;
}

function requireBoundSession(token, options = {}) {
  const sess = requireSession(token);
  const personId = Number(sess.person_id);
  const patientId = Number(sess.patient_id);
  const doctorId = Number(sess.doctor_id);
  if (
    !sess.phone_bound ||
    !Number.isInteger(personId) || personId <= 0
  ) {
    throw new Error("account_not_bound");
  }
  if (!Number.isInteger(doctorId) || doctorId <= 0) {
    throw new Error("doctor_required");
  }
  assertActiveSessionDoctor(sess);
  if (!Number.isInteger(patientId) || patientId <= 0) {
    throw new Error("account_not_bound");
  }
  if (options.doctorId != null && Number(options.doctorId) !== doctorId) {
    throw new Error("identity_mismatch");
  }
  const identity = db.prepare(`SELECT
      p.id AS patient_id,
      p.person_id,
      p.doctor_id,
      p.phone_verified AS patient_phone_verified,
      per.id AS person_id_exists,
      per.phone_verified AS person_phone_verified,
      per.mp_openid
    FROM patients p
    JOIN persons per ON per.id=p.person_id
    WHERE p.id=?`).get(patientId);
  if (
    !identity ||
    Number(identity.person_id) !== personId ||
    Number(identity.doctor_id) !== doctorId ||
    !identity.patient_phone_verified ||
    !identity.person_phone_verified ||
    String(identity.mp_openid || "") !== String(sess.openid || "")
  ) {
    throw new Error("identity_mismatch");
  }
  return sess;
}

/** 已绑手机即可（可尚未选定医生）；用于入驻医生列表等闸门接口 */
function requirePhoneBoundSession(token) {
  const sess = requireSession(token);
  const personId = Number(sess.person_id);
  if (!sess.phone_bound || !Number.isInteger(personId) || personId <= 0) {
    throw new Error("account_not_bound");
  }
  return sess;
}

function findRecentDoctorBinding(personId, phone) {
  const pid = Number(personId);
  const mobile = normalizeMobile(phone || "");
  const rows = db.prepare(`
    SELECT doctor_id, id AS patient_id, updated_at
    FROM patients
    WHERE (person_id=? AND person_id IS NOT NULL AND person_id > 0)
       OR (phone=? AND phone_verified=1 AND length(trim(IFNULL(phone,'')))>0)
    ORDER BY updated_at DESC, id DESC
  `).all(
    Number.isInteger(pid) && pid > 0 ? pid : -1,
    mobile || "__no_phone__"
  );
  return rows;
}

function updateMpSession(token, patch) {
  const row = requireSession(token);
  const doctorId = patch.doctorId != null ? +patch.doctorId : row.doctor_id;
  const personId = patch.personId != null ? +patch.personId : row.person_id;
  const patientId = patch.patientId != null ? +patch.patientId : row.patient_id;
  const phoneBound = patch.phoneBound != null ? (patch.phoneBound ? 1 : 0) : row.phone_bound;
  db.prepare(`UPDATE mp_sessions SET
    doctor_id=?, person_id=?, patient_id=?, phone_bound=?, last_seen_at=?
    WHERE token=?`).run(doctorId, personId, patientId, phoneBound, nowIso(), token);
  return requireSession(token);
}

function computeHasProfile(doctorId, patientId, person) {
  const phoneOk = !!(person && person.phone_verified && person.phone);
  if (!phoneOk) return false;
  if (person.real_name && String(person.real_name).trim()) return true;
  if (patientId) {
    const pt = db.prepare("SELECT real_name, display_name FROM patients WHERE id=?").get(+patientId);
    if (pt && pt.real_name && String(pt.real_name).trim()) return true;
    if (pt && pt.display_name && String(pt.display_name).trim()) return true;
  }
  return false;
}

function profileName(person, patientId) {
  if (person && person.real_name && String(person.real_name).trim()) {
    return String(person.real_name).trim();
  }
  if (patientId) {
    const pt = db.prepare("SELECT real_name, display_name FROM patients WHERE id=?").get(+patientId);
    if (pt && pt.real_name && String(pt.real_name).trim()) return String(pt.real_name).trim();
    if (pt && pt.display_name && String(pt.display_name).trim()) return String(pt.display_name).trim();
  }
  return "";
}

function getOrCreateStorageScopeId(personId, doctorId) {
  const pid = Number(personId);
  const did = Number(doctorId);
  if (!Number.isInteger(pid) || pid <= 0) throw new Error("person_required");
  if (!Number.isInteger(did) || did <= 0) throw new Error("doctor_required");

  const existing = db.prepare(
    "SELECT scope_id FROM mp_storage_scopes WHERE person_id=? AND doctor_id=?"
  ).get(pid, did);
  if (existing && existing.scope_id) return String(existing.scope_id);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const scopeId = "mps_" + crypto.randomBytes(32).toString("base64url");
    db.prepare(`INSERT OR IGNORE INTO mp_storage_scopes(
      person_id, doctor_id, scope_id, created_at
    ) VALUES(?,?,?,?)`).run(pid, did, scopeId, nowIso());
    const created = db.prepare(
      "SELECT scope_id FROM mp_storage_scopes WHERE person_id=? AND doctor_id=?"
    ).get(pid, did);
    if (created && created.scope_id) return String(created.scope_id);
  }
  throw new Error("storage_scope_unavailable");
}

function summarizeSession(token) {
  let sess = requireSession(token);
  let doctorId = sess.doctor_id != null ? +sess.doctor_id : null;
  let patientId = sess.patient_id != null ? +sess.patient_id : null;
  let phoneBound = !!sess.phone_bound;

  if (phoneBound) {
    try {
      requirePhoneBoundSession(token);
    } catch (e) {
      phoneBound = false;
    }
  }

  if (phoneBound && doctorId && patientId) {
    try {
      requireBoundSession(token);
    } catch (e) {
      // ponytail: 会话 doctor/patient 与 persons 不一致时自愈，避免 /me 403 拖垮整端
      updateMpSession(token, { doctorId: null, patientId: null });
      sess = requireSession(token);
      doctorId = null;
      patientId = null;
    }
  } else if (phoneBound && doctorId) {
    try {
      assertActiveSessionDoctor(sess);
    } catch (e) {
      updateMpSession(token, { doctorId: null, patientId: null });
      sess = requireSession(token);
      doctorId = null;
    }
  }

  const person = phoneBound && sess.person_id
    ? db.prepare("SELECT * FROM persons WHERE id=?").get(sess.person_id)
    : null;
  const patient = phoneBound && patientId
    ? db.prepare("SELECT avatar_url FROM patients WHERE id=?").get(patientId)
    : null;
  const phone = (person && person.phone) || "";
  const avatarUrl = String((person && person.avatar_url) || (patient && patient.avatar_url) || "").trim();
  const expiresMs = sess.expires_at ? new Date(sess.expires_at).getTime() : Date.now() + SESSION_TTL_MS;
  const expiresIn = Math.max(0, Math.floor((expiresMs - Date.now()) / 1000));
  const needsDoctorSelection = !!(phoneBound && !(Number.isInteger(doctorId) && doctorId > 0));
  return {
    mpToken: token,
    openid: sess.openid,
    doctorId: Number.isInteger(doctorId) && doctorId > 0 ? doctorId : null,
    personId: sess.person_id != null ? +sess.person_id : null,
    patientId: patientId != null ? +patientId : null,
    storageScopeId:
      phoneBound && sess.person_id && doctorId
        ? getOrCreateStorageScopeId(sess.person_id, doctorId)
        : null,
    phoneBound,
    needsDoctorSelection,
    phoneMasked: phone ? maskPhone(phone) : null,
    hasProfile: computeHasProfile(doctorId, patientId, person),
    profileSummary: { name: profileName(person, patientId), avatarUrl },
    avatarUrl,
    expiresIn,
    expiresAt: sess.expires_at
  };
}

function saveMpAvatarDataUrl(dataUrl, personId) {
  const m = String(dataUrl || "").trim().match(/^data:(image\/(?:jpeg|jpg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/i);
  if (!m) throw new Error("invalid_avatar_data");
  const mime = String(m[1]).toLowerCase();
  const ext = mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : "jpg";
  const b64 = String(m[2]).replace(/\s+/g, "");
  const buf = Buffer.from(b64, "base64");
  if (!buf.length || buf.length > 2 * 1024 * 1024) throw new Error("avatar_too_large");
  const uploadsDir = path.join(__dirname, "public", "uploads", "mp-avatars");
  fs.mkdirSync(uploadsDir, { recursive: true });
  const fileName = `mp-${+personId}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}.${ext}`;
  const absPath = path.join(uploadsDir, fileName);
  fs.writeFileSync(absPath, buf);
  return `/uploads/mp-avatars/${fileName}`;
}

function updateAvatar({ token, avatarDataUrl }) {
  const sess = requireBoundSession(token);
  const person = db.prepare("SELECT id, avatar_url FROM persons WHERE id=?").get(sess.person_id);
  if (!person) throw new Error("person_not_found");

  const avatarUrl = saveMpAvatarDataUrl(avatarDataUrl, person.id);
  const now = nowIso();
  db.prepare("UPDATE persons SET avatar_url=?, updated_at=? WHERE id=?")
    .run(avatarUrl, now, person.id);
  if (sess.patient_id) {
    db.prepare("UPDATE patients SET avatar_url=COALESCE(NULLIF(avatar_url,''), ?), updated_at=? WHERE id=?")
      .run(avatarUrl, now, +sess.patient_id);
  }
  return {
    ...summarizeSession(token),
    avatarUrl
  };
}

/**
 * 将已验证 person 挂到当前医生的 patient（同号合并优先）。
 */
function attachPatientForDoctor({ doctorId, person, phone }) {
  const did = +doctorId;
  if (!did) throw new Error("doctor_required");
  if (!person || !person.id) throw new Error("person_required");
  const mobile = normalizeMobile(phone || person.phone || "");
  const now = nowIso();
  const nameFromPerson = (person.real_name && String(person.real_name).trim()) || "";

  // 1) 已有 doctor + person
  let row = db.prepare(
    "SELECT * FROM patients WHERE doctor_id=? AND person_id=? ORDER BY id ASC LIMIT 1"
  ).get(did, person.id);
  if (row) {
    db.prepare(
      "UPDATE patients SET phone_verified=1, phone=CASE WHEN phone IS NULL OR trim(phone)='' THEN ? ELSE phone END, updated_at=? WHERE id=?"
    ).run(mobile, now, row.id);
    return +row.id;
  }

  // 2) 同医生已验证同号 → 挂 person_id
  if (mobile) {
    row = db.prepare(
      "SELECT * FROM patients WHERE doctor_id=? AND phone=? AND phone_verified=1 ORDER BY id ASC LIMIT 1"
    ).get(did, mobile);
    if (row) {
      db.prepare("UPDATE patients SET person_id=?, updated_at=? WHERE id=?")
        .run(person.id, now, row.id);
      return +row.id;
    }

    // 3) 同医生未验证同号 → 升级并挂 person
    row = db.prepare(
      "SELECT * FROM patients WHERE doctor_id=? AND phone=? AND IFNULL(phone_verified,0)=0 ORDER BY id ASC LIMIT 1"
    ).get(did, mobile);
    if (row) {
      db.prepare(
        "UPDATE patients SET phone_verified=1, person_id=?, updated_at=? WHERE id=?"
      ).run(person.id, now, row.id);
      return +row.id;
    }
  }

  // 4) 新建：优先 INSERT 保留 person_id（resolvePatient 按微信名建 person，易错绑）
  try {
    const r = db.prepare(`INSERT INTO patients(
      doctor_id, person_id, display_name, real_name, phone, phone_verified,
      unionid, tags, follow_stage, notes, created_at, updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      did,
      person.id,
      nameFromPerson,
      nameFromPerson,
      mobile,
      1,
      "",
      "[]",
      "",
      "",
      now,
      now
    );
    return +r.lastInsertRowid;
  } catch (e) {
    // 回退 resolvePatient（外部 id 保证幂等）
    const pid = resolvePatient({
      doctorId: did,
      channel: "mp",
      externalId: "mp-phone:" + mobile,
      phone: mobile,
      phoneVerified: true,
      displayName: nameFromPerson,
      realName: nameFromPerson
    });
    if (pid) {
      db.prepare(
        "UPDATE patients SET person_id=?, phone_verified=1, phone=?, updated_at=? WHERE id=?"
      ).run(person.id, mobile, now, pid);
    }
    return pid;
  }
}

/** 由 server 注入：verifySms(phone, code) → null|errorString（与 server.verifySms 一致） */
let smsVerifier = null;
function setSmsVerifier(fn) {
  smsVerifier = typeof fn === "function" ? fn : null;
}

/**
 * 短信校验。显式非生产 stub 接受 000000 或任意 4–6 位；
 * 非 stub 必须已 setSmsVerifier，否则 fail-closed。
 */
function assertSmsOk(phone, smsCode) {
  const p = String(phone || "").trim();
  if (!/^1\d{10}$/.test(p)) throw new Error("invalid_phone");
  const code = String(smsCode || "").trim();
  if (wechatMp.stubMode()) {
    if (code === "000000" || /^\d{4,6}$/.test(code)) return true;
    throw new Error("invalid_sms_code");
  }
  if (!smsVerifier) throw new Error("sms_unavailable");
  const err = smsVerifier(p, code);
  if (err) {
    const errorCode = typeof err === "string" ? err : "";
    if (
      errorCode === "sms_not_configured" ||
      errorCode === "sms_not_wired" ||
      errorCode === "sms_unavailable"
    ) {
      throw new Error("sms_unavailable");
    }
    throw new Error("invalid_sms_code");
  }
  return true;
}

async function login({ code, doctorId, claimDoctor }) {
  const preferred =
    doctorId != null && doctorId !== "" ? requireActiveDoctor(doctorId) : null;
  const claim = !!claimDoctor;
  const { openid } = await wechatMp.code2Session(code);
  const person = personApi.findByMpOpenid(openid);
  const phoneBound = !!(person && person.phone_verified && person.phone);
  const token = runInTransaction(() => {
    let did = null;
    let patientId = null;
    if (phoneBound && person) {
      const existing = findRecentDoctorBinding(person.id, person.phone);
      if (existing.length) {
        // 仅 claimDoctor 时允许切到 preferred；否则沿用最近绑定
        did = preferred && claim ? preferred : +existing[0].doctor_id;
        patientId = attachPatientForDoctor({
          doctorId: did,
          person,
          phone: person.phone
        });
      } else if (preferred && claim) {
        // 选医生页 / 来源医生：明确认领
        did = preferred;
        patientId = attachPatientForDoctor({
          doctorId: did,
          person,
          phone: person.phone
        });
      }
      // 已绑手机、无旧档、未 claim → 待选医生（忽略 bootstrap 默认 id）
    } else {
      if (!preferred) throw new Error("doctor_required");
      did = preferred;
    }
    revokeOpenidSessions(openid);
    return createMpSession({
      openid,
      doctorId: did,
      personId: person ? person.id : null,
      patientId,
      phoneBound
    });
  });
  return summarizeSession(token);
}

async function bindPhone({ token, phoneCode, phone, smsCode, doctorId }) {
  readSessionWithoutTouch(token);
  let mobile;
  if (phoneCode) {
    mobile = normalizeMobile((await wechatMp.getPhoneNumberByCode(phoneCode)).phone || "");
  } else {
    assertSmsOk(phone, smsCode);
    mobile = normalizeMobile(phone);
  }
  if (!/^1\d{10}$/.test(mobile)) throw new Error("invalid_phone");

  const preferred =
    doctorId != null && doctorId !== ""
      ? requireActiveDoctor(doctorId)
      : null;
  // 不再回落到会话里的 bootstrap 默认医生，避免冒充用户选择

  const newToken = runInTransaction(() => {
    const sess = requireSession(token);
    const person = personApi.findOrCreateByVerifiedPhone({ phone: mobile });
    if (person.mp_openid && String(person.mp_openid) !== String(sess.openid)) {
      throw new Error("phone_already_bound");
    }
    if (sess.person_id && +sess.person_id !== +person.id) {
      db.prepare(
        "UPDATE persons SET mp_openid=NULL, updated_at=? WHERE id=? AND mp_openid=?"
      ).run(nowIso(), +sess.person_id, String(sess.openid));
    }
    personApi.bindMpOpenid(person.id, sess.openid);

    const existing = findRecentDoctorBinding(person.id, mobile);
    let did = null;
    let patientId = null;
    if (existing.length) {
      did = +existing[0].doctor_id;
      patientId = attachPatientForDoctor({ doctorId: did, person, phone: mobile });
    } else if (preferred) {
      did = preferred;
      patientId = attachPatientForDoctor({ doctorId: did, person, phone: mobile });
    }

    revokeOpenidSessions(sess.openid);
    return createMpSession({
      openid: sess.openid,
      doctorId: did,
      personId: person.id,
      patientId,
      phoneBound: true
    });
  });
  return summarizeSession(newToken);
}

function me(token) {
  return summarizeSession(token);
}

function logout(token) {
  db.prepare("DELETE FROM mp_sessions WHERE token=?").run(String(token || ""));
  return { ok: true };
}

function unbindPhone(token) {
  return runInTransaction(() => {
    const sess = requireBoundSession(token);
    const changed = db.prepare(
      "UPDATE persons SET mp_openid=NULL, updated_at=? WHERE id=? AND mp_openid=?"
    ).run(nowIso(), +sess.person_id, String(sess.openid || ""));
    if (!changed || changed.changes !== 1) throw new Error("identity_mismatch");
    const revokedAt = nowIso();
    const revoked = db.prepare(`UPDATE mp_sessions
      SET revoked_at=?, last_seen_at=?
      WHERE openid=? AND revoked_at IS NULL`
    ).run(revokedAt, revokedAt, String(sess.openid || ""));
    if (!revoked || revoked.changes < 1) throw new Error("unauthorized");
    return { ok: true };
  });
}

module.exports = {
  createMpSession,
  requireSession,
  requireBoundSession,
  requirePhoneBoundSession,
  updateMpSession,
  summarizeSession,
  attachPatientForDoctor,
  computeHasProfile,
  getOrCreateStorageScopeId,
  assertSmsOk,
  setSmsVerifier,
  maskPhone,
  normalizeMobile,
  findRecentDoctorBinding,
  login,
  bindPhone,
  updateAvatar,
  me,
  logout,
  unbindPhone
};
