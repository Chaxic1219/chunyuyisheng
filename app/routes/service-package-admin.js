"use strict";

const fs = require("fs");
const path = require("path");
const { createServicePackage } = require("../modules/servicePackage");
const { isWechatPayConfigured } = require("../modules/servicePackage/providers/wechatConfig.js");

const MALL_COVER_MAX_BODY = 6 * 1024 * 1024;

function registerServicePackageAdminRoutes(route, ctx) {
  const { parseBody, json, gate, requireAdminAction, db } = ctx;
  const svc = createServicePackage(db);

  function mallError(res, error) {
    const status = error && error.code === "not_found" ? 404 : error && error.code === "conflict" ? 409 : 400;
    json(res, status, { error: error.message, code: error.code || "validation" });
  }

  function canManageMall(req, res, session, doctorId) {
    return requireAdminAction(
      req,
      res,
      session,
      "service_products.manage",
      doctorId ? { doctorId } : null,
      "无商品管理权限"
    );
  }

  route("GET", /^\/api\/admin\/service-orders$/, (req, res, m, q) => {
    const did = q.doctorId ? +q.doctorId : null;
    const s = did ? gate(req, res, did) : gate(req, res);
    if (!s) return;
    const rows = svc.adminOrders.list({
      doctorId: did || undefined,
      status: q.status || undefined,
      limit: q.limit,
    });
    json(res, 200, { data: rows });
  });

  route("GET", /^\/api\/admin\/service-orders\/(\d+)$/, (req, res, m) => {
    const detail = svc.adminOrders.detail(+m[1]);
    if (!detail) return json(res, 404, { error: "订单不存在" });
    const s = gate(req, res, detail.order.doctorId);
    if (!s) return;
    json(res, 200, { data: detail });
  });

  route("POST", /^\/api\/admin\/service-orders\/(\d+)\/request-more-info$/, async (req, res, m) => {
    const detail = svc.adminOrders.detail(+m[1]);
    if (!detail) return json(res, 404, { error: "订单不存在" });
    const s = gate(req, res, detail.order.doctorId);
    if (!s) return;
    if (!requireAdminAction(req, res, s, "service_orders.review", { doctorId: detail.order.doctorId }, "无服务订单审核权限"))
      return;
    const b = await parseBody(req);
    try {
      const order = svc.adminOrders.requestMoreInfo(+m[1], {
        adminId: s.adminId || s.id,
        note: (b && b.note) || "",
      });
      json(res, 200, { data: { order } });
    } catch (e) {
      json(res, 400, { error: e.message });
    }
  });

  route("POST", /^\/api\/admin\/service-orders\/(\d+)\/approve$/, async (req, res, m) => {
    const detail = svc.adminOrders.detail(+m[1]);
    if (!detail) return json(res, 404, { error: "订单不存在" });
    const s = gate(req, res, detail.order.doctorId);
    if (!s) return;
    if (!requireAdminAction(req, res, s, "service_orders.review", { doctorId: detail.order.doctorId }, "无服务订单审核权限"))
      return;
    const b = await parseBody(req);
    try {
      const instance = svc.adminOrders.approve(+m[1], {
        adminId: s.adminId || s.id,
        serviceStartDate: b && b.serviceStartDate,
        note: (b && b.note) || "",
      });
      json(res, 200, { data: { instance, order: svc.orders.getById(+m[1]) } });
    } catch (e) {
      json(res, 400, { error: e.message });
    }
  });

  route("POST", /^\/api\/admin\/service-orders\/(\d+)\/reject$/, async (req, res, m) => {
    const detail = svc.adminOrders.detail(+m[1]);
    if (!detail) return json(res, 404, { error: "订单不存在" });
    const s = gate(req, res, detail.order.doctorId);
    if (!s) return;
    if (!requireAdminAction(req, res, s, "service_orders.review", { doctorId: detail.order.doctorId }, "无服务订单审核权限"))
      return;
    const b = await parseBody(req);
    try {
      const refund = await svc.adminOrders.reject(+m[1], {
        adminId: s.adminId || s.id,
        note: (b && b.note) || "审核不通过",
      });
      json(res, 200, { data: { refund, order: svc.orders.getById(+m[1]) } });
    } catch (e) {
      json(res, 400, { error: e.message });
    }
  });

  route("GET", /^\/api\/admin\/service-pay\/status$/, (req, res) => {
    const s = gate(req, res);
    if (!s) return;
    const raw = String(process.env.SERVICE_PAY_PROVIDER || "mock").trim().toLowerCase();
    const provider =
      raw === "wechat" || raw === "wx" || raw === "wechatpay" ? "wechat" : "mock";
    const configured = provider === "wechat" ? isWechatPayConfigured() : true;
    json(res, 200, { data: { provider, configured } });
  });

  /* ---------- 商城主数据 ---------- */
  route("GET", /^\/api\/admin\/mall\/benefit-skus$/, (req, res, m, q) => {
    const s = gate(req, res);
    if (!s) return;
    json(res, 200, { data: svc.masterData.listBenefitSkus(q || {}) });
  });

  route("POST", /^\/api\/admin\/mall\/benefit-skus$/, async (req, res) => {
    const s = gate(req, res);
    if (!s || !canManageMall(req, res, s)) return;
    const b = await parseBody(req);
    try {
      json(res, 200, { data: svc.masterData.createBenefitSku(b || {}) });
    } catch (error) {
      mallError(res, error);
    }
  });

  route("GET", /^\/api\/admin\/mall\/benefit-skus\/(\d+)$/, (req, res, m) => {
    const s = gate(req, res);
    if (!s) return;
    const data = svc.masterData.getBenefitSku(+m[1]);
    if (!data) return json(res, 404, { error: "权益 SKU 不存在" });
    json(res, 200, { data });
  });

  route("PUT", /^\/api\/admin\/mall\/benefit-skus\/(\d+)$/, async (req, res, m) => {
    const s = gate(req, res);
    if (!s || !canManageMall(req, res, s)) return;
    const b = await parseBody(req);
    try {
      json(res, 200, { data: svc.masterData.saveBenefitDraft(+m[1], b || {}) });
    } catch (error) {
      mallError(res, error);
    }
  });

  route("POST", /^\/api\/admin\/mall\/benefit-skus\/(\d+)\/publish$/, async (req, res, m) => {
    const s = gate(req, res);
    if (!s || !canManageMall(req, res, s)) return;
    const b = await parseBody(req);
    try {
      json(res, 200, { data: svc.masterData.publishBenefitVersion(+m[1], b && b.versionNo) });
    } catch (error) {
      mallError(res, error);
    }
  });

  route("POST", /^\/api\/admin\/mall\/benefit-skus\/(\d+)\/disable$/, (req, res, m) => {
    const s = gate(req, res);
    if (!s || !canManageMall(req, res, s)) return;
    try {
      json(res, 200, { data: svc.masterData.disableBenefitSku(+m[1]) });
    } catch (error) {
      mallError(res, error);
    }
  });

  route("GET", /^\/api\/admin\/mall\/ops-templates$/, (req, res, m, q) => {
    const doctorId = +(q && q.doctorId);
    const s = gate(req, res, doctorId);
    if (!s) return;
    try {
      json(res, 200, { data: svc.masterData.listOpsTemplates({ ...(q || {}), doctorId }) });
    } catch (error) {
      mallError(res, error);
    }
  });

  route("POST", /^\/api\/admin\/mall\/ops-templates$/, async (req, res) => {
    const b = (await parseBody(req)) || {};
    const doctorId = +b.doctorId;
    const s = gate(req, res, doctorId);
    if (!s || !canManageMall(req, res, s, doctorId)) return;
    try {
      json(res, 200, { data: svc.masterData.createOpsTemplate(b) });
    } catch (error) {
      mallError(res, error);
    }
  });

  route("GET", /^\/api\/admin\/mall\/ops-templates\/(\d+)$/, (req, res, m, q) => {
    const doctorId = +(q && q.doctorId);
    const s = gate(req, res, doctorId);
    if (!s) return;
    const data = svc.masterData.getOpsTemplate(+m[1], doctorId);
    if (!data) return json(res, 404, { error: "运营模板不存在" });
    json(res, 200, { data });
  });

  route("PUT", /^\/api\/admin\/mall\/ops-templates\/(\d+)$/, async (req, res, m) => {
    const b = (await parseBody(req)) || {};
    const doctorId = +b.doctorId;
    const s = gate(req, res, doctorId);
    if (!s || !canManageMall(req, res, s, doctorId)) return;
    try {
      json(res, 200, { data: svc.masterData.saveOpsDraft(+m[1], b) });
    } catch (error) {
      mallError(res, error);
    }
  });

  route("POST", /^\/api\/admin\/mall\/ops-templates\/(\d+)\/publish$/, async (req, res, m) => {
    const b = (await parseBody(req)) || {};
    const doctorId = +b.doctorId;
    const s = gate(req, res, doctorId);
    if (!s || !canManageMall(req, res, s, doctorId)) return;
    const existing = svc.masterData.getOpsTemplate(+m[1], doctorId);
    if (!existing) return json(res, 404, { error: "运营模板不存在" });
    try {
      json(res, 200, { data: svc.masterData.publishOpsVersion(+m[1], b.versionNo) });
    } catch (error) {
      mallError(res, error);
    }
  });

  route("POST", /^\/api\/admin\/mall\/ops-templates\/(\d+)\/disable$/, async (req, res, m) => {
    const b = (await parseBody(req)) || {};
    const doctorId = +b.doctorId;
    const s = gate(req, res, doctorId);
    if (!s || !canManageMall(req, res, s, doctorId)) return;
    const existing = svc.masterData.getOpsTemplate(+m[1], doctorId);
    if (!existing) return json(res, 404, { error: "运营模板不存在" });
    try {
      json(res, 200, { data: svc.masterData.disableOpsTemplate(+m[1]) });
    } catch (error) {
      mallError(res, error);
    }
  });

  route("GET", /^\/api\/admin\/mall\/goods-skus$/, (req, res, m, q) => {
    const s = gate(req, res);
    if (!s) return;
    json(res, 200, { data: svc.masterData.listGoodsSkus(q || {}) });
  });

  route("POST", /^\/api\/admin\/mall\/goods-skus$/, async (req, res) => {
    const s = gate(req, res);
    if (!s || !canManageMall(req, res, s)) return;
    const b = await parseBody(req);
    try {
      json(res, 200, { data: svc.masterData.createGoodsSku(b || {}) });
    } catch (error) {
      mallError(res, error);
    }
  });

  route("GET", /^\/api\/admin\/mall\/goods-skus\/(\d+)$/, (req, res, m) => {
    const s = gate(req, res);
    if (!s) return;
    const data = svc.masterData.getGoodsSku(+m[1]);
    if (!data) return json(res, 404, { error: "实物 SKU 不存在" });
    json(res, 200, { data });
  });

  route("PUT", /^\/api\/admin\/mall\/goods-skus\/(\d+)$/, async (req, res, m) => {
    const s = gate(req, res);
    if (!s || !canManageMall(req, res, s)) return;
    const b = await parseBody(req);
    try {
      json(res, 200, { data: svc.masterData.updateGoodsSku(+m[1], b || {}) });
    } catch (error) {
      mallError(res, error);
    }
  });

  route("POST", /^\/api\/admin\/mall\/goods-skus\/(\d+)\/inventory-adjustments$/, async (req, res, m) => {
    const s = gate(req, res);
    if (!s || !canManageMall(req, res, s)) return;
    const b = await parseBody(req);
    try {
      json(res, 200, { data: svc.masterData.adjustInventory(+m[1], b || {}) });
    } catch (error) {
      mallError(res, error);
    }
  });

  route("POST", /^\/api\/admin\/mall\/goods-skus\/(\d+)\/disable$/, (req, res, m) => {
    const s = gate(req, res);
    if (!s || !canManageMall(req, res, s)) return;
    try {
      json(res, 200, { data: svc.masterData.disableGoodsSku(+m[1]) });
    } catch (error) {
      mallError(res, error);
    }
  });

  /* ---------- SPU / 销售 SKU / BOM ---------- */
  route("GET", /^\/api\/admin\/mall\/spus$/, (req, res, m, q) => {
    const doctorId = +(q && q.doctorId);
    const s = gate(req, res, doctorId);
    if (!s) return;
    try {
      json(res, 200, { data: svc.mallProducts.listSpus({ ...(q || {}), doctorId }) });
    } catch (error) {
      mallError(res, error);
    }
  });

  route("POST", /^\/api\/admin\/mall\/spus$/, async (req, res) => {
    const b = (await parseBody(req)) || {};
    const doctorId = +b.doctorId;
    const s = gate(req, res, doctorId);
    if (!s || !canManageMall(req, res, s, doctorId)) return;
    try {
      json(res, 200, { data: svc.mallProducts.createSpu(b) });
    } catch (error) {
      mallError(res, error);
    }
  });

  route("GET", /^\/api\/admin\/mall\/spus\/(\d+)$/, (req, res, m, q) => {
    const doctorId = +(q && q.doctorId);
    const s = gate(req, res, doctorId);
    if (!s) return;
    const data = svc.mallProducts.getSpu(+m[1], doctorId);
    if (!data) return json(res, 404, { error: "SPU 不存在" });
    json(res, 200, { data });
  });

  route("PUT", /^\/api\/admin\/mall\/spus\/(\d+)$/, async (req, res, m) => {
    const existing = svc.mallProducts.getSpu(+m[1]);
    if (!existing) return json(res, 404, { error: "SPU 不存在" });
    const s = gate(req, res, existing.doctorId);
    if (!s || !canManageMall(req, res, s, existing.doctorId)) return;
    const b = await parseBody(req);
    try {
      json(res, 200, { data: svc.mallProducts.updateSpu(+m[1], b || {}) });
    } catch (error) {
      mallError(res, error);
    }
  });

  route("POST", /^\/api\/admin\/mall\/spus\/cover-upload$/, async (req, res) => {
    const b = await parseBody(req, MALL_COVER_MAX_BODY);
    if (b.__oversize) return json(res, 413, { error: "图片过大（上限 6MB）" });
    const doctorId = +b.doctorId;
    const s = gate(req, res, doctorId);
    if (!s || !canManageMall(req, res, s, doctorId)) return;
    if (!Number.isInteger(doctorId) || doctorId <= 0) return json(res, 400, { error: "缺少 doctorId" });
    const raw = String(b.imageDataUrl || b.dataUrl || "").trim();
    const m = raw.match(/^data:(image\/(?:jpeg|jpg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/i);
    if (!m) return json(res, 400, { error: "图片格式仅支持 JPEG/PNG/WebP" });
    const mime = m[1].toLowerCase().replace("image/jpg", "image/jpeg");
    const buf = Buffer.from(m[2].replace(/\s+/g, ""), "base64");
    if (!buf.length) return json(res, 400, { error: "图片内容为空" });
    if (buf.length > 5 * 1024 * 1024) return json(res, 400, { error: "图片过大（≤5MB）" });
    const ext = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
    const dir = path.join(__dirname, "..", "public", "uploads", "mall-covers");
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (e) {}
    const fileName = `spu-${doctorId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const abs = path.join(dir, fileName);
    try {
      fs.writeFileSync(abs, buf);
    } catch (e) {
      return json(res, 500, { error: "图片保存失败：" + ((e && e.message) || "") });
    }
    json(res, 200, { data: { url: `/uploads/mall-covers/${fileName}` } });
  });

  route("GET", /^\/api\/admin\/mall\/spus\/(\d+)\/skus$/, (req, res, m, q) => {
    const existing = svc.mallProducts.getSpu(+m[1]);
    if (!existing) return json(res, 404, { error: "SPU 不存在" });
    const s = gate(req, res, existing.doctorId);
    if (!s) return;
    try {
      json(res, 200, { data: svc.mallProducts.listSkus(+m[1], q || {}) });
    } catch (error) {
      mallError(res, error);
    }
  });

  route("POST", /^\/api\/admin\/mall\/spus\/(\d+)\/skus$/, async (req, res, m) => {
    const existing = svc.mallProducts.getSpu(+m[1]);
    if (!existing) return json(res, 404, { error: "SPU 不存在" });
    const s = gate(req, res, existing.doctorId);
    if (!s || !canManageMall(req, res, s, existing.doctorId)) return;
    const b = await parseBody(req);
    try {
      json(res, 200, { data: svc.mallProducts.createSku(+m[1], b || {}) });
    } catch (error) {
      mallError(res, error);
    }
  });

  route("GET", /^\/api\/admin\/mall\/skus\/(\d+)$/, (req, res, m) => {
    const data = svc.mallProducts.getSku(+m[1]);
    if (!data) return json(res, 404, { error: "SKU 不存在" });
    const s = gate(req, res, data.spu.doctorId);
    if (!s) return;
    json(res, 200, { data });
  });

  route("PUT", /^\/api\/admin\/mall\/skus\/(\d+)$/, async (req, res, m) => {
    const existing = svc.mallProducts.getSku(+m[1]);
    if (!existing) return json(res, 404, { error: "SKU 不存在" });
    const s = gate(req, res, existing.spu.doctorId);
    if (!s || !canManageMall(req, res, s, existing.spu.doctorId)) return;
    const b = await parseBody(req);
    try {
      json(res, 200, { data: svc.mallProducts.updateSku(+m[1], b || {}) });
    } catch (error) {
      mallError(res, error);
    }
  });

  route("PUT", /^\/api\/admin\/mall\/skus\/(\d+)\/components$/, async (req, res, m) => {
    const existing = svc.mallProducts.getSku(+m[1]);
    if (!existing) return json(res, 404, { error: "SKU 不存在" });
    const s = gate(req, res, existing.spu.doctorId);
    if (!s || !canManageMall(req, res, s, existing.spu.doctorId)) return;
    const b = (await parseBody(req)) || {};
    try {
      json(res, 200, { data: svc.mallProducts.replaceComponents(+m[1], b.components || []) });
    } catch (error) {
      mallError(res, error);
    }
  });

  route("GET", /^\/api\/admin\/mall\/skus\/(\d+)\/cost-quote$/, (req, res, m, q) => {
    const existing = svc.mallProducts.getSku(+m[1]);
    if (!existing) return json(res, 404, { error: "SKU 不存在" });
    const s = gate(req, res, existing.spu.doctorId);
    if (!s) return;
    try {
      json(res, 200, { data: svc.mallProducts.quoteCost(+m[1], q && q.discountCents) });
    } catch (error) {
      mallError(res, error);
    }
  });

  route("GET", /^\/api\/admin\/mall\/skus\/(\d+)\/publish-check$/, (req, res, m) => {
    const existing = svc.mallProducts.getSku(+m[1]);
    if (!existing) return json(res, 404, { error: "SKU 不存在" });
    const s = gate(req, res, existing.spu.doctorId);
    if (!s) return;
    try {
      json(res, 200, { data: svc.mallProducts.validatePublish(+m[1]) });
    } catch (error) {
      mallError(res, error);
    }
  });

  for (const action of ["publish", "offline"]) {
    route("POST", new RegExp(`^/api/admin/mall/skus/(\\d+)/${action}$`), (req, res, m) => {
      const existing = svc.mallProducts.getSku(+m[1]);
      if (!existing) return json(res, 404, { error: "SKU 不存在" });
      const s = gate(req, res, existing.spu.doctorId);
      if (!s || !canManageMall(req, res, s, existing.spu.doctorId)) return;
      try {
        const data = action === "publish" ? svc.mallProducts.publishSku(+m[1]) : svc.mallProducts.offlineSku(+m[1]);
        json(res, 200, { data });
      } catch (error) {
        mallError(res, error);
      }
    });
  }

  for (const action of ["publish", "offline"]) {
    route("POST", new RegExp(`^/api/admin/mall/spus/(\\d+)/${action}$`), (req, res, m) => {
      const existing = svc.mallProducts.getSpu(+m[1]);
      if (!existing) return json(res, 404, { error: "SPU 不存在" });
      const s = gate(req, res, existing.doctorId);
      if (!s || !canManageMall(req, res, s, existing.doctorId)) return;
      try {
        const data = action === "publish" ? svc.mallProducts.publishSpu(+m[1]) : svc.mallProducts.offlineSpu(+m[1]);
        json(res, 200, { data });
      } catch (error) {
        mallError(res, error);
      }
    });
  }

  /* ---------- 服务组件 ---------- */
  route("GET", /^\/api\/admin\/service-components$/, (req, res, m, q) => {
    const s = gate(req, res);
    if (!s) return;
    json(res, 200, {
      data: svc.components.list({ type: q.type || undefined, status: q.status || undefined }),
    });
  });

  route("POST", /^\/api\/admin\/service-components$/, async (req, res) => {
    const s = gate(req, res);
    if (!s) return;
    if (!requireAdminAction(req, res, s, "service_products.manage", null, "无服务包商品管理权限"))
      return;
    const b = await parseBody(req);
    try {
      const component = svc.components.create(b || {});
      json(res, 200, { data: component });
    } catch (e) {
      json(res, e.code === "validation" ? 400 : 400, { error: e.message });
    }
  });

  route("PUT", /^\/api\/admin\/service-components\/(\d+)$/, async (req, res, m) => {
    const existing = svc.components.getById(+m[1]);
    if (!existing) return json(res, 404, { error: "服务组件不存在" });
    const s = gate(req, res);
    if (!s) return;
    if (!requireAdminAction(req, res, s, "service_products.manage", null, "无服务包商品管理权限"))
      return;
    const b = await parseBody(req);
    try {
      const component = svc.components.update(+m[1], b || {});
      json(res, 200, { data: component });
    } catch (e) {
      json(res, e.code === "not_found" ? 404 : 400, { error: e.message });
    }
  });

  route("POST", /^\/api\/admin\/service-components\/(\d+)\/disable$/, async (req, res, m) => {
    const existing = svc.components.getById(+m[1]);
    if (!existing) return json(res, 404, { error: "服务组件不存在" });
    const s = gate(req, res);
    if (!s) return;
    if (!requireAdminAction(req, res, s, "service_products.manage", null, "无服务包商品管理权限"))
      return;
    try {
      const component = svc.components.disable(+m[1]);
      json(res, 200, { data: component });
    } catch (e) {
      json(res, e.code === "not_found" ? 404 : 400, { error: e.message });
    }
  });

  /* ---------- 商品管理 ---------- */
  route("GET", /^\/api\/admin\/service-products$/, (req, res, m, q) => {
    const did = +q.doctorId;
    const s = gate(req, res, did);
    if (!s) return;
    json(res, 200, { data: svc.adminProducts.list(did) });
  });

  route("GET", /^\/api\/admin\/service-products\/(\d+)$/, (req, res, m) => {
    const detail = svc.adminProducts.detail(+m[1]);
    if (!detail) return json(res, 404, { error: "商品不存在" });
    const s = gate(req, res, detail.product.doctorId);
    if (!s) return;
    json(res, 200, { data: detail });
  });

  route("POST", /^\/api\/admin\/service-products$/, async (req, res) => {
    const b = await parseBody(req);
    const did = +(b && b.doctorId);
    const s = gate(req, res, did);
    if (!s) return;
    if (!requireAdminAction(req, res, s, "service_products.manage", { doctorId: did }, "无服务包商品管理权限"))
      return;
    try {
      const data = svc.adminProducts.create(did, b || {});
      json(res, 200, { data });
    } catch (e) {
      json(res, e.code === "validation" ? 400 : 400, { error: e.message });
    }
  });

  route("PUT", /^\/api\/admin\/service-products\/(\d+)$/, async (req, res, m) => {
    const existing = svc.adminProducts.detail(+m[1]);
    if (!existing) return json(res, 404, { error: "商品不存在" });
    const s = gate(req, res, existing.product.doctorId);
    if (!s) return;
    if (!requireAdminAction(req, res, s, "service_products.manage", { doctorId: existing.product.doctorId }, "无服务包商品管理权限"))
      return;
    const b = await parseBody(req);
    try {
      const data = svc.adminProducts.update(+m[1], b || {});
      json(res, 200, { data });
    } catch (e) {
      json(res, 400, { error: e.message });
    }
  });

  route("POST", /^\/api\/admin\/service-products\/(\d+)\/publish$/, async (req, res, m) => {
    const existing = svc.adminProducts.detail(+m[1]);
    if (!existing) return json(res, 404, { error: "商品不存在" });
    const s = gate(req, res, existing.product.doctorId);
    if (!s) return;
    if (!requireAdminAction(req, res, s, "service_products.manage", { doctorId: existing.product.doctorId }, "无服务包商品管理权限"))
      return;
    try {
      const data = svc.adminProducts.publish(+m[1]);
      json(res, 200, { data });
    } catch (e) {
      json(res, 400, { error: e.message });
    }
  });

  route("POST", /^\/api\/admin\/service-products\/(\d+)\/offline$/, async (req, res, m) => {
    const existing = svc.adminProducts.detail(+m[1]);
    if (!existing) return json(res, 404, { error: "商品不存在" });
    const s = gate(req, res, existing.product.doctorId);
    if (!s) return;
    if (!requireAdminAction(req, res, s, "service_products.manage", { doctorId: existing.product.doctorId }, "无服务包商品管理权限"))
      return;
    try {
      const data = svc.adminProducts.offline(+m[1]);
      json(res, 200, { data });
    } catch (e) {
      json(res, 400, { error: e.message });
    }
  });

  route("POST", /^\/api\/admin\/service-products\/(\d+)\/reassign$/, async (req, res, m) => {
    const existing = svc.adminProducts.detail(+m[1]);
    if (!existing) return json(res, 404, { error: "商品不存在" });
    const b = await parseBody(req);
    const toDoctorId = +(b && b.doctorId);
    const sFrom = gate(req, res, existing.product.doctorId);
    if (!sFrom) return;
    if (
      !requireAdminAction(
        req,
        res,
        sFrom,
        "service_products.manage",
        { doctorId: existing.product.doctorId },
        "无服务包商品管理权限"
      )
    )
      return;
    const sTo = gate(req, res, toDoctorId);
    if (!sTo) return;
    if (
      !requireAdminAction(
        req,
        res,
        sTo,
        "service_products.manage",
        { doctorId: toDoctorId },
        "无目标医生的服务包商品管理权限"
      )
    )
      return;
    try {
      const data = svc.adminProducts.reassignDoctor(+m[1], toDoctorId);
      json(res, 200, { data });
    } catch (e) {
      const code = e.code === "not_found" ? 404 : 400;
      json(res, code, { error: e.message });
    }
  });

  /* ---------- 优惠券模板 / 发放 ---------- */
  route("GET", /^\/api\/admin\/coupon-templates$/, (req, res, m, q) => {
    const did = q.doctorId ? +q.doctorId : null;
    const s = did ? gate(req, res, did) : gate(req, res);
    if (!s) return;
    json(res, 200, {
      data: svc.adminCoupons.listTemplates({
        doctorId: did || undefined,
        status: q.status || undefined,
      }),
    });
  });

  route("GET", /^\/api\/admin\/coupon-templates\/(\d+)$/, (req, res, m) => {
    const tpl = svc.adminCoupons.getTemplate(+m[1]);
    if (!tpl) return json(res, 404, { error: "优惠券模板不存在" });
    const s = gate(req, res, tpl.doctorId);
    if (!s) return;
    json(res, 200, { data: tpl });
  });

  route("POST", /^\/api\/admin\/coupon-templates$/, async (req, res) => {
    const b = await parseBody(req);
    const did = +(b && b.doctorId);
    const s = gate(req, res, did);
    if (!s) return;
    if (!requireAdminAction(req, res, s, "service_products.manage", { doctorId: did }, "无服务包商品管理权限"))
      return;
    try {
      const data = svc.adminCoupons.create(b || {});
      json(res, 200, { data });
    } catch (e) {
      json(res, e.code === "not_found" ? 404 : 400, { error: e.message });
    }
  });

  route("PUT", /^\/api\/admin\/coupon-templates\/(\d+)$/, async (req, res, m) => {
    const existing = svc.adminCoupons.getTemplate(+m[1]);
    if (!existing) return json(res, 404, { error: "优惠券模板不存在" });
    const s = gate(req, res, existing.doctorId);
    if (!s) return;
    if (
      !requireAdminAction(
        req,
        res,
        s,
        "service_products.manage",
        { doctorId: existing.doctorId },
        "无服务包商品管理权限"
      )
    )
      return;
    const b = await parseBody(req);
    try {
      const data = svc.adminCoupons.update(+m[1], b || {});
      json(res, 200, { data });
    } catch (e) {
      json(res, e.code === "not_found" ? 404 : 400, { error: e.message });
    }
  });

  route("POST", /^\/api\/admin\/coupon-templates\/(\d+)\/publish$/, async (req, res, m) => {
    const existing = svc.adminCoupons.getTemplate(+m[1]);
    if (!existing) return json(res, 404, { error: "优惠券模板不存在" });
    const s = gate(req, res, existing.doctorId);
    if (!s) return;
    if (
      !requireAdminAction(
        req,
        res,
        s,
        "service_products.manage",
        { doctorId: existing.doctorId },
        "无服务包商品管理权限"
      )
    )
      return;
    try {
      const data = svc.adminCoupons.publish(+m[1]);
      json(res, 200, { data });
    } catch (e) {
      json(res, 400, { error: e.message });
    }
  });

  route("POST", /^\/api\/admin\/coupon-templates\/(\d+)\/offline$/, async (req, res, m) => {
    const existing = svc.adminCoupons.getTemplate(+m[1]);
    if (!existing) return json(res, 404, { error: "优惠券模板不存在" });
    const s = gate(req, res, existing.doctorId);
    if (!s) return;
    if (
      !requireAdminAction(
        req,
        res,
        s,
        "service_products.manage",
        { doctorId: existing.doctorId },
        "无服务包商品管理权限"
      )
    )
      return;
    try {
      const data = svc.adminCoupons.offline(+m[1]);
      json(res, 200, { data });
    } catch (e) {
      json(res, 400, { error: e.message });
    }
  });

  route("POST", /^\/api\/admin\/coupon-templates\/(\d+)\/grant$/, async (req, res, m) => {
    const existing = svc.adminCoupons.getTemplate(+m[1]);
    if (!existing) return json(res, 404, { error: "优惠券模板不存在" });
    const s = gate(req, res, existing.doctorId);
    if (!s) return;
    if (
      !requireAdminAction(
        req,
        res,
        s,
        "service_products.manage",
        { doctorId: existing.doctorId },
        "无服务包商品管理权限"
      )
    )
      return;
    const b = await parseBody(req);
    try {
      const data = svc.adminCoupons.grant({
        templateId: +m[1],
        personId: b && b.personId,
      });
      json(res, 200, { data });
    } catch (e) {
      json(res, e.code === "not_found" ? 404 : 400, { error: e.message });
    }
  });

  route("GET", /^\/api\/admin\/coupon-templates\/(\d+)\/codes$/, (req, res, m, q) => {
    const existing = svc.adminCoupons.getTemplate(+m[1]);
    if (!existing) return json(res, 404, { error: "优惠券模板不存在" });
    const s = gate(req, res, existing.doctorId);
    if (!s) return;
    try {
      const codes = svc.adminCoupons.listCodes(+m[1], { limit: q.limit });
      json(res, 200, { data: { codes } });
    } catch (e) {
      json(res, e.code === "not_found" ? 404 : 400, { error: e.message });
    }
  });

  route("POST", /^\/api\/admin\/coupon-templates\/(\d+)\/codes$/, async (req, res, m) => {
    const existing = svc.adminCoupons.getTemplate(+m[1]);
    if (!existing) return json(res, 404, { error: "优惠券模板不存在" });
    const s = gate(req, res, existing.doctorId);
    if (!s) return;
    if (
      !requireAdminAction(
        req,
        res,
        s,
        "service_products.manage",
        { doctorId: existing.doctorId },
        "无服务包商品管理权限"
      )
    )
      return;
    const b = await parseBody(req);
    try {
      const data = svc.adminCoupons.generateCodes(+m[1], b || {});
      json(res, 200, { data });
    } catch (e) {
      json(res, e.code === "not_found" ? 404 : 400, { error: e.message });
    }
  });

  route("POST", /^\/api\/admin\/coupon-codes\/(\d+)\/disable$/, async (req, res, m) => {
    const code = svc.adminCoupons.getCode(+m[1]);
    if (!code) return json(res, 404, { error: "兑换码不存在" });
    const tpl = svc.adminCoupons.getTemplate(code.templateId);
    if (!tpl) return json(res, 404, { error: "优惠券模板不存在" });
    const s = gate(req, res, tpl.doctorId);
    if (!s) return;
    if (
      !requireAdminAction(
        req,
        res,
        s,
        "service_products.manage",
        { doctorId: tpl.doctorId },
        "无服务包商品管理权限"
      )
    )
      return;
    try {
      const data = svc.adminCoupons.disableCode(+m[1]);
      json(res, 200, { data });
    } catch (e) {
      json(res, e.code === "not_found" ? 404 : 400, { error: e.message });
    }
  });

  route("GET", /^\/api\/admin\/coupons$/, (req, res, m, q) => {
    const did = q.doctorId ? +q.doctorId : null;
    const s = did ? gate(req, res, did) : gate(req, res);
    if (!s) return;
    json(res, 200, {
      data: svc.adminCoupons.listCoupons({
        doctorId: did || undefined,
        status: q.status || undefined,
        personId: q.personId || undefined,
        limit: q.limit,
      }),
    });
  });

  /* ---------- 售后工单 ---------- */
  route("GET", /^\/api\/admin\/after-sales$/, (req, res, m, q) => {
    const did = q.doctorId ? +q.doctorId : null;
    const s = did ? gate(req, res, did) : gate(req, res);
    if (!s) return;
    const rows = svc.afterSales.listAdmin({
      doctorId: did || undefined,
      status: q.status || undefined,
      limit: q.limit,
    });
    json(res, 200, { data: rows });
  });

  route("GET", /^\/api\/admin\/after-sales\/(\d+)$/, (req, res, m) => {
    const ticket = svc.afterSales.getById(+m[1]);
    if (!ticket) return json(res, 404, { error: "售后工单不存在" });
    const s = gate(req, res, ticket.doctorId);
    if (!s) return;
    json(res, 200, { data: ticket });
  });

  route("POST", /^\/api\/admin\/after-sales\/(\d+)\/approve$/, async (req, res, m) => {
    const ticket = svc.afterSales.getById(+m[1]);
    if (!ticket) return json(res, 404, { error: "售后工单不存在" });
    const s = gate(req, res, ticket.doctorId);
    if (!s) return;
    if (
      !requireAdminAction(
        req,
        res,
        s,
        "service_orders.review",
        { doctorId: ticket.doctorId },
        "无服务订单审核权限"
      )
    )
      return;
    const b = await parseBody(req);
    try {
      const approved = await svc.afterSales.approve(+m[1], {
        adminId: s.adminId || s.id,
        adminNote: (b && b.note) || "",
      });
      json(res, 200, { data: { ticket: approved } });
    } catch (e) {
      json(res, e.code === "not_found" ? 404 : 400, { error: e.message });
    }
  });

  route("POST", /^\/api\/admin\/after-sales\/(\d+)\/reject$/, async (req, res, m) => {
    const ticket = svc.afterSales.getById(+m[1]);
    if (!ticket) return json(res, 404, { error: "售后工单不存在" });
    const s = gate(req, res, ticket.doctorId);
    if (!s) return;
    if (
      !requireAdminAction(
        req,
        res,
        s,
        "service_orders.review",
        { doctorId: ticket.doctorId },
        "无服务订单审核权限"
      )
    )
      return;
    const b = await parseBody(req);
    try {
      const rejected = svc.afterSales.reject(+m[1], {
        adminNote: (b && b.note) || "",
      });
      json(res, 200, { data: { ticket: rejected } });
    } catch (e) {
      json(res, e.code === "not_found" ? 404 : 400, { error: e.message });
    }
  });

  /* ---------- 权益管理 ---------- */

  function entitlementAdminHttpStatus(code) {
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

  route("GET", /^\/api\/admin\/service-entitlements$/, (req, res, m, q) => {
    const did = q.doctorId ? +q.doctorId : null;
    const s = did ? gate(req, res, did) : gate(req, res);
    if (!s) return;
    const rows = svc.entitlements.listAdmin({
      doctorId: did || undefined,
      personId: q.personId ? +q.personId : undefined,
      status: q.status || undefined,
      limit: q.limit,
      offset: q.offset,
    });
    json(res, 200, { data: rows });
  });

  route("GET", /^\/api\/admin\/service-entitlements\/(\d+)$/, (req, res, m) => {
    const ent = db
      .prepare(`SELECT * FROM svc_entitlements WHERE id=?`)
      .get(+m[1]);
    if (!ent) return json(res, 404, { error: "权益不存在" });
    const s = gate(req, res, ent.doctor_id);
    if (!s) return;
    const entitlement = svc.entitlements.mapEntitlement
      ? svc.entitlements.mapEntitlement(ent)
      : svc.entitlements.getForPerson(+m[1], ent.person_id);
    json(res, 200, { data: entitlement });
  });

  route("POST", /^\/api\/admin\/entitlement-usages\/(\d+)\/complete$/, async (req, res, m) => {
    const usage = db
      .prepare(`SELECT * FROM svc_entitlement_usages WHERE id=?`)
      .get(+m[1]);
    if (!usage) return json(res, 404, { error: "使用记录不存在" });
    const ent = db
      .prepare(`SELECT * FROM svc_entitlements WHERE id=?`)
      .get(+usage.entitlement_id);
    if (!ent) return json(res, 404, { error: "权益记录不存在" });
    const s = gate(req, res, ent.doctor_id);
    if (!s) return;
    if (
      !requireAdminAction(
        req,
        res,
        s,
        "service_orders.review",
        { doctorId: ent.doctor_id },
        "无服务订单审核权限"
      )
    )
      return;
    try {
      const completed = svc.entitlements.completeUsage(+m[1], {
        type: "admin",
        id: s.adminId || s.id,
      });
      json(res, 200, { data: completed });
    } catch (e) {
      json(res, entitlementAdminHttpStatus(e.code), { error: e.message, code: e.code });
    }
  });
}

module.exports = { registerServicePackageAdminRoutes };
