"use strict";

/**
 * outbound_assets / outbound_triggers / outbound_trigger_steps 唯一 SQL 读写。
 */
const { db } = require("../../db.js");

function nowIso() {
  return new Date().toISOString();
}

function parseJson(text, fallback) {
  try {
    const v = JSON.parse(text || "");
    return v == null ? fallback : v;
  } catch (e) {
    return fallback;
  }
}

function mapAsset(row) {
  if (!row) return null;
  return {
    id: row.id,
    doctorId: row.doctor_id,
    type: row.type,
    title: row.title,
    payload: parseJson(row.payload, {}),
    groupCode: row.group_code,
    enabled: !!row.enabled,
    sort: row.sort,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapTrigger(row) {
  if (!row) return null;
  return {
    id: row.id,
    doctorId: row.doctor_id,
    kind: row.kind,
    code: row.code,
    aliases: parseJson(row.aliases, []),
    matchType: row.match_type,
    enabled: !!row.enabled,
    sort: row.sort,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapStep(row) {
  if (!row) return null;
  return {
    id: row.id,
    triggerId: row.trigger_id,
    assetId: row.asset_id,
    sort: row.sort,
    enabled: !!row.enabled,
  };
}

function getAssetRow(doctorId, assetId) {
  return (
    db.prepare("SELECT * FROM outbound_assets WHERE id=? AND doctor_id=?").get(+assetId, +doctorId) ||
    null
  );
}

function getTriggerRow(doctorId, triggerId) {
  return (
    db
      .prepare("SELECT * FROM outbound_triggers WHERE id=? AND doctor_id=?")
      .get(+triggerId, +doctorId) || null
  );
}

function createAsset(input) {
  const r = input || {};
  const ts = nowIso();
  const payload =
    r.payload == null ? "{}" : typeof r.payload === "string" ? r.payload : JSON.stringify(r.payload);
  const info = db
    .prepare(
      `INSERT INTO outbound_assets(
        doctor_id, type, title, payload, group_code, enabled, sort, created_at, updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?)`
    )
    .run(
      +r.doctorId,
      r.type,
      r.title != null ? String(r.title) : "",
      payload,
      r.groupCode != null ? String(r.groupCode) : "",
      r.enabled === false || r.enabled === 0 ? 0 : 1,
      r.sort != null ? +r.sort : 0,
      ts,
      ts
    );
  return mapAsset(getAssetRow(r.doctorId, info.lastInsertRowid));
}

function listAssets(doctorId, opts) {
  const o = opts || {};
  let rows;
  if (o.groupCode != null && String(o.groupCode) !== "") {
    rows = db
      .prepare(
        `SELECT * FROM outbound_assets WHERE doctor_id=? AND group_code=?
         ORDER BY sort, id`
      )
      .all(+doctorId, String(o.groupCode));
  } else {
    rows = db
      .prepare(`SELECT * FROM outbound_assets WHERE doctor_id=? ORDER BY group_code, sort, id`)
      .all(+doctorId);
  }
  return rows.map(mapAsset);
}

function updateAsset(doctorId, assetId, patch) {
  const row = getAssetRow(doctorId, assetId);
  if (!row) return null;
  const p = patch || {};
  const payload =
    p.payload == null
      ? row.payload
      : typeof p.payload === "string"
        ? p.payload
        : JSON.stringify(p.payload);
  db.prepare(
    `UPDATE outbound_assets SET
      type=?, title=?, payload=?, group_code=?, enabled=?, sort=?, updated_at=?
     WHERE id=? AND doctor_id=?`
  ).run(
    p.type != null ? p.type : row.type,
    p.title != null ? String(p.title) : row.title,
    payload,
    p.groupCode != null ? String(p.groupCode) : row.group_code,
    p.enabled === false || p.enabled === 0 ? 0 : p.enabled === true || p.enabled === 1 ? 1 : row.enabled,
    p.sort != null ? +p.sort : row.sort,
    nowIso(),
    +assetId,
    +doctorId
  );
  return mapAsset(getAssetRow(doctorId, assetId));
}

function deleteAsset(doctorId, assetId) {
  const n = db
    .prepare(
      `SELECT COUNT(*) c FROM outbound_trigger_steps s
       JOIN outbound_triggers t ON t.id=s.trigger_id
       WHERE s.asset_id=? AND t.doctor_id=?`
    )
    .get(+assetId, +doctorId).c;
  if (n > 0) {
    const err = new Error("素材仍被触发编排引用，请先移除引用");
    err.code = "ASSET_IN_USE";
    throw err;
  }
  db.prepare("DELETE FROM outbound_assets WHERE id=? AND doctor_id=?").run(+assetId, +doctorId);
}

function createTrigger(input) {
  const r = input || {};
  const ts = nowIso();
  const aliases =
    r.aliases == null ? "[]" : typeof r.aliases === "string" ? r.aliases : JSON.stringify(r.aliases);
  const info = db
    .prepare(
      `INSERT INTO outbound_triggers(
        doctor_id, kind, code, aliases, match_type, enabled, sort, created_at, updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?)`
    )
    .run(
      +r.doctorId,
      r.kind,
      r.code != null ? String(r.code) : "",
      aliases,
      r.matchType || "exact",
      r.enabled === false || r.enabled === 0 ? 0 : 1,
      r.sort != null ? +r.sort : 0,
      ts,
      ts
    );
  return mapTrigger(getTriggerRow(r.doctorId, info.lastInsertRowid));
}

function getTrigger(doctorId, triggerId) {
  const row = getTriggerRow(doctorId, triggerId);
  if (!row) return null;
  const trigger = mapTrigger(row);
  const steps = db
    .prepare(
      `SELECT * FROM outbound_trigger_steps WHERE trigger_id=? ORDER BY sort, id`
    )
    .all(+triggerId)
    .map(mapStep);
  trigger.steps = steps;
  return trigger;
}

function listTriggers(doctorId) {
  const rows = db
    .prepare(`SELECT * FROM outbound_triggers WHERE doctor_id=? ORDER BY sort, id`)
    .all(+doctorId);
  return rows.map(mapTrigger);
}

function replaceSteps(doctorId, triggerId, steps, opts) {
  const did = +doctorId;
  const tid = +triggerId;
  if (!getTriggerRow(did, tid)) return null;
  const list = Array.isArray(steps) ? steps : [];
  for (const s of list) {
    if (!getAssetRow(did, s.assetId)) {
      const err = new Error("素材不属于该医生或不存在");
      err.code = "ASSET_DOCTOR_MISMATCH";
      throw err;
    }
  }
  const writeSteps = () => {
    db.prepare("DELETE FROM outbound_trigger_steps WHERE trigger_id=?").run(tid);
    const ins = db.prepare(
      `INSERT INTO outbound_trigger_steps(trigger_id, asset_id, sort, enabled)
       VALUES (?,?,?,?)`
    );
    list.forEach((s, idx) => {
      ins.run(
        tid,
        +s.assetId,
        s.sort != null ? +s.sort : idx,
        s.enabled === false || s.enabled === 0 ? 0 : 1
      );
    });
    db.prepare("UPDATE outbound_triggers SET updated_at=? WHERE id=? AND doctor_id=?").run(
      nowIso(),
      tid,
      did
    );
  };

  if (opts && opts.noTransaction) {
    writeSteps();
    return;
  }

  db.exec("BEGIN IMMEDIATE");
  try {
    writeSteps();
    db.exec("COMMIT");
  } catch (e) {
    try {
      db.exec("ROLLBACK");
    } catch (_) {
      /* ignore */
    }
    throw e;
  }
}

function createCodeBundle(doctorId, code) {
  return createTrigger({
    doctorId,
    kind: "code",
    code: String(code),
    aliases: [],
    matchType: "exact",
  });
}

function updateTrigger(doctorId, triggerId, patch) {
  const row = getTriggerRow(doctorId, triggerId);
  if (!row) return null;
  const p = patch || {};
  const aliases =
    p.aliases == null
      ? row.aliases
      : typeof p.aliases === "string"
        ? p.aliases
        : JSON.stringify(p.aliases);
  db.prepare(
    `UPDATE outbound_triggers SET
      kind=?, code=?, aliases=?, match_type=?, enabled=?, sort=?, updated_at=?
     WHERE id=? AND doctor_id=?`
  ).run(
    p.kind != null ? p.kind : row.kind,
    p.code != null ? String(p.code) : row.code,
    aliases,
    p.matchType != null ? p.matchType : row.match_type,
    p.enabled === false || p.enabled === 0
      ? 0
      : p.enabled === true || p.enabled === 1
        ? 1
        : row.enabled,
    p.sort != null ? +p.sort : row.sort,
    nowIso(),
    +triggerId,
    +doctorId
  );
  if (Object.prototype.hasOwnProperty.call(p, "steps")) {
    replaceSteps(doctorId, triggerId, p.steps);
  }
  return getTrigger(doctorId, triggerId);
}

function deleteTrigger(doctorId, triggerId) {
  const row = getTriggerRow(doctorId, triggerId);
  if (!row) return false;
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("DELETE FROM outbound_trigger_steps WHERE trigger_id=?").run(+triggerId);
    db.prepare("DELETE FROM outbound_triggers WHERE id=? AND doctor_id=?").run(+triggerId, +doctorId);
    db.exec("COMMIT");
  } catch (e) {
    try {
      db.exec("ROLLBACK");
    } catch (_) {
      /* ignore */
    }
    throw e;
  }
  return true;
}

module.exports = {
  nowIso,
  createAsset,
  listAssets,
  updateAsset,
  deleteAsset,
  createTrigger,
  getTrigger,
  updateTrigger,
  deleteTrigger,
  replaceSteps,
  listTriggers,
  createCodeBundle,
};
