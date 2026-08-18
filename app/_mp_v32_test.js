"use strict";
/**
 * 小程序 V3.2 phase1 — 表结构 + mpV32 仓储 + HTTP 闭环冒烟
 */
const assert = require("assert");
const path = require("path");
const fs = require("fs");
const os = require("os");
const http = require("http");
const { spawn } = require("child_process");

process.env.MP_AUTH_STUB = "1";
process.env.SMS_DEMO = "1";
process.env.TRIAGE_AI_DISABLED = "1";
process.env.DB_PATH = path.join(os.tmpdir(), `mp-v32-${Date.now()}.db`);
const tempDbFiles = [process.env.DB_PATH, process.env.DB_PATH + "-wal", process.env.DB_PATH + "-shm"];
function removeTempDbFiles() {
  tempDbFiles.forEach((f) => {
    try {
      fs.unlinkSync(f);
    } catch (e) {
      if (e && e.code !== "ENOENT") throw e;
    }
  });
}
removeTempDbFiles();

const { db } = require("./db.js");
const mpAuth = require("./mp_auth.js");
const { createMpV32 } = require("./modules/mpV32");
const { createRepo, todayLocal, nowIso } = require("./modules/mpV32/repo.js");

const TABLES = [
  "health_plans",
  "health_plan_items",
  "health_task_instances",
  "health_metric_logs",
  "health_family_members",
  "health_feed_dismissals",
  "health_record_confirmations",
];

function tableExists(name) {
  return !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name);
}

async function test(name, fn) {
  try {
    await fn();
    console.log("ok -", name);
  } catch (e) {
    console.error("fail -", name);
    throw e;
  }
}

function api(port, method, urlPath, body, headers) {
  return new Promise((resolve, reject) => {
    const data = body !== undefined ? JSON.stringify(body) : null;
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: urlPath,
        method,
        headers: {
          ...(data
            ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) }
            : {}),
          ...(headers || {}),
        },
      },
      (res) => {
        let raw = "";
        res.on("data", (c) => (raw += c));
        res.on("end", () => {
          let j = null;
          try {
            j = JSON.parse(raw);
          } catch (e) {
            j = raw;
          }
          resolve({ status: res.statusCode, j });
        });
      }
    );
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

function waitPort(port, ms) {
  const deadline = Date.now() + ms;
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const req = http.get(
        { hostname: "127.0.0.1", port, path: "/api/bootstrap", timeout: 500 },
        (res) => {
          res.resume();
          resolve();
        }
      );
      req.on("error", () => {
        if (Date.now() > deadline) reject(new Error("server_timeout"));
        else setTimeout(tryOnce, 200);
      });
    };
    tryOnce();
  });
}

function runTableAndRepoSmoke() {
  for (const name of TABLES) {
    assert.ok(tableExists(name), `missing table: ${name}`);
    console.log("ok - table exists:", name);
  }

  assert.ok(typeof todayLocal() === "string" && /^\d{4}-\d{2}-\d{2}$/.test(todayLocal()));
  assert.ok(typeof nowIso() === "string" && nowIso().includes("T"));
  console.log("ok - todayLocal/nowIso");

  const PERSON_ID = 900001;
  const mp = createMpV32(db, {});
  const repo = mp.repo;

  // 新用户：无计划 → home-feed.plan === null
  {
    const feed = mp.buildHomeFeed({
      personId: PERSON_ID,
      profile: { name: "测试用户" },
      plan: null,
      tasks: [],
      confirmations: [],
      healthRecords: [],
    });
    assert.strictEqual(feed.plan, null, "unsigned home feed plan must be null");
    assert.strictEqual(feed.serviceProgress, null, "phase1 serviceProgress must be null");
    assert.ok(feed.hero && feed.hero.unsignedTitle);
    assert.ok(Array.isArray(feed.recommendations));
    assert.ok(Array.isArray(feed.quickActions));
    console.log("ok - home feed unsigned (plan null)");
  }

  // 确认 → 生成草稿 → 写入 → 启用 → 今日任务 → 完成
  {
    const list = repo.upsertConfirmation(PERSON_ID, "med-1", { title: "服用降压药" });
    assert.ok(list.some((c) => c.source_key === "med-1"));
    console.log("ok - upsertConfirmation");

    const draft = mp.generatePlanDraft({
      confirmations: repo.listConfirmations(PERSON_ID),
      healthRecords: [],
      profile: { name: "测试用户" },
    });
    assert.strictEqual(draft.ok, true, draft.reason || "draft should succeed");
    assert.ok(draft.items.length >= 1);
    console.log("ok - generatePlanDraft");

    const plan = repo.insertPlanWithItems(PERSON_ID, draft);
    assert.ok(plan && plan.id);
    assert.strictEqual(plan.status, "draft");
    console.log("ok - insertPlanWithItems");

    const active = repo.setPlanStatus(PERSON_ID, plan.id, "active");
    assert.strictEqual(active.status, "active");
    console.log("ok - setPlanStatus active");

    const tasks = repo.ensureTodayTasks(PERSON_ID, active);
    assert.ok(tasks.length >= 1, "should materialize today tasks");
    const again = repo.ensureTodayTasks(PERSON_ID, active);
    assert.strictEqual(again.length, tasks.length, "INSERT OR IGNORE should not duplicate");
    console.log("ok - ensureTodayTasks");

    const done = repo.completeTask(PERSON_ID, tasks[0].id, { note: "done" });
    assert.strictEqual(done.status, "done");
    console.log("ok - completeTask");

    const feed2 = mp.buildHomeFeed({
      personId: PERSON_ID,
      profile: { name: "测试用户" },
      plan: active,
      tasks: repo.ensureTodayTasks(PERSON_ID, active),
      confirmations: repo.listConfirmations(PERSON_ID),
      healthRecords: [],
    });
    assert.ok(feed2.plan, "active plan summary required");
    assert.ok(feed2.plan.completionText.includes("已完成"));
    assert.ok(feed2.plan.completionPercent >= 0);
    console.log("ok - home feed with active plan");

    const detail = mp.buildPlanDetail({
      personId: PERSON_ID,
      plan: active,
      tasks: repo.ensureTodayTasks(PERSON_ID, active),
    });
    assert.ok(detail.title);
    assert.ok(Array.isArray(detail.tasks));
    assert.ok(detail.tasks.some((t) => t.done));
    console.log("ok - buildPlanDetail");
  }

  // 信息不足 → ok:false
  {
    const bad = mp.generatePlanDraft({
      confirmations: [],
      healthRecords: [],
      profile: {},
    });
    assert.strictEqual(bad.ok, false);
    assert.ok(bad.reason);
    assert.ok(Array.isArray(bad.missing));
    console.log("ok - generatePlanDraft insufficient");
  }

  // mine / records / family / services
  {
    const family = repo.addFamily(PERSON_ID, { name: "王先生", relation: "配偶", role: "helper" });
    assert.ok(family.id);
    const familyData = mp.buildFamilyData({ personId: PERSON_ID, family: repo.listFamily(PERSON_ID) });
    assert.ok(familyData.managed && familyData.helpers);
    console.log("ok - family");

    const mine = mp.buildMineAssets({
      personId: PERSON_ID,
      plan: repo.getActivePlan(PERSON_ID),
      confirmations: repo.listConfirmations(PERSON_ID),
      healthRecords: [{ id: 1, title: "门诊处方", category: "rx" }],
      family: repo.listFamily(PERSON_ID),
    });
    assert.ok(mine.healthEntries.length >= 4);
    assert.ok(mine.serviceEntries.length >= 1);
    assert.ok(mine.settingEntries.length >= 1);
    console.log("ok - buildMineAssets");

    const records = mp.buildRecordList({
      personId: PERSON_ID,
      profile: { name: "测试用户" },
      confirmations: repo.listConfirmations(PERSON_ID),
      healthRecords: [{ id: 1, title: "门诊处方", category: "rx", recorded_at: "2026-07-28" }],
    });
    assert.ok(records.summary && records.pending && Array.isArray(records.records));
    console.log("ok - buildRecordList");

    const services = mp.getServiceCenter();
    assert.ok(services.current && Array.isArray(services.products));
    assert.ok(
      services.products.length === 0,
      "演示商品已清理（2026-08-05）：服务包真实商品上线前 products 应为空"
    );
    console.log("ok - getServiceCenter");
  }

  // createRepo 独立导出
  {
    const r2 = createRepo(db);
    assert.ok(typeof r2.getActivePlan === "function");
    console.log("ok - createRepo export");
  }

  console.log("ok - table + repo smoke suite");
}

(async () => {
  runTableAndRepoSmoke();

  const doctors = db.prepare(
    "SELECT id FROM doctors WHERE active=1 ORDER BY id ASC LIMIT 1"
  ).all();
  assert.ok(doctors.length >= 1, "need at least one doctor for mp login");
  const doctorId = doctors[0].id;
  const phone = "13800138832";

  let token = "";
  let personId = 0;
  await test("准备已绑号会话", async () => {
    const loginRes = await mpAuth.login({ code: "mp-v32-" + Date.now(), doctorId });
    const bindRes = await mpAuth.bindPhone({
      token: loginRes.mpToken,
      phone,
      smsCode: "000000",
      doctorId,
    });
    token = bindRes.mpToken;
    personId = bindRes.personId;
    db.prepare("UPDATE persons SET real_name=? WHERE id=?").run("V32冒烟", personId);
    assert.ok(token);
    assert.ok(personId);
  });

  const auth = { Authorization: "Bearer " + token };
  const port = 19180 + Math.floor(Math.random() * 200);
  const child = spawn(process.execPath, ["server.js"], {
    cwd: __dirname,
    env: {
      ...process.env,
      PORT: String(port),
      DB_PATH: process.env.DB_PATH,
      MP_AUTH_STUB: "1",
      SMS_DEMO: "1",
      TRIAGE_AI_DISABLED: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (c) => (stderr += c));
  child.stdout.on("data", () => {});

  try {
    await waitPort(port, 15000);

    await test("GET /api/mp/v32/home-feed 无 token → 401", async () => {
      const r = await api(port, "GET", "/api/mp/v32/home-feed");
      assert.equal(r.status, 401);
    });

    let percentBefore = 0;
    await test("有会话 → home-feed 200，plan === null", async () => {
      const r = await api(port, "GET", "/api/mp/v32/home-feed", undefined, auth);
      assert.equal(r.status, 200);
      assert.ok(r.j && r.j.data);
      assert.strictEqual(r.j.data.plan, null);
    });

    await test("POST records/.../confirmations → 200", async () => {
      const r = await api(
        port,
        "POST",
        "/api/mp/v32/records/med-1/confirmations",
        { payload: { title: "服用降压药" } },
        auth
      );
      assert.equal(r.status, 200);
      assert.ok(r.j.data && Array.isArray(r.j.data.confirmations));
      assert.ok(r.j.data.confirmations.some((c) => c.source_key === "med-1"));
    });

    let planId = 0;
    await test("POST plans/generate → 200 with plan", async () => {
      const r = await api(port, "POST", "/api/mp/v32/plans/generate", {}, auth);
      assert.equal(r.status, 200, JSON.stringify(r.j));
      assert.ok(r.j.data && r.j.data.plan && r.j.data.plan.id);
      planId = r.j.data.plan.id;
      assert.equal(r.j.data.plan.status, "draft");
    });

    await test("POST plans/:id/activate → active", async () => {
      const r = await api(port, "POST", `/api/mp/v32/plans/${planId}/activate`, {}, auth);
      assert.equal(r.status, 200, JSON.stringify(r.j));
      assert.equal(r.j.data.plan.status, "active");
    });

    let taskId = 0;
    await test("GET plans/current → today tasks", async () => {
      const r = await api(port, "GET", "/api/mp/v32/plans/current", undefined, auth);
      assert.equal(r.status, 200, JSON.stringify(r.j));
      assert.ok(r.j.data);
      assert.ok(Array.isArray(r.j.data.tasks));
      assert.ok(r.j.data.tasks.length >= 1, "expected today tasks");
      const pending = r.j.data.tasks.find((t) => !t.done && t.status !== "done") || r.j.data.tasks[0];
      taskId = pending.id;
      assert.ok(taskId);
    });

    await test("POST tasks/:id/complete → done", async () => {
      const r = await api(port, "POST", `/api/mp/v32/tasks/${taskId}/complete`, { note: "ok" }, auth);
      assert.equal(r.status, 200, JSON.stringify(r.j));
      assert.equal(r.j.data.task.status, "done");
    });

    await test("GET home-feed → completion progressed", async () => {
      const r = await api(port, "GET", "/api/mp/v32/home-feed", undefined, auth);
      assert.equal(r.status, 200);
      assert.ok(r.j.data && r.j.data.plan);
      assert.ok(r.j.data.plan.completionPercent > percentBefore || /1\/\d+ 已完成/.test(r.j.data.plan.completionText));
      assert.ok(String(r.j.data.plan.completionText).includes("已完成"));
    });
  } finally {
    child.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 300));
    try {
      child.kill("SIGKILL");
    } catch (e) {
      /* ignore */
    }
    await new Promise((r) => setTimeout(r, 300));
    db.close();
    removeTempDbFiles();
    assert.ok(tempDbFiles.every((f) => !fs.existsSync(f)), "temporary v32 database must be removed");
  }

  if (stderr && /Error|EADDRINUSE/.test(stderr)) {
    console.warn("server stderr snippet:", stderr.slice(0, 400));
  }
  console.log("all mp v3.2 table + repo + http smoke tests passed");
})().catch((e) => {
  console.error(e && e.stack ? e.stack : e);
  process.exit(1);
});
