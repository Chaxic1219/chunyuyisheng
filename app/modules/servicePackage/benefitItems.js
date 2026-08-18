"use strict";

const { nowIso } = require("./schema.js");

const BENEFIT_TYPES = new Set([
  "TOTAL_LIMIT",
  "PERIOD_LIMIT",
  "UNLIMITED",
  "DAILY_CONTENT",
  "PHYSICAL_GOODS",
  "EXTERNAL_SERVICE",
]);

function normalizeBenefitItems(db, items) {
  if (!Array.isArray(items) || !items.length) return [];

  const result = [];
  const seen = new Set();

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const componentId = Number(item.componentId);
    if (!Number.isFinite(componentId) || componentId <= 0) {
      const err = new Error("benefitItems: componentId 必须为正整数");
      err.code = "validation";
      throw err;
    }

    const component = db.prepare(`SELECT * FROM svc_components WHERE id=?`).get(componentId);
    if (!component) {
      const err = new Error(`benefitItems: 组件 id=${componentId} 不存在`);
      err.code = "validation";
      throw err;
    }
    if (component.status !== "active") {
      const err = new Error(`benefitItems: 组件 "${component.name}" 已禁用`);
      err.code = "validation";
      throw err;
    }

    const benefitType = String(item.benefitType || "UNLIMITED").trim();
    if (!BENEFIT_TYPES.has(benefitType)) {
      const err = new Error(`benefitItems: 不支持的 benefitType "${benefitType}"`);
      err.code = "validation";
      throw err;
    }

    let totalQuota = null;
    let periodUnit = null;
    let periodQuota = null;

    if (benefitType === "TOTAL_LIMIT" || benefitType === "PHYSICAL_GOODS") {
      totalQuota = Number(item.totalQuota);
      if (!Number.isFinite(totalQuota) || totalQuota <= 0) {
        const err = new Error(`benefitItems: 类型 ${benefitType} 需要 totalQuota > 0`);
        err.code = "validation";
        throw err;
      }
    } else if (benefitType === "PERIOD_LIMIT") {
      periodUnit = String(item.periodUnit || "").trim().toUpperCase();
      if (!["DAY", "WEEK", "MONTH"].includes(periodUnit)) {
        const err = new Error("benefitItems: PERIOD_LIMIT 需要 periodUnit 为 DAY|WEEK|MONTH");
        err.code = "validation";
        throw err;
      }
      periodQuota = Number(item.periodQuota);
      if (!Number.isFinite(periodQuota) || periodQuota <= 0) {
        const err = new Error("benefitItems: PERIOD_LIMIT 需要 periodQuota > 0");
        err.code = "validation";
        throw err;
      }
    } else if (benefitType === "UNLIMITED") {
      totalQuota = null;
      periodQuota = null;
    }

    const maxConcurrent = Math.max(1, Number(item.maxConcurrent) || 1);
    const startDay = Math.max(0, Number(item.startDay) || 0);
    const endDay = item.endDay != null ? Number(item.endDay) : null;
    if (endDay != null && endDay < startDay) {
      const err = new Error("benefitItems: endDay 不能小于 startDay");
      err.code = "validation";
      throw err;
    }
    const refundShareCents = Math.max(0, Math.round(Number(item.refundShareCents) || 0));
    const sortOrder = Number(item.sortOrder != null ? item.sortOrder : i * 10) || 0;

    // Duplicate detection: same componentId + providerType/providerRef + startDay + endDay
    const providerType = String(item.providerType || component.provider_type || "internal").trim();
    const providerRef = String(item.providerRef || component.provider_ref || "").trim();
    const dupKey = `${componentId}|${providerType}|${providerRef}|${startDay}|${endDay != null ? endDay : ""}`;
    if (seen.has(dupKey)) {
      const err = new Error(`benefitItems: 组件 "${component.name}" 存在重复 (相同 componentId + providerRef + startDay + endDay)，请合并配额`);
      err.code = "validation";
      throw err;
    }
    seen.add(dupKey);

    const name = String(item.name || component.name).trim();
    const unit = String(item.unit || component.default_unit).trim();
    const slaHours = item.slaHours != null ? Math.max(0, Number(item.slaHours)) : component.default_sla_hours;
    const leadDays = Math.max(0, Number(item.leadDays) || 0);
    const resetEachPeriod = !!item.resetEachPeriod;
    const allowRepeatApply = !!item.allowRepeatApply;
    const settlementEnabled = item.settlementEnabled ? 1 : (component.settlement_enabled ? 1 : 0);
    const actionKey = String(item.actionKey || component.default_action_key || "").trim();
    const actionLabel = String(item.actionLabel || component.default_action_label || "").trim();
    const notifyEnabled = item.notifyEnabled != null ? !!item.notifyEnabled : true;

    const provider = {
      type: providerType,
      ref: providerRef,
      name: String(item.providerName || component.provider_name || "").trim(),
    };

    const description = String(item.description || component.description || "").trim();

    const snapshot = {
      componentCode: component.code,
      name,
      type: component.type,
      provider,
      description,
      benefitType,
      totalQuota,
      periodUnit,
      periodQuota,
      unit,
      slaHours,
      leadDays,
      resetEachPeriod,
      allowRepeatApply,
      maxConcurrent,
      settlementEnabled: !!settlementEnabled,
      startDay,
      endDay,
      actionKey,
      actionLabel,
      notifyEnabled,
      refundShareCents,
      sortOrder,
    };

    result.push({
      componentId,
      componentCode: component.code,
      name,
      type: component.type,
      provider,
      description,
      benefitType,
      totalQuota,
      periodUnit,
      periodQuota,
      unit,
      slaHours,
      leadDays,
      resetEachPeriod,
      allowRepeatApply,
      maxConcurrent,
      settlementEnabled,
      startDay,
      endDay,
      actionKey,
      actionLabel,
      notifyEnabled,
      refundShareCents,
      sortOrder,
      snapshot,
    });
  }

  return result;
}

function insertVersionItems(db, versionId, items) {
  const ts = nowIso();
  const COLUMNS = [
    "version_id", "component_id", "component_code", "name", "type", "provider_json",
    "description", "benefit_type", "total_quota", "period_unit", "period_quota",
    "unit", "sla_hours", "lead_days", "reset_each_period", "allow_repeat_apply",
    "max_concurrent", "settlement_enabled", "start_day", "end_day",
    "action_key", "action_label", "notify_enabled", "refund_share_cents", "sort_order",
    "snapshot_json", "created_at",
  ];
  const stmt = db.prepare(
    `INSERT INTO svc_product_version_items(${COLUMNS.join(", ")}) VALUES (${COLUMNS.map(() => "?").join(", ")})`
  );

  const rows = [];
  for (const item of items) {
    const info = stmt.run(
      +versionId,
      item.componentId,
      item.componentCode,
      item.name,
      item.type,
      JSON.stringify(item.provider),
      item.description || "",
      item.benefitType,
      item.totalQuota,
      item.periodUnit,
      item.periodQuota,
      item.unit,
      item.slaHours,
      item.leadDays,
      item.resetEachPeriod ? 1 : 0,
      item.allowRepeatApply ? 1 : 0,
      item.maxConcurrent,
      item.settlementEnabled ? 1 : 0,
      item.startDay,
      item.endDay,
      item.actionKey,
      item.actionLabel,
      item.notifyEnabled ? 1 : 0,
      item.refundShareCents,
      item.sortOrder,
      JSON.stringify(item.snapshot),
      ts
    );
    rows.push({
      id: Number(info.lastInsertRowid),
      ...item.snapshot,
      componentId: item.componentId,
    });
  }
  return rows;
}

function listVersionItems(db, versionId) {
  const rows = db
    .prepare(`SELECT * FROM svc_product_version_items WHERE version_id=? ORDER BY sort_order, id`)
    .all(+versionId);
  return rows.map(mapRow);
}

function mapRow(row) {
  return {
    id: row.id,
    componentId: row.component_id,
    componentCode: row.component_code,
    name: row.name,
    type: row.type,
    provider: JSON.parse(row.provider_json || "{}"),
    description: row.description || "",
    benefitType: row.benefit_type,
    totalQuota: row.total_quota,
    periodUnit: row.period_unit,
    periodQuota: row.period_quota,
    unit: row.unit,
    slaHours: row.sla_hours,
    leadDays: row.lead_days,
    resetEachPeriod: !!row.reset_each_period,
    allowRepeatApply: !!row.allow_repeat_apply,
    maxConcurrent: row.max_concurrent,
    settlementEnabled: !!row.settlement_enabled,
    startDay: row.start_day,
    endDay: row.end_day,
    actionKey: row.action_key || "",
    actionLabel: row.action_label || "",
    notifyEnabled: !!row.notify_enabled,
    refundShareCents: row.refund_share_cents,
    sortOrder: row.sort_order,
  };
}

module.exports = {
  BENEFIT_TYPES,
  normalizeBenefitItems,
  insertVersionItems,
  listVersionItems,
};
