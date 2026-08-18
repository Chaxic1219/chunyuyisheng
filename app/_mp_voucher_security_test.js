"use strict";

const assert = require("assert");
const { spawnSync } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const runId = `${process.pid}-${crypto.randomBytes(6).toString("hex")}`;
process.env.DB_PATH = path.join(os.tmpdir(), `mp-voucher-${runId}.db`);
process.env.PRIVATE_UPLOAD_DIR = path.join(os.tmpdir(), `mp-voucher-files-${runId}`);
process.env.MP_AUTH_STUB = "1";
const schemaDbPath = path.join(os.tmpdir(), `mp-voucher-schema-${runId}.db`);

const { db } = require("./db.js");
const mpAuth = require("./mp_auth.js");
const {
  registerPatientPublicRoutes,
  VOUCHER_UPLOAD_LIMIT,
  VOUCHER_DOWNLOAD_LIMIT,
  VOUCHER_PENDING_MAX_AGE_MS,
  VOUCHER_UNCLAIMED_MAX_AGE_MS,
  VOUCHER_CLEANUP_INTERVAL_MS,
  VOUCHER_CLEANUP_BATCH_SIZE
} = require("./routes/patient-public.js");

const privateVoucherDir = path.join(process.env.PRIVATE_UPLOAD_DIR, "patient-vouchers");
const publicVoucherDir = path.join(__dirname, "public", "uploads", "patient-vouchers");

function removePath(target, options = {}) {
  try {
    fs.rmSync(target, { force: false, ...options });
  } catch (error) {
    if (!error || error.code !== "ENOENT") throw error;
  }
}

function listFiles(directory) {
  try {
    return fs.readdirSync(directory).sort();
  } catch (error) {
    if (error && error.code === "ENOENT") return [];
    throw error;
  }
}

function directorySnapshot(directory) {
  const root = path.resolve(directory);
  const entries = {};
  let rootExists = true;
  let rootMetadata = null;
  try {
    const stat = fs.lstatSync(root);
    rootMetadata = {
      type: stat.isSymbolicLink()
        ? "symlink"
        : stat.isDirectory()
          ? "directory"
          : "file",
      mode: stat.mode,
      size: stat.size,
      mtimeMs: stat.mtimeMs
    };
  } catch (error) {
    if (error && error.code === "ENOENT") rootExists = false;
    else throw error;
  }
  if (!rootExists) return { rootExists, rootMetadata, entries };

  function walk(current, relative) {
    const names = fs.readdirSync(current).sort();
    for (const name of names) {
      const absolute = path.join(current, name);
      const childRelative = relative ? path.join(relative, name) : name;
      const normalized = childRelative.split(path.sep).join("/");
      const stat = fs.lstatSync(absolute);
      if (stat.isSymbolicLink()) {
        entries[normalized] = {
          type: "symlink",
          mode: stat.mode,
          size: stat.size,
          mtimeMs: stat.mtimeMs,
          target: fs.readlinkSync(absolute)
        };
      } else if (stat.isDirectory()) {
        entries[normalized] = {
          type: "directory",
          mode: stat.mode,
          mtimeMs: stat.mtimeMs
        };
        walk(absolute, childRelative);
      } else {
        const content = fs.readFileSync(absolute);
        entries[normalized] = {
          type: "file",
          mode: stat.mode,
          size: stat.size,
          mtimeMs: stat.mtimeMs,
          sha256: crypto.createHash("sha256").update(content).digest("hex")
        };
      }
    }
  }

  walk(root, "");
  return { rootExists, rootMetadata, entries };
}

function inspectSchemaInChild(dbPath) {
  const script = `
    const { db } = require("./db.js");
    setImmediate(() => {
      const result = {
        columns: db.prepare("PRAGMA table_info(mp_private_files)").all().map((row) => ({
          name: row.name,
          type: row.type,
          notnull: row.notnull,
          pk: row.pk
        })),
        indexes: db.prepare("PRAGMA index_list(mp_private_files)").all().map((row) => row.name).sort()
      };
      console.log("__VOUCHER_SCHEMA__" + JSON.stringify(result));
      db.close();
    });
  `;
  const child = spawnSync(process.execPath, ["-e", script], {
    cwd: __dirname,
    env: { ...process.env, DB_PATH: dbPath },
    encoding: "utf8",
    timeout: 20_000
  });
  if (child.error) throw child.error;
  assert.equal(child.status, 0, child.stderr || child.stdout);
  const marker = String(child.stdout || "")
    .split(/\r?\n/)
    .find((line) => line.startsWith("__VOUCHER_SCHEMA__"));
  assert.ok(marker, "schema child did not return inspection result");
  return JSON.parse(marker.slice("__VOUCHER_SCHEMA__".length));
}

function inspectLegacyMigrationInChild(dbPath) {
  const script = `
    const { DatabaseSync } = require("node:sqlite");
    const seeded = new DatabaseSync(process.env.DB_PATH);
    seeded.exec(\`CREATE TABLE mp_private_files (
      id TEXT PRIMARY KEY,
      doctor_id INTEGER NOT NULL,
      person_id INTEGER NOT NULL,
      patient_id INTEGER NOT NULL,
      storage_name TEXT NOT NULL UNIQUE,
      original_name TEXT,
      mime TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'ready'
    )\`);
    const insert = seeded.prepare(\`INSERT INTO mp_private_files(
      id,doctor_id,person_id,patient_id,storage_name,mime,size_bytes,created_at,state
    ) VALUES(?,?,?,?,?,?,?,?,?)\`);
    insert.run("legacy-ready",1,1,1,"legacy-ready.pdf","application/pdf",10,
      "2025-01-01T00:00:00.000Z","ready");
    insert.run("legacy-pending",1,1,1,"legacy-pending.pdf","application/pdf",10,
      "2025-01-01T00:00:00.000Z","pending");
    seeded.close();
    const { db } = require("./db.js");
    setImmediate(() => {
      const rows = db.prepare(
        "SELECT id,state,claimed_at FROM mp_private_files ORDER BY id"
      ).all();
      console.log("__VOUCHER_MIGRATION__" + JSON.stringify(rows));
      db.close();
    });
  `;
  const child = spawnSync(process.execPath, ["-e", script], {
    cwd: __dirname,
    env: { ...process.env, DB_PATH: dbPath },
    encoding: "utf8",
    timeout: 20_000
  });
  if (child.error) throw child.error;
  assert.equal(child.status, 0, child.stderr || child.stdout);
  const marker = String(child.stdout || "")
    .split(/\r?\n/)
    .find((line) => line.startsWith("__VOUCHER_MIGRATION__"));
  assert.ok(marker, "legacy migration child did not return inspection result");
  return JSON.parse(marker.slice("__VOUCHER_MIGRATION__".length));
}

const publicSnapshotBefore = directorySnapshot(publicVoucherDir);

function dataUrl(mime, bytes) {
  return `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
}

const validFiles = {
  "image/jpeg": Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x01]),
  "image/png": Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00
  ]),
  "image/webp": Buffer.from("52494646010000005745425000", "hex"),
  "application/pdf": Buffer.from("%PDF-1.7\n%%EOF", "ascii")
};

function createManualTimerRegistry() {
  const handles = [];
  return {
    handles,
    setInterval(callback, intervalMs) {
      const handle = {
        callback,
        intervalMs,
        unrefCalled: false,
        cleared: false,
        unref() {
          this.unrefCalled = true;
        }
      };
      handles.push(handle);
      return handle;
    },
    clearInterval(handle) {
      handle.cleared = true;
    },
    async tick(handle) {
      assert.equal(handle.cleared, false, "已 dispose 的 timer 不得再触发");
      await handle.callback();
    }
  };
}

function createHarness(options = {}) {
  const routes = [];
  const gateCalls = [];
  const timerRegistry = options.timerRegistry || createManualTimerRegistry();
  const lifecycle = registerPatientPublicRoutes(
    (method, pattern, handler) => routes.push({ method, pattern, handler }),
    {
      parseBody: options.parseBody || (async (req) => req.body || {}),
      json: (res, status, body) => {
        res.status = status;
        res.body = body;
      },
      gate(req, res, doctorId) {
        gateCalls.push(doctorId);
        const allowed = doctorId == null
          ? !!options.adminAllowed
          : options.doctorAllowed == null
            ? !!options.adminAllowed
            : !!options.doctorAllowed;
        if (allowed) return { adminId: 1 };
        res.status = options.adminStatus || 403;
        res.body = { error: "admin_forbidden" };
        return null;
      },
      db,
      MESSAGE_MAX_BODY: 7 * 1024 * 1024,
      SMS_DEMO: true,
      voucherNow: options.voucherNow,
      voucherPendingMaxAgeMs: options.voucherPendingMaxAgeMs,
      voucherUnclaimedMaxAgeMs: options.voucherUnclaimedMaxAgeMs,
      voucherCleanupIntervalMs: options.voucherCleanupIntervalMs,
      voucherSetInterval: timerRegistry.setInterval.bind(timerRegistry),
      voucherClearInterval: timerRegistry.clearInterval.bind(timerRegistry)
    }
  );

  function find(method, pathname) {
    const route = routes.find(
      (item) => item.method === method && pathname.match(item.pattern)
    );
    assert.ok(route, `missing route ${method} ${pathname}`);
    return route;
  }

  function response() {
    return {
      headers: {},
      status: null,
      body: null,
      payload: null,
      setHeader(name, value) {
        this.headers[String(name).toLowerCase()] = String(value);
      },
      end(payload) {
        this.payload = payload == null ? Buffer.alloc(0) : Buffer.from(payload);
      }
    };
  }

  async function request(method, pathname, requestOptions = {}) {
    const route = find(method, pathname);
    const authorization = Object.prototype.hasOwnProperty.call(
      requestOptions,
      "authorization"
    )
      ? requestOptions.authorization
      : requestOptions.token
        ? `Bearer ${requestOptions.token}`
        : "";
    const req = {
      body: requestOptions.body || {},
      headers: authorization ? { authorization } : {},
      socket: { remoteAddress: requestOptions.ip || "10.0.0.10" }
    };
    const res = response();
    await route.handler(req, res, pathname.match(route.pattern), {});
    return res;
  }

  return {
    request,
    gateCalls,
    timerRegistry,
    dispose: async () => {
      if (lifecycle && typeof lifecycle.dispose === "function") {
        await lifecycle.dispose();
      }
    }
  };
}

async function test(name, fn) {
  await fn();
  console.log("ok -", name);
}

function sessionIds(token) {
  const session = mpAuth.requireSession(token);
  return {
    doctorId: +session.doctor_id,
    personId: +session.person_id,
    patientId: +session.patient_id
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

async function createBoundSession(doctorId, phone, label) {
  const login = await mpAuth.login({
    code: `voucher-${label}-${runId}`,
    doctorId
  });
  const bound = await mpAuth.bindPhone({
    token: login.mpToken,
    phone,
    smsCode: "000000",
    doctorId
  });
  return { ...bound, ids: sessionIds(bound.mpToken) };
}

async function main() {
  try {
    await test("两个独立 Node 进程对同一 DB 幂等创建私有文件 schema", () => {
      const expected = {
        columns: [
          { name: "id", type: "TEXT", notnull: 0, pk: 1 },
          { name: "doctor_id", type: "INTEGER", notnull: 1, pk: 0 },
          { name: "person_id", type: "INTEGER", notnull: 1, pk: 0 },
          { name: "patient_id", type: "INTEGER", notnull: 1, pk: 0 },
          { name: "storage_name", type: "TEXT", notnull: 1, pk: 0 },
          { name: "original_name", type: "TEXT", notnull: 0, pk: 0 },
          { name: "mime", type: "TEXT", notnull: 1, pk: 0 },
          { name: "size_bytes", type: "INTEGER", notnull: 1, pk: 0 },
          { name: "created_at", type: "TEXT", notnull: 1, pk: 0 },
          { name: "state", type: "TEXT", notnull: 1, pk: 0 },
          { name: "claimed_at", type: "TEXT", notnull: 0, pk: 0 }
        ],
        indexes: [
          "idx_mp_private_files_patient_created",
          "idx_mp_private_files_state_created",
          "idx_mp_private_files_unclaimed_created",
          "sqlite_autoindex_mp_private_files_1",
          "sqlite_autoindex_mp_private_files_2"
        ]
      };
      const first = inspectSchemaInChild(schemaDbPath);
      const second = inspectSchemaInChild(schemaDbPath);
      assert.deepStrictEqual(first, expected);
      assert.deepStrictEqual(second, expected);
      assert.equal(VOUCHER_UPLOAD_LIMIT, 10);
      assert.equal(VOUCHER_DOWNLOAD_LIMIT, 60);
      assert.equal(VOUCHER_PENDING_MAX_AGE_MS, 15 * 60 * 1000);
      assert.equal(VOUCHER_UNCLAIMED_MAX_AGE_MS, 24 * 60 * 60 * 1000);
      assert.equal(VOUCHER_CLEANUP_INTERVAL_MS, 60 * 60 * 1000);
      assert.equal(VOUCHER_CLEANUP_BATCH_SIZE, 100);
    });

    await test("历史 ready 迁移为已认领，历史 pending 保持未认领", () => {
      const legacyDbPath = path.join(
        os.tmpdir(),
        `mp-voucher-legacy-${runId}.db`
      );
      try {
        const rows = inspectLegacyMigrationInChild(legacyDbPath);
        assert.equal(rows[0].id, "legacy-pending");
        assert.equal(rows[0].claimed_at, null);
        assert.equal(rows[1].id, "legacy-ready");
        assert.ok(rows[1].claimed_at, "历史 ready 必须视为已认领，避免误删");
      } finally {
        removePath(legacyDbPath);
        removePath(legacyDbPath + "-shm");
        removePath(legacyDbPath + "-wal");
      }
    });

    const doctor = db.prepare("SELECT id FROM doctors ORDER BY id LIMIT 1").get();
    assert.ok(doctor && doctor.id, "需要医生 seed");
    db.prepare("UPDATE doctors SET active=1 WHERE id=?").run(doctor.id);
    const secondDoctorId = +db.prepare(
      "INSERT INTO doctors(slug,name,active) VALUES(?,?,1)"
    ).run(`voucher-doctor-${runId}`, "Voucher Doctor").lastInsertRowid;

    const owner = await createBoundSession(
      doctor.id,
      "13800138401",
      "owner"
    );
    const otherPatient = await createBoundSession(
      doctor.id,
      "13800138402",
      "other"
    );
    const unbound = await mpAuth.login({
      code: `voucher-unbound-${runId}`,
      doctorId: doctor.id
    });

    await test("匿名、无效 token、未绑定和医生不匹配均拒绝上传", async () => {
      const harness = createHarness();
      const body = {
        doctorId: doctor.id,
        originalName: "proof.pdf",
        dataUrl: dataUrl("application/pdf", validFiles["application/pdf"])
      };
      const anonymous = await harness.request(
        "POST",
        "/api/patient/voucher-upload",
        { body, ip: "10.0.0.11" }
      );
      assert.deepStrictEqual(
        { status: anonymous.status, body: anonymous.body },
        { status: 401, body: { error: "unauthorized" } }
      );

      const invalid = await harness.request(
        "POST",
        "/api/patient/voucher-upload",
        { body, token: "invalid-token", ip: "10.0.0.12" }
      );
      assert.deepStrictEqual(
        { status: invalid.status, body: invalid.body },
        { status: 401, body: { error: "unauthorized" } }
      );

      const incomplete = await harness.request(
        "POST",
        "/api/patient/voucher-upload",
        { body, token: unbound.mpToken, ip: "10.0.0.13" }
      );
      assert.deepStrictEqual(
        { status: incomplete.status, body: incomplete.body },
        { status: 403, body: { error: "patient_binding_required" } }
      );

      const mismatch = await harness.request(
        "POST",
        "/api/patient/voucher-upload",
        {
          body: { ...body, doctorId: secondDoctorId },
          token: owner.mpToken,
          ip: "10.0.0.14"
        }
      );
      assert.deepStrictEqual(
        { status: mismatch.status, body: mismatch.body },
        { status: 403, body: { error: "doctor_mismatch" } }
      );
    });

    await test("现存未过期 session 的任一绑定字段异常均返回 403", async () => {
      const original = db.prepare(
        `SELECT phone_bound,doctor_id,person_id,patient_id
         FROM mp_sessions WHERE token=?`
      ).get(owner.mpToken);
      const cases = [
        { ...original, phone_bound: 0 },
        { ...original, doctor_id: 0 },
        { ...original, person_id: null },
        { ...original, patient_id: -1 }
      ];
      try {
        for (let index = 0; index < cases.length; index += 1) {
          const item = cases[index];
          db.prepare(`UPDATE mp_sessions SET
            phone_bound=?,doctor_id=?,person_id=?,patient_id=? WHERE token=?`
          ).run(
            item.phone_bound,
            item.doctor_id,
            item.person_id,
            item.patient_id,
            owner.mpToken
          );
          const res = await createHarness().request(
            "POST",
            "/api/patient/voucher-upload",
            {
              token: owner.mpToken,
              ip: `10.0.1.${index + 1}`,
              body: {
                doctorId: doctor.id,
                dataUrl: dataUrl("application/pdf", validFiles["application/pdf"])
              }
            }
          );
          assert.deepStrictEqual(
            { status: res.status, body: res.body },
            { status: 403, body: { error: "patient_binding_required" } }
          );
        }
      } finally {
        db.prepare(`UPDATE mp_sessions SET
          phone_bound=?,doctor_id=?,person_id=?,patient_id=? WHERE token=?`
        ).run(
          original.phone_bound,
          original.doctor_id,
          original.person_id,
          original.patient_id,
          owner.mpToken
        );
      }
    });

    await test("JPEG/PNG/WebP/PDF 按真实魔数保存到 private 目录", async () => {
      let counter = 20;
      for (const [mime, bytes] of Object.entries(validFiles)) {
        const harness = createHarness();
        const res = await harness.request(
          "POST",
          "/api/patient/voucher-upload",
          {
            token: owner.mpToken,
            ip: `10.0.0.${counter++}`,
            body: {
              doctorId: String(doctor.id),
              originalName: `unsafe\r\nname-${mime}`,
              dataUrl: dataUrl(mime, bytes)
            }
          }
        );
        assert.equal(res.status, 200);
        assert.equal(res.body.ok, true);
        assert.equal(res.body.mime, mime);
        assert.match(res.body.fileId, /^[A-Za-z0-9_-]+$/);
        assert.equal(res.body.url, `/api/patient/voucher/${res.body.fileId}`);
        assert.ok(!Object.hasOwn(res.body, "storage_name"));
        assert.ok(!JSON.stringify(res.body).includes(process.env.PRIVATE_UPLOAD_DIR));

        const row = db.prepare(
          "SELECT * FROM mp_private_files WHERE id=?"
        ).get(res.body.fileId);
        assert.equal(row.doctor_id, owner.ids.doctorId);
        assert.equal(row.person_id, owner.ids.personId);
        assert.equal(row.patient_id, owner.ids.patientId);
        assert.equal(row.mime, mime);
        assert.equal(row.size_bytes, bytes.length);
        assert.equal(row.state, "ready");
        assert.equal(row.claimed_at, null);
        assert.ok(fs.existsSync(path.join(privateVoucherDir, row.storage_name)));
        assert.ok(!fs.existsSync(path.join(publicVoucherDir, row.storage_name)));
      }
    });

    await test("严格 base64、真实格式和 4MB 边界校验", async () => {
      const harness = createHarness();
      const cases = [
        "data:image/png;base64,AAAA====",
        "data:image/png;base64,AA A=",
        dataUrl("image/png", validFiles["application/pdf"]),
        "data:image/gif;base64,R0lGODlh"
      ];
      let counter = 30;
      for (const invalidDataUrl of cases) {
        const res = await harness.request(
          "POST",
          "/api/patient/voucher-upload",
          {
            token: owner.mpToken,
            ip: `10.0.0.${counter++}`,
            body: { doctorId: doctor.id, dataUrl: invalidDataUrl }
          }
        );
        assert.deepStrictEqual(
          { status: res.status, body: res.body },
          { status: 400, body: { error: "invalid_voucher_file" } }
        );
      }

      const over = Buffer.alloc(4 * 1024 * 1024 + 1, 0);
      validFiles["image/jpeg"].copy(over, 0);
      const oversized = await harness.request(
        "POST",
        "/api/patient/voucher-upload",
        {
          token: owner.mpToken,
          ip: "10.0.0.35",
          body: {
            doctorId: doctor.id,
            dataUrl: dataUrl("image/jpeg", over)
          }
        }
      );
      assert.deepStrictEqual(
        { status: oversized.status, body: oversized.body },
        { status: 413, body: { error: "voucher_too_large" } }
      );
    });

    await test("注册时清理陈旧 pending，保留进行中的 pending 且均不可下载", async () => {
      const recoveryNow = Date.parse("2026-07-31T12:00:00.000Z");
      const staleId = `stale-${runId}`;
      const recentId = `recent-${runId}`;
      const staleStorage = `${staleId}.pdf`;
      const recentStorage = `${recentId}.pdf`;
      const staleFinal = path.join(privateVoucherDir, staleStorage);
      const staleTemp = path.join(privateVoucherDir, `.${staleStorage}.tmp`);
      const recentFinal = path.join(privateVoucherDir, recentStorage);
      const recentTemp = path.join(privateVoucherDir, `.${recentStorage}.tmp`);
      fs.mkdirSync(privateVoucherDir, { recursive: true });
      for (const target of [staleFinal, staleTemp, recentFinal, recentTemp]) {
        fs.writeFileSync(target, validFiles["application/pdf"]);
      }
      const insertPending = db.prepare(`INSERT INTO mp_private_files(
        id,doctor_id,person_id,patient_id,storage_name,original_name,mime,
        size_bytes,created_at,state
      ) VALUES(?,?,?,?,?,?,?,?,?,?)`);
      insertPending.run(
        staleId,
        owner.ids.doctorId,
        owner.ids.personId,
        owner.ids.patientId,
        staleStorage,
        "stale.pdf",
        "application/pdf",
        validFiles["application/pdf"].length,
        new Date(recoveryNow - VOUCHER_PENDING_MAX_AGE_MS - 1).toISOString(),
        "pending"
      );
      insertPending.run(
        recentId,
        owner.ids.doctorId,
        owner.ids.personId,
        owner.ids.patientId,
        recentStorage,
        "recent.pdf",
        "application/pdf",
        validFiles["application/pdf"].length,
        new Date(recoveryNow - VOUCHER_PENDING_MAX_AGE_MS + 1).toISOString(),
        "pending"
      );

      const harness = createHarness({ voucherNow: () => recoveryNow });
      try {
        const staleRead = await harness.request(
          "GET",
          `/api/patient/voucher/${staleId}`,
          { token: owner.mpToken, ip: "10.0.0.36" }
        );
        assert.deepStrictEqual(
          { status: staleRead.status, body: staleRead.body },
          { status: 404, body: { error: "not_found" } }
        );
        assert.equal(
          db.prepare("SELECT 1 FROM mp_private_files WHERE id=?").get(staleId),
          undefined
        );
        assert.equal(fs.existsSync(staleFinal), false);
        assert.equal(fs.existsSync(staleTemp), false);

        const recentRead = await harness.request(
          "GET",
          `/api/patient/voucher/${recentId}`,
          { token: owner.mpToken, ip: "10.0.0.37" }
        );
        assert.deepStrictEqual(
          { status: recentRead.status, body: recentRead.body },
          { status: 404, body: { error: "not_found" } }
        );
        assert.ok(db.prepare(
          "SELECT 1 FROM mp_private_files WHERE id=? AND state='pending'"
        ).get(recentId));
        assert.equal(fs.existsSync(recentFinal), true);
        assert.equal(fs.existsSync(recentTemp), true);
      } finally {
        db.prepare("DELETE FROM mp_private_files WHERE id IN (?,?)")
          .run(staleId, recentId);
        for (const target of [staleFinal, staleTemp, recentFinal, recentTemp]) {
          removePath(target);
        }
      }
    });

    await test("pending 清理 unlink 失败时保留锚点并在下次注册重试", async () => {
      const recoveryNow = Date.parse("2026-07-31T13:00:00.000Z");
      const fileId = `retry-stale-${runId}`;
      const storageName = `${fileId}.pdf`;
      const finalPath = path.join(privateVoucherDir, storageName);
      const tempPath = path.join(privateVoucherDir, `.${storageName}.tmp`);
      fs.mkdirSync(privateVoucherDir, { recursive: true });
      fs.writeFileSync(finalPath, validFiles["application/pdf"]);
      fs.writeFileSync(tempPath, validFiles["application/pdf"]);
      db.prepare(`INSERT INTO mp_private_files(
        id,doctor_id,person_id,patient_id,storage_name,original_name,mime,
        size_bytes,created_at,state
      ) VALUES(?,?,?,?,?,?,?,?,?,?)`).run(
        fileId,
        owner.ids.doctorId,
        owner.ids.personId,
        owner.ids.patientId,
        storageName,
        "retry.pdf",
        "application/pdf",
        validFiles["application/pdf"].length,
        new Date(recoveryNow - VOUCHER_PENDING_MAX_AGE_MS - 1).toISOString(),
        "pending"
      );

      const originalUnlink = fs.promises.unlink;
      const originalConsoleError = console.error;
      const logs = [];
      let injected = false;
      fs.promises.unlink = async (target) => {
        if (!injected && path.resolve(target) === path.resolve(finalPath)) {
          injected = true;
          const error = new Error("forced_unlink_failure");
          error.code = "EACCES";
          throw error;
        }
        return originalUnlink.call(fs.promises, target);
      };
      console.error = (...args) => logs.push(args.map(String).join(" "));
      try {
        const first = createHarness({ voucherNow: () => recoveryNow });
        const firstRead = await first.request(
          "GET",
          `/api/patient/voucher/${fileId}`,
          { token: owner.mpToken, ip: "10.0.0.38" }
        );
        assert.deepStrictEqual(
          { status: firstRead.status, body: firstRead.body },
          { status: 404, body: { error: "not_found" } }
        );
      } finally {
        fs.promises.unlink = originalUnlink;
        console.error = originalConsoleError;
      }
      assert.ok(db.prepare(
        "SELECT 1 FROM mp_private_files WHERE id=? AND state='pending'"
      ).get(fileId));
      assert.equal(fs.existsSync(finalPath), true);
      assert.equal(fs.existsSync(tempPath), false);
      assert.deepStrictEqual(logs, ["[patient/voucher-recovery] cleanup_failed"]);

      const retry = createHarness({ voucherNow: () => recoveryNow });
      const retryRead = await retry.request(
        "GET",
        `/api/patient/voucher/${fileId}`,
        { token: owner.mpToken, ip: "10.0.0.39" }
      );
      assert.deepStrictEqual(
        { status: retryRead.status, body: retryRead.body },
        { status: 404, body: { error: "not_found" } }
      );
      assert.equal(
        db.prepare("SELECT 1 FROM mp_private_files WHERE id=?").get(fileId),
        undefined
      );
      assert.equal(fs.existsSync(finalPath), false);
      assert.equal(fs.existsSync(tempPath), false);
    });

    await test("注册时回收超过 24h 的 unclaimed ready，已认领 ready 不误删", async () => {
      const recoveryNow = Date.parse("2026-07-31T14:00:00.000Z");
      const staleId = `stale-ready-${runId}`;
      const claimedId = `claimed-ready-${runId}`;
      const staleStorage = `${staleId}.pdf`;
      const claimedStorage = `${claimedId}.pdf`;
      fs.mkdirSync(privateVoucherDir, { recursive: true });
      fs.writeFileSync(path.join(privateVoucherDir, staleStorage), validFiles["application/pdf"]);
      fs.writeFileSync(path.join(privateVoucherDir, claimedStorage), validFiles["application/pdf"]);
      const insert = db.prepare(`INSERT INTO mp_private_files(
        id,doctor_id,person_id,patient_id,storage_name,original_name,mime,
        size_bytes,created_at,state,claimed_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?)`);
      const createdAt = new Date(
        recoveryNow - VOUCHER_UNCLAIMED_MAX_AGE_MS - 1
      ).toISOString();
      insert.run(
        staleId, owner.ids.doctorId, owner.ids.personId, owner.ids.patientId,
        staleStorage, "stale.pdf", "application/pdf",
        validFiles["application/pdf"].length, createdAt, "ready", null
      );
      insert.run(
        claimedId, owner.ids.doctorId, owner.ids.personId, owner.ids.patientId,
        claimedStorage, "claimed.pdf", "application/pdf",
        validFiles["application/pdf"].length, createdAt, "ready", createdAt
      );

      const harness = createHarness({ voucherNow: () => recoveryNow });
      await harness.request(
        "GET",
        `/api/patient/voucher/${staleId}`,
        { token: owner.mpToken, ip: "10.0.0.391" }
      );
      assert.equal(
        db.prepare("SELECT 1 FROM mp_private_files WHERE id=?").get(staleId),
        undefined
      );
      assert.equal(fs.existsSync(path.join(privateVoucherDir, staleStorage)), false);
      assert.ok(
        db.prepare("SELECT 1 FROM mp_private_files WHERE id=?").get(claimedId)
      );
      assert.equal(fs.existsSync(path.join(privateVoucherDir, claimedStorage)), true);

      db.prepare("DELETE FROM mp_private_files WHERE id=?").run(claimedId);
      removePath(path.join(privateVoucherDir, claimedStorage));
    });

    await test("每次上传前主动回收过期 unclaimed ready，不依赖进程重启", async () => {
      const recoveryNow = Date.parse("2026-07-31T15:00:00.000Z");
      const fileId = `before-upload-${runId}`;
      const storageName = `${fileId}.pdf`;
      const finalPath = path.join(privateVoucherDir, storageName);
      const harness = createHarness({ voucherNow: () => recoveryNow });
      await new Promise((resolve) => setImmediate(resolve));
      fs.mkdirSync(privateVoucherDir, { recursive: true });
      fs.writeFileSync(finalPath, validFiles["application/pdf"]);
      db.prepare(`INSERT INTO mp_private_files(
        id,doctor_id,person_id,patient_id,storage_name,original_name,mime,
        size_bytes,created_at,state,claimed_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,NULL)`).run(
        fileId,
        owner.ids.doctorId,
        owner.ids.personId,
        owner.ids.patientId,
        storageName,
        "expired.pdf",
        "application/pdf",
        validFiles["application/pdf"].length,
        new Date(recoveryNow - VOUCHER_UNCLAIMED_MAX_AGE_MS - 1).toISOString(),
        "ready"
      );

      const uploaded = await harness.request(
        "POST",
        "/api/patient/voucher-upload",
        {
          token: owner.mpToken,
          ip: "10.0.0.392",
          body: {
            doctorId: doctor.id,
            dataUrl: dataUrl("application/pdf", validFiles["application/pdf"])
          }
        }
      );
      assert.equal(uploaded.status, 200);
      assert.equal(
        db.prepare("SELECT 1 FROM mp_private_files WHERE id=?").get(fileId),
        undefined
      );
      assert.equal(fs.existsSync(finalPath), false);
    });

    await test("unclaimed ready 删除失败时保留元数据锚点供下次重试", async () => {
      const recoveryNow = Date.parse("2026-07-31T16:00:00.000Z");
      const fileId = `ready-retry-${runId}`;
      const storageName = `${fileId}.pdf`;
      const finalPath = path.join(privateVoucherDir, storageName);
      fs.mkdirSync(privateVoucherDir, { recursive: true });
      fs.writeFileSync(finalPath, validFiles["application/pdf"]);
      db.prepare(`INSERT INTO mp_private_files(
        id,doctor_id,person_id,patient_id,storage_name,original_name,mime,
        size_bytes,created_at,state,claimed_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,NULL)`).run(
        fileId,
        owner.ids.doctorId,
        owner.ids.personId,
        owner.ids.patientId,
        storageName,
        "retry.pdf",
        "application/pdf",
        validFiles["application/pdf"].length,
        new Date(recoveryNow - VOUCHER_UNCLAIMED_MAX_AGE_MS - 1).toISOString(),
        "ready"
      );
      const originalUnlink = fs.promises.unlink;
      fs.promises.unlink = async (target) => {
        if (path.resolve(target) === path.resolve(finalPath)) {
          const error = new Error("forced_unlink_failure");
          error.code = "EACCES";
          throw error;
        }
        return originalUnlink.call(fs.promises, target);
      };
      try {
        const harness = createHarness({ voucherNow: () => recoveryNow });
        await harness.request(
          "GET",
          `/api/patient/voucher/${fileId}`,
          { token: owner.mpToken, ip: "10.0.0.393" }
        );
      } finally {
        fs.promises.unlink = originalUnlink;
      }
      assert.ok(
        db.prepare(
          "SELECT 1 FROM mp_private_files WHERE id=? AND claimed_at IS NULL"
        ).get(fileId)
      );
      assert.equal(fs.existsSync(finalPath), true);

      const retry = createHarness({ voucherNow: () => recoveryNow });
      await retry.request(
        "GET",
        `/api/patient/voucher/${fileId}`,
        { token: owner.mpToken, ip: "10.0.0.394" }
      );
      assert.equal(
        db.prepare("SELECT 1 FROM mp_private_files WHERE id=?").get(fileId),
        undefined
      );
    });

    await test("无新上传时，时间推进后由周期任务回收过期 unclaimed ready", async () => {
      let recoveryNow = Date.parse("2026-07-31T17:00:00.000Z");
      const fileId = `periodic-${runId}`;
      const storageName = `${fileId}.pdf`;
      const finalPath = path.join(privateVoucherDir, storageName);
      fs.mkdirSync(privateVoucherDir, { recursive: true });
      fs.writeFileSync(finalPath, validFiles["application/pdf"]);
      db.prepare(`INSERT INTO mp_private_files(
        id,doctor_id,person_id,patient_id,storage_name,original_name,mime,
        size_bytes,created_at,state,claimed_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,NULL)`).run(
        fileId,
        owner.ids.doctorId,
        owner.ids.personId,
        owner.ids.patientId,
        storageName,
        "periodic.pdf",
        "application/pdf",
        validFiles["application/pdf"].length,
        new Date(recoveryNow).toISOString(),
        "ready"
      );
      const timerRegistry = createManualTimerRegistry();
      const harness = createHarness({
        voucherNow: () => recoveryNow,
        timerRegistry
      });
      try {
        await new Promise((resolve) => setImmediate(resolve));
        assert.ok(db.prepare(
          "SELECT 1 FROM mp_private_files WHERE id=?"
        ).get(fileId));
        assert.equal(timerRegistry.handles.length, 1);

        recoveryNow += VOUCHER_UNCLAIMED_MAX_AGE_MS + 1;
        await timerRegistry.tick(timerRegistry.handles[0]);
        assert.equal(
          db.prepare("SELECT 1 FROM mp_private_files WHERE id=?").get(fileId),
          undefined
        );
        assert.equal(fs.existsSync(finalPath), false);
      } finally {
        await harness.dispose();
      }
    });

    await test("周期清理单轮按 created_at,id 最多处理 100 条", async () => {
      const recoveryNow = Date.parse("2026-07-31T18:00:00.000Z");
      const timerRegistry = createManualTimerRegistry();
      const harness = createHarness({
        voucherNow: () => recoveryNow,
        timerRegistry
      });
      const prefix = `batch-${runId}-`;
      const insert = db.prepare(`INSERT INTO mp_private_files(
        id,doctor_id,person_id,patient_id,storage_name,original_name,mime,
        size_bytes,created_at,state,claimed_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,NULL)`);
      try {
        await new Promise((resolve) => setImmediate(resolve));
        fs.mkdirSync(privateVoucherDir, { recursive: true });
        for (let index = 0; index < VOUCHER_CLEANUP_BATCH_SIZE + 1; index += 1) {
          const id = prefix + String(index).padStart(3, "0");
          const storageName = `${id}.pdf`;
          fs.writeFileSync(
            path.join(privateVoucherDir, storageName),
            validFiles["application/pdf"]
          );
          insert.run(
            id,
            owner.ids.doctorId,
            owner.ids.personId,
            owner.ids.patientId,
            storageName,
            "batch.pdf",
            "application/pdf",
            validFiles["application/pdf"].length,
            new Date(
              recoveryNow - VOUCHER_UNCLAIMED_MAX_AGE_MS - 1000 + index
            ).toISOString(),
            "ready"
          );
        }

        await timerRegistry.tick(timerRegistry.handles[0]);
        const remainingAfterOne = db.prepare(
          "SELECT id FROM mp_private_files WHERE id LIKE ? ORDER BY created_at,id"
        ).all(prefix + "%");
        assert.equal(remainingAfterOne.length, 1);
        assert.equal(
          remainingAfterOne[0].id,
          prefix + String(VOUCHER_CLEANUP_BATCH_SIZE).padStart(3, "0")
        );

        await timerRegistry.tick(timerRegistry.handles[0]);
        assert.equal(
          db.prepare(
            "SELECT COUNT(*) AS count FROM mp_private_files WHERE id LIKE ?"
          ).get(prefix + "%").count,
          0
        );
      } finally {
        await harness.dispose();
        const leftovers = db.prepare(
          "SELECT id,storage_name FROM mp_private_files WHERE id LIKE ?"
        ).all(prefix + "%");
        for (const row of leftovers) {
          db.prepare("DELETE FROM mp_private_files WHERE id=?").run(row.id);
          removePath(path.join(privateVoucherDir, row.storage_name));
        }
      }
    });

    await test("周期 timer 会 unref，路由实例隔离且 dispose 只清自己的句柄", async () => {
      const firstTimers = createManualTimerRegistry();
      const secondTimers = createManualTimerRegistry();
      const first = createHarness({ timerRegistry: firstTimers });
      const second = createHarness({ timerRegistry: secondTimers });
      assert.equal(firstTimers.handles.length, 1);
      assert.equal(secondTimers.handles.length, 1);
      assert.equal(firstTimers.handles[0].intervalMs, VOUCHER_CLEANUP_INTERVAL_MS);
      assert.equal(secondTimers.handles[0].intervalMs, VOUCHER_CLEANUP_INTERVAL_MS);
      assert.equal(firstTimers.handles[0].unrefCalled, true);
      assert.equal(secondTimers.handles[0].unrefCalled, true);

      await first.dispose();
      assert.equal(firstTimers.handles[0].cleared, true);
      assert.equal(secondTimers.handles[0].cleared, false);
      await second.dispose();
      assert.equal(secondTimers.handles[0].cleared, true);
    });

    let readableFile;
    await test("所有者可读取且响应头禁止缓存和嗅探", async () => {
      const harness = createHarness();
      const uploaded = await harness.request(
        "POST",
        "/api/patient/voucher-upload",
        {
          token: owner.mpToken,
          ip: "10.0.0.40",
          body: {
            doctorId: doctor.id,
            originalName: "report\r\nX-Evil: yes.pdf",
            dataUrl: dataUrl(
              "application/pdf",
              validFiles["application/pdf"]
            )
          }
        }
      );
      assert.equal(uploaded.status, 200);
      readableFile = uploaded.body;

      const read = await harness.request(
        "GET",
        readableFile.url,
        { token: owner.mpToken }
      );
      assert.equal(read.status, null);
      assert.deepStrictEqual(read.payload, validFiles["application/pdf"]);
      assert.equal(read.headers["content-type"], "application/pdf");
      assert.equal(
        read.headers["content-length"],
        String(validFiles["application/pdf"].length)
      );
      assert.equal(read.headers["cache-control"], "private, no-store");
      assert.equal(read.headers["x-content-type-options"], "nosniff");
      assert.match(read.headers["content-disposition"], /^attachment; filename="/);
      assert.ok(!/[\r\n]/.test(read.headers["content-disposition"]));
    });

    await test("上传和下载路径不调用同步文件 I/O", async () => {
      const harness = createHarness();
      const original = {
        mkdirSync: fs.mkdirSync,
        writeFileSync: fs.writeFileSync,
        renameSync: fs.renameSync,
        lstatSync: fs.lstatSync,
        readFileSync: fs.readFileSync
      };
      const failSyncIo = () => {
        throw new Error("synchronous_file_io_forbidden");
      };
      fs.mkdirSync = failSyncIo;
      fs.writeFileSync = failSyncIo;
      fs.renameSync = failSyncIo;
      fs.lstatSync = failSyncIo;
      fs.readFileSync = failSyncIo;
      try {
        const uploaded = await harness.request(
          "POST",
          "/api/patient/voucher-upload",
          {
            token: owner.mpToken,
            ip: "10.0.0.41",
            body: {
              doctorId: doctor.id,
              dataUrl: dataUrl("image/png", validFiles["image/png"])
            }
          }
        );
        assert.equal(uploaded.status, 200);
        const downloaded = await harness.request(
          "GET",
          uploaded.body.url,
          { token: owner.mpToken, ip: "10.0.0.42" }
        );
        assert.deepStrictEqual(downloaded.payload, validFiles["image/png"]);
      } finally {
        Object.assign(fs, original);
      }
    });

    await test("其他患者 403，无效 Bearer 不得降级管理员", async () => {
      const adminHarness = createHarness({ adminAllowed: true });
      const forbidden = await adminHarness.request(
        "GET",
        readableFile.url,
        { token: otherPatient.mpToken }
      );
      assert.deepStrictEqual(
        { status: forbidden.status, body: forbidden.body },
        { status: 403, body: { error: "forbidden" } }
      );
      assert.equal(adminHarness.gateCalls.length, 0);

      const invalid = await adminHarness.request(
        "GET",
        readableFile.url,
        { authorization: "Bearer invalid-token" }
      );
      assert.deepStrictEqual(
        { status: invalid.status, body: invalid.body },
        { status: 401, body: { error: "unauthorized" } }
      );
      assert.equal(adminHarness.gateCalls.length, 0);

      const invalidMissing = await adminHarness.request(
        "GET",
        "/api/patient/voucher/secret-id-does-not-exist",
        { authorization: "Bearer invalid-token" }
      );
      assert.deepStrictEqual(
        { status: invalidMissing.status, body: invalidMissing.body },
        { status: 401, body: { error: "unauthorized" } }
      );
      assert.equal(adminHarness.gateCalls.length, 0);

      const malformed = await adminHarness.request(
        "GET",
        readableFile.url,
        { authorization: "Basic admin-cookie" }
      );
      assert.deepStrictEqual(
        { status: malformed.status, body: malformed.body },
        { status: 401, body: { error: "unauthorized" } }
      );
      assert.equal(adminHarness.gateCalls.length, 0);
    });

    await test("无 Bearer 时仅由管理员 gate 决定读取权限", async () => {
      const allowed = createHarness({ adminAllowed: true });
      const read = await allowed.request("GET", readableFile.url);
      assert.deepStrictEqual(read.payload, validFiles["application/pdf"]);
      assert.deepStrictEqual(allowed.gateCalls, [undefined, doctor.id]);

      const allowedMissing = createHarness({ adminAllowed: true });
      const missing = await allowedMissing.request(
        "GET",
        "/api/patient/voucher/admin-visible-missing-id"
      );
      assert.deepStrictEqual(
        { status: missing.status, body: missing.body },
        { status: 404, body: { error: "not_found" } }
      );
      assert.deepStrictEqual(allowedMissing.gateCalls, [undefined]);

      const denied = createHarness({ adminAllowed: false, adminStatus: 401 });
      const rejected = await denied.request("GET", readableFile.url);
      assert.equal(rejected.status, 401);
      assert.deepStrictEqual(rejected.body, { error: "admin_forbidden" });
      assert.deepStrictEqual(denied.gateCalls, [undefined]);

      const deniedMissing = createHarness({ adminAllowed: false, adminStatus: 401 });
      const missingRejected = await deniedMissing.request(
        "GET",
        "/api/patient/voucher/admin-hidden-missing-id"
      );
      assert.equal(missingRejected.status, 401);
      assert.deepStrictEqual(missingRejected.body, { error: "admin_forbidden" });
      assert.deepStrictEqual(deniedMissing.gateCalls, [undefined]);

      const scopedDenied = createHarness({
        adminAllowed: true,
        doctorAllowed: false
      });
      const scopeRejected = await scopedDenied.request("GET", readableFile.url);
      assert.equal(scopeRejected.status, 403);
      assert.deepStrictEqual(scopeRejected.body, { error: "admin_forbidden" });
      assert.deepStrictEqual(scopedDenied.gateCalls, [undefined, doctor.id]);
    });

    await test("不存在文件返回 404，穿越型 storage_name 返回稳定 500", async () => {
      const harness = createHarness();
      const missing = await harness.request(
        "GET",
        "/api/patient/voucher/not-existing",
        { token: owner.mpToken }
      );
      assert.deepStrictEqual(
        { status: missing.status, body: missing.body },
        { status: 404, body: { error: "not_found" } }
      );

      const traversalId = `traversal-${runId}`;
      db.prepare(`INSERT INTO mp_private_files(
        id,doctor_id,person_id,patient_id,storage_name,original_name,mime,size_bytes,created_at
      ) VALUES(?,?,?,?,?,?,?,?,?)`).run(
        traversalId,
        owner.ids.doctorId,
        owner.ids.personId,
        owner.ids.patientId,
        "../outside.pdf",
        "outside.pdf",
        "application/pdf",
        1,
        new Date().toISOString()
      );
      const traversal = await harness.request(
        "GET",
        `/api/patient/voucher/${traversalId}`,
        { token: owner.mpToken }
      );
      assert.deepStrictEqual(
        { status: traversal.status, body: traversal.body },
        { status: 500, body: { error: "file_unavailable" } }
      );
    });

    await test("上传按 token 摘要和可信 IP 组合限制为每分钟 10 次", async () => {
      const rateOwner = await createBoundSession(
        doctor.id,
        "13800138403",
        "rate"
      );
      const harness = createHarness();
      const body = {
        doctorId: doctor.id,
        dataUrl: dataUrl("image/png", validFiles["image/png"])
      };
      for (let index = 0; index < 10; index += 1) {
        const accepted = await harness.request(
          "POST",
          "/api/patient/voucher-upload",
          { token: rateOwner.mpToken, ip: "10.0.0.50", body }
        );
        assert.equal(accepted.status, 200);
      }
      const blocked = await harness.request(
        "POST",
        "/api/patient/voucher-upload",
        { token: rateOwner.mpToken, ip: "10.0.0.50", body }
      );
      assert.deepStrictEqual(
        { status: blocked.status, body: blocked.body },
        { status: 429, body: { error: "rate_limited" } }
      );
      assert.ok(Number(blocked.headers["retry-after"]) >= 1);

      const otherIp = await harness.request(
        "POST",
        "/api/patient/voucher-upload",
        { token: rateOwner.mpToken, ip: "10.0.0.51", body }
      );
      assert.equal(otherIp.status, 200);
    });

    await test("每个路由注册实例拥有独立上传限频器", async () => {
      const isolatedOwner = await createBoundSession(
        doctor.id,
        "13800138404",
        "isolated-rate"
      );
      const firstServer = createHarness();
      const secondServer = createHarness();
      const body = {
        doctorId: doctor.id,
        dataUrl: dataUrl("image/png", validFiles["image/png"])
      };
      for (let index = 0; index < 10; index += 1) {
        const accepted = await firstServer.request(
          "POST",
          "/api/patient/voucher-upload",
          { token: isolatedOwner.mpToken, ip: "10.0.0.52", body }
        );
        assert.equal(accepted.status, 200);
      }
      const firstBlocked = await firstServer.request(
        "POST",
        "/api/patient/voucher-upload",
        { token: isolatedOwner.mpToken, ip: "10.0.0.52", body }
      );
      assert.equal(firstBlocked.status, 429);

      const isolatedAccepted = await secondServer.request(
        "POST",
        "/api/patient/voucher-upload",
        { token: isolatedOwner.mpToken, ip: "10.0.0.52", body }
      );
      assert.equal(isolatedAccepted.status, 200);
    });

    await test("下载按身份摘要和 IP 限频且路由实例相互隔离", async () => {
      const downloadOwner = await createBoundSession(
        doctor.id,
        "13800138405",
        "download-rate"
      );
      const firstServer = createHarness();
      const secondServer = createHarness();
      const upload = await firstServer.request(
        "POST",
        "/api/patient/voucher-upload",
        {
          token: downloadOwner.mpToken,
          ip: "10.0.0.53",
          body: {
            doctorId: doctor.id,
            dataUrl: dataUrl("application/pdf", validFiles["application/pdf"])
          }
        }
      );
      assert.equal(upload.status, 200);
      for (let index = 0; index < VOUCHER_DOWNLOAD_LIMIT; index += 1) {
        const accepted = await firstServer.request(
          "GET",
          upload.body.url,
          { token: downloadOwner.mpToken, ip: "10.0.0.54" }
        );
        assert.deepStrictEqual(accepted.payload, validFiles["application/pdf"]);
      }
      const blocked = await firstServer.request(
        "GET",
        upload.body.url,
        { token: downloadOwner.mpToken, ip: "10.0.0.54" }
      );
      assert.deepStrictEqual(
        { status: blocked.status, body: blocked.body },
        { status: 429, body: { error: "rate_limited" } }
      );
      assert.ok(Number(blocked.headers["retry-after"]) >= 1);

      const isolated = await secondServer.request(
        "GET",
        upload.body.url,
        { token: downloadOwner.mpToken, ip: "10.0.0.54" }
      );
      assert.deepStrictEqual(isolated.payload, validFiles["application/pdf"]);
    });

    await test("parseBody 等待期间 token 轮换或撤销时凭证零 DB/temp/final", async () => {
      for (const mode of ["rotated", "revoked"]) {
        const phone = mode === "rotated" ? "13800138421" : "13800138422";
        const raceOwner = await createBoundSession(
          doctor.id,
          phone,
          `upload-race-${mode}`
        );
        const entered = deferred();
        const release = deferred();
        const harness = createHarness({
          parseBody: async (req) => {
            entered.resolve();
            await release.promise;
            return req.body || {};
          }
        });
        const beforeFiles = listFiles(privateVoucherDir);
        const beforeRows = db.prepare("SELECT COUNT(*) AS n FROM mp_private_files").get().n;
        const pending = harness.request(
          "POST",
          "/api/patient/voucher-upload",
          {
            token: raceOwner.mpToken,
            ip: mode === "rotated" ? "10.0.0.71" : "10.0.0.72",
            body: {
              doctorId: doctor.id,
              dataUrl: dataUrl("application/pdf", validFiles["application/pdf"])
            }
          }
        );
        await entered.promise;
        if (mode === "rotated") {
          const rotated = await mpAuth.bindPhone({
            token: raceOwner.mpToken,
            phone,
            smsCode: "000000",
            doctorId: doctor.id
          });
          assert.notEqual(rotated.mpToken, raceOwner.mpToken);
        } else {
          db.prepare("UPDATE mp_sessions SET revoked_at=? WHERE token=?")
            .run(new Date().toISOString(), raceOwner.mpToken);
        }
        release.resolve();
        const response = await pending;
        assert.deepStrictEqual(
          { status: response.status, body: response.body },
          { status: 401, body: { error: "unauthorized" } },
          mode
        );
        assert.deepStrictEqual(listFiles(privateVoucherDir), beforeFiles, mode);
        assert.equal(
          db.prepare("SELECT COUNT(*) AS n FROM mp_private_files").get().n,
          beforeRows,
          mode
        );
        await harness.dispose();
      }
    });

    await test("数据库插入失败时清理临时文件且不留下元数据", async () => {
      const harness = createHarness();
      const beforeFiles = listFiles(privateVoucherDir);
      const beforeRows = db.prepare(
        "SELECT COUNT(*) AS n FROM mp_private_files"
      ).get().n;
      db.exec(`CREATE TEMP TRIGGER fail_private_file_insert
        BEFORE INSERT ON mp_private_files
        BEGIN
          SELECT RAISE(ABORT, 'forced_private_file_insert_failure');
        END`);
      const originalConsoleError = console.error;
      const logs = [];
      console.error = (...args) => logs.push(args.map(String).join(" "));
      let response;
      try {
        response = await harness.request(
          "POST",
          "/api/patient/voucher-upload",
          {
            token: owner.mpToken,
            ip: "10.0.0.60",
            body: {
              doctorId: doctor.id,
              dataUrl: dataUrl("image/jpeg", validFiles["image/jpeg"])
            }
          }
        );
      } finally {
        console.error = originalConsoleError;
        db.exec("DROP TRIGGER IF EXISTS fail_private_file_insert");
      }
      assert.deepStrictEqual(
        { status: response.status, body: response.body },
        { status: 500, body: { error: "upload_failed" } }
      );
      assert.deepStrictEqual(listFiles(privateVoucherDir), beforeFiles);
      assert.equal(
        db.prepare("SELECT COUNT(*) AS n FROM mp_private_files").get().n,
        beforeRows
      );
      assert.deepStrictEqual(logs, ["[patient/voucher-upload] upload_failed"]);
    });

    await test("COMMIT 失败时回滚 DB 并删除 temp 与已 rename 的 final", async () => {
      const harness = createHarness();
      const beforeFiles = listFiles(privateVoucherDir);
      const beforeRows = db.prepare(
        "SELECT COUNT(*) AS n FROM mp_private_files"
      ).get().n;
      const originalExec = db.exec;
      const originalRename = fs.promises.rename;
      const originalConsoleError = console.error;
      const logs = [];
      let renamedFinal = "";
      let commitCount = 0;
      db.exec = function injectedExec(sql) {
        if (String(sql).trim().toUpperCase() === "COMMIT") {
          commitCount += 1;
          if (commitCount === 2) throw new Error("forced_commit_failure");
        }
        return originalExec.call(db, sql);
      };
      fs.promises.rename = async (source, destination) => {
        const result = await originalRename.call(fs.promises, source, destination);
        renamedFinal = destination;
        return result;
      };
      console.error = (...args) => logs.push(args.map(String).join(" "));
      let response;
      try {
        response = await harness.request(
          "POST",
          "/api/patient/voucher-upload",
          {
            token: owner.mpToken,
            ip: "10.0.0.62",
            body: {
              doctorId: doctor.id,
              dataUrl: dataUrl("application/pdf", validFiles["application/pdf"])
            }
          }
        );
      } finally {
        db.exec = originalExec;
        fs.promises.rename = originalRename;
        console.error = originalConsoleError;
      }
      assert.deepStrictEqual(
        { status: response.status, body: response.body },
        { status: 500, body: { error: "upload_failed" } }
      );
      assert.ok(renamedFinal, "failure must happen after rename");
      assert.equal(fs.existsSync(renamedFinal), false);
      assert.deepStrictEqual(listFiles(privateVoucherDir), beforeFiles);
      assert.equal(
        db.prepare("SELECT COUNT(*) AS n FROM mp_private_files").get().n,
        beforeRows
      );
      assert.deepStrictEqual(logs, ["[patient/voucher-upload] upload_failed"]);
    });

    await test("rename 失败时回滚数据库并清理 temp/final，日志不泄露路径正文", async () => {
      const harness = createHarness();
      const beforeFiles = listFiles(privateVoucherDir);
      const beforeRows = db.prepare(
        "SELECT COUNT(*) AS n FROM mp_private_files"
      ).get().n;
      const originalRename = fs.promises.rename;
      const originalConsoleError = console.error;
      const logs = [];
      fs.promises.rename = async () => {
        throw new Error(`rename failed ${process.env.PRIVATE_UPLOAD_DIR}`);
      };
      console.error = (...args) => logs.push(args.map(String).join(" "));
      let response;
      try {
        response = await harness.request(
          "POST",
          "/api/patient/voucher-upload",
          {
            token: owner.mpToken,
            ip: "10.0.0.61",
            body: {
              doctorId: doctor.id,
              dataUrl: dataUrl("application/pdf", validFiles["application/pdf"])
            }
          }
        );
      } finally {
        fs.promises.rename = originalRename;
        console.error = originalConsoleError;
      }
      assert.deepStrictEqual(
        { status: response.status, body: response.body },
        { status: 500, body: { error: "upload_failed" } }
      );
      assert.deepStrictEqual(listFiles(privateVoucherDir), beforeFiles);
      assert.equal(
        db.prepare("SELECT COUNT(*) AS n FROM mp_private_files").get().n,
        beforeRows
      );
      assert.deepStrictEqual(logs, ["[patient/voucher-upload] upload_failed"]);
    });

    await test("public patient-vouchers 目录完整快照保持不变", () => {
      assert.deepStrictEqual(
        directorySnapshot(publicVoucherDir),
        publicSnapshotBefore
      );
    });

    console.log("all mp voucher security tests passed");
  } finally {
    await new Promise((resolve) => setImmediate(resolve));
    if (db && typeof db.close === "function") db.close();
    for (const base of [process.env.DB_PATH, schemaDbPath]) {
      for (const file of [base, base + "-wal", base + "-shm"]) {
        removePath(file);
      }
    }
    removePath(process.env.PRIVATE_UPLOAD_DIR, { recursive: true });
  }
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
