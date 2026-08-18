"use strict";

function getDb() {
  return require("./db.js").db;
}

function resolvePrimaryDoctorId(groupId) {
  const gid = +groupId;
  if (!Number.isInteger(gid) || gid <= 0) return null;
  const row = getDb().prepare(
    `SELECT doctor_id FROM community_group_doctors WHERE group_id=? AND role='primary' LIMIT 1`
  ).get(gid);
  if (row) return +row.doctor_id;
  const g = getDb().prepare(`SELECT doctor_id FROM community_groups WHERE id=?`).get(gid);
  return g && g.doctor_id ? +g.doctor_id : null;
}

function listGroupDoctors(groupId) {
  return getDb().prepare(
    `SELECT d.group_id, d.doctor_id, d.role, d.auto_reply, d.can_outbound, d.joined_at, d.note,
            doc.name AS doctor_name
     FROM community_group_doctors d
     LEFT JOIN doctors doc ON doc.id = d.doctor_id
     WHERE d.group_id=?
     ORDER BY CASE d.role WHEN 'primary' THEN 0 ELSE 1 END, d.doctor_id`
  ).all(+groupId);
}

function adminCoveredDoctorIds(admin) {
  if (admin && admin.scope === null) return null;
  if (admin && admin.scope instanceof Set) return admin.scope;
  const adminId = +(admin && admin.adminId);
  if (!Number.isInteger(adminId) || adminId <= 0) return new Set();
  return new Set(
    getDb().prepare(`SELECT doctor_id FROM admin_doctors WHERE admin_id=?`).all(adminId).map(r => +r.doctor_id)
  );
}

function canAdminSeeGroup(admin, groupId) {
  const gid = +groupId;
  const g = getDb().prepare(`SELECT * FROM community_groups WHERE id=?`).get(gid);
  if (!g) return false;

  const covered = adminCoveredDoctorIds(admin);
  if (covered === null) return true;

  const primaryId = resolvePrimaryDoctorId(gid);
  if (primaryId && covered.has(primaryId)) return true;
  if (+g.share_visible_to_collab === 1) {
    const collabs = getDb().prepare(
      `SELECT doctor_id FROM community_group_doctors WHERE group_id=? AND role='collaborator'`
    ).all(gid);
    if (collabs.some(r => covered.has(+r.doctor_id))) return true;
  }
  return false;
}

function pickKeepGroupRow(rows) {
  if (!rows || !rows.length) return null;
  return rows.slice().sort((a, b) => {
    const biz = (+b.is_business || 0) - (+a.is_business || 0);
    if (biz) return biz;
    const mem = (+b.mem_c || 0) - (+a.mem_c || 0);
    if (mem) return mem;
    const msg = (+b.msg_c || 0) - (+a.msg_c || 0);
    if (msg) return msg;
    return (+a.id || 0) - (+b.id || 0);
  })[0];
}

function mergeDuplicateQiweGroups() {
  const db = getDb();
  // 含跨 data_source 的同 roomId 重复（manual→qiwe 提升前的冲突源）
  const dups = db.prepare(`
    SELECT external_group_id
    FROM community_groups
    WHERE external_group_id IS NOT NULL AND trim(external_group_id) != ''
      AND external_group_id NOT LIKE 'local-%'
      AND external_group_id NOT LIKE 'test-%'
      AND external_group_id NOT LIKE 'ft-%'
    GROUP BY external_group_id
    HAVING COUNT(*) > 1`).all();
  const merged = [];
  for (const dup of dups) {
    const rows = db.prepare(`
      SELECT g.*,
        (SELECT COUNT(*) FROM community_members m WHERE m.group_id=g.id) AS mem_c,
        (SELECT COUNT(*) FROM community_messages msg WHERE msg.group_id=g.id) AS msg_c
      FROM community_groups g
      WHERE g.external_group_id=?
    `).all(dup.external_group_id);
    const keep = pickKeepGroupRow(rows);
    if (!keep) continue;
    const dropIds = rows.filter(r => r.id !== keep.id).map(r => r.id);
    if (!dropIds.length) continue;
    db.exec("BEGIN IMMEDIATE");
    try {
      for (const dropId of dropIds) {
        const crepo = require("./modules/community/repo.js");
        const members = db.prepare(`SELECT * FROM community_members WHERE group_id=?`).all(dropId);
        for (const m of members) {
          const exists = db.prepare(
            `SELECT id FROM community_members WHERE group_id=? AND external_user_id=? LIMIT 1`
          ).get(keep.id, m.external_user_id);
          if (exists) {
            crepo.deleteMember(m.id);
          } else {
            crepo.reassignMemberGroup(m.id, keep.id);
          }
        }
        require("./modules/community/repo.js").reassignMessageGroup(dropId, keep.id);
        require("./modules/outbox").reassignGroup(dropId, keep.id);
        const dropDocs = db.prepare(`SELECT * FROM community_group_doctors WHERE group_id=?`).all(dropId);
        for (const d of dropDocs) {
          db.prepare(`INSERT OR IGNORE INTO community_group_doctors
            (group_id, doctor_id, role, auto_reply, can_outbound, joined_at, note)
            VALUES (?,?,?,?,?,?,?)`).run(
            keep.id, d.doctor_id, d.role, d.auto_reply, d.can_outbound, d.joined_at, d.note
          );
        }
        db.prepare(`DELETE FROM community_group_doctors WHERE group_id=?`).run(dropId);
        crepo.deleteGroup(dropId);
      }
      const primary = resolvePrimaryDoctorId(keep.id) || keep.doctor_id;
      if (primary) {
        require("./modules/community/repo.js").setGroupDoctorId(keep.id, primary);
      }
      // 保留行标成 qiwe 数据源并纳入业务范围
      require("./modules/community/repo.js").setQiweBusinessFlags(keep.id);
      db.exec("COMMIT");
      merged.push({ externalGroupId: dup.external_group_id, keepId: keep.id, dropIds });
      console.log("[mdg-merge]", dup.external_group_id, "keep", keep.id, "drop", dropIds.join(","));
    } catch (e) {
      try { db.exec("ROLLBACK"); } catch (e2) {}
      console.error("[mdg-merge] failed", dup.external_group_id, e && e.message);
    }
  }
  if (merged.length) {
    try {
      db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_cg_qiwe_external
        ON community_groups(external_group_id)
        WHERE data_source = 'qiwe'
          AND external_group_id IS NOT NULL
          AND trim(external_group_id) != ''
          AND external_group_id NOT LIKE 'local-%'`);
    } catch (e) {
      console.warn("[mdg-merge] idx_cg_qiwe_external still deferred:", e && e.message);
    }
  }
  return merged;
}

function setGroupDoctors(groupId, opts) {
  const db = getDb();
  const gid = +groupId;
  const primary = +(opts && opts.primaryDoctorId);
  const collabs = [...new Set(((opts && opts.collaboratorIds) || []).map(x => +x))]
    .filter(x => Number.isInteger(x) && x > 0 && x !== primary);
  if (!Number.isInteger(primary) || primary <= 0) throw new Error("必须指定主诊");
  const g = db.prepare(`SELECT id FROM community_groups WHERE id=?`).get(gid);
  if (!g) throw new Error("群不存在");
  if (!db.prepare(`SELECT id FROM doctors WHERE id=?`).get(primary)) throw new Error("主诊医生不存在");
  for (const cid of collabs) {
    if (!db.prepare(`SELECT id FROM doctors WHERE id=?`).get(cid)) throw new Error("协诊医生不存在: " + cid);
  }
  const share = opts && opts.shareVisibleToCollab != null ? (+opts.shareVisibleToCollab ? 1 : 0) : null;
  const joined = new Date().toISOString();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(`DELETE FROM community_group_doctors WHERE group_id=?`).run(gid);
    db.prepare(`INSERT INTO community_group_doctors
      (group_id,doctor_id,role,auto_reply,can_outbound,joined_at) VALUES (?,?,?,?,?,?)`)
      .run(gid, primary, "primary", 1, 1, joined);
    for (const cid of collabs) {
      db.prepare(`INSERT INTO community_group_doctors
        (group_id,doctor_id,role,auto_reply,can_outbound,joined_at) VALUES (?,?,?,?,?,?)`)
        .run(gid, cid, "collaborator", 0, 1, joined);
    }
    require("./modules/community/repo.js").setGroupDoctorId(gid, primary, joined);
    if (share != null) {
      require("./modules/community/repo.js").setShareVisible(gid, !!share);
    }
    db.exec("COMMIT");
  } catch (e) {
    try { db.exec("ROLLBACK"); } catch (e2) {}
    throw e;
  }
  // 主诊/协诊变更后：统一挂档与跨医生 person 收敛（与种子改派、后台新建医生同口径）
  // 启动期 applySeedPatches 可能尚未完成 db 导出，故做存在性判断；启动末尾会再跑一遍批处理。
  try {
    const dbMod = require("./db.js");
    if (typeof dbMod.afterDoctorProvisioned === "function") {
      dbMod.afterDoctorProvisioned(primary);
      for (const cid of collabs) dbMod.afterDoctorProvisioned(cid);
    }
  } catch (e) {
    console.warn("[setGroupDoctors] afterDoctorProvisioned", e && e.message);
  }
  return listGroupDoctors(gid);
}

module.exports = {
  resolvePrimaryDoctorId,
  listGroupDoctors,
  canAdminSeeGroup,
  setGroupDoctors,
  mergeDuplicateQiweGroups
};
