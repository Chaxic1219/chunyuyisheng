"use strict";

/** 为王云程医生补第二个演示服务包（幂等，可重复执行） */
const CODES = {
  spu: "SPU-WYC-FOLLOWUP-30",
  sku: "SKU-WYC-FOLLOWUP-30",
};

function seedWangFollowupDemo(db, servicePackage) {
  const doctor = db
    .prepare("SELECT id,name FROM doctors WHERE name='王云程' AND active=1 ORDER BY id LIMIT 1")
    .get();
  if (!doctor) throw new Error("未找到已启用的王云程医生");

  const benefitVersion = db
    .prepare(
      `SELECT v.*, s.id AS benefit_sku_id
       FROM mall_benefit_sku_versions v
       JOIN mall_benefit_skus s ON s.id=v.benefit_sku_id
       WHERE s.code='BFT-WYC-FRACTURE-90' AND v.status='published'
       ORDER BY v.version_no DESC LIMIT 1`
    )
    .get();
  if (!benefitVersion) throw new Error("缺少已发布的 BFT-WYC-FRACTURE-90 权益，请先运行 seed-wang-fracture-package");

  const { mallProducts } = servicePackage;

  let spu = db.prepare("SELECT * FROM mall_spus WHERE code=?").get(CODES.spu);
  if (!spu) {
    spu = mallProducts.createSpu({
      doctorId: doctor.id,
      code: CODES.spu,
      name: "术后30天随访体验包",
      scene: "术后院外随访",
      targetPeople: "已完成手术、需要阶段性随访指导的患者",
      valueProposition: "30天在线权益 + 自动随访提醒，适合首次体验服务包",
      serviceBoundary:
        "本服务用于术后健康管理与复查提醒，不替代急诊处置与线下复查。出现持续高热、伤口渗血流脓等情况应及时线下就医。",
      cover: "",
    });
  }

  let sku = db.prepare("SELECT * FROM mall_skus WHERE code=?").get(CODES.sku);
  if (!sku) {
    sku = mallProducts.createSku(spu.id, {
      code: CODES.sku,
      name: "30天标准版",
      cycleDays: 30,
      salePriceCents: 29900,
      listPriceCents: 39900,
      minimumPriceCents: 19900,
      minimumMarginBps: 1500,
    });
  }

  if (sku.status !== "published") {
    mallProducts.replaceComponents(sku.id, [
      {
        componentType: "BENEFIT_SKU",
        sourceId: benefitVersion.benefit_sku_id,
        sourceVersionId: benefitVersion.id,
        quantity: 1,
      },
    ]);
    mallProducts.publishSku(sku.id);
  }
  if (spu.status !== "published") mallProducts.publishSpu(spu.id);

  return { doctorId: doctor.id, spuId: spu.id, skuId: sku.id };
}

if (require.main === module) {
  const { db } = require("../db.js");
  const { createServicePackage } = require("../modules/servicePackage");
  try {
    db.exec("BEGIN IMMEDIATE");
    const result = seedWangFollowupDemo(db, createServicePackage(db));
    db.exec("COMMIT");
    console.log(JSON.stringify(result));
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch (_) {}
    console.error(error.stack || error.message);
    process.exitCode = 1;
  } finally {
    try {
      db.close();
    } catch (_) {}
  }
}

module.exports = { CODES, seedWangFollowupDemo };
