"use strict";

const { nowIso } = require("./schema.js");
const { listVersionItems } = require("./benefitItems.js");

function parseJson(raw, fallback) {
  try {
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    return fallback;
  }
}

function centsToYuan(cents) {
  return Math.round(Number(cents || 0)) / 100;
}

/** 患者端封面：相对 /uploads 路径补全为 PUBLIC_ORIGIN 绝对 URL */
function publicAssetUrl(path) {
  const raw = String(path || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  const rel = raw.startsWith("/") ? raw : `/${raw.replace(/^\/+/, "")}`;
  const origin = String(process.env.PUBLIC_ORIGIN || "").replace(/\/$/, "");
  return origin ? `${origin}${rel}` : rel;
}

function mapVersionRow(row, doctor) {
  if (!row) return null;
  const eligible = parseJson(row.eligible_json, []);
  const ineligible = parseJson(row.ineligible_json, []);
  const contents = parseJson(row.content_json, []);
  const assessments = parseJson(row.assessment_json, []);
  const goods = parseJson(row.goods_json, []);
  const consultation = parseJson(row.consultation_json, {});
  return {
    id: String(row.id),
    key: String(row.id),
    productId: row.product_id,
    versionId: row.id,
    versionNo: row.version_no,
    doctorId: doctor ? doctor.id : null,
    doctorName: doctor ? doctor.name : "",
    doctorHospital: doctor ? doctor.hospital || "" : "",
    doctorDept: doctor ? doctor.dept || "" : "",
    title: row.title,
    subtitle: row.subtitle || "",
    desc: row.subtitle || "",
    cover: publicAssetUrl(row.cover),
    serviceDays: row.service_days,
    eligible,
    ineligible,
    contents: contents.map((c) => (typeof c === "string" ? c : c.title || "")),
    contentItems: contents,
    assessments: assessments.map((a) => (typeof a === "string" ? a : a.title || "")),
    assessmentItems: assessments,
    goods: goods.map((g) => (typeof g === "string" ? g : `${g.name || "商品"} x${g.qty || 1}`)),
    goodsItems: goods,
    consultationNote: consultation.note || "问诊需在春雨 APP 单独下单支付",
    consultation,
    refundPolicy: row.refund_policy || "",
    agreementVersion: row.agreement_version,
    privacyConsentVersion: row.privacy_consent_version,
    refundPolicyVersion: row.refund_policy_version,
    serviceAmount: centsToYuan(row.service_amount_cents),
    goodsAmount: centsToYuan(row.goods_amount_cents),
    shippingAmount: centsToYuan(row.shipping_amount_cents),
    totalAmount: centsToYuan(row.total_amount_cents),
    serviceAmountCents: row.service_amount_cents,
    goodsAmountCents: row.goods_amount_cents,
    shippingAmountCents: row.shipping_amount_cents,
    totalAmountCents: row.total_amount_cents,
    icon: "shield",
    tone: "green",
    action: "查看详情",
    toast: "",
    reviewBeforeActivate: true,
    category: row.category || row.product_category || "rehab",
  };
}

function createCatalog(db) {
  function doctorRow(doctorId) {
    if (!doctorId) return null;
    return db.prepare(`SELECT id, name, hospital, dept FROM doctors WHERE id=?`).get(+doctorId) || null;
  }

  function toVersionDTO(row, doctor) {
    const dto = mapVersionRow(row, doctor);
    dto.benefitItems = listVersionItems(db, row.id);
    return dto;
  }

  function getPublishedMallSku(skuId) {
    const row = db
      .prepare(
        `SELECT k.*,s.doctor_id,s.code AS spu_code,s.name AS spu_name,s.scene,s.target_people,
                s.value_proposition,s.service_boundary,s.cover AS spu_cover
         FROM mall_skus k JOIN mall_spus s ON s.id=k.spu_id
         WHERE k.id=? AND k.status='published' AND s.status='published'`
      )
      .get(+skuId);
    if (!row) return null;
    const components = db
      .prepare(
        `SELECT * FROM mall_sku_components
         WHERE sku_id=? AND status='active' ORDER BY sort_order,id`
      )
      .all(row.id)
      .map((item) => ({
        id: item.id,
        type: item.component_type,
        sourceId: item.source_id,
        sourceVersionId: item.source_version_id,
        quantity: item.quantity,
        code: item.source_code,
        name: item.source_name,
        providerName: item.provider_name,
        estimatedCostCents: item.estimated_cost_cents,
        maxCostCents: item.max_cost_cents,
        snapshot: parseJson(item.snapshot_json, {}),
      }));
    const cost = db
      .prepare(
        `SELECT * FROM mall_sku_cost_snapshots
         WHERE sku_id=? AND sku_version_no=? ORDER BY id DESC LIMIT 1`
      )
      .get(row.id, row.version_no);
    const componentSummary = components.map((item) => ({
      type: item.type,
      sourceId: item.sourceId,
      sourceVersionId: item.sourceVersionId,
      name: item.name,
      quantity: item.quantity,
      providerName: item.providerName,
    }));
    return {
      skuId: row.id,
      spuId: row.spu_id,
      doctorId: row.doctor_id,
      code: row.code,
      name: row.name,
      cycleDays: row.cycle_days,
      salePriceCents: row.sale_price_cents,
      listPriceCents: row.list_price_cents,
      minimumPriceCents: row.minimum_price_cents,
      versionNo: row.version_no,
      spu: {
        id: row.spu_id,
        code: row.spu_code,
        name: row.spu_name,
        scene: row.scene,
        targetPeople: row.target_people,
        valueProposition: row.value_proposition,
        serviceBoundary: row.service_boundary,
        cover: publicAssetUrl(row.spu_cover),
      },
      components,
      componentSummary,
      costSnapshot: cost ? parseJson(cost.snapshot_json, {}) : {},
      displaySnapshot: parseJson(row.display_snapshot_json, {}),
    };
  }

  function getPublishedMallSpu(spuId) {
    const row = db.prepare("SELECT * FROM mall_spus WHERE id=? AND status='published'").get(+spuId);
    if (!row) return null;
    const doctor = doctorRow(row.doctor_id);
    const skus = db
      .prepare("SELECT id FROM mall_skus WHERE spu_id=? AND status='published' ORDER BY id")
      .all(row.id)
      .map((item) => getPublishedMallSku(item.id));
    return {
      id: String(row.id),
      key: String(row.id),
      spuId: row.id,
      doctorId: row.doctor_id,
      doctorName: doctor ? doctor.name : "",
      doctorHospital: doctor ? doctor.hospital || "" : "",
      doctorDept: doctor ? doctor.dept || "" : "",
      title: row.name,
      subtitle: row.value_proposition || "",
      desc: row.value_proposition || "",
      cover: publicAssetUrl(row.cover),
      scene: row.scene || "",
      targetPeople: row.target_people || "",
      serviceBoundary: row.service_boundary || "",
      skus,
      totalAmountCents: skus.length ? Math.min(...skus.map((item) => item.salePriceCents)) : 0,
      totalAmount: skus.length ? Math.min(...skus.map((item) => item.salePriceCents)) / 100 : 0,
      action: "查看详情",
      tone: "green",
    };
  }

  function listPublishedMall({ doctorId, page, pageSize } = {}) {
    const currentPage = Math.max(1, Number(page) || 1);
    const size = Math.min(100, Math.max(1, Number(pageSize) || 20));
    const where = doctorId ? "WHERE status='published' AND doctor_id=?" : "WHERE status='published'";
    const args = doctorId ? [+doctorId] : [];
    const total = db.prepare(`SELECT COUNT(*) AS c FROM mall_spus ${where}`).get(...args).c;
    const products = db
      .prepare(`SELECT id FROM mall_spus ${where} ORDER BY id DESC LIMIT ? OFFSET ?`)
      .all(...args, size, (currentPage - 1) * size)
      .map((item) => getPublishedMallSpu(item.id));
    return { products, page: currentPage, pageSize: size, total };
  }

  function listPublished({ doctorId, category } = {}) {
    let sql = `
      SELECT v.*, p.doctor_id AS product_doctor_id, p.slug, p.category AS product_category
      FROM svc_product_versions v
      JOIN svc_products p ON p.id = v.product_id
      WHERE p.status = 'published' AND p.current_version_id = v.id
    `;
    const args = [];
    if (doctorId) {
      sql += ` AND p.doctor_id = ?`;
      args.push(+doctorId);
    }
    if (category) {
      sql += ` AND p.category = ?`;
      args.push(String(category));
    }
    sql += ` ORDER BY v.id DESC`;
    const legacy = db
      .prepare(sql)
      .all(...args)
      .map((r) => toVersionDTO({ ...r, category: r.product_category }, doctorRow(r.product_doctor_id)));
    if (category) return legacy;
    return listPublishedMall({ doctorId, page: 1, pageSize: 100 }).products.concat(legacy);
  }

  function getPublishedByVersionId(versionId) {
    const row = db
      .prepare(
        `SELECT v.*, p.doctor_id AS product_doctor_id, p.slug, p.status AS product_status
         FROM svc_product_versions v
         JOIN svc_products p ON p.id = v.product_id
         WHERE v.id = ?`
      )
      .get(+versionId);
    if (!row) return null;
    if (row.product_status !== "published" || Number(row.id) !== Number(
      db.prepare(`SELECT current_version_id FROM svc_products WHERE id=?`).get(row.product_id)?.current_version_id
    )) {
      // 历史版本仍可读（下单快照场景由 orders 直接读 version）；列表只返回当前
    }
    return toVersionDTO(row, doctorRow(row.product_doctor_id));
  }

  function getCurrentPublished(productOrVersionKey) {
    const key = String(productOrVersionKey || "").trim();
    if (!key) return null;
    // 优先按 version id
    if (/^\d+$/.test(key)) {
      const byVersion = db
        .prepare(
          `SELECT v.*, p.doctor_id AS product_doctor_id, p.slug, p.status AS product_status, p.current_version_id
           FROM svc_product_versions v
           JOIN svc_products p ON p.id = v.product_id
           WHERE v.id = ?`
        )
        .get(+key);
      if (byVersion && byVersion.product_status === "published" && +byVersion.current_version_id === +byVersion.id) {
        return toVersionDTO(byVersion, doctorRow(byVersion.product_doctor_id));
      }
      const byProduct = db
        .prepare(
          `SELECT v.*, p.doctor_id AS product_doctor_id, p.slug
           FROM svc_products p
           JOIN svc_product_versions v ON v.id = p.current_version_id
           WHERE p.id = ? AND p.status = 'published'`
        )
        .get(+key);
      if (byProduct) return toVersionDTO(byProduct, doctorRow(byProduct.product_doctor_id));
    }
    return null;
  }

  function getVersionRaw(versionId) {
    return db.prepare(`SELECT * FROM svc_product_versions WHERE id=?`).get(+versionId) || null;
  }

  function buildServiceCenterProducts(doctorId) {
    return listPublished({ doctorId: doctorId || undefined });
  }

  return {
    listPublished,
    getPublishedByVersionId,
    getCurrentPublished,
    getVersionRaw,
    getPublishedMallSku,
    getPublishedMallSpu,
    listPublishedMall,
    buildServiceCenterProducts,
    mapVersionRow,
    nowIso,
  };
}

module.exports = { createCatalog, centsToYuan, parseJson, publicAssetUrl };
