"use strict";

const { nowIso } = require("./schema.js");
const { normalizeBenefitItems, insertVersionItems, listVersionItems } = require("./benefitItems.js");

const VALID_CATEGORIES = ["rehab", "followup", "other"];

function normalizeCategory(body) {
  const raw = String(body.category || "").trim();
  return VALID_CATEGORIES.includes(raw) ? raw : "rehab";
}

function createAdminProducts(db, catalog) {
  function list(doctorId) {
    const rows = db
      .prepare(
        `SELECT p.*, v.title AS version_title, v.cover AS version_cover, v.total_amount_cents, v.service_days, v.version_no, v.published_at
         FROM svc_products p
         LEFT JOIN svc_product_versions v ON v.id = p.current_version_id
         WHERE p.doctor_id=?
         ORDER BY p.id DESC`
      )
      .all(+doctorId);
    return rows.map((r) => ({
      id: r.id,
      doctorId: r.doctor_id,
      slug: r.slug,
      status: r.status,
      category: r.category || "rehab",
      cover: r.version_cover || "",
      currentVersionId: r.current_version_id,
      title: r.version_title || r.slug,
      totalAmount: r.total_amount_cents != null ? r.total_amount_cents / 100 : null,
      serviceDays: r.service_days,
      versionNo: r.version_no,
      publishedAt: r.published_at,
      costCents: r.cost_cents,
      listPriceCents: r.list_price_cents,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  function detail(productId) {
    const p = db.prepare(`SELECT * FROM svc_products WHERE id=?`).get(+productId);
    if (!p) return null;
    const versions = db
      .prepare(`SELECT * FROM svc_product_versions WHERE product_id=? ORDER BY version_no DESC`)
      .all(+productId)
      .map((v) => {
        const dto = catalog.mapVersionRow(v, db.prepare(`SELECT id,name,hospital,dept FROM doctors WHERE id=?`).get(p.doctor_id));
        dto.benefitItems = listVersionItems(db, v.id);
        dto.costCents = v.cost_cents;
        dto.listPriceCents = v.list_price_cents;
        return dto;
      });
    const current = p.current_version_id
      ? catalog.getPublishedByVersionId(p.current_version_id) ||
        versions.find((x) => x.versionId === p.current_version_id) ||
        null
      : versions[0] || null;
    // 确保 current 也带上成本（catalog.getPublishedByVersionId 返回的 DTO 不带成本）
    if (current && (current.costCents === undefined)) {
      const cv = db.prepare(`SELECT cost_cents, list_price_cents FROM svc_product_versions WHERE id=?`).get(current.versionId);
      if (cv) {
        current.costCents = cv.cost_cents;
        current.listPriceCents = cv.list_price_cents;
      }
    }
    return {
      product: {
        id: p.id,
        doctorId: p.doctor_id,
        slug: p.slug,
        status: p.status,
        category: p.category || "rehab",
        currentVersionId: p.current_version_id,
        costCents: p.cost_cents,
        listPriceCents: p.list_price_cents,
        createdAt: p.created_at,
        updatedAt: p.updated_at,
      },
      current,
      versions,
    };
  }

  function normalizeBody(body) {
    const title = String(body.title || "").trim();
    if (!title) {
      const err = new Error("请填写商品名称");
      err.code = "validation";
      throw err;
    }
    const serviceAmount = Math.round(Number(body.serviceAmount != null ? body.serviceAmount : 0) * 100);
    const goodsAmount = Math.round(Number(body.goodsAmount != null ? body.goodsAmount : 0) * 100);
    const shippingAmount = Math.round(Number(body.shippingAmount != null ? body.shippingAmount : 0) * 100);
    const totalAmount =
      body.totalAmount != null
        ? Math.round(Number(body.totalAmount) * 100)
        : serviceAmount + goodsAmount + shippingAmount;
    if (totalAmount !== serviceAmount + goodsAmount + shippingAmount) {
      const err = new Error("总价必须等于服务金额+实物金额+运费");
      err.code = "validation";
      throw err;
    }
    const costCents = Math.round(Number(body.cost != null ? body.cost : 0) * 100);
    if (costCents < 0) {
      const err = new Error("成本不能为负数");
      err.code = "validation";
      throw err;
    }
    const listPriceCents = Math.round(Number(body.listPrice != null ? body.listPrice : 0) * 100);
    if (listPriceCents < 0) {
      const err = new Error("划线价不能为负数");
      err.code = "validation";
      throw err;
    }
    if (listPriceCents > 0 && listPriceCents < totalAmount) {
      const err = new Error("划线价必须大于等于售价");
      err.code = "validation";
      throw err;
    }
    return {
      title,
      subtitle: String(body.subtitle || body.desc || "").trim(),
      cover: String(body.cover || "").trim(),
      serviceDays: Math.max(1, Number(body.serviceDays) || 30),
      eligible: Array.isArray(body.eligible) ? body.eligible : String(body.eligibleText || "").split(/\n+/).map((s) => s.trim()).filter(Boolean),
      ineligible: Array.isArray(body.ineligible) ? body.ineligible : String(body.ineligibleText || "").split(/\n+/).map((s) => s.trim()).filter(Boolean),
      contents: Array.isArray(body.contents)
        ? body.contents
        : String(body.contentsText || "术后第 1 天：伤口观察与休息要点")
            .split(/\n+/)
            .map((s) => s.trim())
            .filter(Boolean)
            .map((title, idx) => ({ dayOffset: idx === 0 ? 0 : idx, kind: "content", title, required: idx === 0 })),
      assessments: Array.isArray(body.assessments)
        ? body.assessments
        : String(body.assessmentsText || "")
            .split(/\n+/)
            .map((s) => s.trim())
            .filter(Boolean)
            .map((title) => ({ title, dayOffset: 7 })),
      goods: Array.isArray(body.goods)
        ? body.goods
        : String(body.goodsText || "")
            .split(/\n+/)
            .map((s) => s.trim())
            .filter(Boolean)
            .map((name) => ({ name, qty: 1 })),
      consultationNote: String(body.consultationNote || "问诊需在春雨 APP 单独下单支付").trim(),
      refundPolicy: String(body.refundPolicy || "开通审核不通过原路全额退款；开通后按已交付内容人工核算。").trim(),
      serviceAmountCents: serviceAmount,
      goodsAmountCents: goodsAmount,
      shippingAmountCents: shippingAmount,
      totalAmountCents: totalAmount,
      agreementVersion: String(body.agreementVersion || "svc-agreement-v1"),
      privacyConsentVersion: String(body.privacyConsentVersion || "svc-privacy-v1"),
      refundPolicyVersion: String(body.refundPolicyVersion || "svc-refund-v1"),
      benefitItems: Array.isArray(body.benefitItems) ? body.benefitItems : [],
      costCents,
      listPriceCents,
    };
  }

  function insertVersion(productId, versionNo, n, publishedAt) {
    const ts = nowIso();
    const info = db
      .prepare(
        `INSERT INTO svc_product_versions(
          product_id, version_no, title, subtitle, cover, service_days,
          eligible_json, ineligible_json,
          service_amount_cents, goods_amount_cents, shipping_amount_cents, total_amount_cents,
          content_json, assessment_json, consultation_json, goods_json,
          refund_policy, agreement_version, privacy_consent_version, refund_policy_version,
          cost_cents, list_price_cents,
          published_at, created_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      )
      .run(
        +productId,
        versionNo,
        n.title,
        n.subtitle,
        n.cover,
        n.serviceDays,
        JSON.stringify(n.eligible),
        JSON.stringify(n.ineligible),
        n.serviceAmountCents,
        n.goodsAmountCents,
        n.shippingAmountCents,
        n.totalAmountCents,
        JSON.stringify(n.contents),
        JSON.stringify(n.assessments),
        JSON.stringify({ note: n.consultationNote, independentPay: true }),
        JSON.stringify(n.goods),
        n.refundPolicy,
        n.agreementVersion,
        n.privacyConsentVersion,
        n.refundPolicyVersion,
        n.costCents,
        n.listPriceCents,
        publishedAt,
        ts
      );
    return Number(info.lastInsertRowid);
  }

  function create(doctorId, body) {
    const n = normalizeBody(body);
    const slug =
      String(body.slug || "")
        .trim()
        .replace(/[^a-zA-Z0-9-_]/g, "-")
        .replace(/-+/g, "-")
        .toLowerCase() || `pkg-${Date.now()}`;
    const ts = nowIso();
    const category = normalizeCategory(body);
    const publishNow = body.publish === true || body.status === "published";
    if (publishNow && n.costCents <= 0) {
      const err = new Error("上架前请填写成本");
      err.code = "validation";
      throw err;
    }
    const info = db
      .prepare(
        `INSERT INTO svc_products(doctor_id, slug, status, category, current_version_id, cost_cents, list_price_cents, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?)`
      )
      .run(+doctorId, slug, publishNow ? "published" : "draft", category, null, n.costCents, n.listPriceCents, ts, ts);
    const productId = Number(info.lastInsertRowid);
    const versionId = insertVersion(productId, 1, n, publishNow ? ts : null);
    if (n.benefitItems.length > 0) {
      const normalized = normalizeBenefitItems(db, n.benefitItems);
      insertVersionItems(db, versionId, normalized);
    }
    db.prepare(`UPDATE svc_products SET current_version_id=?, updated_at=? WHERE id=?`).run(versionId, ts, productId);
    return detail(productId);
  }

  function update(productId, body) {
    const p = db.prepare(`SELECT * FROM svc_products WHERE id=?`).get(+productId);
    if (!p) {
      const err = new Error("商品不存在");
      err.code = "not_found";
      throw err;
    }
    const n = normalizeBody(body);
    const category = normalizeCategory(body);
    const ts = nowIso();
    const maxRow = db.prepare(`SELECT MAX(version_no) AS m FROM svc_product_versions WHERE product_id=?`).get(+productId);
    const nextNo = Number(maxRow && maxRow.m ? maxRow.m : 0) + 1;
    const publishNow = body.publish === true || p.status === "published";
    if (publishNow && n.costCents <= 0) {
      const err = new Error("上架前请填写成本");
      err.code = "validation";
      throw err;
    }
    const versionId = insertVersion(productId, nextNo, n, publishNow ? ts : null);
    if (n.benefitItems.length > 0) {
      const normalized = normalizeBenefitItems(db, n.benefitItems);
      insertVersionItems(db, versionId, normalized);
    }
    db.prepare(
      `UPDATE svc_products SET current_version_id=?, status=?, category=?, cost_cents=?, list_price_cents=?, updated_at=? WHERE id=?`
    ).run(versionId, publishNow ? "published" : p.status, category, n.costCents, n.listPriceCents, ts, +productId);
    return detail(productId);
  }

  function publish(productId) {
    const p = db.prepare(`SELECT * FROM svc_products WHERE id=?`).get(+productId);
    if (!p) {
      const err = new Error("商品不存在");
      err.code = "not_found";
      throw err;
    }
    if (!p.current_version_id) {
      const err = new Error("无可发布版本");
      err.code = "validation";
      throw err;
    }
    // 成本门禁：上架前必须填写成本
    if ((p.cost_cents == null || p.cost_cents <= 0)) {
      const err = new Error("上架前请填写成本");
      err.code = "validation";
      throw err;
    }
    // 组件化商品门禁：若该产品曾有权益项，当前版本至少需要一个
    const currentItems = listVersionItems(db, p.current_version_id);
    if (currentItems.length === 0) {
      const hadItems = db
        .prepare(
          `SELECT 1 FROM svc_product_version_items vi
           JOIN svc_product_versions v ON v.id = vi.version_id
           WHERE v.product_id = ? LIMIT 1`
        )
        .get(+productId);
      if (hadItems) {
        const err = new Error("发布前至少需要一个权益服务项");
        err.code = "validation";
        throw err;
      }
    }
    const ts = nowIso();
    db.prepare(`UPDATE svc_product_versions SET published_at=COALESCE(published_at, ?) WHERE id=?`).run(
      ts,
      p.current_version_id
    );
    db.prepare(`UPDATE svc_products SET status='published', updated_at=? WHERE id=?`).run(ts, +productId);
    return detail(productId);
  }

  function offline(productId) {
    const p = db.prepare(`SELECT * FROM svc_products WHERE id=?`).get(+productId);
    if (!p) {
      const err = new Error("商品不存在");
      err.code = "not_found";
      throw err;
    }
    const ts = nowIso();
    db.prepare(`UPDATE svc_products SET status='offline', updated_at=? WHERE id=?`).run(ts, +productId);
    return detail(productId);
  }

  /** 将已有服务包商品改挂到另一位医生（同 slug 冲突时拒绝） */
  function reassignDoctor(productId, doctorId) {
    const p = db.prepare(`SELECT * FROM svc_products WHERE id=?`).get(+productId);
    if (!p) {
      const err = new Error("商品不存在");
      err.code = "not_found";
      throw err;
    }
    const did = +doctorId;
    if (!Number.isFinite(did) || did <= 0) {
      const err = new Error("缺少有效医生 doctorId");
      err.code = "validation";
      throw err;
    }
    const doctor = db.prepare(`SELECT id FROM doctors WHERE id=?`).get(did);
    if (!doctor) {
      const err = new Error("目标医生不存在");
      err.code = "validation";
      throw err;
    }
    if (+p.doctor_id === did) return detail(productId);
    const clash = db
      .prepare(`SELECT id FROM svc_products WHERE doctor_id=? AND slug=? AND id<>?`)
      .get(did, p.slug, +productId);
    if (clash) {
      const err = new Error("目标医生已存在相同 slug 的服务包商品");
      err.code = "validation";
      throw err;
    }
    const ts = nowIso();
    db.prepare(`UPDATE svc_products SET doctor_id=?, updated_at=? WHERE id=?`).run(did, ts, +productId);
    return detail(productId);
  }

  return { list, detail, create, update, publish, offline, reassignDoctor };
}

module.exports = { createAdminProducts };
