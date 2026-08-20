"use strict";

const { sendSubscribeMessage } = require("./wechat_mp.js");

const DEFAULT_ORDER_PAID_TMPL = "aWYt8x-Tcv_QGTT6E7awCdAd2tDHZa1Gu7tDZMRgYRQ";

function clip(s, max) {
  const t = String(s ?? "").trim();
  return t.length <= max ? t : t.slice(0, max);
}

function formatAmountYuan(cents) {
  const n = Number(cents);
  if (!Number.isFinite(n)) return "0.00元";
  return `${(n / 100).toFixed(2)}元`;
}

function formatPaidTime(iso) {
  const d = iso ? new Date(iso) : new Date();
  if (Number.isNaN(d.getTime())) return formatPaidTime(null);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function orderTitle(order) {
  const snap = order.snapshot || {};
  if (snap.title) return clip(snap.title, 20);
  const line = Array.isArray(order.lines) && order.lines[0];
  if (line && line.title) return clip(line.title, 20);
  return "服务订单";
}

function buildOrderPaidVars(order) {
  const cents =
    order.payableAmountCents != null ? order.payableAmountCents : order.totalAmountCents;
  return {
    title: orderTitle(order),
    amount: formatAmountYuan(cents),
    orderNo: clip(order.orderNo || String(order.id || ""), 32),
    paidAt: formatPaidTime(order.paidAt || new Date().toISOString()),
  };
}

function buildOrderPaidData(order) {
  const vars = buildOrderPaidVars(order);
  // ponytail: 默认字段名需与微信公众平台该模板一致；不匹配时用 WECHAT_MP_SUBSCRIBE_ORDER_PAID_FIELDS 覆盖
  let fieldMap = {
    thing1: "{{title}}",
    amount2: "{{amount}}",
    character_string3: "{{orderNo}}",
    time4: "{{paidAt}}",
  };
  const raw = process.env.WECHAT_MP_SUBSCRIBE_ORDER_PAID_FIELDS;
  if (raw) {
    try {
      fieldMap = JSON.parse(raw);
    } catch (_) {
      /* keep default */
    }
  }
  const data = {};
  for (const [key, tpl] of Object.entries(fieldMap)) {
    const value = String(tpl).replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? "");
    data[key] = { value };
  }
  return data;
}

function resolveOpenid(db, personId) {
  const p = db.prepare(`SELECT mp_openid FROM persons WHERE id=?`).get(+personId);
  if (p && p.mp_openid) return String(p.mp_openid);
  const s = db
    .prepare(`SELECT openid FROM mp_sessions WHERE person_id=? ORDER BY rowid DESC LIMIT 1`)
    .get(+personId);
  return s && s.openid ? String(s.openid) : null;
}

async function sendOrderPaidNotice(db, order) {
  if (!order || !order.personId) return { skipped: true, reason: "no_order" };
  const tmplId = process.env.WECHAT_MP_SUBSCRIBE_ORDER_PAID_TMPL || DEFAULT_ORDER_PAID_TMPL;
  if (!tmplId) return { skipped: true, reason: "no_tmpl" };
  const openid = resolveOpenid(db, order.personId);
  if (!openid) return { skipped: true, reason: "no_openid" };

  const page = `pages/services/pay-result?orderId=${order.id}`;
  const data = buildOrderPaidData(order);
  try {
    return await sendSubscribeMessage({
      touser: openid,
      templateId: tmplId,
      page,
      data,
    });
  } catch (e) {
    if (e.errcode === 43101) return { skipped: true, reason: "not_subscribed" };
    throw e;
  }
}

module.exports = {
  buildOrderPaidData,
  buildOrderPaidVars,
  sendOrderPaidNotice,
};

if (require.main === module) {
  const sample = buildOrderPaidData({
    id: 100,
    orderNo: "SP20260101001",
    payableAmountCents: 19900,
    paidAt: new Date().toISOString(),
    snapshot: { title: "医患通服务包" },
  });
  console.log(JSON.stringify(sample, null, 2));
}
