"use strict";

const { nowIso } = require("./schema.js");

function createAdminOrders(db, { ordersApi, paymentsApi, activationApi }) {
  function list({ doctorId, status, limit } = {}) {
    let sql = `SELECT o.*, d.name AS doctor_name FROM svc_orders o
      LEFT JOIN doctors d ON d.id = o.doctor_id WHERE 1=1`;
    const args = [];
    if (doctorId) {
      sql += ` AND o.doctor_id=?`;
      args.push(+doctorId);
    }
    if (status) {
      sql += ` AND o.status=?`;
      args.push(String(status));
    }
    sql += ` ORDER BY o.id DESC LIMIT ?`;
    args.push(Math.min(Number(limit) || 100, 500));
    return db.prepare(sql).all(...args).map((row) => {
      const mapped = ordersApi.mapOrder(row);
      return { ...mapped, doctorName: row.doctor_name || "" };
    });
  }

  function detail(orderId) {
    const order = ordersApi.getById(orderId);
    if (!order) return null;
    const profile = ordersApi.getProfile(orderId);
    const payment = paymentsApi.latestForOrder(orderId);
    const instances =
      typeof activationApi.listByOrderId === "function"
        ? activationApi.listByOrderId(orderId)
        : [];
    const instance = instances[0] || activationApi.getByOrderId(orderId);
    const doctor = db.prepare(`SELECT id, name, hospital, dept FROM doctors WHERE id=?`).get(+order.doctorId);
    return {
      order,
      lines: order.lines || [],
      profile,
      payment,
      instance,
      instances,
      doctor,
    };
  }

  function requestMoreInfo(orderId, { adminId, note } = {}) {
    const raw = ordersApi.getRaw(orderId);
    if (!raw) {
      const err = new Error("订单不存在");
      err.code = "not_found";
      throw err;
    }
    if (raw.status !== "pending_review") {
      const err = new Error("仅待审核订单可退回补资料");
      err.code = "invalid_status";
      throw err;
    }
    return ordersApi.setStatus(orderId, "paid_pending_profile", {
      reviewedAt: nowIso(),
      reviewerAdminId: adminId || null,
      reviewNote: note || "请补充资料",
    });
  }

  async function reject(orderId, { adminId, note } = {}) {
    const raw = ordersApi.getRaw(orderId);
    if (!raw) {
      const err = new Error("订单不存在");
      err.code = "not_found";
      throw err;
    }
    if (!["paid_pending_profile", "pending_review", "refunding"].includes(raw.status)) {
      const err = new Error("当前状态不可驳回退款");
      err.code = "invalid_status";
      throw err;
    }
    ordersApi.setStatus(orderId, "refunding", {
      reviewedAt: nowIso(),
      reviewerAdminId: adminId || null,
      reviewNote: note || "审核不通过",
    });
    return paymentsApi.fullRefund(orderId, note || "审核不通过");
  }

  function approve(orderId, opts) {
    return activationApi.approve(orderId, opts);
  }

  return { list, detail, requestMoreInfo, reject, approve };
}

module.exports = { createAdminOrders };
