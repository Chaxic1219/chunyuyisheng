"use strict";

const crypto = require("crypto");
const { nowIso } = require("./schema.js");
const { getPaymentProvider } = require("./providers/index.js");

function genOutTradeNo() {
  return `P${Date.now()}${crypto.randomBytes(4).toString("hex")}`;
}

function genOutRefundNo() {
  return `R${Date.now()}${crypto.randomBytes(4).toString("hex")}`;
}

function createPayments(db, ordersApi, couponsApi, fulfillmentApi) {
  function resolveMpOpenid(personId) {
    const p = db.prepare(`SELECT mp_openid FROM persons WHERE id=?`).get(+personId);
    if (p && p.mp_openid) return String(p.mp_openid);
    const s = db
      .prepare(
        `SELECT openid FROM mp_sessions WHERE person_id=? ORDER BY rowid DESC LIMIT 1`
      )
      .get(+personId);
    return s && s.openid ? String(s.openid) : null;
  }

  function mapPayment(row) {
    if (!row) return null;
    let prepay = null;
    try {
      prepay = row.prepay_json ? JSON.parse(row.prepay_json) : null;
    } catch (e) {
      prepay = null;
    }
    return {
      id: row.id,
      orderId: row.order_id,
      provider: row.provider,
      outTradeNo: row.out_trade_no,
      providerTradeNo: row.provider_trade_no,
      amountCents: row.amount_cents,
      amount: row.amount_cents / 100,
      status: row.status,
      prepay,
      paidAt: row.paid_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  function payableCents(order) {
    return order.payableAmountCents != null ? order.payableAmountCents : order.totalAmountCents;
  }

  function latestForOrder(orderId) {
    return mapPayment(
      db.prepare(`SELECT * FROM svc_payments WHERE order_id=? ORDER BY id DESC LIMIT 1`).get(+orderId)
    );
  }

  function markPaid(paymentId, orderId, providerTradeNo) {
    const ts = nowIso();
    db.prepare(
      `UPDATE svc_payments SET status='paid', provider_trade_no=?, paid_at=?, updated_at=? WHERE id=?`
    ).run(providerTradeNo || `mock_${paymentId}`, ts, ts, +paymentId);
    ordersApi.setStatus(orderId, "paid_pending_profile", { paidAt: ts });
    if (couponsApi && typeof couponsApi.redeemByOrder === "function") {
      couponsApi.redeemByOrder(orderId);
    }
    if (fulfillmentApi && typeof fulfillmentApi.processOrder === "function") {
      fulfillmentApi.processOrder(orderId);
    }
    const order = ordersApi.getById(orderId);
    if (order) {
      void require("../../mp_subscribe.js")
        .sendOrderPaidNotice(db, order)
        .catch((e) => {
          console.warn("[mp_subscribe] order paid notice failed:", e.message || e);
        });
    }
    return latestForOrder(orderId);
  }

  async function createPayment(personId, orderId) {
    const order = ordersApi.getByIdForPerson(orderId, personId);
    if (!order) {
      const err = new Error("订单不存在");
      err.code = "not_found";
      throw err;
    }
    if (order.status !== "pending_payment") {
      const err = new Error("订单状态不可支付");
      err.code = "invalid_status";
      throw err;
    }

    const existing = latestForOrder(orderId);
    if (existing && existing.status === "paid") {
      return { payment: existing, order: ordersApi.getById(orderId) };
    }

    const amountCents = payableCents(order);
    const provider = getPaymentProvider();

    let openid = null;
    if (provider.name === "wechat") {
      openid = resolveMpOpenid(personId);
      if (!openid) {
        const err = new Error("缺少微信 openid，请先登录小程序");
        err.code = "openid_required";
        throw err;
      }
    }

    const outTradeNo = genOutTradeNo();
    const created = await provider.create({
      outTradeNo,
      amountCents,
      description: order.snapshot?.title || "服务包",
      openid,
    });

    const ts = nowIso();
    const info = db
      .prepare(
        `INSERT INTO svc_payments(
          order_id, provider, out_trade_no, amount_cents, status, prepay_json, created_at, updated_at
        ) VALUES (?,?,?,?, 'pending', ?, ?, ?)`
      )
      .run(
        +orderId,
        provider.name,
        outTradeNo,
        amountCents,
        JSON.stringify(created.prepay || created),
        ts,
        ts
      );

    let payment = mapPayment(db.prepare(`SELECT * FROM svc_payments WHERE id=?`).get(info.lastInsertRowid));

    // Mock：创建后可通过 env 自动完成，或等待 mockComplete
    if (provider.name === "mock" && String(process.env.SERVICE_PAY_MOCK_AUTO || "1") === "1") {
      payment = markPaid(payment.id, orderId, `auto_${outTradeNo}`);
    }

    return { payment, order: ordersApi.getById(orderId), provider: provider.name };
  }

  function mockComplete(personId, orderId) {
    if (!["test", "development"].includes(process.env.NODE_ENV || "") && process.env.SERVICE_PAY_ALLOW_MOCK !== "1") {
      const err = new Error("mock payment is forbidden in production");
      err.code = "pay_mock_forbidden";
      throw err;
    }
    const order = ordersApi.getByIdForPerson(orderId, personId);
    if (!order) {
      const err = new Error("订单不存在");
      err.code = "not_found";
      throw err;
    }
    let payment = latestForOrder(orderId);
    if (!payment) {
      const err = new Error("尚无支付单");
      err.code = "no_payment";
      throw err;
    }
    if (payment.status === "paid") {
      return { payment, order: ordersApi.getById(orderId) };
    }
    payment = markPaid(payment.id, orderId, `manual_${payment.outTradeNo}`);
    return { payment, order: ordersApi.getById(orderId) };
  }

  async function handleNotify(headers, rawBody) {
    const provider = getPaymentProvider();
    const result = await provider.handleNotify(headers, rawBody);
    if (!result || !result.paid) {
      return { ok: true, ignored: true };
    }
    const row = db
      .prepare(`SELECT * FROM svc_payments WHERE out_trade_no=?`)
      .get(String(result.outTradeNo || ""));
    if (!row) {
      return { ok: true, ignored: true };
    }
    const payment = mapPayment(row);
    if (payment.status === "paid") {
      return { ok: true, duplicate: true };
    }
    markPaid(payment.id, payment.orderId, result.providerTradeNo);
    return { ok: true };
  }

  /** 管理端驳回后全额退款（Mock 即时成功；微信可能 pending/processing） */
  async function fullRefund(orderId, reason) {
    const order = ordersApi.getById(orderId);
    if (!order) {
      const err = new Error("订单不存在");
      err.code = "not_found";
      throw err;
    }
    const amountCents = payableCents(order);
    const payment = latestForOrder(orderId);
    const provider = getPaymentProvider();
    const outRefundNo = genOutRefundNo();
    const result = await provider.refund({
      outRefundNo,
      amountCents,
      totalCents: amountCents,
      reason: reason || "审核不通过",
      outTradeNo: payment && payment.outTradeNo,
    });
    const ts = nowIso();
    const refundStatus =
      result.status === "refunded" ? "refunded" : result.status === "failed" ? "failed" : "pending";

    db.prepare(
      `INSERT INTO svc_refunds(
        order_id, payment_id, provider, out_refund_no, amount_cents, status, reason, created_at, updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?)`
    ).run(
      +orderId,
      payment ? payment.id : null,
      provider.name,
      outRefundNo,
      amountCents,
      refundStatus,
      reason || "",
      ts,
      ts
    );

    if (result.status === "pending" || result.status === "processing") {
      ordersApi.setStatus(orderId, "refunding", {
        reviewNote: reason || order.reviewNote,
      });
      return { ok: true, outRefundNo, status: "pending" };
    }

    if (payment) {
      db.prepare(`UPDATE svc_payments SET status='refunded', updated_at=? WHERE id=?`).run(ts, payment.id);
    }
    ordersApi.setStatus(orderId, "refunded", { closedAt: ts, reviewNote: reason || order.reviewNote });
    if (couponsApi && typeof couponsApi.voidByOrder === "function") {
      couponsApi.voidByOrder(orderId);
    }
    return { ok: true, outRefundNo, status: "refunded" };
  }

  async function paymentStatus(personId, orderId) {
    const order = ordersApi.getByIdForPerson(orderId, personId);
    if (!order) {
      const err = new Error("订单不存在");
      err.code = "not_found";
      throw err;
    }
    let payment = latestForOrder(orderId);
    if (
      payment &&
      payment.status === "pending" &&
      payment.provider === "wechat" &&
      String(process.env.SERVICE_PAY_QUERY_ON_STATUS || "1") !== "0"
    ) {
      try {
        const provider = getPaymentProvider();
        if (provider.name === "wechat" && typeof provider.query === "function") {
          const q = await provider.query({ outTradeNo: payment.outTradeNo });
          if (q && (q.paid || q.status === "paid" || q.tradeState === "SUCCESS")) {
            payment = markPaid(payment.id, orderId, q.providerTradeNo);
          }
        }
      } catch (_) {
        /* 查单失败不阻断状态查询 */
      }
    }
    const fresh = ordersApi.getByIdForPerson(orderId, personId) || order;
    return {
      orderStatus: fresh.status,
      payment: payment || latestForOrder(orderId),
      paid: fresh.status !== "pending_payment" && fresh.status !== "closed_timeout",
    };
  }

  return {
    createPayment,
    mockComplete,
    fullRefund,
    paymentStatus,
    handleNotify,
    latestForOrder,
    mapPayment,
  };
}

module.exports = { createPayments };
