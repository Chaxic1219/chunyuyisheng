export type AssistantRole = "waiting" | "health" | "life" | "handoff";

export interface AppRoute {
  url?: string;
  tab?: boolean;
  toast?: string;
}

export interface QuickAction extends AppRoute {
  key: string;
  icon: string;
  label: string;
}

export interface HomePlanSummary {
  title: string;
  mode: string;
  /** 卡片右上角短标签，如「自主管理」「医生管家中」 */
  modeTag?: string;
  completionText: string;
  completionPercent: number;
  /** 进度条文案，如「本周完成率 68%」「今日任务暂缓推荐」 */
  progressLabel?: string;
  actionText: string;
  actionUrl: string;
  nextTask: {
    title: string;
    desc: string;
    actionText: string;
    toast: string;
  };
}

export interface HomeSoftNotice {
  text: string;
  actionUrl?: string;
}

export interface HomeAlert {
  level: "high";
  label: string;
  title: string;
  desc: string;
  primaryText: string;
  primaryUrl: string;
  secondaryText: string;
  secondaryUrl: string;
}

export interface PendingRecordSummary {
  title: string;
  desc: string;
  actionText: string;
  actionUrl: string;
}

export interface ServiceProgressSummary {
  providerShortName: string;
  title: string;
  desc: string;
  meta: string;
  unreadCount: number;
  actionUrl: string;
}

export interface ServiceRecommendation {
  key: string;
  icon: string;
  tone: "green" | "amber";
  reason: string;
  title: string;
  desc: string;
  actionUrl: string;
}

export interface HomeFeed {
  /** 问候副文案；主问候「上午好，姓名」由前端拼 */
  subtitle: string;
  hero: {
    kicker: string;
    signedTitle: string;
    unsignedTitle: string;
    signedDesc: string;
    unsignedDesc: string;
    signedAction: string;
    unsignedAction: string;
    visual: string;
  };
  /** 高优异常；有值时首页进入 abnormal 态 */
  alert: HomeAlert | null;
  /** 轻提醒（续方等），仅 task 态展示 */
  softNotice: HomeSoftNotice | null;
  /** 异常期说明条 */
  notice: string | null;
  plan: HomePlanSummary | null;
  pendingRecord: PendingRecordSummary | null;
  quickActions: QuickAction[];
  /** 空态快捷区标题，默认「快捷操作」；空态可为「你还可以」 */
  quickActionsTitle?: string;
  serviceProgress: ServiceProgressSummary | null;
  /** 医生管家服务区块标题，默认「正在进行的服务」 */
  serviceSectionTitle?: string;
  serviceSectionAction?: string;
  recommendations: ServiceRecommendation[];
  /** 推荐区标题 */
  recommendationsTitle?: string;
}

export interface MineEntry extends AppRoute {
  key: string;
  icon: string;
  title: string;
  sub: string;
  meta?: string;
  tone?: "green" | "amber" | "blue" | "danger";
  danger?: boolean;
}

export interface MineAssets {
  metrics?: Array<{ value: string; label: string }>;
  healthEntries: MineEntry[];
  serviceEntries: MineEntry[];
  settingEntries: MineEntry[];
}

export interface RecordListData {
  summary: {
    owner: string;
    title: string;
    desc: string;
  };
  pending: {
    title: string;
    desc: string;
    /** 待确认资料的 sourceKey；缺省时可用 records[].id */
    sourceKey?: string;
  };
  records: Array<{
    id: string;
    icon: string;
    iconColor: string;
    title: string;
    desc: string;
    toast: string;
  }>;
}

export interface PlanDetailData {
  title: string;
  desc: string;
  visual?: string;
  stats: Array<{ value: string; label: string }>;
  tasks: Array<{
    id: string;
    icon: string;
    iconColor: string;
    title: string;
    desc: string;
    action: string;
    done?: boolean;
    amber?: boolean;
    toast?: string;
  }>;
}

export interface ServiceCenterData {
  current: {
    title: string;
    desc: string;
    action: string;
    visual?: string;
  };
  categories: Array<{
    key: string;
    icon: string;
    label: string;
    toast?: string;
    consult?: boolean;
  }>;
  products: Array<{
    key: string;
    id?: string | number;
    icon: string;
    tone: "green" | "amber";
    title: string;
    desc: string;
    action: string;
    toast?: string;
    totalAmount?: number;
    serviceAmount?: number;
    goodsAmount?: number;
    shippingAmount?: number;
    serviceDays?: number;
    eligible?: string[];
    ineligible?: string[];
    contents?: string[];
    assessments?: string[];
    goods?: string[];
    consultationNote?: string;
    refundPolicy?: string;
    doctorName?: string;
    doctorHospital?: string;
    versionId?: number;
    productId?: number;
  }>;
}

/** 家庭成员卡片：与后端 /api/mp/v32/family 的 toFamilyMemberCard 输出对齐 */
export interface FamilyMemberCard {
  id: number;
  name: string;
  initial?: string;
  desc: string;
  permissions: string[];
  role?: string;
}

export interface FamilyData {
  /** 被照护人（managed）不存在时为 null */
  managed: FamilyMemberCard | null;
  /** 协助人（helper）列表 */
  helpers: FamilyMemberCard[];
  count: number;
}

