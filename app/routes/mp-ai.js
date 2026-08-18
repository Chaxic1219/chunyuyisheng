"use strict";

const crypto = require("crypto");
const defaultMpAi = require("../modules/mpAi");
const mpAuth = require("../mp_auth.js");
const { createFixedWindowLimiter } = require("../rate_limit.js");
const { bearerToken } = require("./mp-auth.js");

const AI_CONSENT_VERSION = "2026-07-31";
const AI_TOKEN_LIMIT = 20;
const AI_OPENID_LIMIT = 40;
const AI_RATE_WINDOW_MS = 60_000;
const AI_MAX_IMAGES = 3;
const AI_MAX_IMAGE_BYTES = 4 * 1024 * 1024; // 单张 4MB（含 base64 开销前）
const AI_IMAGE_MIME_RE = /^data:image\/(?:jpeg|png|webp|gif);base64,/i;

/** 校验并规范化小程序上传的图片（data URL 数组）；返回 { ok, images, error } */
function normalizeImages(rawImages) {
  if (rawImages == null || rawImages === "") return { ok: true, images: [] };
  const list = Array.isArray(rawImages) ? rawImages : [rawImages];
  const images = [];
  for (const item of list) {
    const s = String(item == null ? "" : item).trim();
    if (!s) continue;
    if (!AI_IMAGE_MIME_RE.test(s)) {
      return { ok: false, error: "image_format_unsupported", message: "仅支持 JPEG/PNG/WebP/GIF 图片" };
    }
    // 4MB 上限：base64 长度 ≈ 字节数 * 4/3
    if (s.length > Math.ceil(AI_MAX_IMAGE_BYTES * 4 / 3) + 64) {
      return { ok: false, error: "image_too_large", message: "单张图片不能超过 4MB" };
    }
    images.push(s);
    if (images.length >= AI_MAX_IMAGES) break;
  }
  return { ok: true, images };
}

function stableAiError(error) {
  const code = error && error.code;
  if (code === "bad_request") return { status: 400, error: "bad_request" };
  if (code === "not_found") return { status: 404, error: "doctor_not_found" };
  if (code === "not_configured") return { status: 503, error: "ai_not_configured" };
  if (code === "upstream_error") return { status: 502, error: "upstream_error" };
  return { status: 500, error: "mp_ai_failed" };
}

function normalizedHistoryTurns(mpAi, history) {
  if (mpAi && typeof mpAi.normalizeHistory === "function") {
    return mpAi.normalizeHistory(history).length;
  }
  const rows = Array.isArray(history) ? history : [];
  return rows.filter((row) => {
    if (!row || !["user", "assistant", "ai"].includes(row.role)) return false;
    return !!String(row.text != null ? row.text : row.content || "").trim();
  }).slice(-10).length;
}

function positiveSafeInteger(value) {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }
  if (typeof value === "string" && /^\d+$/.test(value)) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function sendRateLimited(res, json, rate) {
  if (res && typeof res.setHeader === "function") {
    res.setHeader("Retry-After", Math.max(1, Number(rate.retryAfter) || 1));
  }
  return json(res, 429, { error: "rate_limited" });
}

function boundSessionResult(token, doctorId) {
  try {
    return { session: mpAuth.requireBoundSession(token, { doctorId }) };
  } catch (error) {
    const code = error && error.message;
    if (code === "account_not_bound" || code === "identity_mismatch") {
      return { status: 403, error: "patient_binding_required" };
    }
    return { status: 401, error: "unauthorized" };
  }
}

function registerMpAiRoutes(route, ctx) {
  const { parseBody, json, MESSAGE_MAX_BODY, db } = ctx;
  const mpAi = ctx.mpAi || defaultMpAi;
  const tokenLimiter = ctx.tokenLimiter || createFixedWindowLimiter({
    limit: AI_TOKEN_LIMIT,
    windowMs: AI_RATE_WINDOW_MS
  });
  const openidLimiter = ctx.openidLimiter || createFixedWindowLimiter({
    limit: AI_OPENID_LIMIT,
    windowMs: AI_RATE_WINDOW_MS
  });

  route("POST", /^\/api\/mp\/ai-chat$/, async (req, res) => {
    const token = bearerToken(req);
    if (!token) return json(res, 401, { error: "unauthorized" });

    let authorized = boundSessionResult(token);
    if (!authorized.session) {
      return json(res, authorized.status, { error: authorized.error });
    }
    let sess = authorized.session;
    const sessionDoctorId = positiveSafeInteger(sess.doctor_id);
    if (!sessionDoctorId || typeof sess.openid !== "string" || !sess.openid) {
      return json(res, 401, { error: "unauthorized" });
    }
    let personId = positiveSafeInteger(sess.person_id);
    let patientId = positiveSafeInteger(sess.patient_id);

    const b = await parseBody(req, MESSAGE_MAX_BODY || 1e6);
    if (!isPlainObject(b)) {
      return json(res, 400, { error: "bad_request" });
    }
    const imagesCheck = normalizeImages(b.images);
    if (!imagesCheck.ok) {
      return json(res, 400, { error: imagesCheck.error });
    }
    const did = positiveSafeInteger(b.doctorId);
    if (!did) {
      return json(res, 400, { error: "bad_request" });
    }
    if (sessionDoctorId !== did) {
      return json(res, 403, { error: "doctor_mismatch" });
    }
    let sessionId = "";
    if (b.sessionId != null && b.sessionId !== "") {
      if (
        typeof b.sessionId !== "string" ||
        !/^[A-Za-z0-9_-]{1,128}$/.test(b.sessionId)
      ) {
        return json(res, 400, { error: "bad_request" });
      }
      sessionId = b.sessionId;
    }
    if (
      b.sensitiveDataConsent !== true ||
      b.consentVersion !== AI_CONSENT_VERSION
    ) {
      return json(res, 403, { error: "ai_consent_required" });
    }

    authorized = boundSessionResult(token, did);
    if (!authorized.session) {
      return json(res, authorized.status, { error: authorized.error });
    }
    sess = authorized.session;
    personId = positiveSafeInteger(sess.person_id);
    patientId = positiveSafeInteger(sess.patient_id);

    const tokenKey = crypto.createHash("sha256").update(token).digest("hex");
    const tokenRate = tokenLimiter.consume(tokenKey);
    if (!tokenRate.allowed) return sendRateLimited(res, json, tokenRate);
    const openidKey = "openid:" + crypto
      .createHash("sha256")
      .update(sess.openid)
      .digest("hex");
    const openidRate = openidLimiter.consume(openidKey);
    if (!openidRate.allowed) return sendRateLimited(res, json, openidRate);

    const now = new Date().toISOString();
    const inputChars = String(b.text || "").trim().slice(0, 2000).length;
    const historyTurns = normalizedHistoryTurns(mpAi, b.history);
    let configuredModel = null;
    try {
      const config = typeof mpAi.resolveConfig === "function" ? mpAi.resolveConfig() : null;
      configuredModel = config && config.model ? String(config.model) : null;
    } catch (e) {
      configuredModel = null;
    }

    let auditId;
    let transactionOpen = false;
    try {
      db.exec("BEGIN IMMEDIATE");
      transactionOpen = true;
      authorized = boundSessionResult(token, did);
      if (!authorized.session) {
        const error = new Error(authorized.error);
        error.httpStatus = authorized.status;
        throw error;
      }
      sess = authorized.session;
      personId = positiveSafeInteger(sess.person_id);
      patientId = positiveSafeInteger(sess.patient_id);
      const result = db.prepare(`INSERT INTO mp_ai_audit(
        openid, person_id, patient_id, doctor_id, session_id, model,
        input_chars, history_turns, status, error_code, created_at, updated_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        String(sess.openid),
        personId,
        patientId,
        did,
        sessionId,
        configuredModel,
        inputChars,
        historyTurns,
        "pending",
        null,
        now,
        now
      );
      auditId = Number(result.lastInsertRowid);
      db.exec("COMMIT");
      transactionOpen = false;
    } catch (e) {
      if (transactionOpen) {
        try { db.exec("ROLLBACK"); } catch (rollbackError) {}
      }
      if (e && e.httpStatus) {
        return json(res, e.httpStatus, { error: e.message });
      }
      return json(res, 500, { error: "audit_unavailable" });
    }

    try {
      const out = await mpAi.chat({
        doctorId: did,
        patientId,
        personId,
        text: b.text,
        images: imagesCheck.images,
        history: b.history,
        sessionId,
        assistantRole: b.assistantRole,
        pageContext: b.pageContext
      });
      try {
        const updated = db.prepare(
          "UPDATE mp_ai_audit SET status='success', model=?, error_code=NULL, updated_at=? WHERE id=?"
        ).run(
          out && out.model ? String(out.model) : configuredModel,
          new Date().toISOString(),
          auditId
        );
        if (!updated || updated.changes !== 1) {
          throw new Error("audit_update_failed");
        }
      } catch (e) {
        return json(res, 500, { error: "audit_unavailable" });
      }
      return json(res, 200, out);
    } catch (e) {
      const mapped = stableAiError(e);
      try {
        const updated = db.prepare(
          "UPDATE mp_ai_audit SET status='error', error_code=?, updated_at=? WHERE id=?"
        ).run(mapped.error, new Date().toISOString(), auditId);
        if (!updated || updated.changes !== 1) {
          throw new Error("audit_update_failed");
        }
      } catch (auditError) {
        return json(res, 500, { error: "audit_unavailable" });
      }
      return json(res, mapped.status, { error: mapped.error });
    }
  });
}

module.exports = {
  registerMpAiRoutes,
  normalizeImages,
  AI_CONSENT_VERSION,
  AI_TOKEN_LIMIT,
  AI_OPENID_LIMIT,
  AI_MAX_IMAGES,
  AI_MAX_IMAGE_BYTES
};
