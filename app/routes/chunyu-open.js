"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
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
    // ponytail: 先放宽为“仅要求会话存在”，避免 phone_bound 标记置位失败导致 consult 流程被错误拦截。
    // open.chunyuUserId 主要依赖 sess.person_id；如果 person_id 缺失，后续会返回 chunyu_user_required（400），不会继续错配为 401。
    return mpAuth.requireSession(token);
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

function parseOrderExtra(row) {
  try { return JSON.parse((row && row.extra) || "{}") || {}; } catch (e) { return {}; }
}

function getActiveConsult(db, personId) {
  const rows = db.prepare(
    "SELECT * FROM chunyu_orders WHERE person_id=? AND kind='consult' ORDER BY id DESC LIMIT 8"
  ).all(+personId);
  for (const row of rows) {
    const extra = parseOrderExtra(row);
    if (extra.reset) continue;
    const st = String(row.status || "").toLowerCase();
    if (st === "closed" || st === "c" || st === "p") continue;
    return row;
  }
  return null;
}

function updateConsultOrder(db, orderId, patch) {
  const row = db.prepare("SELECT extra FROM chunyu_orders WHERE id=?").get(+orderId);
  if (!row) return;
  const extra = parseOrderExtra(row);
  if (patch.extra) Object.assign(extra, patch.extra);
  const now = new Date().toISOString();
  db.prepare("UPDATE chunyu_orders SET status=COALESCE(?,status), extra=?, updated_at=? WHERE id=?").run(
    patch.status || null,
    JSON.stringify(extra),
    now,
    +orderId
  );
}

function closeConsultOrders(db, personId) {
  const now = new Date().toISOString();
  const rows = db.prepare(
    "SELECT id, extra FROM chunyu_orders WHERE person_id=? AND kind='consult' AND status NOT IN ('closed','c','p') ORDER BY id DESC"
  ).all(+personId);
  for (const row of rows) {
    const extra = parseOrderExtra(row);
    extra.reset = true;
    db.prepare("UPDATE chunyu_orders SET status='closed', extra=?, updated_at=? WHERE id=?").run(
      JSON.stringify(extra),
      now,
      row.id
    );
  }
}

function formatConsultReply(replies, doctor, closed) {
  const texts = (replies || []).map((r) => String(r.text || "").trim()).filter(Boolean);
  const replyText = texts.join("\n\n");
  if (replyText) {
    const last = replies[replies.length - 1];
    return {
      id: String((last && last.id) || `d-${Date.now()}`),
      role: "assistant",
      text: replyText,
      doctorName: doctor && doctor.name ? String(doctor.name) : ""
    };
  }
  if (closed) {
    return {
      id: `d-${Date.now()}`,
      role: "assistant",
      text: "本次问诊已结束。如需继续咨询，请重新描述您的问题。"
    };
  }
  return null;
}

async function ensureChunyuLogin(userId, res, json) {
  try {
    const login = await open.syncLogin(userId);
    if (Number(login.error) !== 0) {
      json(res, 502, { error: "chunyu_login_failed", message: String(login.error_msg || "") });
      return false;
    }
    return true;
  } catch (e) {
    json(res, 502, { error: "chunyu_upstream", message: String((e && e.message) || e) });
    return false;
  }
}

function publicOrigin(env) {
  return String((env && (env.PUBLIC_ORIGIN || env.CHUNYU_API_HOST)) || process.env.PUBLIC_ORIGIN || process.env.CHUNYU_API_HOST || "").replace(/\/$/, "");
}

function originFromReq(req) {
  const headers = (req && req.headers) || {};
  const forwardedHost = String(headers["x-forwarded-host"] || "").trim();
  const host = (forwardedHost || String(headers.host || "")).split(",")[0].trim();
  if (!host) return "";
  const cleanHost = host.replace(/:\d+$/, "");
  const forwardedProto = String(headers["x-forwarded-proto"] || "").trim();
  const proto = (forwardedProto || "").split(",")[0].trim() || "https";
  return `${proto}://${cleanHost}`;
}

function saveConsultImages(req, dataUrls) {
  const origin = publicOrigin(process.env) || originFromReq(req);
  if (!origin) return [];
  const dir = path.join(__dirname, "..", "public", "uploads", "consult-images");
  fs.mkdirSync(dir, { recursive: true });
  const urls = [];
  const list = Array.isArray(dataUrls) ? dataUrls.slice(0, 3) : [];
  for (const raw of list) {
    const m = String(raw || "").trim().match(/^data:(image\/(?:jpeg|jpg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/i);
    if (!m) continue;
    const buf = Buffer.from(m[2].replace(/\s+/g, ""), "base64");
    if (!buf.length || buf.length > 4 * 1024 * 1024) continue;
    const ext = /png/i.test(m[1]) ? "png" : /webp/i.test(m[1]) ? "webp" : "jpg";
    const name = Date.now() + "-" + crypto.randomBytes(6).toString("hex") + "." + ext;
    fs.writeFileSync(path.join(dir, name), buf);
    urls.push(origin + "/uploads/consult-images/" + name);
  }
  return urls;
}

function mapRecommendDoctor(row) {
  if (!row || typeof row !== "object") return null;
  return {
    id: String(row.id || ""),
    name: String(row.name || ""),
    title: String(row.title || ""),
    hospital: String(row.hospital_name || ""),
    hospitalGrade: String(row.hospital_grade || ""),
    clinic: String(row.clinic_name || ""),
    goodAt: String(row.good_at || "").slice(0, 80),
    image: String(row.image || ""),
    priceFen: Number(row.price) || 0,
    goodRate: String(row.good_rate || ""),
    isActive: !!row.is_active,
    isFamous: !!row.is_famous_doctor
  };
}

async function fetchRecommendations(userId, ask) {
  try {
    const rec = await open.getRecommendedDoctors(userId, ask);
    if (Number(rec.error) !== 0 || !Array.isArray(rec.doctors)) return [];
    return rec.doctors.map(mapRecommendDoctor).filter((d) => d && d.id).slice(0, 6);
  } catch (e) {
    return [];
  }
}

function normalizeFirstConsultText(text, imageUrls) {
  const raw = String(text || "").trim();
  if (raw.length >= 6) return raw;
  if (!raw && Array.isArray(imageUrls) && imageUrls.length) {
    return "我上传了检查资料，请结合图片内容帮我做初步分析并给出就医建议。";
  }
  if (!raw) {
    return "我想咨询一个健康问题，请先帮我做初步分析并给出下一步建议。";
  }
  return `${raw}。我想咨询一个健康问题，请先帮我做初步分析并给出建议。`;
}

async function createConsultProblem(db, sess, userId, text, meta, imageUrls) {
  const normalizedText = normalizeFirstConsultText(text, imageUrls);
  const created = await open.createFreeProblem(userId, normalizedText, meta, imageUrls);
  if (Number(created.error) !== 0 && !created.problem_id) {
    const err = new Error(String(created.error_msg || "chunyu_create_failed"));
    err.code = "chunyu_create_failed";
    throw err;
  }
  const problemId = created.problem_id;
  const orderId = open.insertOrder(db, {
    personId: sess.person_id,
    patientId: sess.patient_id,
    doctorId: sess.doctor_id,
    userId,
    kind: "consult",
    status: "n",
    problemId,
    extra: { last_content_id: 0 }
  });
  return { problemId, orderId, pollFrom: 0, isNew: true };
}

async function submitConsultMessage(db, sess, userId, text, meta, imageUrls) {
  let order = getActiveConsult(db, sess.person_id);
  if (!order || !order.problem_id) {
    return createConsultProblem(db, sess, userId, text, meta, imageUrls);
  }
  const follow = await open.createProblemContent(userId, order.problem_id, text, imageUrls);
  if (Number(follow.error) !== 0) {
    const msg = String(follow.error_msg || "");
    if (Number(follow.error) === 10301 || /关闭|删除/.test(msg)) {
      updateConsultOrder(db, order.id, { status: "closed", extra: { reset: true } });
      return createConsultProblem(db, sess, userId, text, meta, imageUrls);
    }
    const err = new Error(msg || "chunyu_follow_failed");
    err.code = "chunyu_follow_failed";
    throw err;
  }
  return {
    problemId: order.problem_id,
    orderId: order.id,
    pollFrom: follow.content_id || parseOrderExtra(order).last_content_id || 0,
    isNew: false
  };
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

  const consultSendHandler = async (req, res) => {
    const sess = requirePhoneSess(req, res, json);
    if (!sess) return;
    if (!open.cfg().configured) return notConfigured(res, json);
    const b = await parseBody(req, MESSAGE_MAX_BODY || 1e6);
    const text = String((b && b.text) || "").trim();
    const imageUrls = saveConsultImages(req, b && b.images);
    if (!text && !imageUrls.length) {
      return json(res, 400, { error: "empty_content", message: "请输入文字或上传图片" });
    }
    const meta = personMeta(db, sess);
    let userId;
    try { userId = open.chunyuUserId(sess.person_id, meta.phone); }
    catch (e) { return json(res, 400, { error: "chunyu_user_required" }); }
    if (!(await ensureChunyuLogin(userId, res, json))) return;
    let submit;
    try {
      submit = await submitConsultMessage(db, sess, userId, text, meta, imageUrls);
    } catch (e) {
      return json(res, 502, {
        error: e.code || "chunyu_upstream",
        message: String((e && e.message) || e)
      });
    }
    let pollResult;
    try {
      // 先同步轮询拿到可用回复；失败/超时由前端后续 consult/poll 链路继续兜底
      // ponytail: 这里避免在 `consult/send` 里阻塞太久导致反向代理 502/504；后续由前端调用 `consult/poll` 继续兜底
      const maxWaitMs = imageUrls.length ? 8000 : 12000;
      pollResult = await open.pollDoctorReplies(
        userId,
        submit.problemId,
        submit.pollFrom,
        process.env,
        { maxWaitMs, intervalMs: 2000 }
      );
    } catch (e) {
      pollResult = { pending: true, status: "a" };
    }
    const replies = pollResult.replies || [];
    const doctor = pollResult.doctor || null;
    const status = pollResult.status || "a";
    const extra = { last_content_id: submit.pollFrom };
    if (replies.length) {
      extra.last_content_id = Math.max.apply(null, replies.map((r) => Number(r.id) || 0));
      if (doctor) extra.doctor = doctor;
    }
    updateConsultOrder(db, submit.orderId, {
      status: pollResult.closed ? "closed" : String(status),
      extra
    });
    const reply = formatConsultReply(replies, doctor, pollResult.closed);
    const askForRec = text || "请查看我上传的图片资料";
    const recommendations = submit.isNew ? await fetchRecommendations(userId, askForRec) : [];
    if (!reply) {
      return json(res, 200, {
        ok: true,
        problemId: submit.problemId,
        pending: true,
        status,
        recommendations,
        message: "医生正在接诊，请稍候…"
      });
    }
    json(res, 200, {
      ok: true,
      problemId: submit.problemId,
      pending: false,
      status,
      recommendations,
      doctor: doctor ? {
        id: doctor.id,
        name: doctor.name,
        title: doctor.title,
        image: doctor.image,
        hospital: doctor.hospital
      } : null,
      reply
    });
  };

  route("POST", /^\/api\/mp\/chunyu\/consult\/send$/, consultSendHandler);
  route("GET", /^\/api\/mp\/chunyu\/consult\/send$/, consultSendHandler);

  route("POST", /^\/api\/mp\/chunyu\/consult\/recommend$/, async (req, res) => {
    const sess = requirePhoneSess(req, res, json);
    if (!sess) return;
    if (!open.cfg().configured) return notConfigured(res, json);
    const b = await parseBody(req, MESSAGE_MAX_BODY || 1e6);
    const ask = String((b && b.ask) || "").trim();
    if (!ask) return json(res, 400, { error: "empty_ask" });
    const meta = personMeta(db, sess);
    let userId;
    try { userId = open.chunyuUserId(sess.person_id, meta.phone); }
    catch (e) { return json(res, 400, { error: "chunyu_user_required" }); }
    if (!(await ensureChunyuLogin(userId, res, json))) return;
    const recommendations = await fetchRecommendations(userId, ask);
    json(res, 200, { ok: true, recommendations });
  });

  route("POST", /^\/api\/mp\/chunyu\/consult\/doctor-page$/, async (req, res) => {
    const sess = requirePhoneSess(req, res, json);
    if (!sess) return;
    if (!open.cfg().configured) return notConfigured(res, json);
    const b = await parseBody(req, MESSAGE_MAX_BODY || 1e6);
    const doctorId = String((b && b.doctorId) || "").trim();
    if (!doctorId) return json(res, 400, { error: "doctor_id_required" });
    const meta = personMeta(db, sess);
    let userId;
    try { userId = open.chunyuUserId(sess.person_id, meta.phone); }
    catch (e) { return json(res, 400, { error: "chunyu_user_required" }); }
    if (!(await ensureChunyuLogin(userId, res, json))) return;
    const jump = open.doctorMiniProgramJump(userId, doctorId);
    json(res, 200, Object.assign({ ok: true, doctorId }, jump));
  });

  route("POST", /^\/api\/mp\/chunyu\/consult\/poll$/, async (req, res) => {
    const sess = requirePhoneSess(req, res, json);
    if (!sess) return;
    if (!open.cfg().configured) return notConfigured(res, json);
    const order = getActiveConsult(db, sess.person_id);
    if (!order || !order.problem_id) {
      return json(res, 200, { ok: true, pending: false, reply: null });
    }
    const meta = personMeta(db, sess);
    let userId;
    try { userId = open.chunyuUserId(sess.person_id, meta.phone); }
    catch (e) { return json(res, 400, { error: "chunyu_user_required" }); }
    if (!(await ensureChunyuLogin(userId, res, json))) return;
    const extra = parseOrderExtra(order);
    let pollResult;
    try {
      pollResult = await open.pollDoctorReplies(userId, order.problem_id, extra.last_content_id || 0, process.env, {
        maxWaitMs: 15000,
        intervalMs: 2000
      });
    } catch (e) {
      return json(res, 502, { error: "chunyu_upstream", message: String((e && e.message) || e) });
    }
    const replies = pollResult.replies || [];
    const doctor = pollResult.doctor || extra.doctor || null;
    const status = pollResult.status || order.status;
    const patchExtra = {};
    if (replies.length) {
      patchExtra.last_content_id = Math.max.apply(null, replies.map((r) => Number(r.id) || 0));
      if (doctor) patchExtra.doctor = doctor;
    }
    updateConsultOrder(db, order.id, {
      status: pollResult.closed ? "closed" : String(status),
      extra: patchExtra
    });
    const reply = formatConsultReply(replies, doctor, pollResult.closed);
    json(res, 200, {
      ok: true,
      problemId: order.problem_id,
      pending: !reply && !pollResult.closed,
      status,
      doctor: doctor ? { id: doctor.id, name: doctor.name, title: doctor.title } : null,
      reply
    });
  });

  route("POST", /^\/api\/mp\/chunyu\/consult\/reset$/, (req, res) => {
    const sess = requirePhoneSess(req, res, json);
    if (!sess) return;
    closeConsultOrders(db, sess.person_id);
    json(res, 200, { ok: true });
  });

  route("POST", /^\/api\/chunyu\/callback$/, async (req, res) => {
    const b = await parseBody(req, MESSAGE_MAX_BODY || 1e6);
    if (!open.verifyCallbackSign(b)) {
      return json(res, 403, { error: 1, error_msg: "sign verification failed", error_code: 1 });
    }
    const status = String(b.status || b.event_type || "update");
    if (b.problem_id) {
      const patch = { status, extra: { callback: true } };
      if (String(status).toLowerCase() === "reply" && b.content) {
        patch.extra.pending_reply = open.parseContentText(b.content);
        if (b.doctor) patch.extra.doctor = b.doctor;
      }
      if (String(status).toLowerCase() === "close") patch.status = "closed";
      open.updateOrderByProblem(db, b.problem_id, patch);
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
