import { mpVisual } from "../utils/mediaSrc";

export const BLOOD_TYPE_OPTIONS = ["A型", "B型", "AB型", "O型", "不详"];

export const ARCHIVE_HUB_ASSETS = {
  hero: mpVisual("archive-hub/hero.png"),
  shield: mpVisual("archive-hub/shield.png"),
  camera: mpVisual("archive-hub/camera.png"),
  edit: mpVisual("archive-hub/edit.png"),
  avatar: mpVisual("archive-hub/avatar.png"),
  records: mpVisual("archive-hub/records.png"),
  pending: mpVisual("archive-hub/plan.png"),
  plan: mpVisual("archive-hub/clipboard.png"),
  knowledge: mpVisual("archive-hub/knowledge.png"),
};

export function ageFromBirthDate(raw?: string): string {
  const m = String(raw || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return "";
  const birth = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(birth.getTime())) return "";
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const md = now.getMonth() - birth.getMonth();
  if (md < 0 || (md === 0 && now.getDate() < birth.getDate())) age -= 1;
  return age >= 0 && age < 130 ? String(age) : "";
}

export function computeBmi(heightCm?: string, weightKg?: string): string {
  const h = Number(heightCm);
  const w = Number(weightKg);
  if (!Number.isFinite(h) || !Number.isFinite(w) || h <= 0 || w <= 0) return "";
  const m = h / 100;
  if (m <= 0) return "";
  return (w / (m * m)).toFixed(1);
}

export function bmiLabel(bmi?: string): string {
  const n = Number(bmi);
  if (!Number.isFinite(n) || n <= 0) return "";
  if (n < 18.5) return "偏瘦";
  if (n < 24) return "正常";
  if (n < 28) return "超重";
  return "肥胖";
}
