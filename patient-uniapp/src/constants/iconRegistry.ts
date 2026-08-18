/**
 * 语义图标注册表：名称、旧别名、默认动效与 tone 资源的唯一来源。
 */

export type IconTone = "primary" | "inverse" | "muted" | "danger";
export type IconMotion = "none" | "up" | "right" | "left" | "rotate" | "expand" | "confirm";

export const ICON_NAMES = [
  "action-add",
  "action-clear",
  "action-close",
  "action-confirm",
  "action-create",
  "action-more",
  "action-refresh",
  "action-send",
  "action-unknown",
  "action-update",
  "nav-back",
  "nav-chevron-right",
  "nav-consult",
  "nav-home",
  "nav-profile",
  "upload-record",
  "medication",
  "metric-record",
  "follow-up",
  "service-package",
  "consult-doctor",
  "profile-edit",
  "reminder",
  "doctor-group",
  "invite-patient",
  "group-service",
  "quick-question",
  "record-bind",
  "plan-create",
  "record-edit",
  "health-record",
  "health-log",
  "task-next",
  "health-plan",
  "plan-consult",
  "service-detail",
  "service-activate",
  "rehab-guide",
  "postop-assessment",
  "goods-order",
  "service-rights",
  "member-add",
  "member-record",
  "permission-scope",
  "wechat",
  "phone-bind",
  "verification-code",
  "order",
  "service-center",
  "privacy",
  "account-security",
  "data-export",
  "data-delete",
  "account-logout",
  "wechat-unbind",
  "settings",
  "elder-mode",
  "camera",
  "location",
  "search",
  "attachment",
  "help-center",
  "doctor-profile",
  "health-assistant",
  "inpatient-service",
  "nutrition",
  "reply-record",
  "status-loading",
  "status-success",
  "status-error",
  "status-warning",
  "status-empty",
  "home-doctor-manager",
  "home-health-record",
] as const;

export type SemanticIconName = (typeof ICON_NAMES)[number];

const ICON_SET = new Set<string>(ICON_NAMES);

/** 服务端/历史旧图标名 → 新语义名；未知值回退 action-unknown，绝不回退 help。 */
const LEGACY_ALIASES: Record<string, SemanticIconName> = {
  plus: "action-add",
  add: "action-add",
  back: "nav-back",
  chevron: "nav-chevron-right",
  home: "nav-home",
  user: "nav-profile",
  chat: "consult-doctor",
  send: "action-send",
  upload: "upload-record",
  health: "medication",
  heart: "health-log",
  calendar: "follow-up",
  clock: "reminder",
  check: "status-success",
  lock: "account-security",
  phone: "phone-bind",
  search: "search",
  camera: "camera",
  image: "attachment",
  file: "health-record",
  archive: "health-record",
  team: "member-record",
  form: "record-edit",
  shield: "service-package",
  help: "help-center",
  hospital: "doctor-profile",
  bed: "inpatient-service",
  food: "nutrition",
  replies: "reply-record",
  surgery: "postop-assessment",
  az: "elder-mode",
  "quick-upload": "upload-record",
  "quick-med": "medication",
  "quick-metric": "metric-record",
  "quick-followup": "follow-up",
  "quick-service": "service-package",
  "asset-records": "health-record",
  "asset-plans": "health-plan",
  "asset-health-log": "health-log",
  "asset-family": "member-record",
  "asset-services": "service-center",
  "asset-orders": "order",
  "asset-rights": "service-rights",
  "asset-settings": "settings",
  "asset-elder": "elder-mode",
  "asset-reminders": "reminder",
  "asset-privacy": "privacy",
  "asset-data": "data-export",
  "asset-security": "account-security",
};

const MOTION_BY_ICON: Partial<Record<SemanticIconName, IconMotion>> = {
  "upload-record": "up",
  "action-send": "right",
  "nav-chevron-right": "right",
  "task-next": "right",
  "nav-back": "left",
  "action-refresh": "rotate",
  "status-loading": "rotate",
  "action-add": "expand",
  "action-create": "expand",
  "action-confirm": "confirm",
  "status-success": "confirm",
};

const TONE_FILES: Record<Exclude<IconTone, "primary">, Set<SemanticIconName>> = {
  inverse: new Set([
    "action-confirm",
    "action-create",
    "action-refresh",
    "action-send",
    "action-update",
    "consult-doctor",
    "nav-consult",
    "phone-bind",
    "profile-edit",
    "record-bind",
    "service-activate",
    "status-loading",
    "status-warning",
    "upload-record",
    "wechat",
  ]),
  muted: new Set(["nav-chevron-right", "nav-home", "nav-profile", "status-empty"]),
  danger: new Set(["account-logout", "action-close", "data-delete", "status-error", "wechat-unbind"]),
};

export function resolveSemanticIcon(name?: string | null): SemanticIconName {
  const raw = String(name || "").trim();
  if (ICON_SET.has(raw)) return raw as SemanticIconName;
  return LEGACY_ALIASES[raw] || "action-unknown";
}

export function resolveIconMotion(name?: string | null): IconMotion {
  return MOTION_BY_ICON[resolveSemanticIcon(name)] || "none";
}

export function resolveIconAsset(name?: string | null, tone: IconTone = "primary"): string {
  const semantic = resolveSemanticIcon(name);
  const suffix = tone !== "primary" && TONE_FILES[tone].has(semantic) ? `-${tone}` : "";
  return `src/static/icons/v2/${semantic}${suffix}.png`;
}

export function listRequiredToneAssets(): Array<{ semantic: SemanticIconName; tone: IconTone; file: string }> {
  const rows: Array<{ semantic: SemanticIconName; tone: IconTone; file: string }> = [];
  for (const semantic of ICON_NAMES) {
    rows.push({ semantic, tone: "primary", file: resolveIconAsset(semantic, "primary") });
    (["inverse", "muted", "danger"] as const).forEach((tone) => {
      if (TONE_FILES[tone].has(semantic)) {
        rows.push({ semantic, tone, file: resolveIconAsset(semantic, tone) });
      }
    });
  }
  return rows;
}
