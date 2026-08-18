"use strict";

const { nowIso } = require("./schema.js");

function fail(code, message) {
  const err = new Error(message);
  err.code = code;
  throw err;
}

function createAfterSales(db, { ordersApi, paymentsApi, activationApi, couponsApi } = {}) {
  function parseJson(raw, fallback) {
    try {
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }

  function mapTicket(row) {
    if (!row) return null;
    return {
      id: row.id,
      orderId: row.order_id,
      personId: row.person_id,
      doctorId: row.doctor_id,
      type: row.type,
      status: row.status,
      reason: row.reason || "",
      adminNote: row.admin_note || "",
      refundAmountCents:
        row.refund_amount_cents == null ? null : Number(row.refund_amount_cents),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      closedAt: row.closed_at || null,
      // 默认空，list/get 时由 enrichTickets 补齐商品信息
      productTitle: "",
      productCover: "",
      orderNo: "",
      qty: 0,
      amountCents: null,
    };
  }

  function summarizeOrder(orderId) {
    const order = db.prepare(`SELECT * FROM svc_orders WHERE id=?`).get(+orderId);
    if (!order) {
      return {
        productTitle: `订单 ${orderId}`,
        productCover: "",
        orderNo: "",
        qty: 0,
        amountCents: null,
      };
    }
    const snapshot = parseJson(order.snapshot_json, {});
    const lines = db
      .prepare(
        `SELECT title, qty, snapshot_json, version_id, product_id FROM svc_order_lines WHERE order_id=? ORDER BY id ASC`
      )
      .all(+orderId);
    const titles = lines.map((l) => String(l.title || "").trim()).filter(Boolean);
    let productTitle = "";
    if (titles.length > 1) productTitle = `${titles[0]} 等${titles.length}件`;
    else if (titles.length === 1) productTitle = titles[0];
    else productTitle = String(snapshot.title || "").trim() || `订单 ${order.order_no || orderId}`;

    const firstSnap = lines[0] ? parseJson(lines[0].snapshot_json, {}) : {};
    let productCover = String(firstSnap.cover || snapshot.cover || "").trim();
    if (!productCover && lines[0]?.version_id) {
      const ver = db
        .prepare(`SELECT cover FROM svc_product_versions WHERE id=?`)
        .get(+lines[0].version_id);
      productCover = String(ver?.cover || "").trim();
    }
    if (!productCover && (lines[0]?.product_id || order.product_id)) {
      const pid = +(lines[0]?.product_id || order.product_id);
      const ver = db
        .prepare(
          `SELECT cover FROM svc_product_versions WHERE product_id=? AND published_at IS NOT NULL ORDER BY version_no DESC LIMIT 1`
        )
        .get(pid);
      productCover = String(ver?.cover || "").trim();
    }
    const qty =
      lines.reduce((sum, l) => sum + (Number(l.qty) || 1), 0) || 1;
    const amountCents =
      order.payable_amount_cents != null
        ? Number(order.payable_amount_cents)
        : Number(order.total_amount_cents || 0);

    return {
      productTitle,
      productCover,
      orderNo: String(order.order_no || ""),
      qty,
      amountCents: Number.isFinite(amountCents) ? amountCents : null,
    };
  }

  function enrichTickets(tickets) {
    return (tickets || []).map((t) => {
      if (!t) return t;
      const extra = summarizeOrder(t.orderId);
      return { ...t, ...extra };
    });
  }

  function getRaw(id) {
    return db.prepare(`SELECT * FROM svc_after_sales WHERE id=?`).get(+id) || null;
  }

  function findOpenForOrder(orderId) {
    return (
      db
        .prepare(`SELECT * FROM svc_after_sales WHERE order_id=? AND status='open' LIMIT 1`)
        .get(+orderId) || null
    );
  }

  function inferType(orderStatus) {
    if (orderStatus === "pending_payment") return "cancel_unpaid";
    if (
      orderStatus === "paid_pending_profile" ||
      orderStatus === "pending_review" ||
      orderStatus === "refunding"
    ) {
      return "refund_paid";
    }
    if (orderStatus === "active") return "refund_active";
    return null;
  }

  function insertTicket({
    orderId,
    personId,
    doctorId,
    type,
    status,
    reason,
    refundAmountCents,
    closedAt,
  }) {
    const ts = nowIso();
    const info = db
      .prepare(
        `INSERT INTO svc_after_sales(
          order_id, person_id, doctor_id, type, status, reason,
          refund_amount_cents, created_at, updated_at, closed_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?)`
      )
      .run(
        +orderId,
        +personId,
        +doctorId,
        type,
        status,
        reason || "",
        refundAmountCents == null ? null : Math.floor(Number(refundAmountCents)),
        ts,
        ts,
        closedAt || null
      );
    return enrichTickets([mapTicket(getRaw(Number(info.lastInsertRowid)))])[0];
  }

  function createTicket(personId, orderId, { reason, type } = {}) {
    const order = ordersApi.getByIdForPerson(orderId, personId);
    if (!order) fail("not_found", "订单不存在");

    if (findOpenForOrder(order.id)) fail("ticket_exists", "该订单已有进行中的售后工单");

    const resolvedType = type || inferType(order.status);
    if (!resolvedType) fail("invalid_status", "当前订单状态不支持售后申请");
    if (type && !["cancel_unpaid", "refund_paid", "refund_active"].includes(type)) {
      fail("invalid_status", "无效的售后类型");
    }

    if (resolvedType === "cancel_unpaid") {
      if (order.status !== "pending_payment") {
        fail("invalid_status", "仅待支付订单可取消");
      }
      ordersApi.requestCancel(personId, order.id, reason || "用户取消");
      return insertTicket({
        orderId: order.id,
        personId: order.personId,
        doctorId: order.doctorId,
        type: "cancel_unpaid",
        status: "closed",
        reason,
        refundAmountCents: null,
        closedAt: nowIso(),
      });
    }

    if (resolvedType === "refund_paid") {
      if (
        !["paid_pending_profile", "pending_review", "refunding"].includes(order.status)
      ) {
        fail("invalid_status", "当前订单状态不支持退款申请");
      }
      return insertTicket({
        orderId: order.id,
        personId: order.personId,
        doctorId: order.doctorId,
        type: "refund_paid",
        status: "open",
        reason,
        refundAmountCents: order.payableAmountCents,
      });
    }

    if (resolvedType === "refund_active") {
      if (order.status !== "active") {
        fail("invalid_status", "仅已开通订单可申请售后");
      }
      return insertTicket({
        orderId: order.id,
        personId: order.personId,
        doctorId: order.doctorId,
        type: "refund_active",
        status: "open",
        reason,
        refundAmountCents: order.payableAmountCents,
      });
    }

    fail("invalid_status", "当前订单状态不支持售后申请");
  }

  function listForPerson(personId, { status, limit } = {}) {
    let sql = `SELECT * FROM svc_after_sales WHERE person_id=?`;
    const args = [+personId];
    if (status) {
      sql += ` AND status=?`;
      args.push(String(status));
    }
    sql += ` ORDER BY id DESC LIMIT ?`;
    args.push(Math.min(Number(limit) || 50, 200));
    return enrichTickets(db.prepare(sql).all(...args).map(mapTicket));
  }

  function getForPerson(id, personId) {
    return enrichTickets([
      mapTicket(
        db
          .prepare(`SELECT * FROM svc_after_sales WHERE id=? AND person_id=?`)
          .get(+id, +personId)
      ),
    ])[0];
  }

  function getById(id) {
    return enrichTickets([mapTicket(getRaw(id))])[0];
  }

  function listAdmin({ doctorId, status, limit } = {}) {
    let sql = `SELECT * FROM svc_after_sales WHERE 1=1`;
    const args = [];
    if (doctorId) {
      sql += ` AND doctor_id=?`;
      args.push(+doctorId);
    }
    if (status) {
      sql += ` AND status=?`;
      args.push(String(status));
    }
    sql += ` ORDER BY id DESC LIMIT ?`;
    args.push(Math.min(Number(limit) || 100, 500));
    return enrichTickets(db.prepare(sql).all(...args).map(mapTicket));
  }

  function requireOpen(id) {
    const row = getRaw(id);
    if (!row) fail("not_found", "售后工单不存在");
    if (row.status !== "open") fail("invalid_status", "仅开放工单可操作");
    return row;
  }

  function closeTicket(id, { status, adminNote }) {
    const ts = nowIso();
    db.prepare(
      `UPDATE svc_after_sales
       SET status=?, admin_note=?, updated_at=?, closed_at=?
       WHERE id=?`
    ).run(status, adminNote || "", ts, ts, +id);
    return enrichTickets([mapTicket(getRaw(id))])[0];
  }

  async function approve(id, { adminNote, adminId } = {}) {
    void adminId;
    const row = requireOpen(id);

    if (row.type === "refund_paid" || row.type === "cancel_unpaid") {
      if (paymentsApi && typeof paymentsApi.fullRefund === "function") {
        await paymentsApi.fullRefund(row.order_id, adminNote || "售后同意退款");
      }
      return closeTicket(id, { status: "approved", adminNote });
    }

    if (row.type === "refund_active") {
      return closeTicket(id, { status: "approved", adminNote });
    }

    fail("invalid_status", "不支持的工单类型");
  }

  function reject(id, { adminNote } = {}) {
    requireOpen(id);
    return closeTicket(id, { status: "rejected", adminNote });
  }

  function updateReasonForPerson(id, personId, reason) {
    const row = getRaw(id);
    if (!row) fail("not_found", "售后工单不存在");
    if (+row.person_id !== +personId) fail("not_found", "售后工单不存在");
    if (row.status !== "open") fail("invalid_status", "仅处理中的工单可修改");
    const text = String(reason || "").trim();
    if (!text) fail("invalid_status", "请填写申请原因");
    if (text.length > 200) fail("invalid_status", "申请原因请控制在 200 字以内");
    const ts = nowIso();
    db.prepare(
      `UPDATE svc_after_sales SET reason=?, updated_at=? WHERE id=?`
    ).run(text, ts, +id);
    return enrichTickets([mapTicket(getRaw(id))])[0];
  }

  function cancelForPerson(id, personId) {
    const row = getRaw(id);
    if (!row) fail("not_found", "售后工单不存在");
    if (+row.person_id !== +personId) fail("not_found", "售后工单不存在");
    if (row.status !== "open") fail("invalid_status", "仅处理中的工单可撤销");
    return closeTicket(id, {
      status: "closed",
      adminNote: "用户撤销",
    });
  }

  function buildAssets(personId) {
    const instances =
      activationApi && typeof activationApi.listForPerson === "function"
        ? activationApi.listForPerson(personId)
        : [];
    const openTickets = listForPerson(personId, { status: "open" });
    let couponAvailableCount = 0;
    if (couponsApi && typeof couponsApi.listMine === "function") {
      couponAvailableCount = couponsApi.listMine(personId, { status: "available" }).length;
    }
    return { instances, openTickets, couponAvailableCount };
  }

  return {
    mapTicket,
    createTicket,
    listForPerson,
    getForPerson,
    getById,
    listAdmin,
    approve,
    reject,
    updateReasonForPerson,
    cancelForPerson,
    buildAssets,
  };
}

module.exports = { createAfterSales };
