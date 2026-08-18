"use strict";

/**
 * 科普提醒计划：每日/每周到点仅生成 pending 出站草稿，绝不自动发群。
 */
const { db } = require("../../db.js");
const campaigns = require("./campaigns.js");
const service = require("./service.js");
const runtime = require("./runtime.js");
const outbox = require("../outbox");
const { ensureSchema } = require("./science_reminders_schema.js");

const CADENCES = new Set(["daily", "weekly"]);
const MODES = new Set(["ai", "template"]);
const KNOWLEDGE_MODES = new Set(["none", "selected", "auto"]);
const SCIENCE_SOURCES = ["science_reminder", "weekly_ops", "ops_candidate"];

function nowIso() {
  return new Date().toISOString();
}

function bjParts(nowDate) {
  const ms = (nowDate && typeof nowDate.getTime === "function" ? nowDate.getTime() : Date.now()) + 8 * 3600 * 1000;
  const bj = new Date(ms);
  return {
    bj,
    y: bj.getUTCFullYear(),
    m: bj.getUTCMonth() + 1,
    d: bj.getUTCDate(),
    hour: bj.getUTCHours(),
    minute: bj.getUTCMinutes(),
    weekday: bj.getUTCDay(), // 0=周日
    dateKey: `${bj.getUTCFullYear()}-${String(bj.getUTCMonth() + 1).padStart(2, "0")}-${String(bj.getUTCDate()).padStart(2, "0")}`
  };
}

function fireKeyForPlan(plan, parts) {
  if (plan.cadence === "daily") return parts.dateKey;
  return `${campaigns.weekIso(parts.bj)}-d${Number(plan.weekday)}`;
}

function normalizeKnowledgeMode(input) {
  const hasMode = input && input.knowledgeMode != null;
  const raw = hasMode
    ? String(input.knowledgeMode)
    : input && Object.prototype.hasOwnProperty.call(input, "useKnowledge")
      ? input.useKnowledge === false || input.useKnowledge === 0 || input.useKnowledge === "0"
        ? "none"
        : "auto"
      : "none";
  if (!KNOWLEDGE_MODES.has(raw)) throw new Error("知识策略仅支持 none / selected / auto");
  return raw;
}

function normalizeKnowledgeIds(value) {
  const source = Array.isArray(value) ? value : value == null || value === "" ? [] : [value];
  const ids = [...new Set(source.map(Number).filter((id) => Number.isInteger(id) && id > 0))];
  if (ids.length > 3) throw new Error("最多选择 3 条已审核知识");
  return ids;
}

function parseIds(value) {
  try {
    return normalizeKnowledgeIds(JSON.parse(value || "[]"));
  } catch (e) {
    return [];
  }
}

function planOut(row) {
  if (!row) return null;
  return {
    id: row.id,
    doctorId: row.doctor_id,
    groupId: row.group_id,
    cadence: row.cadence,
    weekday: row.weekday == null ? null : +row.weekday,
    hour: +row.hour,
    minute: +(row.minute || 0),
    topic: row.topic || "",
    mode: row.mode || "template",
    audience: row.audience || "",
    notes: row.notes || "",
    knowledgeId: row.knowledge_id == null ? null : +row.knowledge_id,
    knowledgeMode: row.knowledge_mode || "none",
    knowledgeIds: parseIds(row.knowledge_ids),
    enabled: !!row.enabled,
    lastFireKey: row.last_fire_key || "",
    lastAttemptAt: row.last_attempt_at || "",
    lastError: row.last_error || "",
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || ""
  };
}

function listPlans(doctorId) {
  const did = +doctorId;
  return db
    .prepare("SELECT * FROM science_reminder_plans WHERE doctor_id=? ORDER BY enabled DESC, hour ASC, id DESC")
    .all(did)
    .map(planOut);
}

function getPlan(id) {
  return planOut(db.prepare("SELECT * FROM science_reminder_plans WHERE id=?").get(+id));
}

function normalizePlanInput(input, existing) {
  const cadence = String((input && input.cadence) || (existing && existing.cadence) || "weekly");
  if (!CADENCES.has(cadence)) throw new Error("周期仅支持 daily / weekly");
  const mode = String((input && input.mode) || (existing && existing.mode) || "ai");
  if (!MODES.has(mode)) throw new Error("生成方式仅支持 ai / template");
  const hour = Number(input && input.hour != null ? input.hour : existing && existing.hour != null ? existing.hour : 9);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) throw new Error("小时须为 0–23 整数");
  const minute = Number(input && input.minute != null ? input.minute : existing && existing.minute != null ? existing.minute : 0);
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) throw new Error("分钟须为 0–59 整数");
  let weekday = null;
  if (cadence === "weekly") {
    weekday = Number(input && input.weekday != null ? input.weekday : existing && existing.weekday != null ? existing.weekday : 5);
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) throw new Error("星期须为 0–6（周日=0）");
  }
  const topic = String((input && input.topic) != null ? input.topic : (existing && existing.topic) || "").trim().slice(0, 90);
  const audience = String(input && input.audience != null ? input.audience : (existing && existing.audience) || "").trim().slice(0, 80);
  const notes = String(input && input.notes != null ? input.notes : (existing && existing.notes) || "").trim().slice(0, 800);
  const knowledgeMode = normalizeKnowledgeMode({
    knowledgeMode: input && input.knowledgeMode != null
      ? input.knowledgeMode
      : existing && existing.knowledgeMode != null
        ? existing.knowledgeMode
        : "none"
  });
  const knowledgeIds = normalizeKnowledgeIds(
    input && Object.prototype.hasOwnProperty.call(input, "knowledgeIds")
      ? input.knowledgeIds
      : input && Object.prototype.hasOwnProperty.call(input, "knowledgeId")
        ? input.knowledgeId
        : (existing && existing.knowledgeIds) || []
  );
  if (knowledgeMode === "selected" && !knowledgeIds.length) throw new Error("指定引用时请选择知识");
  const enabled =
    input && Object.prototype.hasOwnProperty.call(input, "enabled")
      ? !!input.enabled
      : existing
        ? !!existing.enabled
        : true;
  return { cadence, mode, hour, minute, weekday, topic, audience, notes, knowledgeMode, knowledgeIds, enabled };
}

function createPlan(input) {
  const did = runtime.resolveDoctorId(input);
  if (!did) throw new Error("医生不存在或缺少 doctorId");
  const group = service.findGroup(did, input);
  if (!group) throw new Error("群配置不存在");
  const n = normalizePlanInput(input, null);
  if (n.knowledgeMode === "selected") {
    resolveKnowledgeItems(did, { knowledgeMode: n.knowledgeMode, knowledgeIds: n.knowledgeIds });
  }
  const ts = nowIso();
  const r = db
    .prepare(
      `INSERT INTO science_reminder_plans(
      doctor_id,group_id,cadence,weekday,hour,minute,topic,mode,audience,notes,
      knowledge_id,knowledge_mode,knowledge_ids,enabled,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    )
    .run(
      did,
      group.id,
      n.cadence,
      n.weekday,
      n.hour,
      n.minute,
      n.topic || null,
      n.mode,
      n.audience || null,
      n.notes || null,
      n.knowledgeIds[0] || null,
      n.knowledgeMode,
      JSON.stringify(n.knowledgeIds),
      n.enabled ? 1 : 0,
      ts,
      ts
    );
  return getPlan(r.lastInsertRowid);
}

function updatePlan(id, input) {
  const row = db.prepare("SELECT * FROM science_reminder_plans WHERE id=?").get(+id);
  if (!row) throw new Error("计划不存在");
  const existing = planOut(row);
  const n = normalizePlanInput(input || {}, existing);
  if (n.knowledgeMode === "selected") {
    resolveKnowledgeItems(row.doctor_id, { knowledgeMode: n.knowledgeMode, knowledgeIds: n.knowledgeIds });
  }
  let groupId = existing.groupId;
  if (input && (input.groupId != null || input.group_id != null)) {
    const group = service.findGroup(row.doctor_id, { groupId: input.groupId != null ? input.groupId : input.group_id });
    if (!group) throw new Error("群配置不存在");
    groupId = group.id;
  }
  const ts = nowIso();
  db.prepare(
    `UPDATE science_reminder_plans SET group_id=?,cadence=?,weekday=?,hour=?,minute=?,topic=?,mode=?,audience=?,notes=?,
     knowledge_id=?,knowledge_mode=?,knowledge_ids=?,enabled=?,updated_at=?
     WHERE id=?`
  ).run(
    groupId,
    n.cadence,
    n.weekday,
    n.hour,
    n.minute,
    n.topic || null,
    n.mode,
    n.audience || null,
    n.notes || null,
    n.knowledgeIds[0] || null,
    n.knowledgeMode,
    JSON.stringify(n.knowledgeIds),
    n.enabled ? 1 : 0,
    ts,
    +id
  );
  return getPlan(+id);
}

function deletePlan(id) {
  const r = db.prepare("DELETE FROM science_reminder_plans WHERE id=?").run(+id);
  if (!r.changes) throw new Error("计划不存在");
  return { ok: true };
}

async function firePlanRow(row, username) {
  const plan = planOut(row);
  if (plan.mode === "template") {
    return campaigns.createWeeklyCampaign({
      doctorId: plan.doctorId,
      groupId: plan.groupId,
      topic: plan.topic,
      outboxSource: "science_reminder",
      payloadExtra: { planId: plan.id, eventType: "science_reminder" },
      username
    });
  }
  const generated = await generateAiScienceDraft({
    doctorId: plan.doctorId,
    groupId: plan.groupId,
    topic: plan.topic,
    audience: plan.audience,
    notes: plan.notes,
    knowledgeMode: plan.knowledgeMode,
    knowledgeIds: plan.knowledgeIds,
    username,
    planId: plan.id
  });
  return generated.outbox;
}

function markFired(id, key) {
  db.prepare("UPDATE science_reminder_plans SET last_fire_key=?,updated_at=? WHERE id=?").run(key, nowIso(), +id);
}

function markAttempt(id, error) {
  db.prepare(`UPDATE science_reminder_plans
    SET last_attempt_at=?,last_error=?,updated_at=? WHERE id=?`)
    .run(nowIso(), error ? String(error).slice(0, 500) : null, nowIso(), +id);
}

function shouldFirePlan(plan, nowDate) {
  const parts = bjParts(nowDate);
  const nowMinutes = parts.hour * 60 + parts.minute;
  const scheduled = Number(plan.hour) * 60 + Number(plan.minute || 0);
  const key = fireKeyForPlan(plan, parts);
  if ((plan.last_fire_key || plan.lastFireKey) === key) return false;
  if (plan.cadence === "daily") return nowMinutes >= scheduled;
  if (parts.weekday < Number(plan.weekday)) return false;
  if (parts.weekday > Number(plan.weekday)) return true;
  return nowMinutes >= scheduled;
}

async function runScienceReminderTick(nowDate, opts) {
  opts = opts || {};
  const parts = bjParts(nowDate);
  const force = !!opts.force;
  const onlyId = opts.planId != null ? +opts.planId : null;
  const rows = onlyId
    ? db.prepare("SELECT * FROM science_reminder_plans WHERE id=? AND enabled=1").all(onlyId)
    : db.prepare("SELECT * FROM science_reminder_plans WHERE enabled=1").all();
  const generated = [];
  for (const row of rows) {
    if (!force && !shouldFirePlan(row, nowDate)) continue;
    const key = fireKeyForPlan(row, parts);
    if (!force && row.last_fire_key === key) continue;
    try {
      const out = await firePlanRow(row, opts.username || "system");
      if (!force) markFired(row.id, key);
      markAttempt(row.id, "");
      generated.push({ planId: row.id, outboxId: out && out.id, fireKey: key });
    } catch (e) {
      console.error("[science-reminder] plan", row.id, e && e.message);
      markAttempt(row.id, (e && e.message) || String(e));
      generated.push({ planId: row.id, error: (e && e.message) || String(e) });
    }
  }
  return generated;
}

function listScienceDrafts(doctorId, limit) {
  const did = +doctorId;
  const lim = Math.min(Math.max(+(limit || 50), 1), 200);
  const placeholders = SCIENCE_SOURCES.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT * FROM outbound_queue WHERE doctor_id=? AND source IN (${placeholders})
       ORDER BY status='pending' DESC, id DESC LIMIT ?`
    )
    .all(did, ...SCIENCE_SOURCES, lim);
  return rows.map((r) => outbox.outboxOut(r));
}

function pageBundle(doctorId) {
  const did = +doctorId;
  const groups = db
    .prepare("SELECT * FROM community_groups WHERE doctor_id=? ORDER BY id DESC")
    .all(did)
    .map((g) => service.groupOut(g));
  return {
    plans: listPlans(did),
    drafts: listScienceDrafts(did, 80),
    groups,
    knowledgeItems: db.prepare(`SELECT id,title,layer,source,updated_at
      FROM knowledge_items WHERE doctor_id=? AND status='ready' ORDER BY id DESC`).all(did)
  };
}

function resolveKnowledgeItems(doctorId, input) {
  const did = +doctorId;
  const mode = normalizeKnowledgeMode(input || {});
  if (mode === "none") return { mode, items: [] };
  if (mode === "auto") {
    const items = db.prepare(`SELECT * FROM knowledge_items
      WHERE doctor_id=? AND status='ready'
      ORDER BY CASE layer WHEN '医生个人' THEN 1 WHEN '医院/科室通用' THEN 2 ELSE 3 END, id DESC
      LIMIT 3`).all(did);
    return { mode, items };
  }
  const ids = normalizeKnowledgeIds(
    input && Object.prototype.hasOwnProperty.call(input, "knowledgeIds")
      ? input.knowledgeIds
      : input && input.knowledgeId
  );
  if (!ids.length) throw new Error("指定引用时请选择 1–3 条已审核知识");
  const marks = ids.map(() => "?").join(",");
  const items = db.prepare(`SELECT * FROM knowledge_items
    WHERE doctor_id=? AND status='ready' AND id IN (${marks})`).all(did, ...ids);
  if (items.length !== ids.length) throw new Error("部分知识不存在、未审核或不属于当前医生");
  const byId = new Map(items.map((item) => [+item.id, item]));
  return { mode, items: ids.map((id) => byId.get(id)) };
}

async function generateAiScienceDraft(input) {
  const did = runtime.resolveDoctorId(input);
  if (!did) throw new Error("医生不存在或缺少 doctorId");
  const group = service.findGroup(did, input);
  if (!group) throw new Error("群配置不存在");
  if (group.status === "paused" || group.review_mode === "paused") {
    throw new Error("群已暂停，不能生成科普草稿");
  }
  const topic = String((input && input.topic) || "").trim().slice(0, 90);
  if (!topic) throw new Error("请填写科普主题");
  const notes = String((input && input.notes) || "").trim().slice(0, 800);
  const audience = String((input && input.audience) || "").trim().slice(0, 80);
  const knowledge = resolveKnowledgeItems(did, input || {});
  const items = knowledge.items;
  const evidence = items.map((x) => ({ id: x.id, title: x.title, layer: x.layer, source: x.source || "" }));
  const knowledgeSummary = items
    .map((x) => `${x.title}：${String(x.body || "").replace(/\s+/g, " ").slice(0, 120)}`)
    .join("\n")
    .slice(0, 600);

  let doctorName = "医生";
  try {
    const row = db.prepare("SELECT name FROM doctors WHERE id=?").get(did);
    if (row && row.name) doctorName = row.name;
  } catch (e) {}

  const triage = require("../../triage.js");
  const instruction = [
    "根据主题与基础信息，写一篇适合企微健康群发送的科普提醒草稿。",
    "开头可用 @所有人；语气为医助科普，适合群友基础了解。",
    "文末加一句互动提问（例如最想了解原因/预防/检查/复诊中的哪一点）。",
    "严禁诊断、用药、解读报告、判断良恶性或给出治疗/手术方案；强调个体病情需面诊或找医助确认。",
    "不要 Markdown、不要编号列表、不要 JSON；输出 120-280 字可直接编辑的纯文本。"
  ].join("");

  const originalDraft = [
    `主题：${topic}`,
    audience ? `受众：${audience}` : "",
    notes ? `要点/补充：${notes}` : "",
    knowledgeSummary ? `可参考知识摘要：\n${knowledgeSummary}` : "",
    `医生团队：${doctorName}`
  ]
    .filter(Boolean)
    .join("\n");

  let text = "";
  let aiMeta = { ok: false, reason: "skipped" };
  const generated = await triage.generateAssistantReviewDraft({
    doctorId: did,
    riskLevel: "low",
    contextType: "science_reminder",
    instruction,
    sourceText: notes || topic,
    originalDraft
  });
  if (generated && generated.ok && generated.text) {
    text = String(generated.text).trim().slice(0, 2400);
    aiMeta = {
      ok: true,
      model: generated.model || "",
      generatedAt: generated.generatedAt || nowIso()
    };
  } else {
    // 降级：模板拼装，保证流程可走通
    text = [
      "@所有人",
      `今天的群内科普主题：${topic}`,
      audience ? `主要面向：${audience}` : "",
      notes ? `要点：${notes}` : "",
      knowledgeSummary ? `参考：${items.map((x) => x.title).join(" / ")}` : "",
      `这是${doctorName}医生团队整理的健康提醒，适合群友先做基础了解。`,
      "建议结合自身情况向医生/医助咨询；群内内容只做健康教育，不替代面诊。",
      "互动提问：您最想了解这个话题里的哪一点？A.原因  B.预防  C.检查  D.复诊"
    ]
      .filter(Boolean)
      .join("\n");
    aiMeta = {
      ok: false,
      reason: (generated && generated.reason) || "model_unavailable",
      degraded: true,
      generatedAt: nowIso()
    };
  }

  const row = runtime.enqueue({
    doctorId: did,
    group,
    targetName: group.name,
    text,
    payload: {
      eventType: "science_reminder",
      topic,
      audience,
      notes,
      evidence,
      knowledgeMode: knowledge.mode,
      groundingLabel: knowledge.mode === "none"
        ? "AI 通用知识生成 · 无外部知识依据"
        : `引用 ${evidence.length} 条已审核知识`,
      planId: Number.isInteger(Number(input && input.planId)) ? Number(input.planId) : null,
      ai: aiMeta,
      reviewerRequired: true,
      qiwe: { toId: group.external_group_id || "", needAtAll: true }
    },
    status: "pending",
    source: "science_reminder",
    priority: "normal",
    username: input && input.username
  });
  return { outbox: row, ai: aiMeta };
}

module.exports = {
  ensureSchema,
  listPlans,
  getPlan,
  createPlan,
  updatePlan,
  deletePlan,
  runScienceReminderTick,
  listScienceDrafts,
  pageBundle,
  firePlanRow,
  generateAiScienceDraft,
  normalizeKnowledgeMode,
  normalizeKnowledgeIds,
  resolveKnowledgeItems,
  shouldFirePlan,
  SCIENCE_SOURCES
};
