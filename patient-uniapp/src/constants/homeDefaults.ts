import type { QuickAction, ServiceRecommendation } from "../types/v32";

/**
 * 首页快捷：一键一页（咨询交给底部 Tab）
 */
export const HOME_QUICK_ACTIONS_TASK: QuickAction[] = [
  { key: "upload", icon: "quick-upload", label: "健康档案", url: "/pages/records/index" },
  { key: "plan", icon: "quick-metric", label: "健康计划", url: "/pages/plans/detail" },
  { key: "service", icon: "quick-service", label: "健康服务", url: "/pages/services/index" },
];

export const HOME_QUICK_ACTIONS_EMPTY: QuickAction[] = [
  { key: "upload", icon: "quick-upload", label: "健康档案", url: "/pages/records/index" },
  { key: "plan", icon: "quick-metric", label: "健康计划", url: "/pages/plans/detail" },
  { key: "service", icon: "quick-service", label: "健康服务", url: "/pages/services/index" },
];

/** 服务推荐：两个大入口，目标页互不重复 */
export const HOME_RECOMMENDATIONS: ServiceRecommendation[] = [
  {
    key: "copilot",
    icon: "service-package",
    tone: "green",
    reason: "",
    title: "医生管家",
    desc: "",
    actionUrl: "/pages/services/catalog",
  },
  {
    key: "followup",
    icon: "follow-up",
    tone: "amber",
    reason: "",
    title: "复诊协助",
    desc: "",
    actionUrl: "/pages/services/followup",
  },
];
