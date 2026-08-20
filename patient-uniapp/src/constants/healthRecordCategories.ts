import { mpVisual } from "../utils/mediaSrc";

/** 健康记录分类视觉映射（对齐原型图） */
export const HEALTH_RECORD_CATEGORY_ICONS: Record<string, string> = {
  discharge_summary: mpVisual("health-record-categories/discharge.png"),
  health_checkup: mpVisual("health-record-categories/checkup.png"),
  endoscopy: mpVisual("health-record-categories/imaging.png"),
  imaging: mpVisual("health-record-categories/imaging.png"),
  lab: mpVisual("health-record-categories/lab.png"),
  prescription: mpVisual("health-record-categories/prescription.png"),
  drug_allergy: mpVisual("health-record-categories/allergy.png"),
  medical_certificate: mpVisual("health-record-categories/certificate.png"),
  referral_letter: mpVisual("health-record-categories/referral.png"),
  general_letter: mpVisual("health-record-categories/discharge.png"),
};

export const HEALTH_RECORD_CATEGORY_BG: Record<string, string> = {
  discharge_summary: "#E8F4FA",
  health_checkup: "#E8F8F2",
  endoscopy: "#E6FAF8",
  imaging: "#E8F4FC",
  lab: "#F0EBFA",
  prescription: "#FFF4E8",
  drug_allergy: "#FEEEEE",
  medical_certificate: "#EEF0FF",
  referral_letter: "#E8FAF5",
  general_letter: "#F0EBFA",
};

export const HEALTH_RECORD_HERO = mpVisual("health-record-categories/hero.png");
export const HEALTH_RECORD_EMPTY = mpVisual("health-record-empty.webp");

export function healthRecordCategoryIcon(key: string): string {
  return HEALTH_RECORD_CATEGORY_ICONS[key] || HEALTH_RECORD_CATEGORY_ICONS.health_checkup;
}

export function healthRecordCategoryBg(key: string): string {
  return HEALTH_RECORD_CATEGORY_BG[key] || "#EEF2F6";
}
