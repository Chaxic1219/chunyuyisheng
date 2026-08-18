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
    category: row.category || null,
    status: row.status,
    totalQuota: Number(row.total_quota || 0),
    claimedCount: Number(row.claimed_count || 0),
    perUserLimit: Number(row.per_user_limit || 1),
    startsAt: row.starts_at || null,
    endsAt: row.ends_at || null,
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

function inWindow(template, now) {
  if (template.starts_at && String(template.starts_at) > now) return false;
  if (template.ends_at && String(template.ends_at) < now) return false;
  return true;
}

function computeDiscount(template, subtotalCents) {
  const subtotal = Math.max(0, Math.floor(Number(subtotalCents) || 0));
  const threshold = Number(template.threshold_cents || 0);
  if (subtotal < threshold) {
    return { usable: false, discountCents: 0, payableCents: subtotal };
  }

  let discount = 0;
  const type = String(template.type || "");
  if (type === "fixed") {
    discount = Number(template.discount_cents || 0);
  } else if (type === "percent") {
    const percent = Number(template.percent_off || 0);
    discount = Math.floor((subtotal * percent) / 100);
    const maxDiscount = Number(template.max_discount_cents || 0);
    if (maxDiscount > 0) discount = Math.min(discount, maxDiscount);
  } else {
    return { usable: false, discountCents: 0, payableCents: subtotal };
  }

  if (subtotal <= 0) {
    return { usable: false, discountCents: 0, payableCents: 0 };
  }

  // 抵扣后至少留 1 分
  discount = Math.min(discount, Math.max(0, subtotal - 1));
  discount = Math.max(0, Math.floor(discount));
  const payableCents = Math.max(1, subtotal - discount);
  return { usable: true, discountCents: discount, payableCents };
}

function runTx(db, fn) {
  // node:sqlite DatabaseSync 无 better-sqlite3 的 db.transaction()
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (e) {
    try {
      db.exec("ROLLBACK");
    } catch (_) {
      /* ignore */
    }
    throw e;
  }
}

function createCoupons(db, catalog) {
  void catalog;

  function getTemplate(templateId) {
    return db.prepare(`SELECT * FROM svc_coupon_templates WHERE id=?`).get(+templateId);
  }

  function getCoupon(couponId) {
    return db.prepare(`SELECT * FROM svc_coupons WHERE id=?`).get(+couponId);
  }

  function userClaimCount(personId, templateId) {
    const row = db
      .prepare(
        `SELECT COUNT(*) AS c FROM svc_coupons WHERE person_id=? AND template_id=?`
      )
      .get(+personId, +templateId);
    return Number(row && row.c) || 0;
  }

  function canStillClaim(template, personId, now) {
    if (!template || template.status !== "active") return false;
    if (!inWindow(template, now)) return false;
    const quota = Number(template.total_quota || 0);
    const claimed = Number(template.claimed_count || 0);
    if (quota > 0 && claimed >= quota) return false;
    const limit = Number(template.per_user_limit || 1);
    if (userClaimCount(personId, template.id) >= limit) return false;
    return true;
  }

  function listClaimableTemplates(personId, doctorId) {
    const now = nowIso();
    const rows = db
      .prepare(
        `SELECT * FROM svc_coupon_templates
         WHERE doctor_id=? AND status='active'
         ORDER BY id DESC`
      )
      .all(+doctorId);
    return rows.filter((t) => canStillClaim(t, personId, now)).map(mapTemplate);
  }

  function claim(personId, templateId) {
    const pid = +personId;
    const tid = +templateId;
    const now = nowIso();

    const coupon = runTx(db, () => claimInTx(pid, tid, now));

    return mapCoupon(coupon, mapTemplate(getTemplate(coupon.template_id)));
  }

  function claimInTx(pid, tid, now) {
    const template = getTemplate(tid);
    if (!template) fail("not_found", "优惠券模板不存在");
    if (template.status !== "active") fail("coupon_inactive", "优惠券未上架");
    if (!inWindow(template, now)) fail("coupon_out_of_window", "优惠券不在领取有效期内");

    const quota = Number(template.total_quota || 0);
    const claimed = Number(template.claimed_count || 0);
    if (quota > 0 && claimed >= quota) fail("coupon_quota_exhausted", "优惠券已领完");

    const limit = Number(template.per_user_limit || 1);
    if (userClaimCount(pid, tid) >= limit) {
      fail("coupon_per_user_limit", "已达到个人领取上限");
    }

    const expiresAt = template.ends_at || null;
    const info = db
      .prepare(
        `INSERT INTO svc_coupons(
          template_id, person_id, doctor_id, status,
          claimed_at, expires_at, created_at, updated_at
        ) VALUES (?,?,?,'available',?,?,?,?)`
      )
      .run(tid, pid, template.doctor_id, now, expiresAt, now, now);

    db.prepare(
      `UPDATE svc_coupon_templates SET claimed_count=claimed_count+1, updated_at=? WHERE id=?`
    ).run(now, tid);

    return getCoupon(Number(info.lastInsertRowid));
  }

  function normalizeRedeemCode(raw) {
    return String(raw || "")
      .trim()
      .toUpperCase()
      .replace(/\s+/g, "")
      .replace(/[^A-Z0-9\-]/g, "");
  }

  function redeemByCode(personId, rawCode) {
    const pid = +personId;
    const code = normalizeRedeemCode(rawCode);
    if (!code) fail("validation", "请输入兑换码");
    const now = nowIso();

    const coupon = runTx(db, () => {
      const row = db
        .prepare(`SELECT * FROM svc_coupon_redemption_codes WHERE code=?`)
        .get(code);
      if (!row) fail("not_found", "兑换码无效");
      if (row.status !== "active") fail("code_disabled", "兑换码已停用");
      if (row.expires_at && String(row.expires_at) < now) {
        fail("code_expired", "兑换码已过期");
      }

      const prior = db
        .prepare(
          `SELECT 1 AS ok FROM svc_coupon_redemption_logs WHERE code_id=? AND person_id=?`
        )
        .get(row.id, pid);
      if (prior) fail("code_already_used", "您已兑换过该码");

      const maxUses = Number(row.max_uses || 0);
      const used = Number(row.used_count || 0);
      if (maxUses > 0 && used >= maxUses) fail("code_exhausted", "兑换码已兑完");

      const created = claimInTx(pid, +row.template_id, now);

      db.prepare(
        `UPDATE svc_coupon_redemption_codes
         SET used_count=used_count+1, updated_at=?
         WHERE id=?`
      ).run(now, row.id);

      db.prepare(
        `INSERT INTO svc_coupon_redemption_logs(code_id, person_id, coupon_id, redeemed_at)
         VALUES (?,?,?,?)`
      ).run(row.id, pid, created.id, now);

      return created;
    });

    return mapCoupon(coupon, mapTemplate(getTemplate(coupon.template_id)));
  }

  function listMine(personId, { status } = {}) {
    let sql = `SELECT * FROM svc_coupons WHERE person_id=?`;
    const args = [+personId];
    if (status) {
      sql += ` AND status=?`;
      args.push(String(status));
    }
    sql += ` ORDER BY id DESC`;
    const rows = db.prepare(sql).all(...args);
    return rows.map((row) => mapCoupon(row, mapTemplate(getTemplate(row.template_id))));
  }

  function quote({ personId, doctorId, subtotalCents, couponId }) {
    const subtotal = Math.max(0, Math.floor(Number(subtotalCents) || 0));
    if (couponId == null || couponId === "") {
      return { discountCents: 0, payableCents: subtotal, coupon: null, usable: true };
    }

    const coupon = getCoupon(+couponId);
    if (!coupon || +coupon.person_id !== +personId) {
      fail("not_found", "优惠券不存在");
    }
    const template = getTemplate(coupon.template_id);
    if (!template) fail("not_found", "优惠券模板不存在");

    const mapped = mapCoupon(coupon, mapTemplate(template));
    if (coupon.status !== "available") {
      return { discountCents: 0, payableCents: subtotal, coupon: mapped, usable: false };
    }
    if (+coupon.doctor_id !== +doctorId) {
      return { discountCents: 0, payableCents: subtotal, coupon: mapped, usable: false };
    }
    const now = nowIso();
    if (coupon.expires_at && String(coupon.expires_at) < now) {
      return { discountCents: 0, payableCents: subtotal, coupon: mapped, usable: false };
    }

    const calc = computeDiscount(template, subtotal);
    return {
      discountCents: calc.discountCents,
      payableCents: calc.payableCents,
      coupon: mapped,
      usable: calc.usable,
    };
  }

  function assertUsable(personId, couponId, doctorId, subtotalCents) {
    if (couponId == null || couponId === "") {
      fail("validation", "未指定优惠券");
    }
    const coupon = getCoupon(+couponId);
    if (!coupon || +coupon.person_id !== +personId) {
      fail("not_found", "优惠券不存在");
    }
    if (coupon.status !== "available") {
      fail("coupon_unavailable", "优惠券不可用");
    }
    if (+coupon.doctor_id !== +doctorId) {
      fail("coupon_doctor_mismatch", "优惠券不适用该医生");
    }
    const now = nowIso();
    if (coupon.expires_at && String(coupon.expires_at) < now) {
      fail("coupon_expired", "优惠券已过期");
    }
    const template = getTemplate(coupon.template_id);
    if (!template) fail("not_found", "优惠券模板不存在");

    const calc = computeDiscount(template, subtotalCents);
    if (!calc.usable) {
      fail("coupon_not_applicable", "未满足优惠券使用条件");
    }
    return {
      discountCents: calc.discountCents,
      payableCents: calc.payableCents,
      coupon: mapCoupon(coupon, mapTemplate(template)),
      usable: true,
    };
  }

  function lockForOrder(personId, couponId, orderId, discountCents) {
    const now = nowIso();
    return runTx(db, () => {
      const coupon = getCoupon(+couponId);
      if (!coupon || +coupon.person_id !== +personId) {
        fail("not_found", "优惠券不存在");
      }
      if (coupon.status !== "available") {
        fail("coupon_unavailable", "优惠券不可锁定");
      }
      db.prepare(
        `UPDATE svc_coupons
         SET status='locked', order_id=?, discount_snapshot_cents=?, locked_at=?, updated_at=?
         WHERE id=? AND status='available'`
      ).run(+orderId, Math.floor(Number(discountCents) || 0), now, now, +couponId);
      const after = getCoupon(+couponId);
      if (!after || after.status !== "locked") {
        fail("coupon_unavailable", "优惠券锁定失败");
      }
      return mapCoupon(after, mapTemplate(getTemplate(after.template_id)));
    });
  }

  function unlockByOrder(orderId) {
    const now = nowIso();
    const info = db
      .prepare(
        `UPDATE svc_coupons
         SET status='available', order_id=NULL, discount_snapshot_cents=NULL,
             locked_at=NULL, updated_at=?
         WHERE order_id=? AND status='locked'`
      )
      .run(now, +orderId);
    return { changes: info.changes };
  }

  function redeemByOrder(orderId) {
    const now = nowIso();
    const info = db
      .prepare(
        `UPDATE svc_coupons
         SET status='used', used_at=?, updated_at=?
         WHERE order_id=? AND status='locked'`
      )
      .run(now, now, +orderId);
    return { changes: info.changes };
  }

  function voidByOrder(orderId) {
    const now = nowIso();
    const info = db
      .prepare(
        `UPDATE svc_coupons
         SET status='void', updated_at=?
         WHERE order_id=? AND status IN ('locked','used')`
      )
      .run(now, +orderId);
    return { changes: info.changes };
  }

  return {
    listClaimableTemplates,
    claim,
    redeemByCode,
    listMine,
    quote,
    assertUsable,
    lockForOrder,
    unlockByOrder,
    redeemByOrder,
    voidByOrder,
    normalizeRedeemCode,
  };
}

module.exports = { createCoupons };
