"use strict";

const { nowIso } = require("./schema.js");

let savepointSequence = 0;

function transactional(db, fn) {
  return (...args) => {
    const savepoint = `mall_products_${++savepointSequence}`;
    db.exec(`SAVEPOINT ${savepoint}`);
    try {
      const result = fn(...args);
      db.exec(`RELEASE SAVEPOINT ${savepoint}`);
      return result;
    } catch (error) {
      db.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`);
      db.exec(`RELEASE SAVEPOINT ${savepoint}`);
      throw error;
    }
  };
}

function fail(message, code = "validation", details) {
  const error = new Error(message);
  error.code = code;
  if (details) error.details = details;
  throw error;
}

function parseJson(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch (_) {
    return fallback;
  }
}

function pageArgs(input = {}) {
  return {
    page: Math.max(1, Number(input.page) || 1),
    pageSize: Math.min(100, Math.max(1, Number(input.pageSize) || 20)),
  };
}

function createMallProducts(db) {
  function mapSpu(row) {
    if (!row) return null;
    return {
      id: row.id,
      doctorId: row.doctor_id,
      code: row.code,
      name: row.name,
      scene: row.scene,
      targetPeople: row.target_people,
      valueProposition: row.value_proposition,
      serviceBoundary: row.service_boundary,
      cover: row.cover,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  function mapSku(row) {
    if (!row) return null;
    return {
      id: row.id,
      spuId: row.spu_id,
      code: row.code,
      name: row.name,
      cycleDays: row.cycle_days,
      salePriceCents: row.sale_price_cents,
      listPriceCents: row.list_price_cents,
      minimumPriceCents: row.minimum_price_cents,
      minimumMarginBps: row.minimum_margin_bps,
      status: row.status,
      versionNo: row.version_no,
      displaySnapshot: parseJson(row.display_snapshot_json, {}),
      publishedAt: row.published_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  function componentTypeOf(input = {}) {
    return String(input.componentType || input.type || "").trim();
  }

  function mapComponent(row) {
    // 管理端契约用 type/name/code；同时保留 componentType/source* 供内部成本与发布校验
    return {
      id: row.id,
      skuId: row.sku_id,
      type: row.component_type,
      componentType: row.component_type,
      sourceId: row.source_id,
      sourceVersionId: row.source_version_id,
      quantity: row.quantity,
      code: row.source_code,
      name: row.source_name,
      sourceCode: row.source_code,
      sourceName: row.source_name,
      providerName: row.provider_name,
      estimatedCostCents: row.estimated_cost_cents,
      maxCostCents: row.max_cost_cents,
      snapshot: parseJson(row.snapshot_json, {}),
      sortOrder: row.sort_order,
    };
  }

  function listSpus(input = {}) {
    const doctorId = Number(input.doctorId);
    if (!doctorId) fail("缺少 doctorId");
    const clauses = ["doctor_id=?"];
    const params = [doctorId];
    if (input.status) {
      clauses.push("status=?");
      params.push(String(input.status));
    }
    if (input.keyword) {
      clauses.push("(code LIKE ? OR name LIKE ?)");
      const keyword = `%${String(input.keyword).trim()}%`;
      params.push(keyword, keyword);
    }
    const { page, pageSize } = pageArgs(input);
    const where = `WHERE ${clauses.join(" AND ")}`;
    const total = db.prepare(`SELECT COUNT(*) AS c FROM mall_spus ${where}`).get(...params).c;
    const items = db
      .prepare(`SELECT * FROM mall_spus ${where} ORDER BY id DESC LIMIT ? OFFSET ?`)
      .all(...params, pageSize, (page - 1) * pageSize)
      .map((row) => ({
        ...mapSpu(row),
        skuCount: db.prepare("SELECT COUNT(*) AS c FROM mall_skus WHERE spu_id=?").get(row.id).c,
      }));
    return { items, page, pageSize, total };
  }

  function getSpu(id, doctorId) {
    const row = doctorId
      ? db.prepare("SELECT * FROM mall_spus WHERE id=? AND doctor_id=?").get(+id, +doctorId)
      : db.prepare("SELECT * FROM mall_spus WHERE id=?").get(+id);
    return mapSpu(row);
  }

  function createSpu(input = {}) {
    const doctorId = Number(input.doctorId);
    const code = String(input.code || "").trim();
    const name = String(input.name || "").trim();
    if (!doctorId || !code || !name) fail("SPU 医生、编码和名称必填");
    const ts = nowIso();
    try {
      const info = db.prepare(
        `INSERT INTO mall_spus(
          doctor_id,code,name,scene,target_people,value_proposition,service_boundary,cover,status,created_at,updated_at
        ) VALUES (?,?,?,?,?,?,?,?,'draft',?,?)`
      ).run(
        doctorId,
        code,
        name,
        String(input.scene || "").trim(),
        String(input.targetPeople || "").trim(),
        String(input.valueProposition || "").trim(),
        String(input.serviceBoundary || "").trim(),
        String(input.cover || "").trim(),
        ts,
        ts
      );
      return getSpu(info.lastInsertRowid);
    } catch (error) {
      if (/UNIQUE/.test(String(error.message))) fail("SPU 编码已存在", "conflict");
      throw error;
    }
  }

  function updateSpu(id, input = {}) {
    const row = db.prepare("SELECT * FROM mall_spus WHERE id=?").get(+id);
    if (!row) fail("SPU 不存在", "not_found");
    db.prepare(
      `UPDATE mall_spus SET name=?,scene=?,target_people=?,value_proposition=?,service_boundary=?,cover=?,updated_at=? WHERE id=?`
    ).run(
      String(input.name != null ? input.name : row.name).trim(),
      String(input.scene != null ? input.scene : row.scene).trim(),
      String(input.targetPeople != null ? input.targetPeople : row.target_people).trim(),
      String(input.valueProposition != null ? input.valueProposition : row.value_proposition).trim(),
      String(input.serviceBoundary != null ? input.serviceBoundary : row.service_boundary).trim(),
      String(input.cover != null ? input.cover : row.cover).trim(),
      nowIso(),
      +id
    );
    return getSpu(id);
  }

  function listSkus(spuId, input = {}) {
    if (!getSpu(spuId)) fail("SPU 不存在", "not_found");
    const clauses = ["spu_id=?"];
    const params = [+spuId];
    if (input.status) {
      clauses.push("status=?");
      params.push(String(input.status));
    }
    if (input.keyword) {
      clauses.push("(code LIKE ? OR name LIKE ?)");
      const keyword = `%${String(input.keyword).trim()}%`;
      params.push(keyword, keyword);
    }
    const { page, pageSize } = pageArgs(input);
    const where = `WHERE ${clauses.join(" AND ")}`;
    const total = db.prepare(`SELECT COUNT(*) AS c FROM mall_skus ${where}`).get(...params).c;
    const items = db
      .prepare(`SELECT * FROM mall_skus ${where} ORDER BY id DESC LIMIT ? OFFSET ?`)
      .all(...params, pageSize, (page - 1) * pageSize)
      .map(mapSku);
    return { items, page, pageSize, total };
  }

  function getSku(id) {
    const row = db.prepare("SELECT * FROM mall_skus WHERE id=?").get(+id);
    if (!row) return null;
    const components = db
      .prepare("SELECT * FROM mall_sku_components WHERE sku_id=? AND status='active' ORDER BY sort_order,id")
      .all(+id)
      .map(mapComponent);
    return { ...mapSku(row), spu: getSpu(row.spu_id), components };
  }

  function normalizeSku(input, current = {}) {
    const code = String(input.code != null ? input.code : current.code || "").trim();
    const name = String(input.name != null ? input.name : current.name || "").trim();
    const cycleDays = Number(input.cycleDays != null ? input.cycleDays : current.cycle_days);
    const salePriceCents = Number(input.salePriceCents != null ? input.salePriceCents : current.sale_price_cents) || 0;
    const listPriceCents = Number(input.listPriceCents != null ? input.listPriceCents : current.list_price_cents) || 0;
    const minimumPriceCents = Number(
      input.minimumPriceCents != null ? input.minimumPriceCents : current.minimum_price_cents
    ) || 0;
    const minimumMarginBps = Number(
      input.minimumMarginBps != null ? input.minimumMarginBps : current.minimum_margin_bps
    ) || 0;
    if (!code || !name || cycleDays <= 0) fail("SKU 编码、名称和周期必填");
    if ([salePriceCents, listPriceCents, minimumPriceCents].some((value) => value < 0)) fail("SKU 金额不能为负数");
    if (listPriceCents && listPriceCents < salePriceCents) fail("划线价不能低于售价");
    return { code, name, cycleDays, salePriceCents, listPriceCents, minimumPriceCents, minimumMarginBps };
  }

  function createSku(spuId, input = {}) {
    if (!getSpu(spuId)) fail("SPU 不存在", "not_found");
    const value = normalizeSku(input);
    const ts = nowIso();
    try {
      const info = db.prepare(
        `INSERT INTO mall_skus(
          spu_id,code,name,cycle_days,sale_price_cents,list_price_cents,minimum_price_cents,
          minimum_margin_bps,status,created_at,updated_at
        ) VALUES (?,?,?,?,?,?,?,?,'draft',?,?)`
      ).run(
        +spuId,
        value.code,
        value.name,
        value.cycleDays,
        value.salePriceCents,
        value.listPriceCents,
        value.minimumPriceCents,
        value.minimumMarginBps,
        ts,
        ts
      );
      return getSku(info.lastInsertRowid);
    } catch (error) {
      if (/UNIQUE/.test(String(error.message))) fail("SKU 编码已存在", "conflict");
      throw error;
    }
  }

  function updateSku(id, input = {}) {
    const row = db.prepare("SELECT * FROM mall_skus WHERE id=?").get(+id);
    if (!row) fail("SKU 不存在", "not_found");
    if (row.status === "published") fail("已发布 SKU 请先下架再修改", "immutable");
    const value = normalizeSku(input, row);
    db.prepare(
      `UPDATE mall_skus SET code=?,name=?,cycle_days=?,sale_price_cents=?,list_price_cents=?,
       minimum_price_cents=?,minimum_margin_bps=?,updated_at=? WHERE id=?`
    ).run(
      value.code,
      value.name,
      value.cycleDays,
      value.salePriceCents,
      value.listPriceCents,
      value.minimumPriceCents,
      value.minimumMarginBps,
      nowIso(),
      +id
    );
    return getSku(id);
  }

  function resolveComponent(sku, input, sortOrder) {
    const type = componentTypeOf(input);
    const sourceId = Number(input.sourceId);
    const sourceVersionId = input.sourceVersionId == null ? null : Number(input.sourceVersionId);
    const quantity = Math.max(1, Number(input.quantity) || 1);
    if (type === "BENEFIT_SKU") {
      const row = db.prepare(
        `SELECT s.code,s.name,v.* FROM mall_benefit_sku_versions v
         JOIN mall_benefit_skus s ON s.id=v.benefit_sku_id
         WHERE s.id=? AND v.id=? AND v.status='published' AND s.status='published'`
      ).get(sourceId, sourceVersionId);
      if (!row) fail("权益 SKU 发布版本不可用");
      return {
        type,
        sourceId,
        sourceVersionId,
        quantity: 1,
        code: row.code,
        name: row.name,
        provider: row.provider_name,
        estimated: row.estimated_cost_cents,
        maximum: row.max_cost_cents,
        snapshot: parseJson(row.snapshot_json, {}),
        sortOrder,
      };
    }
    if (type === "OPS_SERVICE_TEMPLATE") {
      const row = db.prepare(
        `SELECT t.code,t.name,t.owner_doctor_id,v.* FROM ops_service_template_versions v
         JOIN ops_service_templates t ON t.id=v.template_id
         WHERE t.id=? AND v.id=? AND v.status='published' AND t.status='published'`
      ).get(sourceId, sourceVersionId);
      if (!row) fail("运营服务模板发布版本不可用");
      if (+row.owner_doctor_id !== +sku.spu.doctorId) fail("运营服务模板不属于当前医生");
      return {
        type,
        sourceId,
        sourceVersionId,
        quantity,
        code: row.code,
        name: row.name,
        provider: row.provider_name,
        estimated: row.estimated_cost_cents,
        maximum: row.max_cost_cents,
        snapshot: {
          cycleDays: row.cycle_days,
          startCondition: row.start_condition,
          config: parseJson(row.config_json, {}),
        },
        sortOrder,
      };
    }
    if (type === "GOODS_SKU") {
      const row = db.prepare("SELECT * FROM mall_goods_skus WHERE id=? AND status='published'").get(sourceId);
      if (!row) fail("实物 SKU 不可用");
      return {
        type,
        sourceId,
        sourceVersionId: null,
        quantity,
        code: row.code,
        name: row.name,
        provider: row.supplier_name,
        estimated: row.purchase_cost_cents,
        maximum: row.purchase_cost_cents,
        snapshot: {
          versionNo: row.version_no,
          purchaseCostCents: row.purchase_cost_cents,
          logisticsCostCents: row.logistics_cost_cents,
          rebateCents: row.rebate_cents,
          logisticsConfig: parseJson(row.logistics_config_json, {}),
          afterSaleConfig: parseJson(row.after_sale_config_json, {}),
        },
        sortOrder,
      };
    }
    fail("不支持的 BOM 组成类型");
  }

  const replaceComponentsTx = transactional(db, (skuId, inputs) => {
    const sku = getSku(skuId);
    if (!sku) fail("SKU 不存在", "not_found");
    if (sku.status === "published") fail("已发布 SKU 不可修改 BOM", "immutable");
    const list = (Array.isArray(inputs) ? inputs : []).map((item) => ({
      ...item,
      componentType: componentTypeOf(item),
      type: componentTypeOf(item),
    }));
    if (list.filter((item) => item.componentType === "BENEFIT_SKU").length > 1) {
      fail("one benefit SKU version is allowed");
    }
    const merged = [];
    const positions = new Map();
    list.forEach((item) => {
      const key = `${item.componentType}:${item.sourceId}:${item.sourceVersionId || 0}`;
      if (positions.has(key)) {
        merged[positions.get(key)].quantity += Math.max(1, Number(item.quantity) || 1);
      } else {
        positions.set(key, merged.length);
        merged.push({ ...item, quantity: Math.max(1, Number(item.quantity) || 1) });
      }
    });
    const resolved = merged.map((item, index) => resolveComponent(sku, item, index));
    const ts = nowIso();
    db.prepare("UPDATE mall_sku_components SET status='removed',updated_at=? WHERE sku_id=? AND status='active'").run(ts, +skuId);
    const insert = db.prepare(
      `INSERT INTO mall_sku_components(
        sku_id,component_type,source_id,source_version_id,quantity,source_code,source_name,provider_name,
        estimated_cost_cents,max_cost_cents,snapshot_json,status,sort_order,created_at,updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,'active',?,?,?)`
    );
    resolved.forEach((item) => {
      insert.run(
        +skuId,
        item.type,
        item.sourceId,
        item.sourceVersionId,
        item.quantity,
        item.code,
        item.name,
        item.provider,
        item.estimated,
        item.maximum,
        JSON.stringify(item.snapshot),
        item.sortOrder,
        ts,
        ts
      );
    });
    return getSku(skuId).components;
  });

  function replaceComponents(skuId, inputs) {
    return replaceComponentsTx(skuId, inputs);
  }

  function quoteCost(skuId, discountCents = 0) {
    const sku = getSku(skuId);
    if (!sku) fail("SKU 不存在", "not_found");
    const result = {
      benefitCostCents: 0,
      opsCostCents: 0,
      goodsCostCents: 0,
      logisticsCostCents: 0,
      rebateCents: 0,
    };
    let maximumTotalCents = 0;
    sku.components.forEach((component) => {
      const quantity = component.quantity;
      if (component.componentType === "BENEFIT_SKU") {
        result.benefitCostCents += component.estimatedCostCents * quantity;
        maximumTotalCents += component.maxCostCents * quantity;
      } else if (component.componentType === "OPS_SERVICE_TEMPLATE") {
        result.opsCostCents += component.estimatedCostCents * quantity;
        maximumTotalCents += component.maxCostCents * quantity;
      } else {
        result.goodsCostCents += component.estimatedCostCents * quantity;
        result.logisticsCostCents += Number(component.snapshot.logisticsCostCents || 0) * quantity;
        result.rebateCents += Number(component.snapshot.rebateCents || 0) * quantity;
        maximumTotalCents +=
          (component.maxCostCents + Number(component.snapshot.logisticsCostCents || 0)) * quantity;
      }
    });
    result.estimatedTotalCents =
      result.benefitCostCents +
      result.opsCostCents +
      result.goodsCostCents +
      result.logisticsCostCents -
      result.rebateCents;
    result.maximumTotalCents = maximumTotalCents;
    result.incomeCents = sku.salePriceCents - Math.max(0, Number(discountCents) || 0);
    result.grossMarginBps =
      result.incomeCents > 0
        ? Math.floor(((result.incomeCents - result.estimatedTotalCents) * 10000) / result.incomeCents)
        : -10000;
    return result;
  }

  function validatePublish(skuId) {
    const sku = getSku(skuId);
    if (!sku) fail("SKU 不存在", "not_found");
    const blockers = [];
    const warnings = [];
    const benefits = sku.components.filter((item) => item.componentType === "BENEFIT_SKU");
    if (benefits.length !== 1) blockers.push({ code: "BENEFIT_SKU_REQUIRED", message: "SKU 必须且只能绑定一个 BENEFIT_SKU" });
    if (sku.salePriceCents <= 0) blockers.push({ code: "PRICE_REQUIRED", message: "售价必须大于 0" });
    if (sku.salePriceCents < sku.minimumPriceCents) blockers.push({ code: "BELOW_MINIMUM_PRICE", message: "售价低于最低成交价" });
    for (const component of sku.components) {
      if (component.componentType !== "GOODS_SKU") continue;
      const stock = db.prepare("SELECT * FROM mall_goods_inventory WHERE goods_sku_id=?").get(component.sourceId);
      const available = stock ? stock.on_hand - stock.reserved - stock.sold : 0;
      if (available < component.quantity) blockers.push({ code: "GOODS_OUT_OF_STOCK", message: `${component.sourceName}库存不足` });
    }
    const quote = quoteCost(skuId, 0);
    if (quote.grossMarginBps < sku.minimumMarginBps) blockers.push({ code: "MARGIN_TOO_LOW", message: "预估毛利率未通过护栏" });
    return { blockers, warnings, quote };
  }

  const publishSkuTx = transactional(db, (skuId) => {
    const sku = getSku(skuId);
    if (!sku) fail("SKU 不存在", "not_found");
    if (sku.status === "published") return sku;
    const check = validatePublish(skuId);
    if (check.blockers.length) fail(check.blockers.map((item) => item.message).join("; "), "publish_blocked", check);
    const ts = nowIso();
    const displaySnapshot = {
      spu: sku.spu,
      sku: {
        id: sku.id,
        code: sku.code,
        name: sku.name,
        cycleDays: sku.cycleDays,
        salePriceCents: sku.salePriceCents,
        listPriceCents: sku.listPriceCents,
      },
      components: sku.components,
    };
    const snapshotExists = db
      .prepare("SELECT 1 FROM mall_sku_cost_snapshots WHERE sku_id=? AND sku_version_no=?")
      .get(sku.id, sku.versionNo);
    if (!snapshotExists) {
      db.prepare(
        `INSERT INTO mall_sku_cost_snapshots(
          sku_id,sku_version_no,benefit_cost_cents,ops_cost_cents,goods_cost_cents,logistics_cost_cents,
          rebate_cents,estimated_total_cents,maximum_total_cents,gross_margin_bps,snapshot_json,created_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
      ).run(
        sku.id,
        sku.versionNo,
        check.quote.benefitCostCents,
        check.quote.opsCostCents,
        check.quote.goodsCostCents,
        check.quote.logisticsCostCents,
        check.quote.rebateCents,
        check.quote.estimatedTotalCents,
        check.quote.maximumTotalCents,
        check.quote.grossMarginBps,
        JSON.stringify(check.quote),
        ts
      );
    }
    db.prepare("UPDATE mall_skus SET status='published',display_snapshot_json=?,published_at=?,updated_at=? WHERE id=?")
      .run(JSON.stringify(displaySnapshot), ts, ts, sku.id);
    return getSku(sku.id);
  });

  function publishSku(id) {
    return publishSkuTx(id);
  }

  function offlineSku(id) {
    const info = db.prepare("UPDATE mall_skus SET status='offline',updated_at=? WHERE id=?").run(nowIso(), +id);
    if (!info.changes) fail("SKU 不存在", "not_found");
    return getSku(id);
  }

  function publishSpu(id) {
    const offlineSkus = db
      .prepare("SELECT id FROM mall_skus WHERE spu_id=? AND status='offline'")
      .all(+id);
    for (const row of offlineSkus) {
      publishSku(row.id);
    }
    const published = db.prepare("SELECT COUNT(*) AS c FROM mall_skus WHERE spu_id=? AND status='published'").get(+id).c;
    if (!published) fail("SPU 至少需要一个已发布 SKU");
    const info = db.prepare("UPDATE mall_spus SET status='published',updated_at=? WHERE id=?").run(nowIso(), +id);
    if (!info.changes) fail("SPU 不存在", "not_found");
    return getSpu(id);
  }

  function offlineSpu(id) {
    const tx = transactional(db, () => {
      const ts = nowIso();
      const info = db.prepare("UPDATE mall_spus SET status='offline',updated_at=? WHERE id=?").run(ts, +id);
      if (!info.changes) fail("SPU 不存在", "not_found");
      db.prepare("UPDATE mall_skus SET status='offline',updated_at=? WHERE spu_id=? AND status='published'").run(ts, +id);
    });
    tx();
    return getSpu(id);
  }

  return {
    listSpus,
    getSpu,
    createSpu,
    updateSpu,
    listSkus,
    getSku,
    createSku,
    updateSku,
    replaceComponents,
    quoteCost,
    validatePublish,
    publishSku,
    offlineSku,
    publishSpu,
    offlineSpu,
  };
}

module.exports = { createMallProducts };
