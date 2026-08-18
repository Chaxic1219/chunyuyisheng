"use strict";

const crypto = require("crypto");
const { nowIso } = require("./schema.js");
const { parseJson } = require("./catalog.js");

const ORDER_TIMEOUT_MS = Number(process.env.SERVICE_ORDER_TIMEOUT_MS || 30 * 60 * 1000);

function genOrderNo() {
  const t = new Date();
  const pad = (n, w = 2) => String(n).padStart(w, "0");
  const stamp =
    `${t.getFullYear()}${pad(t.getMonth() + 1)}${pad(t.getDate())}` +
    `${pad(t.getHours())}${pad(t.getMinutes())}${pad(t.getSeconds())}`;
  return `SP${stamp}${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
}

function clampQty(qty) {
  const n = Math.floor(Number(qty));
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(5, n);
}

function normalizeItems(body) {
  if (Array.isArray(body.items) && body.items.length) return body.items;
  const versionKey = body.versionId || body.productId || body.productKey;
  if (versionKey) return [{ versionId: versionKey, qty: 1 }];
  return [];
}

function fail(code, message) {
  const err = new Error(message);
  err.code = code;
  throw err;
}

function runTx(db, fn) {
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

function productSnapshot(product, raw) {
  return {
    title: product.title,
    subtitle: product.subtitle,
    cover: product.cover || "",
    serviceDays: product.serviceDays,
    eligible: product.eligible,
    ineligible: product.ineligible,
    contentItems: product.contentItems,
    assessmentItems: product.assessmentItems,
    goodsItems: product.goodsItems,
    benefitItems: Array.isArray(product.benefitItems) ? product.benefitItems : [],
    consultation: product.consultation,
    refundPolicy: product.refundPolicy,
    agreementVersion: product.agreementVersion,
    privacyConsentVersion: product.privacyConsentVersion,
    refundPolicyVersion: product.refundPolicyVersion,
    doctorName: product.doctorName,
    doctorHospital: product.doctorHospital,
    amounts: {
      serviceAmountCents: raw.service_amount_cents,
      goodsAmountCents: raw.goods_amount_cents,
      shippingAmountCents: raw.shipping_amount_cents,
      totalAmountCents: raw.total_amount_cents,
    },
  };
}

function createOrders(db, catalog, couponsApi) {
  const coupons =
    couponsApi ||
    (() => {
      try {
        return require("./coupons.js").createCoupons(db, catalog);
      } catch (_) {
        return null;
      }
    })();

  function mapLine(row) {
    return {
      id: row.id,
      orderId: row.order_id,
      productId: row.product_id,
      versionId: row.version_id,
      spuId: row.mall_spu_id != null ? row.mall_spu_id : null,
      skuId: row.mall_sku_id != null ? row.mall_sku_id : null,
      qty: row.qty,
      title: row.title,
      snapshot: parseJson(row.snapshot_json, {}),
      componentSnapshot: parseJson(row.component_snapshot_json, []),
      costSnapshot: parseJson(row.cost_snapshot_json, {}),
      serviceAmountCents: row.service_amount_cents,
      goodsAmountCents: row.goods_amount_cents,
      shippingAmountCents: row.shipping_amount_cents,
      totalAmountCents: row.total_amount_cents,
      instanceId: row.instance_id != null ? row.instance_id : null,
      createdAt: row.created_at,
    };
  }

  function loadLines(orderId, row, snapshot) {
    const lines = db
      .prepare(`SELECT * FROM svc_order_lines WHERE order_id=? ORDER BY id ASC`)
      .all(+orderId);
    if (lines.length) return lines.map(mapLine);
    // 旧单无行：从头表合成一行
    return [
      {
        id: null,
        orderId: +orderId,
        productId: row.product_id,
        versionId: row.version_id,
        qty: 1,
        title: (snapshot && snapshot.title) || "",
        snapshot: snapshot || {},
        serviceAmountCents: row.service_amount_cents,
        goodsAmountCents: row.goods_amount_cents,
        shippingAmountCents: row.shipping_amount_cents,
        totalAmountCents: row.total_amount_cents,
        instanceId: row.instance_id != null ? row.instance_id : null,
        createdAt: row.created_at,
      },
    ];
  }

  function mapOrder(row) {
    if (!row) return null;
    const snapshot = parseJson(row.snapshot_json, {});
    return {
      id: row.id,
      orderNo: row.order_no,
      personId: row.person_id,
      doctorId: row.doctor_id,
      productId: row.product_id,
      versionId: row.version_id,
      spuId: row.mall_spu_id != null ? row.mall_spu_id : null,
      skuId: row.mall_sku_id != null ? row.mall_sku_id : null,
      status: row.status,
      serviceAmount: row.service_amount_cents / 100,
      goodsAmount: row.goods_amount_cents / 100,
      shippingAmount: row.shipping_amount_cents / 100,
      totalAmount: row.total_amount_cents / 100,
      serviceAmountCents: row.service_amount_cents,
      goodsAmountCents: row.goods_amount_cents,
      shippingAmountCents: row.shipping_amount_cents,
      totalAmountCents: row.total_amount_cents,
      couponId: row.coupon_id != null ? Number(row.coupon_id) : null,
      discountAmountCents: Number(row.discount_amount_cents || 0),
      payableAmountCents:
        row.payable_amount_cents != null
          ? Number(row.payable_amount_cents)
          : Number(row.total_amount_cents),
      snapshot,
      costSnapshot: parseJson(row.cost_snapshot_json, {}),
      lines: loadLines(row.id, row, snapshot),
      serviceFor: row.service_for,
      contactPhone: row.contact_phone,
      receiverName: row.receiver_name,
      receiverPhone: row.receiver_phone,
      receiverAddress: row.receiver_address,
      sourceDoctorId: row.source_doctor_id,
      sourceGroupId: row.source_group_id,
      sourceChannel: row.source_channel,
      paidAt: row.paid_at,
      profileSubmittedAt: row.profile_submitted_at,
      reviewedAt: row.reviewed_at,
      reviewNote: row.review_note,
      serviceStartDate: row.service_start_date,
      instanceId: row.instance_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  function getRaw(orderId) {
    return db.prepare(`SELECT * FROM svc_orders WHERE id=?`).get(+orderId) || null;
  }

  function getByIdForPerson(orderId, personId) {
    const row = db
      .prepare(`SELECT * FROM svc_orders WHERE id=? AND person_id=?`)
      .get(+orderId, +personId);
    return mapOrder(row);
  }

  function getById(orderId) {
    return mapOrder(getRaw(orderId));
  }

  function releaseMallReservations(orderId, reason) {
    const lines = db
      .prepare("SELECT id,mall_sku_id,component_snapshot_json FROM svc_order_lines WHERE order_id=? AND mall_sku_id IS NOT NULL")
      .all(+orderId);
    const ts = nowIso();
    for (const line of lines) {
      const components = parseJson(line.component_snapshot_json, []);
      for (const component of components) {
        if (component.type !== "GOODS_SKU") continue;
        const quantity = Math.max(1, Number(component.quantity) || 1);
        const key = `release:${line.id}:${component.sourceId}`;
        if (
          db.prepare("SELECT 1 FROM mall_inventory_movements WHERE goods_sku_id=? AND idempotency_key=?").get(
            +component.sourceId,
            key
          )
        ) {
          continue;
        }
        const changed = db
          .prepare(
            "UPDATE mall_goods_inventory SET reserved=reserved-?,updated_at=? WHERE goods_sku_id=? AND reserved>=?"
          )
          .run(quantity, ts, +component.sourceId, quantity);
        if (!changed.changes) fail("inventory_release_failed", "库存预占释放失败");
        db.prepare(
          `INSERT INTO mall_inventory_movements(
            goods_sku_id,movement_type,quantity,reason,idempotency_key,reference_type,reference_id,created_at
          ) VALUES (?,'release',?,?,?,?,?,?)`
        ).run(+component.sourceId, -quantity, reason || "订单关闭", key, "order_line", line.id, ts);
      }
    }
  }

  function createMallOrder(personId, body) {
    const idem = String(body.idempotencyKey || body.idempotency_key || "").trim();
    if (idem) {
      const existed = db
        .prepare("SELECT * FROM svc_orders WHERE person_id=? AND idempotency_key=?")
        .get(+personId, idem);
      if (existed) return mapOrder(existed);
    }
    if (!body.agreementAccepted || !body.privacyAccepted) {
      fail("agreement_required", "请同意服务协议与敏感健康信息处理说明");
    }
    const rawItems = normalizeItems(body || {});
    if (!rawItems.length || rawItems.some((item) => item.skuId == null)) {
      fail("mixed_items_not_allowed", "新商城订单仅支持销售 SKU");
    }
    if (
      rawItems.some((item) =>
        Object.keys(item).some((key) => key !== "skuId" && key !== "qty" && /(price|amount)/i.test(key))
      )
    ) {
      fail("client_price_not_allowed", "client price is not allowed");
    }
    const quantities = new Map();
    for (const item of rawItems) {
      const key = Number(item.skuId);
      quantities.set(key, clampQty((quantities.get(key) || 0) + clampQty(item.qty)));
    }
    const resolved = [];
    let doctorId = null;
    let needsAddress = false;
    for (const [skuId, qty] of quantities.entries()) {
      const sku = catalog.getPublishedMallSku(skuId);
      if (!sku) fail("product_unavailable", "商品不存在或未上架");
      if (doctorId == null) doctorId = +sku.doctorId;
      else if (doctorId !== +sku.doctorId) fail("items_doctor_mismatch", "同一订单仅支持同一位医生的商品");
      needsAddress ||= sku.components.some((component) => component.type === "GOODS_SKU");
      resolved.push({ sku, qty, totalAmountCents: sku.salePriceCents * qty });
    }
    const receiverName = String(body.receiverName || "").trim();
    const receiverPhone = String(body.receiverPhone || body.contactPhone || "").trim();
    const receiverAddress = String(body.receiverAddress || "").trim();
    if (needsAddress && (!receiverName || !receiverPhone || !receiverAddress)) {
      fail("address_required", "该 SKU 含实物商品，请填写完整收货信息");
    }
    const subtotalCents = resolved.reduce((sum, item) => sum + item.totalAmountCents, 0);
    let couponId = null;
    let discountCents = 0;
    let payableCents = subtotalCents;
    if (body.couponId != null && body.couponId !== "") {
      if (!coupons || typeof coupons.assertUsable !== "function") fail("coupon_unavailable", "优惠券服务不可用");
      const quoted = coupons.assertUsable(+personId, +body.couponId, doctorId, subtotalCents);
      couponId = +body.couponId;
      discountCents = quoted.discountCents;
      payableCents = quoted.payableCents;
    }
    const first = resolved[0];
    const snapshot = {
      title: first.sku.spu.name,
      spuId: first.sku.spuId,
      skuId: first.sku.skuId,
      amounts: {
        serviceAmountCents: subtotalCents,
        goodsAmountCents: 0,
        shippingAmountCents: 0,
        totalAmountCents: subtotalCents,
        discountAmountCents: discountCents,
        payableAmountCents: payableCents,
      },
      lines: resolved.map(({ sku, qty, totalAmountCents }) => ({
        spuId: sku.spuId,
        skuId: sku.skuId,
        skuVersionNo: sku.versionNo,
        title: sku.spu.name,
        specName: sku.name,
        qty,
        totalAmountCents,
        components: sku.components,
        costSnapshot: sku.costSnapshot,
      })),
    };
    const ts = nowIso();
    const orderNo = genOrderNo();
    const orderId = runTx(db, () => {
      const info = db.prepare(
        `INSERT INTO svc_orders(
          order_no,person_id,doctor_id,product_id,version_id,mall_spu_id,mall_sku_id,status,
          service_amount_cents,goods_amount_cents,shipping_amount_cents,total_amount_cents,
          coupon_id,discount_amount_cents,payable_amount_cents,snapshot_json,cost_snapshot_json,
          service_for,contact_phone,receiver_name,receiver_phone,receiver_address,
          source_doctor_id,source_group_id,source_channel,idempotency_key,
          agreement_accepted_at,privacy_accepted_at,created_at,updated_at
        ) VALUES (?,?,?,?,?,?,?,'pending_payment',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      ).run(
        orderNo,
        +personId,
        doctorId,
        0,
        0,
        first.sku.spuId,
        first.sku.skuId,
        subtotalCents,
        0,
        0,
        subtotalCents,
        couponId,
        discountCents,
        payableCents,
        JSON.stringify(snapshot),
        JSON.stringify(first.sku.costSnapshot || {}),
        String(body.serviceFor || "self"),
        String(body.contactPhone || receiverPhone || ""),
        receiverName,
        receiverPhone,
        receiverAddress,
        body.sourceDoctorId != null ? String(body.sourceDoctorId) : null,
        body.sourceGroupId != null ? String(body.sourceGroupId) : null,
        body.sourceChannel != null ? String(body.sourceChannel) : null,
        idem || null,
        ts,
        ts,
        ts,
        ts
      );
      const newOrderId = Number(info.lastInsertRowid);
      const insertLine = db.prepare(
        `INSERT INTO svc_order_lines(
          order_id,product_id,version_id,mall_spu_id,mall_sku_id,qty,title,snapshot_json,
          component_snapshot_json,cost_snapshot_json,service_amount_cents,goods_amount_cents,
          shipping_amount_cents,total_amount_cents,created_at
        ) VALUES (?,0,0,?,?,?,?,?,?,?,?,0,0,?,?)`
      );
      for (const item of resolved) {
        const lineSnapshot = {
          spu: item.sku.spu,
          sku: {
            id: item.sku.skuId,
            code: item.sku.code,
            name: item.sku.name,
            cycleDays: item.sku.cycleDays,
            versionNo: item.sku.versionNo,
            salePriceCents: item.sku.salePriceCents,
          },
        };
        const lineInfo = insertLine.run(
          newOrderId,
          item.sku.spuId,
          item.sku.skuId,
          item.qty,
          `${item.sku.spu.name} · ${item.sku.name}`,
          JSON.stringify(lineSnapshot),
          JSON.stringify(item.sku.components),
          JSON.stringify(item.sku.costSnapshot || {}),
          item.totalAmountCents,
          item.totalAmountCents,
          ts
        );
        const lineId = Number(lineInfo.lastInsertRowid);
        // PRD §10.1：订单行完整组成/价格/成本快照，历史订单始终引用购买时版本
        try {
          db.prepare(
            `INSERT INTO mall_order_line_snapshots(
              order_id,order_line_id,spu_id,sku_id,spu_code,spu_name,sku_code,sku_name,cycle_days,
              component_snapshot_json,price_snapshot_json,cost_snapshot_json,agreement_snapshot_json,
              created_at,updated_at
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
          ).run(
            newOrderId,
            lineId,
            item.sku.spuId,
            item.sku.skuId,
            String(item.sku.spu.code || ""),
            String(item.sku.spu.name || ""),
            String(item.sku.code || ""),
            String(item.sku.name || ""),
            Number(item.sku.cycleDays) || 0,
            JSON.stringify(item.sku.components || []),
            JSON.stringify({
              salePriceCents: item.sku.salePriceCents,
              listPriceCents: item.sku.listPriceCents,
              minimumPriceCents: item.sku.minimumPriceCents || 0,
              totalAmountCents: item.totalAmountCents,
              discountAmountCents: 0,
              payableAmountCents: item.totalAmountCents,
            }),
            JSON.stringify(item.sku.costSnapshot || {}),
            JSON.stringify({
              agreementAccepted: !!body.agreementAccepted,
              privacyAccepted: !!body.privacyAccepted,
            }),
            ts,
            ts
          );
        } catch (e) {
          // 快照写入失败不阻断下单主流程；由 outbox/审计兜底
          console.warn("[order-line-snapshot] 写入失败", e && e.message);
        }
        for (const component of item.sku.components) {
          if (component.type !== "GOODS_SKU") continue;
          const required = component.quantity * item.qty;
          const updated = db.prepare(
            `UPDATE mall_goods_inventory SET reserved=reserved+?,updated_at=?
             WHERE goods_sku_id=? AND on_hand-reserved-sold>=?`
          ).run(required, ts, +component.sourceId, required);
          if (!updated.changes) fail("goods_out_of_stock", `${component.name}库存不足`);
          db.prepare(
            `INSERT INTO mall_inventory_movements(
              goods_sku_id,movement_type,quantity,reason,idempotency_key,reference_type,reference_id,created_at
            ) VALUES (?,'reserve',?,'订单预占',?,'order_line',?,?)`
          ).run(+component.sourceId, required, `reserve:${lineId}:${component.sourceId}`, lineId, ts);
        }
      }
      return newOrderId;
    });
    if (couponId) {
      try {
        coupons.lockForOrder(+personId, couponId, orderId, discountCents);
      } catch (error) {
        runTx(db, () => {
          releaseMallReservations(orderId, "优惠券锁定失败");
          db.prepare("DELETE FROM svc_order_lines WHERE order_id=?").run(orderId);
          db.prepare("DELETE FROM svc_orders WHERE id=?").run(orderId);
        });
        throw error;
      }
    }
    return mapOrder(getRaw(orderId));
  }

  function closeExpiredPending(personId) {
    const cutoff = new Date(Date.now() - ORDER_TIMEOUT_MS).toISOString();
    const ts = nowIso();
    const expiredIds = personId
      ? db
          .prepare(
            `SELECT id FROM svc_orders
             WHERE person_id=? AND status='pending_payment' AND created_at < ?`
          )
          .all(+personId, cutoff)
          .map((row) => row.id)
      : db
          .prepare("SELECT id FROM svc_orders WHERE status='pending_payment' AND created_at < ?")
          .all(cutoff)
          .map((row) => row.id);
    if (!expiredIds.length) return;
    runTx(db, () => {
      const close = db.prepare(
        `UPDATE svc_orders SET status='closed_timeout',closed_at=?,updated_at=?
         WHERE id=? AND status='pending_payment'`
      );
      for (const orderId of expiredIds) {
        releaseMallReservations(orderId, "订单超时");
        close.run(ts, ts, orderId);
      }
    });
    if (coupons && typeof coupons.unlockByOrder === "function") {
      for (const id of expiredIds) {
        coupons.unlockByOrder(id);
      }
    }
  }

  function createOrder(personId, body) {
    closeExpiredPending(personId);

    if (normalizeItems(body || {}).some((item) => item && item.skuId != null)) {
      return createMallOrder(personId, body || {});
    }

    const idem = String(body.idempotencyKey || body.idempotency_key || "").trim();
    if (idem) {
      const existed = db
        .prepare(`SELECT * FROM svc_orders WHERE person_id=? AND idempotency_key=?`)
        .get(+personId, idem);
      if (existed) return mapOrder(existed);
    }

    if (!body.agreementAccepted || !body.privacyAccepted) {
      fail("agreement_required", "请同意服务协议与敏感健康信息处理说明");
    }

    const receiverName = String(body.receiverName || "").trim();
    const receiverPhone = String(body.receiverPhone || body.contactPhone || "").trim();
    const receiverAddress = String(body.receiverAddress || "").trim();
    const contactPhone = String(body.contactPhone || receiverPhone || "").trim();
    if (!receiverName || !receiverPhone || !receiverAddress) {
      fail("address_required", "请填写完整收货信息");
    }

    const rawItems = normalizeItems(body || {});
    if (!rawItems.length) {
      fail("items_required", "请选择商品");
    }

    // 合并同 versionId，qty clamp 1..5
    const qtyByKey = new Map();
    const keyOrder = [];
    for (const it of rawItems) {
      const versionKey = it.versionId || it.productId || it.productKey;
      if (versionKey == null || versionKey === "") continue;
      const mapKey = String(versionKey);
      const add = clampQty(it.qty != null ? it.qty : 1);
      if (qtyByKey.has(mapKey)) {
        qtyByKey.set(mapKey, clampQty(qtyByKey.get(mapKey) + add));
      } else {
        qtyByKey.set(mapKey, add);
        keyOrder.push(mapKey);
      }
    }
    if (!keyOrder.length) {
      fail("items_required", "请选择商品");
    }

    const resolved = [];
    let doctorId = null;
    for (const versionKey of keyOrder) {
      const product = catalog.getCurrentPublished(versionKey);
      if (!product) {
        fail("product_unavailable", "商品不存在或未上架");
      }
      if (doctorId == null) doctorId = +product.doctorId;
      else if (+product.doctorId !== doctorId) {
        fail("items_doctor_mismatch", "同一订单仅支持同一位医生的商品");
      }
      const qty = qtyByKey.get(versionKey);
      const raw = catalog.getVersionRaw(product.versionId);
      if (!raw) {
        fail("product_unavailable", "商品不存在或未上架");
      }
      const snap = productSnapshot(product, raw);
      resolved.push({
        product,
        raw,
        qty,
        snap,
        serviceAmountCents: raw.service_amount_cents * qty,
        goodsAmountCents: raw.goods_amount_cents * qty,
        shippingAmountCents: raw.shipping_amount_cents * qty,
        totalAmountCents: raw.total_amount_cents * qty,
      });
    }

    const first = resolved[0];
    const sumService = resolved.reduce((s, l) => s + l.serviceAmountCents, 0);
    const sumGoods = resolved.reduce((s, l) => s + l.goodsAmountCents, 0);
    const sumShipping = resolved.reduce((s, l) => s + l.shippingAmountCents, 0);
    const sumTotal = resolved.reduce((s, l) => s + l.totalAmountCents, 0);
    const subtotalCents = sumTotal;

    let couponId = null;
    let discountCents = 0;
    let payableCents = sumTotal;
    const bodyCouponId = body.couponId != null && body.couponId !== "" ? +body.couponId : null;
    if (bodyCouponId) {
      if (!coupons || typeof coupons.assertUsable !== "function") {
        fail("coupon_unavailable", "优惠券服务不可用");
      }
      const quoted = coupons.assertUsable(+personId, bodyCouponId, doctorId, subtotalCents);
      couponId = bodyCouponId;
      discountCents = quoted.discountCents;
      payableCents = quoted.payableCents;
    }

    const snapshot = {
      ...first.snap,
      amounts: {
        serviceAmountCents: sumService,
        goodsAmountCents: sumGoods,
        shippingAmountCents: sumShipping,
        totalAmountCents: sumTotal,
        discountAmountCents: discountCents,
        payableAmountCents: payableCents,
      },
      lines: resolved.map((l) => ({
        productId: l.product.productId,
        versionId: l.product.versionId,
        qty: l.qty,
        title: l.product.title,
        serviceAmountCents: l.serviceAmountCents,
        goodsAmountCents: l.goodsAmountCents,
        shippingAmountCents: l.shippingAmountCents,
        totalAmountCents: l.totalAmountCents,
      })),
    };

    const ts = nowIso();
    const orderNo = genOrderNo();

    const orderId = runTx(db, () => {
      const info = db
        .prepare(
          `INSERT INTO svc_orders(
            order_no, person_id, doctor_id, product_id, version_id, status,
            service_amount_cents, goods_amount_cents, shipping_amount_cents, total_amount_cents,
            coupon_id, discount_amount_cents, payable_amount_cents,
            snapshot_json, service_for, contact_phone, receiver_name, receiver_phone, receiver_address,
            source_doctor_id, source_group_id, source_channel, idempotency_key,
            agreement_accepted_at, privacy_accepted_at, created_at, updated_at
          ) VALUES (?,?,?,?,?,'pending_payment',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
        )
        .run(
          orderNo,
          +personId,
          doctorId,
          +first.product.productId,
          +first.product.versionId,
          sumService,
          sumGoods,
          sumShipping,
          sumTotal,
          couponId,
          discountCents,
          payableCents,
          JSON.stringify(snapshot),
          String(body.serviceFor || "self"),
          contactPhone,
          receiverName,
          receiverPhone,
          receiverAddress,
          body.sourceDoctorId != null ? String(body.sourceDoctorId) : null,
          body.sourceGroupId != null ? String(body.sourceGroupId) : null,
          body.sourceChannel != null ? String(body.sourceChannel) : null,
          idem || null,
          ts,
          ts,
          ts,
          ts
        );

      const newOrderId = Number(info.lastInsertRowid);
      const insertLine = db.prepare(
        `INSERT INTO svc_order_lines(
          order_id, product_id, version_id, qty, title, snapshot_json,
          service_amount_cents, goods_amount_cents, shipping_amount_cents, total_amount_cents,
          created_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?)`
      );
      for (const l of resolved) {
        insertLine.run(
          newOrderId,
          +l.product.productId,
          +l.product.versionId,
          l.qty,
          l.product.title,
          JSON.stringify(l.snap),
          l.serviceAmountCents,
          l.goodsAmountCents,
          l.shippingAmountCents,
          l.totalAmountCents,
          ts
        );
      }
      return newOrderId;
    });

    if (couponId) {
      try {
        coupons.lockForOrder(+personId, couponId, orderId, discountCents);
      } catch (e) {
        try {
          db.prepare(`DELETE FROM svc_order_lines WHERE order_id=?`).run(orderId);
          db.prepare(`DELETE FROM svc_orders WHERE id=?`).run(orderId);
        } catch (_) {
          /* ignore compensate errors */
        }
        throw e;
      }
    }

    return mapOrder(getRaw(orderId));
  }

  function listForPerson(personId, { status, limit = 50, offset = 0 } = {}) {
    closeExpiredPending(personId);
    const lim = Math.min(Math.max(+limit || 50, 1), 100);
    const off = Math.max(+offset || 0, 0);
    let sql = `SELECT * FROM svc_orders WHERE person_id=?`;
    const args = [+personId];
    if (status) {
      sql += ` AND status=?`;
      args.push(String(status));
    }
    sql += ` ORDER BY id DESC LIMIT ? OFFSET ?`;
    args.push(lim, off);
    return db.prepare(sql).all(...args).map(mapOrder);
  }

  function setStatus(orderId, status, extra = {}) {
    const ts = nowIso();
    const row = getRaw(orderId);
    if (!row) {
      const err = new Error("订单不存在");
      err.code = "not_found";
      throw err;
    }
    const sets = ["status=?", "updated_at=?"];
    const args = [status, ts];
    for (const [k, col] of [
      ["paidAt", "paid_at"],
      ["profileSubmittedAt", "profile_submitted_at"],
      ["reviewedAt", "reviewed_at"],
      ["reviewerAdminId", "reviewer_admin_id"],
      ["reviewNote", "review_note"],
      ["serviceStartDate", "service_start_date"],
      ["instanceId", "instance_id"],
      ["closedAt", "closed_at"],
    ]) {
      if (extra[k] !== undefined) {
        sets.push(`${col}=?`);
        args.push(extra[k]);
      }
    }
    args.push(+orderId);
    db.prepare(`UPDATE svc_orders SET ${sets.join(", ")} WHERE id=?`).run(...args);
    return mapOrder(getRaw(orderId));
  }

  function submitProfile(personId, orderId, body) {
    const row = getRaw(orderId);
    if (!row || +row.person_id !== +personId) {
      const err = new Error("订单不存在");
      err.code = "not_found";
      throw err;
    }
    if (row.status !== "paid_pending_profile" && row.status !== "pending_review") {
      const err = new Error("当前订单状态不可提交资料");
      err.code = "invalid_status";
      throw err;
    }
    const surgeryDate = String(body.surgeryDate || "").trim();
    const surgeryType = String(body.surgeryType || "").trim();
    const laterality = String(body.laterality || "").trim();
    const recoveryStage = String(body.recoveryStage || "").trim();
    if (!surgeryDate || !surgeryType || !laterality || !recoveryStage) {
      const err = new Error("请完整填写手术资料");
      err.code = "profile_incomplete";
      throw err;
    }
    const ts = nowIso();
    db.prepare(
      `INSERT INTO svc_order_profiles(
        order_id, surgery_date, surgery_type, laterality, recovery_stage,
        symptoms_json, voucher_urls_json, extra_json, submitted_at, updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(order_id) DO UPDATE SET
        surgery_date=excluded.surgery_date,
        surgery_type=excluded.surgery_type,
        laterality=excluded.laterality,
        recovery_stage=excluded.recovery_stage,
        symptoms_json=excluded.symptoms_json,
        voucher_urls_json=excluded.voucher_urls_json,
        extra_json=excluded.extra_json,
        submitted_at=excluded.submitted_at,
        updated_at=excluded.updated_at`
    ).run(
      +orderId,
      surgeryDate,
      surgeryType,
      laterality,
      recoveryStage,
      JSON.stringify(body.symptoms || []),
      JSON.stringify(body.voucherUrls || []),
      JSON.stringify(body.extra || {}),
      ts,
      ts
    );
    return setStatus(orderId, "pending_review", { profileSubmittedAt: ts });
  }

  function getProfile(orderId) {
    const row = db.prepare(`SELECT * FROM svc_order_profiles WHERE order_id=?`).get(+orderId);
    if (!row) return null;
    return {
      orderId: row.order_id,
      surgeryDate: row.surgery_date,
      surgeryType: row.surgery_type,
      laterality: row.laterality,
      recoveryStage: row.recovery_stage,
      symptoms: parseJson(row.symptoms_json, []),
      voucherUrls: parseJson(row.voucher_urls_json, []),
      extra: parseJson(row.extra_json, {}),
      submittedAt: row.submitted_at,
    };
  }

  function requestCancel(personId, orderId, reason) {
    const row = getRaw(orderId);
    if (!row || +row.person_id !== +personId) {
      const err = new Error("订单不存在");
      err.code = "not_found";
      throw err;
    }
    if (row.status === "pending_payment") {
      const closed = runTx(db, () => {
        releaseMallReservations(orderId, reason || "用户取消");
        return setStatus(orderId, "closed_timeout", {
          closedAt: nowIso(),
          reviewNote: reason || "用户取消",
        });
      });
      if (coupons && typeof coupons.unlockByOrder === "function") {
        coupons.unlockByOrder(orderId);
      }
      return closed;
    }
    if (row.status === "paid_pending_profile" || row.status === "pending_review") {
      return setStatus(orderId, "refunding", { reviewNote: reason || "用户申请取消" });
    }
    const err = new Error("当前状态不支持取消");
    err.code = "invalid_status";
    throw err;
  }

  return {
    mapOrder,
    getRaw,
    getById,
    getByIdForPerson,
    createOrder,
    listForPerson,
    setStatus,
    submitProfile,
    getProfile,
    requestCancel,
    closeExpiredPending,
    ORDER_TIMEOUT_MS,
    normalizeItems,
  };
}

module.exports = { createOrders, genOrderNo, normalizeItems };
