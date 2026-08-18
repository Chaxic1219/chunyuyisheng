"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const dbPath = path.join(
  os.tmpdir(),
  `mp-invite-security-${process.pid}-${crypto.randomBytes(6).toString("hex")}.db`
);
process.env.DB_PATH = dbPath;
process.env.MP_AUTH_STUB = "1";
process.env.SMS_PROVIDER = "demo";

const dbApi = require("./db.js");
const { db, resolvePatient } = dbApi;
const mpAuth = require("./mp_auth.js");
const patientProfile = require("./patient_profile.js");
const patientInvite = require("./patient_invite.js");
const smsProvider = require("./sms_provider.js");
const { verifySmsCode } = require("./sms_code_verifier.js");
const {
  registerPatientPublicRoutes,
  createInviteProofStore
} = require("./routes/patient-public.js");

const inviteStore = patientInvite.createInviteStore(db);
const profileStore = patientProfile.createProfileStore(db);
const routes = [];

function json(res, status, payload) {
  res.statusCode = status;
  res.payload = payload;
  return payload;
}

function patientSessionCookie(_req, token, maxAge) {
  return `psid=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAge}`;
}

function cookieValue(req, name) {
  const raw = String((req.headers && req.headers.cookie) || "");
  for (const part of raw.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    if (part.slice(0, index).trim() === name) {
      return decodeURIComponent(part.slice(index + 1).trim());
    }
  }
  return "";
}

function patientFromRequest(req, doctorId) {
  const token = cookieValue(req, "psid");
  const session = inviteStore.getSession(token);
  if (!session || +session.doctor_id !== +doctorId) return null;
  inviteStore.touchSession(token);
  return {
    doctorId: +session.doctor_id,
    patientId: +session.patient_id,
    psid: token
  };
}

const smsCodes = new Map();
const smsThrottle = new Map();

function issueSms(phone, code = "246810", options = {}) {
  const ts = options.now == null ? Date.now() : +options.now;
  smsCodes.set(String(phone), {
    code: String(code),
    expiresAt: options.expiresAt == null ? ts + 5 * 60 * 1000 : +options.expiresAt,
    attempts: options.attempts || 0,
    sentAt: ts
  });
  smsThrottle.set(String(phone), ts);
  return String(code);
}

function verifySms(phone, code) {
  return verifySmsCode({
    smsCodes,
    smsThrottle,
    phone,
    code,
    now: () => Date.now()
  });
}

function contentForDoctor(doctorId) {
  const row = db.prepare("SELECT content FROM doctors WHERE id=?").get(+doctorId);
  if (!row) return null;
  try {
    return JSON.parse(row.content || "{}");
  } catch (_error) {
    return {};
  }
}

const patientPublicLifecycle = registerPatientPublicRoutes((method, pattern, handler) => {
  routes.push({ method, pattern, handler });
}, {
  parseBody: async (req) => req._body || {},
  json,
  db,
  now: () => new Date().toISOString(),
  MESSAGE_MAX_BODY: 6 * 1024 * 1024,
  smsCodes,
  smsThrottle,
  isPhone: patientInvite.isInvitePhone,
  verifySms,
  contentForDoctor,
  patientFromRequest,
  patientProfile,
  profileStore,
  resolvePatient,
  updatePersonIdentity: () => {},
  personIdForPatientId: (patientId) => {
    const row = db.prepare("SELECT person_id FROM patients WHERE id=?").get(+patientId);
    return row && row.person_id ? +row.person_id : null;
  },
  inviteStore,
  patientInvite,
  patientSessionCookie,
  hasContactFormForPhone: () => true,
  followup: {
    findPlan: () => null,
    enroll: () => null
  },
  SUBMIT_TYPES: new Set(["联络表"]),
  SUBMIT_FORM_KEYS: { "联络表": "contactForm" },
  submitWhitelistForType: () => new Set(),
  maskPayloadExceptWhitelist: (payload) => JSON.parse(JSON.stringify(payload)),
  maskPII: (value) => String(value || ""),
  maskPIIStrict: (value) => String(value || "")
});

function routeFor(method, pathname) {
  for (const entry of routes) {
    const match = pathname.match(entry.pattern);
    if (entry.method === method && match) return { entry, match };
  }
  throw new Error(`route not found: ${method} ${pathname}`);
}

async function request(method, pathname, options = {}) {
  const { entry, match } = routeFor(method, pathname);
  const req = {
    headers: Object.assign({}, options.headers),
    _body: options.body || {}
  };
  const res = {
    statusCode: 0,
    headers: {},
    writeHead(status, headers) {
      this.statusCode = status;
      this.headers = headers || {};
    },
    end(raw) {
      this.payload = raw ? JSON.parse(raw) : null;
    }
  };
  await entry.handler(req, res, match, options.query || {});
  return res;
}

function validBody(doctorId, phone, extra = {}) {
  return Object.assign({
    doctorId,
    phone,
    consent: true,
    payload: {
      "姓名": "邀请测试" + String(phone || "").slice(-4),
      "性别": "男",
      "出生日期": "1990-01-01",
      "手机号": phone,
      "您所患的疾病": "测试疾病"
    }
  }, extra);
}

function invalidProfileBody(doctorId, phone, extra = {}) {
  const body = validBody(doctorId, phone, extra);
  body.payload = Object.assign({}, body.payload, { "姓名": "" });
  return body;
}

function contactSubmitBody(doctorId, phone, voucherUrl, extra = {}) {
  return Object.assign(
    validBody(doctorId, phone, {
      type: "联络表",
      outpatientVoucherUrl: voucherUrl
    }),
    extra
  );
}

const SNAPSHOT_TABLES = [
  "persons",
  "patients",
  "patient_identities",
  "patient_profile_fields",
  "submissions",
  "patient_health_records",
  "mp_private_files",
  "patient_sessions",
  "followups"
];

function businessSnapshot(inviteToken) {
  const data = {};
  for (const table of SNAPSHOT_TABLES) {
    data[table] = db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all();
  }
  data.invite = db.prepare(
    "SELECT use_count,last_used_at FROM patient_invite_links WHERE token=?"
  ).get(inviteToken);
  return JSON.stringify(data);
}

function createVoucherMetadata(token, options = {}) {
  const session = mpAuth.requireSession(token);
  const id = options.id || `invite-voucher-${crypto.randomBytes(8).toString("hex")}`;
  db.prepare(`INSERT INTO mp_private_files(
    id,doctor_id,person_id,patient_id,storage_name,original_name,mime,
    size_bytes,created_at,state,claimed_at
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(
    id,
    +session.doctor_id,
    +session.person_id,
    +session.patient_id,
    `${id}.pdf`,
    "voucher.pdf",
    "application/pdf",
    10,
    new Date().toISOString(),
    options.state || "ready",
    options.claimedAt || null
  );
  return {
    id,
    url: `/api/patient/voucher/${id}`,
    doctorId: +session.doctor_id,
    personId: +session.person_id,
    patientId: +session.patient_id
  };
}

async function assertRejectedWithoutWrites({
  name,
  inviteToken,
  body,
  headers,
  status,
  error
}) {
  const before = businessSnapshot(inviteToken);
  const res = await request("POST", `/api/invite/${inviteToken}/submit`, {
    body,
    headers
  });
  assert.equal(res.statusCode, status, `${name}: ${JSON.stringify(res.payload)}`);
  assert.equal(res.payload && res.payload.error, error, name);
  assert.equal(businessSnapshot(inviteToken), before, `${name}: 数据库不应改变`);
  console.log("ok -", name);
}

async function assertSubmitRejectedWithoutWrites({
  name,
  inviteToken,
  body,
  headers,
  status,
  error
}) {
  const before = businessSnapshot(inviteToken);
  const res = await request("POST", "/api/submit", { body, headers });
  assert.equal(res.statusCode, status, `${name}: ${JSON.stringify(res.payload)}`);
  assert.equal(res.payload && res.payload.error, error, name);
  assert.equal(businessSnapshot(inviteToken), before, `${name}: 数据库不应改变`);
  console.log("ok -", name);
}

function firstCookie(headers) {
  const value = headers && (headers["Set-Cookie"] || headers["set-cookie"]);
  return Array.isArray(value) ? value[0] : String(value || "");
}

(async () => {
  let testError = null;
  try {
    await new Promise((resolve) => setImmediate(resolve));

    {
      let proofNow = 10_000;
      let randomSeed = 0;
      const proofStore = createInviteProofStore({
        ttlMs: 100,
        maxEntries: 2,
        now: () => proofNow,
        randomBytes: (size) => Buffer.alloc(size, randomSeed++)
      });
      const bindingA = {
        inviteToken: "invite-a",
        doctorId: 1,
        phone: "13800138081"
      };
      const bindingB = {
        inviteToken: "invite-b",
        doctorId: 2,
        phone: "13800138082"
      };
      const tokenA = proofStore.issue(bindingA);
      const tokenB = proofStore.issue(bindingB);
      assert.notEqual(tokenA, tokenB);
      assert.equal(proofStore.validate(tokenA, bindingA), true);
      assert.equal(proofStore.validate(tokenA, {
        ...bindingA,
        inviteToken: "invite-other"
      }), false);
      assert.equal(proofStore.validate(tokenA, {
        ...bindingA,
        doctorId: 9
      }), false);
      assert.equal(proofStore.validate(tokenA, {
        ...bindingA,
        phone: "13800138089"
      }), false);

      const tokenC = proofStore.issue({
        inviteToken: "invite-c",
        doctorId: 3,
        phone: "13800138083"
      });
      assert.equal(proofStore.validate(tokenA, bindingA), false);
      assert.equal(proofStore.validate(tokenB, bindingB), true);
      assert.equal(proofStore.validate(tokenC, {
        inviteToken: "invite-c",
        doctorId: 3,
        phone: "13800138083"
      }), true);
      assert.equal(proofStore.consume(tokenB, bindingB), true);
      assert.equal(proofStore.consume(tokenB, bindingB), false);

      proofNow += 101;
      assert.equal(proofStore.validate(tokenC, {
        inviteToken: "invite-c",
        doctorId: 3,
        phone: "13800138083"
      }), false);
      assert.equal(proofStore.consume(tokenC, {
        inviteToken: "invite-c",
        doctorId: 3,
        phone: "13800138083"
      }), false);

      let capacitySeed = 0;
      const capacityStore = createInviteProofStore({
        ttlMs: 1000,
        maxEntries: 5000,
        now: () => 20_000,
        randomBytes: (size) => {
          const bytes = Buffer.alloc(size);
          bytes.writeUInt32BE(capacitySeed++);
          return bytes;
        }
      });
      const firstCapacityBinding = {
        inviteToken: "capacity-0",
        doctorId: 1,
        phone: "13800138084"
      };
      const firstCapacityToken = capacityStore.issue(firstCapacityBinding);
      let latestCapacityToken = firstCapacityToken;
      let latestCapacityBinding = firstCapacityBinding;
      for(let index = 1; index <= 5000; index++){
        latestCapacityBinding = {
          inviteToken: "capacity-" + index,
          doctorId: 1,
          phone: "13800138084"
        };
        latestCapacityToken = capacityStore.issue(latestCapacityBinding);
      }
      assert.equal(
        capacityStore.validate(firstCapacityToken, firstCapacityBinding),
        false
      );
      assert.equal(
        capacityStore.validate(latestCapacityToken, latestCapacityBinding),
        true
      );
      console.log("ok - proof store 唯一、绑定、过期、容量和一次性消费");
    }

    {
      const codes = new Map();
      const throttle = new Map();
      const phone = "13800138090";
      const nowMs = 1_000_000;

      assert.equal(verifySmsCode({
        smsCodes: codes,
        smsThrottle: throttle,
        phone,
        code: "123456",
        now: () => nowMs
      }), "请先获取短信验证码");

      codes.set(phone, {
        code: "123456",
        expiresAt: nowMs - 1,
        attempts: 0
      });
      throttle.set(phone, nowMs - 100);
      assert.equal(verifySmsCode({
        smsCodes: codes,
        smsThrottle: throttle,
        phone,
        code: "123456",
        now: () => nowMs
      }), "验证码已过期，请重新获取");
      assert.equal(codes.has(phone), false);
      assert.equal(throttle.has(phone), true);

      codes.set(phone, {
        code: "123456",
        expiresAt: nowMs + 1000,
        attempts: 0
      });
      for (let attempt = 1; attempt <= 4; attempt++) {
        assert.equal(verifySmsCode({
          smsCodes: codes,
          smsThrottle: throttle,
          phone,
          code: "000000",
          now: () => nowMs
        }), "短信验证码错误");
        assert.equal(codes.get(phone).attempts, attempt);
      }
      assert.equal(verifySmsCode({
        smsCodes: codes,
        smsThrottle: throttle,
        phone,
        code: "000000",
        now: () => nowMs
      }), "验证码错误次数过多，请重新获取");
      assert.equal(codes.has(phone), false);
      assert.equal(throttle.has(phone), true);

      codes.set(phone, {
        code: "123456",
        expiresAt: nowMs + 1000,
        attempts: 0
      });
      throttle.set(phone, nowMs);
      assert.equal(verifySmsCode({
        smsCodes: codes,
        smsThrottle: throttle,
        phone,
        code: "123456",
        now: () => nowMs
      }), "");
      assert.equal(codes.has(phone), false);
      assert.equal(throttle.has(phone), false);
      assert.equal(verifySmsCode({
        smsCodes: codes,
        smsThrottle: throttle,
        phone,
        code: "123456",
        now: () => nowMs
      }), "请先获取短信验证码");
      console.log("ok - 生产短信 verifier 保持过期、错误锁定和一次性消费语义");
    }

    const doctor = db.prepare(
      "SELECT id FROM doctors ORDER BY id ASC LIMIT 1"
    ).get();
    assert.ok(doctor && doctor.id, "seed 应存在医生");
    const doctorId = +doctor.id;
    db.prepare("UPDATE doctors SET active=1 WHERE id=?").run(doctorId);
    const invite = inviteStore.ensureLink(doctorId, {
      rotate: true,
      note: "invite security test"
    });
    const inviteToken = invite.token;

    const getRes = await request("GET", `/api/invite/${inviteToken}`);
    assert.equal(getRes.statusCode, 200);
    assert.equal(getRes.payload.requireSms, true);
    assert.equal(getRes.payload.allowBoundSession, true);
    assert.equal(getRes.payload.smsAvailable, true);
    assert.equal(Object.prototype.hasOwnProperty.call(getRes.payload, "phone"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(getRes.payload, "patient"), false);
    console.log("ok - GET 仅公开验证能力，不泄露患者信息");

    {
      const malicious = "provider-secret-13800138199-<script>";
      const originalSend = smsProvider.sendVerificationCode;
      const originalConsoleError = console.error;
      const logs = [];
      smsProvider.sendVerificationCode = async () => {
        const error = new Error(malicious);
        error.userMessage = malicious;
        error.code = "sms_provider_error";
        throw error;
      };
      console.error = (...args) => logs.push(args.map(String).join(" "));
      let smsFailure;
      try {
        smsFailure = await request("POST", "/api/sms/send", {
          body: { phone: "13800138199", doctorId }
        });
      } finally {
        smsProvider.sendVerificationCode = originalSend;
        console.error = originalConsoleError;
      }
      assert.equal(smsFailure.statusCode, 502);
      assert.deepStrictEqual(smsFailure.payload, { error: "sms_send_failed" });
      assert.equal(JSON.stringify(smsFailure.payload).includes(malicious), false);
      assert.equal(logs.join("|").includes(malicious), false);
      assert.equal(logs.join("|").includes("13800138199"), false);
      console.log("ok - SMS provider 错误仅返回稳定 code 且日志不泄密");
    }

    const anonymousPhone = "13800138101";
    resolvePatient({
      doctorId,
      channel: "qiwe",
      externalId: "invite-anonymous-candidate",
      phone: anonymousPhone,
      phoneVerified: false,
      displayName: "匿名候选"
    });
    await assertRejectedWithoutWrites({
      name: "匿名提交在返回合并候选前被拒绝",
      inviteToken,
      body: validBody(doctorId, anonymousPhone),
      status: 401,
      error: "phone_verification_required"
    });

    const loginRes = await mpAuth.login({
      code: "invite-bound-account",
      doctorId
    });
    const boundPhone = "13800138102";
    const bindRes = await mpAuth.bindPhone({
      token: loginRes.mpToken,
      phone: boundPhone,
      smsCode: "000000",
      doctorId
    });
    assert.notEqual(bindRes.mpToken, loginRes.mpToken, "绑定后 token 应轮换");
    const ownerReadyVoucher = createVoucherMetadata(bindRes.mpToken);
    assert.equal(
      db.prepare("SELECT claimed_at FROM mp_private_files WHERE id=?")
        .get(ownerReadyVoucher.id).claimed_at,
      null
    );
    const ownerPendingVoucher = createVoucherMetadata(bindRes.mpToken, {
      state: "pending"
    });
    const otherLogin = await mpAuth.login({
      code: "invite-other-voucher-owner",
      doctorId
    });
    const otherBind = await mpAuth.bindPhone({
      token: otherLogin.mpToken,
      phone: "13800138130",
      smsCode: "000000",
      doctorId
    });
    const otherVoucher = createVoucherMetadata(otherBind.mpToken);

    await assertSubmitRejectedWithoutWrites({
      name: "普通联络表拒绝外部门诊凭证且零业务写入",
      inviteToken,
      body: contactSubmitBody(
        doctorId,
        boundPhone,
        "https://evil.example/voucher.pdf"
      ),
      headers: { authorization: `Bearer ${bindRes.mpToken}` },
      status: 400,
      error: "invalid_voucher_url"
    });

    await assertSubmitRejectedWithoutWrites({
      name: "普通联络表拒绝历史公开 uploads 凭证",
      inviteToken,
      body: contactSubmitBody(
        doctorId,
        boundPhone,
        "/uploads/patient-vouchers/legacy.pdf"
      ),
      headers: { authorization: `Bearer ${bindRes.mpToken}` },
      status: 400,
      error: "invalid_voucher_url"
    });

    for (const item of [
      {
        name: "普通联络表拒绝不存在的门诊凭证",
        url: "/api/patient/voucher/not-existing",
        status: 400,
        error: "voucher_unavailable"
      },
      {
        name: "普通联络表拒绝 pending 门诊凭证",
        url: ownerPendingVoucher.url,
        status: 400,
        error: "voucher_unavailable"
      },
      {
        name: "普通联络表拒绝其他患者门诊凭证",
        url: otherVoucher.url,
        status: 403,
        error: "voucher_forbidden"
      }
    ]) {
      await assertSubmitRejectedWithoutWrites({
        name: item.name,
        inviteToken,
        body: contactSubmitBody(doctorId, boundPhone, item.url),
        headers: { authorization: `Bearer ${bindRes.mpToken}` },
        status: item.status,
        error: item.error
      });
    }

    for (const item of [
      {
        name: "邀请提交拒绝外部门诊凭证且零业务写入",
        url: "https://evil.example/invite-voucher.pdf",
        status: 400,
        error: "invalid_voucher_url"
      },
      {
        name: "邀请提交拒绝历史公开 uploads 凭证",
        url: "/uploads/patient-vouchers/legacy.pdf",
        status: 400,
        error: "invalid_voucher_url"
      },
      {
        name: "邀请提交拒绝不存在的门诊凭证",
        url: "/api/patient/voucher/invite-not-existing",
        status: 400,
        error: "voucher_unavailable"
      },
      {
        name: "邀请提交拒绝 pending 门诊凭证",
        url: ownerPendingVoucher.url,
        status: 400,
        error: "voucher_unavailable"
      },
      {
        name: "邀请提交拒绝其他患者门诊凭证",
        url: otherVoucher.url,
        status: 403,
        error: "voucher_forbidden"
      }
    ]) {
      await assertRejectedWithoutWrites({
        name: item.name,
        inviteToken,
        body: validBody(doctorId, boundPhone, {
          outpatientVoucherUrl: item.url
        }),
        headers: { authorization: `Bearer ${bindRes.mpToken}` },
        status: item.status,
        error: item.error
      });
    }

    {
      const before = businessSnapshot(inviteToken);
      db.exec(`CREATE TRIGGER fail_invite_voucher_health_record
        BEFORE INSERT ON patient_health_records
        BEGIN
          SELECT RAISE(ABORT, 'forced_voucher_health_failure');
        END`);
      const originalConsoleError = console.error;
      console.error = () => {};
      let failed;
      try {
        failed = await request(
          "POST",
          `/api/invite/${inviteToken}/submit`,
          {
            body: validBody(doctorId, boundPhone, {
              outpatientVoucherUrl: ownerReadyVoucher.url
            }),
            headers: { authorization: `Bearer ${bindRes.mpToken}` }
          }
        );
      } finally {
        console.error = originalConsoleError;
        db.exec("DROP TRIGGER IF EXISTS fail_invite_voucher_health_record");
      }
      assert.equal(failed.statusCode, 500);
      assert.equal(failed.payload.error, "server_error");
      assert.equal(businessSnapshot(inviteToken), before);
      assert.equal(
        db.prepare("SELECT claimed_at FROM mp_private_files WHERE id=?")
          .get(ownerReadyVoucher.id).claimed_at,
        null
      );
      console.log("ok - 邀请凭证与档案写入同事务失败时完整回滚");
    }

    {
      const before = businessSnapshot(inviteToken);
      db.exec(`CREATE TRIGGER fail_submit_voucher_health_record
        BEFORE INSERT ON patient_health_records
        BEGIN
          SELECT RAISE(ABORT, 'forced_submit_voucher_health_failure');
        END`);
      const originalConsoleError = console.error;
      const logs = [];
      console.error = (...args) => logs.push(args.map(String).join(" "));
      let failed;
      try {
        failed = await request("POST", "/api/submit", {
          body: contactSubmitBody(
            doctorId,
            boundPhone,
            ownerReadyVoucher.url
          ),
          headers: { authorization: `Bearer ${bindRes.mpToken}` }
        });
      } finally {
        console.error = originalConsoleError;
        db.exec("DROP TRIGGER IF EXISTS fail_submit_voucher_health_record");
      }
      assert.equal(failed.statusCode, 500);
      assert.deepStrictEqual(failed.payload, { error: "submit_failed" });
      assert.equal(businessSnapshot(inviteToken), before);
      assert.equal(
        db.prepare("SELECT claimed_at FROM mp_private_files WHERE id=?")
          .get(ownerReadyVoucher.id).claimed_at,
        null
      );
      assert.deepStrictEqual(logs, ["[patient/submit] transaction_failed"]);
      console.log("ok - 普通联络表健康记录失败时完整回滚且返回稳定错误");
    }

    const ordinaryMp = await request("POST", "/api/submit", {
      body: contactSubmitBody(
        doctorId,
        boundPhone,
        ownerReadyVoucher.url
      ),
      headers: { authorization: `Bearer ${bindRes.mpToken}` }
    });
    assert.equal(ordinaryMp.statusCode, 200, JSON.stringify(ordinaryMp.payload));
    const ordinaryMpRecord = db.prepare(
      `SELECT doctor_id,patient_id,person_id,attachments
       FROM patient_health_records
       WHERE patient_id=? AND category='medical_certificate'`
    ).get(ownerReadyVoucher.patientId);
    assert.equal(ordinaryMpRecord.doctor_id, ownerReadyVoucher.doctorId);
    assert.equal(ordinaryMpRecord.patient_id, ownerReadyVoucher.patientId);
    assert.equal(ordinaryMpRecord.person_id, ownerReadyVoucher.personId);
    assert.equal(
      JSON.parse(ordinaryMpRecord.attachments)[0].url,
      ownerReadyVoucher.url
    );
    assert.ok(
      db.prepare("SELECT claimed_at FROM mp_private_files WHERE id=?")
        .get(ownerReadyVoucher.id).claimed_at
    );
    console.log("ok - 普通联络表按 MP 真实身份绑定 ready 凭证");

    const secondDoctor = db.prepare(
      "SELECT id FROM doctors WHERE id<>? ORDER BY id ASC LIMIT 1"
    ).get(doctorId);
    assert.ok(secondDoctor && secondDoctor.id);
    db.prepare("UPDATE doctors SET active=1 WHERE id=?").run(+secondDoctor.id);
    const secondDoctorPatientId = resolvePatient({
      doctorId:+secondDoctor.id,
      channel:"sms",
      externalId:`phone:${boundPhone}`,
      phone:boundPhone,
      phoneVerified:true,
      displayName:"跨医生凭证测试"
    });
    const secondDoctorPatient = db.prepare(
      "SELECT person_id FROM patients WHERE id=?"
    ).get(secondDoctorPatientId);
    const secondDoctorVoucher = {
      id:`cross-doctor-${crypto.randomBytes(8).toString("hex")}`,
      doctorId:+secondDoctor.id,
      patientId:+secondDoctorPatientId,
      personId:+secondDoctorPatient.person_id
    };
    secondDoctorVoucher.url = `/api/patient/voucher/${secondDoctorVoucher.id}`;
    db.prepare(`INSERT INTO mp_private_files(
      id,doctor_id,person_id,patient_id,storage_name,original_name,mime,
      size_bytes,created_at,state
    ) VALUES(?,?,?,?,?,?,?,?,?,?)`).run(
      secondDoctorVoucher.id,
      secondDoctorVoucher.doctorId,
      secondDoctorVoucher.personId,
      secondDoctorVoucher.patientId,
      `${secondDoctorVoucher.id}.pdf`,
      "voucher.pdf",
      "application/pdf",
      10,
      new Date().toISOString(),
      "ready"
    );
    assert.equal(secondDoctorVoucher.personId, ownerReadyVoucher.personId);
    assert.notEqual(secondDoctorVoucher.patientId, ownerReadyVoucher.patientId);

    const secondDoctorSmsCode = issueSms(boundPhone);
    const secondDoctorSubmit = await request("POST", "/api/submit", {
      body:contactSubmitBody(
        +secondDoctor.id,
        boundPhone,
        secondDoctorVoucher.url,
        { code:secondDoctorSmsCode }
      )
    });
    assert.equal(
      secondDoctorSubmit.statusCode,
      200,
      JSON.stringify(secondDoctorSubmit.payload)
    );
    const crossDoctorRecords = db.prepare(
      `SELECT doctor_id,patient_id,person_id,attachments
       FROM patient_health_records
       WHERE person_id=? AND category='medical_certificate'
       ORDER BY doctor_id`
    ).all(ownerReadyVoucher.personId);
    assert.equal(crossDoctorRecords.length, 2);
    assert.deepStrictEqual(
      crossDoctorRecords.map(row=>({
        doctorId:+row.doctor_id,
        patientId:+row.patient_id,
        personId:+row.person_id,
        url:JSON.parse(row.attachments)[0].url
      })),
      [
        {
          doctorId:ownerReadyVoucher.doctorId,
          patientId:ownerReadyVoucher.patientId,
          personId:ownerReadyVoucher.personId,
          url:ownerReadyVoucher.url
        },
        {
          doctorId:secondDoctorVoucher.doctorId,
          patientId:secondDoctorVoucher.patientId,
          personId:secondDoctorVoucher.personId,
          url:secondDoctorVoucher.url
        }
      ].sort((a,b)=>a.doctorId-b.doctorId)
    );
    console.log("ok - 同一 person 跨医生凭证健康记录按 doctor/patient 隔离");

    const smsVoucherCode = issueSms("13800138130");
    const ordinarySms = await request("POST", "/api/submit", {
      body: contactSubmitBody(
        doctorId,
        "13800138130",
        otherVoucher.url,
        { code: smsVoucherCode }
      )
    });
    assert.equal(ordinarySms.statusCode, 200, JSON.stringify(ordinarySms.payload));
    const ordinarySmsRecord = db.prepare(
      `SELECT doctor_id,patient_id,person_id,attachments
       FROM patient_health_records
       WHERE patient_id=? AND category='medical_certificate'`
    ).get(otherVoucher.patientId);
    assert.equal(ordinarySmsRecord.doctor_id, otherVoucher.doctorId);
    assert.equal(ordinarySmsRecord.patient_id, otherVoucher.patientId);
    assert.equal(ordinarySmsRecord.person_id, otherVoucher.personId);
    assert.equal(
      JSON.parse(ordinarySmsRecord.attachments)[0].url,
      otherVoucher.url
    );
    console.log("ok - 普通联络表按短信真实身份绑定 ready 凭证");

    const opaqueVoucherUrls = [
      ownerReadyVoucher.url,
      "/api/patient/voucher/opaque-not-existing",
      ownerPendingVoucher.url,
      otherVoucher.url
    ];
    for (const url of opaqueVoucherUrls) {
      smsCodes.delete(boundPhone);
      const before = businessSnapshot(inviteToken);
      const ordinaryOpaque = await request("POST", "/api/submit", {
        body: contactSubmitBody(doctorId, boundPhone, url)
      });
      assert.equal(ordinaryOpaque.statusCode, 400);
      assert.equal(ordinaryOpaque.payload.error, "请先获取短信验证码");
      assert.equal(businessSnapshot(inviteToken), before);

      const inviteOpaque = await request(
        "POST",
        `/api/invite/${inviteToken}/submit`,
        {
          body: validBody(doctorId, boundPhone, {
            outpatientVoucherUrl: url
          })
        }
      );
      assert.equal(inviteOpaque.statusCode, 401);
      assert.equal(inviteOpaque.payload.error, "phone_verification_required");
      assert.equal(businessSnapshot(inviteToken), before);
    }
    console.log("ok - 未验证手机号无法通过错误差异探测凭证存在性");

    const smsVoucherFailures = [
      {
        label: "非法 URL",
        url: "https://evil.example/sms-voucher.pdf",
        error: "invalid_voucher_url"
      },
      {
        label: "不存在文件",
        url: "/api/patient/voucher/sms-not-existing",
        error: "voucher_unavailable"
      },
      {
        label: "pending 文件",
        url: ownerPendingVoucher.url,
        error: "voucher_unavailable"
      },
      {
        label: "越权文件",
        url: otherVoucher.url,
        error: "voucher_unavailable"
      }
    ];
    for (const item of smsVoucherFailures) {
      const code = issueSms(boundPhone);
      const before = businessSnapshot(inviteToken);
      const rejected = await request("POST", "/api/submit", {
        body: contactSubmitBody(
          doctorId,
          boundPhone,
          item.url,
          { code }
        )
      });
      assert.equal(rejected.statusCode, 400, item.label);
      assert.equal(rejected.payload.error, item.error, item.label);
      assert.equal(businessSnapshot(inviteToken), before, item.label);
      assert.equal(smsCodes.get(boundPhone).code, code, item.label);

      const accepted = await request("POST", "/api/submit", {
        body: contactSubmitBody(
          doctorId,
          boundPhone,
          ownerReadyVoucher.url,
          { code }
        )
      });
      assert.equal(accepted.statusCode, 200, `${item.label}: ${JSON.stringify(accepted.payload)}`);
      assert.equal(smsCodes.has(boundPhone), false, item.label);
    }
    console.log("ok - 普通联络表错误凭证不消费短信且同码可改正");

    for (const item of smsVoucherFailures) {
      const code = issueSms(boundPhone);
      const before = businessSnapshot(inviteToken);
      const rejected = await request(
        "POST",
        `/api/invite/${inviteToken}/submit`,
        {
          body: validBody(doctorId, boundPhone, {
            smsCode: code,
            outpatientVoucherUrl: item.url
          })
        }
      );
      assert.equal(rejected.statusCode, 400, item.label);
      assert.equal(rejected.payload.error, item.error, item.label);
      assert.equal(businessSnapshot(inviteToken), before, item.label);
      assert.equal(smsCodes.get(boundPhone).code, code, item.label);

      const accepted = await request(
        "POST",
        `/api/invite/${inviteToken}/submit`,
        {
          body: validBody(doctorId, boundPhone, {
            smsCode: code,
            outpatientVoucherUrl: ownerReadyVoucher.url
          })
        }
      );
      assert.equal(accepted.statusCode, 200, `${item.label}: ${JSON.stringify(accepted.payload)}`);
      assert.equal(accepted.payload.ok, true, item.label);
      assert.equal(smsCodes.has(boundPhone), false, item.label);
    }
    console.log("ok - 邀请错误凭证不消费短信且同码可改正");

    await assertRejectedWithoutWrites({
      name: "Bearer 手机号不匹配优先返回 phone_mismatch",
      inviteToken,
      body: validBody(doctorId, "13800138103", { smsCode: "246810" }),
      headers: {
        authorization: `Bearer ${bindRes.mpToken}`,
        cookie: "psid=does-not-matter"
      },
      status: 403,
      error: "phone_mismatch"
    });

    await assertRejectedWithoutWrites({
      name: "非法 profile 不得覆盖无效 Bearer 的 unauthorized",
      inviteToken,
      body: invalidProfileBody(doctorId, "13800138109"),
      headers: { authorization: "Bearer invalid-token-profile" },
      status: 401,
      error: "unauthorized"
    });

    await assertRejectedWithoutWrites({
      name: "非法 profile 不得覆盖 Bearer 手机不匹配",
      inviteToken,
      body: invalidProfileBody(doctorId, "13800138110"),
      headers: { authorization: `Bearer ${bindRes.mpToken}` },
      status: 403,
      error: "phone_mismatch"
    });

    const unboundLogin = await mpAuth.login({
      code: "invite-unbound-account",
      doctorId
    });
    await assertRejectedWithoutWrites({
      name: "非法 profile 不得覆盖 Bearer 未绑手机",
      inviteToken,
      body: invalidProfileBody(doctorId, "13800138111"),
      headers: { authorization: `Bearer ${unboundLogin.mpToken}` },
      status: 401,
      error: "phone_verification_required"
    });

    await assertRejectedWithoutWrites({
      name: "无效 Bearer 不得降级到正确短信",
      inviteToken,
      body: validBody(doctorId, "13800138104", { smsCode: "246810" }),
      headers: { authorization: "Bearer invalid-token" },
      status: 401,
      error: "unauthorized"
    });

    issueSms("13800138105");
    await assertRejectedWithoutWrites({
      name: "错误短信验证码拒绝且不写库",
      inviteToken,
      body: validBody(doctorId, "13800138105", { smsCode: "111111" }),
      status: 400,
      error: "invalid_sms_code"
    });

    process.env.SMS_PROVIDER = "off";
    await assertRejectedWithoutWrites({
      name: "短信服务未配置返回 sms_unavailable",
      inviteToken,
      body: validBody(doctorId, "13800138106", { smsCode: "246810" }),
      status: 503,
      error: "sms_unavailable"
    });
    process.env.SMS_PROVIDER = "demo";

    const delayedSmsPhone = "13800138112";
    const delayedSmsCode = issueSms(delayedSmsPhone);
    const delayedBefore = businessSnapshot(inviteToken);
    const invalidProfileSmsRes = await request(
      "POST",
      `/api/invite/${inviteToken}/submit`,
      {
        body: invalidProfileBody(doctorId, delayedSmsPhone, {
          smsCode: delayedSmsCode
        })
      }
    );
    assert.equal(invalidProfileSmsRes.statusCode, 400);
    assert.equal(smsCodes.get(delayedSmsPhone).code, delayedSmsCode);
    assert.equal(businessSnapshot(inviteToken), delayedBefore);
    const fixedProfileSmsRes = await request(
      "POST",
      `/api/invite/${inviteToken}/submit`,
      {
        body: validBody(doctorId, delayedSmsPhone, {
          smsCode: delayedSmsCode
        })
      }
    );
    assert.equal(
      fixedProfileSmsRes.statusCode,
      200,
      JSON.stringify(fixedProfileSmsRes.payload)
    );
    assert.equal(smsCodes.has(delayedSmsPhone), false);
    console.log("ok - 无 Bearer 时非法 profile 不消费正确短信");

    const inviteOnlyVoucher = createVoucherMetadata(bindRes.mpToken);
    const bearerRes = await request(
      "POST",
      `/api/invite/${inviteToken}/submit`,
      {
        body: validBody(doctorId, boundPhone, {
          outpatientVoucherUrl: inviteOnlyVoucher.url
        }),
        headers: { authorization: `Bearer ${bindRes.mpToken}` }
      }
    );
    assert.equal(bearerRes.statusCode, 200, JSON.stringify(bearerRes.payload));
    assert.equal(bearerRes.payload.ok, true);
    assert.match(firstCookie(bearerRes.headers), /psid=/);
    const bearerPatient = db.prepare(
      "SELECT phone_verified FROM patients WHERE id=?"
    ).get(bearerRes.payload.patientId);
    assert.equal(bearerPatient.phone_verified, 1);
    const bearerVoucherRecord = db.prepare(
      `SELECT attachments FROM patient_health_records
       WHERE patient_id=? AND category='medical_certificate'`
    ).get(bearerRes.payload.patientId);
    assert.equal(
      JSON.parse(bearerVoucherRecord.attachments)[0].url,
      inviteOnlyVoucher.url
    );
    assert.ok(
      db.prepare("SELECT claimed_at FROM mp_private_files WHERE id=?")
        .get(inviteOnlyVoucher.id).claimed_at
    );
    console.log("ok - 匹配 Bearer 无短信成功且只绑定本人 ready 凭证");

    const psidCookie = firstCookie(bearerRes.headers);
    const ordinaryPsid = await request("POST", "/api/submit", {
      body: contactSubmitBody(
        doctorId,
        boundPhone,
        ownerReadyVoucher.url
      ),
      headers: { cookie: psidCookie }
    });
    assert.equal(ordinaryPsid.statusCode, 200, JSON.stringify(ordinaryPsid.payload));
    console.log("ok - 普通联络表按 psid 真实身份绑定 ready 凭证");

    const smsPhone = "13800138107";
    issueSms(smsPhone);
    const smsRes = await request(
      "POST",
      `/api/invite/${inviteToken}/submit`,
      {
        body: validBody(doctorId, smsPhone, { smsCode: "246810" })
      }
    );
    assert.equal(smsRes.statusCode, 200, JSON.stringify(smsRes.payload));
    assert.equal(smsRes.payload.ok, true);
    const smsPatient = db.prepare(
      `SELECT p.phone_verified, per.phone_verified AS person_verified
       FROM patients p
       LEFT JOIN persons per ON per.id=p.person_id
       WHERE p.id=?`
    ).get(smsRes.payload.patientId);
    assert.equal(smsPatient.phone_verified, 1);
    assert.equal(smsPatient.person_verified, 1);
    console.log("ok - 有效短信新建患者和人员均标记手机号已验证");

    const targetExternalUserId = "known-target-external-user";
    const targetPatientId = resolvePatient({
      doctorId,
      channel: "qiwe",
      externalId: targetExternalUserId,
      phone: "13800138113",
      phoneVerified: false,
      displayName: "劫持目标"
    });
    const attackerPhone = "13800138114";
    const attackerCode = issueSms(attackerPhone);
    const attackRes = await request(
      "POST",
      `/api/invite/${inviteToken}/submit`,
      {
        body: validBody(doctorId, attackerPhone, {
          smsCode: attackerCode,
          externalUserId: targetExternalUserId
        })
      }
    );
    assert.equal(attackRes.statusCode, 200, JSON.stringify(attackRes.payload));
    assert.notEqual(
      +attackRes.payload.patientId,
      +targetPatientId,
      "公开邀请不得按 body.externalUserId 定位目标患者"
    );
    const attackerPatient = db.prepare(
      "SELECT phone,phone_verified FROM patients WHERE id=?"
    ).get(attackRes.payload.patientId);
    assert.equal(attackerPatient.phone, attackerPhone);
    assert.equal(attackerPatient.phone_verified, 1);
    const targetAfterAttack = db.prepare(
      "SELECT display_name,phone,phone_verified FROM patients WHERE id=?"
    ).get(targetPatientId);
    assert.equal(targetAfterAttack.display_name, "劫持目标");
    assert.equal(targetAfterAttack.phone, "13800138113");
    assert.equal(targetAfterAttack.phone_verified, 0);
    console.log("ok - 公开邀请忽略 externalUserId 并按已验证手机建档");

    const mergePhone = "13800138115";
    const mergePatientId = resolvePatient({
      doctorId,
      channel: "qiwe",
      externalId: "invite-unverified-merge-candidate",
      phone: mergePhone,
      phoneVerified: false,
      displayName: "待确认候选"
    });
    const mergeCode = issueSms(mergePhone);
    const beforeProof = businessSnapshot(inviteToken);
    const proofRes = await request(
      "POST",
      `/api/invite/${inviteToken}/submit`,
      {
        body: validBody(doctorId, mergePhone, { smsCode: mergeCode })
      }
    );
    assert.equal(proofRes.statusCode, 200, JSON.stringify(proofRes.payload));
    assert.equal(proofRes.payload.ok, false);
    assert.equal(proofRes.payload.needsMergeConfirm, true);
    assert.match(
      String(proofRes.payload.verificationProof || ""),
      /^[A-Za-z0-9_-]{20,}$/
    );
    assert.equal(smsCodes.has(mergePhone), false, "首次验证应消费短信");
    assert.equal(businessSnapshot(inviteToken), beforeProof);

    const wrongProofBefore = businessSnapshot(inviteToken);
    const wrongProofRes = await request(
      "POST",
      `/api/invite/${inviteToken}/submit`,
      {
        body: validBody(doctorId, "13800138116", {
          verificationProof: proofRes.payload.verificationProof,
          confirmMergePatientId: mergePatientId
        })
      }
    );
    assert.equal(wrongProofRes.statusCode, 401);
    assert.equal(wrongProofRes.payload.error, "phone_verification_required");
    assert.equal(businessSnapshot(inviteToken), wrongProofBefore);

    const confirmRes = await request(
      "POST",
      `/api/invite/${inviteToken}/submit`,
      {
        body: validBody(doctorId, mergePhone, {
          verificationProof: proofRes.payload.verificationProof,
          confirmMergePatientId: mergePatientId
        })
      }
    );
    assert.equal(confirmRes.statusCode, 200, JSON.stringify(confirmRes.payload));
    assert.equal(confirmRes.payload.ok, true);
    assert.equal(+confirmRes.payload.patientId, +mergePatientId);
    const confirmedIdentity = db.prepare(
      `SELECT p.phone,p.phone_verified,per.phone AS person_phone,
        per.phone_verified AS person_verified
       FROM patients p
       LEFT JOIN persons per ON per.id=p.person_id
       WHERE p.id=?`
    ).get(mergePatientId);
    assert.equal(confirmedIdentity.phone, mergePhone);
    assert.equal(confirmedIdentity.phone_verified, 1);
    assert.equal(confirmedIdentity.person_phone, mergePhone);
    assert.equal(confirmedIdentity.person_verified, 1);

    const replayBefore = businessSnapshot(inviteToken);
    const replayRes = await request(
      "POST",
      `/api/invite/${inviteToken}/submit`,
      {
        body: validBody(doctorId, mergePhone, {
          verificationProof: proofRes.payload.verificationProof,
          confirmMergePatientId: mergePatientId
        })
      }
    );
    assert.equal(replayRes.statusCode, 401);
    assert.equal(replayRes.payload.error, "phone_verification_required");
    assert.equal(businessSnapshot(inviteToken), replayBefore);
    console.log("ok - 短信 proof 绑定身份、确认时消费且不可重放");

    const submissionRollbackPhone = "13800138118";
    const submissionRollbackPatientId = resolvePatient({
      doctorId,
      channel: "qiwe",
      externalId: "invite-submission-rollback",
      phone: submissionRollbackPhone,
      phoneVerified: false,
      displayName: "提交回滚候选"
    });
    const submissionRollbackCode = issueSms(submissionRollbackPhone);
    const submissionProofRes = await request(
      "POST",
      `/api/invite/${inviteToken}/submit`,
      {
        body: validBody(doctorId, submissionRollbackPhone, {
          smsCode: submissionRollbackCode
        })
      }
    );
    assert.equal(submissionProofRes.statusCode, 200);
    assert.ok(submissionProofRes.payload.verificationProof);
    const submissionRollbackBefore = businessSnapshot(inviteToken);
    db.exec(`CREATE TRIGGER fail_invite_submission
      BEFORE INSERT ON submissions
      BEGIN
        SELECT RAISE(ABORT, 'forced_submission_failure');
      END`);
    let submissionFailureRes;
    try {
      submissionFailureRes = await request(
        "POST",
        `/api/invite/${inviteToken}/submit`,
        {
          body: validBody(doctorId, submissionRollbackPhone, {
            verificationProof: submissionProofRes.payload.verificationProof,
            confirmMergePatientId: submissionRollbackPatientId
          })
        }
      );
    } finally {
      db.exec("DROP TRIGGER IF EXISTS fail_invite_submission");
    }
    assert.equal(submissionFailureRes.statusCode, 500);
    assert.equal(submissionFailureRes.payload.error, "server_error");
    assert.equal(businessSnapshot(inviteToken), submissionRollbackBefore);
    const submissionRetryRes = await request(
      "POST",
      `/api/invite/${inviteToken}/submit`,
      {
        body: validBody(doctorId, submissionRollbackPhone, {
          verificationProof: submissionProofRes.payload.verificationProof,
          confirmMergePatientId: submissionRollbackPatientId
        })
      }
    );
    assert.equal(
      submissionRetryRes.statusCode,
      200,
      JSON.stringify(submissionRetryRes.payload)
    );
    console.log("ok - submissions 后段失败完整回滚且 proof 可重试");

    const sessionRollbackPhone = "13800138119";
    const sessionRollbackPatientId = resolvePatient({
      doctorId,
      channel: "qiwe",
      externalId: "invite-session-rollback",
      phone: sessionRollbackPhone,
      phoneVerified: false,
      displayName: "会话回滚候选"
    });
    const sessionRollbackCode = issueSms(sessionRollbackPhone);
    const sessionProofRes = await request(
      "POST",
      `/api/invite/${inviteToken}/submit`,
      {
        body: validBody(doctorId, sessionRollbackPhone, {
          smsCode: sessionRollbackCode
        })
      }
    );
    assert.equal(sessionProofRes.statusCode, 200);
    assert.ok(sessionProofRes.payload.verificationProof);
    const sessionRollbackBefore = businessSnapshot(inviteToken);
    db.exec(`CREATE TRIGGER fail_invite_session
      BEFORE INSERT ON patient_sessions
      BEGIN
        SELECT RAISE(ABORT, 'forced_session_failure');
      END`);
    let sessionFailureRes;
    try {
      sessionFailureRes = await request(
        "POST",
        `/api/invite/${inviteToken}/submit`,
        {
          body: validBody(doctorId, sessionRollbackPhone, {
            verificationProof: sessionProofRes.payload.verificationProof,
            confirmMergePatientId: sessionRollbackPatientId
          })
        }
      );
    } finally {
      db.exec("DROP TRIGGER IF EXISTS fail_invite_session");
    }
    assert.equal(sessionFailureRes.statusCode, 500);
    assert.equal(sessionFailureRes.payload.error, "server_error");
    assert.equal(businessSnapshot(inviteToken), sessionRollbackBefore);
    const sessionRetryRes = await request(
      "POST",
      `/api/invite/${inviteToken}/submit`,
      {
        body: validBody(doctorId, sessionRollbackPhone, {
          verificationProof: sessionProofRes.payload.verificationProof,
          confirmMergePatientId: sessionRollbackPatientId
        })
      }
    );
    assert.equal(
      sessionRetryRes.statusCode,
      200,
      JSON.stringify(sessionRetryRes.payload)
    );
    console.log("ok - patient_sessions 后段失败完整回滚且 proof 可重试");

    const concurrentPhone = "13800138120";
    const concurrentPatientId = resolvePatient({
      doctorId,
      channel: "qiwe",
      externalId: "invite-proof-concurrent",
      phone: concurrentPhone,
      phoneVerified: false,
      displayName: "并发确认候选"
    });
    const concurrentCode = issueSms(concurrentPhone);
    const concurrentProofRes = await request(
      "POST",
      `/api/invite/${inviteToken}/submit`,
      {
        body: validBody(doctorId, concurrentPhone, {
          smsCode: concurrentCode
        })
      }
    );
    assert.equal(concurrentProofRes.statusCode, 200);
    const concurrentProof = concurrentProofRes.payload.verificationProof;
    assert.ok(concurrentProof);
    const submissionsBeforeConcurrent = db.prepare(
      "SELECT COUNT(*) AS count FROM submissions"
    ).get().count;
    const useCountBeforeConcurrent = db.prepare(
      "SELECT use_count FROM patient_invite_links WHERE token=?"
    ).get(inviteToken).use_count;
    const concurrentBody = validBody(doctorId, concurrentPhone, {
      verificationProof: concurrentProof,
      confirmMergePatientId: concurrentPatientId
    });
    const concurrentResults = await Promise.all([
      request("POST", `/api/invite/${inviteToken}/submit`, {
        body: concurrentBody
      }),
      request("POST", `/api/invite/${inviteToken}/submit`, {
        body: concurrentBody
      })
    ]);
    assert.deepEqual(
      concurrentResults.map((res) => res.statusCode).sort((a, b) => a - b),
      [200, 401]
    );
    assert.equal(
      concurrentResults.find((res) => res.statusCode === 401).payload.error,
      "phone_verification_required"
    );
    assert.equal(
      db.prepare("SELECT COUNT(*) AS count FROM submissions").get().count,
      submissionsBeforeConcurrent + 1
    );
    assert.equal(
      db.prepare(
        "SELECT use_count FROM patient_invite_links WHERE token=?"
      ).get(inviteToken).use_count,
      useCountBeforeConcurrent + 1
    );
    console.log("ok - 并发重放恰好一个成功且只写一次");

    const conflictPhone = "13800138117";
    const conflictNow = new Date().toISOString();
    const conflictPersonId = Number(db.prepare(
      `INSERT INTO persons(phone,phone_verified,created_at,updated_at)
       VALUES(?,?,?,?)`
    ).run("13800138999", 0, conflictNow, conflictNow).lastInsertRowid);
    const conflictPatientId = Number(db.prepare(
      `INSERT INTO patients(
        doctor_id,person_id,display_name,phone,phone_verified,
        tags,follow_stage,notes,created_at,updated_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?)`
    ).run(
      doctorId,
      conflictPersonId,
      "身份冲突候选",
      conflictPhone,
      0,
      "[]",
      "",
      "",
      conflictNow,
      conflictNow
    ).lastInsertRowid);
    const conflictCode = issueSms(conflictPhone);
    const conflictProofRes = await request(
      "POST",
      `/api/invite/${inviteToken}/submit`,
      {
        body: validBody(doctorId, conflictPhone, { smsCode: conflictCode })
      }
    );
    assert.equal(conflictProofRes.statusCode, 200);
    assert.equal(conflictProofRes.payload.needsMergeConfirm, true);
    assert.ok(conflictProofRes.payload.verificationProof);
    const conflictBefore = businessSnapshot(inviteToken);
    const conflictRes = await request(
      "POST",
      `/api/invite/${inviteToken}/submit`,
      {
        body: validBody(doctorId, conflictPhone, {
          verificationProof: conflictProofRes.payload.verificationProof,
          confirmMergePatientId: conflictPatientId
        })
      }
    );
    assert.equal(conflictRes.statusCode, 409);
    assert.equal(conflictRes.payload.error, "phone_identity_conflict");
    assert.equal(businessSnapshot(inviteToken), conflictBefore);
    console.log("ok - person 已有不同手机号时拒绝确认且不写业务数据");

    const psidPhone = "13800138108";
    const psidPatientId = resolvePatient({
      doctorId,
      channel: "sms",
      externalId: "phone:" + psidPhone,
      phone: psidPhone,
      phoneVerified: true,
      displayName: "网页会话患者"
    });
    const psid = inviteStore.createSession({
      doctorId,
      patientId: psidPatientId,
      ttlDays: 1
    });
    const psidRes = await request(
      "POST",
      `/api/invite/${inviteToken}/submit`,
      {
        body: validBody(doctorId, psidPhone),
        headers: { cookie: `psid=${encodeURIComponent(psid)}` }
      }
    );
    assert.equal(psidRes.statusCode, 200, JSON.stringify(psidRes.payload));
    assert.equal(psidRes.payload.ok, true);
    console.log("ok - 匹配 psid 网页会话无需短信成功");

    assert.equal(smsProvider.isConfigured(), true);
    console.log("PASS - invite security routes");
  } catch (error) {
    testError = error;
  } finally {
    let cleanupError = null;
    try {
      if (patientPublicLifecycle && typeof patientPublicLifecycle.dispose === "function") {
        await patientPublicLifecycle.dispose();
      }
    } catch (error) {
      cleanupError = error;
    }
    try {
      db.close();
    } catch (error) {
      if(!cleanupError) cleanupError = error;
    }
    for (const file of [dbPath, dbPath + "-wal", dbPath + "-shm"]) {
      try {
        fs.unlinkSync(file);
      } catch (error) {
        if(error && error.code === "ENOENT") continue;
        if(!cleanupError) cleanupError = error;
      }
    }
    if(testError){
      if(cleanupError){
        console.error("cleanup failed:", cleanupError.stack || cleanupError);
      }
      throw testError;
    }
    if(cleanupError) throw cleanupError;
  }
})().catch((error) => {
  console.error(error && (error.stack || error));
  process.exitCode = 1;
});
