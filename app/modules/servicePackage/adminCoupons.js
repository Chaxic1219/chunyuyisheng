"use strict";

const { nowIso } = require("./schema.js");

function fail(code, message) {
  const err = new Error(message);
  err.code = code;
  throw err;
}

function mapTemplate(row) {
  if (!row) return null;
  return {
    id: row.id,
    doctorId: row.doctor_id,
    title: row.title,
    type: row.type,
    thresholdCents: Number(row.threshold_cents || 0),
    discountCents: Number(row.discount_cents || 0),
    percentOff: Number(row.percent_off || 0),
    maxDiscountCents: Number(row.max_discount_cents || 0),
    threshold: Number(row.threshold_cents || 0) / 100,
    discount: Number(row.discount_cents || 0) / 100,
    percent: Number(row.percent_off || 0),
    max: Number(row.max_discount_cents || 0) / 100,
    category: row.category || null,
    status: row.status,
    totalQuota: Number(row.total_quota || 0),
    claimedCount: Number(row.claimed_count || 0),
    quota: Number(row.total_quota || 0),
    perUserLimit: Number(row.per_user_limit || 1),
    startsAt: row.starts_at || null,
    endsAt: row.ends_at || null,
    starts: row.starts_at || null,
    ends: row.ends_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapCoupon(row, template) {
  if (!row) return null;
  return {
    id: row.id,
    templateId: row.template_id,
    personId: row.person_id,
    doctorId: row.doctor_id,
    status: row.status,
    discountSnapshotCents:
      row.discount_snapshot_cents == null ? null : Number(row.discount_snapshot_cents),
    orderId: row.order_id == null ? null : Number(row.order_id),
    claimedAt: row.claimed_at,
    lockedAt: row.locked_at || null,
    usedAt: row.used_at || null,
    expiresAt: row.expires_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    template: template || null,
  };
}

function yuanToCents(v) {
  if (v == null || v === "") return 0;
  return Math.round(Number(v) * 100);
}

function normalizeBody(body, { partial = false } = {}) {
  const b = body || {};
  const out = {};

  if (b.title != null || !partial) {
    const title = String(b.title || "").trim();
    if (!title && !partial) fail("validation", "请填写优惠券名称");
    if (title) out.title = title;
  }

  if (b.type != null || !partial) {
    const type = String(b.type || "fixed").trim();
    if (type !== "fixed" && type !== "percent") fail("validation", "type 须为 fixed 或 percent");
    out.type = type;
  }

  if (b.thresholdCents != null) {
    out.thresholdCents = Math.max(0, Math.floor(Number(b.thresholdCents) || 0));
  } else if (b.threshold != null || !partial) {
    out.thresholdCents = yuanToCents(b.threshold != null ? b.threshold : 0);
  }

  if (b.discountCents != null) {
    out.discountCents = Math.max(0, Math.floor(Number(b.discountCents) || 0));
  } else if (b.discount != null || !partial) {
    out.discountCents = yuanToCents(b.discount != null ? b.discount : 0);
  }

  if (b.percent != null || b.percentOff != null || !partial) {
    const p = b.percent != null ? b.percent : b.percentOff;
    out.percentOff = Math.max(0, Math.min(100, Math.floor(Number(p != null ? p : 0) || 0)));
  }

  if (b.maxDiscountCents != null) {
    out.maxDiscountCents = Math.max(0, Math.floor(Number(b.maxDiscountCents) || 0));
  } else if (b.max != null || b.maxDiscount != null || !partial) {
    const m = b.max != null ? b.max : b.maxDiscount;
    out.maxDiscountCents = yuanToCents(m != null ? m : 0);
  }

  if (b.category !== undefined) {
    const cat = b.category == null || b.category === "" ? null : String(b.category).trim();
    out.category = cat;
  } else if (!partial) {
    out.category = null;
  }

  if (b.quota != null || b.totalQuota != null || !partial) {
    const q = b.quota != null ? b.quota : b.totalQuota;
    out.totalQuota = Math.max(0, Math.floor(Number(q != null ? q : 0) || 0));
  }

  if (b.perUserLimit != null || !partial) {
    out.perUserLimit = Math.max(1, Math.floor(Number(b.perUserLimit != null ? b.perUserLimit : 1) || 1));
  }

  if (b.starts != null || b.startsAt != null) {
    const s = b.starts != null ? b.starts : b.startsAt;
    out.startsAt = s ? String(s).trim() : null;
  } else if (!partial) {
    out.startsAt = null;
  }

  if (b.ends != null || b.endsAt != null) {
    const e = b.ends != null ? b.ends : b.endsAt;
    out.endsAt = e ? String(e).trim() : null;
  } else if (!partial) {
    out.endsAt = null;
  }

  const type = out.type;
  if (type === "fixed" && out.discountCents != null && out.discountCents <= 0 && !partial) {
    fail("validation", "固定金额优惠券须设置 discount > 0");
  }
  if (type === "percent" && out.percentOff != null && out.percentOff <= 0 && !partial) {
    fail("validation", "折扣券须设置 percent > 0");
  }

  return out;
}

function createAdminCoupons(db, couponsApi) {
  function getRaw(id) {
    return db.prepare(`SELECT * FROM svc_coupon_templates WHERE id=?`).get(+id);
  }

  function listTemplates({ doctorId, status } = {}) {
    let sql = `SELECT * FROM svc_coupon_templates WHERE 1=1`;
    const args = [];
    if (doctorId != null && doctorId !== "") {
      sql += ` AND doctor_id=?`;
      args.push(+doctorId);
    }
    if (status) {
      sql += ` AND status=?`;
      args.push(String(status));
    }
    sql += ` ORDER BY id DESC`;
    return db.prepare(sql).all(...args).map(mapTemplate);
  }

  function getTemplate(id) {
    return mapTemplate(getRaw(id));
  }

  function create(body) {
    const b = body || {};
    const doctorId = +(b.doctorId);
    if (!Number.isFinite(doctorId) || doctorId <= 0) fail("validation", "缺少有效医生 doctorId");
    const doctor = db.prepare(`SELECT id FROM doctors WHERE id=?`).get(doctorId);
    if (!doctor) fail("validation", "医生不存在");

    const n = normalizeBody(b);
    const ts = nowIso();
    const publishNow = b.publish === true || b.status === "active";
    const status = publishNow ? "active" : "draft";

    const info = db
      .prepare(
        `INSERT INTO svc_coupon_templates(
          doctor_id, title, type, threshold_cents, discount_cents, percent_off,
          max_discount_cents, category, status, total_quota, claimed_count,
          per_user_limit, starts_at, ends_at, created_at, updated_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      )
      .run(
        doctorId,
        n.title,
        n.type,
        n.thresholdCents,
        n.discountCents,
        n.percentOff,
        n.maxDiscountCents,
        n.category,
        status,
        n.totalQuota,
        0,
        n.perUserLimit,
        n.startsAt,
        n.endsAt,
        ts,
        ts
      );

    return getTemplate(Number(info.lastInsertRowid));
  }

  function update(id, body) {
    const row = getRaw(id);
    if (!row) fail("not_found", "优惠券模板不存在");

    const n = normalizeBody(body || {}, { partial: true });
    const ts = nowIso();
    const next = {
      title: n.title != null ? n.title : row.title,
      type: n.type != null ? n.type : row.type,
      thresholdCents: n.thresholdCents != null ? n.thresholdCents : Number(row.threshold_cents || 0),
      discountCents: n.discountCents != null ? n.discountCents : Number(row.discount_cents || 0),
      percentOff: n.percentOff != null ? n.percentOff : Number(row.percent_off || 0),
      maxDiscountCents:
        n.maxDiscountCents != null ? n.maxDiscountCents : Number(row.max_discount_cents || 0),
      category: n.category !== undefined ? n.category : row.category,
      totalQuota: n.totalQuota != null ? n.totalQuota : Number(row.total_quota || 0),
      perUserLimit: n.perUserLimit != null ? n.perUserLimit : Number(row.per_user_limit || 1),
      startsAt: n.startsAt !== undefined ? n.startsAt : row.starts_at,
      endsAt: n.endsAt !== undefined ? n.endsAt : row.ends_at,
    };

    if (next.type === "fixed" && next.discountCents <= 0) {
      fail("validation", "固定金额优惠券须设置 discount > 0");
    }
    if (next.type === "percent" && next.percentOff <= 0) {
      fail("validation", "折扣券须设置 percent > 0");
    }

    db.prepare(
      `UPDATE svc_coupon_templates SET
        title=?, type=?, threshold_cents=?, discount_cents=?, percent_off=?,
        max_discount_cents=?, category=?, total_quota=?, per_user_limit=?,
        starts_at=?, ends_at=?, updated_at=?
       WHERE id=?`
    ).run(
      next.title,
      next.type,
      next.thresholdCents,
      next.discountCents,
      next.percentOff,
      next.maxDiscountCents,
      next.category,
      next.totalQuota,
      next.perUserLimit,
      next.startsAt,
      next.endsAt,
      ts,
      +id
    );

    return getTemplate(id);
  }

  function publish(id) {
    const row = getRaw(id);
    if (!row) fail("not_found", "优惠券模板不存在");
    const ts = nowIso();
    db.prepare(`UPDATE svc_coupon_templates SET status='active', updated_at=? WHERE id=?`).run(ts, +id);
    return getTemplate(id);
  }

  function offline(id) {
    const row = getRaw(id);
    if (!row) fail("not_found", "优惠券模板不存在");
    const ts = nowIso();
    db.prepare(`UPDATE svc_coupon_templates SET status='offline', updated_at=? WHERE id=?`).run(ts, +id);
    return getTemplate(id);
  }

  function grant({ templateId, personId } = {}) {
    const tid = +templateId;
    const pid = +personId;
    if (!Number.isFinite(tid) || tid <= 0) fail("validation", "缺少 templateId");
    if (!Number.isFinite(pid) || pid <= 0) fail("validation", "缺少 personId");

    const row = getRaw(tid);
    if (!row) fail("not_found", "优惠券模板不存在");

    if (couponsApi && typeof couponsApi.claim === "function" && row.status === "active") {
      try {
        return couponsApi.claim(pid, tid);
      } catch (e) {
        // 管理端发放：若因窗口/配额等失败，回退为直接插入（仍遵守 per_user_limit）
        if (
          e.code !== "coupon_out_of_window" &&
          e.code !== "coupon_quota_exhausted" &&
          e.code !== "coupon_inactive"
        ) {
          throw e;
        }
      }
    }

    // 管理端强制发放：创建 available 券并 bump claimed_count（仍检查个人上限）
    const now = nowIso();
    const limit = Number(row.per_user_limit || 1);
    const claimed = db
      .prepare(`SELECT COUNT(*) AS c FROM svc_coupons WHERE person_id=? AND template_id=?`)
      .get(pid, tid);
    if ((Number(claimed && claimed.c) || 0) >= limit) {
      fail("coupon_per_user_limit", "已达到个人领取上限");
    }

    const expiresAt = row.ends_at || null;
    const info = db
      .prepare(
        `INSERT INTO svc_coupons(
          template_id, person_id, doctor_id, status,
          claimed_at, expires_at, created_at, updated_at
        ) VALUES (?,?,?,'available',?,?,?,?)`
      )
      .run(tid, pid, row.doctor_id, now, expiresAt, now, now);

    db.prepare(
      `UPDATE svc_coupon_templates SET claimed_count=claimed_count+1, updated_at=? WHERE id=?`
    ).run(now, tid);

    const coupon = db.prepare(`SELECT * FROM svc_coupons WHERE id=?`).get(Number(info.lastInsertRowid));
    return mapCoupon(coupon, mapTemplate(getRaw(tid)));
  }

  function listCoupons({ doctorId, status, personId, limit } = {}) {
    let sql = `SELECT * FROM svc_coupons WHERE 1=1`;
    const args = [];
    if (doctorId != null && doctorId !== "") {
      sql += ` AND doctor_id=?`;
      args.push(+doctorId);
    }
    if (status) {
      sql += ` AND status=?`;
      args.push(String(status));
    }
    if (personId != null && personId !== "") {
      sql += ` AND person_id=?`;
      args.push(+personId);
    }
    sql += ` ORDER BY id DESC`;
    const lim = Math.min(500, Math.max(1, Number(limit) || 100));
    sql += ` LIMIT ?`;
    args.push(lim);

    const rows = db.prepare(sql).all(...args);
    return rows.map((r) => mapCoupon(r, mapTemplate(getRaw(r.template_id))));
  }

  function mapCode(row) {
    if (!row) return null;
    return {
      id: row.id,
      templateId: row.template_id,
      code: row.code,
      kind: row.kind || "single",
      maxUses: Number(row.max_uses || 0),
      usedCount: Number(row.used_count || 0),
      status: row.status,
      expiresAt: row.expires_at || null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  function randomCode(len = 8) {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let out = "";
    for (let i = 0; i < len; i += 1) {
      out += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    return out;
  }

  function normalizeCode(raw) {
    if (couponsApi && typeof couponsApi.normalizeRedeemCode === "function") {
      return couponsApi.normalizeRedeemCode(raw);
    }
    return String(raw || "")
      .trim()
      .toUpperCase()
      .replace(/\s+/g, "")
      .replace(/[^A-Z0-9\-]/g, "");
  }

  function generateCodes(templateId, body = {}) {
    const tid = +templateId;
    const tpl = getRaw(tid);
    if (!tpl) fail("not_found", "优惠券模板不存在");

    const kind = String(body.kind || "single").trim();
    if (kind !== "single" && kind !== "passphrase") {
      fail("validation", "kind 须为 single 或 passphrase");
    }

    const ts = nowIso();
    const expiresAt = body.expiresAt ? String(body.expiresAt).trim() : null;
    const created = [];

    if (kind === "single") {
      const count = Math.min(200, Math.max(1, Math.floor(Number(body.count) || 1)));
      for (let i = 0; i < count; i += 1) {
        let code = "";
        for (let attempt = 0; attempt < 20; attempt += 1) {
          code = randomCode(8);
          const exists = db
            .prepare(`SELECT 1 AS ok FROM svc_coupon_redemption_codes WHERE code=?`)
            .get(code);
          if (!exists) break;
          code = "";
        }
        if (!code) fail("validation", "生成兑换码冲突，请重试");
        const info = db
          .prepare(
            `INSERT INTO svc_coupon_redemption_codes(
              template_id, code, kind, max_uses, used_count, status, expires_at, created_at, updated_at
            ) VALUES (?,?,?,?,0,'active',?,?,?)`
          )
          .run(tid, code, "single", 1, expiresAt, ts, ts);
        created.push(mapCode(db.prepare(`SELECT * FROM svc_coupon_redemption_codes WHERE id=?`).get(Number(info.lastInsertRowid))));
      }
      return { codes: created };
    }

    // passphrase
    let code = normalizeCode(body.code);
    if (!code) code = randomCode(10);
    if (code.length < 4) fail("validation", "口令码至少 4 位");
    const exists = db
      .prepare(`SELECT 1 AS ok FROM svc_coupon_redemption_codes WHERE code=?`)
      .get(code);
    if (exists) fail("validation", "该兑换码已存在");
    const maxUses = Math.max(0, Math.floor(Number(body.maxUses != null ? body.maxUses : 0) || 0));
    const info = db
      .prepare(
        `INSERT INTO svc_coupon_redemption_codes(
          template_id, code, kind, max_uses, used_count, status, expires_at, created_at, updated_at
        ) VALUES (?,?,?,?,0,'active',?,?,?)`
      )
      .run(tid, code, "passphrase", maxUses, expiresAt, ts, ts);
    created.push(
      mapCode(db.prepare(`SELECT * FROM svc_coupon_redemption_codes WHERE id=?`).get(Number(info.lastInsertRowid)))
    );
    return { codes: created };
  }

  function listCodes(templateId, { limit } = {}) {
    const tid = +templateId;
    const tpl = getRaw(tid);
    if (!tpl) fail("not_found", "优惠券模板不存在");
    const lim = Math.min(500, Math.max(1, Number(limit) || 100));
    const rows = db
      .prepare(
        `SELECT * FROM svc_coupon_redemption_codes WHERE template_id=? ORDER BY id DESC LIMIT ?`
      )
      .all(tid, lim);
    return rows.map(mapCode);
  }

  function disableCode(codeId) {
    const row = db.prepare(`SELECT * FROM svc_coupon_redemption_codes WHERE id=?`).get(+codeId);
    if (!row) fail("not_found", "兑换码不存在");
    const ts = nowIso();
    db.prepare(
      `UPDATE svc_coupon_redemption_codes SET status='disabled', updated_at=? WHERE id=?`
    ).run(ts, +codeId);
    return mapCode(db.prepare(`SELECT * FROM svc_coupon_redemption_codes WHERE id=?`).get(+codeId));
  }

  function getCode(codeId) {
    return mapCode(db.prepare(`SELECT * FROM svc_coupon_redemption_codes WHERE id=?`).get(+codeId));
  }

  return {
    listTemplates,
    getTemplate,
    create,
    update,
    publish,
    offline,
    grant,
    listCoupons,
    generateCodes,
    listCodes,
    disableCode,
    getCode,
  };
}

module.exports = { createAdminCoupons };
