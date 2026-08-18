"use strict";
/**
 * 小程序 replies/mine Bearer 免短信 + GET /api/mp/archive 契约冒烟
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
process.env.DB_PATH = path.join(os.tmpdir(), `mp-archive-replies-${Date.now()}.db`);
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
const personApi = require("./person.js");
const mpAuth = require("./mp_auth.js");
const patientProfile = require("./patient_profile.js");
const profileStore = patientProfile.createProfileStore(db);

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
          ...(data ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } : {}),
          ...(headers || {}),
        },
      },
      (res) => {
        let raw = "";
        res.on("data", (c) => (raw += c));
        res.on("end", () => {
          let j = null;
          try { j = JSON.parse(raw); } catch (e) { j = raw; }
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
      const req = http.get({ hostname: "127.0.0.1", port, path: "/api/bootstrap", timeout: 500 }, (res) => {
        res.resume();
        resolve();
      });
      req.on("error", () => {
        if (Date.now() > deadline) reject(new Error("server_timeout"));
        else setTimeout(tryOnce, 200);
      });
    };
    tryOnce();
  });
}

(async () => {
  const doctors = db.prepare(
    "SELECT id FROM doctors WHERE active=1 ORDER BY id ASC LIMIT 2"
  ).all();
  assert.ok(doctors.length >= 2);
  const doctorA = doctors[0].id;
  const doctorB = doctors[1].id;
  const phone = "13800138999";

  let token = "";
  let personId = 0;
  let patientId = 0;
  await test("准备已绑号会话 + submissions + 档案字段", async () => {
    const loginRes = await mpAuth.login({ code: "archive-replies-" + Date.now(), doctorId: doctorA });
    const bindRes = await mpAuth.bindPhone({
      token: loginRes.mpToken,
      phone,
      smsCode: "000000",
      doctorId: doctorA,
    });
    token = bindRes.mpToken;
    personId = bindRes.personId;
    patientId = bindRes.patientId;
    db.prepare("UPDATE persons SET real_name=? WHERE id=?").run("归档测", bindRes.personId);
    profileStore.upsertPersonFields(
      bindRes.personId,
      {
        idNumber: "110101199001011234",
        disease: "胃病",
        pregnancyStatus: "否",
        foodContactAllergies: { values: ["无"], other: "" },
        drugAllergies: { values: ["青霉素"], other: "" },
        diseaseHistory: { values: ["高血压"], other: "" },
      },
      "patient",
      "test"
    );
    const fields = profileStore.readPersonFields(bindRes.personId);
    assert.equal(fields.disease, "胃病");
    const masked = patientProfile.maskIdNumber(fields.idNumber);
    assert.ok(String(masked).includes("*"));
    db.prepare(
      "INSERT INTO submissions(doctor_id,type,payload,status,created_at) VALUES(?,?,?,?,?)"
    ).run(
      doctorA,
      "门诊加号",
      JSON.stringify({ 手机号: phone, 姓名: "归档测", 备注: "单元" }),
      "助理处理中",
      new Date().toISOString()
    );
    db.prepare(
      "INSERT INTO submissions(doctor_id,type,payload,status,created_at) VALUES(?,?,?,?,?)"
    ).run(
      doctorA,
      "门诊加号",
      JSON.stringify({ 手机号: "13900000000", 姓名: "别人" }),
      "助理处理中",
      new Date().toISOString()
    );
    assert.ok(token);
    assert.ok(personId);
  });

  const port = 19080 + Math.floor(Math.random() * 200);
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

    await test("GET /api/mp/archive 无 token → 401", async () => {
      const r = await api(port, "GET", "/api/mp/archive");
      assert.equal(r.status, 401);
    });

    await test("GET /api/mp/archive 有档 → 脱敏", async () => {
      const r = await api(port, "GET", "/api/mp/archive", undefined, {
        Authorization: "Bearer " + token,
      });
      assert.equal(r.status, 200);
      assert.equal(r.j.hasProfile, true);
      assert.equal(r.j.linked, true);
      assert.equal(r.j.patient.name, "归档测");
      assert.equal(r.j.patient.phoneMasked, "138****8999");
      assert.ok(String(r.j.profile.idNumberMasked || "").includes("*"));
      assert.ok(!String(r.j.profile.idNumberMasked || "").includes("110101199001011234"));
      assert.equal(r.j.profile.disease, "胃病");
      assert.ok(r.j.formPrefill);
      assert.equal(r.j.formPrefill.phone, phone);
      assert.equal(r.j.formPrefill.name, "归档测");
      assert.equal(r.j.formPrefill.disease, "胃病");
      assert.equal(r.j.formPrefill.idNumber, "110101199001011234");
    });

    await test("错绑 patient 关系不能读取档案或身份证", async () => {
      db.prepare("UPDATE patients SET person_id=NULL WHERE id=?").run(patientId);
      try {
        const r = await api(port, "GET", "/api/mp/archive", undefined, {
          Authorization: "Bearer " + token,
        });
        assert.equal(r.status, 403);
        assert.equal(JSON.stringify(r.j).includes("110101199001011234"), false);
        assert.equal(JSON.stringify(r.j).includes("归档测"), false);
      } finally {
        db.prepare("UPDATE patients SET person_id=? WHERE id=?").run(personId, patientId);
      }
    });

    await test("GET /api/mp/health-records → 空列表契约", async () => {
      const r = await api(port, "GET", "/api/mp/health-records", undefined, {
        Authorization: "Bearer " + token,
      });
      assert.equal(r.status, 200);
      assert.ok(Array.isArray(r.j.categories));
      assert.ok(r.j.categories.length >= 1);
      assert.ok(Array.isArray(r.j.items));
      assert.equal(r.j.total, 0);
    });

    await test("POST /api/replies/mine Bearer 免短信且不串号", async () => {
      const r = await api(
        port,
        "POST",
        "/api/replies/mine",
        { doctorId: doctorA, phone: "13900000000", code: "000000" },
        { Authorization: "Bearer " + token }
      );
      assert.equal(r.status, 200);
      assert.ok(Array.isArray(r.j.replies));
      assert.ok(r.j.replies.some((x) => x.type === "门诊加号" && x.status === "助理处理中"));
      assert.ok(!r.j.replies.some((x) => (x.summary || []).some((s) => String(s).includes("别人"))));
    });

    await test("POST /api/replies/mine doctor 不匹配 → 403", async () => {
      const r = await api(
        port,
        "POST",
        "/api/replies/mine",
        { doctorId: doctorB },
        { Authorization: "Bearer " + token }
      );
      assert.equal(r.status, 403);
    });

    await test("无 Bearer 错短信仍 400（H5 路径）", async () => {
      const r = await api(port, "POST", "/api/replies/mine", {
        doctorId: doctorA,
        phone,
        code: "111111",
      });
      assert.equal(r.status, 400);
    });
  } finally {
    child.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 300));
    try { child.kill("SIGKILL"); } catch (e) { /* ignore */ }
    await new Promise((r) => setTimeout(r, 300));
    db.close();
    removeTempDbFiles();
    assert.ok(tempDbFiles.every((f) => !fs.existsSync(f)), "temporary archive database must be removed");
  }

  if (stderr && /Error|EADDRINUSE/.test(stderr)) {
    console.warn("server stderr snippet:", stderr.slice(0, 400));
  }
  console.log("all mp archive/replies tests passed");
})().catch((e) => {
  console.error(e && e.stack ? e.stack : e);
  process.exit(1);
});
