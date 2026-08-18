"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, spawnSync } = require("child_process");

process.env.DB_PATH = path.join(
  os.tmpdir(),
  `mp-data-requests-${process.pid}-${crypto.randomBytes(6).toString("hex")}.db`
);
process.env.MP_AUTH_STUB = "1";

const temporaryDbPaths = new Set([process.env.DB_PATH]);
const { db } = require("./db.js");
const { registerMpAuthRoutes } = require("./routes/mp-auth.js");

function runChild(script, dbPath) {
  const result = spawnSync(process.execPath, ["-e", script], {
    cwd: __dirname,
    env: { ...process.env, DB_PATH: dbPath },
    encoding: "utf8",
    timeout: 20_000
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `child failed (${result.status})\n${result.stdout || ""}\n${result.stderr || ""}`
    );
  }
  return String(result.stdout || "");
}

function inspectSchemaTwice(dbPath) {
  const script = `
    const { db } = require("./db.js");
    setImmediate(() => {
      const result = {
        columns: db.prepare("PRAGMA table_info(mp_data_requests)").all().map((row) => row.name),
        indexes: db.prepare("PRAGMA index_list(mp_data_requests)").all().map((row) => ({
          name: row.name,
          unique: row.unique,
          partial: row.partial,
          columns: db.prepare(
            \`PRAGMA index_info("\${String(row.name).replace(/"/g, '""')}")\`
          ).all().map((column) => column.name),
          sql: (
            db.prepare(
              "SELECT sql FROM sqlite_master WHERE type='index' AND name=?"
            ).get(row.name) || {}
          ).sql || null
        })),
        rows: db.prepare("SELECT * FROM mp_data_requests ORDER BY id").all()
      };
      try {
        db.prepare(\`INSERT INTO mp_data_requests(
          person_id, patient_id, request_type, status, created_at, updated_at
        ) VALUES(999, 999, 'export', 'cancelled', '2026-01-01', '2026-01-01')\`).run();
        result.cancelledRejected = false;
      } catch (error) {
        result.cancelledRejected = true;
      }
      console.log("__MP_DATA_REQUESTS__" + JSON.stringify(result));
      db.close();
    });
  `;
  let parsed = null;
  let migrationLogSeen = false;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const stdout = runChild(script, dbPath);
    migrationLogSeen =
      migrationLogSeen ||
      stdout.includes(
        "[db/mp_data_requests] normalized_duplicate_active count=2"
      );
    const marker = stdout
      .split(/\r?\n/)
      .find((line) => line.startsWith("__MP_DATA_REQUESTS__"));
    assert.ok(marker, "独立进程必须返回数据申请 schema");
    parsed = JSON.parse(marker.slice("__MP_DATA_REQUESTS__".length));
  }
  parsed.migrationLogSeen = migrationLogSeen;
  return parsed;
}

function normalizeSql(sql) {
  return String(sql || "").replace(/\s+/g, "").toLowerCase();
}

function assertCanonicalIndexes(schema) {
  const person = schema.indexes.find(
    (row) => row.name === "idx_mp_data_requests_person"
  );
  assert.ok(person, "缺少数据申请查询索引");
  assert.equal(person.unique, 0);
  assert.equal(person.partial, 0);
  assert.deepEqual(person.columns, [
    "person_id",
    "request_type",
    "status",
    "created_at"
  ]);

  const active = schema.indexes.find(
    (row) => row.name === "idx_mp_data_requests_active_unique"
  );
  assert.ok(active, "缺少 active 唯一索引");
  assert.equal(active.unique, 1);
  assert.equal(active.partial, 1);
  assert.deepEqual(active.columns, ["person_id", "request_type"]);
  assert.ok(
    normalizeSql(active.sql).includes(
      "wherestatusin('pending','processing')"
    ),
    "active 唯一索引 WHERE 定义错误"
  );
}

function spawnDataRequestChild(token, readyPath, releasePath) {
  const script = `
    "use strict";
    const fs = require("fs");
    const { db } = require("./db.js");
    const { registerMpAuthRoutes } = require("./routes/mp-auth.js");
    const routes = [];
    registerMpAuthRoutes(
      (method, pattern, handler) => routes.push({ method, pattern, handler }),
      {
        db,
        MESSAGE_MAX_BODY: 1e6,
        parseBody: async (req) => {
          fs.writeFileSync(process.env.READY_PATH, "ready");
          while (!fs.existsSync(process.env.RELEASE_PATH)) {
            await new Promise((resolve) => setTimeout(resolve, 5));
          }
          return req.body;
        },
        json(res, status, body) {
          res.result = { status, body };
        }
      }
    );
    (async () => {
      const route = routes.find(
        (item) =>
          item.method === "POST" &&
          item.pattern.test("/api/mp/data-requests")
      );
      const req = {
        headers: { authorization: "Bearer " + process.env.MP_TOKEN },
        body: { requestType: "export" }
      };
      const res = {
        setHeader() {}
      };
      await route.handler(req, res);
      console.log("__MP_DATA_CHILD__" + JSON.stringify(res.result));
      db.close();
    })().catch((error) => {
      console.error(error && error.stack ? error.stack : error);
      process.exitCode = 1;
    });
  `;
  const child = spawn(process.execPath, ["-e", script], {
    cwd: __dirname,
    env: {
      ...process.env,
      DB_PATH: process.env.DB_PATH,
      MP_AUTH_STUB: "1",
      MP_TOKEN: token,
      READY_PATH: readyPath,
      RELEASE_PATH: releasePath
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (code !== 0 || signal) {
        reject(
          new Error(
            `data request child failed (${code || signal})\n${stdout}\n${stderr}`
          )
        );
        return;
      }
      const marker = stdout
        .split(/\r?\n/)
        .find((line) => line.startsWith("__MP_DATA_CHILD__"));
      if (!marker) {
        reject(new Error(`data request child missing result\n${stdout}\n${stderr}`));
        return;
      }
      resolve(JSON.parse(marker.slice("__MP_DATA_CHILD__".length)));
    });
  });
}

async function waitForPaths(paths, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (paths.every((item) => fs.existsSync(item))) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("independent data request processes did not reach barrier");
}

function iso(offsetMs = 0) {
  return new Date(Date.now() + offsetMs).toISOString();
}

function seedIdentity(label) {
  const now = iso();
  const openid = `openid-${label}-${crypto.randomUUID()}`;
  const doctor = db.prepare(`
    INSERT INTO doctors(slug, name, active)
    VALUES(?, ?, 1)
  `).run(`data-${label}-${crypto.randomUUID()}`, `Doctor ${label}`);
  const doctorId = Number(doctor.lastInsertRowid);

  const person = db.prepare(`
    INSERT INTO persons(real_name, phone, phone_verified, mp_openid, created_at, updated_at)
    VALUES(?, ?, 1, ?, ?, ?)
  `).run(
    `Person ${label}`,
    `138${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`,
    openid,
    now,
    now
  );
  const personId = Number(person.lastInsertRowid);

  const patient = db.prepare(`
    INSERT INTO patients(
      doctor_id, person_id, display_name, real_name, phone, phone_verified,
      created_at, updated_at
    ) VALUES(?, ?, ?, ?, ?, 1, ?, ?)
  `).run(
    doctorId,
    personId,
    `Patient ${label}`,
    `Person ${label}`,
    `138${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`,
    now,
    now
  );
  const patientId = Number(patient.lastInsertRowid);

  const token = `token-${label}-${crypto.randomUUID()}`;
  db.prepare(`
    INSERT INTO mp_sessions(
      token, openid, doctor_id, person_id, patient_id, phone_bound,
      created_at, expires_at, last_seen_at, revoked_at
    ) VALUES(?, ?, ?, ?, ?, 1, ?, ?, ?, NULL)
  `).run(
    token,
    openid,
    doctorId,
    personId,
    patientId,
    now,
    iso(60 * 60 * 1000),
    now
  );

  return { doctorId, personId, patientId, openid, token };
}

function seedSession({
  label,
  doctorId,
  personId = null,
  patientId = null,
  phoneBound = 0,
  openid = `session-openid-${label}-${crypto.randomUUID()}`,
  expiresAt = iso(60 * 60 * 1000),
  revokedAt = null
}) {
  const token = `token-${label}-${crypto.randomUUID()}`;
  const now = iso();
  db.prepare(`
    INSERT INTO mp_sessions(
      token, openid, doctor_id, person_id, patient_id, phone_bound,
      created_at, expires_at, last_seen_at, revoked_at
    ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    token,
    openid,
    doctorId,
    personId,
    patientId,
    phoneBound ? 1 : 0,
    now,
    expiresAt,
    now,
    revokedAt
  );
  return token;
}

function createHarness(options = {}) {
  const routes = [];
  registerMpAuthRoutes(
    (method, pattern, handler) => routes.push({ method, pattern, handler }),
    {
      db,
      MESSAGE_MAX_BODY: 1e6,
      parseBody: options.parseBody || (async (req) => req.body || {}),
      json(res, status, body) {
        res.result = { status, body };
      }
    }
  );

  return async function request(method, pathname, token, body) {
    const found = routes.find(
      (item) => item.method === method && item.pattern.test(pathname)
    );
    assert.ok(found, `route not found: ${method} ${pathname}`);
    const req = {
      headers: token ? { authorization: `Bearer ${token}` } : {},
      body
    };
    const res = {
      headers: {},
      setHeader(name, value) {
        this.headers[String(name).toLowerCase()] = String(value);
      }
    };
    await found.handler(req, res);
    assert.ok(res.result, `route did not respond: ${method} ${pathname}`);
    return res.result;
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const failures = [];

async function test(name, fn) {
  try {
    await fn();
    console.log("ok -", name);
  } catch (error) {
    failures.push({ name, error });
    console.error("not ok -", name);
    console.error(error && error.stack ? error.stack : error);
  }
}

function cleanupDatabase(dbPath) {
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      fs.rmSync(dbPath + suffix, { force: true });
    } catch (error) {}
  }
}

async function main() {
  await test("schema 可由两个独立进程连续初始化且包含必要索引和约束", async () => {
    const schemaPath = path.join(
      os.tmpdir(),
      `mp-data-schema-${process.pid}-${crypto.randomBytes(6).toString("hex")}.db`
    );
    temporaryDbPaths.add(schemaPath);
    runChild(`
      const { DatabaseSync } = require("node:sqlite");
      const db = new DatabaseSync(process.env.DB_PATH);
      db.exec(\`CREATE TABLE mp_data_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        person_id INTEGER NOT NULL,
        patient_id INTEGER NOT NULL,
        doctor_id INTEGER NOT NULL,
        request_type TEXT NOT NULL,
        status TEXT NOT NULL,
        requested_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        processed_at TEXT,
        note TEXT
      )\`);
      db.exec(\`
        CREATE INDEX idx_mp_data_requests_person
          ON mp_data_requests(status);
        CREATE INDEX idx_mp_data_requests_active_unique
          ON mp_data_requests(person_id, request_type, status);
      \`);
      const insert = db.prepare(\`INSERT INTO mp_data_requests(
        id, person_id, patient_id, doctor_id, request_type, status,
        requested_at, created_at, updated_at, processed_at, note
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)\`);
      const longNote = "L".repeat(2505) + ":end";
      insert.run(
        7, 71, 72, 73, "export", "completed",
        "2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04",
        "completed original note"
      );
      insert.run(
        8, 81, 82, 83, "delete", "cancelled",
        "2026-02-01", "2026-02-02", "2026-02-03", null, null
      );
      insert.run(
        9, 91, 92, 93, "export", "pending",
        "2026-03-02", "2026-03-02", "2026-03-02", null, longNote
      );
      insert.run(
        10, 91, 92, 93, "export", "processing",
        "2026-03-01", "2026-03-01", "2026-03-01", null,
        "earliest active note"
      );
      insert.run(
        11, 91, 92, 93, "export", "pending",
        "2026-03-03", "2026-03-03", "2026-03-03", null,
        "later duplicate note"
      );
      db.close();
    `, schemaPath);
    const schema = inspectSchemaTwice(schemaPath);
    assert.deepEqual(schema.columns, [
      "id",
      "person_id",
      "patient_id",
      "request_type",
      "status",
      "created_at",
      "updated_at",
      "completed_at",
      "operator_id",
      "note"
    ]);
    assert.equal(schema.cancelledRejected, true);
    assert.deepEqual(schema.rows.slice(0, 2), [
      {
        id: 7,
        person_id: 71,
        patient_id: 72,
        request_type: "export",
        status: "completed",
        created_at: "2026-01-02",
        updated_at: "2026-01-03",
        completed_at: "2026-01-04",
        operator_id: null,
        note: "completed original note"
      },
      {
        id: 8,
        person_id: 81,
        patient_id: 82,
        request_type: "delete",
        status: "rejected",
        created_at: "2026-02-02",
        updated_at: "2026-02-03",
        completed_at: null,
        operator_id: null,
        note: null
      }
    ]);
    assertCanonicalIndexes(schema);
    assert.equal(schema.rows.length, 5, "迁移前后总行数必须一致");
    const migratedActive = schema.rows.filter(
      (row) =>
        row.person_id === 91 &&
        row.request_type === "export" &&
        ["pending", "processing"].includes(row.status)
    );
    assert.deepEqual(migratedActive.map((row) => row.id), [10]);
    const expectedNotes = new Map([
      [9, "L".repeat(2505) + ":end"],
      [10, "earliest active note"],
      [11, "later duplicate note"]
    ]);
    for (const id of [9, 11]) {
      const duplicate = schema.rows.find((row) => row.id === id);
      assert.equal(duplicate.status, "rejected");
    }
    for (const [id, expectedNote] of expectedNotes) {
      const migrated = schema.rows.find((row) => row.id === id);
      assert.equal(migrated.note, expectedNote);
    }
    assert.equal(schema.migrationLogSeen, true);
  });

  await test("canonical 表上的同名错误索引会按真实定义重建", async () => {
    const indexPath = path.join(
      os.tmpdir(),
      `mp-data-index-${process.pid}-${crypto.randomBytes(6).toString("hex")}.db`
    );
    temporaryDbPaths.add(indexPath);
    runChild(`
      const { DatabaseSync } = require("node:sqlite");
      const db = new DatabaseSync(process.env.DB_PATH);
      db.exec(\`
        CREATE TABLE mp_data_requests (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          person_id INTEGER NOT NULL,
          patient_id INTEGER NOT NULL,
          request_type TEXT NOT NULL CHECK(request_type IN ('export','delete')),
          status TEXT NOT NULL DEFAULT 'pending'
            CHECK(status IN ('pending','processing','completed','rejected')),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          completed_at TEXT,
          operator_id INTEGER,
          note TEXT
        );
        CREATE INDEX idx_mp_data_requests_person
          ON mp_data_requests(status, person_id);
        CREATE UNIQUE INDEX idx_mp_data_requests_active_unique
          ON mp_data_requests(person_id, request_type)
          WHERE status='pending';
      \`);
      db.close();
    `, indexPath);
    assertCanonicalIndexes(inspectSchemaTwice(indexPath));
  });

  const alice = seedIdentity("alice");
  const bob = seedIdentity("bob");
  const request = createHarness();
  const createRequest = (token, requestType) =>
    request("POST", "/api/mp/data-requests", token, { requestType });
  const listMine = (token) =>
    request("GET", "/api/mp/data-requests/mine", token);

  await test("person OpenID 与 session OpenID 错绑时拒绝且零写入", async () => {
    const identity = seedIdentity("openid-mismatch");
    const wrongToken = seedSession({
      label: "openid-mismatch-session",
      doctorId: identity.doctorId,
      personId: identity.personId,
      patientId: identity.patientId,
      phoneBound: 1,
      openid: `wrong-${identity.openid}`
    });
    const before = db.prepare("SELECT COUNT(*) AS c FROM mp_data_requests").get().c;
    const result = await createRequest(wrongToken, "export");
    assert.equal(result.status, 403);
    assert.equal(result.body.error, "identity_mismatch");
    const after = db.prepare("SELECT COUNT(*) AS c FROM mp_data_requests").get().c;
    assert.equal(after, before);
  });

  await test("未认证、撤销、过期和未绑定会话被稳定拒绝", async () => {
    assert.deepEqual(await createRequest("", "export"), {
      status: 401,
      body: { error: "unauthorized" }
    });

    const revoked = seedSession({
      label: "revoked",
      doctorId: alice.doctorId,
      personId: alice.personId,
      patientId: alice.patientId,
      phoneBound: 1,
      revokedAt: iso()
    });
    assert.equal((await createRequest(revoked, "export")).status, 401);

    const expired = seedSession({
      label: "expired",
      doctorId: alice.doctorId,
      personId: alice.personId,
      patientId: alice.patientId,
      phoneBound: 1,
      expiresAt: iso(-60_000)
    });
    assert.equal((await createRequest(expired, "export")).status, 401);

    const unbound = seedSession({
      label: "unbound",
      doctorId: alice.doctorId
    });
    const unboundResult = await createRequest(unbound, "export");
    assert.equal(unboundResult.status, 403);
    assert.equal(unboundResult.body.error, "account_not_bound");
  });

  await test("关系错绑 fail closed 且不登记申请", async () => {
    const before = db.prepare("SELECT COUNT(*) AS c FROM mp_data_requests").get().c;
    const mismatched = seedSession({
      label: "mismatch",
      doctorId: alice.doctorId,
      personId: alice.personId,
      patientId: bob.patientId,
      phoneBound: 1,
      openid: alice.openid
    });
    const result = await createRequest(mismatched, "export");
    assert.equal(result.status, 403);
    assert.equal(result.body.error, "identity_mismatch");
    const after = db.prepare("SELECT COUNT(*) AS c FROM mp_data_requests").get().c;
    assert.equal(after, before);
    db.prepare("DELETE FROM mp_sessions WHERE token=?").run(mismatched);
  });

  await test("只接受 export 和 delete", async () => {
    for (const requestType of ["", "EXPORT", "erase", null, 123, {}]) {
      const result = await createRequest(alice.token, requestType);
      assert.equal(result.status, 400);
      assert.equal(result.body.error, "invalid_request_type");
    }
  });

  await test("parseBody 等待期间 token 轮换或撤销时旧请求零写入", async () => {
    for (const mode of ["rotated", "revoked"]) {
      const identity = seedIdentity(`race-${mode}`);
      const entered = deferred();
      const release = deferred();
      const raceRequest = createHarness({
        async parseBody(req) {
          entered.resolve();
          await release.promise;
          return req.body || {};
        }
      });
      const pending = raceRequest(
        "POST",
        "/api/mp/data-requests",
        identity.token,
        { requestType: "export" }
      );
      await entered.promise;
      if (mode === "rotated") {
        db.prepare(
          "UPDATE mp_sessions SET revoked_at=? WHERE openid=? AND revoked_at IS NULL"
        ).run(iso(), identity.openid);
        seedSession({
          label: "race-new",
          doctorId: identity.doctorId,
          personId: identity.personId,
          patientId: identity.patientId,
          phoneBound: 1,
          openid: identity.openid
        });
      } else {
        db.prepare(
          "UPDATE mp_sessions SET revoked_at=? WHERE token=?"
        ).run(iso(), identity.token);
      }
      release.resolve();
      const result = await pending;
      assert.equal(result.status, 401, mode);
      assert.equal(result.body.error, "unauthorized", mode);
      const count = db.prepare(`
        SELECT COUNT(*) AS c
        FROM mp_data_requests
        WHERE person_id=?
      `).get(identity.personId).c;
      assert.equal(count, 0, mode);
    }
  });

  let exportId;
  await test("首次创建返回 201，重复请求返回同一 active 项", async () => {
    const first = await createRequest(alice.token, "export");
    assert.equal(first.status, 201);
    assert.equal(first.body.request.status, "pending");
    assert.equal(first.body.request.requestType, "export");
    exportId = first.body.request.id;

    const second = await createRequest(alice.token, "export");
    assert.equal(second.status, 200);
    assert.equal(second.body.request.id, exportId);

    const count = db.prepare(`
      SELECT COUNT(*) AS c FROM mp_data_requests
      WHERE person_id=? AND request_type='export'
        AND status IN ('pending','processing')
    `).get(alice.personId).c;
    assert.equal(count, 1);
  });

  await test("两个独立进程并发创建时均成功且最终仅一条 active", async () => {
    const identity = seedIdentity("cross-process");
    const barrierDir = fs.mkdtempSync(
      path.join(os.tmpdir(), `mp-data-barrier-${process.pid}-`)
    );
    const releasePath = path.join(barrierDir, "release");
    const readyPaths = [
      path.join(barrierDir, "ready-1"),
      path.join(barrierDir, "ready-2")
    ];
    const childPromises = [];
    try {
      const first = spawnDataRequestChild(
        identity.token,
        readyPaths[0],
        releasePath
      );
      first.catch(() => {});
      childPromises.push(first);
      await waitForPaths([readyPaths[0]]);

      const second = spawnDataRequestChild(
        identity.token,
        readyPaths[1],
        releasePath
      );
      second.catch(() => {});
      childPromises.push(second);
      await waitForPaths([readyPaths[1]]);

      fs.writeFileSync(releasePath, "release");
      const results = await Promise.all(childPromises);
      assert.ok(
        results.every((result) => [200, 201].includes(result.status)),
        JSON.stringify(results)
      );
      assert.equal(results[0].body.request.id, results[1].body.request.id);
      const active = db.prepare(`
        SELECT id, status
        FROM mp_data_requests
        WHERE person_id=? AND request_type='export'
          AND status IN ('pending','processing')
      `).all(identity.personId);
      assert.equal(active.length, 1);
      assert.equal(active[0].id, results[0].body.request.id);
    } finally {
      if (!fs.existsSync(releasePath)) {
        fs.writeFileSync(releasePath, "release");
      }
      await Promise.allSettled(childPromises);
      fs.rmSync(barrierDir, { recursive: true, force: true });
    }
  });

  await test("export 与 delete 独立去重", async () => {
    const deletion = await createRequest(alice.token, "delete");
    assert.equal(deletion.status, 201);
    assert.equal(deletion.body.request.requestType, "delete");
    assert.notEqual(deletion.body.request.id, exportId);

    const duplicate = await createRequest(alice.token, "delete");
    assert.equal(duplicate.status, 200);
    assert.equal(duplicate.body.request.id, deletion.body.request.id);
  });

  await test("已完成申请允许后续创建新的同类型申请", async () => {
    db.prepare(`
      UPDATE mp_data_requests
      SET status='completed', completed_at=?, updated_at=?
      WHERE id=?
    `).run(iso(), iso(), exportId);
    const next = await createRequest(alice.token, "export");
    assert.equal(next.status, 201);
    assert.notEqual(next.body.request.id, exportId);
  });

  await test("mine 仅返回当前 person、稳定排序、限量和字段白名单", async () => {
    const bobRequest = await createRequest(bob.token, "export");
    assert.equal(bobRequest.status, 201);
    db.prepare(`
      UPDATE mp_data_requests
      SET created_at='2020-01-01T00:00:00.000Z',
          updated_at='2020-01-01T00:00:00.000Z'
      WHERE id=?
    `).run(bobRequest.body.request.id);

    const mine = await listMine(alice.token);
    assert.equal(mine.status, 200);
    assert.equal(mine.body.ok, true);
    assert.ok(Array.isArray(mine.body.items));
    assert.ok(mine.body.items.length >= 3);
    assert.ok(mine.body.items.length <= 100);
    assert.ok(
      mine.body.items.every(
        (item) =>
          !Object.prototype.hasOwnProperty.call(item, "personId") &&
          !Object.prototype.hasOwnProperty.call(item, "patientId") &&
          !Object.prototype.hasOwnProperty.call(item, "doctorId") &&
          !Object.prototype.hasOwnProperty.call(item, "openid") &&
          !Object.prototype.hasOwnProperty.call(item, "token") &&
          !Object.prototype.hasOwnProperty.call(item, "phone") &&
          !Object.prototype.hasOwnProperty.call(item, "operatorId") &&
          !Object.prototype.hasOwnProperty.call(item, "note") &&
          !Object.prototype.hasOwnProperty.call(item, "internalNote")
      )
    );
    const allowed = [
      "id",
      "requestType",
      "status",
      "createdAt",
      "updatedAt",
      "completedAt"
    ].sort();
    for (const item of mine.body.items) {
      assert.deepEqual(Object.keys(item).sort(), allowed);
    }
    assert.ok(
      mine.body.items.every((item) => item.id !== bobRequest.body.request.id),
      "不得返回其他 person 的申请"
    );
    const sortKeys = mine.body.items.map(
      (item) => `${item.createdAt}|${String(item.id).padStart(20, "0")}`
    );
    assert.deepEqual(sortKeys, [...sortKeys].sort().reverse());
  });

  await test("GET 同样拒绝非法 Bearer、未绑定和关系错绑", async () => {
    assert.equal((await listMine("not-a-session")).status, 401);
    const unbound = seedSession({
      label: "list-unbound",
      doctorId: alice.doctorId
    });
    assert.equal((await listMine(unbound)).status, 403);

    const mismatch = seedSession({
      label: "list-mismatch",
      doctorId: alice.doctorId,
      personId: alice.personId,
      patientId: bob.patientId,
      phoneBound: 1,
      openid: alice.openid
    });
    const result = await listMine(mismatch);
    assert.equal(result.status, 403);
    assert.equal(result.body.error, "identity_mismatch");
    db.prepare("DELETE FROM mp_sessions WHERE token=?").run(mismatch);
  });

  await test("路由只登记请求，不修改患者或人员数据", async () => {
    const personBefore = db.prepare("SELECT * FROM persons WHERE id=?").get(alice.personId);
    const patientBefore = db.prepare("SELECT * FROM patients WHERE id=?").get(alice.patientId);
    await createRequest(alice.token, "delete");
    assert.deepEqual(
      db.prepare("SELECT * FROM persons WHERE id=?").get(alice.personId),
      personBefore
    );
    assert.deepEqual(
      db.prepare("SELECT * FROM patients WHERE id=?").get(alice.patientId),
      patientBefore
    );
  });

  if (failures.length) {
    throw new Error(
      `${failures.length} mp data request test(s) failed: ` +
      failures.map((item) => item.name).join(", ")
    );
  }
  console.log("PASS: mp data request security and idempotency checks");
}

main()
  .catch((error) => {
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
  })
  .finally(() => {
    try {
      db.close();
    } catch (error) {}
    for (const dbPath of temporaryDbPaths) cleanupDatabase(dbPath);
  });
