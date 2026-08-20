"use strict";

const groupGate = require("../../group_gate.js");

const NON_MEDICAL_REPLY =
  "这里主要解答与健康、用药、检查报告和就医相关的问题。如果是其他话题，建议通过下方入口联系医生团队。";

const QIWE_DM_SOCIAL_BLOCK_RE = /(?:天气|股票|电影|游戏|八卦|编程|代码|明星|综艺)/;

function historyTexts(history) {
  return (Array.isArray(history) ? history : [])
    .map((h) => String(h && (h.text != null ? h.text : h.content) || "").trim())
    .filter(Boolean);
}

/** 私聊是否在活跃问诊线程中（含助手曾给「您可以回复」选项）。 */
function hasQiweDmMedicalThread(history) {
  const session = buildSessionFromHistory(history);
  if (session && session.slots && session.slots.hasMedicalCue) return true;
  const joined = historyTexts(history).join(" ");
  return /疼|痛|药|症状|报告|检查|不舒服|化验|尿频|头疼|您可以回复|问诊|总结|排尿|头痛/.test(joined);
}

/** 用户对助手快捷选项 / 总结指令 / 寒暄的短回复。 */
function isQiweDmClinicControl(text, history) {
  const t = String(text || "").trim();
  if (!t) return false;
  if (/^(?:帮我总结|直接说结论|直接出结论|总结一下|说结论|不用了|不需要了)/.test(t)) return true;
  if (/^(?:选项?\s*)?[ABCabc]$/.test(t)) return true;
  if (/^选[ABCabc]$/.test(t)) return true;
  if (/^选项\s*[ABCabc]$/.test(t)) return true;
  if (/^[ABCabc][、,.，。\s]/.test(t) && t.length <= 20) return true;
  if (/^(?:你好|您好|在吗|谢谢|好的)[!！?？~～]*$/i.test(t)) return true;

  const rows = Array.isArray(history) ? history : [];
  for (let i = rows.length - 1; i >= 0; i--) {
    const h = rows[i];
    const role = h && (h.role === "assistant" || h.role === "ai") ? "assistant" : h && h.role === "user" ? "user" : "";
    if (role !== "assistant") continue;
    const prev = String(h.text != null ? h.text : h.content || "").trim();
    if (/您可以回复[:：]/.test(prev) && t.length <= 32 && !QIWE_DM_SOCIAL_BLOCK_RE.test(t)) return true;
    break;
  }
  return false;
}

function buildSessionFromHistory(history) {
  const rows = Array.isArray(history) ? history : [];
  const turns = rows
    .slice(-6)
    .map((h) => {
      const role = h && (h.role === "assistant" || h.role === "ai") ? "assistant" : "user";
      const text = String(h && (h.text != null ? h.text : h.content) || "").trim();
      if (!text) return null;
      return { role, text, goal: "advice", at: Date.now() };
    })
    .filter(Boolean);
  if (!turns.length) return null;

  const summary = turns.map((t) => t.text).join(" ").slice(0, 240);
  const hasMedicalCue =
    turns.some(
      (t) =>
        groupGate.hasSymptomAsk(t.text) ||
        groupGate.isMedicationAsk(t.text) ||
        groupGate.isDiseaseConsultAsk(t.text) ||
        groupGate.hasBusinessIntent(t.text)
    ) || /疼|痛|药|症状|报告|检查|术后|复查|不舒服|指标|化验|您可以回复|尿频|排尿|头痛|总结/.test(summary);

  if (!hasMedicalCue) return null;

  return {
    goal: "advice",
    summary,
    turns,
    slots: { hasMedicalCue: true },
    updatedAt: Date.now(),
  };
}

function isMedicalConsultAllowed(input = {}) {
  const text = String(input.text || "").trim();
  const images = Array.isArray(input.images) ? input.images : [];
  const sceneId = String(input.sceneId || "mp_ai").trim();
  const isQiweDm = sceneId === "qiwe_dm";
  if (images.length > 0) return { allowed: true };
  if (!text) return { allowed: false, reason: "empty" };

  if (groupGate.hasBusinessIntent(text)) return { allowed: true };
  if (groupGate.hasSymptomAsk(text)) return { allowed: true };
  if (groupGate.isMedicationAsk(text)) return { allowed: true };
  if (groupGate.isDiseaseConsultAsk(text)) return { allowed: true };
  if (groupGate.hasMenuQuestion(text)) return { allowed: true };

  try {
    const { matchServiceIntent } = require("../../agent/understand.js");
    const svc = matchServiceIntent(text);
    if (svc && (svc.preferredCode || svc.goal === "menu")) return { allowed: true };
  } catch (_) {
    /* ignore */
  }

  if (isQiweDm) {
    if (isQiweDmClinicControl(text, input.history)) return { allowed: true };
    if (hasQiweDmMedicalThread(input.history) && !QIWE_DM_SOCIAL_BLOCK_RE.test(text)) {
      return { allowed: true };
    }
  }

  if (isQiweDm && /^(?:帮我总结|直接说结论|直接出结论|总结一下|说结论)/.test(text)) {
    return { allowed: true };
  }

  const session = buildSessionFromHistory(input.history);
  if (session && session.slots && session.slots.hasMedicalCue) {
    if (groupGate.isContextualMedicalReply(text, session)) return { allowed: true };
    if (groupGate.isDiseaseConsultAsk(text)) return { allowed: true };
  }

  if (!groupGate.isUnrelatedChitchat(text, session)) return { allowed: true };

  return { allowed: false, reason: "non_medical" };
}

module.exports = {
  NON_MEDICAL_REPLY,
  buildSessionFromHistory,
  isMedicalConsultAllowed,
  hasQiweDmMedicalThread,
  isQiweDmClinicControl,
};
