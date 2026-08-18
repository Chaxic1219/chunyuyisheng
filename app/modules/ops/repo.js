"use strict";

/**
 * ops_configs / ops_config_audit 读写（表归属 ops；本文件是唯一写入口）。
 */
const { db } = require("../../db.js");

function parseObj(text){
  try{
    const v = JSON.parse(text || "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  }catch(e){
    return {};
  }
}

function getPublishedJson(ownerId, domain){
  try{
    const row = db.prepare("SELECT published_json FROM ops_configs WHERE doctor_id=? AND domain=? AND published_json<>''")
      .get(ownerId, domain);
    return parseObj(row && row.published_json);
  }catch(e){
    return {};
  }
}

function doctorIdentity(doctorId){
  try{
    return db.prepare("SELECT slug,name FROM doctors WHERE id=?").get(Number(doctorId)) || null;
  }catch(e){
    return null;
  }
}

function getById(id){
  return db.prepare("SELECT * FROM ops_configs WHERE id=?").get(+id) || null;
}

function getByOwnerDomain(ownerId, domain){
  return db.prepare("SELECT * FROM ops_configs WHERE doctor_id=? AND domain=?").get(ownerId, domain) || null;
}

function insertSeed({ ownerId, domain, title, scope, draftJson, publishedJson, nowIso }){
  const r = db.prepare(`INSERT INTO ops_configs(doctor_id,domain,title,scope,draft_json,published_json,published_version,status,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?)`).run(
    ownerId, domain, title, scope, draftJson, publishedJson, 1, "published", nowIso
  );
  return getById(r.lastInsertRowid);
}

function updateUpgradedDefaults(id, draftJson, publishedJson, nowIso){
  db.prepare(`UPDATE ops_configs SET draft_json=?, published_json=?, updated_at=?, published_at=COALESCE(published_at, ?), updated_by=COALESCE(NULLIF(updated_by,''), 'system')
    WHERE id=?`).run(draftJson, publishedJson, nowIso, nowIso, id);
  return getById(id);
}

function updateDraft(id, draftJson, actor, updatedAt){
  db.prepare("UPDATE ops_configs SET draft_json=?,status='draft',updated_by=?,updated_at=? WHERE id=?")
    .run(draftJson, actor, updatedAt, id);
}

function updatePublished(id, publishedJson, version, actor, publishedAt){
  db.prepare(`UPDATE ops_configs SET published_json=?,published_version=?,status='published',
    published_by=?,published_at=?,updated_by=?,updated_at=? WHERE id=?`)
    .run(publishedJson, version, actor, publishedAt, actor, publishedAt, id);
}

function updateRolledBack(id, jsonText, version, actor, publishedAt){
  db.prepare(`UPDATE ops_configs SET draft_json=?,published_json=?,published_version=?,status='rolled_back',
    published_by=?,published_at=?,updated_by=?,updated_at=? WHERE id=?`)
    .run(jsonText, jsonText, version, actor, publishedAt, actor, publishedAt, id);
}

function insertAudit({ configId, doctorId, domain, action, actor, snapshotJson, resultJson, createdAt }){
  db.prepare(`INSERT INTO ops_config_audit(config_id,doctor_id,domain,action,actor,snapshot_json,result_json,created_at)
    VALUES(?,?,?,?,?,?,?,?)`).run(
    configId || null, doctorId || 0, domain, action, actor || "", snapshotJson, resultJson, createdAt
  );
}

function prevPublishSnapshot(configId){
  return db.prepare(`SELECT snapshot_json FROM ops_config_audit
    WHERE config_id=? AND action='publish' ORDER BY id DESC LIMIT 1 OFFSET 1`).get(configId) || null;
}

function listAuditRows(doctorId, limit){
  return db.prepare(`SELECT id,config_id,doctor_id,domain,action,actor,result_json,created_at
    FROM ops_config_audit WHERE doctor_id IN (?,0) ORDER BY id DESC LIMIT ?`).all(+doctorId, limit || 80);
}

function getScriptsJson(doctorId){
  return db.prepare("SELECT published_json,draft_json FROM ops_configs WHERE doctor_id=? AND domain=?")
    .get(+doctorId, "scripts") || null;
}

module.exports = {
  parseObj,
  getPublishedJson,
  doctorIdentity,
  getById,
  getByOwnerDomain,
  insertSeed,
  updateUpgradedDefaults,
  updateDraft,
  updatePublished,
  updateRolledBack,
  insertAudit,
  prevPublishSnapshot,
  listAuditRows,
  getScriptsJson
};
