"use strict";

const { nowIso } = require("./schema.js");
const { parseJson } = require("./catalog.js");
const { createRepo } = require("../mpV32/repo.js");

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

function createActivation(db, ordersApi, entitlementsApi) {
  const repo = createRepo(db);

  function mapInstance(row) {
    if (!row) return null;
    return {
      id: row.id,
      orderId: row.order_id,
      personId: row.person_id,
      doctorId: row.doctor_id,
      versionId: row.version_id,
      title: row.title,
      status: row.status,
      serviceStartDate: row.service_start_date,
      serviceEndDate: row.service_end_date,
      planId: row.plan_id,
      summary: parseJson(row.summary_json, {}),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  function buildPlanItems(snapshot) {
    const contentItems = Array.isArray(snapshot.contentItems) ? snapshot.contentItems : [];
    const day0 = contentItems.filter((c) => Number(c.dayOffset || 0) === 0);
    const planItems = (day0.length ? day0 : contentItems.slice(0, 1)).map((c) => ({
      kind: c.kind || "content",
      title: c.title || "康复指导",
      schedule: { dayOffset: Number(c.dayOffset || 0) },
      meta: { required: !!c.required, body: c.body || "", source: "service_package" },
    }));
    if (!planItems.length) {
      planItems.push({
        kind: "content",
        title: "术后康复指导（首日）",
        schedule: { dayOffset: 0 },
        meta: { required: true, source: "service_package" },
      });
    }
    return { contentItems, planItems };
  }

  function approve(orderId, { adminId, serviceStartDate, note } = {}) {
    const raw = ordersApi.getRaw(orderId);
    if (!raw) {
      const err = new Error("订单不存在");
      err.code = "not_found";
      throw err;
    }

    // 幂等：已 active 且有实例则直接返回首条实例
    if (raw.status === "active") {
      const existing = db
        .prepare(`SELECT * FROM svc_instances WHERE order_id=? ORDER BY id ASC LIMIT 1`)
        .get(+orderId);
      if (existing) return mapInstance(existing);
    }

    if (raw.status !== "pending_review" && raw.status !== "paid_pending_profile") {
      const err = new Error("仅待审核订单可开通");
      err.code = "invalid_status";
      throw err;
    }

    const order = ordersApi.mapOrder(raw);
    // mapOrder 已挂 lines；旧单无行时合成单行
    const lines = order.lines && order.lines.length ? order.lines : [];
    if (!lines.length) {
      const err = new Error("订单无可用行");
      err.code = "validation";
      throw err;
    }

    const start = String(serviceStartDate || todayLocal()).slice(0, 10);
    const ts = nowIso();
    const insertInstance = db.prepare(
      `INSERT INTO svc_instances(
        order_id, person_id, doctor_id, version_id, title, status,
        service_start_date, service_end_date, plan_id, summary_json, created_at, updated_at
      ) VALUES (?,?,?,?,?,'active',?,?,?,?,?,?)`
    );
    const updateLineInstance = db.prepare(`UPDATE svc_order_lines SET instance_id=? WHERE id=?`);

    let firstInstanceId = null;
    let firstMapped = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const snapshot = line.snapshot && typeof line.snapshot === "object" ? line.snapshot : {};
      const serviceDays = Number(snapshot.serviceDays || 30);
      const end = addDays(start, Math.max(serviceDays - 1, 0));
      const title = line.title || snapshot.title || "服务包";
      const versionId = line.versionId != null ? +line.versionId : +raw.version_id;

      // S2：康复计划/今日任务仅对首行创建，避免按行 fan-out 双倍任务；后续可扩展每行独立计划
      let planId = null;
      let planItems = [];
      let contentItems = [];
      if (i === 0) {
        ({ contentItems, planItems } = buildPlanItems(snapshot));
        const plan = repo.insertPlanWithItems(+raw.person_id, {
          title: `${title} · 康复计划`,
          mode: "doctor",
          source: { type: "service_package", orderId: +orderId, versionId },
          items: planItems,
          doctorId: +raw.doctor_id,
        });
        const activePlan = repo.setPlanStatus(+raw.person_id, plan.id, "active");
        repo.ensureTodayTasks(+raw.person_id, activePlan || plan);
        planId = plan.id;
      } else {
        contentItems = Array.isArray(snapshot.contentItems) ? snapshot.contentItems : [];
      }

      const info = insertInstance.run(
        +orderId,
        +raw.person_id,
        +raw.doctor_id,
        versionId,
        title,
        start,
        end,
        planId,
        JSON.stringify({
          nextTask: planItems[0] ? planItems[0].title : "",
          contentCount: contentItems.length,
          assessmentCount: Array.isArray(snapshot.assessmentItems) ? snapshot.assessmentItems.length : 0,
        }),
        ts,
        ts
      );

      const instanceId = Number(info.lastInsertRowid);
      if (line.id != null) {
        updateLineInstance.run(instanceId, +line.id);
      }

      // S2：为每行实例生成权益记录（幂等）
      if (entitlementsApi) {
        const benefitItems = Array.isArray(snapshot.benefitItems) ? snapshot.benefitItems : [];
        if (benefitItems.length) {
          entitlementsApi.ensureForInstance({
            instance: mapInstance(db.prepare(`SELECT * FROM svc_instances WHERE id=?`).get(instanceId)),
            orderLine: line,
            benefitItems,
          });
        }
      }

      if (i === 0) {
        firstInstanceId = instanceId;
        firstMapped = mapInstance(db.prepare(`SELECT * FROM svc_instances WHERE id=?`).get(instanceId));
      }
    }

    // 订单头 instance_id = 首行实例；状态 active
    ordersApi.setStatus(orderId, "active", {
      reviewedAt: ts,
      reviewerAdminId: adminId || null,
      reviewNote: note || "",
      serviceStartDate: start,
      instanceId: firstInstanceId,
    });

    // PRD §8.13/§10.1：组合激活成功写入跨系统事件 outbox（幂等键 = 订单维度），供权益发放/运营实例/实物出库编排与重试
    try {
      const eventKey = `package_activate:order:${orderId}`;
      const existing = db
        .prepare(`SELECT id FROM mall_integration_outbox WHERE idempotency_key=?`)
        .get(eventKey);
      if (!existing) {
        db.prepare(
          `INSERT INTO mall_integration_outbox(
            package_instance_id,package_component_instance_id,event_type,status,idempotency_key,
            payload_json,result_json,error_message,attempts,next_retry_at,created_at,updated_at
          ) VALUES (?,NULL,?,?,?,?,?,NULL,0,NULL,?,?)`
        ).run(
          firstInstanceId || null,
          "package_activated",
          "succeeded",
          eventKey,
          JSON.stringify({
            orderId: +orderId,
            personId: +raw.person_id,
            doctorId: +raw.doctor_id,
            instanceId: firstInstanceId,
            serviceStartDate: start,
            lines: lines.map((l) => ({ lineId: l.id, title: l.title || "" })),
          }),
          JSON.stringify({ ok: true }),
          ts,
          ts
        );
      }
    } catch (e) {
      // outbox 写入失败不阻断激活主流程；由审计/重跑兜底
      console.warn("[package-outbox] 写入失败", e && e.message);
    }

    return firstMapped;
  }

  function listForPerson(personId) {
    return db
      .prepare(`SELECT * FROM svc_instances WHERE person_id=? ORDER BY id DESC LIMIT 100`)
      .all(+personId)
      .map(mapInstance);
  }

  function getForPerson(instanceId, personId) {
    const row = db
      .prepare(`SELECT * FROM svc_instances WHERE id=? AND person_id=?`)
      .get(+instanceId, +personId);
    return mapInstance(row);
  }

  /** 兼容旧调用：返回该订单首个实例（按 id ASC） */
  function getByOrderId(orderId) {
    return mapInstance(
      db.prepare(`SELECT * FROM svc_instances WHERE order_id=? ORDER BY id ASC LIMIT 1`).get(+orderId)
    );
  }

  function listByOrderId(orderId) {
    return db
      .prepare(`SELECT * FROM svc_instances WHERE order_id=? ORDER BY id ASC`)
      .all(+orderId)
      .map(mapInstance);
  }

  return {
    approve,
    listForPerson,
    getForPerson,
    getByOrderId,
    listByOrderId,
    mapInstance,
    todayLocal,
  };
}

module.exports = { createActivation };
