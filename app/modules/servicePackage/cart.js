"use strict";

const { nowIso } = require("./schema.js");

function fail(code, message) {
  const err = new Error(message);
  err.code = code;
  throw err;
}

function clampQty(qty) {
  const n = Math.floor(Number(qty));
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(5, n);
}

function createCart(db, catalog) {
  function list(personId, doctorId) {
    const did = +doctorId;
    const rows = db
      .prepare(
        `SELECT * FROM svc_cart_items WHERE person_id=? AND doctor_id=? ORDER BY id ASC`
      )
      .all(+personId, did);

    let totalAmountCents = 0;
    const items = rows.map((row) => {
      if (row.mall_sku_id != null) {
        const publishedSku = catalog.getPublishedMallSku(row.mall_sku_id);
        if (publishedSku) {
          const unitTotalCents = Number(publishedSku.salePriceCents || 0);
          const lineTotalCents = unitTotalCents * row.qty;
          totalAmountCents += lineTotalCents;
          return {
            id: row.id,
            skuId: publishedSku.skuId,
            spuId: publishedSku.spuId,
            title: publishedSku.spu.name,
            specName: publishedSku.name,
            cover: publishedSku.spu.cover || "",
            components: publishedSku.components,
            qty: row.qty,
            unitTotalCents,
            lineTotalCents,
            unavailable: false,
          };
        }
        const rawSku = db
          .prepare(
            `SELECT k.id,k.name,s.id AS spu_id,s.name AS spu_name,s.cover
             FROM mall_skus k JOIN mall_spus s ON s.id=k.spu_id WHERE k.id=?`
          )
          .get(row.mall_sku_id);
        return {
          id: row.id,
          skuId: row.mall_sku_id,
          spuId: rawSku ? rawSku.spu_id : null,
          title: rawSku ? rawSku.spu_name : "",
          specName: rawSku ? rawSku.name : "",
          cover: rawSku ? rawSku.cover || "" : "",
          qty: row.qty,
          unitTotalCents: 0,
          lineTotalCents: 0,
          unavailable: true,
        };
      }
      const published = catalog.getCurrentPublished(row.version_id);
      if (published) {
        const unitTotalCents = Number(published.totalAmountCents || 0);
        const lineTotalCents = unitTotalCents * row.qty;
        totalAmountCents += lineTotalCents;
        return {
          id: row.id,
          versionId: row.version_id,
          productId: published.productId,
          title: published.title,
          cover: published.cover || "",
          qty: row.qty,
          unitTotalCents,
          lineTotalCents,
          unavailable: false,
        };
      }
      const raw = catalog.getVersionRaw(row.version_id);
      const unitTotalCents = raw ? Number(raw.total_amount_cents || 0) : 0;
      return {
        id: row.id,
        versionId: row.version_id,
        productId: raw ? raw.product_id : null,
        title: raw ? raw.title : "",
        cover: raw ? raw.cover || "" : "",
        qty: row.qty,
        unitTotalCents,
        lineTotalCents: 0,
        unavailable: true,
      };
    });

    return { doctorId: did, items, totalAmountCents };
  }

  function addItem(personId, body) {
    const skuId = body && (body.skuId || body.mall_sku_id);
    if (skuId != null && skuId !== "") {
      const sku = catalog.getPublishedMallSku(skuId);
      if (!sku) fail("product_unavailable", "商品不存在或未上架");
      const bodyDoctorId = body.doctorId != null ? +body.doctorId : null;
      if (bodyDoctorId != null && bodyDoctorId !== +sku.doctorId) {
        fail("cart_doctor_mismatch", "购物车仅支持同一位医生的商品");
      }
      const existingAny = db
        .prepare("SELECT doctor_id FROM svc_cart_items WHERE person_id=? LIMIT 1")
        .get(+personId);
      if (existingAny && +existingAny.doctor_id !== +sku.doctorId) {
        fail("cart_doctor_mismatch", "购物车仅支持同一位医生的商品，请先清空后再加购");
      }
      const addQty = clampQty(body.qty != null ? body.qty : 1);
      const ts = nowIso();
      const existed = db
        .prepare("SELECT * FROM svc_cart_items WHERE person_id=? AND mall_sku_id=?")
        .get(+personId, +sku.skuId);
      if (existed) {
        db.prepare("UPDATE svc_cart_items SET qty=?,updated_at=? WHERE id=?").run(
          clampQty(existed.qty + addQty),
          ts,
          existed.id
        );
      } else {
        db.prepare(
          `INSERT INTO svc_cart_items(person_id,doctor_id,version_id,mall_sku_id,qty,created_at,updated_at)
           VALUES (?,?,NULL,?,?,?,?)`
        ).run(+personId, +sku.doctorId, +sku.skuId, addQty, ts, ts);
      }
      return list(+personId, +sku.doctorId);
    }
    const versionId = body && (body.versionId || body.version_id);
    const product = catalog.getCurrentPublished(versionId);
    if (!product) {
      fail("product_unavailable", "商品不存在或未上架");
    }

    const bodyDoctorId = body && body.doctorId != null ? +body.doctorId : null;
    if (bodyDoctorId != null && bodyDoctorId !== +product.doctorId) {
      fail("cart_doctor_mismatch", "购物车仅支持同一位医生的商品");
    }

    const existingAny = db
      .prepare(`SELECT doctor_id FROM svc_cart_items WHERE person_id=? LIMIT 1`)
      .get(+personId);
    if (existingAny && +existingAny.doctor_id !== +product.doctorId) {
      fail("cart_doctor_mismatch", "购物车仅支持同一位医生的商品，请先清空后再加购");
    }

    const addQty = clampQty(body && body.qty != null ? body.qty : 1);
    const ts = nowIso();
    const existed = db
      .prepare(`SELECT * FROM svc_cart_items WHERE person_id=? AND version_id=?`)
      .get(+personId, +product.versionId);

    if (existed) {
      const qty = clampQty(existed.qty + addQty);
      db.prepare(`UPDATE svc_cart_items SET qty=?, updated_at=? WHERE id=?`).run(qty, ts, existed.id);
      return list(+personId, +product.doctorId);
    }

    db.prepare(
      `INSERT INTO svc_cart_items(person_id, doctor_id, version_id, qty, created_at, updated_at)
       VALUES (?,?,?,?,?,?)`
    ).run(+personId, +product.doctorId, +product.versionId, addQty, ts, ts);

    return list(+personId, +product.doctorId);
  }

  function updateQty(personId, itemId, qty) {
    const row = db
      .prepare(`SELECT * FROM svc_cart_items WHERE id=? AND person_id=?`)
      .get(+itemId, +personId);
    if (!row) fail("not_found", "购物车商品不存在");

    const n = Math.floor(Number(qty));
    if (!Number.isFinite(n) || n <= 0) {
      db.prepare(`DELETE FROM svc_cart_items WHERE id=? AND person_id=?`).run(+itemId, +personId);
      return list(+personId, row.doctor_id);
    }

    const next = clampQty(n);
    db.prepare(`UPDATE svc_cart_items SET qty=?, updated_at=? WHERE id=?`).run(next, nowIso(), row.id);
    return list(+personId, row.doctor_id);
  }

  function removeItem(personId, itemId) {
    const row = db
      .prepare(`SELECT * FROM svc_cart_items WHERE id=? AND person_id=?`)
      .get(+itemId, +personId);
    if (!row) fail("not_found", "购物车商品不存在");
    db.prepare(`DELETE FROM svc_cart_items WHERE id=? AND person_id=?`).run(+itemId, +personId);
    return list(+personId, row.doctor_id);
  }

  function clear(personId, doctorId) {
    db.prepare(`DELETE FROM svc_cart_items WHERE person_id=? AND doctor_id=?`).run(
      +personId,
      +doctorId
    );
    return list(+personId, +doctorId);
  }

  return { list, addItem, updateQty, removeItem, clear };
}

module.exports = { createCart };
