"use strict";

/**
 * 社群工作台：overview / 真建群 / 通讯录 / 改群 / 主动提醒。
 */
const { db, isPlaceholderDisplayName } = require("../../db.js");
const service = require("./service.js");
const repo = require("./repo.js");
const rules = require("./rules.js");
const rt = require("./runtime.js");
const outbox = require("../outbox");

const now = () => new Date().toISOString();
const cleanText = (v, max) => rules.cleanText(v, max);
const cleanInt = (v) => rules.cleanInt(v);
const REVIEW_MODES = rules.REVIEW_MODES;
const CHANNEL_TYPES = rules.CHANNEL_TYPES;
const GROUP_STATUS = rules.GROUP_STATUS;
const groupOut = (g) => rules.groupOut(g);
const messageOut = (m) => rules.messageOut(m);
const outboxOut = (o) => outbox.outboxOut(o);
const isPlaceholderGroupId = (ext) => rules.isPlaceholderGroupId(ext);
const doctorContent = (id) => rt.doctorContent(id);
const REMINDER_TYPES = ["加号", "住院预约"];

function overview(doctorId, adminCtx){
  const did = +doctorId;
  service.ensureDefaultGroup(did);
  const cgd = require("../../community_group_doctors.js");
  let groups = repo.listGroupsForDoctorOrdered(did);
  if(adminCtx){
    const shared = repo.listCollaboratorSharedGroups(did);
    const byId = new Map(groups.map(g => [g.id, g]));
    for(const g of shared){
      if(!byId.has(g.id)) byId.set(g.id, g);
    }
    groups = [...byId.values()].filter(g => cgd.canAdminSeeGroup(adminCtx, g.id));
  }
  groups = groups.map(groupOut);
  const visibleIds = new Set(groups.map(g => g.id));
  let messages = repo.listRecentMessagesByDoctor(did, 40).map(messageOut);
  let outboxRows = outbox.listRecentByDoctor(did, 40).map(outboxOut);
  if(adminCtx){
    messages = messages.filter(m => !m.groupId || visibleIds.has(m.groupId));
    outboxRows = outboxRows.filter(o => !o.groupId || visibleIds.has(o.groupId));
  }
  const c = repo.overviewSummaryCounts(did);
  const o = outbox.overviewOutboxCounts(did);
  return {
    groups,
    messages,
    outbox: outboxRows,
    summary: {
      totalGroups: groups.length,
      groups: c.businessGroups,
      qiweGroups: c.qiweGroups,
      members: c.members,
      inbound: c.inbound,
      pendingOutbox: o.pendingOutbox,
      sentOutbox: o.sentOutbox,
      flagged: c.flagged,
      messageTotal: c.messageTotal,
      outboxTotal: o.outboxTotal
    }
  };
}

async function createGroupOnQiwe(input){
  input = input || {};
  const did = +input.doctorId;
  if(!db.prepare("SELECT 1 FROM doctors WHERE id=?").get(did)) throw new Error("医生不存在");
  const qiwe = require("../../qiwe.js");
  if(!qiwe.isConfigured()) throw new Error("企微未配置：请先在「企微配置」启用 Token/GUID/托管号");
  const members = qiwe.parseMemberIdInput(input.memberIds != null ? input.memberIds : input.members);
  if(!members.length) throw new Error("真建群须填写至少 1 个企微成员 userId");
  let name = cleanText(input.name, 120);
  if(!name){
    const { content, doctor } = doctorContent(did);
    const seq = repo.countGroupsByDoctor(did) + 1;
    name = cleanText(service.buildGroupName(doctor, content, seq), 120);
  }
  if(!name) throw new Error("群名称必填");

  const cfg = qiwe.loadConfig();
  const created = await qiwe.createRoom(members, { isOuterRoom:1 }, cfg);
  const roomId = qiwe.extractCreatedRoomId(created);
  if(!roomId) throw new Error("企微建群成功但未返回 roomId，请到企微侧核对后改用「同步企微群」");

  let renamed = false;
  let renameError = "";
  try{
    await qiwe.modifyRoomName(roomId, name, cfg);
    renamed = true;
  }catch(e){
    renameError = (e && e.message) || String(e);
    console.warn("[community] 建群后改名失败（群已创建，继续落库）：", renameError);
  }

  const reviewMode = REVIEW_MODES.has(input.reviewMode) ? input.reviewMode : "human_review";
  const status = GROUP_STATUS.has(input.status) ? input.status : "pilot";
  const row = repo.insertGroup({
    doctorId: did,
    channelType: "qiwe",
    externalGroupId: roomId,
    name,
    owner: cleanText(input.owner, 80) || "医助运营",
    memberCount: members.length,
    status,
    welcomeEnabled: input.welcomeEnabled !== false,
    welcomeText: "",
    autoReplyEnabled: input.autoReplyEnabled !== false,
    reviewMode,
    qrcodeUrl: cleanText(input.qrcodeUrl, 500),
    notes: cleanText(input.notes, 1200) || "由社群工作台「新增测试群」在企微侧创建。",
    dataSource: "qiwe",
    // 工作台真建群一律纳入业务群（不再提供后台开关）
    isBusiness: true,
    lastSyncedAt: now()
  });

  qiwe.ensureRoomInTestToId(roomId, cfg);
  return {
    ok:true,
    group: groupOut(row),
    qiweCreate:{
      roomId,
      memberCount:members.length,
      renamed,
      renameError:renameError || null,
      testToIdUpdated:true
    }
  };
}

function listContacts(input){
  input = input || {};
  let doctorIds = input.doctorIds;
  if(doctorIds != null && !Array.isArray(doctorIds)) doctorIds = [doctorIds];
  if(Array.isArray(doctorIds)){
    doctorIds = doctorIds.map(Number).filter(n=>Number.isInteger(n) && n>0);
    if(!doctorIds.length) return { ok:true, items:[] };
  }

  const map = new Map();
  const pickName = (existing, incoming)=>{
    const ex = String(existing || "").trim().slice(0, 80);
    const inc = String(incoming || "").trim().slice(0, 80);
    if(ex && !isPlaceholderDisplayName(ex)) return ex;
    if(inc && !isPlaceholderDisplayName(inc)) return inc;
    return "";
  };
  const upsert = (userId, displayName, source, doctorId)=>{
    const uid = String(userId == null ? "" : userId).trim().slice(0, 80);
    if(!uid) return;
    const prev = map.get(uid);
    if(!prev){
      map.set(uid, {
        userId:uid,
        displayName:pickName("", displayName),
        source,
        doctorId:doctorId == null ? null : +doctorId
      });
      return;
    }
    prev.displayName = pickName(prev.displayName, displayName);
    if(prev.source !== source) prev.source = "both";
    if(prev.doctorId == null && doctorId != null) prev.doctorId = +doctorId;
  };

  const docFilter = Array.isArray(doctorIds);
  const ph = docFilter ? doctorIds.map(()=>"?").join(",") : "";

  for(const r of repo.listMemberContacts(docFilter ? doctorIds : null)){
    upsert(r.external_user_id, r.display_name, "member", r.doctor_id);
  }

  const patSql = docFilter
    ? `SELECT pi.doctor_id, pi.external_id,
          COALESCE(NULLIF(trim(p.display_name),''), NULLIF(trim(p.real_name),''), '') AS display_name
        FROM patient_identities pi
        JOIN patients p ON p.id=pi.patient_id
        WHERE pi.doctor_id IN (${ph})
          AND pi.channel IN ('qiwe','wecom')
          AND pi.external_id IS NOT NULL AND trim(pi.external_id) != ''`
    : `SELECT pi.doctor_id, pi.external_id,
          COALESCE(NULLIF(trim(p.display_name),''), NULLIF(trim(p.real_name),''), '') AS display_name
        FROM patient_identities pi
        JOIN patients p ON p.id=pi.patient_id
        WHERE pi.channel IN ('qiwe','wecom')
          AND pi.external_id IS NOT NULL AND trim(pi.external_id) != ''`;
  const patRows = docFilter ? db.prepare(patSql).all(...doctorIds) : db.prepare(patSql).all();
  for(const r of patRows) upsert(r.external_id, r.display_name, "patient", r.doctor_id);

  const contactScore = (userId)=>repo.contactActivityScore(userId);

  const byName = new Map();
  for(const row of map.values()){
    const name = String(row.displayName || "").trim();
    if(!name || isPlaceholderDisplayName(name)) continue;
    const key = `${row.doctorId == null ? "*" : row.doctorId}::${name.toLowerCase()}`;
    const score = contactScore(row.userId);
    const prev = byName.get(key);
    if(!prev || score > prev.score || (score === prev.score && String(row.userId) < String(prev.row.userId))){
      byName.set(key, { score, row });
    }
  }
  const dropIds = new Set();
  for(const row of map.values()){
    const name = String(row.displayName || "").trim();
    if(!name || isPlaceholderDisplayName(name)) continue;
    const key = `${row.doctorId == null ? "*" : row.doctorId}::${name.toLowerCase()}`;
    const win = byName.get(key);
    if(win && win.row.userId !== row.userId) dropIds.add(row.userId);
  }
  for(const id of dropIds) map.delete(id);

  const items = [...map.values()].sort((a,b)=>{
    const an = a.displayName || a.userId;
    const bn = b.displayName || b.userId;
    return String(an).localeCompare(String(bn), "zh");
  });
  return { ok:true, items };
}

async function updateGroup(id, input){
  const g = repo.getGroupById(+id);
  if(!g) throw new Error("群配置不存在");
  input = input || {};
  const channel = CHANNEL_TYPES.has(input.channelType) ? input.channelType : g.channel_type;
  const reviewMode = REVIEW_MODES.has(input.reviewMode) ? input.reviewMode : g.review_mode;
  const status = GROUP_STATUS.has(input.status) ? input.status : g.status;
  const name = cleanText(input.name || g.name, 120);
  if(!name) throw new Error("群名称必填");
  const prevName = cleanText(g.name, 120);
  const nameChanged = name !== prevName;
  const roomId = cleanText(g.external_group_id, 120);
  const canSyncQiweName = nameChanged && roomId && !isPlaceholderGroupId(roomId)
    && (g.data_source === "qiwe" || g.channel_type === "qiwe" || channel === "qiwe");

  let qiweRename = null;
  if(canSyncQiweName){
    const qiwe = require("../../qiwe.js");
    if(!qiwe.isConfigured()){
      throw new Error("企微未配置（缺 Token/GUID），无法把群名同步到微信群；请先完成企微配置后再改名");
    }
    try{
      await qiwe.modifyRoomName(roomId, name, qiwe.loadConfig());
      qiweRename = { ok:true, roomId, name, previousName:prevName };
    }catch(e){
      const msg = (e && e.message) || String(e);
      throw new Error("微信群改名失败，本地未保存：" + msg);
    }
  }

  repo.updateGroupCore(+id, {
    channelType: channel,
    externalGroupId: Object.prototype.hasOwnProperty.call(input, "externalGroupId") ? (cleanText(input.externalGroupId, 120) || null) : g.external_group_id,
    name,
    owner: Object.prototype.hasOwnProperty.call(input, "owner") ? cleanText(input.owner, 80) : g.owner,
    memberCount: Object.prototype.hasOwnProperty.call(input, "memberCount") ? cleanInt(input.memberCount) : g.member_count,
    status,
    welcomeEnabled: Object.prototype.hasOwnProperty.call(input, "welcomeEnabled") ? (input.welcomeEnabled ? 1 : 0) : g.welcome_enabled,
    welcomeText: "",
    autoReplyEnabled: Object.prototype.hasOwnProperty.call(input, "autoReplyEnabled") ? (input.autoReplyEnabled ? 1 : 0) : g.auto_reply_enabled,
    reviewMode,
    qrcodeUrl: Object.prototype.hasOwnProperty.call(input, "qrcodeUrl") ? cleanText(input.qrcodeUrl, 500) : g.qrcode_url,
    notes: Object.prototype.hasOwnProperty.call(input, "notes") ? cleanText(input.notes, 1200) : g.notes,
    updatedAt: now()
  });
  if(Object.prototype.hasOwnProperty.call(input, "shareVisibleToCollab")){
    repo.setShareVisible(+id, !!input.shareVisibleToCollab);
  }
  // 已取消「业务群」后台开关：编辑接口忽略 isBusiness，避免误关导致消息静默
  return { group: groupOut(repo.getGroupById(+id)), qiweRename };
}

function reminderSummary(payload){
  const p = payload || {};
  const parts = [p["姓名"], p["手机号"], p["主要疾病"] || p["疾病"], p["期望就诊日"] || p["期望住院日"] || p["期望日期"]]
    .map(x=>String(x == null ? "" : x).trim()).filter(Boolean);
  return parts.join(" · ").slice(0, 200);
}

function reminders(doctorId){
  const did = +doctorId;
  const counts = {};
  let total = 0;
  for(const t of REMINDER_TYPES){
    const c = db.prepare("SELECT COUNT(*) c FROM submissions WHERE doctor_id=? AND type=? AND status='待跟进'").get(did, t).c;
    counts[t] = c; total += c;
  }
  const placeholders = REMINDER_TYPES.map(()=>"?").join(",");
  const rows = db.prepare(`SELECT id,type,payload,created_at FROM submissions
    WHERE doctor_id=? AND status='待跟进' AND type IN (${placeholders}) ORDER BY id DESC LIMIT 30`).all(did, ...REMINDER_TYPES);
  const items = rows.map(r=>({ id:r.id, type:r.type, createdAt:r.created_at, summary:reminderSummary(rt.j(r.payload, {})) }));
  return { ok:true, total, counts, items };
}

module.exports = {
  overview,
  createGroupOnQiwe,
  listContacts,
  updateGroup,
  reminders
};
