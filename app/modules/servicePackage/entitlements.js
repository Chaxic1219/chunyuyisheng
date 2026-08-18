"use strict";

const { nowIso } = require("./schema.js");

function ensureColumn(db, table, column, ddlFragment) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddlFragment}`);
  }
}

function addDays(dateStr, days) {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + Number(days || 0));
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function todayLocal() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function fmtDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function runTx(db, fn) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (e) {
    try { db.exec("ROLLBACK"); } catch (_) { /* ignore */ }
    throw e;
  }
}

/**
 * 计算 PERIOD_LIMIT 权益的当前周期窗口。
 * 返回 { periodStart, periodEnd, nextResetAt } (YYYY-MM-DD)。
 */
function computePeriodWindow(rule, validFrom) {
  const now = new Date();
  const anchor = new Date(validFrom + "T00:00:00");
  const periodUnit = String(rule.periodUnit || "").trim().toUpperCase();
  const anchorDay = anchor.getDate();

  let periodStart, periodEnd, nextResetAt;

  if (periodUnit === "DAY") {
    periodStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    periodEnd = new Date(periodStart);
    nextResetAt = new Date(periodEnd.getTime() + 86400000);
  } else if (periodUnit === "WEEK") {
    const msPerDay = 86400000;
    const daysSinceAnchor = Math.floor((now.getTime() - anchor.getTime()) / msPerDay);
    const weekNum = Math.max(0, Math.floor(daysSinceAnchor / 7));
    const offsetMs = weekNum * 7 * msPerDay;
    periodStart = new Date(anchor.getTime() + offsetMs);
    periodEnd = new Date(periodStart.getTime() + 6 * msPerDay);
    nextResetAt = new Date(periodEnd.getTime() + 86400000);
  } else if (periodUnit === "MONTH") {
    // 日历月，锚定 valid_from 所在日。clamp 到该月最后一天。
    let monthsDelta =
      (now.getFullYear() - anchor.getFullYear()) * 12 +
      (now.getMonth() - anchor.getMonth());
    if (now.getDate() < anchorDay) monthsDelta--;
    if (monthsDelta < 0) monthsDelta = 0;

    periodStart = new Date(
      anchor.getFullYear(),
      anchor.getMonth() + monthsDelta,
      anchorDay
    );
    // clamp: 若锚定日超出该月天数，取最后一天
    const lastDayPS = new Date(
      periodStart.getFullYear(),
      periodStart.getMonth() + 1,
      0
    ).getDate();
    if (periodStart.getDate() > lastDayPS) {
      periodStart.setDate(lastDayPS);
    }

    // periodEnd = periodStart + 1 个月 - 1 天
    periodEnd = new Date(periodStart);
    periodEnd.setMonth(periodEnd.getMonth() + 1);
    periodEnd.setDate(periodEnd.getDate() - 1);
    // clamp
    const lastDayPE = new Date(
      periodEnd.getFullYear(),
      periodEnd.getMonth() + 1,
      0
    ).getDate();
    if (periodEnd.getDate() > lastDayPE) {
      periodEnd.setDate(lastDayPE);
    }

    nextResetAt = new Date(periodEnd.getTime() + 86400000);
  } else {
    // 默认：以 validFrom..validTo 为一个大周期
    periodStart = new Date(validFrom + "T00:00:00");
    periodEnd = new Date(validFrom + "T00:00:00"); // fallback
    periodEnd.setFullYear(periodEnd.getFullYear() + 100);
    nextResetAt = new Date(periodEnd.getTime() + 86400000);
  }

  return {
    periodStart: fmtDate(periodStart),
    periodEnd: fmtDate(periodEnd),
    nextResetAt: fmtDate(nextResetAt),
  };
}

/**
 * 统计当前周期窗口内已消费的配额（COMPLETED 状态的 consumed_qty）。
 */
function sumConsumedInWindow(db, entitlementId, periodStart, periodEnd) {
  const row = db.prepare(
    `SELECT COALESCE(SUM(consumed_qty), 0) as total
     FROM svc_entitlement_usages
     WHERE entitlement_id=?
       AND status='COMPLETED'
       AND requested_at >= ?
       AND requested_at < ?`
  ).get(
    +entitlementId,
    periodStart + "T00:00:00",
    addDays(periodEnd, 1) + "T00:00:00"
  );
  return Number(row.total);
}

/**
 * 统计当前周期窗口内已预留的配额（REQUESTED/ACCEPTED/IN_PROGRESS 的 reserved_qty）。
 */
function sumReservedInWindow(db, entitlementId, periodStart, periodEnd) {
  const row = db.prepare(
    `SELECT COALESCE(SUM(reserved_qty), 0) as total
     FROM svc_entitlement_usages
     WHERE entitlement_id=?
       AND status IN ('REQUESTED','ACCEPTED','IN_PROGRESS')
       AND requested_at >= ?
       AND requested_at < ?`
  ).get(
    +entitlementId,
    periodStart + "T00:00:00",
    addDays(periodEnd, 1) + "T00:00:00"
  );
  return Number(row.total);
}

/**
 * 刷新权益状态：根据 valid_from / valid_to 对比今天做 PENDING→ACTIVE→EXPIRED 转换。
 * 返回当前有效状态。仅在发生变化时写库。
 */
function refreshStatus(db, row) {
  const today = todayLocal();
  let status = row.status;
  if (status === "PENDING" && today >= row.valid_from) {
    status = "ACTIVE";
  }
  if (status === "ACTIVE" && row.valid_to && today > row.valid_to) {
    status = "EXPIRED";
  }
  if (status !== row.status) {
    db.prepare(`UPDATE svc_entitlements SET status=?, updated_at=? WHERE id=?`).run(
      status,
      nowIso(),
      row.id
    );
  }
  return status;
}

/**
 * 计算 PERIOD_LIMIT 权益的当前窗口剩余配额。
 */
function computePeriodRemaining(db, entitlementId, rule, validFrom) {
  const { periodStart, periodEnd } = computePeriodWindow(rule, validFrom);
  const consumed = sumConsumedInWindow(db, entitlementId, periodStart, periodEnd);
  const reserved = sumReservedInWindow(db, entitlementId, periodStart, periodEnd);
  const pq = Number(rule.periodQuota || 0);
  return Math.max(0, pq - consumed - reserved);
}

function createEntitlements(db) {
  // 向后兼容未含 action_key / action_label 的旧 schema
  ensureColumn(db, "svc_entitlements", "action_key", "action_key TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, "svc_entitlements", "action_label", "action_label TEXT NOT NULL DEFAULT ''");

  function mapUsage(row) {
    if (!row) return null;
    return {
      id: row.id,
      entitlementId: row.entitlement_id,
      idempotencyKey: row.idempotency_key,
      status: row.status,
      requestedQty: row.requested_qty,
      reservedQty: row.reserved_qty,
      consumedQty: row.consumed_qty,
      balanceBefore: row.balance_before,
      balanceAfter: row.balance_after,
      bizType: row.biz_type,
      bizRef: row.biz_ref,
      actorType: row.actor_type,
      actorId: row.actor_id,
      note: row.note,
      requestedAt: row.requested_at,
      acceptedAt: row.accepted_at,
      completedAt: row.completed_at,
      cancelledAt: row.cancelled_at,
      updatedAt: row.updated_at,
    };
  }

  function mapEntitlement(row) {
    if (!row) return null;
    const rule = JSON.parse(row.rule_json || "{}");
    const dto = {
      id: row.id,
      instanceId: row.instance_id,
      componentCode: row.component_code,
      name: row.name,
      type: row.type,
      unit: row.unit,
      totalQuota: row.total_quota,
      usedQuota: row.used_quota,
      reservedQuota: row.reserved_quota,
      remainingQuota: row.remaining_quota,
      validFrom: row.valid_from,
      validTo: row.valid_to,
      status: row.status,
      actionKey: row.action_key,
      actionLabel: row.action_label,
      rule: { ...rule },
      latestUsage: null,
    };

    // PERIOD_LIMIT: 计算当前窗口剩余 & 周期信息
    if (
      rule.benefitType === "PERIOD_LIMIT" &&
      rule.periodUnit &&
      rule.periodQuota != null
    ) {
      const { periodStart, periodEnd, nextResetAt } = computePeriodWindow(
        rule,
        row.valid_from
      );
      dto.remainingQuota = computePeriodRemaining(
        db,
        row.id,
        rule,
        row.valid_from
      );
      dto.rule.periodStart = periodStart;
      dto.rule.periodEnd = periodEnd;
      dto.rule.nextResetAt = nextResetAt;
    } else if (row.total_quota != null) {
      // TOTAL_LIMIT: remaining = total - used - reserved
      dto.remainingQuota =
        Number(row.total_quota) - Number(row.used_quota) - Number(row.reserved_quota);
    } else {
      // UNLIMITED
      dto.remainingQuota = null;
    }

    // 附加最近一次使用记录
    const latestRow = db.prepare(
      `SELECT * FROM svc_entitlement_usages
       WHERE entitlement_id=?
       ORDER BY id DESC LIMIT 1`
    ).get(row.id);
    if (latestRow) {
      dto.latestUsage = mapUsage(latestRow);
    }

    return dto;
  }

  function resolveQuota(item) {
    const benefitType = String(item.benefitType || "").trim().toUpperCase();
    if (benefitType === "UNLIMITED" || benefitType === "DAILY_CONTENT") {
      return null;
    }
    if (item.totalQuota != null) return Number(item.totalQuota);
    if (item.periodQuota != null) return Number(item.periodQuota);
    return null;
  }

  function ensureForInstance({ instance, orderLine, benefitItems }) {
    if (!instance || !instance.id) return;
    if (!Array.isArray(benefitItems) || !benefitItems.length) return;

    const ts = nowIso();
    const insert = db.prepare(
      `INSERT OR IGNORE INTO svc_entitlements(
        instance_id, order_line_id, person_id, doctor_id, version_item_id,
        component_code, name, type, provider_json, unit,
        total_quota, used_quota, reserved_quota, remaining_quota,
        valid_from, valid_to, status, rule_json, snapshot_json,
        action_key, action_label, created_at, updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,0,0,?,?,?,'ACTIVE',?,?,?,?,?,?)`
    );

    for (const item of benefitItems) {
      const validFrom = addDays(instance.serviceStartDate, item.startDay || 0);
      const validTo = item.endDay != null
        ? addDays(instance.serviceStartDate, item.endDay)
        : instance.serviceEndDate;

      const quota = resolveQuota(item);

      const rule = {
        benefitType: item.benefitType,
        totalQuota: item.totalQuota,
        periodUnit: item.periodUnit,
        periodQuota: item.periodQuota,
        startDay: item.startDay,
        endDay: item.endDay,
        maxConcurrent: item.maxConcurrent,
        settlementEnabled: item.settlementEnabled,
        resetEachPeriod: item.resetEachPeriod,
        allowRepeatApply: item.allowRepeatApply,
        leadDays: item.leadDays,
      };

      insert.run(
        instance.id,
        orderLine && orderLine.id != null ? orderLine.id : null,
        instance.personId,
        instance.doctorId,
        item.id != null ? item.id : null,
        String(item.componentCode || ""),
        String(item.name || ""),
        String(item.type || ""),
        item.provider ? JSON.stringify(item.provider) : "{}",
        String(item.unit || ""),
        quota,
        quota,
        validFrom,
        validTo,
        JSON.stringify(rule),
        JSON.stringify(item),
        String(item.actionKey || ""),
        String(item.actionLabel || ""),
        ts,
        ts
      );
    }
  }

  function listForInstance(instanceId, personId) {
    return db
      .prepare(
        `SELECT * FROM svc_entitlements WHERE instance_id=? AND person_id=? ORDER BY id ASC`
      )
      .all(+instanceId, +personId)
      .map(mapEntitlement);
  }

  function getForPerson(id, personId) {
    const row = db
      .prepare(`SELECT * FROM svc_entitlements WHERE id=? AND person_id=?`)
      .get(+id, +personId);
    if (!row) return null;

    // 刷新状态
    refreshStatus(db, row);

    // 重新读取以确保拿到最新 status
    const fresh = db.prepare(`SELECT * FROM svc_entitlements WHERE id=?`).get(+id);
    return mapEntitlement(fresh);
  }

  function listAdmin({ status, doctorId, personId, limit, offset } = {}) {
    const conditions = [];
    const args = [];
    if (status) {
      conditions.push("e.status=?");
      args.push(String(status));
    }
    if (doctorId != null) {
      conditions.push("e.doctor_id=?");
      args.push(+doctorId);
    }
    if (personId != null) {
      conditions.push("e.person_id=?");
      args.push(+personId);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const lim = Math.min(Math.max(+limit || 50, 1), 200);
    const off = Math.max(+offset || 0, 0);
    return db
      .prepare(`SELECT e.* FROM svc_entitlements e ${where} ORDER BY e.id DESC LIMIT ? OFFSET ?`)
      .all(...args, lim, off)
      .map(mapEntitlement);
  }

  // ──── 使用事务 ────

  function requestUsage(personId, entitlementId, body) {
    return runTx(db, () => {
      const row = db
        .prepare(`SELECT * FROM svc_entitlements WHERE id=? AND person_id=?`)
        .get(+entitlementId, +personId);
      if (!row) {
        const err = new Error("权益不存在");
        err.code = "not_found";
        throw err;
      }

      // 刷新并校验状态（EXHAUSTED 允许通过，由配额检查拒绝）
      const currentStatus = refreshStatus(db, row);
      if (currentStatus !== "ACTIVE" && currentStatus !== "EXHAUSTED") {
        const err = new Error("权益未生效或已过期");
        err.code = "entitlement_inactive";
        throw err;
      }
      // 重新读取以拿到最新 remaining 等字段
      const ent = db.prepare(`SELECT * FROM svc_entitlements WHERE id=?`).get(+entitlementId);

      const rule = JSON.parse(ent.rule_json || "{}");
      const qty = Math.max(1, Number(body.qty || 1));
      const idemKey = String(body.idempotencyKey || "").trim();
      if (!idemKey) {
        const err = new Error("缺少 idempotencyKey");
        err.code = "validation";
        throw err;
      }

      // ── 幂等 ──
      const existing = db
        .prepare(
          `SELECT * FROM svc_entitlement_usages WHERE entitlement_id=? AND idempotency_key=?`
        )
        .get(+entitlementId, idemKey);
      if (existing) {
        if (
          Number(existing.requested_qty) !== qty ||
          String(existing.biz_type || "") !== String(body.bizType || "") ||
          String(existing.biz_ref || "") !== String(body.bizRef || "")
        ) {
          const err = new Error("幂等键冲突：同一 key 但请求参数不同");
          err.code = "idempotency_conflict";
          throw err;
        }
        return mapUsage(existing);
      }

      // ── 并发限制 ──
      const maxConcurrent = rule.maxConcurrent != null ? Number(rule.maxConcurrent) : 1;
      if (maxConcurrent > 0) {
        const activeCount = db
          .prepare(
            `SELECT COUNT(*) as cnt FROM svc_entitlement_usages
             WHERE entitlement_id=?
               AND status IN ('REQUESTED','ACCEPTED','IN_PROGRESS')`
          )
          .get(+entitlementId).cnt;
        if (Number(activeCount) >= maxConcurrent) {
          const err = new Error("已达并发上限");
          err.code = "concurrent_limit";
          throw err;
        }
      }

      // ── 配额检查 ──
      const benefitType = String(rule.benefitType || "").toUpperCase();
      const isPeriodLimited =
        benefitType === "PERIOD_LIMIT" && rule.periodUnit && rule.periodQuota != null;

      if (isPeriodLimited) {
        const { periodStart, periodEnd } = computePeriodWindow(rule, ent.valid_from);
        const consumed = sumConsumedInWindow(db, +entitlementId, periodStart, periodEnd);
        const reserved = sumReservedInWindow(db, +entitlementId, periodStart, periodEnd);
        const available = Number(rule.periodQuota) - consumed - reserved;
        if (available < qty) {
          const err = new Error("当前周期配额不足");
          err.code = "quota_insufficient";
          throw err;
        }
      } else if (ent.total_quota != null) {
        // TOTAL_LIMIT
        const available = Number(ent.remaining_quota) - Number(ent.reserved_quota);
        // remaining_quota 已是 total - used - reserved，再减 reserved 就重复了
        // 实际上 remaining = total - used - reserved，所以 available = remaining
        // 用 total - used - reserved 直接计算更安全
        const safeAvailable =
          Number(ent.total_quota) - Number(ent.used_quota) - Number(ent.reserved_quota);
        if (safeAvailable < qty) {
          const err = new Error("配额不足");
          err.code = "quota_insufficient";
          throw err;
        }
      }
      // UNLIMITED / DAILY_CONTENT 不检查配额

      // ── 插入 usage ──
      const now = nowIso();
      const info = db
        .prepare(
          `INSERT INTO svc_entitlement_usages(
            entitlement_id, idempotency_key, status, requested_qty, reserved_qty,
            biz_type, biz_ref, actor_type, actor_id, note, requested_at, updated_at
          ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
        )
        .run(
          +entitlementId,
          idemKey,
          "REQUESTED",
          qty,
          qty,
          String(body.bizType || ""),
          String(body.bizRef || ""),
          String(body.actorType || "patient"),
          body.actorId != null ? +body.actorId : personId,
          String(body.note || ""),
          now,
          now
        );
      const usageId = Number(info.lastInsertRowid);

      // ── 更新权益 ──
      const newReserved = Number(ent.reserved_quota) + qty;

      let newRemaining;
      if (isPeriodLimited) {
        const { periodStart, periodEnd } = computePeriodWindow(rule, ent.valid_from);
        const consumed = sumConsumedInWindow(db, +entitlementId, periodStart, periodEnd);
        const reservedW = sumReservedInWindow(db, +entitlementId, periodStart, periodEnd);
        newRemaining = Math.max(0, Number(rule.periodQuota) - consumed - reservedW);
      } else if (ent.total_quota != null) {
        newRemaining = Math.max(0, Number(ent.total_quota) - Number(ent.used_quota) - newReserved);
      } else {
        newRemaining = null;
      }

      db.prepare(
        `UPDATE svc_entitlements SET reserved_quota=?, remaining_quota=?, updated_at=? WHERE id=?`
      ).run(newReserved, newRemaining, now, +entitlementId);

      return mapUsage(
        db.prepare(`SELECT * FROM svc_entitlement_usages WHERE id=?`).get(usageId)
      );
    });
  }

  function completeUsage(usageId, actor) {
    return runTx(db, () => {
      const usage = db
        .prepare(`SELECT * FROM svc_entitlement_usages WHERE id=?`)
        .get(+usageId);
      if (!usage) {
        const err = new Error("使用记录不存在");
        err.code = "not_found";
        throw err;
      }

      // 已 COMPLETED → 幂等返回
      if (usage.status === "COMPLETED") {
        return mapUsage(usage);
      }

      // 只允许 REQUESTED / ACCEPTED / IN_PROGRESS 完成
      if (!["REQUESTED", "ACCEPTED", "IN_PROGRESS"].includes(usage.status)) {
        const err = new Error("当前状态不可完成");
        err.code = "usage_invalid_status";
        throw err;
      }

      const ent = db
        .prepare(`SELECT * FROM svc_entitlements WHERE id=?`)
        .get(+usage.entitlement_id);
      if (!ent) {
        const err = new Error("权益记录不存在");
        err.code = "not_found";
        throw err;
      }

      const qty = Number(usage.requested_qty);
      const now = nowIso();
      const balanceBefore = Number(ent.used_quota);
      const newUsed = balanceBefore + qty;
      const newReserved = Math.max(0, Number(ent.reserved_quota) - qty);

      const rule = JSON.parse(ent.rule_json || "{}");
      const isPeriodLimited =
        String(rule.benefitType || "").toUpperCase() === "PERIOD_LIMIT" &&
        rule.periodUnit &&
        rule.periodQuota != null;

      let newRemaining;
      if (isPeriodLimited) {
        const { periodStart, periodEnd } = computePeriodWindow(rule, ent.valid_from);
        const consumed = sumConsumedInWindow(db, +ent.id, periodStart, periodEnd);
        const reservedW = sumReservedInWindow(db, +ent.id, periodStart, periodEnd);
        newRemaining = Math.max(0, Number(rule.periodQuota) - consumed - reservedW);
      } else if (ent.total_quota != null) {
        newRemaining = Math.max(0, Number(ent.total_quota) - newUsed - newReserved);
      } else {
        newRemaining = null;
      }

      // 决定权益新状态
      let newEntStatus = ent.status;
      if (ent.total_quota != null && newRemaining === 0) {
        newEntStatus = "EXHAUSTED";
      } else if (ent.valid_to && todayLocal() > ent.valid_to) {
        newEntStatus = "EXPIRED";
      }

      // 更新 usage
      db.prepare(
        `UPDATE svc_entitlement_usages SET
          status='COMPLETED',
          reserved_qty=0,
          consumed_qty=?,
          balance_before=?,
          balance_after=?,
          actor_type=?,
          actor_id=?,
          completed_at=?,
          updated_at=?
         WHERE id=?`
      ).run(
        qty,
        balanceBefore,
        newUsed,
        String(actor.type || "admin"),
        actor.id != null ? +actor.id : null,
        now,
        now,
        +usageId
      );

      // 更新权益
      db.prepare(
        `UPDATE svc_entitlements SET
          used_quota=?, reserved_quota=?, remaining_quota=?, status=?, updated_at=?
         WHERE id=?`
      ).run(newUsed, newReserved, newRemaining, newEntStatus, now, +ent.id);

      return mapUsage(
        db.prepare(`SELECT * FROM svc_entitlement_usages WHERE id=?`).get(+usageId)
      );
    });
  }

  function cancelUsage(personId, usageId) {
    return runTx(db, () => {
      const usage = db
        .prepare(`SELECT * FROM svc_entitlement_usages WHERE id=?`)
        .get(+usageId);
      if (!usage) {
        const err = new Error("使用记录不存在");
        err.code = "not_found";
        throw err;
      }

      // 校验归属：usage 关联的 entitlement 必须属于该 person
      const ent = db
        .prepare(`SELECT * FROM svc_entitlements WHERE id=? AND person_id=?`)
        .get(+usage.entitlement_id, +personId);
      if (!ent) {
        const err = new Error("使用记录不存在");
        err.code = "not_found";
        throw err;
      }

      // 只能取消 REQUESTED 状态
      if (usage.status !== "REQUESTED") {
        const err = new Error("仅 REQUESTED 状态可取消");
        err.code = "usage_invalid_status";
        throw err;
      }

      const qty = Number(usage.requested_qty);
      const now = nowIso();
      const newReserved = Math.max(0, Number(ent.reserved_quota) - qty);

      const rule = JSON.parse(ent.rule_json || "{}");
      const isPeriodLimited =
        String(rule.benefitType || "").toUpperCase() === "PERIOD_LIMIT" &&
        rule.periodUnit &&
        rule.periodQuota != null;

      let newRemaining;
      if (isPeriodLimited) {
        const { periodStart, periodEnd } = computePeriodWindow(rule, ent.valid_from);
        const consumed = sumConsumedInWindow(db, +ent.id, periodStart, periodEnd);
        const reservedW = sumReservedInWindow(db, +ent.id, periodStart, periodEnd);
        newRemaining = Math.max(0, Number(rule.periodQuota) - consumed - reservedW);
      } else if (ent.total_quota != null) {
        newRemaining = Math.max(0, Number(ent.total_quota) - Number(ent.used_quota) - newReserved);
      } else {
        newRemaining = null;
      }

      // 更新 usage
      db.prepare(
        `UPDATE svc_entitlement_usages SET
          status='CANCELLED', reserved_qty=0, cancelled_at=?, updated_at=?
         WHERE id=?`
      ).run(now, now, +usageId);

      // 更新权益
      db.prepare(
        `UPDATE svc_entitlements SET reserved_quota=?, remaining_quota=?, updated_at=? WHERE id=?`
      ).run(newReserved, newRemaining, now, +ent.id);

      return mapUsage(
        db.prepare(`SELECT * FROM svc_entitlement_usages WHERE id=?`).get(+usageId)
      );
    });
  }

  return {
    ensureForInstance,
    listForInstance,
    getForPerson,
    listAdmin,
    requestUsage,
    completeUsage,
    cancelUsage,
    mapEntitlement,
    mapUsage,
  };
}

module.exports = { createEntitlements };
