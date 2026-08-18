"use strict";
const mpAuth = require("../mp_auth.js");
const { bearerToken } = require("./mp-auth.js");
const open = require("../chunyu_open.js");

function ageFromBirth(birthDate) {
  const s = String(birthDate || "").trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return "";
  const y = +m[1];
  const now = new Date();
  let age = now.getFullYear() - y;
  const md = Number(String(now.getMonth() + 1).padStart(2, "0") + String(now.getDate()).padStart(2, "0"));
  const bmd = Number(m[2] + m[3]);
  if (md < bmd) age -= 1;
  return age > 0 && age < 120 ? age + "岁" : "";
}

function personMeta(db, sess) {
  const person = sess.person_id
    ? db.prepare("SELECT * FROM persons WHERE id=?").get(+sess.person_id)
    : null;
  return {
    name: (person && person.real_name) || "",
    sex: (person && person.gender) || "",
    age: ageFromBirth(person && person.birth_date),
    birthDate: (person && person.birth_date) || "",
    phone: (person && person.phone) || ""
  };
}

function chunyuDoctorId(db, doctorId) {
  if (!doctorId) return "";
  try {
    const row = db.prepare("SELECT content FROM doctors WHERE id=?").get(+doctorId);
    const c = row && row.content ? JSON.parse(row.content) : {};
    const id = c && c.chunyuIntegration && (c.chunyuIntegration.chunyuDoctorId || c.chunyuIntegration.doctorId);
    return id ? String(id) : "";
  } catch (e) {
    return "";
  }
}

function requirePhoneSess(req, res, json) {
  const token = bearerToken(req);
  if (!token) {
    json(res, 401, { error: "unauthorized" });
    return null;
  }
  try {
    return mpAuth.requirePhoneBoundSession(token);
  } catch (e) {
    json(res, 401, { error: "unauthorized" });
    return null;
  }
}

function notConfigured(res, json) {
  return json(res, 503, { error: "chunyu_not_configured", message: "春雨开放平台未配置" });
}

async function buildSaasJump(userId, coopServiceType, h5Url) {
  let wxPath = "";
  let note = "";
  try {
    const data = await open.jumpWxapp(userId, coopServiceType);
    const err = Number(data && (data.error_code != null ? data.error_code : data.error));
    if (!err) wxPath = open.wxPathFromJump(data);
    else note = String((data && (data.error_msg || data.errorMsg)) || "jump_wxapp_failed");
  } catch (e) {
    note = e && e.message ? String(e.message) : "jump_wxapp_failed";
  }
  return { h5Url, wxPath, note };
}

function registerChunyuOpenRoutes(route, ctx) {
  const { parseBody, json, db, MESSAGE_MAX_BODY, authed, allowDoctor } = ctx;
  open.ensureSchema(db);

  route("GET", /^\/api\/mp\/chunyu\/status$/, (req, res) => {
    const c = open.cfg();
    json(res, 200, { ok: true, configured: c.configured, wxAppId: c.wxAppId, wxEnv: c.wxEnv || "" });
  });

  route("POST", /^\/api\/mp\/chunyu\/jump$/, async (req, res) => {
    const sess = requirePhoneSess(req, res, json);
    if (!sess) return;
    if (!open.cfg().configured) return notConfigured(res, json);
    const b = await parseBody(req, MESSAGE_MAX_BODY || 1e6);
    const kind = String((b && b.kind) || "graph");
    let userId;
    try {
      const meta = personMeta(db, sess);
      userId = open.chunyuUserId(sess.person_id, meta.phone);
    } catch (e) {
      return json(res, 400, { error: "chunyu_user_required" });
    }
    const meta = personMeta(db, sess);
    let h5Url = "";
    let wxPath = "";
    let problemId = null;
    let serviceId = null;
    let note = "";
    try {
      if (kind === "video") {
        const j = await buildSaasJump(userId, "video_inquiry_saas", open.videoH5Url(userId));
        h5Url = j.h5Url;
        wxPath = j.wxPath;
        note = j.note;
      } else if (kind === "phone") {
        const j = await buildSaasJump(userId, "fast_phone_3a", open.phoneH5Url(userId));
        h5Url = j.h5Url;
        wxPath = j.wxPath;
        note = j.note;
      } else if (kind === "expert") {
        h5Url = open.expertH5Url(userId);
      } else if (kind === "orders") {
        h5Url = open.ordersH5Url(userId);
      } else if (kind === "report") {
        const j = await buildSaasJump(userId, "emergency_graph", open.graphH5Url(userId));
        h5Url = j.h5Url;
        wxPath = j.wxPath;
        note = j.note;
        try {
          const created = await open.createFreeProblem(userId, "请协助解读我上传的检查/化验报告，并给出就医建议。", meta);
          if (created && (created.error === 0 || created.problem_id)) problemId = created.problem_id || null;
          else note = note || String((created && created.error_msg) || "");
        } catch (e) {
          note = note || (e && e.message ? String(e.message) : "");
        }
      } else {
        const j = await buildSaasJump(userId, "emergency_graph", open.graphH5Url(userId));
        h5Url = j.h5Url;
        wxPath = j.wxPath;
        note = j.note;
        const text = String((b && b.text) || "").trim() || "我想进行图文问诊。";
        try {
          const created = await open.createFreeProblem(userId, text, meta);
          if (created && (created.error === 0 || created.problem_id)) problemId = created.problem_id || null;
          else note = note || String((created && created.error_msg) || "");
        } catch (e) {
          note = note || (e && e.message ? String(e.message) : "");
        }
      }
    } catch (e) {
      return json(res, 502, { error: "chunyu_upstream", message: String((e && e.message) || e) });
    }
    const orderId = open.insertOrder(db, {
      personId: sess.person_id,
      patientId: sess.patient_id,
      doctorId: sess.doctor_id,
      userId,
      kind,
      status: problemId || serviceId ? "opened" : "jump",
      problemId,
      serviceId,
      jumpUrl: h5Url,
      wxPath,
      extra: { note }
    });
    json(res, 200, open.publicJump(kind, userId, { h5Url, wxPath, problemId, serviceId, orderId, note }));
  });

  route("POST", /^\/api\/mp\/chunyu\/green-channel$/, async (req, res) => {
    const sess = requirePhoneSess(req, res, json);
    if (!sess) return;
    if (!open.cfg().configured) return notConfigured(res, json);
    const b = await parseBody(req, MESSAGE_MAX_BODY || 1e6);
    const meta = personMeta(db, sess);
    let userId;
    try { userId = open.chunyuUserId(sess.person_id, meta.phone); }
    catch (e) { return json(res, 400, { error: "chunyu_user_required" }); }
    const serviceType = String((b && b.serviceType) || "") === "住院"
      ? "expert_register_apply"
      : "expert_register_apply";
    const cyDoctor = String((b && b.chunyuDoctorId) || chunyuDoctorId(db, sess.doctor_id) || "").trim();
    const h5Url = open.expertH5Url(userId);
    let serviceId = null;
    let note = "";
    if (cyDoctor && meta.phone) {
      try {
        const created = await open.createExpertAppointment(userId, {
          doctor_id: cyDoctor,
          phone: meta.phone,
          service_type: serviceType,
          desc: String((b && b.desc) || "加号/绿通意向").slice(0, 500),
          has_visit_doctor: !!(b && b.hasVisitDoctor),
          has_checkup: !!(b && b.hasCheckup),
          sex: meta.sex || "未知",
          age: parseInt(String(meta.age), 10) || 0,
          problem_desc: String((b && b.problemDesc) || b.desc || "请协助安排门诊/住院").slice(0, 500),
          image_list: "[]",
          partner_order_id: "gc-" + Date.now(),
          price_fen: 0
        });
        if (created && (created.error_code === 0 || created.service_id)) serviceId = created.service_id || null;
        else note = String((created && created.error_msg) || "");
      } catch (e) {
        note = e && e.message ? String(e.message) : "";
      }
    } else {
      note = cyDoctor ? "missing_phone" : "missing_chunyu_doctor_id";
    }
    const orderId = open.insertOrder(db, {
      personId: sess.person_id,
      patientId: sess.patient_id,
      doctorId: sess.doctor_id,
      userId,
      kind: "expert",
      status: serviceId ? "opened" : "jump",
      serviceId,
      jumpUrl: h5Url,
      extra: { note, serviceType }
    });
    json(res, 200, open.publicJump("expert", userId, { h5Url, serviceId, orderId, note }));
  });

  route("GET", /^\/api\/mp\/chunyu\/orders$/, (req, res) => {
    const sess = requirePhoneSess(req, res, json);
    if (!sess) return;
    const rows = db.prepare(
      "SELECT id, kind, status, problem_id, service_id, jump_url, created_at, updated_at FROM chunyu_orders WHERE person_id=? ORDER BY id DESC LIMIT 50"
    ).all(+sess.person_id);
    json(res, 200, { ok: true, items: rows });
  });

  route("POST", /^\/api\/chunyu\/callback$/, async (req, res) => {
    const b = await parseBody(req, MESSAGE_MAX_BODY || 1e6);
    if (!open.verifyCallbackSign(b)) {
      return json(res, 403, { error: 1, error_msg: "sign verification failed", error_code: 1 });
    }
    const status = String(b.status || b.event_type || "update");
    if (b.problem_id) {
      open.updateOrderByProblem(db, b.problem_id, { status, extra: { callback: true } });
    }
    if (b.service_id) {
      open.updateOrderByService(db, b.service_id, { status, extra: { callback: true, task_status: b.task_status } });
    }
    json(res, 200, { error: 0, error_code: 0, error_msg: "" });
  });

  route("GET", /^\/api\/admin\/chunyu\/orders$/, (req, res, m, q) => {
    const s = authed && authed(req);
    if (!s) return json(res, 401, { error: "未登录" });
    const did = q && q.doctorId != null && q.doctorId !== "" ? +q.doctorId : 0;
    if (did && allowDoctor && !allowDoctor(s, did)) return json(res, 403, { error: "无权查看该医生" });
    const sql = did
      ? "SELECT * FROM chunyu_orders WHERE doctor_id=? ORDER BY id DESC LIMIT 100"
      : "SELECT * FROM chunyu_orders ORDER BY id DESC LIMIT 100";
    const rows = did ? db.prepare(sql).all(did) : db.prepare(sql).all();
    json(res, 200, { ok: true, configured: open.cfg().configured, items: rows });
  });
}

module.exports = { registerChunyuOpenRoutes, personMeta, chunyuDoctorId };
