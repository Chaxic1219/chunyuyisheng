"use strict";

const { nowIso } = require("./schema.js");

let savepointSequence = 0;

function transactional(db, fn) {
  return (...args) => {
    const savepoint = `mall_master_${++savepointSequence}`;
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

function fail(message, code = "validation") {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function pageArgs(input = {}) {
  return {
    page: Math.max(1, Number(input.page) || 1),
    pageSize: Math.min(100, Math.max(1, Number(input.pageSize) || 20)),
  };
}

function parseJson(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch (_) {
    return fallback;
  }
}

function createMasterData(db) {
  function paginate(table, where, params, input, mapper) {
    const { page, pageSize } = pageArgs(input);
    const offset = (page - 1) * pageSize;
    const total = db.prepare(`SELECT COUNT(*) AS c FROM ${table} ${where}`).get(...params).c;
    const rows = db
      .prepare(`SELECT * FROM ${table} ${where} ORDER BY id DESC LIMIT ? OFFSET ?`)
      .all(...params, pageSize, offset);
    return { items: rows.map(mapper), page, pageSize, total };
  }

  function mapBenefit(row) {
    if (!row) return null;
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      cycleDays: row.cycle_days,
      status: row.status,
      currentVersionId: row.current_version_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  function mapBenefitVersion(row) {
    if (!row) return null;
    return {
      id: row.id,
      benefitSkuId: row.benefit_sku_id,
      versionNo: row.version_no,
      status: row.status,
      providerName: row.provider_name,
      estimatedCostCents: row.estimated_cost_cents,
      maxCostCents: row.max_cost_cents,
      channelConfig: parseJson(row.channel_config_json, {}),
      snapshot: parseJson(row.snapshot_json, {}),
      publishedAt: row.published_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  function listBenefitSkus(input = {}) {
    const clauses = [];
    const params = [];
    if (input.status) {
      clauses.push("status=?");
      params.push(String(input.status));
    }
    if (input.keyword) {
      clauses.push("(code LIKE ? OR name LIKE ?)");
      const keyword = `%${String(input.keyword).trim()}%`;
      params.push(keyword, keyword);
    }
    return paginate(
      "mall_benefit_skus",
      clauses.length ? `WHERE ${clauses.join(" AND ")}` : "",
      params,
      input,
      mapBenefit
    );
  }

  function getBenefitSku(id) {
    const row = db.prepare("SELECT * FROM mall_benefit_skus WHERE id=?").get(+id);
    if (!row) return null;
    const versions = db
      .prepare("SELECT * FROM mall_benefit_sku_versions WHERE benefit_sku_id=? ORDER BY version_no DESC")
      .all(+id)
      .map((version) => ({
        ...mapBenefitVersion(version),
        items: db
          .prepare("SELECT * FROM mall_benefit_sku_items WHERE version_id=? ORDER BY sort_order,id")
          .all(version.id)
          .map((item) => ({
            id: item.id,
            name: item.name,
            benefitType: item.benefit_type,
            quota: item.quota,
            unit: item.unit,
            applyRule: parseJson(item.apply_rule_json, {}),
            sortOrder: item.sort_order,
          })),
      }));
    return { ...mapBenefit(row), versions };
  }

  function createBenefitSku(input = {}) {
    const code = String(input.code || "").trim();
    const name = String(input.name || "").trim();
    const cycleDays = Number(input.cycleDays);
    if (!code || !name || cycleDays <= 0) fail("权益 SKU 编码、名称和周期必填");
    const ts = nowIso();
    try {
      const info = db
        .prepare(
          "INSERT INTO mall_benefit_skus(code,name,cycle_days,status,created_at,updated_at) VALUES (?,?,?,'draft',?,?)"
        )
        .run(code, name, cycleDays, ts, ts);
      return mapBenefit(db.prepare("SELECT * FROM mall_benefit_skus WHERE id=?").get(info.lastInsertRowid));
    } catch (error) {
      if (/UNIQUE/.test(String(error.message))) fail("权益 SKU 编码已存在", "conflict");
      throw error;
    }
  }

  const saveBenefitDraftTx = transactional(db, (benefitSkuId, input) => {
    const master = db.prepare("SELECT * FROM mall_benefit_skus WHERE id=?").get(+benefitSkuId);
    if (!master) fail("权益 SKU 不存在", "not_found");
    let version = null;
    if (input.versionNo != null) {
      version = db
        .prepare("SELECT * FROM mall_benefit_sku_versions WHERE benefit_sku_id=? AND version_no=?")
        .get(+benefitSkuId, +input.versionNo);
      if (version && version.status === "published") fail("published version is immutable", "immutable");
    } else {
      version = db
        .prepare("SELECT * FROM mall_benefit_sku_versions WHERE benefit_sku_id=? AND status='draft' ORDER BY version_no DESC LIMIT 1")
        .get(+benefitSkuId);
    }
    const ts = nowIso();
    if (!version) {
      const next = Number(
        db.prepare("SELECT COALESCE(MAX(version_no),0)+1 AS n FROM mall_benefit_sku_versions WHERE benefit_sku_id=?").get(+benefitSkuId).n
      );
      const info = db
        .prepare(
          `INSERT INTO mall_benefit_sku_versions(
            benefit_sku_id,version_no,status,provider_name,estimated_cost_cents,max_cost_cents,
            channel_config_json,snapshot_json,created_at,updated_at
          ) VALUES (?,?,'draft',?,?,?,?,?,?,?)`
        )
        .run(
          +benefitSkuId,
          next,
          String(input.providerName || "").trim(),
          Math.max(0, Number(input.estimatedCostCents) || 0),
          Math.max(0, Number(input.maxCostCents) || 0),
          JSON.stringify(input.channelConfig || {}),
          "{}",
          ts,
          ts
        );
      version = db.prepare("SELECT * FROM mall_benefit_sku_versions WHERE id=?").get(info.lastInsertRowid);
    } else {
      db.prepare(
        `UPDATE mall_benefit_sku_versions SET provider_name=?,estimated_cost_cents=?,max_cost_cents=?,
         channel_config_json=?,updated_at=? WHERE id=?`
      ).run(
        String(input.providerName != null ? input.providerName : version.provider_name).trim(),
        input.estimatedCostCents != null ? Math.max(0, Number(input.estimatedCostCents) || 0) : version.estimated_cost_cents,
        input.maxCostCents != null ? Math.max(0, Number(input.maxCostCents) || 0) : version.max_cost_cents,
        JSON.stringify(input.channelConfig || parseJson(version.channel_config_json, {})),
        ts,
        version.id
      );
    }
    if (Array.isArray(input.items)) {
      db.prepare("DELETE FROM mall_benefit_sku_items WHERE version_id=?").run(version.id);
      const insert = db.prepare(
        `INSERT INTO mall_benefit_sku_items(
          version_id,name,benefit_type,quota,unit,apply_rule_json,sort_order,created_at
        ) VALUES (?,?,?,?,?,?,?,?)`
      );
      input.items.forEach((item, index) => {
        const name = String(item.name || "").trim();
        const unit = String(item.unit || "").trim();
        if (!name || !unit) fail("权益服务项名称和单位必填");
        insert.run(
          version.id,
          name,
          String(item.benefitType || "total"),
          item.quota == null ? null : Math.max(0, Number(item.quota) || 0),
          unit,
          JSON.stringify(item.applyRule || {}),
          Number(item.sortOrder) || index,
          ts
        );
      });
    }
    db.prepare("UPDATE mall_benefit_skus SET updated_at=? WHERE id=?").run(ts, +benefitSkuId);
    return getBenefitSku(benefitSkuId).versions.find((item) => item.id === version.id);
  });

  function saveBenefitDraft(id, input = {}) {
    return saveBenefitDraftTx(id, input);
  }

  const publishBenefitTx = transactional(db, (id, versionNo) => {
    const version = db
      .prepare("SELECT * FROM mall_benefit_sku_versions WHERE benefit_sku_id=? AND version_no=?")
      .get(+id, +versionNo);
    if (!version) fail("权益版本不存在", "not_found");
    if (version.status === "published") return mapBenefitVersion(version);
    const items = db.prepare("SELECT * FROM mall_benefit_sku_items WHERE version_id=? ORDER BY sort_order,id").all(version.id);
    if (!version.provider_name || !items.length) fail("发布前必须配置服务方和权益服务项");
    const ts = nowIso();
    const snapshot = {
      providerName: version.provider_name,
      estimatedCostCents: version.estimated_cost_cents,
      maxCostCents: version.max_cost_cents,
      items: items.map((item) => ({ name: item.name, benefitType: item.benefit_type, quota: item.quota, unit: item.unit })),
    };
    db.prepare("UPDATE mall_benefit_sku_versions SET status='published',snapshot_json=?,published_at=?,updated_at=? WHERE id=?")
      .run(JSON.stringify(snapshot), ts, ts, version.id);
    db.prepare("UPDATE mall_benefit_skus SET status='published',current_version_id=?,updated_at=? WHERE id=?")
      .run(version.id, ts, +id);
    return mapBenefitVersion(db.prepare("SELECT * FROM mall_benefit_sku_versions WHERE id=?").get(version.id));
  });

  function publishBenefitVersion(id, versionNo) {
    return publishBenefitTx(id, versionNo);
  }

  function disableBenefitSku(id) {
    const info = db.prepare("UPDATE mall_benefit_skus SET status='disabled',updated_at=? WHERE id=?").run(nowIso(), +id);
    if (!info.changes) fail("权益 SKU 不存在", "not_found");
    return getBenefitSku(id);
  }

  function mapOps(row) {
    if (!row) return null;
    return {
      id: row.id,
      doctorId: row.owner_doctor_id,
      code: row.code,
      name: row.name,
      serviceType: row.service_type,
      status: row.status,
      currentVersionId: row.current_version_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  function listOpsTemplates(input = {}) {
    if (!input.doctorId) fail("缺少 doctorId");
    const clauses = ["owner_doctor_id=?"];
    const params = [+input.doctorId];
    if (input.status) {
      clauses.push("status=?");
      params.push(String(input.status));
    }
    if (input.keyword) {
      clauses.push("(code LIKE ? OR name LIKE ?)");
      const keyword = `%${String(input.keyword).trim()}%`;
      params.push(keyword, keyword);
    }
    return paginate("ops_service_templates", `WHERE ${clauses.join(" AND ")}`, params, input, mapOps);
  }

  function getOpsTemplate(id, doctorId) {
    const row = db
      .prepare("SELECT * FROM ops_service_templates WHERE id=? AND owner_doctor_id=?")
      .get(+id, +doctorId);
    if (!row) return null;
    const versions = db
      .prepare("SELECT * FROM ops_service_template_versions WHERE template_id=? ORDER BY version_no DESC")
      .all(+id)
      .map((version) => ({
        id: version.id,
        templateId: version.template_id,
        versionNo: version.version_no,
        status: version.status,
        cycleDays: version.cycle_days,
        startCondition: version.start_condition,
        providerName: version.provider_name,
        estimatedCostCents: version.estimated_cost_cents,
        maxCostCents: version.max_cost_cents,
        config: parseJson(version.config_json, {}),
        publishedAt: version.published_at,
        tasks: db
          .prepare("SELECT * FROM ops_service_template_tasks WHERE version_id=? ORDER BY sort_order,id")
          .all(version.id)
          .map((task) => ({
            id: task.id,
            title: task.title,
            timingType: task.timing_type,
            timingValue: task.timing_value,
            executionMode: task.execution_mode,
            resultSchema: parseJson(task.result_schema_json, {}),
            estimatedCostCents: task.estimated_cost_cents,
            escalation: parseJson(task.escalation_json, {}),
            sortOrder: task.sort_order,
          })),
      }));
    return { ...mapOps(row), versions };
  }

  function createOpsTemplate(input = {}) {
    const doctorId = Number(input.doctorId);
    const code = String(input.code || "").trim();
    const name = String(input.name || "").trim();
    if (!doctorId || !code || !name) fail("运营模板医生、编码和名称必填");
    const ts = nowIso();
    try {
      const info = db.prepare(
        `INSERT INTO ops_service_templates(owner_doctor_id,code,name,service_type,status,created_at,updated_at)
         VALUES (?,?,?,?,'draft',?,?)`
      ).run(doctorId, code, name, String(input.serviceType || "health_management"), ts, ts);
      return mapOps(db.prepare("SELECT * FROM ops_service_templates WHERE id=?").get(info.lastInsertRowid));
    } catch (error) {
      if (/UNIQUE/.test(String(error.message))) fail("运营模板编码已存在", "conflict");
      throw error;
    }
  }

  const saveOpsDraftTx = transactional(db, (templateId, input) => {
    const template = db
      .prepare("SELECT * FROM ops_service_templates WHERE id=? AND owner_doctor_id=?")
      .get(+templateId, +input.doctorId);
    if (!template) fail("运营模板不存在", "not_found");
    let version = input.versionNo == null
      ? db.prepare("SELECT * FROM ops_service_template_versions WHERE template_id=? AND status='draft' ORDER BY version_no DESC LIMIT 1").get(+templateId)
      : db.prepare("SELECT * FROM ops_service_template_versions WHERE template_id=? AND version_no=?").get(+templateId, +input.versionNo);
    if (version && version.status === "published") fail("published version is immutable", "immutable");
    const ts = nowIso();
    if (!version) {
      const next = db.prepare("SELECT COALESCE(MAX(version_no),0)+1 AS n FROM ops_service_template_versions WHERE template_id=?").get(+templateId).n;
      const info = db.prepare(
        `INSERT INTO ops_service_template_versions(
          template_id,version_no,status,cycle_days,start_condition,provider_name,estimated_cost_cents,max_cost_cents,config_json,created_at,updated_at
        ) VALUES (?,?,'draft',?,?,?,?,?,?,?,?)`
      ).run(
        +templateId,
        next,
        Math.max(1, Number(input.cycleDays) || 30),
        String(input.startCondition || "package_activated"),
        String(input.providerName || "").trim(),
        Math.max(0, Number(input.estimatedCostCents) || 0),
        Math.max(0, Number(input.maxCostCents) || 0),
        JSON.stringify(input.config || {}),
        ts,
        ts
      );
      version = db.prepare("SELECT * FROM ops_service_template_versions WHERE id=?").get(info.lastInsertRowid);
    } else {
      db.prepare(
        `UPDATE ops_service_template_versions SET cycle_days=?,start_condition=?,provider_name=?,estimated_cost_cents=?,
         max_cost_cents=?,config_json=?,updated_at=? WHERE id=?`
      ).run(
        input.cycleDays != null ? Math.max(1, Number(input.cycleDays) || 1) : version.cycle_days,
        String(input.startCondition != null ? input.startCondition : version.start_condition),
        String(input.providerName != null ? input.providerName : version.provider_name).trim(),
        input.estimatedCostCents != null ? Math.max(0, Number(input.estimatedCostCents) || 0) : version.estimated_cost_cents,
        input.maxCostCents != null ? Math.max(0, Number(input.maxCostCents) || 0) : version.max_cost_cents,
        JSON.stringify(input.config || parseJson(version.config_json, {})),
        ts,
        version.id
      );
    }
    if (Array.isArray(input.tasks)) {
      db.prepare("DELETE FROM ops_service_template_tasks WHERE version_id=?").run(version.id);
      const insert = db.prepare(
        `INSERT INTO ops_service_template_tasks(
          version_id,title,timing_type,timing_value,execution_mode,result_schema_json,
          estimated_cost_cents,escalation_json,sort_order,created_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?)`
      );
      input.tasks.forEach((task, index) => {
        if (!String(task.title || "").trim()) fail("运营任务名称必填");
        insert.run(
          version.id,
          String(task.title).trim(),
          String(task.timingType || "day"),
          Number(task.timingValue) || 0,
          String(task.executionMode || "manual"),
          JSON.stringify(task.resultSchema || {}),
          Math.max(0, Number(task.estimatedCostCents) || 0),
          JSON.stringify(task.escalation || {}),
          Number(task.sortOrder) || index,
          ts
        );
      });
    }
    db.prepare("UPDATE ops_service_templates SET updated_at=? WHERE id=?").run(ts, +templateId);
    return getOpsTemplate(templateId, input.doctorId).versions.find((item) => item.id === version.id);
  });

  function saveOpsDraft(id, input = {}) {
    return saveOpsDraftTx(id, input);
  }

  const publishOpsTx = transactional(db, (id, versionNo) => {
    const version = db.prepare("SELECT * FROM ops_service_template_versions WHERE template_id=? AND version_no=?").get(+id, +versionNo);
    if (!version) fail("运营模板版本不存在", "not_found");
    if (version.status === "published") return { id: version.id, versionNo: version.version_no, status: version.status };
    const tasks = db.prepare("SELECT * FROM ops_service_template_tasks WHERE version_id=?").all(version.id);
    if (!version.provider_name || !tasks.length) fail("发布前必须配置服务方和任务");
    const ts = nowIso();
    db.prepare("UPDATE ops_service_template_versions SET status='published',published_at=?,updated_at=? WHERE id=?").run(ts, ts, version.id);
    db.prepare("UPDATE ops_service_templates SET status='published',current_version_id=?,updated_at=? WHERE id=?").run(version.id, ts, +id);
    return { id: version.id, templateId: +id, versionNo: version.version_no, status: "published" };
  });

  function publishOpsVersion(id, versionNo) {
    return publishOpsTx(id, versionNo);
  }

  function disableOpsTemplate(id) {
    const info = db.prepare("UPDATE ops_service_templates SET status='disabled',updated_at=? WHERE id=?").run(nowIso(), +id);
    if (!info.changes) fail("运营模板不存在", "not_found");
    return mapOps(db.prepare("SELECT * FROM ops_service_templates WHERE id=?").get(+id));
  }

  function mapGoods(row) {
    if (!row) return null;
    const stock = db.prepare("SELECT * FROM mall_goods_inventory WHERE goods_sku_id=?").get(row.id) || {
      on_hand: 0,
      reserved: 0,
      sold: 0,
    };
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      supplierName: row.supplier_name,
      purchaseCostCents: row.purchase_cost_cents,
      logisticsCostCents: row.logistics_cost_cents,
      rebateCents: row.rebate_cents,
      logisticsConfig: parseJson(row.logistics_config_json, {}),
      afterSaleConfig: parseJson(row.after_sale_config_json, {}),
      status: row.status,
      versionNo: row.version_no,
      inventory: {
        onHand: stock.on_hand,
        reserved: stock.reserved,
        sold: stock.sold,
        available: stock.on_hand - stock.reserved - stock.sold,
      },
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  function listGoodsSkus(input = {}) {
    const clauses = [];
    const params = [];
    if (input.status) {
      clauses.push("status=?");
      params.push(String(input.status));
    }
    if (input.keyword) {
      clauses.push("(code LIKE ? OR name LIKE ? OR supplier_name LIKE ?)");
      const keyword = `%${String(input.keyword).trim()}%`;
      params.push(keyword, keyword, keyword);
    }
    return paginate(
      "mall_goods_skus",
      clauses.length ? `WHERE ${clauses.join(" AND ")}` : "",
      params,
      input,
      mapGoods
    );
  }

  function getGoodsSku(id) {
    return mapGoods(db.prepare("SELECT * FROM mall_goods_skus WHERE id=?").get(+id));
  }

  function createGoodsSku(input = {}) {
    const code = String(input.code || "").trim();
    const name = String(input.name || "").trim();
    const supplier = String(input.supplierName || "").trim();
    if (!code || !name || !supplier) fail("实物 SKU 编码、名称和供应商必填");
    const ts = nowIso();
    try {
      const createTx = transactional(db, () => {
        const info = db.prepare(
          `INSERT INTO mall_goods_skus(
            code,name,supplier_name,purchase_cost_cents,logistics_cost_cents,rebate_cents,
            logistics_config_json,after_sale_config_json,status,created_at,updated_at
          ) VALUES (?,?,?,?,?,?,?,?,?,?,?)`
        ).run(
          code,
          name,
          supplier,
          Math.max(0, Number(input.purchaseCostCents) || 0),
          Math.max(0, Number(input.logisticsCostCents) || 0),
          Math.max(0, Number(input.rebateCents) || 0),
          JSON.stringify(input.logisticsConfig || {}),
          JSON.stringify(input.afterSaleConfig || {}),
          input.status === "published" ? "published" : "draft",
          ts,
          ts
        );
        db.prepare("INSERT INTO mall_goods_inventory(goods_sku_id,on_hand,reserved,sold,updated_at) VALUES (?,0,0,0,?)")
          .run(info.lastInsertRowid, ts);
        return Number(info.lastInsertRowid);
      });
      return getGoodsSku(createTx());
    } catch (error) {
      if (/UNIQUE/.test(String(error.message))) fail("实物 SKU 编码已存在", "conflict");
      throw error;
    }
  }

  function updateGoodsSku(id, input = {}) {
    const row = db.prepare("SELECT * FROM mall_goods_skus WHERE id=?").get(+id);
    if (!row) fail("实物 SKU 不存在", "not_found");
    db.prepare(
      `UPDATE mall_goods_skus SET name=?,supplier_name=?,purchase_cost_cents=?,logistics_cost_cents=?,
       rebate_cents=?,logistics_config_json=?,after_sale_config_json=?,status=?,version_no=version_no+1,updated_at=? WHERE id=?`
    ).run(
      String(input.name != null ? input.name : row.name).trim(),
      String(input.supplierName != null ? input.supplierName : row.supplier_name).trim(),
      input.purchaseCostCents != null ? Math.max(0, Number(input.purchaseCostCents) || 0) : row.purchase_cost_cents,
      input.logisticsCostCents != null ? Math.max(0, Number(input.logisticsCostCents) || 0) : row.logistics_cost_cents,
      input.rebateCents != null ? Math.max(0, Number(input.rebateCents) || 0) : row.rebate_cents,
      JSON.stringify(input.logisticsConfig || parseJson(row.logistics_config_json, {})),
      JSON.stringify(input.afterSaleConfig || parseJson(row.after_sale_config_json, {})),
      ["draft", "published", "disabled"].includes(input.status) ? input.status : row.status,
      nowIso(),
      +id
    );
    return getGoodsSku(id);
  }

  const adjustInventoryTx = transactional(db, (id, input) => {
    const goods = db.prepare("SELECT * FROM mall_goods_skus WHERE id=?").get(+id);
    if (!goods) fail("实物 SKU 不存在", "not_found");
    const key = String(input.idempotencyKey || "").trim();
    const reason = String(input.reason || "").trim();
    const quantity = Number(input.quantity);
    if (!key || !reason || !Number.isInteger(quantity) || quantity === 0) fail("库存调整数量、原因和幂等号必填");
    const existing = db
      .prepare("SELECT id FROM mall_inventory_movements WHERE goods_sku_id=? AND idempotency_key=?")
      .get(+id, key);
    if (existing) return getGoodsSku(id).inventory;
    const stock = db.prepare("SELECT * FROM mall_goods_inventory WHERE goods_sku_id=?").get(+id);
    const nextOnHand = stock.on_hand + quantity;
    if (nextOnHand < stock.reserved + stock.sold) fail("库存调整后将低于已预占和已售数量");
    const ts = nowIso();
    db.prepare("UPDATE mall_goods_inventory SET on_hand=?,updated_at=? WHERE goods_sku_id=?").run(nextOnHand, ts, +id);
    db.prepare(
      `INSERT INTO mall_inventory_movements(
        goods_sku_id,movement_type,quantity,reason,idempotency_key,reference_type,reference_id,created_at
      ) VALUES (?,?,?,?,?,?,?,?)`
    ).run(+id, quantity > 0 ? "inbound" : "adjustment", quantity, reason, key, input.referenceType || null, input.referenceId || null, ts);
    return getGoodsSku(id).inventory;
  });

  function adjustInventory(id, input = {}) {
    return adjustInventoryTx(id, input);
  }

  function disableGoodsSku(id) {
    return updateGoodsSku(id, { status: "disabled" });
  }

  return {
    listBenefitSkus,
    getBenefitSku,
    createBenefitSku,
    saveBenefitDraft,
    publishBenefitVersion,
    disableBenefitSku,
    listOpsTemplates,
    getOpsTemplate,
    createOpsTemplate,
    saveOpsDraft,
    publishOpsVersion,
    disableOpsTemplate,
    listGoodsSkus,
    getGoodsSku,
    createGoodsSku,
    updateGoodsSku,
    adjustInventory,
    disableGoodsSku,
  };
}

module.exports = { createMasterData };
