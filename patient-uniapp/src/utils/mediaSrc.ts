import { resolveIconMotion, resolveSemanticIcon, type IconTone, type SemanticIconName } from "../constants/iconRegistry";
import { API_BASE } from "../api/config";

/** 已接入自定义图标包的语义名直接使用 v2 PNG，不再回退旧素材。 */
const V2_VISUAL_KEEP = new Set<string>([
  "action-send",
  "attachment",
  "camera",
  "profile-edit",
  "member-record",
  "location",
  "health-record",
  "health-log",
  "consult-doctor",
  "health-assistant",
  "help-center",
  "service-center",
  "service-package",
  "medication",
  "service-rights",
  "order",
  "goods-order",
  "settings",
  "health-plan",
  "home-doctor-manager",
  "home-health-record",
]);

const V2_INVERSE_ICONS = new Set<string>(["action-send", "profile-edit", "upload-record"]);

/** 语义名 → 旧 PNG 文件名（不含扩展名）；未覆盖时回退 help */
const SEMANTIC_TO_LEGACY_FILE: Partial<Record<SemanticIconName, string>> = {
  "action-add": "plus",
  "action-clear": "help",
  "action-close": "help",
  "action-confirm": "check",
  "action-create": "plus",
  "action-more": "chevron",
  "action-refresh": "help",
  "action-send": "send",
  "action-unknown": "help",
  "action-update": "form",
  "nav-back": "back",
  "nav-chevron-right": "chevron",
  "nav-consult": "chat",
  "nav-home": "home",
  "nav-profile": "user",
  "upload-record": "upload",
  medication: "health",
  "metric-record": "heart",
  "follow-up": "calendar",
  "service-package": "shield",
  "consult-doctor": "chat",
  "profile-edit": "form",
  reminder: "clock",
  "doctor-group": "team",
  "invite-patient": "team",
  "group-service": "team",
  "quick-question": "help",
  "record-bind": "lock",
  "plan-create": "form",
  "record-edit": "form",
  "health-record": "file",
  "health-log": "heart",
  "task-next": "chevron",
  "health-plan": "form",
  "plan-consult": "chat",
  "service-detail": "shield",
  "service-activate": "shield",
  "rehab-guide": "surgery",
  "postop-assessment": "surgery",
  "goods-order": "archive",
  "service-rights": "shield",
  "member-add": "team",
  "member-record": "team",
  "permission-scope": "lock",
  wechat: "chat",
  "phone-bind": "phone",
  "verification-code": "lock",
  order: "archive",
  "service-center": "shield",
  privacy: "lock",
  "account-security": "lock",
  "data-export": "file",
  "data-delete": "help",
  "account-logout": "lock",
  "wechat-unbind": "lock",
  settings: "lock",
  "elder-mode": "az",
  camera: "camera",
  search: "search",
  attachment: "image",
  "help-center": "help",
  "doctor-profile": "hospital",
  "health-assistant": "shield",
  "inpatient-service": "bed",
  nutrition: "food",
  "reply-record": "replies",
  "status-loading": "help",
  "status-success": "check",
  "status-error": "help",
  "status-warning": "help",
  "status-empty": "help",
};

const COLOR_VARIANTS: Record<string, string> = {
  "hospital:#52627A": "hospital-secondary",
  "lock:#52627A": "lock-secondary",
  "chevron:#637188": "chevron-muted",
  "help:#D92D20": "help-danger",
};

const HOME_QUICK_BY_KEY: Record<string, string> = {
  upload: "quick-upload",
  plan: "quick-metric",
  catalog: "quick-service",
  med: "quick-med",
  consult: "quick-med",
  metric: "quick-metric",
  follow: "quick-followup",
  service: "quick-service",
};

const HOME_QUICK_BY_LEGACY_ICON: Record<string, string> = {
  upload: "quick-upload",
  health: "quick-med",
  chat: "quick-med",
  heart: "quick-metric",
  calendar: "quick-followup",
  shield: "quick-service",
  "quick-upload": "quick-upload",
  "quick-med": "quick-med",
  "quick-metric": "quick-metric",
  "quick-followup": "quick-followup",
  "quick-service": "quick-service",
  "upload-record": "quick-upload",
  medication: "quick-med",
  "consult-doctor": "quick-med",
  "metric-record": "quick-metric",
  "follow-up": "quick-followup",
  "service-package": "quick-service",
};

const PAINTED_PREFIXES = ["quick-", "asset-"] as const;

function isPaintedIcon(name: string): boolean {
  return PAINTED_PREFIXES.some((prefix) => name.startsWith(prefix));
}

function legacyFileForSemantic(semantic: string): string {
  return SEMANTIC_TO_LEGACY_FILE[semantic as SemanticIconName] || "help";
}

export function resolveIconName(name?: string | null): string {
  const raw = String(name || "").trim();
  if (!raw) return "help";
  if (isPaintedIcon(raw)) return raw;
  if (V2_VISUAL_KEEP.has(raw)) return raw;
  const semantic = resolveSemanticIcon(raw);
  if (V2_VISUAL_KEEP.has(semantic)) return semantic;
  return legacyFileForSemantic(semantic);
}

export function resolveHomeQuickIcon(key?: string | null, icon?: string | null): string {
  const byKey = HOME_QUICK_BY_KEY[String(key || "")];
  if (byKey) return byKey;
  const byIcon = HOME_QUICK_BY_LEGACY_ICON[String(icon || "")];
  if (byIcon) return byIcon;
  return "quick-service";
}

function normalizeIconTone(toneOrColor?: IconTone | string | null): string {
  const value = String(toneOrColor || "primary").toLowerCase();
  if (["primary", "inverse", "muted", "danger"].includes(value)) return value;
  return String(toneOrColor || "#456FD8");
}

export function resolveIconSrc(name?: string | null, toneOrColor?: IconTone | string | null): string {
  const resolved = resolveIconName(name);
  if (V2_VISUAL_KEEP.has(resolved)) {
    const tone = normalizeIconTone(toneOrColor);
    if (tone === "inverse" && V2_INVERSE_ICONS.has(resolved)) {
      return `/static/icons/v2/${resolved}-inverse.png`;
    }
    if (resolved === "profile-edit" && tone === "inverse") {
      return `/static/icons/v2/profile-edit-inverse.png`;
    }
    return `/static/icons/v2/${resolved}.png`;
  }
  if (isPaintedIcon(resolved)) {
    return `/static/icons/${resolved}.png`;
  }
  const colorKey = String(toneOrColor || "#456FD8").toUpperCase();
  const file = COLOR_VARIANTS[`${resolved}:${colorKey}`] || resolved;
  return `/static/icons/${file}.png`;
}

export { resolveIconMotion };

/** 仅允许本地 static、服务端 uploads 或 https，拒绝 props 缓存键 / 相对脏值 */
export function safeLocalImageSrc(src?: string | null, fallback = ""): string {
  const value = String(src || "").trim();
  if (!value) return fallback;
  if (value.startsWith("/static/")) return value;
  if (value.startsWith("/uploads/") || value.startsWith("uploads/")) {
    const path = value.startsWith("/") ? value : `/${value}`;
    return `${API_BASE}${path}`;
  }
  if (value.startsWith("https://")) return value;
  if (value.startsWith("data:image/")) return value;
  return fallback;
}

/** 大插图走线上 /uploads/mp-visual，避免打进小程序主包 */
export function mpVisual(rel: string, fallback = ""): string {
  const name = String(rel || "").replace(/^\/+/, "").replace(/^static\//, "").replace(/^visual\//, "");
  if (!name || name.includes("..")) return fallback;
  // ponytail: 线上 mp-visual 可能缺文件导致 404；在 mp-weixin 端优先走小程序自身 static 包内资源。
  // 升级路径：修复线上 mp-visual 完整供给后，可回到统一走 /uploads/mp-visual。
  const wxObj = (globalThis as any)?.wx;
  const isMpWeixin = Boolean(wxObj && typeof wxObj.getSystemInfoSync === "function");
  const prefix = isMpWeixin ? "/static/mp-visual/" : "/uploads/mp-visual/";
  return safeLocalImageSrc(`${prefix}${name}`, fallback);
}
