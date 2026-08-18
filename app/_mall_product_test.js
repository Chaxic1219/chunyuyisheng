"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.NODE_ENV = "test";
process.env.SERVICE_PAY_PROVIDER = "mock";
process.env.SERVICE_PAY_ALLOW_MOCK = "1";
process.env.MP_AUTH_STUB = "1";
process.env.SMS_DEMO = "1";
process.env.TRIAGE_AI_DISABLED = "1";
process.env.DB_PATH = path.join(os.tmpdir(), `mall-v1-${Date.now()}.db`);

const tempDbFiles = [process.env.DB_PATH, `${process.env.DB_PATH}-wal`, `${process.env.DB_PATH}-shm`];
for (const file of tempDbFiles) fs.rmSync(file, { force: true });

const { db } = require("./db.js");
const { createServicePackage } = require("./modules/servicePackage");
const { getPaymentProvider } = require("./modules/servicePackage/providers/index.js");
const { inspect, cleanup } = require("./scripts/cleanup-legacy-mall.js");

async function main() {
try {
  const required = [
    "mall_benefit_skus",
    "mall_benefit_sku_versions",
    "mall_benefit_sku_items",
    "ops_service_templates",
    "ops_service_template_versions",
    "ops_service_template_tasks",
    "mall_goods_skus",
    "mall_goods_inventory",
    "mall_inventory_movements",
    "mall_spus",
    "mall_skus",
    "mall_sku_components",
    "mall_sku_cost_snapshots",
    "package_instances",
    "package_component_instances",
    "ops_service_instances",
    "ops_service_tasks",
    "mall_goods_fulfillments",
    "mall_audit_logs",
  ];

  for (const name of required) {
    assert.ok(
      db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name),
      name
    );
  }
  assert.strictEqual(db.prepare("SELECT COUNT(*) AS c FROM svc_products").get().c, 0);
  console.log("ok - mall schema and empty catalog");

  const svc = createServicePackage(db);
  const doctorId = Number(db.prepare("SELECT id FROM doctors ORDER BY id LIMIT 1").get().id);

  const benefit = svc.masterData.createBenefitSku({
    code: "QY-REAL-001",
    name: "真实权益",
    cycleDays: 30,
  });
  const benefitDraft = svc.masterData.saveBenefitDraft(benefit.id, {
    providerName: "春雨健康运营中心",
    estimatedCostCents: 8600,
    maxCostCents: 10800,
    items: [{ name: "在线问诊", quota: 2, unit: "次", benefitType: "total" }],
  });
  const publishedBenefit = svc.masterData.publishBenefitVersion(
    benefit.id,
    benefitDraft.versionNo
  );
  assert.strictEqual(publishedBenefit.status, "published");
  assert.throws(
    () =>
      svc.masterData.saveBenefitDraft(benefit.id, {
        versionNo: publishedBenefit.versionNo,
        items: [],
      }),
    /published/
  );

  const opsTemplate = svc.masterData.createOpsTemplate({
    doctorId,
    code: "OPS-REAL-001",
    name: "30天健康管理",
  });
  const opsDraft = svc.masterData.saveOpsDraft(opsTemplate.id, {
    doctorId,
    cycleDays: 30,
    providerName: "春雨健康运营中心",
    tasks: [{ title: "首次健康随访", timingType: "day", timingValue: 1, executionMode: "manual" }],
  });
  const publishedOps = svc.masterData.publishOpsVersion(opsTemplate.id, opsDraft.versionNo);
  assert.strictEqual(publishedOps.status, "published");
  assert.strictEqual(svc.masterData.getOpsTemplate(opsTemplate.id, doctorId + 9999), null);

  const goods = svc.masterData.createGoodsSku({
    code: "DEVICE-REAL-001",
    name: "智能血压计",
    supplierName: "真实设备供应商",
    purchaseCostCents: 9200,
    logisticsCostCents: 1800,
  });
  svc.masterData.updateGoodsSku(goods.id, { status: "published" });
  const firstInventory = svc.masterData.adjustInventory(goods.id, {
    quantity: 10,
    reason: "首次入库",
    idempotencyKey: "stock-real-001",
  });
  const repeatedInventory = svc.masterData.adjustInventory(goods.id, {
    quantity: 10,
    reason: "首次入库",
    idempotencyKey: "stock-real-001",
  });
  assert.strictEqual(firstInventory.onHand, 10);
  assert.deepStrictEqual(repeatedInventory, firstInventory);
  assert.strictEqual(
    repeatedInventory.available + repeatedInventory.reserved + repeatedInventory.sold,
    repeatedInventory.onHand
  );
  console.log("ok - real master data, immutable versions and inventory idempotency");

  const spu = svc.mallProducts.createSpu({
    doctorId,
    code: "SPU-HBP-001",
    name: "高血压健康管理",
    scene: "高血压管理",
  });
  for (let i = 0; i < 12; i += 1) {
    svc.mallProducts.createSku(spu.id, {
      code: `SKU-HBP-${String(i).padStart(2, "0")}`,
      name: `${30 + i}天版`,
      cycleDays: 30 + i,
      salePriceCents: 39900,
      listPriceCents: 49900,
      minimumPriceCents: 34900,
      minimumMarginBps: 2000,
    });
  }
  const skuPage = svc.mallProducts.listSkus(spu.id, { page: 1, pageSize: 10 });
  assert.strictEqual(skuPage.total, 12);
  const sku = skuPage.items[0];
  assert.throws(() => svc.mallProducts.publishSku(sku.id), /BENEFIT_SKU/);
  assert.throws(
    () =>
      svc.mallProducts.replaceComponents(sku.id, [
        {
          componentType: "BENEFIT_SKU",
          sourceId: benefit.id,
          sourceVersionId: publishedBenefit.id,
          quantity: 1,
        },
        {
          componentType: "BENEFIT_SKU",
          sourceId: benefit.id,
          sourceVersionId: publishedBenefit.id,
          quantity: 1,
        },
      ]),
    /one benefit/i
  );
  svc.mallProducts.replaceComponents(sku.id, [
    {
      componentType: "BENEFIT_SKU",
      sourceId: benefit.id,
      sourceVersionId: publishedBenefit.id,
      quantity: 1,
    },
    {
      componentType: "OPS_SERVICE_TEMPLATE",
      sourceId: opsTemplate.id,
      sourceVersionId: publishedOps.id,
      quantity: 1,
    },
    { componentType: "GOODS_SKU", sourceId: goods.id, quantity: 1 },
  ]);
  const bom = svc.mallProducts.getSku(sku.id).components;
  assert.strictEqual(bom.length, 3);
  assert.strictEqual(bom[0].type, "BENEFIT_SKU");
  assert.strictEqual(bom[0].name, bom[0].sourceName);
  assert.ok(bom[0].name);
  // 管理端前端传 type（非 componentType）也应可写
  const aliasSku = svc.mallProducts.createSku(spu.id, {
    code: `SKU-TYPE-ALIAS-${Date.now()}`,
    name: "字段别名校验 SKU",
    cycleDays: 30,
    salePriceCents: 39900,
    listPriceCents: 49900,
    minimumPriceCents: 29900,
    minimumMarginBps: 2000,
  });
  const aliasBom = svc.mallProducts.replaceComponents(aliasSku.id, [
    {
      type: "BENEFIT_SKU",
      sourceId: benefit.id,
      sourceVersionId: publishedBenefit.id,
      quantity: 1,
    },
    { type: "GOODS_SKU", sourceId: goods.id, quantity: 1 },
  ]);
  assert.strictEqual(aliasBom.length, 2);
  assert.strictEqual(aliasBom[0].type, "BENEFIT_SKU");
  assert.strictEqual(aliasBom[0].componentType, "BENEFIT_SKU");
  assert.ok(aliasBom[0].name);
  const quote = svc.mallProducts.quoteCost(sku.id, 0);
  assert.strictEqual(quote.estimatedTotalCents, 19600);
  assert.deepStrictEqual(svc.mallProducts.validatePublish(sku.id).blockers, []);
  assert.strictEqual(svc.mallProducts.publishSku(sku.id).status, "published");
  assert.strictEqual(svc.mallProducts.publishSpu(spu.id).status, "published");
  svc.mallProducts.offlineSpu(spu.id);
  assert.strictEqual(svc.mallProducts.getSpu(spu.id).status, "offline");
  assert.strictEqual(svc.mallProducts.getSku(sku.id).status, "offline");
  assert.strictEqual(svc.mallProducts.publishSku(sku.id).status, "published");
  assert.strictEqual(svc.mallProducts.publishSpu(spu.id).status, "published");
  console.log("ok - offline and republish sku/spu");
  console.log("ok - unlimited sale skus, unique benefit BOM and publish guardrails");

  const personInfo = db
    .prepare(
      "INSERT INTO persons(real_name,phone,created_at,updated_at) VALUES ('商城测试用户','13900000001',datetime('now'),datetime('now'))"
    )
    .run();
  const personId = Number(personInfo.lastInsertRowid);
  const cart = svc.cart.addItem(personId, { doctorId, skuId: sku.id, qty: 1 });
  assert.strictEqual(cart.items[0].skuId, sku.id);
  assert.strictEqual(cart.items[0].unitTotalCents, 39900);
  const orderBody = {
    items: [{ skuId: sku.id, qty: 1 }],
    receiverName: "商城测试用户",
    receiverPhone: "13900000001",
    receiverAddress: "北京市真实收货地址",
    agreementAccepted: true,
    privacyAccepted: true,
  };
  assert.throws(
    () =>
      svc.orders.createOrder(personId, {
        ...orderBody,
        items: [{ skuId: sku.id, qty: 1, clientPriceCents: 1 }],
        idempotencyKey: "mall-order-tampered",
      }),
    /client price|client_price|price/i
  );
  const mallOrder = svc.orders.createOrder(personId, {
    ...orderBody,
    idempotencyKey: "mall-order-real-001",
  });
  const repeatedOrder = svc.orders.createOrder(personId, {
    ...orderBody,
    idempotencyKey: "mall-order-real-001",
  });
  assert.strictEqual(repeatedOrder.id, mallOrder.id);
  assert.strictEqual(mallOrder.lines[0].skuId, sku.id);
  assert.strictEqual(svc.masterData.getGoodsSku(goods.id).inventory.reserved, 1);
  const cancellableOrder = svc.orders.createOrder(personId, {
    ...orderBody,
    idempotencyKey: "mall-order-cancel-001",
  });
  assert.strictEqual(svc.masterData.getGoodsSku(goods.id).inventory.reserved, 2);
  svc.orders.requestCancel(personId, cancellableOrder.id, "测试取消");
  assert.strictEqual(svc.masterData.getGoodsSku(goods.id).inventory.reserved, 1);
  const expiringOrder = svc.orders.createOrder(personId, {
    ...orderBody,
    idempotencyKey: "mall-order-expire-001",
  });
  db.prepare("UPDATE svc_orders SET created_at='2000-01-01T00:00:00.000Z' WHERE id=?").run(
    expiringOrder.id
  );
  svc.orders.closeExpiredPending(personId);
  assert.strictEqual(svc.masterData.getGoodsSku(goods.id).inventory.reserved, 1);
  console.log("ok - sku cart, server-priced order, inventory reservation and release");
  const originalNodeEnv = process.env.NODE_ENV;
  const originalAllowMock = process.env.SERVICE_PAY_ALLOW_MOCK;
  process.env.NODE_ENV = "production";
  delete process.env.SERVICE_PAY_ALLOW_MOCK;
  assert.throws(() => getPaymentProvider(), /mock.*production|production.*mock/i);
  process.env.NODE_ENV = originalNodeEnv;
  process.env.SERVICE_PAY_ALLOW_MOCK = originalAllowMock;

  await svc.payments.createPayment(personId, mallOrder.id);
  const packageRows = db.prepare("SELECT * FROM package_instances WHERE order_id=?").all(mallOrder.id);
  assert.strictEqual(packageRows.length, 1);
  assert.strictEqual(packageRows[0].status, "active");
  assert.strictEqual(
    db.prepare("SELECT COUNT(*) AS c FROM package_component_instances WHERE package_instance_id=?").get(packageRows[0].id).c,
    3
  );
  assert.strictEqual(db.prepare("SELECT COUNT(*) AS c FROM svc_entitlements WHERE order_line_id=?").get(mallOrder.lines[0].id).c, 1);
  assert.strictEqual(db.prepare("SELECT COUNT(*) AS c FROM ops_service_tasks").get().c, 1);
  assert.strictEqual(db.prepare("SELECT COUNT(*) AS c FROM mall_goods_fulfillments").get().c, 1);
  const paidInventory = svc.masterData.getGoodsSku(goods.id).inventory;
  assert.strictEqual(paidInventory.reserved, 0);
  assert.strictEqual(paidInventory.sold, 1);
  svc.fulfillment.processOrder(mallOrder.id);
  assert.strictEqual(db.prepare("SELECT COUNT(*) AS c FROM package_instances WHERE order_id=?").get(mallOrder.id).c, 1);
  assert.strictEqual(db.prepare("SELECT COUNT(*) AS c FROM mall_goods_fulfillments").get().c, 1);
  console.log("ok - production payment gate and idempotent mall fulfillment");

  const beforeCleanup = inspect(db);
  assert.ok(beforeCleanup.svc_orders >= 1);
  assert.throws(() => cleanup(db, { apply: true, failAfter: "svc_payments" }), /forced cleanup failure/);
  assert.strictEqual(inspect(db).svc_orders, beforeCleanup.svc_orders);
  const cleaned = cleanup(db, { apply: true });
  assert.strictEqual(cleaned.after.svc_orders, 0);
  assert.strictEqual(cleaned.after.svc_products, 0);
  assert.strictEqual(cleaned.orphans, 0);
  assert.strictEqual(db.prepare("SELECT COUNT(*) AS c FROM mall_spus").get().c, 1);
  console.log("ok - transactional legacy mall cleanup and rollback");
} finally {
  db.close();
  for (const file of tempDbFiles) fs.rmSync(file, { force: true });
}

}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
