"use strict";
const crypto = require("crypto");
const net = require("net");
const mpAuth = require("../mp_auth.js");
const { createFixedWindowLimiter } = require("../rate_limit.js");

const loginCodeLimiter = createFixedWindowLimiter({
  limit: 10,
  windowMs: 60_000,
  maxKeys: 10_000
});
const loginIpLimiter = createFixedWindowLimiter({
  limit: 30,
  windowMs: 60_000,
  maxKeys: 10_000
});

const AUTH_ERRORS = {
  unauthorized: { status: 401, error: "unauthorized" },
  session_expired: { status: 401, error: "session_expired" },
  doctor_required: { status: 400, error: "doctor_required" },
  doctor_unavailable: { status: 403, error: "doctor_unavailable" },
  phone_already_bound: { status: 409, error: "phone_already_bound" },
  sms_not_wired: { status: 503, error: "sms_unavailable" },
  sms_not_configured: { status: 503, error: "sms_unavailable" },
  sms_unavailable: { status: 503, error: "sms_unavailable" },
  invalid_phone: { status: 400, error: "invalid_phone" },
  invalid_sms_code: { status: 400, error: "invalid_sms_code" },
  person_required: { status: 401, error: "person_required" },
  person_not_found: { status: 401, error: "person_not_found" },
  account_not_bound: { status: 403, error: "account_not_bound" },
  identity_mismatch: { status: 403, error: "identity_mismatch" },
  invalid_request_type: { status: 400, error: "invalid_request_type" },
  invalid_avatar_data: { status: 400, error: "invalid_avatar_data" },
  avatar_too_large: { status: 400, error: "avatar_too_large" },
  // 微信开放接口业务错误：不应作为 500 内部错误
  invalid_code: { status: 400, error: "invalid_code" },
  code_been_used: { status: 400, error: "code_been_used" },
  access_token_failed: { status: 502, error: "wechat_upstream_error" },
  getphone_failed: { status: 502, error: "wechat_upstream_error" },
  code2session_failed: { status: 502, error: "wechat_upstream_error" },
  wechat_non_json: { status: 502, error: "wechat_upstream_error" }
};

/** 微信 errmsg/errcode 片段 → 业务错误 code（识别后不落 500） */
function wechatErrCode(message) {
  const msg = String(message || "").toLowerCase();
  if (/invalid code|\[40029\]/.test(msg)) return "invalid_code";
  if (/code been used|40163/.test(msg)) return "code_been_used";
  if (/code expired|40085/.test(msg)) return "invalid_code";
  if (/access_token_failed|access token expired|42001/.test(msg)) return "access_token_failed";
  if (/getphone_failed|phone number/.test(msg)) return "getphone_failed";
  if (/code2session_failed/.test(msg)) return "code2session_failed";
  return null;
}

function authError(error, fallback = "server_error", fallbackStatus = 500) {
  const code = error && error.message ? String(error.message) : "";
  if (AUTH_ERRORS[code]) return AUTH_ERRORS[code];
  // 微信原始 errmsg（如 "invalid code, rid: xxx"）→ 业务错误而非 500
  const wechatCode = wechatErrCode(code);
  if (wechatCode && AUTH_ERRORS[wechatCode]) return AUTH_ERRORS[wechatCode];
  return { status: fallbackStatus, error: fallback };
}

function normalizeIp(value) {
  const raw = String(value || "").trim();
  if (raw.startsWith("::ffff:")) {
    const ipv4 = raw.slice(7);
    if (net.isIP(ipv4) === 4) return ipv4;
  }
  if (raw === "0:0:0:0:0:0:0:1") return "::1";
  return raw;
}

function requestHeader(req, name) {
  const headers = (req && req.headers) || {};
  const key = Object.keys(headers).find(
    (item) => String(item).toLowerCase() === name
  );
  return key ? headers[key] : undefined;
}

function validProxyIp(value, forwarded) {
  if (Array.isArray(value)) {
    if (value.length !== 1) return "";
    value = value[0];
  }
  const candidate = String(value || "").trim();
  const first = forwarded ? candidate.split(",")[0].trim() : candidate;
  const normalized = normalizeIp(first);
  return net.isIP(normalized) ? normalized : "";
}

function isLoopback(ip) {
  if (ip === "::1") return true;
  if (net.isIP(ip) !== 4) return false;
  return ip.split(".")[0] === "127";
}

function clientIp(req) {
  const remote = normalizeIp(req && req.socket && req.socket.remoteAddress) || "local";
  if (!isLoopback(remote)) return remote;

  const realIpHeader = requestHeader(req, "x-real-ip");
  if (realIpHeader != null && String(realIpHeader).trim() !== "") {
    return validProxyIp(realIpHeader, false) || remote;
  }
  const forwardedHeader = requestHeader(req, "x-forwarded-for");
  return validProxyIp(forwardedHeader, true) || remote;
}

function loginRateKey(req, code) {
  const digest = crypto
    .createHash("sha256")
    .update(String(code || ""))
    .digest("hex");
  return clientIp(req) + "|" + digest;
}

function logInternalError(context, mapped, error) {
  if (mapped.status >= 500 && mapped.error !== "sms_unavailable") {
    const detail = error && error.message ? `: ${String(error.message).slice(0, 500)}` : "";
    const stack = error && error.stack ? `\n${String(error.stack).slice(0, 1200)}` : "";
    console.error(`[mp/auth/${context}] internal_error${detail}${stack}`);
  }
}

function bearerToken(req) {
  const h = req.headers.authorization || req.headers.Authorization || "";
  const m = String(h).match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : "";
}

function dataRequestIdentity(db, token) {
  if (!token) throw new Error("unauthorized");
  const sess = mpAuth.requireBoundSession(token);
  const personId = Number(sess.person_id);
  const patientId = Number(sess.patient_id);
  const doctorId = Number(sess.doctor_id);
  return { personId, patientId, doctorId };
}

function publicDataRequest(row) {
  return {
    id: Number(row.id),
    requestType: row.request_type,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at || null
  };
}

function registerMpAuthRoutes(route, ctx) {
  const { parseBody, json, verifySms, MESSAGE_MAX_BODY, db, profileStore, patientProfile } = ctx;
  if (verifySms) mpAuth.setSmsVerifier(verifySms);

  route("POST", /^\/api\/mp\/login$/, async (req, res) => {
    const b = await parseBody(req, MESSAGE_MAX_BODY || 1e6);
    const ipLimit = loginIpLimiter.consume(clientIp(req));
    const codeLimit = loginCodeLimiter.consume(loginRateKey(req, b.code));
    if (!ipLimit.allowed || !codeLimit.allowed) {
      res.setHeader(
        "Retry-After",
        String(Math.max(ipLimit.retryAfter || 0, codeLimit.retryAfter || 0))
      );
      return json(res, 429, { error: "rate_limited" });
    }
    try {
      const out = await mpAuth.login({
        code: b.code,
        doctorId: b.doctorId,
        claimDoctor: !!(b.claimDoctor || b.doctorChosen)
      });
      json(res, 200, out);
    } catch (e) {
      const mapped = authError(e, "login_failed", 500);
      logInternalError("login", mapped, e);
      json(res, mapped.status, { error: mapped.error });
    }
  });

  route("POST", /^\/api\/mp\/bind-phone$/, async (req, res) => {
    const token = bearerToken(req);
    if (!token) return json(res, 401, { error: "unauthorized" });
    const b = await parseBody(req, MESSAGE_MAX_BODY || 1e6);
    try {
      const out = await mpAuth.bindPhone({
        token,
        phoneCode: b.phoneCode,
        phone: b.phone,
        smsCode: b.smsCode,
        doctorId: b.doctorId,
      });
      json(res, 200, out);
    } catch (e) {
      const mapped = authError(e);
      logInternalError("bind-phone", mapped, e);
      json(res, mapped.status, { error: mapped.error });
    }
  });

  route("GET", /^\/api\/mp\/me$/, (req, res) => {
    try {
      const token = bearerToken(req);
      if (!token) return json(res, 401, { error: "unauthorized" });
      json(res, 200, mpAuth.me(token));
    } catch (e) {
      const mapped = authError(e, "server_error", 500);
      logInternalError("me", mapped, e);
      json(res, mapped.status, { error: mapped.error });
    }
  });

  route("POST", /^\/api\/mp\/avatar$/, async (req, res) => {
    const token = bearerToken(req);
    if (!token) return json(res, 401, { error: "unauthorized" });
    const b = await parseBody(req, MESSAGE_MAX_BODY || 1e6);
    try {
      const out = mpAuth.updateAvatar({
        token,
        avatarDataUrl: b.avatarDataUrl
      });
      json(res, 200, out);
    } catch (e) {
      const mapped = authError(e);
      logInternalError("avatar", mapped, e);
      json(res, mapped.status, { error: mapped.error });
    }
  });

  /** 患者侧档案真读：会话 person + profileStore，身份证/手机脱敏；含表单预填原值 */
  route("POST", /^\/api\/mp\/data-requests$/, async (req, res) => {
    if (!db) return json(res, 500, { error: "data_requests_unavailable" });
    try {
      const token = bearerToken(req);
      dataRequestIdentity(db, token);
      const b = await parseBody(req, MESSAGE_MAX_BODY || 1e6);
      const requestType =
        b && typeof b.requestType === "string" ? b.requestType : "";
      if (requestType !== "export" && requestType !== "delete") {
        throw new Error("invalid_request_type");
      }

      let row;
      let created = false;
      db.exec("BEGIN IMMEDIATE");
      try {
        const identity = dataRequestIdentity(db, token);
        row = db.prepare(`
          SELECT *
          FROM mp_data_requests
          WHERE person_id=? AND request_type=?
            AND status IN ('pending','processing')
          ORDER BY created_at DESC, id DESC
          LIMIT 1
        `).get(identity.personId, requestType);
        if (!row) {
          const now = new Date().toISOString();
          const inserted = db.prepare(`
            INSERT INTO mp_data_requests(
              person_id, patient_id, request_type, status,
              created_at, updated_at, completed_at, operator_id, note
            ) VALUES(?, ?, ?, 'pending', ?, ?, NULL, NULL, NULL)
          `).run(
            identity.personId,
            identity.patientId,
            requestType,
            now,
            now
          );
          row = db.prepare("SELECT * FROM mp_data_requests WHERE id=?")
            .get(Number(inserted.lastInsertRowid));
          created = true;
        }
        db.exec("COMMIT");
      } catch (error) {
        try { db.exec("ROLLBACK"); } catch (rollbackError) {}
        throw error;
      }

      json(res, created ? 201 : 200, {
        ok: true,
        request: publicDataRequest(row)
      });
    } catch (e) {
      const mapped = authError(e, "data_request_failed", 500);
      logInternalError("data-requests", mapped, e);
      json(res, mapped.status, { error: mapped.error });
    }
  });

  route("GET", /^\/api\/mp\/data-requests\/mine$/, (req, res) => {
    if (!db) return json(res, 500, { error: "data_requests_unavailable" });
    try {
      const identity = dataRequestIdentity(db, bearerToken(req));
      const rows = db.prepare(`
        SELECT
          id, request_type, status, created_at, updated_at, completed_at
        FROM mp_data_requests
        WHERE person_id=?
        ORDER BY created_at DESC, id DESC
        LIMIT 100
      `).all(identity.personId);
      json(res, 200, {
        ok: true,
        items: rows.map(publicDataRequest)
      });
    } catch (e) {
      const mapped = authError(e, "data_requests_failed", 500);
      logInternalError("data-requests-mine", mapped, e);
      json(res, mapped.status, { error: mapped.error });
    }
  });

  route("GET", /^\/api\/mp\/archive$/, (req, res) => {
    try {
      if (!db || !profileStore || !patientProfile) {
        return json(res, 500, { error: "archive_unavailable" });
      }
      const token = bearerToken(req);
      if (!token) return json(res, 401, { error: "unauthorized" });
      const sess = mpAuth.requireBoundSession(token);
      const person = db.prepare("SELECT * FROM persons WHERE id=?").get(sess.person_id);
      if (!person || !person.phone_verified || !person.phone) {
        return json(res, 200, { ok: true, hasProfile: false, linked: false });
      }
      const patientId = sess.patient_id != null ? +sess.patient_id : null;
      const patient = patientId
        ? db.prepare("SELECT * FROM patients WHERE id=?").get(patientId)
        : null;
      const fields = profileStore.readPersonFields(sess.person_id) || {};
      const name =
        (person.real_name && String(person.real_name).trim()) ||
        (patient && patient.real_name && String(patient.real_name).trim()) ||
        (patient && patient.display_name && String(patient.display_name).trim()) ||
        "";
      const gender = person.gender || (patient && patient.gender) || "";
      const birthDate = person.birth_date || (patient && patient.birth_date) || "";
      const phone = String(person.phone || "").trim();
      const asAllergy = (v) =>
        v && typeof v === "object"
          ? { values: Array.isArray(v.values) ? v.values : [], other: String(v.other || "") }
          : { values: [], other: "" };
      const hasProfile = !!name;
      const food = asAllergy(fields.foodContactAllergies);
      const drug = asAllergy(fields.drugAllergies);
      const hist = asAllergy(fields.diseaseHistory);

      json(res, 200, {
        ok: true,
        hasProfile,
        linked: true,
        patient: {
          id: patientId,
          name,
          gender,
          birthDate,
          phoneMasked: mpAuth.maskPhone(phone),
        },
        profile: {
          disease: fields.disease || "",
          pregnancyStatus: fields.pregnancyStatus || "",
          foodContactAllergies: food,
          drugAllergies: drug,
          diseaseHistory: hist,
        },
        /* 已登录本人：供建档问卷预填（含明文手机号；身份证号已下线不再回填） */
        formPrefill: {
          name,
          gender,
          birthDate,
          phone,
          disease: fields.disease || "",
          pregnancyStatus: fields.pregnancyStatus || "",
          foodContactAllergies: food,
          drugAllergies: drug,
          diseaseHistory: hist,
        },
      });
    } catch (e) {
      const mapped = authError(e, "server_error", 500);
      logInternalError("archive", mapped, e);
      json(res, mapped.status, { error: mapped.error });
    }
  });

  /** 患者侧健康记录：按 person_id 读取（与后台档案同源） */
  route("GET", /^\/api\/mp\/health-records$/, (req, res, m, q) => {
    try {
      if (!db) return json(res, 500, { error: "unavailable" });
      const token = bearerToken(req);
      if (!token) return json(res, 401, { error: "unauthorized" });
      const sess = mpAuth.requireBoundSession(token);
      const phr = require("../patient_health_records.js");
      const personId = +sess.person_id;
      const catFilter = String((q && q.category) || "").trim();
      let rows;
      if (catFilter) {
        if (!phr.HEALTH_RECORD_CATEGORY_KEYS.has(catFilter)) {
          return json(res, 400, { error: "category 非法" });
        }
        rows = db.prepare(`SELECT phr.*, d.name AS source_doctor_name
          FROM patient_health_records phr
          LEFT JOIN doctors d ON d.id = phr.doctor_id
          WHERE phr.person_id=? AND phr.category=?
          ORDER BY COALESCE(phr.recorded_at,'') DESC, phr.id DESC`).all(personId, catFilter);
      } else {
        rows = db.prepare(`SELECT phr.*, d.name AS source_doctor_name
          FROM patient_health_records phr
          LEFT JOIN doctors d ON d.id = phr.doctor_id
          WHERE phr.person_id=?
          ORDER BY COALESCE(phr.recorded_at,'') DESC, phr.id DESC`).all(personId);
      }
      const counts = {};
      for (const c of phr.HEALTH_RECORD_CATEGORIES) counts[c.key] = 0;
      const countRows = db.prepare(
        `SELECT category, COUNT(*) AS c FROM patient_health_records WHERE person_id=? GROUP BY category`
      ).all(personId);
      for (const r of countRows) counts[r.category] = r.c || 0;
      json(res, 200, {
        ok: true,
        categories: phr.HEALTH_RECORD_CATEGORIES.map((c) => ({
          ...c,
          count: counts[c.key] || 0,
        })),
        items: rows.map(phr.mapHealthRecordRow),
        total: rows.length,
      });
    } catch (e) {
      const mapped = authError(e, "server_error", 500);
      logInternalError("health-records", mapped, e);
      json(res, mapped.status, { error: mapped.error });
    }
  });

  /** 入驻医生库（已绑手机即可，可尚未选定当前医生） */
  route("GET", /^\/api\/mp\/settled-doctors$/, (req, res) => {
    try {
      if (!db) return json(res, 500, { error: "unavailable" });
      const token = bearerToken(req);
      if (!token) return json(res, 401, { error: "unauthorized" });
      mpAuth.requirePhoneBoundSession(token);
      const rows = db.prepare(`
        SELECT id AS doctorId, name AS doctorName, title, dept, hospital
        FROM doctors
        ORDER BY id ASC
      `).all();
      json(res, 200, {
        ok: true,
        doctors: rows.map((r) => ({
          doctorId: r.doctorId,
          doctorName: r.doctorName || "",
          title: r.title || "",
          dept: r.dept || "",
          hospital: r.hospital || ""
        }))
      });
    } catch (e) {
      const mapped = authError(e, "server_error", 500);
      logInternalError("settled-doctors", mapped, e);
      json(res, mapped.status, { error: mapped.error });
    }
  });

  /** 患者本人咨询过的所有医生列表（通过 person_id 跨医生关联） */
  route("GET", /^\/api\/mp\/my-doctors$/, (req, res) => {
    try {
      if (!db) return json(res, 500, { error: "unavailable" });
      const token = bearerToken(req);
      if (!token) return json(res, 401, { error: "unauthorized" });
      const sess = mpAuth.requirePhoneBoundSession(token);
      const personId = +sess.person_id;
      const rows = db.prepare(`
        SELECT d.id AS doctorId, d.name AS doctorName,
          d.title AS title, d.dept AS dept, d.hospital AS hospital,
          p.id AS patientId,
          p.display_name AS displayName,
          p.updated_at AS lastAt,
          (SELECT COUNT(*) FROM message_log ml
            WHERE ml.doctor_id=d.id AND ml.patient_id=CAST(p.id AS TEXT)) AS msgCount
        FROM patients p
        JOIN doctors d ON d.id = p.doctor_id
        WHERE p.person_id = ?
        ORDER BY p.updated_at DESC
      `).all(personId);
      const doctors = rows.map(r => ({
        doctorId: r.doctorId,
        doctorName: r.doctorName || "",
        title: r.title || "",
        dept: r.dept || "",
        hospital: r.hospital || "",
        avatarUrl: "",
        patientId: r.patientId,
        msgCount: r.msgCount || 0,
        lastAt: r.lastAt || ""
      }));
      json(res, 200, { ok: true, doctors, personId });
    } catch (e) {
      const mapped = authError(e, "server_error", 500);
      logInternalError("my-doctors", mapped, e);
      json(res, mapped.status, { error: mapped.error });
    }
  });

  route("POST", /^\/api\/mp\/logout$/, (req, res) => {
    try {
      const token = bearerToken(req);
      if (token) mpAuth.logout(token);
      json(res, 200, { ok: true });
    } catch (e) {
      json(res, 200, { ok: true });
    }
  });

  route("POST", /^\/api\/mp\/unbind-phone$/, (req, res) => {
    try {
      const token = bearerToken(req);
      if (!token) return json(res, 401, { error: "unauthorized" });
      json(res, 200, mpAuth.unbindPhone(token));
    } catch (e) {
      const mapped = authError(e);
      logInternalError("unbind-phone", mapped, e);
      json(res, mapped.status, { error: mapped.error });
    }
  });
}

module.exports = { registerMpAuthRoutes, bearerToken, clientIp, loginRateKey };
