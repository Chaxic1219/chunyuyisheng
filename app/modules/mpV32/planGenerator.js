"use strict";

function parsePayload(row) {
  if (!row) return {};
  if (row.payload && typeof row.payload === "object" && !Array.isArray(row.payload)) {
    return row.payload;
  }
  const raw = row.payload_json != null ? row.payload_json : row.payload;
  if (raw == null || raw === "") return {};
  if (typeof raw === "object") return raw;
  try {
    const v = JSON.parse(String(raw));
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch (e) {
    return {};
  }
}

/**
 * 基于已确认项 + 健康记录摘要生成草稿。
 * 信息不足时返回 { ok:false, reason, missing }。
 */
function confirmationBlob(c) {
  const payload = parsePayload(c);
  return [
    c && c.source_key,
    payload.title,
    payload.category,
    payload.summary,
    payload.kind,
  ]
    .filter(Boolean)
    .join(" ");
}

function generatePlanDraft({ confirmations, healthRecords, profile }) {
  const items = [];
  const confirmed = Array.isArray(confirmations) ? confirmations : [];
  const records = Array.isArray(healthRecords) ? healthRecords : [];

  const medConfirmed = confirmed.find((c) =>
    /med|用药|处方|药品|medication/i.test(confirmationBlob(c))
  );
  const metricConfirmed = confirmed.find((c) =>
    /metric|血压|血糖|指标|化验|检验/i.test(confirmationBlob(c))
  );
  const followConfirmed = confirmed.find((c) =>
    /follow|复诊|复查|随访/i.test(confirmationBlob(c))
  );

  if (medConfirmed) {
    const payload = parsePayload(medConfirmed);
    const title = payload.title || "按医嘱服药并打卡";
    items.push({ kind: "medication", title, meta: payload });
  }
  if (
    metricConfirmed ||
    records.some((r) => /血压|血糖|metric|化验|检验/i.test(String(r.category || r.title || "")))
  ) {
    items.push({
      kind: "metric",
      title: "记录今日血压或关键指标",
      meta: { metricKey: "bp" },
    });
  }
  if (followConfirmed) {
    items.push({
      kind: "followup",
      title: "确认复诊安排",
      meta: parsePayload(followConfirmed),
    });
  }

  // 已有任意确认但未命中分类：仍生成可执行回顾任务，避免 UI 确认后无法成计划
  if (!items.length && confirmed.length) {
    const payload = parsePayload(confirmed[0]);
    items.push({
      kind: "review",
      title: payload.title ? `跟进：${payload.title}` : "按已确认资料执行健康管理",
      meta: { ...payload, confirmationCount: confirmed.length },
    });
  }

  // 无确认时：若有任意健康记录，仍可生成「回顾记录」弱计划；否则失败
  if (!items.length && records.length) {
    items.push({
      kind: "review",
      title: "回顾已有健康记录并补充用药信息",
      meta: { recordCount: records.length },
    });
  }

  if (!items.length) {
    return {
      ok: false,
      reason: "档案信息不足，请先确认用药、指标或复诊信息",
      missing: ["medication_or_metric_or_followup"],
    };
  }

  const name = (profile && (profile.name || profile.displayName)) || "我的";
  return {
    ok: true,
    title: `${name}的健康计划`.replace(/^我的的/, "我的"),
    mode: "self",
    items,
    source: {
      confirmationIds: confirmed.map((c) => c.id || c.source_key),
      recordCount: records.length,
    },
  };
}

module.exports = { generatePlanDraft };
