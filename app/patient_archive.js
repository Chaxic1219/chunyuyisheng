"use strict";

/**
 * 患者档案软归档：手动合并（字段决议 + 24h 可撤销）、软删除与回收站。
 * 自动 mergePatients 仍可物理删源；本模块专供医助手动路径。
 */

const MERGE_FIELD_KEYS = [
  "display_name",
  "real_name",
  "phone",
  "avatar_url",
  "notes",
  "gender",
  "birth_date",
  "tags",
  "follow_stage",
  "family_role",
  "family_household_id"
];

const UNDO_HOURS = 24;

function nowIso() {
  return new Date().toISOString();
}

function plusHours(iso, hours) {
  const t = Date.parse(iso || nowIso());
  return new Date(t + hours * 3600 * 1000).toISOString();
}

function str(v) {
  return v == null ? "" : String(v).trim();
}

function isArchivedRow(row) {
  return !!(row && row.archived_at);
}

function ensureSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS patient_archive_ops(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    doctor_id INTEGER NOT NULL,
    op_type TEXT NOT NULL,
    keep_patient_id INTEGER,
    source_patient_id INTEGER,
    field_resolutions_json TEXT,
    keep_snapshot_json TEXT,
    source_snapshot_json TEXT,
    relation_moves_json TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    expires_at TEXT NOT NULL,
    created_by INTEGER,
    created_at TEXT NOT NULL,
    undone_at TEXT
  )`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_patient_archive_ops_doctor_status
    ON patient_archive_ops(doctor_id, status, expires_at)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_patient_archive_ops_keep
    ON patient_archive_ops(keep_patient_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_patient_archive_ops_source
    ON patient_archive_ops(source_patient_id)`);
}

function patientPublic(row, extra) {
  if (!row) return null;
  return Object.assign({
    id: row.id,
    doctorId: row.doctor_id,
    displayName: row.display_name || "",
    realName: row.real_name || "",
    phone: row.phone || "",
    phoneVerified: !!row.phone_verified,
    avatarUrl: row.avatar_url || "",
    notes: row.notes || "",
    gender: row.gender || "",
    birthDate: row.birth_date || "",
    tags: row.tags || "",
    followStage: row.follow_stage || "",
    familyRole: row.family_role || "",
    familyHouseholdId: row.family_household_id || "",
    familyDoctorEnrolled: !!row.family_doctor_enrolled,
    personId: row.person_id || null,
    channels: extra && extra.channels != null ? extra.channels : undefined,
    msgCount: extra && extra.msgCount != null ? extra.msgCount : undefined,
    archivedAt: row.archived_at || null
  }, extra && extra.more || {});
}

function loadPatientExtras(db, did, pid) {
  const channels = db.prepare(
    "SELECT GROUP_CONCAT(DISTINCT channel) AS c FROM patient_identities WHERE patient_id=?"
  ).get(pid);
  const msg = db.prepare(
    `SELECT COUNT(*) AS c FROM message_log
     WHERE doctor_id=? AND (patient_id=? OR sender_id IN (SELECT external_id FROM patient_identities WHERE patient_id=?))`
  ).get(did, String(pid), pid);
  return {
    channels: (channels && channels.c) || "",
    msgCount: (msg && msg.c) || 0
  };
}

function pickNonEmpty(a, b) {
  const sa = str(a);
  const sb = str(b);
  if (sa && !sb) return sa;
  if (sb && !sa) return sb;
  return null; // both empty or both nonempty → caller decides
}

function defaultFieldValue(key, keepRow, srcRow, preferDisplayName) {
  const kv = keepRow[key];
  const sv = srcRow[key];
  if (key === "display_name") {
    return preferDisplayName(keepRow.display_name, srcRow.display_name);
  }
  if (key === "notes") {
    return [keepRow.notes, srcRow.notes].filter(Boolean).join("\n").slice(0, 2000) || "";
  }
  if (key === "phone") {
    if (keepRow.phone_verified && str(keepRow.phone)) return str(keepRow.phone);
    if (srcRow.phone_verified && str(srcRow.phone)) return str(srcRow.phone);
    return str(keepRow.phone) || str(srcRow.phone) || "";
  }
  const picked = pickNonEmpty(kv, sv);
  if (picked != null) return picked;
  // both nonempty: prefer keep if verified phone / contact channel on keep side later; else keep
  return str(kv) || str(sv) || "";
}

function suggestKeepId(a, b, extrasA, extrasB) {
  const score = (row, ex) => {
    let s = 0;
    if (row.phone_verified) s += 100;
    if (/联络|invite|form|sms|h5/i.test(ex.channels || "")) s += 40;
    s += Math.min(50, Number(ex.msgCount) || 0);
    s -= Number(row.id) * 0.001; // smaller id slight preference when tied
    return s;
  };
  return score(a, extrasA) >= score(b, extrasB) ? a.id : b.id;
}

function buildDefaultResolutions(keepRow, srcRow, preferDisplayName) {
  const out = {};
  for (const key of MERGE_FIELD_KEYS) {
    out[key] = defaultFieldValue(key, keepRow, srcRow, preferDisplayName);
  }
  out.phone_verified = !!(keepRow.phone_verified || srcRow.phone_verified);
  out.family_doctor_enrolled = !!(keepRow.family_doctor_enrolled || srcRow.family_doctor_enrolled);
  return out;
}

function applyResolutionsToRow(baseRow, resolutions) {
  const r = resolutions || {};
  const next = Object.assign({}, baseRow);
  for (const key of MERGE_FIELD_KEYS) {
    if (Object.prototype.hasOwnProperty.call(r, key)) {
      next[key] = r[key] == null ? null : String(r[key]);
    }
  }
  if (Object.prototype.hasOwnProperty.call(r, "phone_verified")) {
    next.phone_verified = r.phone_verified ? 1 : 0;
  } else {
    next.phone_verified = baseRow.phone_verified ? 1 : 0;
  }
  if (Object.prototype.hasOwnProperty.call(r, "family_doctor_enrolled")) {
    next.family_doctor_enrolled = r.family_doctor_enrolled ? 1 : 0;
  }
  return next;
}

function buildMergePreview(db, deps, doctorId, patientIdA, patientIdB) {
  const did = +doctorId;
  const idA = +patientIdA;
  const idB = +patientIdB;
  if (!Number.isInteger(did) || did <= 0) throw new Error("doctorId 非法");
  if (!Number.isInteger(idA) || !Number.isInteger(idB) || idA <= 0 || idB <= 0) {
    throw new Error("请选择两份档案");
  }
  if (idA === idB) throw new Error("请选择两份不同的档案");
  const a = db.prepare("SELECT * FROM patients WHERE id=? AND doctor_id=?").get(idA, did);
  const b = db.prepare("SELECT * FROM patients WHERE id=? AND doctor_id=?").get(idB, did);
  if (!a || !b) throw new Error("档案不存在");
  if (isArchivedRow(a) || isArchivedRow(b)) throw new Error("所选档案已归档，请刷新后重试");
  const exA = loadPatientExtras(db, did, idA);
  const exB = loadPatientExtras(db, did, idB);
  const suggestedKeepId = suggestKeepId(a, b, exA, exB);
  const keepRow = suggestedKeepId === idA ? a : b;
  const srcRow = suggestedKeepId === idA ? b : a;
  const defaultResolutions = buildDefaultResolutions(keepRow, srcRow, deps.preferDisplayName);
  const previewRow = applyResolutionsToRow(keepRow, defaultResolutions);
  return {
    ok: true,
    patientA: patientPublic(a, exA),
    patientB: patientPublic(b, exB),
    suggestedKeepId,
    defaultResolutions,
    preview: patientPublic(previewRow, {
      channels: [exA.channels, exB.channels].filter(Boolean).join(","),
      msgCount: (exA.msgCount || 0) + (exB.msgCount || 0)
    }),
    fieldKeys: MERGE_FIELD_KEYS.slice()
  };
}

function collectRelationMoves(db, did, keepId, sourceId) {
  const moves = {
    patient_identities: [],
    community_members: [],
    message_log: [],
    submissions: [],
    followups: [],
    patient_health_records: [],
    triage_sessions: [],
    deleted_identity_ids: []
  };
  const idents = db.prepare("SELECT * FROM patient_identities WHERE patient_id=?").all(sourceId);
  for (const idn of idents) {
    const other = db.prepare(
      "SELECT id FROM patient_identities WHERE doctor_id=? AND channel=? AND external_id=? AND id!=?"
    ).get(did, idn.channel, idn.external_id, idn.id);
    if (other) {
      moves.deleted_identity_ids.push({ id: idn.id, row: idn });
    } else {
      moves.patient_identities.push(idn.id);
    }
  }
  moves.community_members = db.prepare("SELECT id FROM community_members WHERE patient_id=?")
    .all(sourceId).map((x) => x.id);
  moves.message_log = db.prepare(
    "SELECT id FROM message_log WHERE doctor_id=? AND patient_id=?"
  ).all(did, String(sourceId)).map((x) => x.id);
  try {
    moves.submissions = db.prepare("SELECT id FROM submissions WHERE patient_id=?")
      .all(sourceId).map((x) => x.id);
  } catch (e) { moves.submissions = []; }
  try {
    moves.followups = db.prepare("SELECT id FROM followups WHERE patient_id=?")
      .all(sourceId).map((x) => x.id);
  } catch (e) { moves.followups = []; }
  try {
    moves.patient_health_records = db.prepare("SELECT id FROM patient_health_records WHERE patient_id=?")
      .all(sourceId).map((x) => x.id);
  } catch (e) { moves.patient_health_records = []; }
  try {
    moves.triage_sessions = db.prepare("SELECT id FROM triage_sessions WHERE patient_id=?")
      .all(sourceId).map((x) => x.id);
  } catch (e) { moves.triage_sessions = []; }
  return moves;
}

function applyRelationMoves(db, did, keepId, sourceId, moves) {
  for (const idn of moves.deleted_identity_ids || []) {
    db.prepare("DELETE FROM patient_identities WHERE id=?").run(idn.id);
  }
  for (const id of moves.patient_identities || []) {
    db.prepare("UPDATE patient_identities SET patient_id=? WHERE id=?").run(keepId, id);
  }
  for (const id of moves.community_members || []) {
    db.prepare("UPDATE community_members SET patient_id=? WHERE id=?").run(keepId, id);
  }
  for (const id of moves.message_log || []) {
    db.prepare("UPDATE message_log SET patient_id=? WHERE id=?").run(String(keepId), id);
  }
  for (const id of moves.submissions || []) {
    try { db.prepare("UPDATE submissions SET patient_id=? WHERE id=?").run(keepId, id); } catch (e) {}
  }
  for (const id of moves.followups || []) {
    try { db.prepare("UPDATE followups SET patient_id=? WHERE id=?").run(keepId, id); } catch (e) {}
  }
  for (const id of moves.patient_health_records || []) {
    try { db.prepare("UPDATE patient_health_records SET patient_id=? WHERE id=?").run(keepId, id); } catch (e) {}
  }
  for (const id of moves.triage_sessions || []) {
    try { db.prepare("UPDATE triage_sessions SET patient_id=? WHERE id=?").run(keepId, id); } catch (e) {}
  }
}

function revertRelationMoves(db, did, keepId, sourceId, moves) {
  for (const id of moves.patient_identities || []) {
    db.prepare("UPDATE patient_identities SET patient_id=? WHERE id=?").run(sourceId, id);
  }
  for (const id of moves.community_members || []) {
    db.prepare("UPDATE community_members SET patient_id=? WHERE id=?").run(sourceId, id);
  }
  for (const id of moves.message_log || []) {
    db.prepare("UPDATE message_log SET patient_id=? WHERE id=?").run(String(sourceId), id);
  }
  for (const id of moves.submissions || []) {
    try { db.prepare("UPDATE submissions SET patient_id=? WHERE id=?").run(sourceId, id); } catch (e) {}
  }
  for (const id of moves.followups || []) {
    try { db.prepare("UPDATE followups SET patient_id=? WHERE id=?").run(sourceId, id); } catch (e) {}
  }
  for (const id of moves.patient_health_records || []) {
    try { db.prepare("UPDATE patient_health_records SET patient_id=? WHERE id=?").run(sourceId, id); } catch (e) {}
  }
  for (const id of moves.triage_sessions || []) {
    try { db.prepare("UPDATE triage_sessions SET patient_id=? WHERE id=?").run(sourceId, id); } catch (e) {}
  }
  for (const item of moves.deleted_identity_ids || []) {
    const r = item.row || item;
    try {
      db.prepare(`INSERT INTO patient_identities(
        id, doctor_id, patient_id, channel, external_id, group_id, open_kfid, unionid, created_at
      ) VALUES(?,?,?,?,?,?,?,?,?)`).run(
        r.id, r.doctor_id, sourceId, r.channel, r.external_id,
        r.group_id || null, r.open_kfid || null, r.unionid || null, r.created_at || nowIso()
      );
    } catch (e) {
      // id 冲突则重新插入不带 id
      try {
        db.prepare(`INSERT INTO patient_identities(
          doctor_id, patient_id, channel, external_id, group_id, open_kfid, unionid, created_at
        ) VALUES(?,?,?,?,?,?,?,?)`).run(
          r.doctor_id, sourceId, r.channel, r.external_id,
          r.group_id || null, r.open_kfid || null, r.unionid || null, r.created_at || nowIso()
        );
      } catch (e2) {}
    }
  }
}

function writePatientScalars(db, row) {
  db.prepare(`UPDATE patients SET
    display_name=?, real_name=?, phone=?, phone_verified=?, unionid=?,
    avatar_url=?, notes=?, gender=?, birth_date=?, tags=?, follow_stage=?,
    family_role=?, family_household_id=?, family_doctor_enrolled=?,
    person_id=?, archived_at=?, updated_at=?
    WHERE id=?`).run(
    row.display_name || "",
    row.real_name || "",
    row.phone || "",
    row.phone_verified ? 1 : 0,
    row.unionid || null,
    row.avatar_url || null,
    row.notes || null,
    row.gender || null,
    row.birth_date || null,
    row.tags || null,
    row.follow_stage || null,
    row.family_role || null,
    row.family_household_id || null,
    row.family_doctor_enrolled ? 1 : 0,
    row.person_id || null,
    row.archived_at || null,
    row.updated_at || nowIso(),
    row.id
  );
}

function softMergePatients(db, deps, input) {
  const did = +input.doctorId;
  let keepId = +input.keepId;
  const sourceId = +(input.sourceId || (input.mergeIds && input.mergeIds[0]));
  const createdBy = input.createdBy == null ? null : +input.createdBy;
  if (!Number.isInteger(did) || did <= 0) throw new Error("doctorId 非法");
  if (!Number.isInteger(keepId) || keepId <= 0) throw new Error("keepId 非法");
  if (!Number.isInteger(sourceId) || sourceId <= 0) throw new Error("请选择要合并的档案");
  if (keepId === sourceId) throw new Error("请选择两份不同的档案");

  let keepRow = db.prepare("SELECT * FROM patients WHERE id=? AND doctor_id=?").get(keepId, did);
  let srcRow = db.prepare("SELECT * FROM patients WHERE id=? AND doctor_id=?").get(sourceId, did);
  if (!keepRow || !srcRow) throw new Error("档案不存在");
  if (isArchivedRow(keepRow) || isArchivedRow(srcRow)) throw new Error("所选档案已归档，请刷新后重试");

  // person 合并（与 mergePatients 一致）
  if (srcRow.person_id && keepRow.person_id && +srcRow.person_id !== +keepRow.person_id) {
    deps.mergePersons(keepRow.person_id, [srcRow.person_id], "system", "softMergePatients");
    keepRow = db.prepare("SELECT * FROM patients WHERE id=? AND doctor_id=?").get(keepId, did);
    srcRow = db.prepare("SELECT * FROM patients WHERE id=? AND doctor_id=?").get(sourceId, did);
    if (!keepRow) {
      const pool = [keepId, sourceId].filter((id) =>
        db.prepare("SELECT 1 AS ok FROM patients WHERE id=? AND doctor_id=?").get(id, did)
      );
      if (!pool.length) throw new Error("保留档案在 person 合并后丢失");
      keepId = Math.min(...pool);
      keepRow = db.prepare("SELECT * FROM patients WHERE id=? AND doctor_id=?").get(keepId, did);
    }
    if (!srcRow || srcRow.id === keepId) {
      return { ok: true, patientId: keepId, patient: keepRow, opId: null, note: "person_merge_only" };
    }
  }

  const defaults = buildDefaultResolutions(keepRow, srcRow, deps.preferDisplayName);
  const resolutions = Object.assign({}, defaults, input.fieldResolutions || {});
  // phone_verified / family_doctor_enrolled 强制 OR
  resolutions.phone_verified = !!(keepRow.phone_verified || srcRow.phone_verified || resolutions.phone_verified);
  resolutions.family_doctor_enrolled = !!(
    keepRow.family_doctor_enrolled || srcRow.family_doctor_enrolled || resolutions.family_doctor_enrolled
  );

  const createdAt = nowIso();
  const expiresAt = plusHours(createdAt, UNDO_HOURS);
  const moves = collectRelationMoves(db, did, keepId, sourceId);
  const keepSnap = Object.assign({}, keepRow);
  const srcSnap = Object.assign({}, srcRow);

  db.exec("BEGIN IMMEDIATE");
  try {
    applyRelationMoves(db, did, keepId, sourceId, moves);
    const merged = applyResolutionsToRow(keepRow, resolutions);
    merged.id = keepId;
    merged.updated_at = createdAt;
    merged.archived_at = null;
    writePatientScalars(db, merged);
    db.prepare("UPDATE patients SET archived_at=?, updated_at=? WHERE id=?")
      .run(createdAt, createdAt, sourceId);

    const info = db.prepare(`INSERT INTO patient_archive_ops(
      doctor_id, op_type, keep_patient_id, source_patient_id,
      field_resolutions_json, keep_snapshot_json, source_snapshot_json, relation_moves_json,
      status, expires_at, created_by, created_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      did, "merge", keepId, sourceId,
      JSON.stringify(resolutions),
      JSON.stringify(keepSnap),
      JSON.stringify(srcSnap),
      JSON.stringify(moves),
      "active", expiresAt, createdBy, createdAt
    );
    db.exec("COMMIT");
    const next = db.prepare("SELECT * FROM patients WHERE id=?").get(keepId);
    return { ok: true, patientId: keepId, patient: next, opId: info.lastInsertRowid, expiresAt };
  } catch (e) {
    try { db.exec("ROLLBACK"); } catch (e2) {}
    throw e;
  }
}

function softDeletePatient(db, input) {
  const did = +input.doctorId;
  const pid = +input.patientId;
  const createdBy = input.createdBy == null ? null : +input.createdBy;
  if (!Number.isInteger(did) || did <= 0) throw new Error("doctorId 非法");
  if (!Number.isInteger(pid) || pid <= 0) throw new Error("patientId 非法");
  const row = db.prepare("SELECT * FROM patients WHERE id=? AND doctor_id=?").get(pid, did);
  if (!row) throw new Error("档案不存在");
  if (isArchivedRow(row)) throw new Error("档案已在回收站");

  const createdAt = nowIso();
  const expiresAt = plusHours(createdAt, UNDO_HOURS);
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("UPDATE patients SET archived_at=?, updated_at=? WHERE id=?")
      .run(createdAt, createdAt, pid);
    const info = db.prepare(`INSERT INTO patient_archive_ops(
      doctor_id, op_type, keep_patient_id, source_patient_id,
      field_resolutions_json, keep_snapshot_json, source_snapshot_json, relation_moves_json,
      status, expires_at, created_by, created_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      did, "delete", pid, pid,
      null,
      JSON.stringify(row),
      JSON.stringify(row),
      JSON.stringify({}),
      "active", expiresAt, createdBy, createdAt
    );
    db.exec("COMMIT");
    return { ok: true, patientId: pid, opId: info.lastInsertRowid, expiresAt };
  } catch (e) {
    try { db.exec("ROLLBACK"); } catch (e2) {}
    throw e;
  }
}

function expireArchiveOps(db, doctorId) {
  const now = nowIso();
  if (doctorId) {
    return db.prepare(
      "UPDATE patient_archive_ops SET status='expired' WHERE doctor_id=? AND status='active' AND expires_at < ?"
    ).run(+doctorId, now);
  }
  return db.prepare(
    "UPDATE patient_archive_ops SET status='expired' WHERE status='active' AND expires_at < ?"
  ).run(now);
}

function listRecycleBin(db, doctorId) {
  const did = +doctorId;
  expireArchiveOps(db, did);
  const rows = db.prepare(`SELECT * FROM patient_archive_ops
    WHERE doctor_id=? AND status='active' AND expires_at >= ?
    ORDER BY created_at DESC LIMIT 200`).all(did, nowIso());
  return rows.map((op) => {
    let keepSnap = null;
    let srcSnap = null;
    try { keepSnap = JSON.parse(op.keep_snapshot_json || "null"); } catch (e) {}
    try { srcSnap = JSON.parse(op.source_snapshot_json || "null"); } catch (e) {}
    return {
      id: op.id,
      opType: op.op_type,
      keepPatientId: op.keep_patient_id,
      sourcePatientId: op.source_patient_id,
      status: op.status,
      expiresAt: op.expires_at,
      createdAt: op.created_at,
      createdBy: op.created_by,
      keepLabel: keepSnap
        ? (keepSnap.real_name || keepSnap.display_name || ("#" + keepSnap.id))
        : ("#" + op.keep_patient_id),
      sourceLabel: srcSnap
        ? (srcSnap.real_name || srcSnap.display_name || ("#" + srcSnap.id))
        : ("#" + op.source_patient_id)
    };
  });
}

function undoArchiveOp(db, deps, doctorId, opId) {
  const did = +doctorId;
  const oid = +opId;
  expireArchiveOps(db, did);
  const op = db.prepare("SELECT * FROM patient_archive_ops WHERE id=? AND doctor_id=?").get(oid, did);
  if (!op) throw Object.assign(new Error("操作记录不存在"), { status: 404 });
  if (op.status === "undone") throw Object.assign(new Error("已撤销过"), { status: 409 });
  if (op.status === "expired" || op.expires_at < nowIso()) {
    throw Object.assign(new Error("已超过 24 小时恢复期限"), { status: 410 });
  }
  if (op.status !== "active") throw Object.assign(new Error("状态不可撤销"), { status: 409 });

  if (op.op_type === "merge") {
    // 依赖链：keep 又作为 source 参与了后续 active merge
    const chained = db.prepare(`SELECT id FROM patient_archive_ops
      WHERE doctor_id=? AND status='active' AND op_type='merge' AND source_patient_id=? AND id!=?`)
      .get(did, op.keep_patient_id, oid);
    if (chained) {
      throw Object.assign(new Error("保留档之后又被合并，无法直接撤销（依赖链）"), { status: 409 });
    }
  }

  let keepSnap = {};
  let srcSnap = {};
  let moves = {};
  try { keepSnap = JSON.parse(op.keep_snapshot_json || "{}"); } catch (e) {}
  try { srcSnap = JSON.parse(op.source_snapshot_json || "{}"); } catch (e) {}
  try { moves = JSON.parse(op.relation_moves_json || "{}"); } catch (e) {}

  const undoneAt = nowIso();
  db.exec("BEGIN IMMEDIATE");
  try {
    if (op.op_type === "delete") {
      const row = db.prepare("SELECT * FROM patients WHERE id=? AND doctor_id=?").get(op.keep_patient_id, did);
      if (!row) throw new Error("待恢复档案不存在");
      db.prepare("UPDATE patients SET archived_at=NULL, updated_at=? WHERE id=?")
        .run(undoneAt, op.keep_patient_id);
    } else if (op.op_type === "merge") {
      const keepId = op.keep_patient_id;
      const sourceId = op.source_patient_id;
      const keepCur = db.prepare("SELECT * FROM patients WHERE id=? AND doctor_id=?").get(keepId, did);
      const srcCur = db.prepare("SELECT * FROM patients WHERE id=? AND doctor_id=?").get(sourceId, did);
      if (!keepCur || !srcCur) throw new Error("合并双方档案不完整，无法撤销");
      revertRelationMoves(db, did, keepId, sourceId, moves);
      keepSnap.id = keepId;
      keepSnap.archived_at = null;
      keepSnap.updated_at = undoneAt;
      srcSnap.id = sourceId;
      srcSnap.archived_at = null;
      srcSnap.updated_at = undoneAt;
      writePatientScalars(db, keepSnap);
      writePatientScalars(db, srcSnap);
    } else {
      throw new Error("未知操作类型");
    }
    db.prepare("UPDATE patient_archive_ops SET status='undone', undone_at=? WHERE id=?")
      .run(undoneAt, oid);
    db.exec("COMMIT");
    return { ok: true, opId: oid };
  } catch (e) {
    try { db.exec("ROLLBACK"); } catch (e2) {}
    throw e;
  }
}

module.exports = {
  MERGE_FIELD_KEYS,
  UNDO_HOURS,
  ensureSchema,
  buildMergePreview,
  softMergePatients,
  softDeletePatient,
  listRecycleBin,
  undoArchiveOp,
  expireArchiveOps,
  patientPublic
};
