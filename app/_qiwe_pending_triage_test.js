"use strict";

const os = require("os");
const path = require("path");
const fs = require("fs");
const assert = require("assert");

const TMP = path.join(os.tmpdir(), "chunyu_qiwe_pending_triage_test.db");
[TMP, TMP + "-wal", TMP + "-shm"].forEach(f => { try{ fs.unlinkSync(f); }catch(e){} });

process.env.DB_PATH = TMP;
process.env.TRIAGE_AI_DISABLED = "1";
process.env.DIALOGUE_AGENT_ENABLED = "1";
process.env.HEALTH_CHAT_ENABLED = "1";
process.env.AGENT_DRY_RUN = "1";

const { db } = require("./db.js");
const qiweApi = require("./qiwe.js");
const qiweBridge = require("./modules/qiwe");

(async () => {
  const doctor = db.prepare("SELECT id FROM doctors WHERE slug='lvfujing'").get();
  assert(doctor && doctor.id, "seed doctor must exist");
  db.prepare(`INSERT INTO community_groups(
    doctor_id, channel_type, external_group_id, name, status, data_source, is_business, created_at, updated_at
  ) VALUES(?,?,?,?,?,?,?,?,?)`).run(
    doctor.id, "qiwe", "room-triage", "测试业务群", "active", "qiwe", 1,
    new Date().toISOString(), new Date().toISOString()
  );

  const cfg = qiweApi.loadConfig();
  Object.assign(cfg, {
    enabled: true,
    token: "test-token",
    guid: "test-guid",
    allowGroup: true,
    autoSend: true,
    doctorId: doctor.id,
    testToId: "room-triage"
  });

  const result = await qiweBridge.processEvent({
    cmd: 15000,
    msgType: 2,
    fromRoomId: "room-triage",
    senderId: "patient-a",
    receiverId: "bot-a",
    senderName: "测试患者",
    content: "我腰好痛",
    msgUniqueIdentifier: "triage-payload-1"
  }, cfg);

  assert.strictEqual(result.reviewOnly, true, "dry-run agent reply should enter pending queue");
  const row = db.prepare("SELECT payload FROM outbound_queue WHERE id=?").get(result.outboxId);
  const payload = JSON.parse(row.payload || "{}");
  assert.strictEqual(payload.source, "dialogue_agent");
  assert.strictEqual(payload.triage.riskLevel, "medium");
  assert.strictEqual(payload.triage.sendPolicy, "auto");
  assert.strictEqual(payload.triage.canAutoSend, true);
  assert.strictEqual(payload.triage.autoDeliver, false);
  assert.ok("needsHuman" in payload.triage, "needsHuman must be persisted");
  assert.ok("needsDoctor" in payload.triage, "needsDoctor must be persisted");
  assert.ok("level" in payload.triage, "level must be persisted");

  console.log("qiwe pending triage payload ok");
})().catch(err => {
  console.error(err && err.stack || err);
  process.exit(1);
});
