"use strict";
const assert = require("assert");
const path = require("path");
const fs = require("fs");
const os = require("os");
const crypto = require("crypto");

process.env.MP_AUTH_STUB = "1";
process.env.DB_PATH = path.join(
  os.tmpdir(),
  `mp-auth-${process.pid}-${crypto.randomBytes(6).toString("hex")}.db`
);
if (fs.existsSync(process.env.DB_PATH)) fs.unlinkSync(process.env.DB_PATH);

const { db, resolvePatient } = require("./db.js");
const personApi = require("./person.js");
const mpAuth = require("./mp_auth.js");

async function test(name, fn) {
  try {
    await fn();
    console.log("ok -", name);
  } catch (e) {
    console.error("fail -", name);
    throw e;
  }
}

async function rejectsWithCode(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.equal(error && error.message, code);
    return true;
  });
}

function insertRawSession({
  token,
  openid,
  doctorId,
  createdAt = "2026-01-01T00:00:00.000Z",
  expiresAt = "2099-01-01T00:00:00.000Z",
  lastSeenAt = "2000-01-01T00:00:00.000Z"
}) {
  db.prepare(`INSERT INTO mp_sessions(
    token, openid, doctor_id, person_id, patient_id, phone_bound,
    created_at, expires_at, last_seen_at, revoked_at
  ) VALUES(?,?,?,?,?,?,?,?,?,NULL)`).run(
    token,
    openid,
    doctorId,
    null,
    null,
    0,
    createdAt,
    expiresAt,
    lastSeenAt
  );
}

(async () => {
  try {
  await test("findOrCreateByVerifiedPhone 同号复用同一 person", () => {
    const a = personApi.findOrCreateByVerifiedPhone({ phone: "13800138000", realName: "甲" });
    const b = personApi.findOrCreateByVerifiedPhone({ phone: "13800138000", realName: "乙" });
    assert.equal(a.id, b.id);
    assert.equal(a.phone_verified, 1);
  });

  await test("bindMpOpenid 写入 persons.mp_openid", () => {
    const p = personApi.findOrCreateByVerifiedPhone({ phone: "13800138001" });
    personApi.bindMpOpenid(p.id, "oid-test-1");
    const row = db.prepare("SELECT mp_openid FROM persons WHERE id=?").get(p.id);
    assert.equal(row.mp_openid, "oid-test-1");
  });

  const doctors = db.prepare("SELECT id, active FROM doctors ORDER BY id ASC").all();
  assert.ok(doctors.length >= 2, "seed 应至少有 2 位医生");
  const doctorA = doctors[0].id;
  const doctorB = doctors[1].id;
  const inactiveDoctor = +db.prepare(
    "INSERT INTO doctors(slug,name,active) VALUES(?,?,0)"
  ).run("mp-auth-inactive-" + process.pid, "停用医生夹具").lastInsertRowid;
  const crossDoctorCode = "cross-doctor-account-" + Date.now();

  await test("storageScopeId remains stable, isolated and opaque", () => {
    const personA = personApi.findOrCreateByVerifiedPhone({ phone: "13800138101" });
    const personB = personApi.findOrCreateByVerifiedPhone({ phone: "13800138102" });
    const sameA = mpAuth.getOrCreateStorageScopeId(personA.id, doctorA);
    const sameB = mpAuth.getOrCreateStorageScopeId(personA.id, doctorA);
    const otherPerson = mpAuth.getOrCreateStorageScopeId(personB.id, doctorA);
    const otherDoctor = mpAuth.getOrCreateStorageScopeId(personA.id, doctorB);

    assert.equal(sameA, sameB);
    assert.notEqual(sameA, otherPerson);
    assert.notEqual(sameA, otherDoctor);
    assert.match(sameA, /^mps_[A-Za-z0-9_-]{43}$/);
    assert.notEqual(sameA, String(personA.id));
    assert.doesNotMatch(sameA, new RegExp(`d${doctorA}[:_-]`));
    assert.doesNotMatch(sameA, new RegExp(`p${personA.id}[:_-]`));
    const row = db.prepare(
      "SELECT scope_id FROM mp_storage_scopes WHERE person_id=? AND doctor_id=?"
    ).get(personA.id, doctorA);
    assert.equal(row.scope_id, sameA);
  });

  await test("legacy session lazily receives a stable storageScopeId", () => {
    const person = personApi.findOrCreateByVerifiedPhone({ phone: "13800138103" });
    const openid = "legacy-scope-" + Date.now();
    personApi.bindMpOpenid(person.id, openid);
    const patientId = mpAuth.attachPatientForDoctor({
      doctorId: doctorA,
      person,
      phone: person.phone
    });
    const token = mpAuth.createMpSession({
      openid,
      doctorId: doctorA,
      personId: person.id,
      patientId,
      phoneBound: true
    });

    const first = mpAuth.me(token);
    const second = mpAuth.me(token);
    assert.match(first.storageScopeId, /^mps_[A-Za-z0-9_-]{43}$/);
    assert.equal(second.storageScopeId, first.storageScopeId);
    assert.equal(
      db.prepare(
        "SELECT COUNT(*) AS c FROM mp_storage_scopes WHERE person_id=? AND doctor_id=?"
      ).get(person.id, doctorA).c,
      1
    );
  });

  // 跨医生夹具必须显式可登录；失活医生使用独立插入夹具。
  db.prepare("UPDATE doctors SET active=1 WHERE id IN (?,?)").run(doctorA, doctorB);

  await test("login 缺 doctorId 拒绝且不创建 session", async () => {
    const before = db.prepare("SELECT COUNT(*) AS c FROM mp_sessions").get().c;
    await rejectsWithCode(
      mpAuth.login({ code: "doctor-required-" + Date.now() }),
      "doctor_required"
    );
    const after = db.prepare("SELECT COUNT(*) AS c FROM mp_sessions").get().c;
    assert.equal(after, before);
  });

  await test("login 拒绝不存在或 inactive 医生且不创建 session", async () => {
    const before = db.prepare("SELECT COUNT(*) AS c FROM mp_sessions").get().c;
    await rejectsWithCode(
      mpAuth.login({ code: "doctor-missing-" + Date.now(), doctorId: 999999 }),
      "doctor_unavailable"
    );
    await rejectsWithCode(
      mpAuth.login({ code: "doctor-inactive-" + Date.now(), doctorId: inactiveDoctor }),
      "doctor_unavailable"
    );
    const after = db.prepare("SELECT COUNT(*) AS c FROM mp_sessions").get().c;
    assert.equal(after, before);
  });

  await test("login 同一 OpenID 撤销旧 token 并仅保留一个有效 session", async () => {
    const code = "rotate-login-" + Date.now();
    const first = await mpAuth.login({ code, doctorId: doctorA });
    const second = await mpAuth.login({ code, doctorId: doctorA });
    assert.notEqual(second.mpToken, first.mpToken);
    const rows = db.prepare(
      "SELECT token, revoked_at FROM mp_sessions WHERE openid=? ORDER BY created_at ASC"
    ).all(second.openid);
    assert.equal(rows.length, 2);
    assert.ok(rows.find((row) => row.token === first.mpToken).revoked_at);
    assert.equal(rows.filter((row) => !row.revoked_at).length, 1);
    assert.equal(rows.find((row) => !row.revoked_at).token, second.mpToken);
    assert.throws(() => mpAuth.me(first.mpToken), /unauthorized/);
    assert.equal(mpAuth.me(second.mpToken).mpToken, second.mpToken);
  });

  await test("历史重复活动 session 只允许 created_at/rowid 最新 token", () => {
    const prev = process.env.MP_SESSION_COMPAT;
    process.env.MP_SESSION_COMPAT = "0";
    try {
      const openid = "legacy-duplicate-" + Date.now();
      const oldToken = "legacy-old-" + crypto.randomBytes(8).toString("hex");
      const latestToken = "legacy-latest-" + crypto.randomBytes(8).toString("hex");
      const sameCreatedAt = "2026-07-01T00:00:00.000Z";
      insertRawSession({
        token: oldToken,
        openid,
        doctorId: doctorA,
        createdAt: sameCreatedAt
      });
      insertRawSession({
        token: latestToken,
        openid,
        doctorId: doctorA,
        createdAt: sameCreatedAt
      });

      assert.throws(() => mpAuth.requireSession(oldToken), /unauthorized/);
      assert.equal(
        db.prepare("SELECT last_seen_at FROM mp_sessions WHERE token=?").get(oldToken).last_seen_at,
        "2000-01-01T00:00:00.000Z"
      );
      assert.equal(mpAuth.me(latestToken).mpToken, latestToken);
    } finally {
      if (prev === undefined) delete process.env.MP_SESSION_COMPAT;
      else process.env.MP_SESSION_COMPAT = prev;
    }
  });

  await test("compat on: 同 OpenID 旧未撤销 token 仍可鉴权", () => {
    const prev = process.env.MP_SESSION_COMPAT;
    process.env.MP_SESSION_COMPAT = "1";
    try {
      const openid = "compat-dup-" + Date.now();
      const older = "compat-old-" + crypto.randomBytes(8).toString("hex");
      const newer = "compat-new-" + crypto.randomBytes(8).toString("hex");
      insertRawSession({
        token: older,
        openid,
        doctorId: doctorA,
        createdAt: "2026-07-01T00:00:00.000Z"
      });
      insertRawSession({
        token: newer,
        openid,
        doctorId: doctorA,
        createdAt: "2026-07-02T00:00:00.000Z"
      });
      assert.equal(mpAuth.requireSession(older).openid, openid);
      assert.equal(mpAuth.requireSession(newer).openid, openid);
    } finally {
      if (prev === undefined) delete process.env.MP_SESSION_COMPAT;
      else process.env.MP_SESSION_COMPAT = prev;
    }
  });

  await test("compat off: 仅最新未撤销 token 可鉴权", () => {
    const prev = process.env.MP_SESSION_COMPAT;
    process.env.MP_SESSION_COMPAT = "0";
    try {
      const openid = "compat-off-" + Date.now();
      const older = "compat-off-old-" + crypto.randomBytes(8).toString("hex");
      const newer = "compat-off-new-" + crypto.randomBytes(8).toString("hex");
      insertRawSession({
        token: older,
        openid,
        doctorId: doctorA,
        createdAt: "2026-07-01T00:00:00.000Z"
      });
      insertRawSession({
        token: newer,
        openid,
        doctorId: doctorA,
        createdAt: "2026-07-02T00:00:00.000Z"
      });
      assert.throws(() => mpAuth.requireSession(older), /unauthorized/);
      assert.equal(mpAuth.requireSession(newer).openid, openid);
    } finally {
      if (prev === undefined) delete process.env.MP_SESSION_COMPAT;
      else process.env.MP_SESSION_COMPAT = prev;
    }
  });

  await test("compat on: login 仍会撤销同 OpenID 旧 session", async () => {
    const prev = process.env.MP_SESSION_COMPAT;
    process.env.MP_SESSION_COMPAT = "1";
    try {
      const code = "compat-rotate-" + Date.now();
      const before = await mpAuth.login({ code, doctorId: doctorA });
      const after = await mpAuth.login({ code, doctorId: doctorA });
      assert.throws(() => mpAuth.requireSession(before.mpToken), /unauthorized/);
      assert.equal(mpAuth.requireSession(after.mpToken).openid, after.openid);
    } finally {
      if (prev === undefined) delete process.env.MP_SESSION_COMPAT;
      else process.env.MP_SESSION_COMPAT = prev;
    }
  });

  await test("compat on: 存量缺医生/停用医生会话读路径不 401，写路径仍拒绝", () => {
    const prev = process.env.MP_SESSION_COMPAT;
    process.env.MP_SESSION_COMPAT = "1";
    try {
      const softMissing = "compat-soft-missing-" + crypto.randomBytes(6).toString("hex");
      const softInactive = "compat-soft-inactive-" + crypto.randomBytes(6).toString("hex");
      insertRawSession({
        token: softMissing,
        openid: "compat-soft-missing-" + Date.now(),
        doctorId: null
      });
      insertRawSession({
        token: softInactive,
        openid: "compat-soft-inactive-" + Date.now(),
        doctorId: inactiveDoctor
      });
      assert.equal(mpAuth.requireSession(softMissing).token, softMissing);
      assert.equal(mpAuth.requireSession(softInactive).token, softInactive);
      assert.throws(() => mpAuth.requireBoundSession(softMissing), /unauthorized|account_not_bound/);
      assert.throws(() => mpAuth.requireBoundSession(softInactive), /unauthorized|account_not_bound/);
    } finally {
      if (prev === undefined) delete process.env.MP_SESSION_COMPAT;
      else process.env.MP_SESSION_COMPAT = prev;
    }
  });

  await test("session 对缺失非法过期时间和不可用医生 fail-closed", () => {
    const prev = process.env.MP_SESSION_COMPAT;
    process.env.MP_SESSION_COMPAT = "0";
    try {
    const cases = [
      {
        token: "missing-exp-" + crypto.randomBytes(6).toString("hex"),
        openid: "missing-exp-" + crypto.randomBytes(6).toString("hex"),
        doctorId: doctorA,
        expiresAt: null,
        error: "session_expired"
      },
      {
        token: "invalid-exp-" + crypto.randomBytes(6).toString("hex"),
        openid: "invalid-exp-" + crypto.randomBytes(6).toString("hex"),
        doctorId: doctorA,
        expiresAt: "not-a-date",
        error: "session_expired"
      },
      {
        token: "expired-" + crypto.randomBytes(6).toString("hex"),
        openid: "expired-" + crypto.randomBytes(6).toString("hex"),
        doctorId: doctorA,
        expiresAt: "2001-01-01T00:00:00.000Z",
        error: "session_expired"
      },
      {
        token: "missing-doctor-" + crypto.randomBytes(6).toString("hex"),
        openid: "missing-doctor-" + crypto.randomBytes(6).toString("hex"),
        doctorId: null,
        error: "unauthorized"
      },
      {
        token: "inactive-doctor-" + crypto.randomBytes(6).toString("hex"),
        openid: "inactive-doctor-" + crypto.randomBytes(6).toString("hex"),
        doctorId: inactiveDoctor,
        error: "unauthorized"
      },
      {
        token: "unknown-doctor-" + crypto.randomBytes(6).toString("hex"),
        openid: "unknown-doctor-" + crypto.randomBytes(6).toString("hex"),
        doctorId: 999999,
        error: "unauthorized"
      }
    ];
    for (const item of cases) {
      insertRawSession(item);
      assert.throws(
        () => mpAuth.requireSession(item.token),
        (error) => error && error.message === item.error,
        item.token
      );
      assert.equal(
        db.prepare("SELECT last_seen_at FROM mp_sessions WHERE token=?").get(item.token).last_seen_at,
        "2000-01-01T00:00:00.000Z"
      );
    }
    } finally {
      if (prev === undefined) delete process.env.MP_SESSION_COMPAT;
      else process.env.MP_SESSION_COMPAT = prev;
    }
  });

  await test("bindPhone 同医生已验证同号 merge 到同一 patient", async () => {
    const phone = "13800138111";
    const existingPid = resolvePatient({
      doctorId: doctorA,
      channel: "sms",
      externalId: "phone:" + phone,
      phone,
      phoneVerified: true,
      displayName: ""
    });
    assert.ok(existingPid);

    const loginRes = await mpAuth.login({ code: crossDoctorCode, doctorId: doctorA });
    assert.ok(loginRes.mpToken);
    assert.equal(loginRes.phoneBound, false);

    const bindRes = await mpAuth.bindPhone({
      token: loginRes.mpToken,
      phone,
      smsCode: "000000",
      doctorId: doctorA
    });
    assert.ok(bindRes.mpToken);
    assert.notEqual(bindRes.mpToken, loginRes.mpToken);
    assert.throws(() => mpAuth.me(loginRes.mpToken), /unauthorized/);
    const oldSession = db.prepare(
      "SELECT revoked_at FROM mp_sessions WHERE token=?"
    ).get(loginRes.mpToken);
    assert.ok(oldSession.revoked_at);
    assert.equal(bindRes.patientId, existingPid);
    assert.ok(bindRes.personId);
    const pt = db.prepare("SELECT person_id, phone_verified FROM patients WHERE id=?").get(existingPid);
    assert.equal(pt.person_id, bindRes.personId);
    assert.equal(pt.phone_verified, 1);
  });

  await test("bindPhone 跨医生: 同号同 person、不同 patient", async () => {
    const phone = "13800138111";
    const personA = personApi.findOrCreateByVerifiedPhone({ phone });
    const loginRes = await mpAuth.login({ code: crossDoctorCode, doctorId: doctorB });
    const bindRes = await mpAuth.bindPhone({
      token: loginRes.mpToken,
      phone,
      smsCode: "000000",
      doctorId: doctorB
    });
    assert.equal(bindRes.personId, personA.id);
    const underA = db.prepare(
      "SELECT id FROM patients WHERE doctor_id=? AND person_id=? LIMIT 1"
    ).get(doctorA, personA.id);
    assert.ok(underA);
    assert.notEqual(bindRes.patientId, underA.id);
  });

  await test("hasProfile 需姓名+已验证手机", async () => {
    const phone = "13800138222";
    const loginRes = await mpAuth.login({ code: "profile-" + Date.now(), doctorId: doctorA });
    const bindRes = await mpAuth.bindPhone({
      token: loginRes.mpToken,
      phone,
      smsCode: "000000",
      doctorId: doctorA
    });
    assert.equal(bindRes.hasProfile, false);
    const me1 = mpAuth.me(bindRes.mpToken);
    assert.equal(me1.hasProfile, false);

    db.prepare("UPDATE persons SET real_name=? WHERE id=?").run("档案测", bindRes.personId);
    const me2 = mpAuth.me(bindRes.mpToken);
    assert.equal(me2.hasProfile, true);
    assert.equal(me2.phoneMasked, "138****8222");
    assert.ok(typeof me2.expiresIn === "number" && me2.expiresIn > 0);
    assert.deepEqual(me2.profileSummary, { name: "档案测", avatarUrl: "" });
  });

  await test("bindPhone 无效短信不触碰 last_seen_at 或业务表", async () => {
    const loginRes = await mpAuth.login({
      code: "invalid-sms-no-write-" + Date.now(),
      doctorId: doctorA
    });
    const sentinel = "2000-01-01T00:00:00.000Z";
    db.prepare("UPDATE mp_sessions SET last_seen_at=? WHERE token=?")
      .run(sentinel, loginRes.mpToken);
    const snapshot = () => ({
      persons: db.prepare("SELECT * FROM persons ORDER BY id ASC").all(),
      patients: db.prepare("SELECT * FROM patients ORDER BY id ASC").all(),
      sessions: db.prepare("SELECT * FROM mp_sessions ORDER BY token ASC").all()
    });
    const before = snapshot();

    await rejectsWithCode(
      mpAuth.bindPhone({
        token: loginRes.mpToken,
        phone: "13800138321",
        smsCode: "bad",
        doctorId: doctorA
      }),
      "invalid_sms_code"
    );

    assert.deepStrictEqual(snapshot(), before);
    assert.equal(
      db.prepare("SELECT last_seen_at FROM mp_sessions WHERE token=?").get(loginRes.mpToken).last_seen_at,
      sentinel
    );
  });

  await test("assertSmsOk 归一业务错误且服务未配置统一 sms_unavailable", () => {
    const previousStub = process.env.MP_AUTH_STUB;
    const previousAppId = process.env.WECHAT_MP_APP_ID;
    process.env.MP_AUTH_STUB = "0";
    process.env.WECHAT_MP_APP_ID = "test-app-id";
    try {
      mpAuth.setSmsVerifier(() => "验证码已过期，请重新获取");
      assert.throws(
        () => mpAuth.assertSmsOk("13800138322", "123456"),
        /invalid_sms_code/
      );
      mpAuth.setSmsVerifier(() => "sms_not_configured");
      assert.throws(
        () => mpAuth.assertSmsOk("13800138322", "123456"),
        /sms_unavailable/
      );
      mpAuth.setSmsVerifier(null);
      assert.throws(
        () => mpAuth.assertSmsOk("13800138322", "123456"),
        /sms_unavailable/
      );
    } finally {
      mpAuth.setSmsVerifier(null);
      if (previousStub == null) delete process.env.MP_AUTH_STUB;
      else process.env.MP_AUTH_STUB = previousStub;
      if (previousAppId == null) delete process.env.WECHAT_MP_APP_ID;
      else process.env.WECHAT_MP_APP_ID = previousAppId;
    }
  });

  await test("bindPhone 验证或目标冲突失败时保留原绑定和 token", async () => {
    const code = "atomic-rebind-" + Date.now();
    const firstPhone = "13800138331";
    const occupiedPhone = "13800138332";
    const loginRes = await mpAuth.login({ code, doctorId: doctorA });
    const firstBind = await mpAuth.bindPhone({
      token: loginRes.mpToken,
      phone: firstPhone,
      smsCode: "000000",
      doctorId: doctorA
    });
    const originalPerson = db.prepare("SELECT * FROM persons WHERE id=?").get(firstBind.personId);
    const occupiedPerson = personApi.findOrCreateByVerifiedPhone({ phone: occupiedPhone });
    personApi.bindMpOpenid(occupiedPerson.id, "another-openid");

    await rejectsWithCode(
      mpAuth.bindPhone({
        token: firstBind.mpToken,
        phone: "13800138333",
        smsCode: "bad",
        doctorId: doctorA
      }),
      "invalid_sms_code"
    );
    await rejectsWithCode(
      mpAuth.bindPhone({
        token: firstBind.mpToken,
        phone: occupiedPhone,
        smsCode: "000000",
        doctorId: doctorA
      }),
      "phone_already_bound"
    );

    assert.equal(mpAuth.me(firstBind.mpToken).personId, originalPerson.id);
    assert.equal(
      db.prepare("SELECT mp_openid FROM persons WHERE id=?").get(originalPerson.id).mp_openid,
      firstBind.openid
    );
    assert.equal(
      db.prepare("SELECT mp_openid FROM persons WHERE id=?").get(occupiedPerson.id).mp_openid,
      "another-openid"
    );
    assert.equal(
      db.prepare(
        "SELECT COUNT(*) AS c FROM mp_sessions WHERE openid=? AND revoked_at IS NULL"
      ).get(firstBind.openid).c,
      1
    );
  });

  await test("bindPhone 后段 session 插入失败时回滚此前全部写入", async () => {
    const code = "late-rollback-" + Date.now();
    const oldPhone = "13800138351";
    const targetPhone = "13800138352";
    const loginRes = await mpAuth.login({ code, doctorId: doctorA });
    const oldBind = await mpAuth.bindPhone({
      token: loginRes.mpToken,
      phone: oldPhone,
      smsCode: "000000",
      doctorId: doctorA
    });
    const targetPerson = personApi.findOrCreateByVerifiedPhone({ phone: targetPhone });
    const timestamp = new Date().toISOString();
    const targetPatientId = +db.prepare(`INSERT INTO patients(
      doctor_id, person_id, display_name, real_name, phone, phone_verified, created_at, updated_at
    ) VALUES(?,?,?,?,?,?,?,?)`).run(
      doctorA,
      null,
      "",
      "",
      targetPhone,
      1,
      timestamp,
      timestamp
    ).lastInsertRowid;
    const before = {
      oldPerson: db.prepare("SELECT * FROM persons WHERE id=?").get(oldBind.personId),
      targetPerson: db.prepare("SELECT * FROM persons WHERE id=?").get(targetPerson.id),
      targetPatient: db.prepare("SELECT * FROM patients WHERE id=?").get(targetPatientId),
      sessions: db.prepare(
        "SELECT * FROM mp_sessions WHERE openid=? ORDER BY token ASC"
      ).all(oldBind.openid)
    };

    db.exec(`CREATE TEMP TRIGGER fail_mp_session_insert
      BEFORE INSERT ON mp_sessions
      WHEN (SELECT mp_openid FROM persons WHERE id=${+oldBind.personId}) IS NULL
        AND (SELECT mp_openid FROM persons WHERE id=${+targetPerson.id})=NEW.openid
        AND (SELECT person_id FROM patients WHERE id=${targetPatientId})=${+targetPerson.id}
        AND EXISTS(
          SELECT 1 FROM mp_sessions
          WHERE openid=NEW.openid AND revoked_at IS NOT NULL
        )
      BEGIN
        SELECT RAISE(ABORT, 'forced_mp_session_insert_failure');
      END`);
    try {
      await assert.rejects(
        mpAuth.bindPhone({
          token: oldBind.mpToken,
          phone: targetPhone,
          smsCode: "000000",
          doctorId: doctorA
        }),
        /forced_mp_session_insert_failure/
      );
    } finally {
      db.exec("DROP TRIGGER IF EXISTS fail_mp_session_insert");
    }

    assert.deepStrictEqual(
      db.prepare("SELECT * FROM persons WHERE id=?").get(oldBind.personId),
      before.oldPerson
    );
    assert.deepStrictEqual(
      db.prepare("SELECT * FROM persons WHERE id=?").get(targetPerson.id),
      before.targetPerson
    );
    assert.deepStrictEqual(
      db.prepare("SELECT * FROM patients WHERE id=?").get(targetPatientId),
      before.targetPatient
    );
    assert.deepStrictEqual(
      db.prepare("SELECT * FROM mp_sessions WHERE openid=? ORDER BY token ASC").all(oldBind.openid),
      before.sessions
    );
    assert.equal(
      db.prepare(
        "SELECT COUNT(*) AS c FROM mp_sessions WHERE openid=? AND revoked_at IS NULL"
      ).get(oldBind.openid).c,
      1
    );
    assert.equal(mpAuth.me(oldBind.mpToken).personId, oldBind.personId);
  });

  await test("bindPhone 换绑原子迁移 OpenID 并轮换 token", async () => {
    const code = "rebind-success-" + Date.now();
    const oldPhone = "13800138341";
    const newPhone = "13800138342";
    const loginRes = await mpAuth.login({ code, doctorId: doctorA });
    const oldBind = await mpAuth.bindPhone({
      token: loginRes.mpToken,
      phone: oldPhone,
      smsCode: "000000",
      doctorId: doctorA
    });
    const newPerson = personApi.findOrCreateByVerifiedPhone({ phone: newPhone });

    const rebound = await mpAuth.bindPhone({
      token: oldBind.mpToken,
      phone: newPhone,
      smsCode: "000000",
      doctorId: doctorA
    });

    assert.notEqual(rebound.mpToken, oldBind.mpToken);
    assert.equal(rebound.personId, newPerson.id);
    assert.throws(() => mpAuth.me(oldBind.mpToken), /unauthorized/);
    assert.ok(
      db.prepare("SELECT revoked_at FROM mp_sessions WHERE token=?").get(oldBind.mpToken).revoked_at
    );
    assert.equal(
      db.prepare("SELECT mp_openid FROM persons WHERE id=?").get(oldBind.personId).mp_openid,
      null
    );
    assert.equal(
      db.prepare("SELECT mp_openid FROM persons WHERE id=?").get(newPerson.id).mp_openid,
      rebound.openid
    );
    assert.equal(
      db.prepare(
        "SELECT COUNT(*) AS c FROM mp_sessions WHERE openid=? AND revoked_at IS NULL"
      ).get(rebound.openid).c,
      1
    );
  });

  await test("requireBoundSession 对 OpenID、双重验证和 patient 关系 fail closed", async () => {
    const loginRes = await mpAuth.login({
      code: "bound-identity-" + Date.now(),
      doctorId: doctorA
    });
    const bound = await mpAuth.bindPhone({
      token: loginRes.mpToken,
      phone: "13800138361",
      smsCode: "000000",
      doctorId: doctorA
    });
    const baselinePerson = db.prepare("SELECT * FROM persons WHERE id=?").get(bound.personId);
    const baselinePatient = db.prepare("SELECT * FROM patients WHERE id=?").get(bound.patientId);
    assert.equal(mpAuth.requireBoundSession(bound.mpToken).patient_id, bound.patientId);
    assert.equal(
      mpAuth.requireBoundSession(bound.mpToken, { doctorId: doctorA }).doctor_id,
      doctorA
    );

    const mutations = [
      ["person OpenID", () => db.prepare("UPDATE persons SET mp_openid=? WHERE id=?").run("wrong-openid", bound.personId)],
      ["person phone_verified", () => db.prepare("UPDATE persons SET phone_verified=0 WHERE id=?").run(bound.personId)],
      ["patient phone_verified", () => db.prepare("UPDATE patients SET phone_verified=0 WHERE id=?").run(bound.patientId)],
      ["patient person_id", () => db.prepare("UPDATE patients SET person_id=NULL WHERE id=?").run(bound.patientId)],
      ["patient doctor_id", () => db.prepare("UPDATE patients SET doctor_id=? WHERE id=?").run(doctorB, bound.patientId)]
    ];
    for (const [label, mutate] of mutations) {
      db.prepare(`UPDATE persons SET mp_openid=?,phone_verified=? WHERE id=?`).run(
        baselinePerson.mp_openid,
        baselinePerson.phone_verified,
        bound.personId
      );
      db.prepare(`UPDATE patients SET person_id=?,doctor_id=?,phone_verified=? WHERE id=?`).run(
        baselinePatient.person_id,
        baselinePatient.doctor_id,
        baselinePatient.phone_verified,
        bound.patientId
      );
      mutate();
      assert.throws(
        () => mpAuth.requireBoundSession(bound.mpToken),
        /identity_mismatch/,
        label
      );
    }
    db.prepare(`UPDATE persons SET mp_openid=?,phone_verified=? WHERE id=?`).run(
      baselinePerson.mp_openid,
      baselinePerson.phone_verified,
      bound.personId
    );
    db.prepare(`UPDATE patients SET person_id=?,doctor_id=?,phone_verified=? WHERE id=?`).run(
      baselinePatient.person_id,
      baselinePatient.doctor_id,
      baselinePatient.phone_verified,
      bound.patientId
    );
    assert.throws(
      () => mpAuth.requireBoundSession(bound.mpToken, { doctorId: doctorB }),
      /identity_mismatch/
    );
  });

  await test("unbindPhone 在 session 撤销失败时整体回滚，成功时撤销全部 OpenID session", async () => {
    const loginRes = await mpAuth.login({
      code: "unbind-atomic-" + Date.now(),
      doctorId: doctorA
    });
    const bound = await mpAuth.bindPhone({
      token: loginRes.mpToken,
      phone: "13800138362",
      smsCode: "000000",
      doctorId: doctorA
    });
    db.exec(`CREATE TEMP TRIGGER fail_unbind_revoke
      BEFORE UPDATE OF revoked_at ON mp_sessions
      WHEN OLD.openid='${String(bound.openid).replace(/'/g, "''")}'
      BEGIN
        SELECT RAISE(ABORT, 'forced_unbind_revoke_failure');
      END`);
    try {
      assert.throws(() => mpAuth.unbindPhone(bound.mpToken), /forced_unbind_revoke_failure/);
    } finally {
      db.exec("DROP TRIGGER IF EXISTS fail_unbind_revoke");
    }
    assert.equal(
      db.prepare("SELECT mp_openid FROM persons WHERE id=?").get(bound.personId).mp_openid,
      bound.openid
    );
    assert.equal(
      db.prepare("SELECT revoked_at FROM mp_sessions WHERE token=?").get(bound.mpToken).revoked_at,
      null
    );
    assert.equal(mpAuth.requireBoundSession(bound.mpToken).person_id, bound.personId);

    assert.deepStrictEqual(mpAuth.unbindPhone(bound.mpToken), { ok: true });
    assert.equal(
      db.prepare("SELECT mp_openid FROM persons WHERE id=?").get(bound.personId).mp_openid,
      null
    );
    assert.equal(
      db.prepare(
        "SELECT COUNT(*) AS c FROM mp_sessions WHERE openid=? AND revoked_at IS NULL"
      ).get(bound.openid).c,
      0
    );
    assert.throws(() => mpAuth.requireSession(bound.mpToken), /unauthorized/);
  });

  await test("fixed-window limiter 限频、过期复位并限制 key 数量", () => {
    const { createFixedWindowLimiter } = require("./rate_limit.js");
    let now = 1000;
    const limiter = createFixedWindowLimiter({
      limit: 2,
      windowMs: 1000,
      maxKeys: 2,
      now: () => now
    });
    assert.equal(limiter.consume("a").allowed, true);
    assert.equal(limiter.consume("a").allowed, true);
    const blocked = limiter.consume("a");
    assert.equal(blocked.allowed, false);
    assert.equal(blocked.retryAfter, 1);
    limiter.consume("b");
    limiter.consume("c");
    assert.ok(limiter.size() <= 2);
    now = 2001;
    assert.equal(limiter.consume("a").allowed, true);
    limiter.cleanup();
    assert.ok(limiter.size() <= 1);
  });

  await test("fixed-window limiter 达到容量时按插入顺序淘汰最旧 key", () => {
    const { createFixedWindowLimiter } = require("./rate_limit.js");
    const limiter = createFixedWindowLimiter({
      limit: 1,
      windowMs: 10_000,
      maxKeys: 2,
      now: () => 1000
    });
    assert.equal(limiter.consume("oldest").allowed, true);
    assert.equal(limiter.consume("second").allowed, true);
    assert.equal(limiter.consume("third").allowed, true);
    assert.equal(limiter.size(), 2);
    assert.equal(limiter.consume("oldest").allowed, true);
    assert.equal(limiter.size(), 2);
  });

  await test("mp auth 路由映射稳定错误且不泄漏内部消息", async () => {
    const handlers = [];
    const routeApi = require("./routes/mp-auth.js");
    routeApi.registerMpAuthRoutes(
      (method, pattern, handler) => handlers.push({ method, pattern, handler }),
      {
        parseBody: async (req) => req.body || {},
        json: (res, status, body) => {
          res.status = status;
          res.body = body;
        },
        MESSAGE_MAX_BODY: 1024,
        db,
        profileStore: { readPersonFields: () => ({}) },
        patientProfile: { maskIdNumber: (value) => String(value || "") }
      }
    );
    const findHandler = (method, pathName) =>
      handlers.find((item) => item.method === method && item.pattern.test(pathName)).handler;
    const loginHandler = findHandler("POST", "/api/mp/login");
    const bindHandler = findHandler("POST", "/api/mp/bind-phone");
    const avatarHandler = findHandler("POST", "/api/mp/avatar");
    const unbindHandler = findHandler("POST", "/api/mp/unbind-phone");
    const meHandler = findHandler("GET", "/api/mp/me");
    const archiveHandler = findHandler("GET", "/api/mp/archive");
    const healthRecordsHandler = findHandler("GET", "/api/mp/health-records");
    const myDoctorsHandler = findHandler("GET", "/api/mp/my-doctors");
    const request = (body, token) => ({
      body,
      headers: token ? { authorization: "Bearer " + token } : {},
      socket: { remoteAddress: "127.0.0.1" }
    });
    const response = () => ({
      headers: {},
      setHeader(name, value) {
        this.headers[name] = value;
      }
    });
    const originalLogin = mpAuth.login;
    const originalBindPhone = mpAuth.bindPhone;
    const originalUpdateAvatar = mpAuth.updateAvatar;
    const originalUnbindPhone = mpAuth.unbindPhone;
    const originalMe = mpAuth.me;
    const originalRequireSession = mpAuth.requireSession;
    const originalRequireBoundSession = mpAuth.requireBoundSession;
    const originalConsoleError = console.error;
    const routeLogs = [];
    try {
      console.error = (...args) => routeLogs.push(args.map(String).join(" "));
      for (const [error, status, stable] of [
        ["doctor_required", 400, "doctor_required"],
        ["doctor_unavailable", 403, "doctor_unavailable"],
        ["database path /secret/data.db", 500, "login_failed"]
      ]) {
        mpAuth.login = async () => { throw new Error(error); };
        const res = response();
        await loginHandler(request({ code: "route-" + error, doctorId: doctorA }), res);
        assert.equal(res.status, status);
        assert.deepEqual(res.body, { error: stable });
      }

      for (const [error, status, stable] of [
        ["unauthorized", 401, "unauthorized"],
        ["session_expired", 401, "session_expired"],
        ["doctor_required", 400, "doctor_required"],
        ["doctor_unavailable", 403, "doctor_unavailable"],
        ["phone_already_bound", 409, "phone_already_bound"],
        ["sms_not_wired", 503, "sms_unavailable"],
        ["sms_not_configured", 503, "sms_unavailable"],
        ["invalid_sms_code", 400, "invalid_sms_code"],
        ["SQLITE_CONSTRAINT at /secret/data.db", 500, "server_error"]
      ]) {
        mpAuth.bindPhone = async () => { throw new Error(error); };
        const res = response();
        await bindHandler(request({ phone: "13800138999" }, "test-token"), res);
        assert.equal(res.status, status);
        assert.deepEqual(res.body, { error: stable });
      }

      const authReadRoutes = [
        { name: "me", handler: meHandler, authMethod: "me" },
        { name: "archive", handler: archiveHandler, authMethod: "requireBoundSession" },
        { name: "health-records", handler: healthRecordsHandler, authMethod: "requireBoundSession" },
        { name: "my-doctors", handler: myDoctorsHandler, authMethod: "requireBoundSession" }
      ];
      for (const item of authReadRoutes) {
        const missingRes = response();
        await item.handler(request({}, ""), missingRes, null, {});
        assert.equal(missingRes.status, 401, item.name + " missing token status");
        assert.deepEqual(missingRes.body, { error: "unauthorized" });

        for (const [error, status, stable] of [
          ["unauthorized", 401, "unauthorized"],
          ["session_expired", 401, "session_expired"],
          ["SQLITE_IOERR /secret/data.db", 500, "server_error"]
        ]) {
          mpAuth.me = originalMe;
          mpAuth.requireSession = originalRequireSession;
          mpAuth.requireBoundSession = originalRequireBoundSession;
          mpAuth[item.authMethod] = () => { throw new Error(error); };
          const res = response();
          await item.handler(request({}, "read-token"), res, null, {});
          assert.equal(res.status, status, item.name + " " + error + " status");
          assert.deepEqual(res.body, { error: stable }, item.name + " stable error");
        }
      }

      mpAuth.updateAvatar = () => {
        throw new Error("EACCES /secret/uploads");
      };
      const avatarRes = response();
      await avatarHandler(request({ avatarDataUrl: "data:image/png;base64,AA==" }, "test-token"), avatarRes);
      assert.equal(avatarRes.status, 500);
      assert.deepEqual(avatarRes.body, { error: "server_error" });

      mpAuth.unbindPhone = () => {
        throw new Error("SQLITE_IOERR /secret/data.db");
      };
      const unbindRes = response();
      await unbindHandler(request({}, "test-token"), unbindRes);
      assert.equal(unbindRes.status, 500);
      assert.deepEqual(unbindRes.body, { error: "server_error" });
      for (const label of [
        "[mp/auth/login] internal_error",
        "[mp/auth/bind-phone] internal_error",
        "[mp/auth/avatar] internal_error",
        "[mp/auth/unbind-phone] internal_error",
        "[mp/auth/my-doctors] internal_error"
      ]) {
        assert.ok(routeLogs.includes(label), "missing fixed log: " + label);
      }
      assert.ok(!routeLogs.some((line) => line.includes("/secret")));
      assert.ok(!routeLogs.some((line) => line.includes("13800138999")));
      assert.ok(!routeLogs.some((line) => line.includes("database path")));
    } finally {
      mpAuth.login = originalLogin;
      mpAuth.bindPhone = originalBindPhone;
      mpAuth.updateAvatar = originalUpdateAvatar;
      mpAuth.unbindPhone = originalUnbindPhone;
      mpAuth.me = originalMe;
      mpAuth.requireSession = originalRequireSession;
      mpAuth.requireBoundSession = originalRequireBoundSession;
      console.error = originalConsoleError;
    }
  });

  await test("login 路由按完整 code 摘要和 IP 独立限频", async () => {
    const handlers = [];
    const routeApi = require("./routes/mp-auth.js");
    routeApi.registerMpAuthRoutes(
      (method, pattern, handler) => handlers.push({ method, pattern, handler }),
      {
        parseBody: async (req) => req.body || {},
        json: (res, status, body) => {
          res.status = status;
          res.body = body;
        },
        MESSAGE_MAX_BODY: 1024,
        db
      }
    );
    const loginHandler = handlers.find(
      (item) => item.method === "POST" && item.pattern.test("/api/mp/login")
    ).handler;
    const unique = Date.now() + "-" + Math.random();
    const code = "rate-limit-code-" + unique;
    const ip = "10.20.30.40";
    const makeReq = (requestCode, requestIp, headers = {}) => ({
      body: { code: requestCode, doctorId: doctorA },
      headers,
      socket: { remoteAddress: requestIp }
    });
    const makeRes = () => ({
      headers: {},
      setHeader(name, value) {
        this.headers[name] = value;
      }
    });
    const key = routeApi.loginRateKey(makeReq(code, ip), code);
    assert.ok(!key.includes(code));
    assert.match(key.split("|").pop(), /^[a-f0-9]{64}$/);
    assert.equal(
      routeApi.clientIp(
        makeReq(code, "::ffff:127.0.0.1", { "x-real-ip": "198.51.100.10" })
      ),
      "198.51.100.10"
    );
    assert.equal(
      routeApi.clientIp(
        makeReq(code, "::1", { "x-forwarded-for": "198.51.100.11, 10.0.0.2" })
      ),
      "198.51.100.11"
    );
    assert.equal(
      routeApi.clientIp(
        makeReq(code, "203.0.113.20", {
          "x-real-ip": "198.51.100.12",
          "x-forwarded-for": "198.51.100.13"
        })
      ),
      "203.0.113.20"
    );
    assert.equal(
      routeApi.clientIp(
        makeReq(code, "::ffff:203.0.113.21", { "x-real-ip": "198.51.100.14" })
      ),
      "203.0.113.21"
    );
    assert.equal(
      routeApi.clientIp(
        makeReq(code, "::ffff:127.0.0.1", {
          "x-real-ip": "not-an-ip",
          "x-forwarded-for": "198.51.100.15"
        })
      ),
      "127.0.0.1"
    );

    const originalLogin = mpAuth.login;
    let calls = 0;
    mpAuth.login = async () => {
      calls += 1;
      return { ok: true };
    };
    try {
      for (let i = 0; i < 10; i += 1) {
        const res = makeRes();
        await loginHandler(makeReq(code, ip), res);
        assert.equal(res.status, 200);
      }
      const blocked = makeRes();
      await loginHandler(makeReq(code, ip), blocked);
      assert.equal(blocked.status, 429);
      assert.deepEqual(blocked.body, { error: "rate_limited" });
      assert.ok(Number(blocked.headers["Retry-After"]) >= 1);
      assert.equal(calls, 10);

      const otherCode = makeRes();
      await loginHandler(makeReq(code + "-other", ip), otherCode);
      assert.equal(otherCode.status, 200);
      const otherIp = makeRes();
      await loginHandler(makeReq(code, "10.20.30.41"), otherIp);
      assert.equal(otherIp.status, 200);
      assert.equal(calls, 12);

      const ipBucket = "ip-bucket-" + unique;
      for (let i = 0; i < 30; i += 1) {
        const res = makeRes();
        await loginHandler(makeReq("rotating-code-" + unique + "-" + i, ipBucket), res);
        assert.equal(res.status, 200);
      }
      const ipBlocked = makeRes();
      await loginHandler(makeReq("rotating-code-" + unique + "-blocked", ipBucket), ipBlocked);
      assert.equal(ipBlocked.status, 429);
      assert.deepEqual(ipBlocked.body, { error: "rate_limited" });
      assert.ok(Number(ipBlocked.headers["Retry-After"]) >= 1);
      assert.equal(calls, 42);

      const isolatedIp = makeRes();
      await loginHandler(
        makeReq("rotating-code-" + unique + "-blocked", ipBucket + "-other"),
        isolatedIp
      );
      assert.equal(isolatedIp.status, 200);
      assert.equal(calls, 43);

      const proxiedIp = "198.51.100.30";
      for (let i = 0; i < 30; i += 1) {
        const res = makeRes();
        const remote = i % 2 === 0 ? "127.0.0.1" : "::ffff:127.0.0.1";
        await loginHandler(
          makeReq(
            "proxy-rotating-code-" + unique + "-" + i,
            remote,
            { "x-real-ip": proxiedIp }
          ),
          res
        );
        assert.equal(res.status, 200);
      }
      const sameProxyIpBlocked = makeRes();
      await loginHandler(
        makeReq(
          "proxy-rotating-code-" + unique + "-blocked",
          "::1",
          { "x-real-ip": proxiedIp }
        ),
        sameProxyIpBlocked
      );
      assert.equal(sameProxyIpBlocked.status, 429);
      assert.deepEqual(sameProxyIpBlocked.body, { error: "rate_limited" });
      assert.ok(Number(sameProxyIpBlocked.headers["Retry-After"]) >= 1);
      assert.equal(calls, 73);

      const differentProxyIp = makeRes();
      await loginHandler(
        makeReq(
          "proxy-rotating-code-" + unique + "-blocked",
          "127.0.0.1",
          { "x-real-ip": "198.51.100.31" }
        ),
        differentProxyIp
      );
      assert.equal(differentProxyIp.status, 200);
      assert.equal(calls, 74);
    } finally {
      mpAuth.login = originalLogin;
    }
  });

  await test("server registers mp auth routes", () => {
    const src = fs.readFileSync(path.join(__dirname, "server.js"), "utf8");
    assert.match(src, /registerMpAuthRoutes/);
    assert.equal(typeof require("./routes/mp-auth.js").registerMpAuthRoutes, "function");
  });

  console.log("all mp auth tests passed");
  } finally {
    await new Promise((resolve) => setImmediate(resolve));
    try {
      if (db && typeof db.close === "function") db.close();
    } finally {
      for (const file of [
        process.env.DB_PATH,
        process.env.DB_PATH + "-wal",
        process.env.DB_PATH + "-shm"
      ]) {
        fs.rmSync(file, { force: true });
      }
    }
  }
})().catch((e) => {
  console.error(e && e.stack ? e.stack : e);
  process.exit(1);
});
