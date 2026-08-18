"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const runId = `${process.pid}-${crypto.randomBytes(6).toString("hex")}`;
const tempRoot = path.join(os.tmpdir(), `mp-message-identity-${runId}`);
process.env.NODE_ENV = "test";
process.env.MP_AUTH_STUB = "1";
process.env.DB_PATH = path.join(tempRoot, "message.db");
process.env.PRIVATE_UPLOAD_DIR = path.join(tempRoot, "private");
process.env.TRIAGE_AI_DISABLED = "1";
fs.mkdirSync(tempRoot, { recursive: true });

const { db } = require("./db.js");
const mpAuth = require("./mp_auth.js");
const { registerPatientPublicRoutes } = require("./routes/patient-public.js");

const routes = [];
const triageInputs = [];
const victimMarker = "VICTIM-SENSITIVE-MARKER-7f43d9";

function route(method, pattern, handler) {
  routes.push({ method, pattern, handler });
}

function json(res, status, body) {
  res.status = status;
  res.body = body;
}

function businessSnapshot(victimPatientId) {
  const tables = ["message_log", "triage_decisions", "triage_sessions", "triage_messages"];
  const result = {};
  for (const table of tables) {
    const exists = db.prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?"
    ).get(table);
    if (!exists) continue;
    result[table] = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count;
    const columns = db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name);
    if (columns.includes("patient_id")) {
      result[`${table}:victim`] = db.prepare(
        `SELECT COUNT(*) AS count FROM ${table} WHERE patient_id=?`
      ).get(victimPatientId).count;
    }
  }
  return result;
}

let validPsidPatientId = 0;
let validPsidDoctorId = 0;
const lifecycle = registerPatientPublicRoutes(route, {
  parseBody: async (req) => req.body || {},
  json,
  db,
  now: () => new Date().toISOString(),
  SMS_DEMO: false,
  MESSAGE_MAX_BODY: 6 * 1024 * 1024,
  smsCodes: new Map(),
  smsThrottle: new Map(),
  cleanAttachments: (attachments) => Array.isArray(attachments) ? attachments : [],
  patientFromRequest: (req, doctorId) => {
    if (!req.validPsid) return null;
    if (+doctorId !== validPsidDoctorId) return null;
    return { doctorId: validPsidDoctorId, patientId: validPsidPatientId, psid: "valid-psid" };
  },
  patientReply: {
    async buildPatientReply(input) {
      triageInputs.push({ ...input });
      const patient = input.patientId
        ? db.prepare("SELECT notes FROM patients WHERE id=?").get(+input.patientId)
        : null;
      return {
        responses: [{ text: patient && patient.notes === victimMarker ? victimMarker : "safe-reply" }]
      };
    }
  }
});

const messageRoute = routes.find((entry) =>
  entry.method === "POST" && entry.pattern.test("/api/message")
);
assert.ok(messageRoute, "message route missing");

async function call(body, headers = {}, options = {}) {
  const req = { body, headers, validPsid: !!options.validPsid };
  const res = {};
  await messageRoute.handler(req, res, messageRoute.pattern.exec("/api/message"), {});
  return res;
}

async function expectRejectedWithoutBusinessWrite(
  victimPatientId,
  body,
  headers,
  expectedStatus,
  expectedError
) {
  const before = businessSnapshot(victimPatientId);
  const callsBefore = triageInputs.length;
  const result = await call(body, headers);
  assert.equal(result.status, expectedStatus);
  assert.deepStrictEqual(result.body, { error: expectedError });
  assert.equal(triageInputs.length, callsBefore);
  assert.deepStrictEqual(businessSnapshot(victimPatientId), before);
  assert.equal(JSON.stringify(result.body).includes(victimMarker), false);
}

(async () => {
  const doctors = db.prepare(
    "SELECT id FROM doctors WHERE active=1 ORDER BY id LIMIT 2"
  ).all();
  assert.equal(doctors.length, 2);
  const doctorA = +doctors[0].id;
  const doctorB = +doctors[1].id;

  const victimInsert = db.prepare(`INSERT INTO patients(
    doctor_id,display_name,real_name,phone,phone_verified,notes,created_at,updated_at
  ) VALUES(?,?,?,?,?,?,?,?)`).run(
    doctorA,
    "victim",
    "victim",
    "13900001111",
    1,
    victimMarker,
    new Date().toISOString(),
    new Date().toISOString()
  );
  const victimPatientId = +victimInsert.lastInsertRowid;
  validPsidPatientId = victimPatientId;
  validPsidDoctorId = doctorA;

  const ownLogin = await mpAuth.login({ code: `own-${runId}`, doctorId: doctorA });
  const own = await mpAuth.bindPhone({
    token: ownLogin.mpToken,
    phone: "13800138101",
    smsCode: "000000",
    doctorId: doctorA
  });
  const unbound = await mpAuth.login({ code: `unbound-${runId}`, doctorId: doctorA });
  const revoked = await mpAuth.login({ code: `revoked-${runId}`, doctorId: doctorA });
  db.prepare("UPDATE mp_sessions SET revoked_at=? WHERE token=?")
    .run(new Date().toISOString(), revoked.mpToken);
  const otherLogin = await mpAuth.login({ code: `other-${runId}`, doctorId: doctorB });
  const other = await mpAuth.bindPhone({
    token: otherLogin.mpToken,
    phone: "13800138102",
    smsCode: "000000",
    doctorId: doctorB
  });

  const attackBody = {
    doctorId: doctorA,
    text: "hello",
    patientId: victimPatientId,
    patientKey: `patient:${victimPatientId}:${victimMarker}`,
    externalId: String(victimPatientId),
    externalUserId: String(victimPatientId)
  };

  let before = businessSnapshot(victimPatientId);
  let result = await call(attackBody);
  assert.equal(result.status, 200);
  assert.equal(JSON.stringify(result.body).includes(victimMarker), false);
  assert.equal(triageInputs.at(-1).patientId, undefined);
  assert.match(String(triageInputs.at(-1).patientKey || ""), /^anonymous:/);
  assert.equal(String(triageInputs.at(-1).patientKey).includes(victimMarker), false);
  assert.deepStrictEqual(businessSnapshot(victimPatientId), before);
  console.log("ok - 匿名请求不能用 patientId/patientKey/external 指定受害患者");

  await expectRejectedWithoutBusinessWrite(
    victimPatientId,
    attackBody,
    { authorization: "Basic attacker" },
    401,
    "unauthorized"
  );
  await expectRejectedWithoutBusinessWrite(
    victimPatientId,
    attackBody,
    { authorization: "Bearer invalid-token" },
    401,
    "unauthorized"
  );
  await expectRejectedWithoutBusinessWrite(
    victimPatientId,
    attackBody,
    { authorization: `Bearer ${revoked.mpToken}` },
    401,
    "unauthorized"
  );
  console.log("ok - 非法或撤销 Authorization 不会降级为匿名");

  await expectRejectedWithoutBusinessWrite(
    victimPatientId,
    attackBody,
    { authorization: `Bearer ${unbound.mpToken}` },
    403,
    "patient_binding_required"
  );
  await expectRejectedWithoutBusinessWrite(
    victimPatientId,
    { ...attackBody, doctorId: doctorB },
    { authorization: `Bearer ${own.mpToken}` },
    403,
    "doctor_mismatch"
  );
  await expectRejectedWithoutBusinessWrite(
    victimPatientId,
    attackBody,
    { authorization: `Bearer ${own.mpToken}` },
    403,
    "patient_mismatch"
  );
  await expectRejectedWithoutBusinessWrite(
    victimPatientId,
    attackBody,
    { authorization: `Bearer ${other.mpToken}` },
    403,
    "doctor_mismatch"
  );
  console.log("ok - 未绑定、跨医生与跨患者请求稳定拒绝且零业务写");

  result = await call({
    doctorId: doctorA,
    text: "own",
    patientId: own.patientId,
    patientKey: `patient:${victimPatientId}`
  }, { authorization: `Bearer ${own.mpToken}` });
  assert.equal(result.status, 200);
  assert.equal(triageInputs.at(-1).patientId, own.patientId);
  assert.equal(triageInputs.at(-1).patientKey, `mp-patient-${own.patientId}`);
  assert.equal(JSON.stringify(result.body).includes(victimMarker), false);
  console.log("ok - 完整绑定会话只使用会话内 patientId");

  result = await call(attackBody, {}, { validPsid: true });
  assert.equal(result.status, 200);
  assert.equal(triageInputs.at(-1).patientId, victimPatientId);
  assert.equal(triageInputs.at(-1).patientKey, `psid-patient-${victimPatientId}`);
  assert.equal(JSON.stringify(result.body).includes(victimMarker), true);
  console.log("ok - 服务端有效 psid 可以使用对应 patient 上下文");
})().finally(async () => {
  await lifecycle.dispose();
  await new Promise((resolve) => setImmediate(resolve));
  db.close();
  fs.rmSync(tempRoot, { recursive: true, force: true });
}).catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
