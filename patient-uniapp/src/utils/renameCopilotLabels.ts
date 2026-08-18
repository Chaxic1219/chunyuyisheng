/** 旧「医生共管 / Pro」对外统一为「医生管家」；兼容尚未发版的线上接口文案 */
import {
  HOME_QUICK_ACTIONS_EMPTY,
  HOME_QUICK_ACTIONS_TASK,
  HOME_RECOMMENDATIONS,
} from "../constants/homeDefaults";
import { MINE_DEFAULTS } from "../constants/mineDefaults";

const REPLACEMENTS: Array<[string, string]> = [
  ["医生共管 Pro", "医生管家"],
  ["医生共管Pro", "医生管家"],
  ["30 天医生共管", "30 天医生管家"],
  ["30天医生共管", "30 天医生管家"],
  ["Pro 共管中", "医生管家中"],
  ["Pro共管中", "医生管家中"],
  ["医生共管服务", "医生管家服务"],
  ["医生共管数据授权", "医生管家数据授权"],
  ["医生共管", "医生管家"],
  ["共管授权", "医生管家授权"],
];

export function renameCopilotLabel(text: unknown): string {
  let value = String(text ?? "");
  if (!value) return value;
  for (const [from, to] of REPLACEMENTS) {
    if (value.includes(from)) value = value.split(from).join(to);
  }
  return value;
}

function isLegacyServicesHub(url: unknown) {
  const u = String(url || "").split("?")[0];
  return u === "/pages/services/index";
}

/**
 * 强制首页入口一键一页：忽略线上旧 quick/recommend 的重复跳转。
 */
export function normalizeHomeFeedLabels<T extends Record<string, any>>(feed: T): T {
  if (!feed || typeof feed !== "object") return feed;
  const next: Record<string, any> = { ...feed };

  const emptyMode = !next.plan && Array.isArray(next.recommendations) === false;
  // 有计划/任务态用 task 快捷；空态用更短一组
  const useEmpty =
    String(next.quickActionsTitle || "").includes("还可以") ||
    (!next.plan && !next.pendingRecord && !(next.serviceProgress));

  next.quickActions = useEmpty ? HOME_QUICK_ACTIONS_EMPTY.slice() : HOME_QUICK_ACTIONS_TASK.slice();
  next.quickActionsTitle = useEmpty ? "你还可以" : "快捷操作";

  // 推荐区：医生管家 + 复诊协助（两入口两页）
  next.recommendations = HOME_RECOMMENDATIONS.map((row) => ({ ...row }));
  next.recommendationsTitle = "常用健康服务";

  if (next.softNotice && typeof next.softNotice === "object") {
    // 续方提醒进健康计划，不再挤咨询 Tab
    next.softNotice = {
      ...next.softNotice,
      actionUrl: "/pages/plans/detail",
    };
  }

  if (next.plan && typeof next.plan === "object") {
    next.plan = {
      ...next.plan,
      mode: renameCopilotLabel(next.plan.mode),
      modeTag: renameCopilotLabel(next.plan.modeTag),
      actionUrl: next.plan.actionUrl || "/pages/plans/detail",
    };
  }

  next.serviceSectionTitle = renameCopilotLabel(next.serviceSectionTitle) || "正在进行的服务";
  next.serviceSectionAction = "我的服务";

  if (next.serviceProgress && typeof next.serviceProgress === "object") {
    next.serviceProgress = {
      ...next.serviceProgress,
      title: renameCopilotLabel(next.serviceProgress.title),
      desc: renameCopilotLabel(next.serviceProgress.desc),
      meta: renameCopilotLabel(next.serviceProgress.meta),
      actionUrl: "/pages/services/mine-services",
    };
  }

  if (next.alert && typeof next.alert === "object") {
    // 异常主按钮保留咨询；次按钮健康记录（已是不同页）
    next.alert = {
      ...next.alert,
      primaryUrl: next.alert.primaryUrl || "/pages/consult/index",
      secondaryUrl: next.alert.secondaryUrl || "/pages/archive/health",
    };
  }

  void emptyMode;
  void isLegacyServicesHub;
  return next as T;
}

/** 「我的」服务入口：完全以本地四件套为准，保证一键一页 */
export function normalizeMineAssetsLabels<T extends Record<string, any>>(assets: T): T {
  if (!assets || typeof assets !== "object") return assets;
  const next: Record<string, any> = { ...assets };
  next.serviceEntries = MINE_DEFAULTS.serviceEntries.map((row) => ({ ...row }));
  if (!Array.isArray(next.healthEntries) || !next.healthEntries.length) {
    next.healthEntries = MINE_DEFAULTS.healthEntries.map((row) => ({ ...row }));
  }
  return next as T;
}

export function normalizeServiceCenterLabels<T extends Record<string, any>>(center: T): T {
  if (!center || typeof center !== "object") return center;
  const next: Record<string, any> = { ...center };
  // 三个分类 → 三个不同页
  next.categories = [
    { key: "plan", icon: "health-plan", label: "健康计划", url: "/pages/plans/detail" },
    { key: "catalog", icon: "service-package", label: "服务包", url: "/pages/services/catalog" },
    { key: "mine", icon: "health-record", label: "我的服务", url: "/pages/services/mine-services" },
  ];
  if (Array.isArray(next.products)) {
    next.products = next.products.map((item: Record<string, any>) => {
      const key = String(item?.key || "");
      return {
        ...item,
        title: key === "copilot" ? "30 天医生管家" : renameCopilotLabel(item?.title),
        desc: renameCopilotLabel(item?.desc),
      };
    });
  }
  return next as T;
}
