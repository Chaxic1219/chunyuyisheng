"use strict";

const mpAuth = require("../mp_auth.js");
const { bearerToken } = require("./mp-auth.js");
const { createServicePackage } = require("../modules/servicePackage");

function registerMpServicePackageRoutes(route, ctx) {
  const { parseBody, json, MESSAGE_MAX_BODY, db } = ctx;
  /** server.js readRaw → utf8 string；超限/错误 → ""。无注入时本地兜底（超限标 __oversize）。 */
  const readRaw =
    ctx.readRaw ||
    function localReadRaw(req, maxBytes) {
      return new Promise((resolve) => {
        const chunks = [];
        let len = 0;
        let over = false;
        const limit = maxBytes || 1e6;
        req.on("data", (c) => {
          len += c.length;
          if (len > limit) {
            over = true;
            return;
          }
          chunks.push(c);
        });
        req.on("end", () =>
          resolve(over ? { __oversize: true } : Buffer.concat(chunks).toString("utf8"))
        );
        req.on("error", () => resolve(""));
      });
    };
  const svc = createServicePackage(db);

  function requirePerson(req, res) {
    const token = bearerToken(req);
    if (!token) {
      json(res, 401, { error: "unauthorized" });
      return null;
    }
    try {
      const sess = mpAuth.requireSession(token);
      if (!sess.phone_bound || !sess.person_id) {
        json(res, 401, { error: "请先绑定手机号" });
        return null;
      }
      return sess;
    } catch (e) {
      json(res, 401, { error: "unauthorized" });
      return null;
    }
  }

  function sessionDoctorId(req) {
    try {
      const token = bearerToken(req);
      if (!token) return null;
      const sess = mpAuth.requireSession(token);
      return sess && sess.doctor_id ? +sess.doctor_id : null;
    } catch (e) {
      return null;
    }
  }

  function cartHttpStatus(code) {
    if (code === "not_found" || code === "product_unavailable") return 404;
    if (code === "cart_doctor_mismatch") return 409;
    return 400;
  }

  route("GET", /^\/api\/mp\/cart$/, (req, res, m, q) => {
    const sess = requirePerson(req, res);
    if (!sess) return;
    const doctorId = q.doctorId ? +q.doctorId : sessionDoctorId(req);
    if (!doctorId) return json(res, 400, { error: "缺少 doctorId" });
    const data = svc.cart.list(+sess.person_id, doctorId);
    json(res, 200, { data });
  });

  route("POST", /^\/api\/mp\/cart\/items$/, async (req, res) => {
    const sess = requirePerson(req, res);
    if (!sess) return;
    const b = await parseBody(req, MESSAGE_MAX_BODY || 1e6);
    try {
      const data = svc.cart.addItem(+sess.person_id, b || {});
      json(res, 200, { data });
    } catch (e) {
      json(res, cartHttpStatus(e.code), { error: e.message, code: e.code });
    }
  });

  route("PATCH", /^\/api\/mp\/cart\/items\/(\d+)$/, async (req, res, m) => {
    const sess = requirePerson(req, res);
    if (!sess) return;
    const b = await parseBody(req, MESSAGE_MAX_BODY || 1e6);
    try {
      const data = svc.cart.updateQty(+sess.person_id, +m[1], b && b.qty);
      json(res, 200, { data });
    } catch (e) {
      json(res, cartHttpStatus(e.code), { error: e.message, code: e.code });
    }
  });

  route("DELETE", /^\/api\/mp\/cart\/items\/(\d+)$/, (req, res, m) => {
    const sess = requirePerson(req, res);
    if (!sess) return;
    try {
      const data = svc.cart.removeItem(+sess.person_id, +m[1]);
      json(res, 200, { data });
    } catch (e) {
      json(res, cartHttpStatus(e.code), { error: e.message, code: e.code });
    }
  });

  route("DELETE", /^\/api\/mp\/cart$/, (req, res, m, q) => {
    const sess = requirePerson(req, res);
    if (!sess) return;
    const doctorId = q.doctorId ? +q.doctorId : sessionDoctorId(req);
    if (!doctorId) return json(res, 400, { error: "缺少 doctorId" });
    const data = svc.cart.clear(+sess.person_id, doctorId);
    json(res, 200, { data });
  });

  route("GET", /^\/api\/mp\/service-products$/, (req, res, m, q) => {
    const doctorId = q.doctorId ? +q.doctorId : sessionDoctorId(req);
    const data = svc.catalog.listPublishedMall({
      doctorId: doctorId || undefined,
      page: q.page,
      pageSize: q.pageSize,
    });
    json(res, 200, { data });
  });

  route("GET", /^\/api\/mp\/service-products\/([^/]+)$/, (req, res, m) => {
    const key = decodeURIComponent(m[1]);
    const product = svc.catalog.getPublishedMallSpu(key) || svc.catalog.getCurrentPublished(key);
    if (!product) return json(res, 404, { error: "商品不存在或未上架" });
    json(res, 200, { data: product });
  });

  route("POST", /^\/api\/mp\/orders$/, async (req, res) => {
    const sess = requirePerson(req, res);
    if (!sess) return;
    const b = await parseBody(req, MESSAGE_MAX_BODY || 1e6);
    try {
      const order = svc.orders.createOrder(+sess.person_id, b || {});
      json(res, 200, { data: { order } });
    } catch (e) {
      const code = e.code === "product_unavailable" ? 404 : 400;
      json(res, code, { error: e.message });
    }
  });

  route("GET", /^\/api\/mp\/orders$/, (req, res, m, q) => {
    const sess = requirePerson(req, res);
    if (!sess) return;
    const status = q.status ? String(q.status) : undefined;
    const limit = q.limit;
    const offset = q.offset;
    const orders = svc.orders.listForPerson(+sess.person_id, { status, limit, offset });
    json(res, 200, { data: { orders } });
  });

  route("GET", /^\/api\/mp\/orders\/(\d+)$/, (req, res, m) => {
    const sess = requirePerson(req, res);
    if (!sess) return;
    const order = svc.orders.getByIdForPerson(+m[1], +sess.person_id);
    if (!order) return json(res, 404, { error: "订单不存在" });
    const profile = svc.orders.getProfile(+m[1]);
    json(res, 200, { data: { order, profile } });
  });

  // 微信支付回调：无登录；需原文验签，故用 readRaw（非 parseBody）
  route("POST", /^\/api\/mp\/payments\/wechat\/notify$/, async (req, res) => {
    try {
      const raw = await readRaw(req, MESSAGE_MAX_BODY || 1e6);
      // server readRaw: string（超限 ""）；本地兜底: 超限 { __oversize:true }
      if (raw && typeof raw === "object" && raw.__oversize) {
        return json(res, 413, { code: "FAIL", message: "body too large" });
      }
      const rawBody = typeof raw === "string" ? raw : (raw && raw.raw) || "";
      const headers = req.headers || {};
      await svc.payments.handleNotify(headers, rawBody);
      json(res, 200, { code: "SUCCESS", message: "成功" });
    } catch (e) {
      json(res, 500, { code: "FAIL", message: e.message || "fail" });
    }
  });

  route("POST", /^\/api\/mp\/orders\/(\d+)\/pay$/, async (req, res, m) => {
    const sess = requirePerson(req, res);
    if (!sess) return;
    try {
      const result = await svc.payments.createPayment(+sess.person_id, +m[1]);
      json(res, 200, { data: result });
    } catch (e) {
      const code = e.code === "not_found" ? 404 : 400;
      json(res, code, { error: e.message });
    }
  });


  route("POST", /^\/api\/mp\/orders\/(\d+)\/pay\/mock-complete$/, async (req, res, m) => {
    const sess = requirePerson(req, res);
    if (!sess) return;
    try {
      const result = svc.payments.mockComplete(+sess.person_id, +m[1]);
      json(res, 200, { data: result });
    } catch (e) {
      const code = e.code === "not_found" ? 404 : 400;
      json(res, code, { error: e.message });
    }
  });

  route("GET", /^\/api\/mp\/orders\/(\d+)\/payment-status$/, async (req, res, m) => {
    const sess = requirePerson(req, res);
    if (!sess) return;
    try {
      const data = await svc.payments.paymentStatus(+sess.person_id, +m[1]);
      json(res, 200, { data });
    } catch (e) {
      const code = e.code === "not_found" ? 404 : 400;
      json(res, code, { error: e.message });
    }
  });

  // 权益领取（PRD §8.14）：POST /api/mp/orders/:id/benefit-claim
  route("POST", /^\/api\/mp\/orders\/(\d+)\/benefit-claim$/, async (req, res, m) => {
    const sess = requirePerson(req, res);
    if (!sess) return;
    try {
      const person = {
        person_id: +sess.person_id,
        phone: String(sess.phone || ""),
      };
      const result = await svc.benefitClaim.claimForOrder(+m[1], person);
      json(res, 200, { data: result });
    } catch (e) {
      const code = e.code === "not_found" ? 404 : e.code === "forbidden" ? 403 : 400;
      json(res, code, { error: e.message, code: e.code });
    }
  });

  // 领取状态查询：GET /api/mp/orders/:id/benefit-claim
  route("GET", /^\/api\/mp\/orders\/(\d+)\/benefit-claim$/, (req, res, m) => {
    const sess = requirePerson(req, res);
    if (!sess) return;
    try {
      const status = svc.benefitClaim.claimStatus(+m[1]);
      json(res, 200, { data: status });
    } catch (e) {
      json(res, 400, { error: e.message });
    }
  });

  route("POST", /^\/api\/mp\/orders\/(\d+)\/postoperative-profile$/, async (req, res, m) => {
    const sess = requirePerson(req, res);
    if (!sess) return;
    const b = await parseBody(req, MESSAGE_MAX_BODY || 1e6);
    try {
      const order = svc.orders.submitProfile(+sess.person_id, +m[1], b || {});
      json(res, 200, { data: { order, profile: svc.orders.getProfile(+m[1]) } });
    } catch (e) {
      const code = e.code === "not_found" ? 404 : 400;
      json(res, code, { error: e.message });
    }
  });

  route("POST", /^\/api\/mp\/orders\/(\d+)\/cancel-request$/, async (req, res, m) => {
    const sess = requirePerson(req, res);
    if (!sess) return;
    const b = await parseBody(req, MESSAGE_MAX_BODY || 1e6);
    try {
      let order = svc.orders.requestCancel(+sess.person_id, +m[1], (b && b.reason) || "");
      if (order.status === "refunding") {
        await svc.payments.fullRefund(+m[1], (b && b.reason) || "用户取消");
        order = svc.orders.getById(+m[1]);
      }
      json(res, 200, { data: { order } });
    } catch (e) {
      const code = e.code === "not_found" ? 404 : 400;
      json(res, code, { error: e.message });
    }
  });

  route("POST", /^\/api\/mp\/orders\/(\d+)\/after-sales$/, async (req, res, m) => {
    const sess = requirePerson(req, res);
    if (!sess) return;
    const b = await parseBody(req, MESSAGE_MAX_BODY || 1e6);
    try {
      const ticket = svc.afterSales.createTicket(+sess.person_id, +m[1], {
        reason: (b && b.reason) || "",
        type: b && b.type,
      });
      json(res, 200, { data: { ticket } });
    } catch (e) {
      json(res, afterSalesHttpStatus(e.code), { error: e.message, code: e.code });
    }
  });

  route("GET", /^\/api\/mp\/after-sales$/, (req, res, m, q) => {
    const sess = requirePerson(req, res);
    if (!sess) return;
    const status = q.status ? String(q.status) : undefined;
    const limit = q.limit;
    const tickets = svc.afterSales.listForPerson(+sess.person_id, { status, limit });
    json(res, 200, { data: { tickets } });
  });

  route("GET", /^\/api\/mp\/after-sales\/(\d+)$/, (req, res, m) => {
    const sess = requirePerson(req, res);
    if (!sess) return;
    const ticket = svc.afterSales.getForPerson(+m[1], +sess.person_id);
    if (!ticket) return json(res, 404, { error: "售后工单不存在" });
    json(res, 200, { data: { ticket } });
  });

  route("PATCH", /^\/api\/mp\/after-sales\/(\d+)$/, async (req, res, m) => {
    const sess = requirePerson(req, res);
    if (!sess) return;
    const b = await parseBody(req, MESSAGE_MAX_BODY || 1e6);
    try {
      const ticket = svc.afterSales.updateReasonForPerson(+m[1], +sess.person_id, (b && b.reason) || "");
      json(res, 200, { data: { ticket } });
    } catch (e) {
      json(res, afterSalesHttpStatus(e.code), { error: e.message, code: e.code });
    }
  });

  route("POST", /^\/api\/mp\/after-sales\/(\d+)\/cancel$/, async (req, res, m) => {
    const sess = requirePerson(req, res);
    if (!sess) return;
    try {
      const ticket = svc.afterSales.cancelForPerson(+m[1], +sess.person_id);
      json(res, 200, { data: { ticket } });
    } catch (e) {
      json(res, afterSalesHttpStatus(e.code), { error: e.message, code: e.code });
    }
  });

  route("GET", /^\/api\/mp\/service-assets$/, (req, res) => {
    const sess = requirePerson(req, res);
    if (!sess) return;
    const data = svc.afterSales.buildAssets(+sess.person_id);
    json(res, 200, { data });
  });

  route("GET", /^\/api\/mp\/service-instances$/, (req, res) => {
    const sess = requirePerson(req, res);
    if (!sess) return;
    const instances = svc.activation.listForPerson(+sess.person_id);
    const orders = svc.orders.listForPerson(+sess.person_id, { limit: 100 });
    json(res, 200, { data: { instances, orders } });
  });

  route("GET", /^\/api\/mp\/service-instances\/(\d+)$/, (req, res, m) => {
    const sess = requirePerson(req, res);
    if (!sess) return;
    const instance = svc.activation.getForPerson(+m[1], +sess.person_id);
    if (!instance) return json(res, 404, { error: "服务实例不存在" });
    const order = svc.orders.getByIdForPerson(instance.orderId, +sess.person_id);
    const packageInstance = svc.fulfillment.getForLegacyInstance(+m[1], +sess.person_id);
    json(res, 200, { data: { instance, order, packageInstance } });
  });

  /* ---------- 权益 (Entitlements) ---------- */

  function entitlementHttpStatus(code) {
    if (code === "not_found") return 404;
    if (code === "validation") return 400;
    if (
      code === "entitlement_inactive" ||
      code === "quota_insufficient" ||
      code === "concurrent_limit" ||
      code === "usage_invalid_status" ||
      code === "idempotency_conflict"
    )
      return 409;
    return 400;
  }

  route("GET", /^\/api\/mp\/service-instances\/(\d+)\/entitlements$/, (req, res, m) => {
    const sess = requirePerson(req, res);
    if (!sess) return;
    const instance = svc.activation.getForPerson(+m[1], +sess.person_id);
    if (!instance) return json(res, 404, { error: "服务实例不存在" });
    const entitlements = svc.entitlements.listForInstance(+m[1], +sess.person_id);
    json(res, 200, { data: entitlements });
  });

  route("GET", /^\/api\/mp\/entitlements\/(\d+)$/, (req, res, m) => {
    const sess = requirePerson(req, res);
    if (!sess) return;
    const entitlement = svc.entitlements.getForPerson(+m[1], +sess.person_id);
    if (!entitlement) return json(res, 404, { error: "权益不存在" });
    json(res, 200, { data: entitlement });
  });

  route("POST", /^\/api\/mp\/entitlements\/(\d+)\/usages$/, async (req, res, m) => {
    const sess = requirePerson(req, res);
    if (!sess) return;
    const b = await parseBody(req, MESSAGE_MAX_BODY || 1e6);
    const body = b || {};
    if (!body.idempotencyKey) {
      return json(res, 400, { error: "缺少 idempotencyKey" });
    }
    try {
      const usage = svc.entitlements.requestUsage(+sess.person_id, +m[1], {
        qty: body.qty != null ? Number(body.qty) : 1,
        idempotencyKey: String(body.idempotencyKey),
        bizType: body.bizType || "",
        bizRef: body.bizRef || "",
        note: body.note || "",
      });
      json(res, 200, { data: usage });
    } catch (e) {
      json(res, entitlementHttpStatus(e.code), { error: e.message, code: e.code });
    }
  });

  route("POST", /^\/api\/mp\/entitlement-usages\/(\d+)\/cancel$/, async (req, res, m) => {
    const sess = requirePerson(req, res);
    if (!sess) return;
    try {
      const usage = svc.entitlements.cancelUsage(+sess.person_id, +m[1]);
      json(res, 200, { data: usage });
    } catch (e) {
      json(res, entitlementHttpStatus(e.code), { error: e.message, code: e.code });
    }
  });

  function couponHttpStatus(code) {
    if (code === "not_found") return 404;
    return 400;
  }

  function afterSalesHttpStatus(code) {
    if (code === "not_found") return 404;
    if (code === "ticket_exists") return 409;
    return 400;
  }

  route("GET", /^\/api\/mp\/coupons\/templates$/, (req, res, m, q) => {
    const sess = requirePerson(req, res);
    if (!sess) return;
    const doctorId = q.doctorId ? +q.doctorId : sessionDoctorId(req);
    if (!doctorId) return json(res, 400, { error: "缺少 doctorId" });
    try {
      const templates = svc.coupons.listClaimableTemplates(+sess.person_id, doctorId);
      json(res, 200, { data: { templates } });
    } catch (e) {
      json(res, couponHttpStatus(e.code), { error: e.message, code: e.code });
    }
  });

  route("POST", /^\/api\/mp\/coupons\/claim$/, async (req, res) => {
    const sess = requirePerson(req, res);
    if (!sess) return;
    const b = await parseBody(req, MESSAGE_MAX_BODY || 1e6);
    const templateId = b && b.templateId != null ? +b.templateId : NaN;
    if (!Number.isFinite(templateId) || templateId <= 0) {
      return json(res, 400, { error: "缺少 templateId" });
    }
    try {
      const coupon = svc.coupons.claim(+sess.person_id, templateId);
      json(res, 200, { data: { coupon } });
    } catch (e) {
      json(res, couponHttpStatus(e.code), { error: e.message, code: e.code });
    }
  });

  route("POST", /^\/api\/mp\/coupons\/redeem$/, async (req, res) => {
    const sess = requirePerson(req, res);
    if (!sess) return;
    const b = await parseBody(req, MESSAGE_MAX_BODY || 1e6);
    try {
      const coupon = svc.coupons.redeemByCode(+sess.person_id, (b && b.code) || "");
      json(res, 200, { data: { coupon } });
    } catch (e) {
      json(res, couponHttpStatus(e.code), { error: e.message, code: e.code });
    }
  });

  route("GET", /^\/api\/mp\/coupons\/mine$/, (req, res, m, q) => {
    const sess = requirePerson(req, res);
    if (!sess) return;
    try {
      const status = q.status ? String(q.status) : undefined;
      const coupons = svc.coupons.listMine(+sess.person_id, { status });
      json(res, 200, { data: { coupons } });
    } catch (e) {
      json(res, couponHttpStatus(e.code), { error: e.message, code: e.code });
    }
  });

  route("GET", /^\/api\/mp\/coupons\/quote$/, (req, res, m, q) => {
    const sess = requirePerson(req, res);
    if (!sess) return;
    const doctorId = q.doctorId ? +q.doctorId : sessionDoctorId(req);
    if (!doctorId) return json(res, 400, { error: "缺少 doctorId" });
    if (q.subtotalCents == null || q.subtotalCents === "") {
      return json(res, 400, { error: "缺少 subtotalCents" });
    }
    try {
      const data = svc.coupons.quote({
        personId: +sess.person_id,
        doctorId,
        subtotalCents: +q.subtotalCents,
        couponId: q.couponId != null && q.couponId !== "" ? +q.couponId : null,
      });
      json(res, 200, { data });
    } catch (e) {
      json(res, couponHttpStatus(e.code), { error: e.message, code: e.code });
    }
  });

  function addressHttpStatus(code) {
    if (code === "not_found") return 404;
    if (code === "invalid_address" || code === "invalid_phone") return 400;
    return 400;
  }

  route("GET", /^\/api\/mp\/addresses$/, (req, res) => {
    const sess = requirePerson(req, res);
    if (!sess) return;
    const addresses = svc.addresses.list(+sess.person_id);
    json(res, 200, { data: { addresses } });
  });

  route("POST", /^\/api\/mp\/addresses$/, async (req, res) => {
    const sess = requirePerson(req, res);
    if (!sess) return;
    const b = await parseBody(req, MESSAGE_MAX_BODY || 1e6);
    try {
      const address = svc.addresses.create(+sess.person_id, b || {});
      json(res, 201, { data: { address } });
    } catch (e) {
      json(res, addressHttpStatus(e.code), { error: e.message, code: e.code });
    }
  });

  route("PATCH", /^\/api\/mp\/addresses\/(\d+)$/, async (req, res, m) => {
    const sess = requirePerson(req, res);
    if (!sess) return;
    const b = await parseBody(req, MESSAGE_MAX_BODY || 1e6);
    try {
      const address = svc.addresses.update(+sess.person_id, +m[1], b || {});
      json(res, 200, { data: { address } });
    } catch (e) {
      json(res, addressHttpStatus(e.code), { error: e.message, code: e.code });
    }
  });

  route("DELETE", /^\/api\/mp\/addresses\/(\d+)$/, (req, res, m) => {
    const sess = requirePerson(req, res);
    if (!sess) return;
    try {
      svc.addresses.remove(+sess.person_id, +m[1]);
      json(res, 200, { data: { ok: true } });
    } catch (e) {
      json(res, addressHttpStatus(e.code), { error: e.message, code: e.code });
    }
  });

  route("POST", /^\/api\/mp\/addresses\/(\d+)\/default$/, (req, res, m) => {
    const sess = requirePerson(req, res);
    if (!sess) return;
    try {
      const address = svc.addresses.setDefault(+sess.person_id, +m[1]);
      json(res, 200, { data: { address } });
    } catch (e) {
      json(res, addressHttpStatus(e.code), { error: e.message, code: e.code });
    }
  });
}

module.exports = { registerMpServicePackageRoutes };
