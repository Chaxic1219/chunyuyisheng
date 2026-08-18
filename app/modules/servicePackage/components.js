"use strict";

const { nowIso } = require("./schema.js");

const TYPES = new Set([
  "MEDICAL_CONSULTATION",
  "REPORT_INTERPRETATION",
  "DAILY_RECOMMENDATION",
  "FOOD_CALORIE_ESTIMATE",
  "REHAB_ASSESSMENT",
  "FOLLOWUP_SERVICE",
  "PHYSICAL_GOODS",
]);

const CODE_RE = /^[A-Z0-9_-]+$/;

function isPlainObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parseConfigJson(s) {
  if (s == null) return {};
  try {
    const v = JSON.parse(s);
    return isPlainObject(v) ? v : {};
  } catch (e) {
    return {};
  }
}

function mapRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    type: row.type,
    providerType: row.provider_type,
    providerRef: row.provider_ref || "",
    providerName: row.provider_name || "",
    description: row.description || "",
    defaultUnit: row.default_unit,
    defaultSlaHours: row.default_sla_hours,
    defaultActionKey: row.default_action_key || "",
    defaultActionLabel: row.default_action_label || "",
    settlementEnabled: !!row.settlement_enabled,
    config: parseConfigJson(row.config_json),
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function createComponents(db) {
  function list({ type, status } = {}) {
    let sql = `SELECT * FROM svc_components WHERE 1=1`;
    const args = [];
    if (type) {
      sql += ` AND type = ?`;
      args.push(String(type));
    }
    if (status) {
      sql += ` AND status = ?`;
      args.push(String(status));
    }
    sql += ` ORDER BY id ASC`;
    return db
      .prepare(sql)
      .all(...args)
      .map(mapRow);
  }

  function getById(id) {
    const row = db.prepare(`SELECT * FROM svc_components WHERE id=?`).get(+id);
    return mapRow(row);
  }

  function validate(body) {
    const errors = [];

    if (!body.code || !String(body.code).trim()) {
      errors.push("code 必填");
    }
    if (!body.name || !String(body.name).trim()) {
      errors.push("name 必填");
    }
    if (!body.type || !String(body.type).trim()) {
      errors.push("type 必填");
    }
    if (!body.defaultUnit || !String(body.defaultUnit).trim()) {
      errors.push("defaultUnit 必填");
    }

    if (errors.length) {
      const err = new Error(errors.join("; "));
      err.code = "validation";
      throw err;
    }

    const code = String(body.code).trim().toUpperCase();
    if (!CODE_RE.test(code)) {
      const err = new Error("code 只能包含大写字母、数字、下划线和连字符");
      err.code = "validation";
      throw err;
    }

    const type = String(body.type).trim();
    if (!TYPES.has(type)) {
      const err = new Error(`type 不合法，可选值: ${[...TYPES].join(", ")}`);
      err.code = "validation";
      throw err;
    }

    if (body.defaultSlaHours != null && Number(body.defaultSlaHours) < 0) {
      const err = new Error("defaultSlaHours 不能为负数");
      err.code = "validation";
      throw err;
    }

    let config = null;
    if (body.config !== undefined) {
      if (!isPlainObject(body.config)) {
        const err = new Error("config 必须是对象");
        err.code = "validation";
        throw err;
      }
      try {
        JSON.stringify(body.config);
      } catch (e) {
        const err = new Error("config 必须是可 JSON 序列化的对象");
        err.code = "validation";
        throw err;
      }
      config = body.config;
    }

    return {
      code,
      name: String(body.name).trim(),
      type,
      providerType: String(body.providerType || "internal").trim(),
      providerRef: String(body.providerRef || "").trim(),
      providerName: String(body.providerName || "").trim(),
      description: String(body.description || "").trim(),
      defaultUnit: String(body.defaultUnit).trim(),
      defaultSlaHours: body.defaultSlaHours != null ? Math.max(0, Number(body.defaultSlaHours)) : 0,
      defaultActionKey: String(body.defaultActionKey || "").trim(),
      defaultActionLabel: String(body.defaultActionLabel || "").trim(),
      settlementEnabled: body.settlementEnabled ? 1 : 0,
      config,
    };
  }

  function create(body) {
    const v = validate(body);

    const existing = db.prepare(`SELECT id FROM svc_components WHERE code=?`).get(v.code);
    if (existing) {
      const err = new Error("组件 code 已存在");
      err.code = "validation";
      throw err;
    }

    const ts = nowIso();
    const configJson = v.config != null ? JSON.stringify(v.config) : null;
    const info = db
      .prepare(
        `INSERT INTO svc_components(
          code, name, type, provider_type, provider_ref, provider_name,
          description, default_unit, default_sla_hours,
          default_action_key, default_action_label, settlement_enabled,
          config_json, status, created_at, updated_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      )
      .run(
        v.code, v.name, v.type, v.providerType, v.providerRef, v.providerName,
        v.description, v.defaultUnit, v.defaultSlaHours,
        v.defaultActionKey, v.defaultActionLabel, v.settlementEnabled,
        configJson, "active", ts, ts
      );
    return getById(Number(info.lastInsertRowid));
  }

  function update(id, body) {
    const existing = db.prepare(`SELECT * FROM svc_components WHERE id=?`).get(+id);
    if (!existing) {
      const err = new Error("服务组件不存在");
      err.code = "not_found";
      throw err;
    }

    const v = validate(body);

    const clash = db.prepare(`SELECT id FROM svc_components WHERE code=? AND id<>?`).get(v.code, +id);
    if (clash) {
      const err = new Error("组件 code 已存在");
      err.code = "validation";
      throw err;
    }

    const ts = nowIso();
    const configJson = v.config != null ? JSON.stringify(v.config) : null;
    db.prepare(
      `UPDATE svc_components SET
        code=?, name=?, type=?, provider_type=?, provider_ref=?, provider_name=?,
        description=?, default_unit=?, default_sla_hours=?,
        default_action_key=?, default_action_label=?, settlement_enabled=?,
        config_json=?, updated_at=?
       WHERE id=?`
    ).run(
      v.code, v.name, v.type, v.providerType, v.providerRef, v.providerName,
      v.description, v.defaultUnit, v.defaultSlaHours,
      v.defaultActionKey, v.defaultActionLabel, v.settlementEnabled,
      configJson, ts, +id
    );
    return getById(+id);
  }

  function disable(id) {
    const existing = db.prepare(`SELECT * FROM svc_components WHERE id=?`).get(+id);
    if (!existing) {
      const err = new Error("服务组件不存在");
      err.code = "not_found";
      throw err;
    }

    const ts = nowIso();
    db.prepare(`UPDATE svc_components SET status='disabled', updated_at=? WHERE id=?`).run(ts, +id);
    return getById(+id);
  }

  return { list, getById, create, update, disable, mapRow };
}

module.exports = { createComponents };
