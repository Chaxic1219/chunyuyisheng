"use strict";

const { nowIso } = require("./schema.js");

function dateOnly(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function addDays(value, days) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return dateOnly(date);
}

function runTx(db, fn) {
  db.exec("SAVEPOINT mall_fulfillment");
  try {
    const result = fn();
    db.exec("RELEASE mall_fulfillment");
    return result;
  } catch (error) {
    try { db.exec("ROLLBACK TO mall_fulfillment"); } catch (_) { /* ignore */ }
    try { db.exec("RELEASE mall_fulfillment"); } catch (_) { /* ignore */ }
    throw error;
  }
}

function createFulfillment(db, ordersApi, entitlementsApi) {
  function ensureBenefit(order, line, component, componentInstanceId, ts) {
    let legacyInstanceId = line.instanceId;
    const cycleDays = Number(line.snapshot?.sku?.cycleDays || 30);
    const start = dateOnly();
    if (!legacyInstanceId) {
      const info = db.prepare(
        `INSERT INTO svc_instances(
          order_id,person_id,doctor_id,version_id,title,status,service_start_date,
          service_end_date,summary_json,created_at,updated_at
        ) VALUES (?,?,?,?,?,'active',?,?,?, ?,?)`
      ).run(
        order.id,
        order.personId,
        order.doctorId,
        0,
        line.title,
        start,
        addDays(start, Math.max(0, cycleDays - 1)),
        JSON.stringify({ source: "mall", packageComponentInstanceId: componentInstanceId }),
        ts,
        ts
      );
      legacyInstanceId = Number(info.lastInsertRowid);
      db.prepare("UPDATE svc_order_lines SET instance_id=? WHERE id=?").run(legacyInstanceId, line.id);
    }
    const items = db.prepare(
      "SELECT * FROM mall_benefit_sku_items WHERE version_id=? ORDER BY sort_order,id"
    ).all(component.sourceVersionId).map((item) => ({
      id: item.id,
      componentCode: `BEN-${component.sourceId}-${item.id}`,
      name: item.name,
      type: "service",
      unit: item.unit,
      benefitType: String(item.benefit_type).toLowerCase() === "unlimited" ? "UNLIMITED" : "TOTAL_LIMIT",
      totalQuota: item.quota,
      startDay: 0,
      endDay: Math.max(0, cycleDays - 1),
      provider: { name: component.providerName || "" },
    }));
    entitlementsApi.ensureForInstance({
      instance: {
        id: legacyInstanceId,
        personId: order.personId,
        doctorId: order.doctorId,
        serviceStartDate: start,
        serviceEndDate: addDays(start, Math.max(0, cycleDays - 1)),
      },
      orderLine: line,
      benefitItems: items,
    });
    return { instanceId: legacyInstanceId, entitlementCount: items.length };
  }

  function scheduledAt(start, task) {
    if (task.timing_type === "day") return `${addDays(start, task.timing_value)}T09:00:00.000Z`;
    return null;
  }

  function ensureOps(order, component, componentInstanceId, ts) {
    const version = db.prepare("SELECT * FROM ops_service_template_versions WHERE id=?").get(component.sourceVersionId);
    if (!version) throw new Error("运营服务模板版本不存在");
    const start = dateOnly();
    db.prepare(
      `INSERT OR IGNORE INTO ops_service_instances(
        package_component_instance_id,person_id,doctor_id,template_id,template_version_id,
        status,start_date,end_date,snapshot_json,created_at,updated_at
      ) VALUES (?,?,?,?,?,'active',?,?,?,?,?)`
    ).run(
      componentInstanceId,
      order.personId,
      order.doctorId,
      component.sourceId,
      component.sourceVersionId,
      start,
      addDays(start, Math.max(0, version.cycle_days - 1)),
      JSON.stringify(component.snapshot || {}),
      ts,
      ts
    );
    const instance = db.prepare("SELECT id FROM ops_service_instances WHERE package_component_instance_id=?").get(componentInstanceId);
    const tasks = db.prepare("SELECT * FROM ops_service_template_tasks WHERE version_id=? ORDER BY sort_order,id").all(component.sourceVersionId);
    const insert = db.prepare(
      `INSERT OR IGNORE INTO ops_service_tasks(
        service_instance_id,template_task_id,title,scheduled_at,status,result_json,created_at,updated_at
      ) VALUES (?,?,?,?,'pending','{}',?,?)`
    );
    for (const task of tasks) insert.run(instance.id, task.id, task.title, scheduledAt(start, task), ts, ts);
    return { serviceInstanceId: instance.id, taskCount: tasks.length };
  }

  function ensureGoods(order, line, component, componentInstanceId, ts) {
    const quantity = Number(component.quantity || 1) * Number(line.qty || 1);
    db.prepare(
      `INSERT OR IGNORE INTO mall_goods_fulfillments(
        package_component_instance_id,goods_sku_id,quantity,status,receiver_snapshot_json,created_at,updated_at
      ) VALUES (?,?,?,'pending_shipment',?,?,?)`
    ).run(
      componentInstanceId,
      component.sourceId,
      quantity,
      JSON.stringify({ name: order.receiverName, phone: order.receiverPhone, address: order.receiverAddress }),
      ts,
      ts
    );
    const key = `sold:${line.id}:${component.sourceId}`;
    if (!db.prepare("SELECT 1 FROM mall_inventory_movements WHERE idempotency_key=?").get(key)) {
      const updated = db.prepare(
        "UPDATE mall_goods_inventory SET reserved=reserved-?,sold=sold+?,updated_at=? WHERE goods_sku_id=? AND reserved>=?"
      ).run(quantity, quantity, ts, component.sourceId, quantity);
      if (!updated.changes) throw new Error(`${component.name || "商品"}库存扣减失败`);
      db.prepare(
        `INSERT INTO mall_inventory_movements(
          goods_sku_id,movement_type,quantity,reason,idempotency_key,reference_type,reference_id,created_at
        ) VALUES (?,'sold',?,'订单支付成功',?,'order_line',?,?)`
      ).run(component.sourceId, quantity, key, line.id, ts);
    }
    return { fulfillmentId: db.prepare("SELECT id FROM mall_goods_fulfillments WHERE package_component_instance_id=?").get(componentInstanceId).id };
  }

  function processOrder(orderId) {
    const order = ordersApi.getById(orderId);
    if (!order) throw new Error("订单不存在");
    const lines = order.lines.filter((line) => line.skuId != null);
    if (!lines.length) return null;
    return runTx(db, () => {
      const ts = nowIso();
      for (const line of lines) {
        db.prepare(
          `INSERT OR IGNORE INTO package_instances(
            order_id,order_line_id,person_id,doctor_id,mall_spu_id,mall_sku_id,status,snapshot_json,created_at,updated_at
          ) VALUES (?,?,?,?,?,?,'pending',?,?,?)`
        ).run(order.id, line.id, order.personId, order.doctorId, line.spuId, line.skuId, JSON.stringify(line.snapshot), ts, ts);
        const pack = db.prepare("SELECT * FROM package_instances WHERE order_line_id=?").get(line.id);
        for (const component of line.componentSnapshot) {
          const key = `fulfill:${line.id}:${component.type}:${component.sourceId}:${component.sourceVersionId || 0}`;
          db.prepare(
            `INSERT OR IGNORE INTO package_component_instances(
              package_instance_id,component_type,source_id,source_version_id,status,idempotency_key,created_at,updated_at
            ) VALUES (?,?,?,?,'pending',?,?,?)`
          ).run(pack.id, component.type, component.sourceId, component.sourceVersionId, key, ts, ts);
          const instance = db.prepare("SELECT * FROM package_component_instances WHERE idempotency_key=?").get(key);
          if (instance.status === "succeeded") continue;
          db.prepare("UPDATE package_component_instances SET status='processing',attempts=attempts+1,updated_at=? WHERE id=?").run(ts, instance.id);
          let result;
          if (component.type === "BENEFIT_SKU") result = ensureBenefit(order, line, component, instance.id, ts);
          if (component.type === "OPS_SERVICE_TEMPLATE") result = ensureOps(order, component, instance.id, ts);
          if (component.type === "GOODS_SKU") result = ensureGoods(order, line, component, instance.id, ts);
          db.prepare("UPDATE package_component_instances SET status='succeeded',result_json=?,error_message=NULL,updated_at=? WHERE id=?")
            .run(JSON.stringify(result || {}), ts, instance.id);
        }
        db.prepare("UPDATE package_instances SET status='active',updated_at=? WHERE id=?").run(ts, pack.id);
      }
      db.prepare("UPDATE svc_orders SET status='active',service_start_date=?,updated_at=? WHERE id=?")
        .run(dateOnly(), ts, order.id);
      return db.prepare("SELECT * FROM package_instances WHERE order_id=? ORDER BY id").all(order.id);
    });
  }

  function getForLegacyInstance(instanceId, personId) {
    const pack = db.prepare(
      `SELECT p.* FROM package_instances p
       JOIN svc_order_lines l ON l.id=p.order_line_id
       WHERE l.instance_id=? AND p.person_id=?`
    ).get(+instanceId, +personId);
    if (!pack) return null;
    const components = db.prepare(
      "SELECT * FROM package_component_instances WHERE package_instance_id=? ORDER BY id"
    ).all(pack.id).map((component) => {
      const item = {
        id: component.id,
        type: component.component_type,
        status: component.status,
        result: JSON.parse(component.result_json || "{}"),
      };
      if (component.component_type === "OPS_SERVICE_TEMPLATE") {
        const service = db.prepare("SELECT * FROM ops_service_instances WHERE package_component_instance_id=?").get(component.id);
        item.tasks = service ? db.prepare("SELECT id,title,scheduled_at AS scheduledAt,status FROM ops_service_tasks WHERE service_instance_id=? ORDER BY id").all(service.id) : [];
      }
      if (component.component_type === "GOODS_SKU") {
        const goods = db.prepare("SELECT status,carrier,tracking_no AS trackingNo FROM mall_goods_fulfillments WHERE package_component_instance_id=?").get(component.id);
        item.fulfillment = goods || null;
      }
      return item;
    });
    return { id: pack.id, status: pack.status, components };
  }

  return { processOrder, getForLegacyInstance };
}

module.exports = { createFulfillment };
