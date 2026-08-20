"use strict";
/**
 * 春雨开放平台客户端：签名、H5/小程序跳转、图文建单、专家预约。
 * 密钥只读环境变量，禁止写入源码或日志。
 */
const crypto = require("crypto");
const https = require("https");
const http = require("http");
const { URL } = require("url");

const CHUNYU_WX_APPID = "wx214b7e2bcde837d6";

function cfg(env = process.env) {
  const host = String(env.CHUNYU_API_HOST || "").trim().replace(/\/$/, "");
  const partner = String(env.CHUNYU_PARTNER || "").trim();
  const partnerKey = String(env.CHUNYU_PARTNER_KEY || "").trim();
  return {
    host,
    partner,
    partnerKey,
    wxAppId: String(env.CHUNYU_WX_APPID || CHUNYU_WX_APPID).trim() || CHUNYU_WX_APPID,
    wxEnv: String(env.CHUNYU_WXAPP_ENV || "").trim(),
    configured: !!(host && partner && partnerKey)
  };
}

/** 文档约定：md5(partner_key + atime + user_id) 取中间 16 位 */
function sign(partnerKey, atime, userId) {
  const raw = String(partnerKey || "") + String(atime || "") + String(userId || "");
  return crypto.createHash("md5").update(raw, "utf8").digest("hex").slice(8, 24);
}

function nowAtime() {
  return String(Math.floor(Date.now() / 1000));
}

function chunyuUserId(personId, phone) {
  const pid = Number(personId);
  if (Number.isInteger(pid) && pid > 0) return ("p" + pid).slice(0, 32);
  const mobile = String(phone || "").replace(/\D/g, "");
  if (/^1\d{10}$/.test(mobile)) return ("m" + mobile).slice(0, 32);
  throw new Error("chunyu_user_required");
}

function authParams(userId, env = process.env) {
  const c = cfg(env);
  if (!c.configured) throw new Error("chunyu_not_configured");
  const atime = nowAtime();
  return {
    user_id: String(userId).slice(0, 32),
    partner: c.partner,
    atime,
    sign: sign(c.partnerKey, atime, userId)
  };
}

function h5Origin(env = process.env) {
  const pub = String(env.CHUNYU_H5_PUBLIC_ORIGIN || env.PUBLIC_ORIGIN || "").trim().replace(/\/$/, "");
  if (pub) return pub;
  return cfg(env).host;
}

function signedUrl(pathname, userId, extra, env = process.env) {
  const q = Object.assign(authParams(userId, env), extra || {});
  const usp = new URLSearchParams();
  Object.keys(q).forEach((k) => {
    if (q[k] == null || q[k] === "") return;
    usp.set(k, String(q[k]));
  });
  return h5Origin(env) + pathname + "?" + usp.toString();
}

function graphLoginUrl(userId, entranceType, env = process.env) {
  const extra = {};
  if (entranceType) extra.entrance_type = entranceType;
  return signedUrl("/cooperation/wap/login/", userId, extra, env);
}

function graphH5Url(userId, env = process.env) {
  return signedUrl("/cooperation/saas/jump_service_use_page/", userId, {
    coop_service_type: "emergency_graph"
  }, env);
}

function videoH5Url(userId, env = process.env) {
  return signedUrl("/cooperation/saas/jump_service_use_page/", userId, {
    coop_service_type: "video_inquiry_saas"
  }, env);
}

function phoneH5Url(userId, env = process.env) {
  return signedUrl("/cooperation/saas/jump_service_use_page/", userId, {
    coop_service_type: "fast_phone_3a"
  }, env);
}

function expertH5Url(userId, env = process.env) {
  return signedUrl("/open-platform/m-saas/home/", userId, {}, env);
}

function ordersH5Url(userId, env = process.env) {
  const inner = signedUrl("/cooperation/wap/my_all_services_page/", userId, { from_saas: "1" }, env);
  return signedUrl("/cooperation/saas/login_redirect/", userId, { url: inner }, env);
}

function requestJson(method, pathname, body, env = process.env) {
  const c = cfg(env);
  if (!c.configured) return Promise.reject(new Error("chunyu_not_configured"));
  const url = new URL(pathname, c.host + "/");
  const payload = JSON.stringify(body || {});
  const isHttps = url.protocol === "https:";
  const lib = isHttps ? https : http;
  const opts = {
    method,
    hostname: url.hostname,
    port: url.port || (isHttps ? 443 : 80),
    path: url.pathname + url.search,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": Buffer.byteLength(payload),
      Accept: "application/json"
    },
    timeout: 20000
  };
  return new Promise((resolve, reject) => {
    const req = lib.request(opts, (res) => {
      const chunks = [];
      res.on("data", (d) => chunks.push(d));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        let data = {};
        try { data = raw ? JSON.parse(raw) : {}; } catch (e) {
          return reject(new Error("chunyu_bad_json"));
        }
        resolve({ status: res.statusCode || 0, data });
      });
    });
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("chunyu_timeout"));
    });
    req.on("error", (err) => reject(err));
    req.write(payload);
    req.end();
  });
}

async function jumpWxapp(userId, coopServiceType, env = process.env) {
  const c = cfg(env);
  if (!c.configured) throw new Error("chunyu_not_configured");
  const q = Object.assign(authParams(userId, env), {
    coop_service_type: coopServiceType || "video_inquiry_saas",
    is_json: "1"
  });
  const { data } = await getJson(c.host + "/cooperation/saas/jump_wxapp/?" + new URLSearchParams(q).toString());
  return data;
}

function getJson(fullUrl) {
  return new Promise((resolve, reject) => {
    const url = new URL(fullUrl);
    const lib = url.protocol === "https:" ? https : http;
    const req = lib.get(url, { timeout: 20000 }, (res) => {
      const chunks = [];
      res.on("data", (d) => chunks.push(d));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        try {
          resolve({ status: res.statusCode || 0, data: raw ? JSON.parse(raw) : {} });
        } catch (e) {
          reject(new Error("chunyu_bad_json"));
        }
      });
    });
    req.on("timeout", () => { req.destroy(); reject(new Error("chunyu_timeout")); });
    req.on("error", reject);
  });
}

function chunyuPassword(userId, env = process.env) {
  const c = cfg(env);
  return crypto.createHash("sha256").update(String(c.partnerKey) + ":" + String(userId)).digest("hex").slice(0, 16);
}

function buildContentJson(text, meta, withMeta, imageUrls) {
  const items = [];
  if (withMeta) {
    items.push({
      type: "patient_meta",
      age: (meta && meta.age) || "",
      sex: (meta && meta.sex) || ""
    });
  }
  const t = String(text || "").trim();
  if (t) items.push({ type: "text", text: t.slice(0, 4000) });
  for (const url of (imageUrls || []).slice(0, 3)) {
    const u = String(url || "").trim();
    if (/^https:\/\//i.test(u)) items.push({ type: "image", url: u });
  }
  if (!items.some((it) => it.type === "text" || it.type === "image")) {
    items.push({ type: "text", text: "请查看我上传的图片资料" });
  }
  return JSON.stringify(items);
}

function parseContentText(raw) {
  if (raw == null || raw === "") return "";
  let arr = raw;
  if (typeof raw === "string") {
    try { arr = JSON.parse(raw); } catch (e) { return String(raw); }
  }
  if (!Array.isArray(arr)) return String(raw);
  const parts = [];
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    if (item.type === "text" && item.text) parts.push(String(item.text));
    else if (item.type === "image") parts.push("[图片]");
  }
  return parts.join("\n").trim();
}

function isProblemClosed(status) {
  const s = String(status || "").toLowerCase();
  return s === "c" || s === "p" || s === "closed";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function syncLogin(userId, env = process.env) {
  const auth = authParams(userId, env);
  const body = Object.assign({}, auth, { password: chunyuPassword(userId, env) });
  const { data } = await requestJson("POST", "/cooperation/server/login", body, env);
  return data;
}

async function createFreeProblem(userId, text, meta, imageUrls, env = process.env) {
  const auth = authParams(userId, env);
  const content = buildContentJson(text, meta, true, imageUrls);
  const { data } = await requestJson("POST", "/cooperation/server/free_problem/create", Object.assign({}, auth, { content }), env);
  return data;
}

async function createProblemContent(userId, problemId, text, imageUrls, env = process.env) {
  const auth = authParams(userId, env);
  const content = buildContentJson(text, null, false, imageUrls);
  const { data } = await requestJson("POST", "/cooperation/server/problem_content/create", Object.assign({}, auth, {
    problem_id: String(problemId),
    content
  }), env);
  return data;
}

async function getRecommendedDoctors(userId, ask, env = process.env) {
  const auth = authParams(userId, env);
  let askText = String(ask || "").trim();
  if (askText.length < 10) askText = (askText || "健康咨询").slice(0, 10);
  if (askText.length > 500) askText = askText.slice(0, 500);
  const body = Object.assign({}, auth, { ask: askText });
  const { data } = await requestJson("POST", "/cooperation/server/doctor/get_recommended_doctors", body, env);
  return data;
}

function doctorPageH5Url(userId, doctorId, env = process.env) {
  const c = cfg(env);
  const host = String(c.host || "").replace(/\/$/, "");
  const inner = host + "/pc/wx_qr_page/?doctor_id=" + encodeURIComponent(String(doctorId || ""))
    + "&from_type=coop_api&order_type=graph";
  return signedUrl("/cooperation/saas/login_redirect/", userId, { url: inner }, env);
}

function doctorMiniProgramJump(userId, doctorId, env = process.env) {
  const c = cfg(env);
  const h5Url = doctorPageH5Url(userId, doctorId, env);
  return {
    wxAppId: c.wxAppId,
    wxPath: wxPathFromH5(h5Url, env),
    h5Url,
    wxEnvVersion: wxEnvVersion(env)
  };
}

async function getProblemDetail(userId, problemId, lastContentId, env = process.env) {
  const auth = authParams(userId, env);
  const body = Object.assign({}, auth, { problem_id: String(problemId) });
  if (lastContentId != null && lastContentId !== "") body.last_content_id = String(lastContentId);
  const { data } = await requestJson("POST", "/cooperation/server/problem/detail", body, env);
  return data;
}

async function pollDoctorReplies(userId, problemId, lastContentId, env = process.env, opts) {
  const maxWait = (opts && opts.maxWaitMs) || 90000;
  const interval = (opts && opts.intervalMs) || 2500;
  const deadline = Date.now() + maxWait;
  let cursor = Number(lastContentId) || 0;
  let lastDetail = null;
  while (Date.now() < deadline) {
    const detail = await getProblemDetail(userId, problemId, cursor, env);
    lastDetail = detail;
    if (Number(detail.error) !== 0) {
      return { error: detail.error, error_msg: detail.error_msg, detail };
    }
    const status = detail.problem && detail.problem.status;
    const doctorReplies = (detail.content || [])
      .filter((c) => c && c.type === "d")
      .map((c) => ({
        id: c.id,
        text: parseContentText(c.content),
        subtype: c.subtype || "",
        created_time_ms: c.created_time_ms
      }))
      .filter((c) => c.text);
    if (doctorReplies.length) {
      return { detail, replies: doctorReplies, status, doctor: detail.doctor || null };
    }
    if (isProblemClosed(status)) {
      return { detail, replies: [], status, closed: true, doctor: detail.doctor || null };
    }
    const ids = (detail.content || []).map((c) => Number(c.id)).filter((n) => n > 0);
    if (ids.length) cursor = Math.max(cursor, ...ids);
    await sleep(interval);
  }
  return {
    pending: true,
    status: (lastDetail && lastDetail.problem && lastDetail.problem.status) || "a",
    detail: lastDetail,
    doctor: lastDetail && lastDetail.doctor ? lastDetail.doctor : null
  };
}

async function createExpertAppointment(userId, fields, env = process.env) {
  const auth = authParams(userId, env);
  const body = Object.assign({}, auth, fields || {});
  const { data } = await requestJson("POST", "/cooperation/server/register/create/", body, env);
  return data;
}

function verifyCallbackSign(body, env = process.env) {
  const c = cfg(env);
  const atime = String((body && body.atime) || "");
  const got = String((body && body.sign) || "");
  const id = String(
    (body && (body.problem_id || body.service_id || body.user_id)) || ""
  );
  if (!c.partnerKey || !atime || !got || !id) return false;
  return sign(c.partnerKey, atime, id) === got;
}

function wxPathFromJump(data, env = process.env) {
  const c = cfg(env);
  const token = data && data.token;
  const sessionId = data && data.session_id;
  if (!token || !sessionId) return "";
  let path = "pages/open_login/index?token=" + encodeURIComponent(token) + "&session_id=" + encodeURIComponent(sessionId);
  const wxEnv = String(c.wxEnv || "").trim();
  if (wxEnv && wxEnvVersion(env) !== "release") path += "&env=" + encodeURIComponent(wxEnv);
  return path;
}

/** 春雨文档：用自家小程序 pages/index/index?url= 打开签名 H5，避免前端只能复制链接 */
function wxPathFromH5(h5Url, env = process.env) {
  const c = cfg(env);
  const url = String(h5Url || "").trim();
  if (!/^https?:\/\//i.test(url)) return "";
  let path = "pages/index/index?url=" + encodeURIComponent(url);
  if (c.wxEnv) path += "&env=" + encodeURIComponent(c.wxEnv);
  return path;
}

/** 测试 host / env 签发的 token 只能开春雨体验版；正式环境返回 release */
function wxEnvVersion(env = process.env) {
  const c = cfg(env);
  const e = String(c.wxEnv || "").trim().toLowerCase();
  if (e === "test" || e === "biz") return "trial";
  if (/biztest/i.test(c.host)) return "trial";
  return "release";
}

function ensureSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS chunyu_orders(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    person_id INTEGER,
    patient_id INTEGER,
    doctor_id INTEGER,
    user_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    status TEXT,
    problem_id TEXT,
    service_id TEXT,
    partner_order_id TEXT,
    jump_url TEXT,
    wx_path TEXT,
    extra TEXT,
    created_at TEXT,
    updated_at TEXT
  )`);
  db.exec("CREATE INDEX IF NOT EXISTS idx_chunyu_orders_person ON chunyu_orders(person_id, created_at)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_chunyu_orders_doctor ON chunyu_orders(doctor_id, created_at)");
}

function insertOrder(db, row) {
  const now = new Date().toISOString();
  const r = db.prepare(`INSERT INTO chunyu_orders(
    person_id, patient_id, doctor_id, user_id, kind, status,
    problem_id, service_id, partner_order_id, jump_url, wx_path, extra, created_at, updated_at
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    row.personId != null ? +row.personId : null,
    row.patientId != null ? +row.patientId : null,
    row.doctorId != null ? +row.doctorId : null,
    String(row.userId),
    String(row.kind),
    String(row.status || "created"),
    row.problemId != null ? String(row.problemId) : null,
    row.serviceId != null ? String(row.serviceId) : null,
    row.partnerOrderId != null ? String(row.partnerOrderId) : null,
    row.jumpUrl || "",
    row.wxPath || "",
    row.extra ? JSON.stringify(row.extra) : "{}",
    now,
    now
  );
  return +r.lastInsertRowid;
}

function updateOrderByProblem(db, problemId, patch) {
  const now = new Date().toISOString();
  const row = db.prepare("SELECT extra FROM chunyu_orders WHERE problem_id=? ORDER BY id DESC LIMIT 1").get(String(problemId));
  if (!row) return 0;
  let extra = {};
  try { extra = JSON.parse(row.extra || "{}") || {}; } catch (e) { extra = {}; }
  if (patch.extra) Object.assign(extra, patch.extra);
  return db.prepare("UPDATE chunyu_orders SET status=COALESCE(?,status), extra=?, updated_at=? WHERE problem_id=?").run(
    patch.status || null,
    JSON.stringify(extra),
    now,
    String(problemId)
  ).changes;
}

function updateOrderByService(db, serviceId, patch) {
  const now = new Date().toISOString();
  return db.prepare("UPDATE chunyu_orders SET status=COALESCE(?,status), extra=?, updated_at=? WHERE service_id=?").run(
    patch.status || null,
    JSON.stringify(patch.extra || {}),
    now,
    String(serviceId)
  ).changes;
}

function publicJump(kind, userId, jumpData, env = process.env) {
  const c = cfg(env);
  const h5Url = jumpData && jumpData.h5Url ? jumpData.h5Url : "";
  const wxPath = jumpData && jumpData.wxPath ? jumpData.wxPath : "";
  return {
    ok: true,
    kind,
    configured: true,
    h5Url,
    wxAppId: wxPath ? c.wxAppId : "",
    wxPath,
    wxEnv: c.wxEnv || "",
    wxEnvVersion: wxEnvVersion(env),
    problemId: jumpData && jumpData.problemId || null,
    serviceId: jumpData && jumpData.serviceId || null,
    orderId: jumpData && jumpData.orderId || null,
    note: jumpData && jumpData.note || ""
  };
}

module.exports = {
  cfg,
  sign,
  nowAtime,
  chunyuUserId,
  chunyuPassword,
  authParams,
  h5Origin,
  signedUrl,
  graphLoginUrl,
  graphH5Url,
  videoH5Url,
  phoneH5Url,
  expertH5Url,
  ordersH5Url,
  jumpWxapp,
  syncLogin,
  buildContentJson,
  parseContentText,
  isProblemClosed,
  createFreeProblem,
  createProblemContent,
  getRecommendedDoctors,
  doctorPageH5Url,
  doctorMiniProgramJump,
  getProblemDetail,
  pollDoctorReplies,
  createExpertAppointment,
  verifyCallbackSign,
  wxPathFromJump,
  wxPathFromH5,
  wxEnvVersion,
  ensureSchema,
  insertOrder,
  updateOrderByProblem,
  updateOrderByService,
  publicJump,
  CHUNYU_WX_APPID
};
