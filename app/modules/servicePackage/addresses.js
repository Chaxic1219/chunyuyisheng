"use strict";

const { nowIso } = require("./schema.js");

function createAddresses(db) {
  function rowToDto(row) {
    if (!row) return null;
    return {
      id: String(row.id),
      name: String(row.name || ""),
      phone: String(row.phone || ""),
      region: String(row.region || ""),
      detail: String(row.detail || ""),
      isDefault: !!row.is_default,
      updatedAt: String(row.updated_at || row.created_at || ""),
    };
  }

  function assertComplete(body) {
    const name = String((body && body.name) || "").trim();
    const phone = String((body && body.phone) || "").trim();
    const region = String((body && body.region) || "").trim();
    const detail = String((body && body.detail) || "").trim();
    if (!name || !phone || !region || !detail) {
      const err = new Error("请填写完整地址信息");
      err.code = "invalid_address";
      throw err;
    }
    if (!/^1\d{10}$/.test(phone)) {
      const err = new Error("请填写正确手机号");
      err.code = "invalid_phone";
      throw err;
    }
    return { name, phone, region, detail };
  }

  function list(personId) {
    const rows = db
      .prepare(
        `SELECT * FROM mp_person_addresses
         WHERE person_id=?
         ORDER BY is_default DESC, updated_at DESC, id DESC`
      )
      .all(+personId);
    return rows.map(rowToDto);
  }

  function get(personId, id) {
    const row = db
      .prepare(`SELECT * FROM mp_person_addresses WHERE id=? AND person_id=?`)
      .get(+id, +personId);
    return rowToDto(row);
  }

  function clearDefault(personId) {
    db.prepare(`UPDATE mp_person_addresses SET is_default=0 WHERE person_id=?`).run(+personId);
  }

  function ensureOneDefault(personId) {
    const has = db
      .prepare(
        `SELECT id FROM mp_person_addresses WHERE person_id=? AND is_default=1 LIMIT 1`
      )
      .get(+personId);
    if (has) return;
    const first = db
      .prepare(
        `SELECT id FROM mp_person_addresses WHERE person_id=? ORDER BY updated_at DESC, id DESC LIMIT 1`
      )
      .get(+personId);
    if (first) {
      db.prepare(`UPDATE mp_person_addresses SET is_default=1 WHERE id=?`).run(first.id);
    }
  }

  function create(personId, body) {
    const fields = assertComplete(body);
    const wantDefault = body && (body.isDefault === true || body.is_default === 1);
    const existing = list(personId);
    const makeDefault = wantDefault || existing.length === 0;
    const ts = nowIso();
    if (makeDefault) clearDefault(personId);
    const info = db
      .prepare(
        `INSERT INTO mp_person_addresses(
          person_id, name, phone, region, detail, is_default, created_at, updated_at
        ) VALUES (?,?,?,?,?,?,?,?)`
      )
      .run(
        +personId,
        fields.name,
        fields.phone,
        fields.region,
        fields.detail,
        makeDefault ? 1 : 0,
        ts,
        ts
      );
    return get(personId, info.lastInsertRowid);
  }

  function update(personId, id, body) {
    const cur = get(personId, id);
    if (!cur) {
      const err = new Error("地址不存在");
      err.code = "not_found";
      throw err;
    }
    const merged = {
      name: body && body.name != null ? body.name : cur.name,
      phone: body && body.phone != null ? body.phone : cur.phone,
      region: body && body.region != null ? body.region : cur.region,
      detail: body && body.detail != null ? body.detail : cur.detail,
    };
    const fields = assertComplete(merged);
    const wantDefault =
      body && Object.prototype.hasOwnProperty.call(body, "isDefault")
        ? !!body.isDefault
        : cur.isDefault;
    const ts = nowIso();
    if (wantDefault) clearDefault(personId);
    db.prepare(
      `UPDATE mp_person_addresses
       SET name=?, phone=?, region=?, detail=?, is_default=?, updated_at=?
       WHERE id=? AND person_id=?`
    ).run(
      fields.name,
      fields.phone,
      fields.region,
      fields.detail,
      wantDefault ? 1 : 0,
      ts,
      +id,
      +personId
    );
    ensureOneDefault(personId);
    return get(personId, id);
  }

  function remove(personId, id) {
    const cur = get(personId, id);
    if (!cur) {
      const err = new Error("地址不存在");
      err.code = "not_found";
      throw err;
    }
    db.prepare(`DELETE FROM mp_person_addresses WHERE id=? AND person_id=?`).run(+id, +personId);
    ensureOneDefault(personId);
    return { ok: true };
  }

  function setDefault(personId, id) {
    const cur = get(personId, id);
    if (!cur) {
      const err = new Error("地址不存在");
      err.code = "not_found";
      throw err;
    }
    const ts = nowIso();
    clearDefault(personId);
    db.prepare(
      `UPDATE mp_person_addresses SET is_default=1, updated_at=? WHERE id=? AND person_id=?`
    ).run(ts, +id, +personId);
    return get(personId, id);
  }

  return { list, get, create, update, remove, setDefault };
}

module.exports = { createAddresses };
