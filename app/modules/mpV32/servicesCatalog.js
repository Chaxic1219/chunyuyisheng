"use strict";

/**
 * 健康服务中心数据。
 * 商品优先从服务包 DB（svc_products / svc_product_versions）读取；
 * 无上架商品时保持「服务筹备中」空态。
 */

const CATEGORIES = [
  { key: "plan", icon: "health", label: "健康计划", url: "/pages/plans/detail" },
  { key: "catalog", icon: "replies", label: "服务包", url: "/pages/services/catalog" },
  { key: "mine", icon: "archive", label: "我的服务", url: "/pages/services/mine-services" },
];

function getServiceCenter(doctorName = "", opts = {}) {
  const who = doctorName ? `${doctorName}医生` : "当前医生";
  const products = Array.isArray(opts.products) ? opts.products : [];
  const hasProducts = products.length > 0;
  return {
    current: hasProducts
      ? {
          title: products[0].title || "可购服务包",
          desc: (() => {
            const sub = String(products[0].subtitle || products[0].desc || "").trim();
            return sub ? `${who}：${sub}` : `${who}的术后康复服务包已上架`;
          })(),
          action: "查看详情",
          visual: "/static/visual/health-plan-service-hero.png",
        }
      : {
          title: "服务筹备中",
          desc: `${who}的康复指导与术后服务包正在筹备中，上线后可在本页购买。`,
          action: "",
          visual: "/static/visual/health-plan-service-hero.png",
        },
    categories: CATEGORIES,
    products,
  };
}

module.exports = { getServiceCenter };
