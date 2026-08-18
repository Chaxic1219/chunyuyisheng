import type { MineAssets, MineEntry } from "../types/v32";

/** 我的页账号与设置：仅保留设置入口与长辈模式 */
export const MINE_SETTING_ENTRIES: MineEntry[] = [
  {
    key: "settings-hub",
    icon: "asset-settings",
    title: "设置与授权",
    sub: "",
    url: "/pages/settings/index",
    tone: "green",
  },
  {
    key: "elder",
    icon: "asset-elder",
    title: "长辈模式",
    sub: "",
    tone: "blue",
  },
];

export const MINE_DEFAULTS: MineAssets = {
  metrics: [
    { value: "0", label: "健康资料" },
    { value: "0", label: "健康计划" },
    { value: "0", label: "进行中服务" },
  ],
  healthEntries: [
    { key: "records", icon: "asset-records", title: "健康档案", sub: "", url: "/pages/records/index", tone: "green" },
    { key: "plans", icon: "asset-plans", title: "健康计划", sub: "", url: "/pages/plans/detail", tone: "green" },
    { key: "asset-health-log", icon: "asset-health-log", title: "健康记录", sub: "", url: "/pages/archive/health", tone: "green" },
    { key: "family", icon: "asset-family", title: "家属管理", sub: "", url: "/pages/family/index", tone: "green" },
  ],
  serviceEntries: [
    { key: "services", icon: "asset-services", title: "我的服务", sub: "", url: "/pages/services/mine-services", tone: "green" },
    { key: "rights", icon: "asset-rights", title: "优惠权益", sub: "", url: "/pages/services/rights", tone: "green" },
    { key: "agreements", icon: "asset-privacy", title: "服务协议", sub: "", url: "/pages/services/agreements", tone: "green" },
    { key: "after-sales", icon: "asset-data", title: "发票售后", sub: "", url: "/pages/services/after-sales", tone: "green" },
  ],
  settingEntries: MINE_SETTING_ENTRIES,
};
