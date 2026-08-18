"use strict";

const assert = require("assert");
const { spawnSync } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DB_PATH = path.join(
  os.tmpdir(),
  `mp-ai-${process.pid}-${crypto.randomBytes(6).toString("hex")}.db`
);
process.env.MP_AUTH_STUB = "1";
delete process.env.MP_AI_API_KEY;
delete process.env.DEEPSEEK_API_KEY;
const temporaryDbPaths = new Set([process.env.DB_PATH]);
const CANONICAL_AUDIT_SCHEMA = [
  { name: "id", type: "INTEGER", notnull: 0, dflt_value: null, pk: 1 },
  { name: "openid", type: "TEXT", notnull: 1, dflt_value: null, pk: 0 },
  { name: "person_id", type: "INTEGER", notnull: 1, dflt_value: null, pk: 0 },
  { name: "patient_id", type: "INTEGER", notnull: 1, dflt_value: null, pk: 0 },
  { name: "doctor_id", type: "INTEGER", notnull: 1, dflt_value: null, pk: 0 },
  { name: "session_id", type: "TEXT", notnull: 0, dflt_value: null, pk: 0 },
  { name: "model", type: "TEXT", notnull: 0, dflt_value: null, pk: 0 },
  { name: "input_chars", type: "INTEGER", notnull: 1, dflt_value: "0", pk: 0 },
  { name: "history_turns", type: "INTEGER", notnull: 1, dflt_value: "0", pk: 0 },
  { name: "status", type: "TEXT", notnull: 1, dflt_value: null, pk: 0 },
  { name: "error_code", type: "TEXT", notnull: 0, dflt_value: null, pk: 0 },
  { name: "created_at", type: "TEXT", notnull: 1, dflt_value: null, pk: 0 },
  { name: "updated_at", type: "TEXT", notnull: 1, dflt_value: null, pk: 0 }
];

const { db } = require("./db.js");
const mpAuth = require("./mp_auth.js");
const realMpAi = require("./modules/mpAi");
const {
  registerMpAiRoutes,
  AI_CONSENT_VERSION,
  AI_TOKEN_LIMIT,
  AI_OPENID_LIMIT
} = require("./routes/mp-ai.js");

function allowLimiter(onKey) {
  return {
    consume(key) {
      if (onKey) onKey(key);
      return { allowed: true, retryAfter: 0 };
    }
  };
}

function createRouteHarness(options = {}) {
  const routes = [];
  const calls = [];
  const body = Object.prototype.hasOwnProperty.call(options, "body")
    ? options.body
    : {};
  const routeContext = {
    parseBody: options.parseBody || (async () => body),
    json: (res, status, responseBody) => {
      calls.push({ status, body: responseBody, headers: res.headers || {} });
    },
    MESSAGE_MAX_BODY: 1e6,
    db: options.db || db,
    mpAi: options.mpAi
  };
  if (Object.prototype.hasOwnProperty.call(options, "tokenLimiter")) {
    routeContext.tokenLimiter = options.tokenLimiter;
  } else if (!options.useDefaultTokenLimiter) {
    routeContext.tokenLimiter = allowLimiter();
  }
  if (Object.prototype.hasOwnProperty.call(options, "openidLimiter")) {
    routeContext.openidLimiter = options.openidLimiter;
  } else if (!options.useDefaultOpenidLimiter) {
    routeContext.openidLimiter = allowLimiter();
  }
  registerMpAiRoutes(
    (method, pattern, handler) => routes.push({ method, pattern, handler }),
    routeContext
  );
  assert.equal(routes.length, 1);
  return {
    async request(token) {
      const req = {
        headers: token ? { authorization: `Bearer ${token}` } : {}
      };
      const res = {
        headers: {},
        setHeader(name, value) {
          this.headers[String(name).toLowerCase()] = String(value);
        }
      };
      await routes[0].handler(req, res);
      return calls[calls.length - 1];
    }
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function aiStub(overrides = {}) {
  return {
    resolveConfig: () => ({ model: "audit-model" }),
    normalizeHistory: realMpAi.normalizeHistory,
    async chat() {
      return {
        reply: { role: "assistant", text: "stub reply" },
        sessionId: "",
        model: "audit-model"
      };
    },
    ...overrides
  };
}

function consentBody(doctorId, extra = {}) {
  return {
    doctorId,
    text: "你好",
    sensitiveDataConsent: true,
    consentVersion: "2026-07-31",
    ...extra
  };
}

async function test(name, fn) {
  await fn();
  console.log("ok -", name);
}

function runChild(script, dbPath) {
  const result = spawnSync(process.execPath, ["-e", script], {
    cwd: __dirname,
    env: { ...process.env, DB_PATH: dbPath },
    encoding: "utf8",
    timeout: 15_000
  });
  if (result.error) {
    throw new Error(
      `child execution failed: ${result.error.code || result.error.message}`
    );
  }
  if (result.signal) {
    throw new Error(`child terminated by signal ${result.signal}`);
  }
  if (result.status !== 0) {
    throw new Error(
      `child failed (${result.status})\n${result.stdout || ""}\n${result.stderr || ""}`
    );
  }
  return String(result.stdout || "");
}

function inspectMigratedAuditDb(dbPath) {
  const stdout = runChild(`
    const { db } = require("./db.js");
    setImmediate(() => {
      const result = {
        columns: db.prepare("PRAGMA table_info(mp_ai_audit)").all().map((row) => row.name),
        schema: db.prepare("PRAGMA table_info(mp_ai_audit)").all().map((row) => ({
          name: row.name,
          type: row.type,
          notnull: row.notnull,
          dflt_value: row.dflt_value,
          pk: row.pk
        })),
        rows: db.prepare("SELECT * FROM mp_ai_audit ORDER BY id").all(),
        indexes: db.prepare("PRAGMA index_list(mp_ai_audit)").all().map((row) => row.name)
      };
      console.log("__MP_AI_AUDIT__" + JSON.stringify(result));
      db.close();
    });
  `, dbPath);
  const marker = stdout.split(/\r?\n/).find((line) => line.startsWith("__MP_AI_AUDIT__"));
  assert.ok(marker, "子进程必须返回审计表检查结果");
  return JSON.parse(marker.slice("__MP_AI_AUDIT__".length));
}

function insertAuditInChild(dbPath) {
  const stdout = runChild(`
    const { db } = require("./db.js");
    setImmediate(() => {
      const now = "2026-07-31T00:00:00.000Z";
      const result = db.prepare(\`INSERT INTO mp_ai_audit(
        openid, person_id, patient_id, doctor_id, session_id, model,
        input_chars, history_turns, status, error_code, created_at, updated_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)\`).run(
        "post-migration-openid", 1, 2, 3, "", null,
        0, 0, "pending", null, now, now
      );
      console.log("__MP_AI_NEW_ID__" + String(result.lastInsertRowid));
      db.close();
    });
  `, dbPath);
  const marker = stdout.split(/\r?\n/).find((line) => line.startsWith("__MP_AI_NEW_ID__"));
  assert.ok(marker, "子进程必须返回新审计 ID");
  return Number(marker.slice("__MP_AI_NEW_ID__".length));
}

async function main() {
  await test("legacy mp_ai_audit 按白名单重建且二次启动幂等", async () => {
    const legacyPath = path.join(
      os.tmpdir(),
      `mp-ai-legacy-${process.pid}-${crypto.randomBytes(6).toString("hex")}.db`
    );
    temporaryDbPaths.add(legacyPath);
    runChild(`
      const { DatabaseSync } = require("node:sqlite");
      const db = new DatabaseSync(process.env.DB_PATH);
      db.exec(\`CREATE TABLE mp_ai_audit(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        openid TEXT,
        person_id INTEGER,
        patient_id INTEGER,
        doctor_id INTEGER,
        session_id TEXT,
        model TEXT,
        input_chars INTEGER,
        history_turns INTEGER,
        status TEXT,
        error_code TEXT,
        created_at TEXT,
        text TEXT,
        history TEXT
      )\`);
      const insert = db.prepare(\`INSERT INTO mp_ai_audit(
        id, openid, person_id, patient_id, doctor_id, session_id, model,
        input_chars, history_turns, status, error_code, created_at, text, history
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)\`);
      insert.run(
        7, "legacy-openid-7", 11, 22, 33, "legacy-session-7", "legacy-model",
        9, 2, "success", null, "2026-07-30T01:02:03.000Z",
        "LEGACY_TEXT_MUST_DISAPPEAR", "LEGACY_HISTORY_MUST_DISAPPEAR"
      );
      insert.run(
        42, "legacy-openid-42", 12, 23, 34, "legacy-session-42", "legacy-model",
        10, 3, "error", "upstream_error", "2026-07-30T01:02:03.500Z",
        "LEGACY_TEXT_42_MUST_DISAPPEAR", "LEGACY_HISTORY_42_MUST_DISAPPEAR"
      );
      insert.run(
        99, null, null, -99, 0, "S".repeat(500), "M".repeat(600),
        -1, 999, "illegal-status", "E".repeat(500), "",
        "INCOMPLETE_SECRET", "INCOMPLETE_HISTORY"
      );
      db.close();
    `, legacyPath);

    const first = inspectMigratedAuditDb(legacyPath);
    const expectedColumns = [
      "id", "openid", "person_id", "patient_id", "doctor_id", "session_id",
      "model", "input_chars", "history_turns", "status", "error_code",
      "created_at", "updated_at"
    ];
    assert.deepStrictEqual(first.columns, expectedColumns);
    assert.deepStrictEqual(first.schema, CANONICAL_AUDIT_SCHEMA);
    assert.equal(first.rows.length, 3);
    assert.deepStrictEqual(first.rows.map((row) => row.id), [7, 42, 99]);
    assert.equal(first.rows[0].openid, "legacy-openid-7");
    assert.equal(first.rows[0].person_id, 11);
    assert.equal(first.rows[0].patient_id, 22);
    assert.equal(first.rows[0].doctor_id, 33);
    assert.equal(first.rows[0].updated_at, first.rows[0].created_at);
    assert.equal(first.rows[2].openid, "legacy-invalid-openid-99");
    assert.equal(first.rows[2].person_id, 0);
    assert.equal(first.rows[2].patient_id, 0);
    assert.equal(first.rows[2].doctor_id, 0);
    assert.equal(first.rows[2].status, "error");
    assert.equal(first.rows[2].error_code, "legacy_invalid_metadata");
    assert.equal(first.rows[2].created_at, "1970-01-01T00:00:00.000Z");
    assert.equal(first.rows[2].updated_at, first.rows[2].created_at);
    assert.equal(first.rows[2].session_id.length, 128);
    assert.equal(first.rows[2].model.length, 255);
    assert.equal(first.rows[2].input_chars, 0);
    assert.equal(first.rows[2].history_turns, 0);
    assert.ok(!JSON.stringify(first).includes("LEGACY_TEXT_MUST_DISAPPEAR"));
    assert.ok(!JSON.stringify(first).includes("LEGACY_HISTORY_MUST_DISAPPEAR"));
    assert.ok(first.indexes.includes("idx_mp_ai_audit_person_created"));

    const second = inspectMigratedAuditDb(legacyPath);
    assert.deepStrictEqual(second, first);
    assert.ok(insertAuditInChild(legacyPath) > 99);
  });

  await test("legacy 审计缺 required 列时启动失败并原样保留旧表", async () => {
    const legacyPath = path.join(
      os.tmpdir(),
      `mp-ai-missing-column-${process.pid}-${crypto.randomBytes(6).toString("hex")}.db`
    );
    temporaryDbPaths.add(legacyPath);
    runChild(`
      const { DatabaseSync } = require("node:sqlite");
      const db = new DatabaseSync(process.env.DB_PATH);
      db.exec(\`CREATE TABLE mp_ai_audit(
        id INTEGER PRIMARY KEY,
        openid TEXT,
        person_id INTEGER,
        patient_id INTEGER,
        status TEXT,
        created_at TEXT,
        text TEXT
      )\`);
      db.prepare(\`INSERT INTO mp_ai_audit(
        id,openid,person_id,patient_id,status,created_at,text
      ) VALUES(?,?,?,?,?,?,?)\`).run(
        501,"missing-column-openid",11,22,"success",
        "2026-07-30T03:00:00.000Z","MUST_REMAIN_IN_OLD_TABLE"
      );
      db.close();
    `, legacyPath);

    const failed = spawnSync(process.execPath, ["-e", `require("./db.js")`], {
      cwd: __dirname,
      env: { ...process.env, DB_PATH: legacyPath },
      encoding: "utf8",
      timeout: 15_000
    });
    assert.notEqual(failed.status, 0);
    assert.match(String(failed.stderr || failed.stdout), /mp_ai_audit_missing_required_columns/);

    const inspected = runChild(`
      const { DatabaseSync } = require("node:sqlite");
      const db = new DatabaseSync(process.env.DB_PATH);
      const tables = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'mp_ai_audit%' ORDER BY name"
      ).all().map((row) => row.name);
      const columns = db.prepare("PRAGMA table_info(mp_ai_audit)").all().map((row) => row.name);
      const row = db.prepare("SELECT * FROM mp_ai_audit WHERE id=501").get();
      console.log("__MISSING_COLUMN__" + JSON.stringify({ tables, columns, row }));
      db.close();
    `, legacyPath);
    const marker = inspected.split(/\r?\n/).find((line) => line.startsWith("__MISSING_COLUMN__"));
    const result = JSON.parse(marker.slice("__MISSING_COLUMN__".length));
    assert.deepStrictEqual(result.tables, ["mp_ai_audit"]);
    assert.equal(result.columns.includes("doctor_id"), false);
    assert.equal(result.row.text, "MUST_REMAIN_IN_OLD_TABLE");
  });

  await test("同名错约束 legacy 表重建为 canonical signature", async () => {
    const legacyPath = path.join(
      os.tmpdir(),
      `mp-ai-signature-${process.pid}-${crypto.randomBytes(6).toString("hex")}.db`
    );
    temporaryDbPaths.add(legacyPath);
    runChild(`
      const { DatabaseSync } = require("node:sqlite");
      const db = new DatabaseSync(process.env.DB_PATH);
      db.exec(\`CREATE TABLE mp_ai_audit(
        id INTEGER PRIMARY KEY,
        openid TEXT,
        person_id TEXT,
        patient_id INTEGER,
        doctor_id INTEGER,
        session_id TEXT NOT NULL,
        model TEXT,
        input_chars INTEGER DEFAULT 99,
        history_turns INTEGER DEFAULT 99,
        status TEXT,
        error_code TEXT,
        created_at TEXT,
        updated_at TEXT
      )\`);
      db.prepare(\`INSERT INTO mp_ai_audit(
        id, openid, person_id, patient_id, doctor_id, session_id, model,
        input_chars, history_turns, status, error_code, created_at, updated_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)\`).run(
        17, "signature-openid", "11", 22, 33, "mpai-signature", null,
        4, 1, "success", null,
        "2026-07-30T02:00:00.000Z", "2026-07-30T02:00:01.000Z"
      );
      db.close();
    `, legacyPath);
    const migrated = inspectMigratedAuditDb(legacyPath);
    assert.deepStrictEqual(migrated.schema, CANONICAL_AUDIT_SCHEMA);
    assert.equal(migrated.rows.length, 1);
    assert.equal(migrated.rows[0].id, 17);
    assert.equal(migrated.rows[0].person_id, 11);
    assert.ok(migrated.indexes.includes("idx_mp_ai_audit_person_created"));
  });

  await test("mpAi 模块保持独立且无配置时拒绝调用", async () => {
    const source = [
      "modules/mpAi/prompt.js",
      "modules/mpAi/client.js",
      "modules/mpAi/index.js"
    ].map((file) => fs.readFileSync(path.join(__dirname, file), "utf8")).join("\n");
    assert.ok(!/require\(["'].*triage/.test(source));
    assert.ok(!/require\(["'].*health_chat/.test(source));
    assert.ok(!/require\(["'].*\/agent/.test(source));
    assert.equal(realMpAi.resolveConfig(), null);
    await assert.rejects(
      () => realMpAi.chat({ doctorId: 1, text: "你好" }),
      (error) => error && error.code === "not_configured"
    );
  });

  const doctor = db.prepare(
    "SELECT id FROM doctors ORDER BY id LIMIT 1"
  ).get();
  assert.ok(doctor && doctor.id, "需要医生 seed");
  db.prepare("UPDATE doctors SET active=1 WHERE id=?").run(doctor.id);

  const unboundLogin = await mpAuth.login({
    code: "mp-ai-unbound-" + crypto.randomBytes(6).toString("hex"),
    doctorId: doctor.id
  });
  const loginRes = await mpAuth.login({
    code: "mp-ai-bound-" + crypto.randomBytes(6).toString("hex"),
    doctorId: doctor.id
  });
  const bindRes = await mpAuth.bindPhone({
    token: loginRes.mpToken,
    phone: "13800138333",
    smsCode: "000000",
    doctorId: doctor.id
  });
  assert.ok(bindRes.mpToken, "bindPhone 必须轮换并返回新 token");
  const boundToken = bindRes.mpToken;

  await test("注册常量和 server db 注入契约", async () => {
    assert.equal(AI_CONSENT_VERSION, "2026-07-31");
    assert.equal(AI_TOKEN_LIMIT, 20);
    assert.equal(AI_OPENID_LIMIT, 40);
    const serverSource = fs.readFileSync(path.join(__dirname, "server.js"), "utf8");
    assert.match(
      serverSource,
      /registerMpAiRoutes\s*\(\s*route\s*,\s*\{[^}]*\bdb\b[^}]*\}\s*\)/s
    );
  });

  await test("parseBody 等待期间 token 轮换或撤销时 AI 零限频、零审计、零上游", async () => {
    for (const mode of ["rotated", "revoked"]) {
      const phone = mode === "rotated" ? "13800138371" : "13800138372";
      const login = await mpAuth.login({
        code: `mp-ai-race-${mode}-${Date.now()}`,
        doctorId: doctor.id
      });
      const identity = await mpAuth.bindPhone({
        token: login.mpToken,
        phone,
        smsCode: "000000",
        doctorId: doctor.id
      });
      const entered = deferred();
      const release = deferred();
      let limiterCalls = 0;
      let upstreamCalls = 0;
      const before = db.prepare("SELECT COUNT(*) AS n FROM mp_ai_audit").get().n;
      const harness = createRouteHarness({
        parseBody: async () => {
          entered.resolve();
          await release.promise;
          return consentBody(doctor.id);
        },
        tokenLimiter: allowLimiter(() => { limiterCalls += 1; }),
        openidLimiter: allowLimiter(() => { limiterCalls += 1; }),
        mpAi: aiStub({
          async chat() {
            upstreamCalls += 1;
            return { reply: { role: "assistant", text: "unexpected" } };
          }
        })
      });
      const pending = harness.request(identity.mpToken);
      await entered.promise;
      if (mode === "rotated") {
        const rotated = await mpAuth.bindPhone({
          token: identity.mpToken,
          phone,
          smsCode: "000000",
          doctorId: doctor.id
        });
        assert.notEqual(rotated.mpToken, identity.mpToken);
      } else {
        db.prepare("UPDATE mp_sessions SET revoked_at=? WHERE token=?")
          .run(new Date().toISOString(), identity.mpToken);
      }
      release.resolve();
      const response = await pending;
      assert.deepStrictEqual(
        { status: response.status, body: response.body },
        { status: 401, body: { error: "unauthorized" } },
        mode
      );
      assert.equal(limiterCalls, 0, mode);
      assert.equal(upstreamCalls, 0, mode);
      assert.equal(
        db.prepare("SELECT COUNT(*) AS n FROM mp_ai_audit").get().n,
        before,
        mode
      );
    }
  });

  await test("无效 Bearer 稳定返回 401 unauthorized", async () => {
    for (const token of [null, "invalid-token"]) {
      const harness = createRouteHarness({
        body: consentBody(doctor.id),
        mpAi: aiStub()
      });
      const response = await harness.request(token);
      assert.deepStrictEqual(
        { status: response.status, body: response.body },
        { status: 401, body: { error: "unauthorized" } }
      );
    }
  });

  await test("缺少任一患者绑定字段均返回 403 patient_binding_required", async () => {
    const original = db.prepare(
      "SELECT phone_bound, person_id, patient_id FROM mp_sessions WHERE token=?"
    ).get(boundToken);
    const cases = [
      { phone_bound: 0, person_id: original.person_id, patient_id: original.patient_id },
      { phone_bound: 1, person_id: null, patient_id: original.patient_id },
      { phone_bound: 1, person_id: original.person_id, patient_id: null },
      { phone_bound: 1, person_id: -1, patient_id: original.patient_id },
      { phone_bound: 1, person_id: original.person_id, patient_id: "invalid" }
    ];
    try {
      for (const item of cases) {
        db.prepare(
          "UPDATE mp_sessions SET phone_bound=?, person_id=?, patient_id=? WHERE token=?"
        ).run(item.phone_bound, item.person_id, item.patient_id, boundToken);
        const response = await createRouteHarness({
          body: consentBody(doctor.id),
          mpAi: aiStub()
        }).request(boundToken);
        assert.equal(response.status, 403);
        assert.deepStrictEqual(response.body, { error: "patient_binding_required" });
      }
    } finally {
      db.prepare(
        "UPDATE mp_sessions SET phone_bound=?, person_id=?, patient_id=? WHERE token=?"
      ).run(original.phone_bound, original.person_id, original.patient_id, boundToken);
    }

    const unboundResponse = await createRouteHarness({
      body: consentBody(doctor.id),
      mpAi: aiStub()
    }).request(unboundLogin.mpToken);
    assert.equal(unboundResponse.status, 403);
    assert.deepStrictEqual(unboundResponse.body, { error: "patient_binding_required" });
  });

  await test("session doctor_id 非正安全整数时稳定返回 401", async () => {
    const original = db.prepare(
      "SELECT doctor_id FROM mp_sessions WHERE token=?"
    ).get(boundToken);
    try {
      db.prepare("UPDATE mp_sessions SET doctor_id=0 WHERE token=?").run(boundToken);
      const response = await createRouteHarness({
        body: consentBody(doctor.id),
        mpAi: aiStub()
      }).request(boundToken);
      assert.equal(response.status, 401);
      assert.deepStrictEqual(response.body, { error: "unauthorized" });
    } finally {
      db.prepare("UPDATE mp_sessions SET doctor_id=? WHERE token=?")
        .run(original.doctor_id, boundToken);
    }
  });

  await test("doctorId 与 session 不匹配时返回 403 doctor_mismatch", async () => {
    const response = await createRouteHarness({
      body: consentBody(doctor.id + 9999),
      mpAi: aiStub()
    }).request(boundToken);
    assert.equal(response.status, 403);
    assert.deepStrictEqual(response.body, { error: "doctor_mismatch" });
  });

  await test("doctorId 缺失或不是正整数时 bad_request 且无副作用", async () => {
    const invalidDoctorIds = [
      undefined,
      0,
      "abc",
      NaN,
      true,
      [doctor.id],
      -1,
      null,
      1.5,
      "1e2",
      Number.MAX_SAFE_INTEGER + 1
    ];
    for (const doctorId of invalidDoctorIds) {
      let upstreamCalls = 0;
      const body = consentBody(doctor.id);
      if (doctorId === undefined) delete body.doctorId;
      else body.doctorId = doctorId;
      const before = db.prepare("SELECT COUNT(*) AS n FROM mp_ai_audit").get().n;
      const response = await createRouteHarness({
        body,
        mpAi: aiStub({
          async chat() {
            upstreamCalls += 1;
            return {};
          }
        })
      }).request(boundToken);
      const after = db.prepare("SELECT COUNT(*) AS n FROM mp_ai_audit").get().n;
      assert.equal(response.status, 400);
      assert.deepStrictEqual(response.body, { error: "bad_request" });
      assert.equal(after, before);
      assert.equal(upstreamCalls, 0);
    }
  });

  await test("parseBody 非普通对象时 bad_request 且无副作用", async () => {
    for (const body of [null, true, [], "invalid"]) {
      let upstreamCalls = 0;
      const before = db.prepare("SELECT COUNT(*) AS n FROM mp_ai_audit").get().n;
      const response = await createRouteHarness({
        body,
        mpAi: aiStub({
          async chat() {
            upstreamCalls += 1;
            return {};
          }
        })
      }).request(boundToken);
      const after = db.prepare("SELECT COUNT(*) AS n FROM mp_ai_audit").get().n;
      assert.equal(response.status, 400);
      assert.deepStrictEqual(response.body, { error: "bad_request" });
      assert.equal(after, before);
      assert.equal(upstreamCalls, 0);
    }
  });

  await test("sessionId 仅接受空值或安全字符串且审计与上游使用同一值", async () => {
    const invalidSessionIds = [
      1,
      true,
      ["mpai-array"],
      {},
      "contains space",
      "a".repeat(129),
      "mpai-中文"
    ];
    for (const sessionId of invalidSessionIds) {
      let upstreamCalls = 0;
      const before = db.prepare("SELECT COUNT(*) AS n FROM mp_ai_audit").get().n;
      const response = await createRouteHarness({
        body: consentBody(doctor.id, { sessionId }),
        mpAi: aiStub({
          async chat() {
            upstreamCalls += 1;
            return {};
          }
        })
      }).request(boundToken);
      const after = db.prepare("SELECT COUNT(*) AS n FROM mp_ai_audit").get().n;
      assert.equal(response.status, 400);
      assert.deepStrictEqual(response.body, { error: "bad_request" });
      assert.equal(after, before);
      assert.equal(upstreamCalls, 0);
    }

    const sessionId = "mpai-AbC_123-valid";
    let upstreamSessionId = null;
    const response = await createRouteHarness({
      body: consentBody(String(doctor.id), { sessionId }),
      mpAi: aiStub({
        async chat(input) {
          upstreamSessionId = input.sessionId;
          return {
            reply: { role: "assistant", text: "ok" },
            sessionId,
            model: "audit-model"
          };
        }
      })
    }).request(boundToken);
    assert.equal(response.status, 200);
    const audit = db.prepare(
      "SELECT session_id FROM mp_ai_audit ORDER BY id DESC LIMIT 1"
    ).get();
    assert.equal(audit.session_id, sessionId);
    assert.equal(upstreamSessionId, sessionId);
  });

  await test("缺少明确同意或版本不匹配时不调用上游", async () => {
    let upstreamCalls = 0;
    const stub = aiStub({
      async chat() {
        upstreamCalls += 1;
        return { reply: { role: "assistant", text: "never" } };
      }
    });
    for (const body of [
      { doctorId: doctor.id, text: "你好" },
      consentBody(doctor.id, { sensitiveDataConsent: false }),
      consentBody(doctor.id, { consentVersion: "old" })
    ]) {
      const response = await createRouteHarness({ body, mpAi: stub }).request(boundToken);
      assert.equal(response.status, 403);
      assert.deepStrictEqual(response.body, { error: "ai_consent_required" });
    }
    assert.equal(upstreamCalls, 0);
  });

  await test("token/OpenID 使用 SHA-256 键且 OpenID 超限返回 Retry-After", async () => {
    let tokenKey = "";
    let openidKey = "";
    let upstreamCalls = 0;
    const boundSession = db.prepare(
      "SELECT openid FROM mp_sessions WHERE token=?"
    ).get(boundToken);
    const response = await createRouteHarness({
      body: consentBody(doctor.id),
      mpAi: aiStub({
        async chat() {
          upstreamCalls += 1;
          return {};
        }
      }),
      tokenLimiter: allowLimiter((key) => {
        tokenKey = key;
      }),
      openidLimiter: {
        consume(key) {
          openidKey = key;
          return { allowed: false, retryAfter: 7 };
        }
      }
    }).request(boundToken);

    assert.equal(response.status, 429);
    assert.deepStrictEqual(response.body, { error: "rate_limited" });
    assert.equal(response.headers["retry-after"], "7");
    assert.match(tokenKey, /^[a-f0-9]{64}$/);
    assert.ok(!tokenKey.includes(boundToken));
    assert.match(openidKey, /^openid:[a-f0-9]{64}$/);
    assert.ok(!openidKey.includes(boundSession.openid));
    assert.equal(upstreamCalls, 0);
  });

  await test("token bucket 拒绝后绝不消费 OpenID bucket", async () => {
    let tokenCalls = 0;
    let openidCalls = 0;
    const response = await createRouteHarness({
      body: consentBody(doctor.id),
      mpAi: aiStub(),
      tokenLimiter: {
        consume() {
          tokenCalls += 1;
          return { allowed: false, retryAfter: 9 };
        }
      },
      openidLimiter: {
        consume() {
          openidCalls += 1;
          return { allowed: true, retryAfter: 0 };
        }
      }
    }).request(boundToken);
    assert.equal(response.status, 429);
    assert.equal(response.headers["retry-after"], "9");
    assert.equal(tokenCalls, 1);
    assert.equal(openidCalls, 0);
  });

  await test("默认 token limiter 第 21 次拒绝且 registration 之间隔离", async () => {
    let upstreamCalls = 0;
    const stub = aiStub({
      async chat() {
        upstreamCalls += 1;
        return {
          reply: { role: "assistant", text: "ok" },
          model: "audit-model"
        };
      }
    });
    const before = db.prepare("SELECT COUNT(*) AS n FROM mp_ai_audit").get().n;
    const harness = createRouteHarness({
      body: consentBody(doctor.id),
      mpAi: stub,
      useDefaultTokenLimiter: true,
      useDefaultOpenidLimiter: true
    });
    for (let index = 0; index < 20; index += 1) {
      const response = await harness.request(boundToken);
      assert.equal(response.status, 200, `token limiter 第 ${index + 1} 次应成功`);
    }
    const denied = await harness.request(boundToken);
    assert.equal(denied.status, 429);
    assert.deepStrictEqual(denied.body, { error: "rate_limited" });
    assert.ok(+denied.headers["retry-after"] >= 1);
    assert.equal(upstreamCalls, 20);
    const after = db.prepare("SELECT COUNT(*) AS n FROM mp_ai_audit").get().n;
    assert.equal(after - before, 20);

    const isolated = createRouteHarness({
      body: consentBody(doctor.id),
      mpAi: stub,
      useDefaultTokenLimiter: true,
      useDefaultOpenidLimiter: true
    });
    assert.equal((await isolated.request(boundToken)).status, 200);
    assert.equal(upstreamCalls, 21);
  });

  await test("默认 OpenID limiter 第 41 次拒绝且前 40 次完成审计", async () => {
    let upstreamCalls = 0;
    const before = db.prepare("SELECT COUNT(*) AS n FROM mp_ai_audit").get().n;
    const harness = createRouteHarness({
      body: consentBody(doctor.id),
      mpAi: aiStub({
        async chat() {
          upstreamCalls += 1;
          return {
            reply: { role: "assistant", text: "ok" },
            model: "audit-model"
          };
        }
      }),
      tokenLimiter: allowLimiter(),
      useDefaultOpenidLimiter: true
    });
    for (let index = 0; index < 40; index += 1) {
      const response = await harness.request(boundToken);
      assert.equal(response.status, 200, `OpenID limiter 第 ${index + 1} 次应成功`);
    }
    const denied = await harness.request(boundToken);
    assert.equal(denied.status, 429);
    assert.deepStrictEqual(denied.body, { error: "rate_limited" });
    assert.ok(+denied.headers["retry-after"] >= 1);
    assert.equal(upstreamCalls, 40);
    const after = db.prepare("SELECT COUNT(*) AS n FROM mp_ai_audit").get().n;
    assert.equal(after - before, 40);
  });

  await test("mp_ai_audit 架构只保存允许的元数据", async () => {
    const tableInfo = db.prepare("PRAGMA table_info(mp_ai_audit)").all();
    const columns = tableInfo.map((row) => row.name);
    assert.deepStrictEqual(columns, [
      "id",
      "openid",
      "person_id",
      "patient_id",
      "doctor_id",
      "session_id",
      "model",
      "input_chars",
      "history_turns",
      "status",
      "error_code",
      "created_at",
      "updated_at"
    ]);
    assert.deepStrictEqual(
      tableInfo.map((row) => ({
        name: row.name,
        type: row.type,
        notnull: row.notnull,
        dflt_value: row.dflt_value,
        pk: row.pk
      })),
      CANONICAL_AUDIT_SCHEMA
    );
    for (const forbidden of ["text", "history", "page_context", "reply", "content"]) {
      assert.ok(!columns.includes(forbidden));
    }
    const indexes = db.prepare("PRAGMA index_list(mp_ai_audit)").all();
    assert.ok(indexes.some((row) => row.name === "idx_mp_ai_audit_person_created"));
  });

  await test("上游调用前写 pending，成功后只更新元数据", async () => {
    const textSentinel = "身份证敏感哨兵-110101199001011234";
    const historySentinel = "病史敏感哨兵-不可落库";
    const contextSentinel = "页面敏感哨兵-不可落库";
    const replySentinel = "回复敏感哨兵-不可落库";
    const sessionId = "mpai-" + "s".repeat(123);
    const history = Array.from({ length: 13 }, (_, index) => ({
      role: index % 2 ? "assistant" : "user",
      text: `${historySentinel}-${index}`
    }));
    let pendingObserved = false;
    let capturedInput = null;
    const stub = aiStub({
      async chat(input) {
        capturedInput = input;
        const row = db.prepare(
          "SELECT status FROM mp_ai_audit ORDER BY id DESC LIMIT 1"
        ).get();
        pendingObserved = !!row && row.status === "pending";
        return {
          reply: { role: "assistant", text: replySentinel },
          sessionId,
          model: "upstream-model"
        };
      }
    });

    const response = await createRouteHarness({
      body: consentBody(doctor.id, {
        text: textSentinel,
        history,
        pageContext: contextSentinel,
        sessionId
      }),
      mpAi: stub
    }).request(boundToken);
    assert.equal(response.status, 200);
    assert.ok(pendingObserved);
    assert.equal(capturedInput.personId, bindRes.personId);
    assert.equal(capturedInput.patientId, bindRes.patientId);

    const row = db.prepare("SELECT * FROM mp_ai_audit ORDER BY id DESC LIMIT 1").get();
    assert.equal(row.status, "success");
    assert.equal(row.error_code, null);
    assert.equal(row.model, "upstream-model");
    assert.equal(row.session_id, sessionId);
    assert.equal(capturedInput.sessionId, sessionId);
    assert.equal(row.input_chars, textSentinel.length);
    assert.equal(row.history_turns, 10);
    const stored = JSON.stringify(row);
    for (const sentinel of [
      textSentinel,
      historySentinel,
      contextSentinel,
      replySentinel
    ]) {
      assert.ok(!stored.includes(sentinel));
    }
  });

  await test("审计 INSERT 失败时返回 500 且不调用上游", async () => {
    let upstreamCalls = 0;
    const failingDb = {
      exec(sql) {
        return db.exec(sql);
      },
      prepare(sql) {
        if (/INSERT\s+INTO\s+mp_ai_audit/i.test(sql)) {
          throw new Error("audit database secret");
        }
        return db.prepare(sql);
      }
    };
    const response = await createRouteHarness({
      db: failingDb,
      body: consentBody(doctor.id),
      mpAi: aiStub({
        async chat() {
          upstreamCalls += 1;
          return {};
        }
      })
    }).request(boundToken);
    assert.equal(response.status, 500);
    assert.deepStrictEqual(response.body, { error: "audit_unavailable" });
    assert.equal(upstreamCalls, 0);
  });

  await test("success/error 审计 UPDATE 失败均 fail-closed 并保留 pending", async () => {
    const secret = "AUDIT_UPDATE_SECRET_不可泄漏";
    const cases = [
      {
        updatePattern: /status='success'/,
        chat: async () => ({
          reply: { role: "assistant", text: secret },
          model: "audit-model"
        })
      },
      {
        updatePattern: /status='error'/,
        chat: async () => {
          const error = new Error(secret);
          error.code = "upstream_error";
          throw error;
        }
      }
    ];
    for (const item of cases) {
      let upstreamCalls = 0;
      const failingDb = {
        exec(sql) {
          return db.exec(sql);
        },
        prepare(sql) {
          if (
            /UPDATE\s+mp_ai_audit/i.test(sql) &&
            item.updatePattern.test(sql)
          ) {
            return {
              run() {
                throw new Error(secret);
              }
            };
          }
          return db.prepare(sql);
        }
      };
      const response = await createRouteHarness({
        db: failingDb,
        body: consentBody(doctor.id, { text: secret }),
        mpAi: aiStub({
          async chat(input) {
            upstreamCalls += 1;
            return item.chat(input);
          }
        })
      }).request(boundToken);
      assert.equal(response.status, 500);
      assert.deepStrictEqual(response.body, { error: "audit_unavailable" });
      assert.equal(upstreamCalls, 1);
      assert.ok(!JSON.stringify(response).includes(secret));
      const audit = db.prepare(
        "SELECT * FROM mp_ai_audit ORDER BY id DESC LIMIT 1"
      ).get();
      assert.equal(audit.status, "pending");
      assert.equal(audit.error_code, null);
      assert.ok(!JSON.stringify(audit).includes(secret));
    }
  });

  await test("success/error 审计 UPDATE changes=0 均视为 audit_unavailable", async () => {
    const secret = "AUDIT_ZERO_CHANGES_SECRET_不可泄漏";
    const cases = [
      {
        updatePattern: /status='success'/,
        chat: async () => ({
          reply: { role: "assistant", text: secret },
          model: "audit-model"
        })
      },
      {
        updatePattern: /status='error'/,
        chat: async () => {
          const error = new Error(secret);
          error.code = "upstream_error";
          throw error;
        }
      }
    ];
    for (const item of cases) {
      let upstreamCalls = 0;
      const zeroChangesDb = {
        exec(sql) {
          return db.exec(sql);
        },
        prepare(sql) {
          if (
            /UPDATE\s+mp_ai_audit/i.test(sql) &&
            item.updatePattern.test(sql)
          ) {
            return {
              run() {
                return { changes: 0 };
              }
            };
          }
          return db.prepare(sql);
        }
      };
      const response = await createRouteHarness({
        db: zeroChangesDb,
        body: consentBody(doctor.id, { text: secret }),
        mpAi: aiStub({
          async chat(input) {
            upstreamCalls += 1;
            return item.chat(input);
          }
        })
      }).request(boundToken);
      assert.equal(response.status, 500);
      assert.deepStrictEqual(response.body, { error: "audit_unavailable" });
      assert.equal(upstreamCalls, 1);
      assert.ok(!JSON.stringify(response).includes(secret));
      const audit = db.prepare(
        "SELECT * FROM mp_ai_audit ORDER BY id DESC LIMIT 1"
      ).get();
      assert.equal(audit.status, "pending");
      assert.equal(audit.error_code, null);
      assert.ok(!JSON.stringify(audit).includes(secret));
    }
  });

  await test("上游错误稳定映射且审计 error 不泄漏消息", async () => {
    const cases = [
      ["bad_request", 400, "bad_request"],
      ["not_found", 404, "doctor_not_found"],
      ["not_configured", 503, "ai_not_configured"],
      ["upstream_error", 502, "upstream_error"],
      ["unknown_code", 500, "mp_ai_failed"]
    ];
    const secret = "UPSTREAM_SECRET_MESSAGE_不可泄漏";
    const originalError = console.error;
    const logs = [];
    console.error = (...args) => logs.push(args.map(String).join(" "));
    try {
      for (const [code, status, responseCode] of cases) {
        const response = await createRouteHarness({
          body: consentBody(doctor.id, {
            text: secret,
            history: [{ role: "user", text: secret }],
            pageContext: secret
          }),
          mpAi: aiStub({
            async chat() {
              const error = new Error(secret);
              error.code = code === "unknown_code" ? undefined : code;
              throw error;
            }
          })
        }).request(boundToken);
        assert.equal(response.status, status);
        assert.deepStrictEqual(response.body, { error: responseCode });
        const audit = db.prepare(
          "SELECT * FROM mp_ai_audit ORDER BY id DESC LIMIT 1"
        ).get();
        assert.equal(audit.status, "error");
        assert.equal(audit.error_code, responseCode);
        assert.ok(!JSON.stringify(audit).includes(secret));
      }
    } finally {
      console.error = originalError;
    }
    assert.ok(!logs.join("\n").includes(secret));
  });

  console.log("\nall mp_ai tests passed");
}

(async () => {
  try {
    await main();
  } finally {
    await new Promise((resolve) => setImmediate(resolve));
    try {
      if (db && typeof db.close === "function") db.close();
    } finally {
      for (const dbPath of temporaryDbPaths) {
        for (const file of [dbPath, dbPath + "-wal", dbPath + "-shm"]) {
          try {
            fs.unlinkSync(file);
          } catch (error) {
            if (!error || error.code !== "ENOENT") throw error;
          }
        }
      }
    }
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
