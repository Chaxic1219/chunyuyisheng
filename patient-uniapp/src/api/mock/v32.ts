import type {
  FamilyData,
  HomeFeed,
  MineAssets,
  PlanDetailData,
  RecordListData,
  ServiceCenterData,
} from "../../types/v32";
import { V32_VISUAL_ASSETS } from "../../constants/v32Assets";

const HERO = {
  kicker: "今日健康管理",
  signedTitle: "现在先完成这一步",
  unsignedTitle: "建立第一份健康计划",
  signedDesc: "系统已整理档案、计划和服务进度，首页只保留当前最重要的行动。",
  unsignedDesc: "上传处方、检查报告或出院小结，确认后生成可执行的健康计划。",
  signedAction: "查看健康计划",
  unsignedAction: "完善健康档案",
  visual: V32_VISUAL_ASSETS.homeHeroAction,
};

const QUICK_TASK = [
  { key: "upload", icon: "quick-upload", label: "健康档案", url: "/pages/records/index" },
  { key: "med", icon: "quick-med", label: "问用药", url: "/pages/consult/index", tab: true },
  { key: "metric", icon: "quick-metric", label: "记录指标", toast: "指标记录将在健康计划中完成" },
  { key: "follow", icon: "quick-followup", label: "复诊咨询", url: "/pages/consult/index", tab: true },
  { key: "service", icon: "quick-service", label: "健康服务", url: "/pages/services/index" },
];

const QUICK_EMPTY = [
  { key: "upload", icon: "quick-upload", label: "健康档案", url: "/pages/records/index" },
  { key: "consult", icon: "chat", label: "直接咨询", url: "/pages/consult/index", tab: true },
  { key: "metric", icon: "quick-metric", label: "记录指标", toast: "指标记录将在健康计划中完成" },
  { key: "follow", icon: "quick-followup", label: "复诊咨询", url: "/pages/consult/index", tab: true },
  { key: "service", icon: "quick-service", label: "健康服务", url: "/pages/services/index" },
];

/** 图一：有任务 */
export const mockHomeFeed: HomeFeed = {
  subtitle: "今天最重要的健康事项已经整理好了",
  hero: HERO,
  alert: null,
  softNotice: {
    text: "苯磺酸氨氯地平片预计还剩 7 天，建议提前安排复诊或续方。",
    actionUrl: "/pages/consult/index",
  },
  notice: null,
  plan: {
    title: "高血压健康计划",
    mode: "自主管理 · 不依赖医生持续查看",
    modeTag: "自主管理",
    completionText: "今日 1/3 已完成",
    completionPercent: 68,
    progressLabel: "本周完成率 68%",
    actionText: "查看健康计划",
    actionUrl: "/pages/plans/detail",
    nextTask: {
      title: "20:00 记录晚间血压",
      desc: "静坐 5 分钟后测量",
      actionText: "去完成",
      toast: "已打开血压记录",
    },
  },
  pendingRecord: {
    title: "7 月 28 日门诊处方",
    desc: "识别出 4 项信息 · 1 项用药冲突待确认",
    actionText: "继续确认",
    actionUrl: "/pages/records/index",
  },
  quickActions: QUICK_TASK,
  quickActionsTitle: "快捷操作",
  serviceProgress: {
    providerShortName: "林",
    title: "林医生团队 · 报告解读",
    desc: "医生已回复 · 下一步：查看解读结果",
    meta: "服务至 8 月 15 日 · 1 条未读回复",
    unreadCount: 1,
    actionUrl: "/pages/services/mine-services",
  },
  serviceSectionTitle: "正在进行的服务",
  serviceSectionAction: "查看全部",
  recommendations: [
    {
      key: "copilot",
      icon: "hospital",
      tone: "green",
      reason: "",
      title: "医生管家",
      desc: "",
      actionUrl: "/pages/services/catalog",
    },
    {
      key: "followup",
      icon: "quick-followup",
      tone: "amber",
      reason: "",
      title: "复诊咨询",
      desc: "",
      actionUrl: "/pages/consult/index",
    },
  ],
  recommendationsTitle: "根据当前计划推荐",
};

/** 图二：数据异常 */
export const mockHomeFeedAbnormal: HomeFeed = {
  subtitle: "发现一项需要优先处理的健康情况",
  hero: HERO,
  alert: {
    level: "high",
    label: "高优先级异常",
    title: "血压连续 3 次高于计划阈值",
    desc: "最近一次为 158/96 mmHg。请先确认是否伴有明显不适，系统会根据结果提供下一步。",
    primaryText: "立即处理",
    primaryUrl: "/pages/consult/index",
    secondaryText: "查看记录",
    secondaryUrl: "/pages/archive/health",
  },
  softNotice: null,
  notice: "异常处理期间不展示促销性服务推荐，避免干扰当前安全事项。",
  plan: {
    title: "异常处理优先于今日任务",
    mode: "医生管家中",
    modeTag: "医生管家中",
    completionText: "高血压健康计划",
    completionPercent: 60,
    progressLabel: "今日任务暂缓推荐",
    actionText: "查看健康计划",
    actionUrl: "/pages/plans/detail",
    nextTask: {
      title: "确认当前症状",
      desc: "完成后再决定记录或联系医生",
      actionText: "去确认",
      toast: "",
    },
  },
  pendingRecord: null,
  quickActions: QUICK_TASK,
  quickActionsTitle: "快捷操作",
  serviceProgress: {
    providerShortName: "林",
    title: "林医生健康管理团队",
    desc: "异常已进入医助优先队列",
    meta: "预计 30 分钟内反馈 · 服务至 8 月 28 日",
    unreadCount: 1,
    actionUrl: "/pages/services/mine-services",
  },
  serviceSectionTitle: "医生管家服务",
  serviceSectionAction: "服务详情",
  recommendations: [],
  recommendationsTitle: "根据当前计划推荐",
};

/** 图三：无计划 / 没问题 */
export const mockHomeFeedEmpty: HomeFeed = {
  subtitle: "建立第一份健康计划，从整理资料开始",
  hero: {
    ...HERO,
    visual: V32_VISUAL_ASSETS.emptyNoPlan,
  },
  alert: null,
  softNotice: null,
  notice: null,
  plan: null,
  pendingRecord: null,
  quickActions: QUICK_EMPTY,
  quickActionsTitle: "你还可以",
  serviceProgress: null,
  recommendations: [
    {
      key: "report",
      icon: "asset-records",
      tone: "green",
      reason: "",
      title: "健康档案",
      desc: "",
      actionUrl: "/pages/records/index",
    },
    {
      key: "followup",
      icon: "quick-followup",
      tone: "amber",
      reason: "",
      title: "复诊咨询",
      desc: "",
      actionUrl: "/pages/consult/index",
    },
  ],
  recommendationsTitle: "常用健康服务",
};

export const mockMineAssets: MineAssets = {
  metrics: [
    { value: "6", label: "健康资料" },
    { value: "2", label: "健康计划" },
    { value: "1", label: "进行中服务" },
  ],
  healthEntries: [
    { key: "records", icon: "asset-records", title: "健康档案", sub: "", url: "/pages/records/index", tone: "green" },
    { key: "plans", icon: "asset-plans", title: "健康计划", sub: "", url: "/pages/plans/detail", tone: "green" },
    { key: "health-log", icon: "asset-health-log", title: "健康记录", sub: "", url: "/pages/archive/health", tone: "green" },
    { key: "family", icon: "asset-family", title: "家属管理", sub: "", url: "/pages/family/index", tone: "green" },
  ],
  serviceEntries: [
    { key: "services", icon: "asset-services", title: "我的服务", sub: "", url: "/pages/services/mine-services", tone: "green" },
    { key: "rights", icon: "asset-rights", title: "优惠权益", sub: "", url: "/pages/services/rights", tone: "green" },
    { key: "agreements", icon: "asset-privacy", title: "服务协议", sub: "", url: "/pages/services/agreements", tone: "green" },
    { key: "after-sales", icon: "asset-data", title: "发票售后", sub: "", url: "/pages/services/after-sales", tone: "green" },
  ],
  settingEntries: [
    { key: "settings-hub", icon: "asset-settings", title: "设置与授权", sub: "", url: "/pages/settings/index", tone: "green" },
    { key: "elder", icon: "asset-elder", title: "长辈模式", sub: "", tone: "blue" },
  ],
};

export const mockRecordList: RecordListData = {
  summary: {
    owner: "我的健康档案",
    title: "6 份资料",
    desc: "最近更新于 7 月 28 日，诊断、用药和复诊信息均保留原始来源。",
  },
  pending: {
    title: "门诊处方存在 1 项冲突",
    desc: "系统识别剂量与现有用药记录不一致，确认前不会生成任务。",
    sourceKey: "rx-20260728",
  },
  records: [
    {
      id: "rx-20260728",
      icon: "asset-records",
      iconColor: "#456FD8",
      title: "心内科门诊处方",
      desc: "7 月 28 日 · 待确认 · 含用药冲突",
      toast: "已打开处方详情",
    },
    {
      id: "lab-20260720",
      icon: "asset-health-log",
      iconColor: "#176B52",
      title: "血脂与肝肾功能",
      desc: "7 月 20 日 · 已确认",
      toast: "已打开检查报告",
    },
  ],
};

export const mockPlanDetail: PlanDetailData = {
  title: "高血压健康计划",
  desc: "自主管理 · 不依赖医生持续查看",
  visual: V32_VISUAL_ASSETS.healthPlanServiceHero,
  stats: [
    { value: "18", label: "执行天数" },
    { value: "68%", label: "今日完成" },
    { value: "3", label: "今日任务" },
  ],
  tasks: [
    {
      id: "1",
      icon: "check",
      iconColor: "#176B52",
      title: "晨间服药",
      desc: "已记录",
      action: "已完成",
      done: true,
    },
    {
      id: "2",
      icon: "quick-metric",
      iconColor: "#176B52",
      title: "20:00 记录晚间血压",
      desc: "建议按时测量",
      action: "去记录",
    },
    {
      id: "3",
      icon: "quick-followup",
      iconColor: "#936015",
      title: "预约复诊",
      desc: "药品预计剩余 7 天",
      action: "去完成",
      amber: true,
    },
  ],
};

export const mockServiceCenter: ServiceCenterData = {
  current: {
    title: "服务筹备中",
    desc: "当前医生的康复指导与术后服务包正在筹备中，上线后可在本页购买。",
    action: "",
  },
  categories: [
    { key: "plan", icon: "asset-plans", label: "健康计划", toast: "已打开健康计划相关服务" },
    { key: "med", icon: "quick-med", label: "用药支持", toast: "用药支持正在排期中，请先提交咨询" },
    { key: "appoint", icon: "quick-followup", label: "复诊咨询", consult: true },
  ],
  products: [],
};

export const mockFamilyData: FamilyData = {
  managed: null,
  helpers: [],
  count: 0,
};
