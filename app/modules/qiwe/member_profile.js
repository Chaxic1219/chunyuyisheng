"use strict";
/**
 * 企微群成员资料：入群即时抓取微信名/头像；过滤运营/托管号不建患者档案。
 */
const { db, preferDisplayName, isPlaceholderDisplayName, backfillMessageLogPatientLabel } = require("../../db.js");
const qiwe = require("../../qiwe.js");
const repo = require("../community/repo.js");

const INTERNAL_NAME_RE = /^(?:春雨医生|医生助手|小助手|托管号|企微助手)/;
const INTERNAL_NAME_HAS_RE = /春雨医生|医生助手/;

function envInternalUserIds(){
  const raw = String(process.env.QIWE_INTERNAL_USER_IDS || "").trim();
  if(!raw) return [];
  return raw.split(/[,;\s]+/).map(s => String(s || "").trim()).filter(Boolean);
}

function isInternalDisplayName(name){
  const n = String(name == null ? "" : name).trim();
  if(!n) return false;
  if(INTERNAL_NAME_RE.test(n)) return true;
  if(INTERNAL_NAME_HAS_RE.test(n)) return true;
  // 企业微信内部号常带「@公司名」
  if(/\s@[^\s·]{2,}$/.test(n)) return true;
  return false;
}

function isSelfUserId(userId, cfg){
  const uid = String(userId || "").trim();
  if(!uid) return false;
  const c = cfg || qiwe.loadConfig();
  const selfId = String((c && c.selfUserId) || "").trim();
  if(selfId && uid === selfId) return true;
  for(const id of envInternalUserIds()){
    if(uid === id) return true;
  }
  return false;
}

/** 运营/托管/助手账号：可记群成员，但不应进患者档案。 */
function isInternalQiweAccount(opts){
  const o = opts || {};
  const uid = String(o.userId || o.externalUserId || "").trim();
  const name = String(o.displayName || o.senderName || "").trim();
  if(isSelfUserId(uid, o.cfg)) return true;
  if(isInternalDisplayName(name)) return true;
  // 医生本人进群：显示名等于当前医生姓名 → 不当患者
  const did = o.doctorId != null ? +o.doctorId : 0;
  if(did && name){
    try{
      const doc = db.prepare("SELECT name FROM doctors WHERE id=?").get(did);
      const dname = String((doc && doc.name) || "").trim();
      if(dname && (name === dname || name.startsWith(dname))) return true;
    }catch(e){}
  }
  return false;
}

function shouldCreatePatientArchive(opts){
  return !isInternalQiweAccount(opts);
}

/** 从其他医生档案/成员表借用已知真昵称与头像（同步、无外呼）。 */
function lookupKnownProfile(externalUserId, opts){
  const o = opts || {};
  const includeInternal = !!o.includeInternal;
  const uid = String(externalUserId || "").trim();
  if(!uid) return { displayName: "", avatarUrl: "" };
  let displayName = "";
  let avatarUrl = "";
  try{
    const mems = db.prepare(
      `SELECT display_name, avatar_url FROM community_members
       WHERE external_user_id=? AND status='active'
       ORDER BY id DESC LIMIT 20`
    ).all(uid);
    for(const m of mems){
      const n = String(m.display_name || "").trim();
      if(!displayName && n && !isPlaceholderDisplayName(n) && (includeInternal || !isInternalDisplayName(n))){
        displayName = n.slice(0, 80);
      }
      const a = String(m.avatar_url || "").trim();
      if(!avatarUrl && a && /^https?:\/\//i.test(a)) avatarUrl = a;
      if(displayName && avatarUrl) break;
    }
  }catch(e){}
  try{
    const pats = db.prepare(
      `SELECT p.display_name, p.avatar_url FROM patients p
       JOIN patient_identities pi ON pi.patient_id=p.id
       WHERE pi.external_id=? AND pi.channel IN ('qiwe','wecom')
       ORDER BY p.updated_at DESC LIMIT 20`
    ).all(uid);
    for(const p of pats){
      const n = String(p.display_name || "").trim();
      if(!displayName && n && !isPlaceholderDisplayName(n) && (includeInternal || !isInternalDisplayName(n))){
        displayName = n.slice(0, 80);
      }
      const a = String(p.avatar_url || "").trim();
      if(!avatarUrl && a && /^https?:\/\//i.test(a)) avatarUrl = a;
      if(displayName && avatarUrl) break;
    }
  }catch(e){}
  return { displayName, avatarUrl };
}

function writeMemberAndPatientProfile(doctorId, userId, profile){
  const did = +doctorId;
  const uid = String(userId || "").trim();
  const display = String((profile && profile.displayName) || "").trim();
  const avatar = String((profile && profile.avatarUrl) || "").trim();
  const hasRealDisplay = !!(display && !isPlaceholderDisplayName(display));
  if(!did || !uid || (!hasRealDisplay && !avatar)) return { updated:0, patientId:null };

  const ts = new Date().toISOString();
  let updated = 0;
  const members = db.prepare(
    "SELECT id,display_name,avatar_url FROM community_members WHERE doctor_id=? AND external_user_id=?"
  ).all(did, uid);
  for(const m of members){
    const nextName = hasRealDisplay ? preferDisplayName(m.display_name, display) : m.display_name;
    const nextAvatar = avatar || m.avatar_url || "";
    if((nextName && nextName !== m.display_name) || (avatar && avatar !== m.avatar_url)){
      repo.setMemberDisplayAvatar(m.id, nextName || m.display_name, nextAvatar || null);
      updated++;
    }
  }

  let patientId = null;
  try{
    const { resolvePatient } = require("../../db.js");
    if(shouldCreatePatientArchive({ userId:uid, displayName:display, doctorId:did })){
      patientId = resolvePatient({
        doctorId: did,
        channel: "qiwe",
        externalId: uid,
        displayName: hasRealDisplay ? display : ""
      });
    }
  }catch(e){ patientId = null; }

  if(patientId){
    try{
      const cur = db.prepare("SELECT display_name, avatar_url FROM patients WHERE id=?").get(patientId);
      if(cur && hasRealDisplay){
        const nextDisplay = preferDisplayName(cur.display_name, display);
        if(nextDisplay && nextDisplay !== cur.display_name){
          db.prepare("UPDATE patients SET display_name=?, updated_at=? WHERE id=?")
            .run(nextDisplay, ts, patientId);
          updated++;
        }
      }
      if(avatar){
        db.prepare(
          "UPDATE patients SET avatar_url=COALESCE(NULLIF(avatar_url,''), ?), updated_at=? WHERE id=?"
        ).run(avatar, ts, patientId);
      }
      backfillMessageLogPatientLabel(did, patientId, uid);
    }catch(e){}
  }
  return { updated, patientId, displayName: display, avatarUrl: avatar };
}

/** 同步：用跨群已知资料立刻回写本医生成员（入群瞬间、外呼前）。 */
function applyKnownProfile(doctorId, userId){
  const known = lookupKnownProfile(userId);
  if(!known.displayName && !known.avatarUrl) return { updated:0, ...known };
  return Object.assign(known, writeMemberAndPatientProfile(doctorId, userId, known));
}

/** 异步/await：调企微 batchGetUserinfo 拉真昵称+头像。 */
async function enrichContactProfile(doctorId, userId, opts){
  const o = opts || {};
  const uid = String(userId || "").trim();
  const did = +doctorId;
  if(!did || !uid) return { updated:0, displayName:"", avatarUrl:"" };

  // 先落已知资料，欢迎语/档案立刻有名
  applyKnownProfile(did, uid);

  const api = o.api || ((method, params) => qiwe.doApi(method, params, o.cfg));
  let contact = null;
  try{
    const res = await api("/contact/batchGetUserinfo", { userIdList: [uid] });
    const list = (((res || {}).data || {}).contactList) || [];
    contact = list.find(c => String((c && (c.userId || c.userid || ""))).trim() === uid) || list[0] || null;
  }catch(e){
    console.error("[member_profile] batchGetUserinfo", e && e.message);
  }

  const fromApi = {
    displayName: contact ? qiwe.pickContactDisplayName(contact) : "",
    avatarUrl: contact ? qiwe.pickContactAvatar(contact) : ""
  };
  const known = lookupKnownProfile(uid);
  const merged = {
    displayName: (fromApi.displayName && !isPlaceholderDisplayName(fromApi.displayName))
      ? fromApi.displayName
      : known.displayName,
    avatarUrl: fromApi.avatarUrl || known.avatarUrl
  };
  const out = writeMemberAndPatientProfile(did, uid, merged);
  return Object.assign({ displayName: merged.displayName, avatarUrl: merged.avatarUrl }, out);
}

const _enrichInflight = new Map();
function scheduleEnrich(doctorId, userId, opts){
  const key = String(doctorId) + ":" + String(userId || "");
  if(_enrichInflight.has(key)) return _enrichInflight.get(key);
  const p = enrichContactProfile(doctorId, userId, opts)
    .catch(e => {
      console.error("[member_profile] scheduleEnrich", e && e.message);
      return { updated:0 };
    })
    .finally(() => { _enrichInflight.delete(key); });
  _enrichInflight.set(key, p);
  return p;
}

/** 把误建的运营号患者软归档（archived_at）。 */
function archiveInternalPatientsForDoctors(doctorIds){
  const ids = (doctorIds || []).map(Number).filter(n => Number.isInteger(n) && n > 0);
  if(!ids.length) return { archived: 0, ids: [] };
  const placeholders = ["企微患者", "群友", "好友", "新朋友", "新成员", "微信用户", "患者", "未知", "匿名", "企微用户"];
  const archivedIds = [];
  const ts = new Date().toISOString();
  for(const did of ids){
    const rows = db.prepare(
      `SELECT p.id, p.display_name, p.real_name, p.phone_verified,
         (SELECT external_id FROM patient_identities
          WHERE patient_id=p.id AND channel IN ('qiwe','wecom')
          ORDER BY id DESC LIMIT 1) AS external_id
       FROM patients p
       WHERE p.doctor_id=? AND (p.archived_at IS NULL OR trim(p.archived_at)='')`
    ).all(did);
    for(const r of rows){
      const uid = String(r.external_id || "").trim();
      const name = String(r.display_name || "").trim();
      // 已短信验证且显示名非运营号 → 永不归档（避免 person 误标「医生助手」连带误伤）
      if(+r.phone_verified === 1
        && !isInternalDisplayName(name)
        && !isInternalDisplayName(String(r.real_name || ""))) continue;
      // 运营号：按名/uid；或占位名且跨群已知为运营号
      let internal = isInternalQiweAccount({
        userId: uid, displayName: name, doctorId: did
      });
      // 占位名：仅当「没有可用患者侧真名」且跨群仅能匹配到运营号名时，才归档
      if(!internal && uid && isPlaceholderDisplayName(name)){
        const knownGood = lookupKnownProfile(uid);
        if(!knownGood.displayName){
          const knownAny = lookupKnownProfile(uid, { includeInternal: true });
          if(isInternalDisplayName(knownAny.displayName)) internal = true;
        }
      }
      // 仅占位、且能确认是运营号才归档；纯患者占位留给回填昵称
      if(!internal) continue;
      db.prepare("UPDATE patients SET archived_at=?, updated_at=?, notes=CASE WHEN notes IS NULL OR trim(notes)='' THEN ? ELSE notes END WHERE id=?")
        .run(ts, ts, "system:internal_qiwe_account", r.id);
      archivedIds.push(r.id);
    }
  }
  return { archived: archivedIds.length, ids: archivedIds };
}

/** 用跨群真昵称/头像回填占位患者（非运营号）。 */
function backfillPlaceholderProfiles(doctorIds){
  const ids = (doctorIds || []).map(Number).filter(n => Number.isInteger(n) && n > 0);
  let filled = 0;
  const details = [];
  for(const did of ids){
    const rows = db.prepare(
      `SELECT p.id, p.display_name, p.avatar_url,
         (SELECT external_id FROM patient_identities
          WHERE patient_id=p.id AND channel IN ('qiwe','wecom')
          ORDER BY id DESC LIMIT 1) AS external_id
       FROM patients p
       WHERE p.doctor_id=? AND (p.archived_at IS NULL OR trim(p.archived_at)='')
         AND (
           p.display_name IS NULL OR trim(p.display_name)='' OR
           p.display_name IN ('企微患者','群友','好友','新朋友','新成员','微信用户','患者','未知','匿名','企微用户')
         )`
    ).all(did);
    for(const r of rows){
      const uid = String(r.external_id || "").trim();
      if(!uid) continue;
      if(isInternalQiweAccount({ userId: uid, displayName: r.display_name })) continue;
      const known = lookupKnownProfile(uid);
      if(!known.displayName && !known.avatarUrl) continue;
      if(isInternalDisplayName(known.displayName)) continue;
      const out = writeMemberAndPatientProfile(did, uid, known);
      if(out.updated){
        filled++;
        details.push({ doctorId: did, patientId: r.id, userId: uid, displayName: known.displayName });
      }
    }
  }
  return { filled, details };
}

module.exports = {
  isInternalDisplayName,
  isInternalQiweAccount,
  shouldCreatePatientArchive,
  lookupKnownProfile,
  applyKnownProfile,
  enrichContactProfile,
  scheduleEnrich,
  writeMemberAndPatientProfile,
  archiveInternalPatientsForDoctors,
  backfillPlaceholderProfiles
};
