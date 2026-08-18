"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "science-reminder-v2-"));
process.env.DB_PATH = path.join(tempRoot, "test.db");

const { db } = require("./db.js");
const science = require("./modules/community/science_reminders.js");

async function run() {
  science.ensureSchema(db);
  const columns = db.prepare("PRAGMA table_info(science_reminder_plans)").all().map((x) => x.name);
  for (const name of [
    "minute",
    "audience",
    "notes",
    "knowledge_mode",
    "knowledge_ids",
    "last_attempt_at",
    "last_error"
  ]) assert.ok(columns.includes(name), `missing column ${name}`);

  assert.equal(science.normalizeKnowledgeMode({ knowledgeMode: "none" }), "none");
  assert.equal(science.normalizeKnowledgeMode({ knowledgeMode: "auto" }), "auto");
  assert.throws(
    () => science.normalizeKnowledgeIds([1, 2, 3, 4]),
    /最多选择 3 条/
  );

  const before = new Date("2026-08-13T01:29:00.000Z");
  const due = new Date("2026-08-13T01:30:00.000Z");
  const plan = { cadence: "daily", hour: 9, minute: 30, last_fire_key: "" };
  assert.equal(science.shouldFirePlan(plan, before), false);
  assert.equal(science.shouldFirePlan(plan, due), true);

  const group = db.prepare("SELECT id,doctor_id FROM community_groups ORDER BY id LIMIT 1").get();
  assert.ok(group);
  const saved = science.createPlan({
    doctorId: group.doctor_id,
    groupId: group.id,
    cadence: "weekly",
    weekday: 5,
    hour: 9,
    minute: 30,
    topic: "术后复查为什么很重要",
    audience: "术后患者",
    notes: "强调按时复查",
    mode: "ai",
    knowledgeMode: "none",
    knowledgeIds: []
  });
  assert.equal(saved.knowledgeMode, "none");
  assert.deepEqual(saved.knowledgeIds, []);

  const foreign = db.prepare(
    "SELECT id FROM knowledge_items WHERE doctor_id<>? AND status='ready' ORDER BY id LIMIT 1"
  ).get(group.doctor_id);
  assert.ok(foreign);
  assert.throws(() => science.createPlan({
    doctorId: group.doctor_id,
    groupId: group.id,
    cadence: "daily",
    hour: 10,
    minute: 0,
    topic: "非法知识",
    mode: "ai",
    knowledgeMode: "selected",
    knowledgeIds: [foreign.id]
  }), /不属于当前医生/);

  const manual = science.createPlan({
    doctorId: group.doctor_id,
    groupId: group.id,
    cadence: "daily",
    hour: 23,
    minute: 59,
    topic: "人工试跑",
    mode: "template",
    knowledgeMode: "none"
  });
  const generated = await science.runScienceReminderTick(due, {
    force: true,
    planId: manual.id,
    username: "test"
  });
  assert.ok(generated[0].outboxId);
  assert.equal(science.getPlan(manual.id).lastFireKey, "");

  console.log("science reminder v2 ok");
}

run()
  .finally(() => {
    try { db.close(); } catch (_) {}
    fs.rmSync(tempRoot, { recursive: true, force: true });
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
