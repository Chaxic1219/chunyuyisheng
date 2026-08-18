"use strict";

/** 为周玉春医生创建 3 个已发布服务包（幂等，可重复执行） */
const DOCTOR_SLUG = "zhouyuchun";

const PACKAGES = [
  {
    codes: {
      benefit: "BFT-ZYC-MEN-90",
      ops: "OPS-ZYC-MEN-90",
      goods: "GOOD-ZYC-WELLNESS-KIT",
      spu: "SPU-ZYC-MEN-90",
      sku: "SKU-ZYC-MEN-90",
    },
    benefit: {
      name: "男性综合健康90天权益",
      cycleDays: 90,
      estimatedCostCents: 22000,
      maxCostCents: 32000,
      items: [
        { name: "在线图文问诊", benefitType: "total", quota: 3, unit: "次" },
        { name: "视频问诊", benefitType: "total", quota: 1, unit: "次" },
        { name: "检验报告解读", benefitType: "total", quota: 2, unit: "次" },
        { name: "每日健康建议", benefitType: "daily", quota: 1, unit: "条" },
        { name: "饮食与作息评估", benefitType: "period_limit", quota: 12, unit: "次", applyRule: { period: "service_cycle" } },
      ],
    },
    ops: {
      code: "OPS-ZYC-MEN-90",
      name: "男性综合健康90天随访",
      serviceType: "andrology_rehab",
      cycleDays: 90,
      estimatedCostCents: 7000,
      maxCostCents: 11000,
      tasks: [
        ["建立健康管理档案", "event", 0, "auto"],
        ["第3天症状与用药随访", "day", 3, "manual"],
        ["第7天生活方式评估", "day", 7, "manual"],
        ["第14天阶段性反馈", "day", 14, "manual"],
        ["第30天复查提醒", "day", 30, "auto"],
        ["第60天功能恢复随访", "day", 60, "manual"],
        ["第90天阶段总结", "day", 90, "manual"],
      ],
    },
    goods: {
      code: "GOOD-ZYC-WELLNESS-KIT",
      name: "男性调理居家礼包",
      purchaseCostCents: 6800,
      logisticsCostCents: 1200,
      inventory: 100,
      idempotencyKey: "ZYC-WELLNESS-KIT-INITIAL-100",
    },
    spu: {
      name: "周玉春男性综合健康管理服务包",
      scene: "男性亚健康与功能调理",
      targetPeople: "存在男性功能、泌尿或亚健康问题，需要90天系统随访管理的患者",
      valueProposition: "权益问诊、自动随访、生活方式指导与调理礼包一体化服务",
      serviceBoundary:
        "本服务用于男性健康管理与复查提醒，不替代急诊处置与线下面诊。出现急性疼痛、持续高热、肉眼血尿等情况应及时线下就医。",
    },
    sku: {
      name: "90天全功能版",
      cycleDays: 90,
      salePriceCents: 69900,
      listPriceCents: 89900,
      minimumPriceCents: 59900,
      minimumMarginBps: 2000,
    },
    withOps: true,
    withGoods: true,
  },
  {
    codes: {
      benefit: "BFT-ZYC-FOLLOWUP-30",
      spu: "SPU-ZYC-FOLLOWUP-30",
      sku: "SKU-ZYC-FOLLOWUP-30",
    },
    benefit: {
      name: "男性健康30天体验权益",
      cycleDays: 30,
      estimatedCostCents: 8000,
      maxCostCents: 12000,
      items: [
        { name: "在线图文问诊", benefitType: "total", quota: 1, unit: "次" },
        { name: "检验报告解读", benefitType: "total", quota: 1, unit: "次" },
        { name: "每日健康建议", benefitType: "daily", quota: 1, unit: "条" },
      ],
    },
    spu: {
      name: "30天男性健康随访体验包",
      scene: "男性健康院外随访",
      targetPeople: "首次体验服务包、需要阶段性随访指导的患者",
      valueProposition: "30天在线权益 + 随访提醒，适合首次体验",
      serviceBoundary:
        "本服务用于健康管理与复查提醒，不替代急诊处置与线下面诊。出现急性不适应及时线下就医。",
    },
    sku: {
      name: "30天标准版",
      cycleDays: 30,
      salePriceCents: 29900,
      listPriceCents: 39900,
      minimumPriceCents: 19900,
      minimumMarginBps: 1500,
    },
    withOps: false,
    withGoods: false,
  },
  {
    codes: {
      benefit: "BFT-ZYC-FERTILITY-60",
      ops: "OPS-ZYC-FERTILITY-60",
      spu: "SPU-ZYC-FERTILITY-60",
      sku: "SKU-ZYC-FERTILITY-60",
    },
    benefit: {
      name: "备孕调理60天权益",
      cycleDays: 60,
      estimatedCostCents: 15000,
      maxCostCents: 22000,
      items: [
        { name: "在线图文问诊", benefitType: "total", quota: 2, unit: "次" },
        { name: "视频问诊", benefitType: "total", quota: 1, unit: "次" },
        { name: "检验报告解读", benefitType: "total", quota: 2, unit: "次" },
        { name: "饮食与作息评估", benefitType: "period_limit", quota: 8, unit: "次", applyRule: { period: "service_cycle" } },
      ],
    },
    ops: {
      code: "OPS-ZYC-FERTILITY-60",
      name: "备孕调理60天随访",
      serviceType: "fertility_care",
      cycleDays: 60,
      estimatedCostCents: 5000,
      maxCostCents: 8000,
      tasks: [
        ["建立备孕健康档案", "event", 0, "auto"],
        ["第7天生活方式评估", "day", 7, "manual"],
        ["第14天检查指标跟进", "day", 14, "manual"],
        ["第30天阶段性反馈", "day", 30, "manual"],
        ["第60天阶段总结", "day", 60, "manual"],
      ],
    },
    spu: {
      name: "60天备孕调理服务包",
      scene: "男性备孕与生殖健康",
      targetPeople: "有备孕计划、需要系统调理与随访指导的男性患者",
      valueProposition: "备孕权益 + 自动随访 + 生活方式指导",
      serviceBoundary:
        "本服务用于备孕健康管理与复查提醒，不替代生殖专科面诊与实验室检查。出现急性不适应及时线下就医。",
    },
    sku: {
      name: "60天标准版",
      cycleDays: 60,
      salePriceCents: 49900,
      listPriceCents: 69900,
      minimumPriceCents: 39900,
      minimumMarginBps: 1800,
    },
    withOps: true,
    withGoods: false,
  },
];

function ensureBenefit(db, masterData, doctorName, spec, code) {
  let benefit = db.prepare("SELECT * FROM mall_benefit_skus WHERE code=?").get(code);
  if (!benefit) {
    benefit = masterData.createBenefitSku({
      code,
      name: spec.name,
      cycleDays: spec.cycleDays,
    });
  }
  let version = db
    .prepare(
      "SELECT * FROM mall_benefit_sku_versions WHERE benefit_sku_id=? AND status='published' ORDER BY version_no DESC LIMIT 1"
    )
    .get(benefit.id);
  if (!version) {
    version = masterData.saveBenefitDraft(benefit.id, {
      providerName: `${doctorName}医生团队`,
      estimatedCostCents: spec.estimatedCostCents,
      maxCostCents: spec.maxCostCents,
      channelConfig: { channels: ["mini_program", "wechat_work"], responseHours: 24 },
      items: spec.items,
    });
    masterData.publishBenefitVersion(benefit.id, version.versionNo);
    version = db.prepare("SELECT * FROM mall_benefit_sku_versions WHERE id=?").get(version.id);
  }
  return { benefit, version };
}

function ensureOps(db, masterData, doctorId, doctorName, spec) {
  let ops = db.prepare("SELECT * FROM ops_service_templates WHERE code=?").get(spec.code);
  if (!ops) {
    ops = masterData.createOpsTemplate({
      doctorId,
      code: spec.code,
      name: spec.name,
      serviceType: spec.serviceType,
    });
  }
  let version = db
    .prepare(
      "SELECT * FROM ops_service_template_versions WHERE template_id=? AND status='published' ORDER BY version_no DESC LIMIT 1"
    )
    .get(ops.id);
  if (!version) {
    const tasks = spec.tasks.map(([title, timingType, timingValue, executionMode], sortOrder) => ({
      title,
      timingType,
      timingValue,
      executionMode,
      sortOrder,
      resultSchema: { fields: ["完成状态", "患者反馈", "异常备注"] },
      escalation: {
        redFlags: ["持续高热", "剧烈疼痛", "肉眼血尿", "突发意识障碍"],
        action: "建议尽快线下就医",
      },
      estimatedCostCents: executionMode === "manual" ? 900 : 200,
    }));
    version = masterData.saveOpsDraft(ops.id, {
      doctorId,
      cycleDays: spec.cycleDays,
      startCondition: "package_activated",
      providerName: `${doctorName}医生团队`,
      estimatedCostCents: spec.estimatedCostCents,
      maxCostCents: spec.maxCostCents,
      config: { disease: spec.name, riskEscalation: true },
      tasks,
    });
    masterData.publishOpsVersion(ops.id, version.versionNo);
    version = db.prepare("SELECT * FROM ops_service_template_versions WHERE id=?").get(version.id);
  }
  return { ops, version };
}

function ensureGoods(db, masterData, spec) {
  let goods = db.prepare("SELECT * FROM mall_goods_skus WHERE code=?").get(spec.code);
  if (!goods) {
    goods = masterData.createGoodsSku({
      code: spec.code,
      name: spec.name,
      supplierName: "春雨医服供应链中心",
      purchaseCostCents: spec.purchaseCostCents,
      logisticsCostCents: spec.logisticsCostCents,
      logisticsConfig: { carrier: "平台仓配", promise: "付款后48小时内发出", contents: ["调理手册", "生活方式指导卡"] },
      afterSaleConfig: { returnDays: 7, unopenedOnly: true },
      status: "published",
    });
  }
  if (masterData.getGoodsSku(goods.id).inventory.onHand < spec.inventory) {
    masterData.adjustInventory(goods.id, {
      quantity: spec.inventory,
      reason: `${spec.name}首批入库`,
      idempotencyKey: spec.idempotencyKey,
    });
  }
  return goods;
}

function ensurePublishedPackage(db, mallProducts, doctorId, pkg, refs) {
  let spu = db.prepare("SELECT * FROM mall_spus WHERE code=?").get(pkg.codes.spu);
  if (!spu) {
    spu = mallProducts.createSpu({
      doctorId,
      code: pkg.codes.spu,
      ...pkg.spu,
    });
  }

  let sku = db.prepare("SELECT * FROM mall_skus WHERE code=?").get(pkg.codes.sku);
  if (!sku) {
    sku = mallProducts.createSku(spu.id, {
      code: pkg.codes.sku,
      ...pkg.sku,
    });
  }

  if (sku.status !== "published") {
    const components = [
      {
        componentType: "BENEFIT_SKU",
        sourceId: refs.benefit.id,
        sourceVersionId: refs.benefitVersion.id,
        quantity: 1,
      },
    ];
    if (pkg.withOps && refs.ops && refs.opsVersion) {
      components.push({
        componentType: "OPS_SERVICE_TEMPLATE",
        sourceId: refs.ops.id,
        sourceVersionId: refs.opsVersion.id,
        quantity: 1,
      });
    }
    if (pkg.withGoods && refs.goods) {
      components.push({
        componentType: "GOODS_SKU",
        sourceId: refs.goods.id,
        quantity: 1,
      });
    }
    mallProducts.replaceComponents(sku.id, components);
    mallProducts.publishSku(sku.id);
  }
  if (spu.status !== "published") mallProducts.publishSpu(spu.id);

  return { spuId: spu.id, skuId: sku.id, spuCode: spu.code, skuCode: sku.code, spuName: spu.name };
}

function seedZhouServicePackages(db, servicePackage) {
  const doctor = db
    .prepare("SELECT id,name FROM doctors WHERE slug=? ORDER BY id LIMIT 1")
    .get(DOCTOR_SLUG);
  if (!doctor) throw new Error(`未找到 slug=${DOCTOR_SLUG} 的医生`);

  const { masterData, mallProducts } = servicePackage;
  const results = [];

  for (const pkg of PACKAGES) {
    const { benefit, version: benefitVersion } = ensureBenefit(
      db,
      masterData,
      doctor.name,
      pkg.benefit,
      pkg.codes.benefit
    );
    const refs = { benefit, benefitVersion };
    if (pkg.withOps && pkg.ops) {
      const opsBundle = ensureOps(db, masterData, doctor.id, doctor.name, pkg.ops);
      refs.ops = opsBundle.ops;
      refs.opsVersion = opsBundle.version;
    }
    if (pkg.withGoods && pkg.goods) refs.goods = ensureGoods(db, masterData, pkg.goods);
    results.push(ensurePublishedPackage(db, mallProducts, doctor.id, pkg, refs));
  }

  return { doctorId: doctor.id, doctorName: doctor.name, packages: results };
}

if (require.main === module) {
  const { db } = require("../db.js");
  const { createServicePackage } = require("../modules/servicePackage");
  try {
    db.exec("BEGIN IMMEDIATE");
    const result = seedZhouServicePackages(db, createServicePackage(db));
    db.exec("COMMIT");
    console.log(JSON.stringify(result, null, 2));
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

module.exports = { PACKAGES, seedZhouServicePackages };
