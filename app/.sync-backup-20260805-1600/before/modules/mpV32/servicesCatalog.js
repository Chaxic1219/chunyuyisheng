"use strict";

const PRODUCTS = [
  {
    key: "copilot",
    icon: "shield",
    tone: "green",
    title: "30 天医生管家",
    desc: "计划审核、异常处理和 2 次随访",
    action: "查看服务",
    toast: "该服务将在下一阶段开通，购买前将先确认可服务医生",
  },
  {
    key: "followup",
    icon: "calendar",
    tone: "amber",
    title: "复诊准备与预约协助",
    desc: "整理近期记录，协助准备复诊资料",
    action: "查看服务",
    toast: "该服务将在下一阶段开通，购买前将先确认可服务医生",
  },
];

function getServiceCenter() {
  return {
    current: {
      title: "报告解读服务",
      desc: "林医生团队已完成解读，等待你查看结果。",
      action: "",
      visual: "/static/visual/health-plan-service-hero.png",
    },
    categories: [
      { key: "plan", icon: "heart", label: "健康计划", toast: "已打开健康计划相关服务" },
      { key: "med", icon: "quick-med", label: "用药支持", toast: "用药支持即将开放" },
      { key: "appoint", icon: "quick-followup", label: "复诊协助", consult: true },
    ],
    products: PRODUCTS,
  };
}

module.exports = { getServiceCenter, PRODUCTS };
