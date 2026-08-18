"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.NODE_ENV = "test";
process.env.DB_PATH = path.join(os.tmpdir(), `wang-fracture-${Date.now()}.db`);
const files = [process.env.DB_PATH, `${process.env.DB_PATH}-wal`, `${process.env.DB_PATH}-shm`];
files.forEach((file) => fs.rmSync(file, { force: true }));

const { db } = require("./db.js");
const { createServicePackage } = require("./modules/servicePackage");
const { CODES, seedWangFracturePackage } = require("./scripts/seed-wang-fracture-package.js");

try {
  if (!db.prepare("SELECT id FROM doctors WHERE name='王云程'").get()) {
    db.prepare(
      `INSERT INTO doctors(slug,name,title,hospital,dept,active)
       VALUES ('wangyuncheng-package-test','王云程','主任医师','测试医院','骨科',1)`
    ).run();
  }
  db.prepare("UPDATE doctors SET active=1 WHERE name='王云程'").run();
  const service = createServicePackage(db);
  const first = seedWangFracturePackage(db, service);
  const second = seedWangFracturePackage(db, service);
  assert.deepStrictEqual(second, first);
  assert.strictEqual(db.prepare("SELECT COUNT(*) c FROM mall_spus WHERE code=?").get(CODES.spu).c, 1);
  assert.strictEqual(db.prepare("SELECT COUNT(*) c FROM mall_skus WHERE code=? AND status='published'").get(CODES.sku).c, 1);
  assert.strictEqual(db.prepare("SELECT COUNT(*) c FROM mall_sku_components WHERE sku_id=? AND status='active'").get(first.skuId).c, 3);
  assert.strictEqual(db.prepare("SELECT COUNT(*) c FROM mall_benefit_sku_items WHERE version_id=(SELECT current_version_id FROM mall_benefit_skus WHERE id=?)").get(first.benefitId).c, 5);
  assert.strictEqual(db.prepare("SELECT COUNT(*) c FROM ops_service_template_tasks WHERE version_id=(SELECT current_version_id FROM ops_service_templates WHERE id=?)").get(first.opsId).c, 8);
  assert.strictEqual(service.masterData.getGoodsSku(first.goodsId).inventory.available, 100);
  const product = service.catalog.getPublishedMallSpu(first.spuId);
  assert.strictEqual(product.skus[0].salePriceCents, 69900);
  assert.strictEqual(product.skus[0].components.length, 3);
  console.log("ok - 王云程骨折手术服务包已发布且重复执行不重复建档");
} finally {
  try { db.close(); } catch (_) {}
  files.forEach((file) => fs.rmSync(file, { force: true }));
}
