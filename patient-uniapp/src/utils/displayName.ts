export type PatientNameInput = {
  phoneBound?: boolean;
  profileName?: string | null;
  archiveName?: string | null;
  localProfileName?: string | null;
  phoneMasked?: string | null;
};

/** 真实展示名：禁止临时假名，未建档时用脱敏手机号 */
export function resolvePatientDisplayName(input: PatientNameInput): string {
  const name = String(
    input.profileName || input.archiveName || input.localProfileName || ""
  ).trim();
  if (name) return name;
  if (!input.phoneBound) return "";
  const masked = String(input.phoneMasked || "").trim();
  if (masked) return masked;
  return "";
}

/** 问候语/卡片标题用：未登录或未建档时给出明确引导 */
export function resolvePatientGreetingLabel(input: PatientNameInput): string {
  const name = resolvePatientDisplayName(input);
  if (name) return name;
  if (!input.phoneBound) return "请绑定手机号";
  return "请完善档案";
}

export function resolveNameInitial(label: string, fallback = "我"): string {
  const n = String(label || fallback).trim();
  if (!n) return fallback;
  if (/^\d/.test(n)) return "用";
  return n.slice(0, 1);
}
