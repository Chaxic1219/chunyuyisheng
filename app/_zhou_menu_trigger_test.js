"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const dbPath = path.join(os.tmpdir(), `zhou-menu-trigger-${Date.now()}.db`);
process.env.DB_PATH = dbPath;
process.env.TRIAGE_AI_DISABLED = "1";

try {
  const { db } = require("./db.js");
  const migrate = require("./modules/outbound/migrate.js");
  const engine = require("./engine.js");

  assert.equal(typeof migrate.ensureZhouMenuTrigger, "function");
  const zhou = db.prepare("SELECT id FROM doctors WHERE slug='zhouyuchun'").get();
  const other = db.prepare("SELECT id FROM doctors WHERE slug<>'zhouyuchun' ORDER BY id LIMIT 1").get();
  assert(zhou && other);

  const first = migrate.ensureZhouMenuTrigger(db);
  const second = migrate.ensureZhouMenuTrigger(db);
  assert(first.created || first.skipped);
  assert.equal(second.skipped, true);

  const triggers = db
    .prepare("SELECT * FROM outbound_triggers WHERE doctor_id=? AND kind='code' AND code='1'")
    .all(zhou.id);
  assert.equal(triggers.length, 1);
  assert.deepEqual(JSON.parse(triggers[0].aliases), ["菜单", "功能", "全部功能"]);

  const asset = db
    .prepare(
      `SELECT a.* FROM outbound_trigger_steps s
       JOIN outbound_assets a ON a.id=s.asset_id
       WHERE s.trigger_id=? ORDER BY s.sort, s.id LIMIT 1`
    )
    .get(triggers[0].id);
  const text = JSON.parse(asset.payload).text;
  assert(text.includes("101 在线咨询医生"));
  assert(text.includes("103 查看医院相关电话"));
  assert(text.includes("105 查看医生回复"));
  assert(text.includes("301 预约加号"));
  assert(text.includes("302 预约住院"));
  assert(text.includes("818 把医生介绍给亲友"));
  assert(!text.includes("606"));

  const hit = engine.match(zhou.id, "1");
  assert.equal(hit.source, "outbound");
  assert.equal(hit.responses[0].text, text);
  assert.equal(engine.match(zhou.id, "菜单").source, "outbound");
  assert.equal(engine.match(zhou.id, "这个群有什么功能").source, "outbound");

  db.prepare("UPDATE outbound_triggers SET enabled=0 WHERE id=?").run(triggers[0].id);
  assert.equal(engine.match(zhou.id, "1"), null);
  assert.deepEqual(engine.match(other.id, "1"), { menu: true });

  const before606 = db
    .prepare("SELECT COUNT(*) c FROM outbound_triggers WHERE doctor_id=? AND code='606'")
    .get(zhou.id).c;
  migrate.ensureZhouMenuTrigger(db);
  const after606 = db
    .prepare("SELECT COUNT(*) c FROM outbound_triggers WHERE doctor_id=? AND code='606'")
    .get(zhou.id).c;
  assert.equal(after606, before606);

  console.log("ALL PASS");
} finally {
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      fs.unlinkSync(dbPath + suffix);
    } catch (_) {}
  }
}
