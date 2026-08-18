"use strict";

const CODES = {
  benefit: "BFT-WYC-FRACTURE-90",
  ops: "OPS-WYC-FRACTURE-90",
  goods: "GOOD-WYC-FRACTURE-KIT",
  spu: "SPU-WYC-FRACTURE",
  sku: "SKU-WYC-FRACTURE-90",
};

function seedWangFracturePackage(db, servicePackage) {
  const doctor = db.prepare("SELECT id,name FROM doctors WHERE name='王云程' AND active=1 ORDER BY id LIMIT 1").get();
  if (!doctor) throw new Error("未找到已启用的王云程医生");
  const { masterData, mallProducts } = servicePackage;

  let benefit = db.prepare("SELECT * FROM mall_benefit_skus WHERE code=?").get(CODES.benefit);
  if (!benefit) benefit = masterData.createBenefitSku({ code: CODES.benefit, name: "骨折术后90天综合权益", cycleDays: 90 });
  let benefitVersion = db.prepare("SELECT * FROM mall_benefit_sku_versions WHERE benefit_sku_id=? AND status='published' ORDER BY version_no DESC LIMIT 1").get(benefit.id);
  if (!benefitVersion) {
    benefitVersion = masterData.saveBenefitDraft(benefit.id, {
      providerName: "王云程医生团队",
      estimatedCostCents: 24000,
      maxCostCents: 36000,
      channelConfig: { channels: ["mini_program", "wechat_work"], responseHours: 24 },
      items: [
        { name: "在线图文问诊", benefitType: "total", quota: 3, unit: "次" },
        { name: "视频问诊", benefitType: "total", quota: 1, unit: "次" },
        { name: "影像及报告解析", benefitType: "total", quota: 3, unit: "次" },
        { name: "每日康复建议", benefitType: "daily", quota: 1, unit: "条" },
        { name: "饮食与热量评估", benefitType: "period_limit", quota: 12, unit: "次", applyRule: { period: "service_cycle" } },
      ],
    });
    masterData.publishBenefitVersion(benefit.id, benefitVersion.versionNo);
    benefitVersion = db.prepare("SELECT * FROM mall_benefit_sku_versions WHERE id=?").get(benefitVersion.id);
  }

  let ops = db.prepare("SELECT * FROM ops_service_templates WHERE code=?").get(CODES.ops);
  if (!ops) ops = masterData.createOpsTemplate({ doctorId: doctor.id, code: CODES.ops, name: "骨折术后90天康复随访", serviceType: "fracture_rehabilitation" });
  let opsVersion = db.prepare("SELECT * FROM ops_service_template_versions WHERE template_id=? AND status='published' ORDER BY version_no DESC LIMIT 1").get(ops.id);
  if (!opsVersion) {
    const tasks = [
      ["建立术后健康档案", "event", 0, "auto"],
      ["术后第1天伤口与疼痛随访", "day", 1, "manual"],
      ["术后第3天用药与肿胀随访", "day", 3, "manual"],
      ["术后第7天康复动作指导", "day", 7, "manual"],
      ["术后第14天拆线及复查提醒", "day", 14, "auto"],
      ["术后第30天影像复查提醒", "day", 30, "auto"],
      ["术后第60天功能恢复随访", "day", 60, "manual"],
      ["术后第90天阶段总结", "day", 90, "manual"],
    ].map(([title, timingType, timingValue, executionMode], sortOrder) => ({
      title, timingType, timingValue, executionMode, sortOrder,
      resultSchema: { fields: ["完成状态", "患者反馈", "异常备注"] },
      escalation: { redFlags: ["持续高热", "伤口渗血或流脓", "疼痛突然加重", "肢端麻木或发凉"], action: "建议尽快线下就医" },
      estimatedCostCents: executionMode === "manual" ? 1000 : 200,
    }));
    opsVersion = masterData.saveOpsDraft(ops.id, {
      doctorId: doctor.id,
      cycleDays: 90,
      startCondition: "package_activated",
      providerName: "王云程医生团队",
      estimatedCostCents: 8000,
      maxCostCents: 12000,
      config: { disease: "骨折术后", riskEscalation: true },
      tasks,
    });
    masterData.publishOpsVersion(ops.id, opsVersion.versionNo);
    opsVersion = db.prepare("SELECT * FROM ops_service_template_versions WHERE id=?").get(opsVersion.id);
  }

  let goods = db.prepare("SELECT * FROM mall_goods_skus WHERE code=?").get(CODES.goods);
  if (!goods) {
    goods = masterData.createGoodsSku({
      code: CODES.goods,
      name: "骨折术后居家康复包",
      supplierName: "春雨医服供应链中心",
      purchaseCostCents: 8800,
      logisticsCostCents: 1200,
      logisticsConfig: { carrier: "平台仓配", promise: "付款后48小时内发出", contents: ["弹力训练带", "冷敷袋", "康复训练手册"] },
      afterSaleConfig: { returnDays: 7, unopenedOnly: true },
      status: "published",
    });
  }
  if (masterData.getGoodsSku(goods.id).inventory.onHand === 0) {
    masterData.adjustInventory(goods.id, { quantity: 100, reason: "王云程骨折服务包首批入库", idempotencyKey: "WYC-FRACTURE-KIT-INITIAL-100" });
  }

  let spu = db.prepare("SELECT * FROM mall_spus WHERE code=?").get(CODES.spu);
  if (!spu) {
    spu = mallProducts.createSpu({
      doctorId: doctor.id,
      code: CODES.spu,
      name: "王云程骨折手术康复服务包",
      scene: "骨折术后康复管理",
      targetPeople: "已完成骨折手术、需要院外随访与康复管理的患者",
      valueProposition: "医生权益、自动随访、康复指导与居家康复用品的一体化90天服务",
      serviceBoundary: "本服务用于术后健康管理与复查提醒，不替代急诊处置、线下复查、影像检查及医生处方。出现持续高热、伤口渗血流脓、疼痛突然加重或肢端麻木发凉时应及时线下就医。",
    });
  }

  let sku = db.prepare("SELECT * FROM mall_skus WHERE code=?").get(CODES.sku);
  if (!sku) {
    sku = mallProducts.createSku(spu.id, {
      code: CODES.sku,
      name: "90天全功能版",
      cycleDays: 90,
      salePriceCents: 69900,
      listPriceCents: 89900,
      minimumPriceCents: 59900,
      minimumMarginBps: 2000,
    });
  }
  if (sku.status !== "published") {
    mallProducts.replaceComponents(sku.id, [
      { componentType: "BENEFIT_SKU", sourceId: benefit.id, sourceVersionId: benefitVersion.id, quantity: 1 },
      { componentType: "OPS_SERVICE_TEMPLATE", sourceId: ops.id, sourceVersionId: opsVersion.id, quantity: 1 },
      { componentType: "GOODS_SKU", sourceId: goods.id, quantity: 1 },
    ]);
    mallProducts.publishSku(sku.id);
  }
  if (spu.status !== "published") mallProducts.publishSpu(spu.id);

  return { doctorId: doctor.id, spuId: spu.id, skuId: sku.id, benefitId: benefit.id, opsId: ops.id, goodsId: goods.id };
}

if (require.main === module) {
  const { db } = require("../db.js");
  const { createServicePackage } = require("../modules/servicePackage");
  try {
    db.exec("BEGIN IMMEDIATE");
    const result = seedWangFracturePackage(db, createServicePackage(db));
    db.exec("COMMIT");
    console.log(JSON.stringify(result));
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch (_) {}
    console.error(error.stack || error.message);
    process.exitCode = 1;
  } finally {
    try { db.close(); } catch (_) {}
  }
}

module.exports = { CODES, seedWangFracturePackage };
