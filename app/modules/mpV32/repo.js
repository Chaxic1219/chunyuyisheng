"use strict";

function nowIso() {
  return new Date().toISOString();
}

function todayLocal() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function createRepo(db) {
  function getActivePlan(personId) {
    return db
      .prepare(
        `SELECT * FROM health_plans WHERE person_id=? AND status IN ('active','paused')
         ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END, updated_at DESC LIMIT 1`
      )
      .get(personId);
  }

  function getPlanItems(planId) {
    return db
      .prepare(`SELECT * FROM health_plan_items WHERE plan_id=? ORDER BY sort_order, id`)
      .all(planId);
  }

  function ensureTodayTasks(personId, plan) {
    if (!plan || plan.status !== "active") return [];
    const day = todayLocal();
    const items = getPlanItems(plan.id);
    const ins = db.prepare(
      `INSERT OR IGNORE INTO health_task_instances
       (plan_id, item_id, person_id, task_date, title, kind, status, payload_json, created_at)
       VALUES (?,?,?,?,?,?, 'pending', ?, ?)`
    );
    for (const it of items) {
      ins.run(
        plan.id,
        it.id,
        personId,
        day,
        it.title,
        it.kind,
        it.meta_json || "{}",
        nowIso()
      );
    }
    return db
      .prepare(
        `SELECT * FROM health_task_instances WHERE person_id=? AND plan_id=? AND task_date=?
         ORDER BY id`
      )
      .all(personId, plan.id, day);
  }

  function completeTask(personId, taskId, payload) {
    const row = db
      .prepare(`SELECT * FROM health_task_instances WHERE id=? AND person_id=?`)
      .get(taskId, personId);
    if (!row) {
      const err = new Error("task_not_found");
      err.code = "not_found";
      throw err;
    }
    if (row.status === "done") return row;
    db.prepare(
      `UPDATE health_task_instances SET status='done', completed_at=?, payload_json=? WHERE id=?`
    ).run(nowIso(), JSON.stringify(payload || {}), taskId);
    if (payload && payload.metricKey) {
      db.prepare(
        `INSERT INTO health_metric_logs(person_id, task_id, metric_key, value_json, recorded_at)
         VALUES (?,?,?,?,?)`
      ).run(
        personId,
        taskId,
        String(payload.metricKey),
        JSON.stringify(payload.value != null ? payload.value : payload),
        nowIso()
      );
    }
    return db.prepare(`SELECT * FROM health_task_instances WHERE id=?`).get(taskId);
  }

  function insertPlanWithItems(personId, { title, mode, source, items, doctorId }) {
    const ts = nowIso();
    const info = db
      .prepare(
        `INSERT INTO health_plans(person_id, title, mode, status, source_json, doctor_id, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?)`
      )
      .run(
        personId,
        title,
        mode || "self",
        "draft",
        JSON.stringify(source || {}),
        doctorId || null,
        ts,
        ts
      );
    const planId = info.lastInsertRowid;
    const insItem = db.prepare(
      `INSERT INTO health_plan_items(plan_id, kind, title, schedule_json, meta_json, sort_order)
       VALUES (?,?,?,?,?,?)`
    );
    (items || []).forEach((it, idx) => {
      insItem.run(
        planId,
        it.kind,
        it.title,
        JSON.stringify(it.schedule || {}),
        JSON.stringify(it.meta || {}),
        idx
      );
    });
    return db.prepare(`SELECT * FROM health_plans WHERE id=?`).get(planId);
  }

  function setPlanStatus(personId, planId, status) {
    const row = db
      .prepare(`SELECT * FROM health_plans WHERE id=? AND person_id=?`)
      .get(planId, personId);
    if (!row) {
      const err = new Error("plan_not_found");
      err.code = "not_found";
      throw err;
    }
    if (status === "active") {
      db.prepare(
        `UPDATE health_plans SET status='paused', updated_at=?
         WHERE person_id=? AND status='active' AND id!=?`
      ).run(nowIso(), personId, planId);
    }
    db.prepare(`UPDATE health_plans SET status=?, updated_at=? WHERE id=?`).run(
      status,
      nowIso(),
      planId
    );
    return db.prepare(`SELECT * FROM health_plans WHERE id=?`).get(planId);
  }

  function listConfirmations(personId) {
    return db
      .prepare(`SELECT * FROM health_record_confirmations WHERE person_id=?`)
      .all(personId);
  }

  function upsertConfirmation(personId, sourceKey, payload) {
    const ts = nowIso();
    db.prepare(
      `INSERT INTO health_record_confirmations(person_id, source_key, status, payload_json, confirmed_at)
       VALUES (?,?, 'confirmed', ?, ?)
       ON CONFLICT(person_id, source_key) DO UPDATE SET
         status='confirmed', payload_json=excluded.payload_json, confirmed_at=excluded.confirmed_at`
    ).run(personId, sourceKey, JSON.stringify(payload || {}), ts);
    return listConfirmations(personId);
  }

  function listFamily(personId) {
    return db
      .prepare(`SELECT * FROM health_family_members WHERE person_id=? ORDER BY id`)
      .all(personId);
  }

  function addFamily(personId, { name, relation, phone, role }) {
    const info = db
      .prepare(
        `INSERT INTO health_family_members(person_id, name, relation, phone, role, created_at)
         VALUES (?,?,?,?,?,?)`
      )
      .run(
        personId,
        String(name || "").trim() || "家属",
        relation || "",
        phone || "",
        role || "helper",
        nowIso()
      );
    return db.prepare(`SELECT * FROM health_family_members WHERE id=?`).get(info.lastInsertRowid);
  }

  function removeFamily(personId, memberId) {
    const id = Number(memberId);
    if (!Number.isFinite(id) || id <= 0) return { ok: false, removed: 0 };
    const info = db
      .prepare(`DELETE FROM health_family_members WHERE person_id=? AND id=?`)
      .run(personId, id);
    return { ok: true, removed: info.changes || 0 };
  }

  function listDismissals(personId) {
    return db
      .prepare(`SELECT card_key FROM health_feed_dismissals WHERE person_id=?`)
      .all(personId);
  }

  function countPlans(personId) {
    const row = db
      .prepare(`SELECT COUNT(*) AS c FROM health_plans WHERE person_id=?`)
      .get(personId);
    return (row && row.c) || 0;
  }

  return {
    todayLocal,
    getActivePlan,
    getPlanItems,
    ensureTodayTasks,
    completeTask,
    insertPlanWithItems,
    setPlanStatus,
    listConfirmations,
    upsertConfirmation,
    listFamily,
    addFamily,
    removeFamily,
    listDismissals,
    countPlans,
  };
}

module.exports = { createRepo, todayLocal, nowIso };
