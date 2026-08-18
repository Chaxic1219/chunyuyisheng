"use strict";
const assert = require("assert");
const path = require("path");
const fs = require("fs");
const os = require("os");

process.env.MP_AUTH_STUB = "1";
process.env.DB_PATH = path.join(os.tmpdir(), `mp-auth-${Date.now()}.db`);
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

(async () => {
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

  const doctors = db.prepare("SELECT id FROM doctors LIMIT 2").all();
  assert.ok(doctors.length >= 2, "seed 应至少有 2 位医生");
  const doctorA = doctors[0].id;
  const doctorB = doctors[1].id;

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

    const loginRes = await mpAuth.login({ code: "merge-same-doc-" + Date.now(), doctorId: doctorA });
    assert.ok(loginRes.mpToken);
    assert.equal(loginRes.phoneBound, false);

    const bindRes = await mpAuth.bindPhone({
      token: loginRes.mpToken,
      phone,
      smsCode: "000000",
      doctorId: doctorA
    });
    assert.equal(bindRes.patientId, existingPid);
    assert.ok(bindRes.personId);
    const pt = db.prepare("SELECT person_id, phone_verified FROM patients WHERE id=?").get(existingPid);
    assert.equal(pt.person_id, bindRes.personId);
    assert.equal(pt.phone_verified, 1);
  });

  await test("bindPhone 跨医生: 同号同 person、不同 patient", async () => {
    const phone = "13800138133";
    const code = "cross-doc-same-openid";
    const loginA = await mpAuth.login({ code, doctorId: doctorA });
    await mpAuth.bindPhone({
      token: loginA.mpToken,
      phone,
      smsCode: "000000",
      doctorId: doctorA
    });
    const personA = personApi.findOrCreateByVerifiedPhone({ phone });
    const underA = db.prepare(
      "SELECT id FROM patients WHERE doctor_id=? AND person_id=? LIMIT 1"
    ).get(doctorA, personA.id);
    assert.ok(underA);
    // 系统内切换医生：claimDoctor 登录挂到另一位医生
    const switched = await mpAuth.login({
      code,
      doctorId: doctorB,
      claimDoctor: true
    });
    assert.equal(switched.personId, personA.id);
    assert.equal(Number(switched.doctorId), doctorB);
    assert.notEqual(switched.patientId, underA.id);
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

  await test("server registers mp auth routes", () => {
    const src = fs.readFileSync(path.join(__dirname, "server.js"), "utf8");
    assert.match(src, /registerMpAuthRoutes/);
    assert.equal(typeof require("./routes/mp-auth.js").registerMpAuthRoutes, "function");
  });

  await test("login 允许上下线已废弃的在库医生（active=0）", async () => {
    const inactiveId = +db.prepare(
      "INSERT INTO doctors(slug,name,active) VALUES(?,?,0)"
    ).run("mp-login-inactive-" + Date.now(), "停用医生夹具").lastInsertRowid;
    const loginRes = await mpAuth.login({
      code: "inactive-ok-" + Date.now(),
      doctorId: inactiveId
    });
    assert.ok(loginRes.mpToken);
    assert.equal(Number(loginRes.doctorId), inactiveId);
    const me = mpAuth.me(loginRes.mpToken);
    assert.equal(Number(me.doctorId), inactiveId);
  });

  await test("login 拒绝已删除或不存在的医生", async () => {
    await assert.rejects(
      () => mpAuth.login({ code: "missing-doc-" + Date.now(), doctorId: 999999 }),
      (err) => err && err.message === "doctor_unavailable"
    );
  });

  await test("bindPhone 无来源医生时不挂默认医生，需选医生", async () => {
    const phone = "13800138333";
    const loginRes = await mpAuth.login({
      code: "need-select-" + Date.now(),
      doctorId: doctorA
    });
    const bindRes = await mpAuth.bindPhone({
      token: loginRes.mpToken,
      phone,
      smsCode: "000000"
      // 不传 doctorId：模拟前端不把 bootstrap 默认医生当作用户选择
    });
    assert.equal(bindRes.phoneBound, true);
    assert.equal(bindRes.needsDoctorSelection, true);
    assert.equal(bindRes.doctorId, null);
    assert.equal(bindRes.patientId, null);
    const pts = db.prepare(
      "SELECT id FROM patients WHERE phone=? AND phone_verified=1"
    ).all(phone);
    assert.equal(pts.length, 0, "不应因 bootstrap 默认医生自动建档");
  });

  await test("bindPhone 网页已建档同号：沿用最近医生且不需选择", async () => {
    const phone = "13800138444";
    const now = new Date().toISOString();
    const person = personApi.findOrCreateByVerifiedPhone({ phone, realName: "网页建档" });
    db.prepare(`INSERT INTO patients(
      doctor_id, person_id, display_name, real_name, phone, phone_verified,
      unionid, tags, follow_stage, notes, created_at, updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      doctorB, person.id, "网页建档", "网页建档", phone, 1, "", "[]", "", "", now, now
    );
    const loginRes = await mpAuth.login({
      code: "web-bound-" + Date.now(),
      doctorId: doctorA
    });
    const bindRes = await mpAuth.bindPhone({
      token: loginRes.mpToken,
      phone,
      smsCode: "000000"
    });
    assert.equal(bindRes.needsDoctorSelection, false);
    assert.equal(Number(bindRes.doctorId), doctorB);
    assert.ok(bindRes.patientId);
  });

  await test("bindPhone 显式来源 doctorId：无旧档时挂该医生", async () => {
    const phone = "13800138555";
    const loginRes = await mpAuth.login({
      code: "source-doc-" + Date.now(),
      doctorId: doctorA
    });
    const bindRes = await mpAuth.bindPhone({
      token: loginRes.mpToken,
      phone,
      smsCode: "000000",
      doctorId: doctorB
    });
    assert.equal(bindRes.needsDoctorSelection, false);
    assert.equal(Number(bindRes.doctorId), doctorB);
  });

  await test("login 已绑手机无旧档时忽略 bootstrap，不误挂默认医生", async () => {
    const phone = "13800138666";
    const login0 = await mpAuth.login({
      code: "claim-openid-shared",
      doctorId: doctorA
    });
    const bind0 = await mpAuth.bindPhone({
      token: login0.mpToken,
      phone,
      smsCode: "000000"
    });
    assert.equal(bind0.needsDoctorSelection, true);

    const loginBootstrap = await mpAuth.login({
      code: "claim-openid-shared",
      doctorId: doctorA
      // 无 claimDoctor：模拟冷启动 silentLogin(默认医生)
    });
    assert.equal(loginBootstrap.needsDoctorSelection, true);
    assert.equal(loginBootstrap.doctorId, null);

    const loginClaim = await mpAuth.login({
      code: "claim-openid-shared",
      doctorId: doctorB,
      claimDoctor: true
    });
    assert.equal(loginClaim.needsDoctorSelection, false);
    assert.equal(Number(loginClaim.doctorId), doctorB);
  });

  await test("me 身份链断裂时不 403，自愈为需选医生", async () => {
    const phone = "13800138777";
    const loginRes = await mpAuth.login({
      code: "broken-identity-" + Date.now(),
      doctorId: doctorA
    });
    const bindRes = await mpAuth.bindPhone({
      token: loginRes.mpToken,
      phone,
      smsCode: "000000",
      doctorId: doctorA
    });
    assert.equal(bindRes.phoneBound, true);
    assert.ok(bindRes.patientId);

    db.prepare("UPDATE persons SET mp_openid=? WHERE id=?").run("other-openid", bindRes.personId);
    const me = mpAuth.me(bindRes.mpToken);
    assert.equal(me.phoneBound, true);
    assert.equal(me.needsDoctorSelection, true);
    assert.equal(me.doctorId, null);
    assert.equal(me.patientId, null);
  });

  console.log("all mp auth tests passed");
})().catch((e) => {
  console.error(e && e.stack ? e.stack : e);
  process.exit(1);
});
