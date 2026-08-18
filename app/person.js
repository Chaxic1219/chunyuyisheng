/* 全局患者主档：person 解析（跨医生合并认微信名称） */

function norm(s) { return s == null ? "" : String(s).trim(); }
function isPhone(p) { return /^1[3-9]\d{9}$/.test(p || ""); }

/** 真实企微成员 userId（如 7881301249033516）；排除 phone:/local-/join-name: 占位键 */
function isRealQiweUserId(externalId) {
  const s = norm(externalId);
  if (!s) return false;
  if (/^phone:/i.test(s)) return false;
  if (/^local-/i.test(s)) return false;
  if (/^join-name:/i.test(s)) return false;
  return true;
}

const PLACEHOLDER_DISPLAY_NAMES = /^(?:企微患者|群友|好友|新朋友|新成员|微信用户|患者|未知|匿名|企微用户)$/;

function stripChannelSuffix(name) {
  return String(name == null ? "" : name).trim()
    .replace(/[·.\-_]?(?:企微|微信|联络表|本地|其他)$/, "")
    .trim();
}

/** 用于跨医生合并与档案提示的微信名称（社群 display_name / 消息 patient_name） */
function normalizeWechatName(name) {
  const s = stripChannelSuffix(name);
  if (!s) return "";
  // 企业微信主体账号：如「医生助手 @春雨家庭医生」
  if (/\s@[^\s·]+/.test(s)) return "";
  if (PLACEHOLDER_DISPLAY_NAMES.test(s)) return "";
  if (/^\d{10,}$/.test(s)) return "";
  if (/^企微用户[·.\-_]?\d{2,}$/.test(s)) return "";
  return s.slice(0, 80);
}
const normalizeWechatGroupName = normalizeWechatName;

const SOURCE_RANK = { patient: 3, assistant: 2, extract: 1, system: 0 };

function createPersonApi(db) {
  function nowIso() { return new Date().toISOString(); }

  function findByWechatName(wechatName) {
    const key = normalizeWechatName(wechatName);
    if (!key) return null;
    const direct = db.prepare("SELECT id FROM persons WHERE wechat_group_name=? LIMIT 1").get(key);
    if (direct) return direct.id;
    const viaPatient = db.prepare(`
      SELECT person_id, display_name FROM patients
      WHERE person_id IS NOT NULL AND display_name IS NOT NULL AND trim(display_name) != ''
      AND (display_name=? OR display_name LIKE ? || '%')
      LIMIT 32
    `).all(key, key);
    for (const r of viaPatient) {
      if (normalizeWechatName(r.display_name) === key) return r.person_id;
    }
    try {
      const viaMem = db.prepare(`
        SELECT pt.person_id, cm.display_name FROM community_members cm
        JOIN patient_identities pi ON pi.doctor_id=cm.doctor_id AND pi.external_id=cm.external_user_id
        JOIN patients pt ON pt.id=pi.patient_id
        WHERE pt.person_id IS NOT NULL AND cm.display_name IS NOT NULL AND trim(cm.display_name) != ''
        AND (cm.display_name=? OR cm.display_name LIKE ? || '%')
        LIMIT 32
      `).all(key, key);
      for (const r of viaMem) {
        if (normalizeWechatName(r.display_name) === key) return r.person_id;
      }
    } catch (e) {}
    try {
      const viaMsg = db.prepare(`
        SELECT pt.person_id, ml.patient_name FROM message_log ml
        JOIN patients pt ON pt.id=ml.patient_id
        WHERE pt.person_id IS NOT NULL AND ml.patient_name IS NOT NULL AND trim(ml.patient_name) != ''
        AND (ml.patient_name=? OR ml.patient_name LIKE ? || '%')
        LIMIT 32
      `).all(key, key);
      for (const r of viaMsg) {
        if (normalizeWechatName(r.patient_name) === key) return r.person_id;
      }
    } catch (e) {}
    return null;
  }
  const findByWechatGroupName = findByWechatName;

  function insertPerson(fields) {
    const now = nowIso();
    const uid = isRealQiweUserId(fields.qiweUserId) ? norm(fields.qiweUserId) : null;
    const wn = normalizeWechatName(fields.wechatName || fields.wechatGroupName);
    try {
      const info = db.prepare(`INSERT INTO persons(real_name,gender,birth_date,phone,phone_verified,unionid,avatar_url,qiwe_user_id,wechat_group_name,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(
        norm(fields.realName) || null,
        norm(fields.gender) || null,
        norm(fields.birthDate) || null,
        norm(fields.phone) || null,
        fields.phoneVerified ? 1 : 0,
        norm(fields.unionid) || null,
        norm(fields.avatarUrl) || null,
        uid,
        wn || null,
        now,
        now
      );
      return info.lastInsertRowid;
    } catch (e) {
      if (!/UNIQUE constraint failed: persons\.phone/i.test(String(e && e.message || ""))) throw e;
      const existing = db.prepare(
        "SELECT id FROM persons WHERE phone=? ORDER BY phone_verified DESC, id ASC LIMIT 1"
      ).get(norm(fields.phone));
      if (existing) return existing.id;
      throw e;
    }
  }

  /** 按已验证手机号查找或创建全局 person；同号复用。 */
  function createPerson({ phone, phone_verified, real_name }) {
    const id = insertPerson({
      phone,
      phoneVerified: !!phone_verified,
      realName: real_name
    });
    return db.prepare("SELECT * FROM persons WHERE id=?").get(id);
  }

  function findOrCreateByVerifiedPhone({ phone, realName }) {
    const p = String(phone || "").trim();
    if (!/^1\d{10}$/.test(p)) throw new Error("invalid_phone");
    const existing = db.prepare(
      "SELECT * FROM persons WHERE phone=? AND phone_verified=1 ORDER BY id ASC LIMIT 1"
    ).get(p);
    if (existing) {
      if (realName && !existing.real_name) {
        db.prepare("UPDATE persons SET real_name=COALESCE(NULLIF(real_name,''), ?), updated_at=? WHERE id=?")
          .run(String(realName).trim(), nowIso(), existing.id);
        return db.prepare("SELECT * FROM persons WHERE id=?").get(existing.id);
      }
      return existing;
    }
    const unverified = db.prepare(
      "SELECT * FROM persons WHERE phone=? ORDER BY id ASC LIMIT 1"
    ).get(p);
    if (unverified) {
      db.prepare("UPDATE persons SET phone_verified=1, real_name=COALESCE(NULLIF(real_name,''), ?), updated_at=? WHERE id=?")
        .run(realName ? String(realName).trim() : null, nowIso(), unverified.id);
      return db.prepare("SELECT * FROM persons WHERE id=?").get(unverified.id);
    }
    return createPerson({ phone: p, phone_verified: 1, real_name: realName || null });
  }

  function bindMpOpenid(personId, openid) {
    const oid = String(openid || "").trim();
    if (!oid) throw new Error("invalid_openid");
    const clash = db.prepare("SELECT id FROM persons WHERE mp_openid=? AND id!=?").get(oid, +personId);
    if (clash) throw new Error("openid_bound_other");
    db.prepare("UPDATE persons SET mp_openid=?, updated_at=? WHERE id=?")
      .run(oid, nowIso(), +personId);
  }

  function findByMpOpenid(openid) {
    return db.prepare("SELECT * FROM persons WHERE mp_openid=?").get(String(openid || "").trim()) || null;
  }

  function updateWechatName(personId, wechatName) {
    const key = normalizeWechatName(wechatName);
    if (!key || !personId) return;
    db.prepare("UPDATE persons SET wechat_group_name=?, updated_at=? WHERE id=?")
      .run(key, new Date().toISOString(), personId);
  }
  const updateWechatGroupName = updateWechatName;

  function enrichPersonRow(pid, input, wechatName, qiweUserId, unionid, phone, phoneVerified) {
    const now = new Date().toISOString();
    const clash = isPhone(phone)
      ? db.prepare("SELECT id FROM persons WHERE phone=? AND phone_verified=1 AND id!=? LIMIT 1").get(phone, pid)
      : null;
    const phoneToWrite = clash ? "" : phone;
    const verifiedToWrite = clash ? 0 : (phoneVerified ? 1 : 0);
    try {
      db.prepare(`UPDATE persons SET
        real_name=COALESCE(NULLIF(?,''), real_name),
        gender=COALESCE(NULLIF(?,''), gender),
        birth_date=COALESCE(NULLIF(?,''), birth_date),
        phone=CASE WHEN phone IS NULL OR trim(phone)='' THEN ? ELSE phone END,
        unionid=COALESCE(NULLIF(?,''), unionid),
        avatar_url=COALESCE(NULLIF(?,''), avatar_url),
        qiwe_user_id=COALESCE(NULLIF(?,''), qiwe_user_id),
        wechat_group_name=COALESCE(NULLIF(?,''), wechat_group_name),
        phone_verified=CASE WHEN ?=1 THEN 1 ELSE phone_verified END,
        updated_at=? WHERE id=?`).run(
        norm(input && input.realName),
        norm(input && input.gender),
        norm(input && input.birthDate),
        phoneToWrite,
        unionid,
        norm(input && input.avatarUrl),
        qiweUserId,
        wechatName,
        verifiedToWrite,
        now,
        pid
      );
    } catch (e) {
      if (!/UNIQUE constraint failed: persons\.phone/i.test(String(e && e.message || ""))) throw e;
      db.prepare(`UPDATE persons SET
        real_name=COALESCE(NULLIF(?,''), real_name),
        gender=COALESCE(NULLIF(?,''), gender),
        birth_date=COALESCE(NULLIF(?,''), birth_date),
        unionid=COALESCE(NULLIF(?,''), unionid),
        avatar_url=COALESCE(NULLIF(?,''), avatar_url),
        qiwe_user_id=COALESCE(NULLIF(?,''), qiwe_user_id),
        wechat_group_name=COALESCE(NULLIF(?,''), wechat_group_name),
        updated_at=? WHERE id=?`).run(
        norm(input && input.realName),
        norm(input && input.gender),
        norm(input && input.birthDate),
        unionid,
        norm(input && input.avatarUrl),
        qiweUserId,
        wechatName,
        now,
        pid
      );
    }
    if (phoneVerified && !clash) {
      db.prepare("UPDATE persons SET phone_verified=1, updated_at=? WHERE id=?").run(now, pid);
    }
  }

  /**
   * 跨医生合并键优先序：已验证手机号 → 企微 userId → 微信名称。
   * 同企微 userId 必须收敛到同一 person，避免「灿烂的阳光」这类跨医生分裂。
   */
  function resolvePerson(input) {
    const qiweUserId = isRealQiweUserId(input && input.qiweUserId) ? norm(input.qiweUserId) : "";
    const wechatName = normalizeWechatName(
      input && (input.wechatName || input.wechatGroupName)
    );
    const unionid = norm(input && input.unionid);
    const phone = norm(input && input.phone);
    const phoneVerified = input && input.phoneVerified === true;

    if (phoneVerified && isPhone(phone)) {
      const row = findOrCreateByVerifiedPhone({ phone, realName: input && input.realName });
      enrichPersonRow(row.id, input, wechatName, qiweUserId, unionid, phone, true);
      return row.id;
    }

    let pid = null;
    if (qiweUserId) {
      const byQiwe = db.prepare("SELECT id FROM persons WHERE qiwe_user_id=? ORDER BY id ASC LIMIT 1").get(qiweUserId);
      if (byQiwe) pid = byQiwe.id;
    }
    if (!pid && wechatName) {
      pid = findByWechatName(wechatName);
    }
    if (!pid) {
      pid = insertPerson({
        realName: input && input.realName,
        gender: input && input.gender,
        birthDate: input && input.birthDate,
        phone,
        phoneVerified,
        unionid,
        avatarUrl: input && input.avatarUrl,
        qiweUserId,
        wechatName
      });
    } else {
      enrichPersonRow(pid, input, wechatName, qiweUserId, unionid, phone, phoneVerified);
    }
    return pid;
  }

  return {
    resolvePerson,
    findByWechatName,
    findByWechatGroupName,
    updateWechatName,
    updateWechatGroupName,
    normalizeWechatName,
    normalizeWechatGroupName,
    isRealQiweUserId,
    findOrCreateByVerifiedPhone,
    bindMpOpenid,
    findByMpOpenid,
    SOURCE_RANK
  };
}

/** 默认绑定当前进程 DB（供测试与直接 require 调用） */
let _defaultApi;
function defaultApi() {
  if (!_defaultApi) {
    const { db } = require("./db.js");
    _defaultApi = createPersonApi(db);
  }
  return _defaultApi;
}

module.exports = {
  createPersonApi,
  SOURCE_RANK,
  norm,
  isPhone,
  isRealQiweUserId,
  normalizeWechatName,
  normalizeWechatGroupName,
  stripChannelSuffix,
  findOrCreateByVerifiedPhone: (opts) => defaultApi().findOrCreateByVerifiedPhone(opts),
  bindMpOpenid: (personId, openid) => defaultApi().bindMpOpenid(personId, openid),
  findByMpOpenid: (openid) => defaultApi().findByMpOpenid(openid)
};
