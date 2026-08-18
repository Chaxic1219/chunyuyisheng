/* QiWe 真实群目录同步：发现群、拉取群详情并幂等对账成员；再用联系人详情补齐群聊昵称。 */
const { db, preferDisplayName, isPlaceholderDisplayName, resolvePatient, backfillMessageLogPatientLabel } = require("./db.js");
const qiwe = require("./qiwe.js");

function text(v, max){ return String(v == null ? "" : v).trim().slice(0, max || 200); }
function id(v){ return text(v, 120); }
function now(){ return new Date().toISOString(); }

function decodeRoomName(v){
  const raw = text(v, 500);
  if(!raw) return "未命名企微群";
  try{
    const decoded = Buffer.from(raw, "base64").toString("utf8").trim();
    if(decoded && !decoded.includes("�") && Buffer.from(decoded).toString("base64").replace(/=+$/, "") === raw.replace(/=+$/, "")) return decoded.slice(0, 120);
  }catch(e){}
  return raw.slice(0, 120);
}

async function collectRoomIds(api){
  const rooms = new Map();
  let nextStartIndex = 0;
  for(let page=0; page<100; page++){
    const res = await api("/room/getRoomList", { nextStartIndex });
    const data = (res && res.data) || {};
    for(const room of data.roomList || []){
      const roomId = id(room.roomId);
      if(roomId) rooms.set(roomId, room);
    }
    if(!data.hasMore || Number(data.nextStartIndex) < 0) break;
    nextStartIndex = Number(data.nextStartIndex) || 0;
  }

  let currentSeq = 0;
  for(let page=0; page<100; page++){
    const res = await api("/session/getSessionPage", { currentSeq });
    const data = (res && res.data) || {};
    for(const session of data.sessionList || []){
      if(Number(session.sessionType) !== 1) continue;
      const roomId = id(session.sessionId);
      if(roomId && !rooms.has(roomId)) rooms.set(roomId, { roomId });
    }
    if(!data.hasMore) break;
    const next = Number(data.currentSeq);
    if(!Number.isFinite(next) || next === currentSeq) break;
    currentSeq = next;
  }
  return rooms;
}

function upsertGroup(doctorId, room, syncedAt){
  const crepo = require("./modules/community/repo.js");
  const roomId = id(room.roomId);
  let row = crepo.findByExternalGroupId(roomId);
  const name = decodeRoomName(room.roomName || (row && row.name));
  const owner = id(room.roomOwnerId || room.roomCreateUserId || (row && row.owner));
  const count = Number(room.roomMemberCount != null ? room.roomMemberCount : ((room.memberList || []).length || (row && row.member_count) || 0));
  if(row){
    return crepo.syncUpdateGroupFromQiwe(row.id, {
      name, owner, memberCount: Number.isFinite(count) ? count : 0, syncedAt
    });
  }
  const created = crepo.insertGroup({
    doctorId,
    channelType: "qiwe",
    externalGroupId: roomId,
    name,
    owner,
    memberCount: Number.isFinite(count) ? count : 0,
    status: "pilot",
    welcomeEnabled: true,
    welcomeText: "",
    autoReplyEnabled: true,
    reviewMode: "human_review",
    notes: "QiWe 真实群同步",
    dataSource: "qiwe",
    isBusiness: true,
    lastSyncedAt: syncedAt,
    syncVersion: 0,
    shareVisibleToCollab: 1
  });
  try{
    const cgd = require("./community_group_doctors.js");
    cgd.setGroupDoctors(created.id, { primaryDoctorId: doctorId, collaboratorIds: [], shareVisibleToCollab: 1 });
  }catch(e){
    console.warn("[qiwe_sync] setGroupDoctors on new group:", e && e.message);
  }
  return crepo.getGroupById(created.id);
}

function syncMembers(doctorId, group, members, syncedAt){
  const crepo = require("./modules/community/repo.js");
  const seen = new Set();
  for(const item of members || []){
    const userId = id(item.userId);
    if(!userId) continue;
    seen.add(userId);
    const name = text(item.roomRemarkName || item.name || "", 80);
    const display = name || userId;
    const joinedAt = Number(item.joinTime) > 0 ? new Date(Number(item.joinTime) * 1000).toISOString() : syncedAt;
    const old = crepo.getMemberByKey(doctorId, group.id, userId);
    if(old){
      const finalName = preferDisplayName(old.display_name, display);
      crepo.updateMemberActive(old.id, {
        displayName: finalName,
        joinedAt,
        dataSource: "qiwe",
        lastSyncedAt: syncedAt
      });
    }else{
      crepo.insertMember({
        doctorId, groupId: group.id, externalUserId: userId, displayName: display,
        phone: "", tags: [], joinedAt, status: "active", dataSource: "qiwe", lastSyncedAt: syncedAt
      });
    }
  }
  if(seen.size){
    const active = crepo.listActiveQiweMembers(group.id);
    for(const row of active) if(!seen.has(String(row.external_user_id))) crepo.markMemberLeft(row.id, syncedAt);
  }
  // 同步建档：与后台新建医生/种子落库共用 resolvePatient（企微 userId → 同一 person）
  const memberProfile = require("./modules/qiwe/member_profile.js");
  for(const userId of seen){
    try{
      const m = crepo.getMemberByKey(doctorId, group.id, userId);
      const display = (m && m.display_name) || "";
      if(!memberProfile.shouldCreatePatientArchive({ userId, displayName: display, doctorId })) continue;
      try{ memberProfile.applyKnownProfile(doctorId, userId); }catch(e){}
      const m2 = crepo.getMemberByKey(doctorId, group.id, userId) || m;
      resolvePatient({
        doctorId,
        channel: "qiwe",
        externalId: userId,
        groupId: group.id,
        displayName: (m2 && m2.display_name) || display
      });
      try{ memberProfile.scheduleEnrich(doctorId, userId); }catch(e){}
    }catch(e){}
  }
  const count = crepo.countActiveQiweMembers(group.id);
  crepo.setMemberCountSynced(group.id, count, syncedAt);
  return count;
}

/* 用 /contact/batchGetUserinfo 把群成员占位名换成群聊可见昵称，并回写 patients */
async function enrichMemberNames(doctorId, api){
  const rows = db.prepare(`SELECT DISTINCT external_user_id FROM community_members
    WHERE doctor_id=? AND status='active' AND external_user_id IS NOT NULL AND trim(external_user_id)!=''`).all(doctorId);
  const ids = rows.map(r => String(r.external_user_id)).filter(Boolean);
  if(!ids.length) return { checked:0, updated:0 };
  const ts = new Date().toISOString();
  let updated = 0;
  const call = api || ((method, params)=>qiwe.doApi(method, params));
  for(let i=0; i<ids.length; i+=20){
    const chunk = ids.slice(i, i+20);
    let list = [];
    try{
      const res = await call("/contact/batchGetUserinfo", { userIdList:chunk });
      list = (((res || {}).data || {}).contactList) || [];
    }catch(e){
      console.error("[qiwe_sync] batchGetUserinfo", e && e.message);
      continue;
    }
    for(const c of list){
      const uid = id(c.userId);
      if(!uid) continue;
      const display = qiwe.pickContactDisplayName(c);
      const avatar = qiwe.pickContactAvatar(c);
      if((!display || isPlaceholderDisplayName(display)) && !avatar) continue;
      const members = db.prepare("SELECT id,display_name,avatar_url FROM community_members WHERE doctor_id=? AND external_user_id=?").all(doctorId, uid);
      for(const m of members){
        const next = display && !isPlaceholderDisplayName(display)
          ? preferDisplayName(m.display_name, display)
          : m.display_name;
        const nextAvatar = avatar || m.avatar_url || "";
        if((next && next !== m.display_name) || (avatar && avatar !== m.avatar_url)){
          require("./modules/community/repo.js").setMemberDisplayAvatar(m.id, next || m.display_name, nextAvatar || null);
          updated++;
        }
      }
      try{
        const memberProfile = require("./modules/qiwe/member_profile.js");
        const displayName = display && !isPlaceholderDisplayName(display) ? display : "";
        if(!memberProfile.shouldCreatePatientArchive({ userId:uid, displayName: displayName || "", doctorId })) continue;
        const pid = resolvePatient({
          doctorId,
          channel:"qiwe",
          externalId:uid,
          displayName
        });
        if(pid){
          // 强一致：只要 batch 返回了真实昵称/头像，就直接覆盖占位名
          const cur = db.prepare("SELECT display_name, avatar_url FROM patients WHERE id=?").get(pid);
          const hasRealDisplay = display && !isPlaceholderDisplayName(display);
          if(cur && hasRealDisplay){
            const nextDisplay = preferDisplayName(cur.display_name, display);
            if(nextDisplay && nextDisplay !== cur.display_name){
              db.prepare("UPDATE patients SET display_name=?, updated_at=? WHERE id=?").run(nextDisplay, ts, pid);
              updated++;
            }
          }
          // avatar：优先用接口返回，否则回退到刚刚写入的 community_members 最新值
          const cmAvatarRow = db.prepare(`
            SELECT avatar_url FROM community_members
            WHERE doctor_id=? AND external_user_id=?
            ORDER BY id DESC LIMIT 1`).get(doctorId, uid);
          const avatarFinal = (avatar && String(avatar).trim()) ? avatar : (cmAvatarRow && cmAvatarRow.avatar_url ? cmAvatarRow.avatar_url : null);
          if(avatarFinal){
            db.prepare("UPDATE patients SET avatar_url=COALESCE(NULLIF(avatar_url,''), ?), updated_at=? WHERE id=?")
              .run(avatarFinal, ts, pid);
          }
          backfillMessageLogPatientLabel(doctorId, pid, uid);
        }
      }catch(e){}
    }
  }
  return { checked:ids.length, updated };
}

async function syncGroups(options){
  const opts = options || {};
  const doctorId = Number(opts.doctorId);
  if(!Number.isInteger(doctorId) || doctorId <= 0) throw new Error("doctorId 必须为正整数");
  const light = !!opts.light;
  const api = opts.api || ((method, params)=>qiwe.doApi(method, params, opts.cfg));
  const discovered = await collectRoomIds(api);
  const roomIds = [...discovered.keys()];
  const cgd = require("./community_group_doctors.js");
  const primaryDoctorIds = new Set();
  let memberCount = 0;
  const syncedAt = now();
  for(let i=0; i<roomIds.length; i+=20){
    const ids = roomIds.slice(i, i+20);
    const res = await api("/room/batchGetRoomDetail", { roomIdList:ids });
    const details = new Map((((res && res.data) || {}).roomList || []).map(x=>[id(x.roomId), x]));
    for(const roomId of ids){
      const room = Object.assign({}, discovered.get(roomId) || {}, details.get(roomId) || {}, { roomId });
      const group = upsertGroup(doctorId, room, syncedAt);
      // canonical 模型：同一 roomId 只保留 1 条 canonical 群记录，由主诊 doctor 写回成员/患者
      const primaryDid = cgd.resolvePrimaryDoctorId(group.id) || group.doctor_id;
      if(Number.isInteger(+primaryDid) && +primaryDid > 0) primaryDoctorIds.add(+primaryDid);
      memberCount += syncMembers(primaryDid, group, room.memberList || [], syncedAt);
    }
  }
  // 别用调用方 doctorId 补齐：必须按 canonical 主诊维度补齐，确保不写错 doctor
  // light：跳过联系人批量补齐，避免网关 504；完整同步请手动点「同步企微群」
  let names = { checked:0, updated:0 };
  if(!light){
    try{
      for(const did of primaryDoctorIds){
        const r = await enrichMemberNames(did, api);
        names.checked += r.checked || 0;
        names.updated += r.updated || 0;
      }
    }catch(e){ console.error("[qiwe_sync] enrichMemberNames", e && e.message); }
  }
  let visibility = { ok:true, skipped:true };
  try{ visibility = await reconcileGroupVisibility({ api, roomIds }); }
  catch(e){ console.error("[qiwe_sync] reconcileGroupVisibility", e && e.message); }
  return { ok:true, groups:roomIds.length, members:memberCount, namesEnriched:names.updated, namesChecked:names.checked, syncedAt, visibility, light };
}

async function syncRoomName(options){
  const opts = options || {};
  const roomId = id(opts.roomId);
  if(!roomId) return { ok:false, changed:false, reason:"invalid_room_id" };
  const crepo = require("./modules/community/repo.js");
  const group = crepo.findByExternalGroupId(roomId);
  if(!group) return { ok:true, changed:false, reason:"group_not_found" };
  const api = opts.api || ((method, params)=>qiwe.doApi(method, params, opts.cfg));
  const res = await api("/room/batchGetRoomDetail", { roomIdList:[roomId] });
  const room = ((((res || {}).data || {}).roomList) || []).find(x=>id(x && x.roomId) === roomId);
  if(!room) return { ok:true, changed:false, reason:"room_detail_not_found" };
  const name = decodeRoomName(room.roomName);
  if(!name || name === "未命名企微群" || name === String(group.name || "")){
    return { ok:true, changed:false, groupId:group.id, name:String(group.name || "") };
  }
  const syncedAt = now();
  crepo.syncGroupNameFromQiwe(group.id, name, syncedAt);
  return { ok:true, changed:true, groupId:group.id, name, syncedAt };
}

/**
 * 按当前 QiWe 账号可见群聊做软隐藏：
 * - 当前 guid === home_guid（原账号）→ 全部恢复显示
 * - 否则 → 仅显示当前账号已加入的企微群；未加入的历史群 qiwe_hidden=1
 * 不删库、不改 doctor_id / 主诊。
 */
async function reconcileGroupVisibility(options){
  const opts = options || {};
  const cfg = qiwe.loadConfig();
  const state = qiwe.getAccountState() || {};
  const homeGuid = String(state.home_guid || cfg.homeGuid || cfg.guid || "").trim().toUpperCase();
  const activeGuid = String(cfg.guid || "").trim().toUpperCase();
  if(!activeGuid) return { ok:false, reason:"missing_guid" };

  let roomIds = opts.roomIds;
  if(!Array.isArray(roomIds)){
    const api = opts.api || ((method, params)=>qiwe.doApi(method, params, cfg));
    const discovered = await collectRoomIds(api);
    roomIds = [...discovered.keys()];
  }
  const joined = new Set((roomIds || []).map(x => String(x || "").trim()).filter(Boolean));
  const isHome = !homeGuid || homeGuid === activeGuid;

  if(isHome){
    const r = db.prepare("UPDATE community_groups SET qiwe_hidden=0 WHERE IFNULL(qiwe_hidden,0)=1").run();
    return { ok:true, mode:"home", restored:r.changes || 0, joined:joined.size };
  }

  const qiweRows = db.prepare(`SELECT id, external_group_id FROM community_groups
    WHERE data_source='qiwe'
      AND external_group_id IS NOT NULL AND trim(external_group_id) != ''
      AND external_group_id NOT LIKE 'local-%'
      AND external_group_id NOT LIKE 'test-%'`).all();
  let hidden = 0;
  let shown = 0;
  const hideStmt = db.prepare("UPDATE community_groups SET qiwe_hidden=1 WHERE id=? AND IFNULL(qiwe_hidden,0)=0");
  const showStmt = db.prepare("UPDATE community_groups SET qiwe_hidden=0 WHERE id=? AND IFNULL(qiwe_hidden,0)=1");
  for(const row of qiweRows){
    const rid = String(row.external_group_id || "").trim();
    if(!rid) continue;
    if(joined.has(rid)){
      const r = showStmt.run(row.id);
      shown += r.changes || 0;
    }else{
      const r = hideStmt.run(row.id);
      hidden += r.changes || 0;
    }
  }
  return { ok:true, mode:"alternate", hidden, shown, joined:joined.size, totalQiwe:qiweRows.length };
}

module.exports = { syncGroups, syncRoomName, decodeRoomName, collectRoomIds, enrichMemberNames, reconcileGroupVisibility };
