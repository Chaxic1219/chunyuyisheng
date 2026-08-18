/* 春雨医生社群 · 本地全栈服务（纯 Node，零依赖）
   运行：node server.js  →  http://localhost:3000 （患者端）/ /admin （医助后台） */
require("./load_env.js");
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const runtimeConfig = require("./mp_runtime_config.js");
const { createGracefulShutdown } = require("./server_lifecycle.js");
const startupReadiness = runtimeConfig.runtimeCoreReadiness({
  env: process.env,
  appDir: __dirname
});
if(require.main === module && !startupReadiness.ok){
  console.error(
    "[startup] runtime_config_invalid",
    startupReadiness.errors.join(",")
  );
  process.exit(1);
}
const { db, hashPw, resolvePatient, mergePersons, mergePatients, autoMergePatientsByUserId, reconcileVerifiedPhonePersons, reconcileQiweIdentityPersons, afterDoctorProvisioned, rememberRemovedDoctorSlug, forgetRemovedDoctorSlug, friendlyPatientLabel, patientArchiveLabel, hydrateAdminMessageRow, decorateAdminPatient, allocateStaffId, stripChannelSuffix, isPlaceholderDisplayName, resolvePersonWechatName, preferDisplayName, patientArchive } = require("./db.js");
const { verifySmsCode } = require("./sms_code_verifier.js");
const patientProfile = require("./patient_profile.js");
const profileStore = patientProfile.createProfileStore(db);

function personRowForPatient(patient) {
  if (!patient || !patient.person_id) return null;
  return db.prepare("SELECT * FROM persons WHERE id=?").get(patient.person_id);
}

function personIdForPatientId(patientId) {
  const r = db.prepare("SELECT person_id FROM patients WHERE id=?").get(+patientId);
  return r && r.person_id ? r.person_id : null;
}

function updatePersonIdentity(personId, patch) {
  if (!personId) return;
  const p = patch || {};
  db.prepare(`UPDATE persons SET
    real_name=COALESCE(NULLIF(?,''), real_name),
    gender=COALESCE(NULLIF(?,''), gender),
    birth_date=COALESCE(NULLIF(?,''), birth_date),
    phone=COALESCE(NULLIF(?,''), phone),
    updated_at=? WHERE id=?`).run(
    String(p.realName == null ? "" : p.realName).trim(),
    String(p.gender == null ? "" : p.gender).trim(),
    String(p.birthDate == null ? "" : p.birthDate).trim(),
    String(p.phone == null ? "" : p.phone).trim(),
    new Date().toISOString(),
    personId
  );
}
const patientInvite = require("./patient_invite.js");
const inviteStore = patientInvite.createInviteStore(db);
const triage = require("./triage.js");
const followup = require("./modules/followup");
const community = require("./community.js");
const outboxMod = require("./modules/outbox");
const opsMod = require("./modules/ops");
const { wireModuleEvents } = require("./modules/wiring");
// 会话 store 创建后再挂事件副作用（见文件后部 sessions 初始化处）
let _wireHooksReady = false;
function ensureWiredEvents(){
  if(_wireHooksReady) return;
  _wireHooksReady = true;
  wireModuleEvents({
    purgeAdminSessions: ()=>{ try{ sessions.purgeExpired(); }catch(e){} },
    notifyModeration: (p)=>{
      try{
        const did = Number(p && p.doctorId);
        if(!Number.isInteger(did) || did <= 0) return;
        const flag = String((p && p.flag) || "moderation").slice(0, 80);
        const level = String((p && p.level) || "").toLowerCase();
        const levelNum = level === "high" || level === "urgent" ? 3 : (level === "medium" ? 2 : 1);
        const note = "community_message_id=" + String((p && p.messageId) || "");
        db.prepare(`INSERT INTO doctor_notifications(doctor_id,message_log_id,patient_id,patient_name,text,level,level_label,note,status)
          VALUES(?,?,?,?,?,?,?,?, 'pending')`).run(
          did, null, null, "",
          "群风控：" + flag,
          levelNum,
          flag,
          note
        );
      }catch(e){
        console.error("[wiring] notifyModeration", e && e.message);
      }
    }
  });
}
const wecom = require("./wecom.js");
const qiwe = require("./qiwe.js");
const qiweBridge = require("./qiwe_bridge.js");
const patientReply = require("./patient_reply.js");
const authz = require("./authz.js");
const { registerFollowupRoutes } = require("./routes/followup.js");
const { registerCommunityPublicRoutes } = require("./routes/community-public.js");
const { registerOutboxAdminRoutes } = require("./routes/outbox-admin.js");
const { registerCommunityModerationRoutes } = require("./routes/community-moderation.js");
const { registerCommunityAdminRoutes } = require("./routes/community-admin.js");
const { registerConfigCenterRoutes } = require("./routes/config-center.js");
const { registerDoctorsAdminRoutes } = require("./routes/doctors-admin.js");
const { registerPatientsAdminRoutes } = require("./routes/patients-admin.js");
const { registerTriageAdminRoutes } = require("./routes/triage-admin.js");
const { registerAgentSandboxAdminRoutes } = require("./routes/agent-sandbox-admin.js");
const { registerMessagesAdminRoutes } = require("./routes/messages-admin.js");
const { registerPatientPublicRoutes } = require("./routes/patient-public.js");
const { registerPartnershipRoutes } = require("./routes/partnership.js");
const { notifyPartnershipApplication } = require("./routes/partnership_mailer.js");
const { registerMpAuthRoutes } = require("./routes/mp-auth.js");
const { registerMpAiRoutes } = require("./routes/mp-ai.js");
const { registerMpV32Routes } = require("./routes/mp-v32.js");
const { registerMpServicePackageRoutes } = require("./routes/mp-service-package.js");
const { registerServicePackageAdminRoutes } = require("./routes/service-package-admin.js");
const { registerAuthAdminRoutes } = require("./routes/auth-admin.js");
const { registerContentAdminRoutes } = require("./routes/content-admin.js");
const { registerOutboundAdminRoutes } = require("./routes/outbound-admin.js");
const { registerChannelBridgeRoutes } = require("./routes/channel-bridges.js");
const { registerLlmAdminRoutes } = require("./routes/llm-admin.js");
const { registerVideoChannelAdminRoutes } = require("./routes/video-channel-admin.js");
const { registerWecomSidebarRoutes } = require("./routes/wecom-sidebar.js");
const { registerOpsDeskRoutes } = require("./routes/ops-desk.js");
const { registerChunyuOpenRoutes } = require("./routes/chunyu-open.js");
const { validateKnowledgeQuality, knowledgeLayerSeedRows } = require("./knowledge_quality.js");
const { maskPII, maskPIIStrict, submitWhitelistForType, maskPayloadExceptWhitelist } = require("./pii.js");   // PII 掩码单一模块（生产DB架构 v1.0 §3-4，2026-07-04）：本地副本已删，与 triage.js 共用同一实现防漂移

const PORT = process.env.PORT || 3000;
const SMS_DEMO = process.argv.includes("--demo") || process.env.SMS_DEMO === "1"; // 演示态：/api/sms/send 明文返回验证码便于本地体验；默认关，生产不泄露（架空本人验证门控）
// 仅当显式传入 --demo 才注入（不随 SMS_DEMO 环境变量），便于本地/集成测试；生产/非 --demo 必须显式配置 COMMUNITY_WEBHOOK_TOKEN，否则 fail-closed 必拒。
const COMMUNITY_DEMO_TOKEN = process.argv.includes("--demo") ? "demo-community-token" : "";
// QiWe 回调密钥的演示态兜底：仅 --demo 注入；生产/非 --demo 必须显式配置 callbackSecret，否则 qiweSecretOk fail-closed 必拒。
const QIWE_DEMO_SECRET = process.argv.includes("--demo") ? "demo-qiwe-secret" : "";
const PUB = path.join(__dirname, "public");
const sessions = require("./admin_session_store.js").createAdminSessionStore(db); // token -> session；SQLite 持久化，重启不丢
ensureWiredEvents();
const smsCodes = new Map();            // phone -> {code, expiresAt}
const smsThrottle = new Map();          // phone -> lastSentAt（与验证码生命周期解耦的发送节流，防绕过）
const loginFailures = new Map();        // key(username+ip) -> {count, firstAt, lockedUntil}
const wechatTokenCache = { value:"", expiresAt:0 };
const wechatTicketCache = { value:"", expiresAt:0 };
const now = () => new Date().toISOString();
function envMs(name, fallback, min){
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n >= (min || 0) ? n : fallback;
}
const ADMIN_SESSION_TTL_MS = envMs("ADMIN_SESSION_TTL_MS", 12 * 60 * 60 * 1000, 5 * 60 * 1000);
const ADMIN_SESSION_COOKIE_MAX_AGE = Math.max(60, Math.floor(ADMIN_SESSION_TTL_MS / 1000));
const ADMIN_LOGIN_FAIL_WINDOW_MS = envMs("ADMIN_LOGIN_FAIL_WINDOW_MS", 10 * 60 * 1000, 60 * 1000);
const ADMIN_LOGIN_LOCK_MS = envMs("ADMIN_LOGIN_LOCK_MS", 10 * 60 * 1000, 60 * 1000);
const ADMIN_LOGIN_MAX_FAILURES = Math.max(3, Number(process.env.ADMIN_LOGIN_MAX_FAILURES || 5) || 5);
const AUDIT_SECRET_KEY_RE = /(secret|token|password|passwd|authorization|bearer|api[_-]?key|callbackSecret|callback_secret|encodingAESKey|aesKey|robot[_-]?key|webhook|guid|salt|hash)/i; // robotKey/webhook：企微群机器人发送密钥（2026-07-09 洞修——此前 wecom/config 审计 before/after 明文落 robotKey）

/* ---------- 工具 ---------- */
const MIME = { ".html":"text/html; charset=utf-8", ".css":"text/css; charset=utf-8", ".js":"application/javascript; charset=utf-8", ".mjs":"application/javascript; charset=utf-8", ".json":"application/json; charset=utf-8", ".svg":"image/svg+xml", ".png":"image/png", ".jpg":"image/jpeg", ".jpeg":"image/jpeg", ".webp":"image/webp", ".ico":"image/x-icon", ".woff":"font/woff", ".woff2":"font/woff2", ".ttf":"font/ttf", ".map":"application/json", ".gz":"application/gzip" };
const STATIC_GZ_EXT = new Set([".js",".mjs",".css",".html",".svg",".json",".ico",".map"]);
function send(res, code, body, type, extraHeaders){
  const headers = Object.assign({ "Content-Type": type||"application/json; charset=utf-8" }, extraHeaders || {});
  res.writeHead(code, headers);
  res.end(body);
}
/** 带 hash 的构建产物可长期缓存；html 入口必须每次校验 */
function staticCacheHeaders(urlPath){
  if(/\/admin-v2\/assets\//i.test(urlPath) && !/\.html?$/i.test(urlPath)){
    return { "Cache-Control":"public, max-age=31536000, immutable" };
  }
  if(/\.html?$/i.test(urlPath) || urlPath === "/admin" || urlPath === "/admin/" || urlPath === "/admin-v2" || urlPath === "/admin-v2/" || urlPath === "/admin-legacy" || urlPath === "/admin-legacy/"){
    return { "Cache-Control":"no-cache" };
  }
  return { "Cache-Control":"public, max-age=600" };
}
function json(res, code, obj){ send(res, code, JSON.stringify(obj)); }
const MAX_BODY = 1 * 1024 * 1024; // 1MB：医疗表单/消息通常 <1MB，超限停止累积（内存封顶，防 OOM）
const MESSAGE_MAX_BODY = 6 * 1024 * 1024; // 在线咨询允许最多 3 张压缩图片/报告，其他接口仍保持 1MB。
function parseBody(req, maxBytes){ return new Promise(r=>{ let chunks=[],len=0,over=false; const limit=maxBytes || MAX_BODY;
  req.on("data",c=>{ len+=c.length; if(len>limit){ over=true; return; } chunks.push(c); });
  req.on("end",()=>{ if(over) return r({ __oversize:true }); const d=Buffer.concat(chunks).toString("utf8"); try{ r(d?JSON.parse(d):{}); }catch(e){ r({}); } });
  req.on("error",()=>r({})); }); }
function readRaw(req, maxBytes){ return new Promise(r=>{ let chunks=[],len=0,over=false; const limit=maxBytes || MAX_BODY;
  req.on("data",c=>{ len+=c.length; if(len>limit){ over=true; return; } chunks.push(c); });
  req.on("end",()=>r(over?"":Buffer.concat(chunks).toString("utf8")));
  req.on("error",()=>r("")); }); } // 企微回调是 XML（非 JSON），按原文读取后交 wecom 验签解密
/* 大整数 ID 保真（真实抓包实锤 2026-07-03·甲方真机）：真实 qiweapi 推送的 senderId/receiverId/fromRoomId 是数字非字符串，
   且测试群 roomId 10730375163571533（17 位）超 JS 安全整数（Number.isSafeInteger=false）——JSON.parse 后丢精度变 …532，
   String 化后与 qiwe_configs.test_to_id 白名单 "10730375163571533" 失配 → 真实群消息被 idAllowed→outside_test_scope 误挡。
   修：在 JSON.parse **之前**把 JSON **值位置**上 15 位及以上的纯数字加引号串化（保精度）。15 位阈值远超时间戳秒级 10 位、覆盖
   qiweapi userId/roomId/corpId 16 位；seq 等被串化无碍——下游 normalizeEvent 的 id()/clean() 本就 String 化。
   ⚠ codex 反例A（2026-07-03）：纯正则不知自己在不在字符串里——患者文本如 "身份证:110101199003074321,请查"（18 位身份证在医疗消息极常见）
   会被误命中 → 替换后 JSON 非法 → parseBodyBigIntSafe 兜底 {} → 真实消息丢失。故改为【字符串感知单遍扫描】（零依赖）：
   维护 inString（遇未转义 " 翻转；\ 转义跳下一字符），仅在 inString=false 时，对「值起始位（前一非空白字符是 : [ ,）的纯数字串、长度≥15、
   后随(跳空白) , } ]」包引号。字符串内部的任何数字（身份证/手机号/正文）绝不触碰。 */
function preserveBigIntIds(rawText){
  const s = String(rawText == null ? "" : rawText);
  let out = "", inString = false;
  for(let i = 0; i < s.length; i++){
    const ch = s[i];
    if(inString){
      out += ch;
      if(ch === "\\"){ if(i + 1 < s.length){ out += s[i + 1]; i++; } }   // 转义：原样带走下一字符（含 \" \\ 等），不进出串判定
      else if(ch === '"') inString = false;                             // 未转义引号 → 出串
      continue;
    }
    if(ch === '"'){ out += ch; inString = true; continue; }             // 入串
    // 值起始判定：仅当前一个非空白字符是 : [ ,（JSON 里紧跟值的位置）才把数字视为「值」，避免误伤 key 或普通位置
    if(ch >= "0" && ch <= "9"){
      let k = out.length - 1;
      while(k >= 0 && (out[k] === " " || out[k] === "\t" || out[k] === "\n" || out[k] === "\r")) k--;
      const prev = k >= 0 ? out[k] : "";
      if(prev === ":" || prev === "[" || prev === ","){
        let j = i;
        while(j < s.length && s[j] >= "0" && s[j] <= "9") j++;           // 吃完整段数字
        const digits = s.slice(i, j);
        // 后随（跳空白）必须是 , } ] 之一才是完整的 JSON 数字值（排除 12345.6 小数、12345e3 科学计数、12345abc 等非纯整数值）
        let t = j;
        while(t < s.length && (s[t] === " " || s[t] === "\t" || s[t] === "\n" || s[t] === "\r")) t++;
        const after = t < s.length ? s[t] : "";
        if(digits.length >= 15 && (after === "," || after === "}" || after === "]")){
          out += '"' + digits + '"';
          i = j - 1;                                                     // 跳过已消费的数字段（for 的 i++ 会落到 j）
          continue;
        }
      }
    }
    out += ch;
  }
  return out;
}
/* 与 parseBody 同款读流 + oversize 语义（照抄 parseBody 写法，parseBody 本身零改动），仅在 JSON.parse 前加大整数保真。专用于 qiwe 回调路由。 */
function parseBodyBigIntSafe(req, maxBytes){ return new Promise(r=>{ let chunks=[],len=0,over=false; const limit=maxBytes || MAX_BODY;
  req.on("data",c=>{ len+=c.length; if(len>limit){ over=true; return; } chunks.push(c); });
  req.on("end",()=>{ if(over) return r({ __oversize:true }); const d=Buffer.concat(chunks).toString("utf8"); try{ r(d?JSON.parse(preserveBigIntIds(d)):{}); }catch(e){ r({}); } });
  req.on("error",()=>r({})); }); }
function cookies(req){ const o={}; (req.headers.cookie||"").split(";").forEach(p=>{ const i=p.indexOf("="); if(i>0) o[p.slice(0,i).trim()]=decodeURIComponent(p.slice(i+1).trim()); }); return o; }
function adminRow(id){
  return db.prepare("SELECT id,username,staff_id,role,active,display_name,note,avatar_url,created_at,updated_at,last_login_at,password_changed_at,disabled_at,disabled_by FROM admins WHERE id=?").get(+id);
}
function validAdminRole(role){
  return authz.validAdminRole(role);
}
function activeAdminRow(a){
  return !!(a && a.active !== 0 && validAdminRole(a.role));
}
function isSuperAdminRow(a){
  return activeAdminRow(a) && authz.isSuperRole(a.role);
}
function buildSession(a){
  const ts = Date.now();
  return { adminId:a.id, username:a.username, role:a.role || "super", createdAt:ts, lastSeenAt:ts, expiresAt:ts + ADMIN_SESSION_TTL_MS };
}
function sessionCookie(req, token, maxAge){
  const parts = [`sid=${encodeURIComponent(token)}`, "HttpOnly", "Path=/", "SameSite=Lax", `Max-Age=${maxAge}`];
  const publicOrigin = String(process.env.PUBLIC_ORIGIN || "");
  const xfProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim().toLowerCase();
  if(process.env.ADMIN_COOKIE_SECURE === "1" || xfProto === "https" || publicOrigin.startsWith("https://")) parts.push("Secure");
  return parts.join("; ");
}
function patientSessionCookie(req, token, maxAge){
  const parts = [`psid=${encodeURIComponent(token || "")}`, "HttpOnly", "Path=/", "SameSite=Lax", `Max-Age=${maxAge}`];
  const publicOrigin = String(process.env.PUBLIC_ORIGIN || "");
  const xfProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim().toLowerCase();
  if(process.env.ADMIN_COOKIE_SECURE === "1" || xfProto === "https" || publicOrigin.startsWith("https://")) parts.push("Secure");
  return parts.join("; ");
}
function publicBaseUrl(req){
  const env = String(process.env.PUBLIC_ORIGIN || "").replace(/\/$/, "");
  if(env) return env;
  const host = String(req.headers.host || "localhost:" + PORT).trim();
  const xfProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim().toLowerCase();
  const proto = xfProto === "https" ? "https" : "http";
  return proto + "://" + host;
}
function inviteUrlForToken(req, token){
  return publicBaseUrl(req) + "/i/" + encodeURIComponent(token);
}
function patientFromRequest(req, doctorId){
  const psid = cookies(req).psid;
  const sess = inviteStore.getSession(psid);
  if(!sess) return null;
  if(doctorId != null && +sess.doctor_id !== +doctorId) return null;
  inviteStore.touchSession(psid);
  return { doctorId: +sess.doctor_id, patientId: +sess.patient_id, psid };
}
function authed(req){
  const t = cookies(req).sid;
  if(!t) return null;
  const s = sessions.get(t);
  if(!s) return null;
  const ts = Date.now();
  if(!s.expiresAt || s.expiresAt <= ts){ sessions.delete(t); return null; }
  const a = adminRow(s.adminId);
  if(!activeAdminRow(a)){ sessions.delete(t); return null; }
  s.username = a.username;
  s.role = a.role || "super";
  s.lastSeenAt = ts;
  s.expiresAt = ts + ADMIN_SESSION_TTL_MS;
  // 滑动续期写回：节流落库，避免每个 API 都同步写 SQLite 拖尾延迟
  sessions.set(t, s, { throttle:true });
  return s;
}
function isPhone(phone){ return /^1[3-9]\d{9}$/.test(phone||""); }
const SUBMIT_TYPES = new Set(["联络表","加号","住院预约","story"]); // /api/submit 允许的患者提交类型白名单（排除 口碑/分诊备注 等受门控或系统内部类型，防伪造）
const SUBMIT_FORM_KEYS = { "联络表":"contactForm", "加号":"addNumber", "住院预约":"admission" }; // type → 医生 content 表单配置块（④存储侧脱敏按其 textarea 字段分类自由文本，见 pii.freeTextLabels）
function contentForDoctor(doctorId){
  const row = db.prepare("SELECT content FROM doctors WHERE id=?").get(doctorId);
  if(!row) return null;
  try{ return JSON.parse(row.content||"{}"); }catch(e){ return {}; }
}
function hasContactFormForPhone(doctorId, phone){
  const p = String(phone || "").trim();
  if(!isPhone(p)) return false;
  const rows = db.prepare("SELECT payload FROM submissions WHERE doctor_id=? AND type='联络表' AND payload LIKE ? ORDER BY id DESC LIMIT 50").all(doctorId, `%${p}%`);
  return rows.some(row=>{
    try{
      const payload = JSON.parse(row.payload || "{}");
      return String(payload["手机号"] || payload.phone || "").trim() === p;
    }catch(e){
      return false;
    }
  });
}
function verifySms(phone, code){
  return verifySmsCode({ smsCodes, smsThrottle, phone, code, now:Date.now });
}
function clientIp(req){
  // 安全洞修（2026-07-09 跨厂对抗复核实锤）：安全用途（登录限流键 + 审计 IP）只信直连对端——本机在 nginx(127.0.0.1) 之后、
  // 其上游是不受控的春雨边缘反代，X-Forwarded-For 最左段客户端可自报伪造（换头即换限流桶=暴力破解绕锁 / 伪造受害者 IP 污染审计），
  // 绝不用于限流/审计。生产该值恒 127.0.0.1（限流退化为按用户名维度锁定·可接受）。
  return (req.socket && req.socket.remoteAddress) || "local";
}
function loginFailureKey(req, username){
  return String(username || "").trim().toLowerCase() + "|" + clientIp(req);
}
function loginLimitStatus(req, username){
  const key = loginFailureKey(req, username);
  const rec = loginFailures.get(key);
  const ts = Date.now();
  if(!rec) return null;
  if(rec.lockedUntil && rec.lockedUntil > ts) return { retryAfter:Math.ceil((rec.lockedUntil - ts) / 1000) };
  if(rec.firstAt && ts - rec.firstAt > ADMIN_LOGIN_FAIL_WINDOW_MS) loginFailures.delete(key);
  return null;
}
function recordLoginFailure(req, username){
  const key = loginFailureKey(req, username);
  const ts = Date.now();
  // 无界增长加固（2026-07-09）：Map 原本只在命中同键时清过期项，攻击者狂换用户名可无限堆积——
  // 超阈值时写入前先扫一遍，删「窗口已过期且未在锁定中」的记录（O(n) 仅超阈值触发；限流语义不变）。
  if(loginFailures.size >= 5000){
    for(const [k, v] of loginFailures){
      if(v.firstAt + ADMIN_LOGIN_FAIL_WINDOW_MS < ts && (!v.lockedUntil || v.lockedUntil < ts)) loginFailures.delete(k);
    }
    // 硬封顶（codex 反例·2026-07-09）：窗口内海量新用户名洪泛时记录都未过期、上面一条都删不掉 → 封顶形同虚设。
    //   过期清理后仍超阈值，则按 Map 插入顺序（最旧在前）逐出「非锁定中」记录到低水位 4000，保证 Map 有界；
    //   仍在锁定中的键保留（避免洪泛把真实锁定冲掉）。逐出的是最旧非锁定项（洪泛新用户名 count=1 皆非锁定，天然可逐出）。O(逐出数)。
    if(loginFailures.size >= 5000){
      let toEvict = loginFailures.size - 4000;
      for(const [k, v] of loginFailures){
        if(toEvict <= 0) break;
        if(v.lockedUntil && v.lockedUntil > ts) continue;
        loginFailures.delete(k); toEvict--;
      }
    }
  }
  const old = loginFailures.get(key);
  const rec = old && ts - old.firstAt <= ADMIN_LOGIN_FAIL_WINDOW_MS ? old : { count:0, firstAt:ts, lockedUntil:0 };
  rec.count += 1;
  if(rec.count >= ADMIN_LOGIN_MAX_FAILURES) rec.lockedUntil = ts + ADMIN_LOGIN_LOCK_MS;
  loginFailures.set(key, rec);
}
function clearLoginFailure(req, username){
  loginFailures.delete(loginFailureKey(req, username));
}
function normalizeOrigin(value){
  try{ return new URL(String(value || "")).origin.toLowerCase(); }catch(e){ return ""; }
}
function requestAllowedOrigins(req){
  const host = String(req.headers.host || "").trim().toLowerCase();
  const origins = new Set();
  if(host){
    origins.add("http://" + host);
    origins.add("https://" + host);
  }
  const publicOrigin = normalizeOrigin(process.env.PUBLIC_ORIGIN);
  if(publicOrigin) origins.add(publicOrigin);
  // admin-ui Vite 开发态：浏览器 Origin 仍是 :5173，经代理到 Node 后 Host 已变成本机 API 端口，
  // 仅认 Host 会误杀登录等写接口。本机回环 Origin 远程站点无法伪造，可安全放行；额外域名用 ADMIN_ALLOWED_ORIGINS。
  String(process.env.ADMIN_ALLOWED_ORIGINS || "")
    .split(/[\s,，;；]+/)
    .map(x=>normalizeOrigin(x))
    .filter(Boolean)
    .forEach(o=>origins.add(o));
  ["http://127.0.0.1:5173","http://localhost:5173","http://127.0.0.1:5174","http://localhost:5174"]
    .forEach(o=>origins.add(o));
  return origins;
}
function adminWriteOriginAllowed(req){
  const allowed = requestAllowedOrigins(req);
  if(req.headers.origin != null && String(req.headers.origin).trim() !== ""){
    const origin = normalizeOrigin(req.headers.origin);
    return !!origin && allowed.has(origin);
  }
  if(req.headers.referer != null && String(req.headers.referer).trim() !== ""){
    const referer = normalizeOrigin(req.headers.referer);
    return !!referer && allowed.has(referer);
  }
  return true; // 本地 curl / 测试脚本 / 同源无 Origin 的兼容路径
}

async function wechatJson(url){
  const r = await fetch(url);
  const j = await r.json().catch(()=>({}));
  if(!r.ok) throw new Error("微信接口 HTTP "+r.status);
  if(j.errcode && j.errcode !== 0) throw new Error(j.errmsg || ("微信接口错误 "+j.errcode));
  return j;
}
async function getWechatAccessToken(appId, secret){
  if(wechatTokenCache.value && wechatTokenCache.expiresAt > Date.now()) return wechatTokenCache.value;
  const u = "https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid="+encodeURIComponent(appId)+"&secret="+encodeURIComponent(secret);
  const j = await wechatJson(u);
  if(!j.access_token) throw new Error("微信未返回 access_token");
  wechatTokenCache.value = j.access_token;
  wechatTokenCache.expiresAt = Date.now() + Math.max(300, (j.expires_in || 7200) - 300) * 1000;
  return wechatTokenCache.value;
}
async function getWechatJsTicket(appId, secret){
  if(wechatTicketCache.value && wechatTicketCache.expiresAt > Date.now()) return wechatTicketCache.value;
  const token = await getWechatAccessToken(appId, secret);
  const j = await wechatJson("https://api.weixin.qq.com/cgi-bin/ticket/getticket?type=jsapi&access_token="+encodeURIComponent(token));
  if(!j.ticket) throw new Error("微信未返回 jsapi_ticket");
  wechatTicketCache.value = j.ticket;
  wechatTicketCache.expiresAt = Date.now() + Math.max(300, (j.expires_in || 7200) - 300) * 1000;
  return wechatTicketCache.value;
}
function wechatEnv(){
  return {
    appId:process.env.WECHAT_OA_APP_ID || process.env.WECHAT_JS_APP_ID || "",
    secret:process.env.WECHAT_OA_APP_SECRET || process.env.WECHAT_JS_APP_SECRET || ""
  };
}
async function buildWechatJsConfig(url){
  const env = wechatEnv();
  if(!env.appId || !env.secret) throw new Error("缺少 WECHAT_OA_APP_ID / WECHAT_OA_APP_SECRET（公众号 JS-SDK 签名参数）");
  const ticket = await getWechatJsTicket(env.appId, env.secret);
  const nonceStr = crypto.randomBytes(8).toString("hex");
  const timestamp = Math.floor(Date.now()/1000);
  const raw = `jsapi_ticket=${ticket}&noncestr=${nonceStr}&timestamp=${timestamp}&url=${url}`;
  const signature = crypto.createHash("sha1").update(raw).digest("hex");
  return { configured:true, appId:env.appId, timestamp, nonceStr, signature };
}

const IMAGE_MIMES = new Set(["image/png","image/jpeg","image/webp"]);
function cleanAttachments(input){
  const arr = Array.isArray(input) ? input : [];
  if(arr.length > 3) throw new Error("最多上传 3 张图片/报告");
  return arr.map((a,i)=>{
    const rawUrl = String((a && (a.dataUrl || a.url || a.data)) || "");
    const m = rawUrl.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/i);
    const mime = String((a && a.mime) || (m && m[1]) || "").toLowerCase();
    if(!m || !IMAGE_MIMES.has(mime)) throw new Error("仅支持 PNG/JPG/WebP 图片");
    const b64 = m[2];
    const size = Math.floor(b64.length * 3 / 4);
    if(size > 1.5 * 1024 * 1024) throw new Error("单张图片需小于 1.5MB，请先截图或压缩后上传");
    const name = String((a && a.name) || `图片${i+1}`).replace(/[^\w.\-\u4e00-\u9fa5]/g,"").slice(0,60) || `图片${i+1}`;
    return { type:"image", name, mime, size, dataUrl:`data:${mime};base64,${b64}` };
  });
}

function doctorOut(row){
  return { id:row.id, slug:row.slug, name:row.name, title:row.title, hospital:row.hospital, dept:row.dept,
    specialty:row.specialty, groupName:row.group_name, memberCount:row.member_count, scopeNote:row.scope_note,
    hospitalPhone:row.hospital_phone, bots:JSON.parse(row.bots||"[]"), clinic:JSON.parse(row.clinic||"{}"),
    accounts:JSON.parse(row.accounts||"[]"), active:row.active };
}
function faqGrouped(doctorId){
  const rows = db.prepare("SELECT * FROM faq WHERE doctor_id=? ORDER BY sort,id").all(doctorId);
  const groups=[]; const idx={};
  rows.forEach(r=>{ if(!(r.grp in idx)){ idx[r.grp]=groups.length; groups.push({title:r.grp,items:[]}); } groups[idx[r.grp]].items.push({q:r.q,a:r.a,link:r.link}); });
  return groups;
}

/* ---------- 路由 ---------- */
const { createRouteIndex } = require("./shared/routeIndex.js");
const routeIndex = createRouteIndex();
const routes = routeIndex.routes;
function route(method, re, fn){ routeIndex.add(method, re, fn); }

function runtimeHealth(){
  const requiredEnv = [
    "ADMIN_PASSWORD",
    "COMMUNITY_WEBHOOK_TOKEN",
    "QIWE_CALLBACK_SECRET",
    "PUBLIC_ORIGIN"
  ];
  let dbOk = false;
  let dbError = "";
  try{
    const row = db.prepare("PRAGMA quick_check").get();
    dbOk = !!row && String(row.quick_check || Object.values(row)[0] || "").toLowerCase() === "ok";
  }catch(e){
    dbError = e && e.message ? e.message : "db_check_failed";
  }
  const env = Object.fromEntries(requiredEnv.map(k=>[k, !!String(process.env[k] || "").trim()]));
  const runtime = runtimeConfig.runtimeCoreReadiness({
    env: process.env,
    appDir: __dirname
  });
  const uploads = runtimeConfig.runtimeUploadReadiness({
    env: process.env,
    appDir: __dirname,
    prepareDirectory: false
  });
  const configOk = Object.values(env).every(Boolean) && runtime.ok;
  return {
    statusCode: dbOk && configOk ? 200 : 503,
    body: {
    ok: dbOk && configOk,
    status: dbOk && configOk ? "ok" : "degraded",
    uptimeSec: Math.floor(process.uptime()),
    node: process.version,
    db: dbOk ? { ok:true } : { ok:false, error:dbError },
    env,
    config: runtime.ok ? { ok:true, errors:[] } : { ok:false, errors:runtime.errors },
    uploads: uploads.ok ? { ok:true, errors:[] } : { ok:false, errors:uploads.errors }
    }
  };
}

route("GET", /^\/api\/(?:health|ready)$/, (req,res)=>{
  const health = runtimeHealth();
  json(res, health.statusCode, health.body);
});

/* 患者端公开面 → routes/patient-public.js */
const patientPublicLifecycle = registerPatientPublicRoutes(route, {
  parseBody, json, gate, rowDoctorId, requireAdminAction,
  db, now, SMS_DEMO, MESSAGE_MAX_BODY, smsCodes, smsThrottle,
  isPhone, verifySms, contentForDoctor, hasContactFormForPhone,
  doctorOut, faqGrouped, wechatEnv, buildWechatJsConfig,
  cleanAttachments, patientFromRequest, patientReply,
  patientProfile, profileStore, resolvePatient,
  updatePersonIdentity, personIdForPatientId,
  inviteStore, patientInvite, patientSessionCookie,
  followup, SUBMIT_TYPES, SUBMIT_FORM_KEYS,
  submitWhitelistForType, maskPayloadExceptWhitelist, maskPII, maskPIIStrict
});

/* 小程序鉴权 → routes/mp-auth.js */
registerPartnershipRoutes(route, { parseBody, json, gate, db, now, notifyPartnershipApplication });
registerMpAuthRoutes(route, { parseBody, json, verifySms, MESSAGE_MAX_BODY, db, profileStore, patientProfile });
registerMpAiRoutes(route, { parseBody, json, MESSAGE_MAX_BODY, db });
registerMpV32Routes(route, {
  parseBody,
  json,
  MESSAGE_MAX_BODY,
  db,
  profileStore,
  patientProfile,
});
registerMpServicePackageRoutes(route, {
  parseBody,
  json,
  MESSAGE_MAX_BODY,
  db,
  readRaw,
});
const { registerMpMeRoutes } = require("./routes/mp-me.js");
registerMpMeRoutes(route, { parseBody, json, MESSAGE_MAX_BODY, db, profileStore, patientProfile });

/* 随访路由 → routes/followup.js（模块化试点） */
registerFollowupRoutes(route, {
  parseBody, json, gate, rowDoctorId, requireAdminAction,
  followup, db, isPhone, verifySms
});

/* ---------- 后台鉴权 ---------- */
/* 登录账号：纯数字优先按工号 staff_id 查，查不到再回退用户名；非数字仍按 username。 */
/* 登录/me/admins/audit 路由已迁至 routes/auth-admin.js */

/* 需要鉴权的后台接口统一在 handler 里校验 */
function needAuth(req,res){ if(!authed(req)){ json(res,401,{error:"未登录"}); return false; } return true; }

/* ---------- 多租户：医生归属权限 ---------- */
// admins.role='super'（默认）可访问全部医生；其它角色仅可访问 admin_doctors 关联的医生
function adminScope(s){
  if(!s) return new Set();
  const a = adminRow(s.adminId);
  if(!activeAdminRow(a)) return new Set();              // fail-closed：缺失/禁用/异常角色都不得继承 super
  if(isSuperAdminRow(a)) return null;                   // null = 不受限（全部医生）
  if(!authz.effectiveAdminRole(a.role)) return new Set();
  return new Set(db.prepare("SELECT doctor_id FROM admin_doctors WHERE admin_id=?").all(s.adminId).map(r=>+r.doctor_id));
}
function allowDoctor(s, doctorId){ const sc = adminScope(s); return sc === null || sc.has(+doctorId); }
function isSuperSession(s){ return adminScope(s) === null; }
function normalizeAdminRole(role){
  return authz.normalizeAdminRole(role, "scoped");
}
function adminDoctorIds(adminId){
  return db.prepare("SELECT doctor_id FROM admin_doctors WHERE admin_id=? ORDER BY doctor_id").all(+adminId).map(r=>+r.doctor_id);
}
function adminOut(a){
  return {
    id:a.id,
    username:a.username,
    staffId:a.staff_id || "",
    displayName:a.display_name || "",
    role:a.role || "super",
    active:a.active !== 0,
    doctorIds:adminDoctorIds(a.id),
    note:a.note || "",
    createdAt:a.created_at || null,
    updatedAt:a.updated_at || null,
    lastLoginAt:a.last_login_at || null,
    passwordChangedAt:a.password_changed_at || null,
    disabledAt:a.disabled_at || null,
    disabledBy:a.disabled_by || null,
    avatarUrl:a.avatar_url || ""
  };
}
function normalizeDoctorIds(input){
  const ids = [...new Set((Array.isArray(input) ? input : []).map(x=>+x).filter(x=>Number.isInteger(x) && x > 0))];
  if(!ids.length) return [];
  const exists = new Set(db.prepare(`SELECT id FROM doctors WHERE id IN (${ids.map(()=>"?").join(",")})`).all(...ids).map(r=>+r.id));
  return ids.filter(id=>exists.has(id));
}
function replaceAdminDoctors(adminId, doctorIds){
  db.prepare("DELETE FROM admin_doctors WHERE admin_id=?").run(+adminId);
  doctorIds.forEach(did=>db.prepare("INSERT OR IGNORE INTO admin_doctors(admin_id,doctor_id) VALUES(?,?)").run(+adminId,+did));
}
function clearSessionsForAdmin(adminId){
  if(typeof sessions.deleteByAdminId === "function"){
    return sessions.deleteByAdminId(adminId);
  }
  let dropped = 0;
  for(const [token,s] of sessions.entries()){
    if(+s.adminId === +adminId){ sessions.delete(token); dropped++; }
  }
  return dropped;
}
function activeSuperCountExcept(adminId){
  return db.prepare("SELECT COUNT(*) c FROM admins WHERE active!=0 AND (role IS NULL OR role='' OR role='super') AND id!=?").get(+adminId).c;
}
function lastSuperViolation(current, nextRole, nextActive){
  const wasActiveSuper = isSuperAdminRow(current);
  const willBeActiveSuper = nextActive !== 0 && (nextRole === "super" || nextRole == null || nextRole === "");
  if(wasActiveSuper && !willBeActiveSuper && activeSuperCountExcept(current.id) < 1) return "至少保留一个启用中的超级管理员";
  return "";
}
function generatedPassword(){
  return crypto.randomBytes(12).toString("base64").replace(/[+/=]/g,"").slice(0,12) + "8";
}
function rowDoctorId(table, id){ const r = db.prepare(`SELECT doctor_id AS d FROM ${table} WHERE id=?`).get(+id); return r ? r.d : null; }
function decisionDoctorId(id){ const r = db.prepare("SELECT s.doctor_id AS d FROM triage_decisions x JOIN triage_sessions s ON s.id=x.session_id WHERE x.id=?").get(+id); return r ? r.d : null; }
// 鉴权 +（可选）按医生归属校验。doctorId: number=校验；undefined=仅登录；null=资源不存在交由后续逻辑 404
function gate(req, res, doctorId){
  const s = authed(req);
  if(!s){ json(res,401,{error:"未登录"}); return null; }
  if(typeof doctorId === "number"){
    if(Number.isNaN(doctorId)){ json(res,400,{error:"缺少有效医生（doctorId）"}); return null; }
    if(!allowDoctor(s, doctorId)){ json(res,403,{error:"无该医生数据的访问权限"}); return null; }
  }
  return s;
}
function gateMessageLog(req, res, msgId){
  const did = rowDoctorId("message_log", +msgId);
  if(did == null){ json(res,404,{error:"消息不存在"}); return null; }
  return gate(req, res, did);
}
function gateTriageSession(req, res, sessionId){
  const did = rowDoctorId("triage_sessions", +sessionId);
  if(did == null){ json(res,404,{error:"分诊会话不存在"}); return null; }
  return gate(req, res, did);
}
/** 从分诊 session.patient_key 或关联 message_log 解析 QiWe 发送目标 */
function triageSessionDeliveryTarget(sess){
  if(!sess) return null;
  const key = String(sess.patient_key || "");
  if(key.startsWith("qiwe:")){
    const toId = key.slice(5).trim();
    return toId ? { channel:"qiwe", toId, isGroup:false, atUserId:null } : null;
  }
  const mk = /^community:(\d+):(.+)$/.exec(key);
  if(mk){
    const group = db.prepare("SELECT id, external_group_id FROM community_groups WHERE id=?").get(+mk[1]);
    const toId = group && group.external_group_id ? String(group.external_group_id) : null;
    return toId ? { channel:"community", toId, isGroup:true, atUserId: mk[2], groupId: group.id } : null;
  }
  const ml = db.prepare("SELECT group_id,sender_id,channel FROM message_log WHERE triage_session_id=? ORDER BY id DESC LIMIT 1").get(sess.id);
  if(!ml) return null;
  const toId = ml.group_id || ml.sender_id;
  return toId ? { channel:ml.channel||"qiwe", toId, isGroup:!!ml.group_id, atUserId: ml.sender_id||null, groupId:null } : null;
}
/** @deprecated 请用 outboxMod.enqueueDirect；保留别名避免遗漏调用 */
function insertDirectOutbound(opts){
  return outboxMod.enqueueDirect(opts);
}

const CAPABILITY_ACTIONS = [
  "admin.manage",
  "dashboard.platform.read",
  "dashboard.doctor.read",
  "audit.read_full",
  "audit.read_scoped",
  "credential.manage",
  "doctor.create",
  "doctor.clone",
  "doctor.activate",
  "doctor.delete",
  "doctor.profile.update",
  "rules.manage",
  "config.draft",
  "config.publish",
  "community.group.manage",
  "community.inbound.simulate",
  "community.campaign.create",
  "community.outbox.send",
  "community.outbox.edit",
  "triage.confirm_send",
  "triage.note_status",
  "followup.manage",
  "waitlist.manage",
  "submissions.manage",
  "knowledge.manage",
  "ops.strategy.manage",
  "outcome.manage",
  "ops.candidate_generate",
  "assistant_draft.generate",
  "qiwe.preview_send"
];
const TAB_CAPABILITIES = {
  triage:{ actions:["triage.confirm_send","triage.note_status"], roles:["super","ops_manager","assistant","viewer"] },
  community:{ actions:["community.outbox.send","community.outbox.edit"], roles:["super","ops_manager","assistant","viewer"] },
  followup:{ actions:["followup.manage"], roles:["super","ops_manager","assistant","viewer"] },
  waitlist:{ actions:["waitlist.manage"], roles:["super","ops_manager","assistant","viewer"] },
  // 大盘仅超管/运营；医助只看医生数据
  dash:{ actions:["dashboard.doctor.read","dashboard.platform.read"], roles:["super","ops_manager","assistant","viewer"] },
  dash_platform:{ actions:["dashboard.platform.read"], roles:["super","ops_manager","viewer"] },
  dash_doctor:{ actions:["dashboard.doctor.read"], roles:["super","ops_manager","assistant","viewer"] },
  ops:{ actions:["ops.strategy.manage","knowledge.manage","outcome.manage"], roles:["super","ops_manager","viewer"] },
  config:{ actions:["config.draft","config.publish"], roles:["super","ops_manager","viewer"] },
  codes:{ actions:["config.draft","config.publish","rules.manage"], roles:["super","ops_manager","viewer"] },
  subs:{ actions:["submissions.manage"], roles:["super","ops_manager","assistant","viewer"] },
  archive:{ actions:[], roles:["super","ops_manager","assistant","viewer"] },
  audit:{ actions:["audit.read_full","audit.read_scoped"], roles:["super","ops_manager","viewer"] },
  rules:{ actions:["rules.manage"], roles:["super","ops_manager","viewer"] },
  faq:{ actions:["rules.manage"], roles:["super","ops_manager","viewer"] },
  knowledge_group:{ actions:["rules.manage","audit.read_scoped","knowledge.manage"], roles:["super","ops_manager","viewer"] },
  doctors:{ actions:["doctor.create","doctor.clone","doctor.activate","doctor.delete","doctor.profile.update"], roles:["super","ops_manager","viewer"] },
  accounts:{ actions:["admin.manage"], roles:["super"] },
  qiwe:{ actions:["credential.manage","qiwe.preview_send"], roles:["super"] }
};
function canAdmin(s, action, context){
  return adminActionCapability(s, action, context).allowed;
}
function adminActionCapability(s, action, context){
  const canonical = authz.canonicalAdminAction(action);
  const denied = reason => ({ allowed:false, action:canonical, reason });
  if(!s || !canonical) return denied("未登录");
  const a = adminRow(s.adminId);
  if(!activeAdminRow(a)) return denied("账号已停用或角色无效");
  if(isSuperAdminRow(a)) return { allowed:true, action:canonical, reason:"" };
  if(!authz.roleAllowsAdminAction(a.role, canonical)) return denied("当前角色无该操作权限");
  const did = context && context.doctorId != null ? Number(context.doctorId) : NaN;
  if(!Number.isInteger(did) || did <= 0) return denied("缺少医生范围上下文");
  if(!allowDoctor(s, did)) return denied("无该医生数据的访问权限");
  return { allowed:true, action:canonical, reason:"" };
}
function requireAdminAction(req, res, s, action, context, message){
  const cap = adminActionCapability(s, action, context);
  if(cap.allowed) return true;
  json(res,403,{error:message || cap.reason || "无该操作权限"});
  return false;
}

function adminScopeTextFor(a){
  if(isSuperAdminRow(a)) return "全部医生";
  const ids = adminDoctorIds(a.id);
  if(!ids.length) return "未分配医生";
  const names = db.prepare(`SELECT name FROM doctors WHERE id IN (${ids.map(()=>"?").join(",")}) ORDER BY id`).all(...ids).map(r=>r.name);
  return names.length ? names.join(" / ") : "未分配医生";
}
function tabCapabilitiesFor(s, doctorId){
  const a = adminRow(s.adminId);
  const role = authz.effectiveAdminRole(a && a.role);
  const out = {};
  Object.keys(TAB_CAPABILITIES).forEach(key=>{
    const meta = TAB_CAPABILITIES[key];
    const visibleByRole = meta.roles.includes(role);
    const actionCaps = (meta.actions || []).map(x=>adminActionCapability(s, x, {doctorId}));
    const writable = actionCaps.some(x=>x.allowed);
    out[key] = {
      visible:visibleByRole,
      readOnly:visibleByRole && !writable,
      reason:visibleByRole ? "" : "当前角色不显示该入口"
    };
  });
  return out;
}
function actionCapabilitiesFor(s, doctorId){
  const out = {};
  CAPABILITY_ACTIONS.forEach(action=>{
    const cap = adminActionCapability(s, action, {doctorId});
    out[action] = { allowed:cap.allowed, reason:cap.reason || "" };
  });
  // 兼容旧 action 名，避免历史前端或测试脚本复制新矩阵时误判。
  ["outbox.send","outbox.edit","outbox.cancel","outbox.ignore","outbox.assignee"].forEach(alias=>{
    const canonical = authz.canonicalAdminAction(alias);
    out[alias] = out[canonical] || { allowed:false, reason:"未知权限点" };
  });
  return out;
}

function auditText(v, max){
  const s = maskPII(String(v == null ? "" : v));
  const n = max || 1000;
  return s.length > n ? s.slice(0, n) + `...（已截断，原长${s.length}）` : s;
}
function auditSanitize(v, key, depth){
  if(AUDIT_SECRET_KEY_RE.test(String(key || ""))) return "[redacted]";
  if(v == null) return v;
  if(typeof v === "string") return auditText(v, 1000);
  if(typeof v === "number" || typeof v === "boolean") return v;
  if(Array.isArray(v)){
    if((depth || 0) >= 6) return "[max-depth]";
    return v.slice(0, 80).map(x=>auditSanitize(x, key, (depth || 0) + 1));
  }
  if(typeof v === "object"){
    if((depth || 0) >= 6) return "[max-depth]";
    const out = {};
    Object.keys(v).slice(0, 120).forEach(k=>{ out[k] = auditSanitize(v[k], k, (depth || 0) + 1); });
    return out;
  }
  return String(v);
}
function auditJson(v){
  return JSON.stringify(auditSanitize(v === undefined ? {} : v, "", 0) || {}, null, 2);
}
function auditSessionForUsername(username){
  const u = String(username || "").trim();
  if(!u || u === "system") return { adminId:null, username:u || "system", role:"system" };
  const a = db.prepare("SELECT id,username,role,active FROM admins WHERE username=?").get(u);
  return a ? { adminId:a.id, username:a.username, role:a.role || "super" } : { adminId:null, username:u, role:"" };
}
function adminAudit(req, s, event){
  const ev = event || {};
  const actor = s || auditSessionForUsername(ev.actorUsername || "");
  const requestId = String(ev.requestId || (req && req.headers["x-request-id"]) || "").slice(0, 80);
  try{
    return db.prepare(`INSERT INTO admin_audit_log(
      actor_admin_id,actor_username,actor_role,action,resource_type,resource_id,doctor_id,patient_id,session_id,risk_level,channel,
      outcome,reason,before_json,after_json,diff_json,meta_json,ip,user_agent,request_id,created_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      actor.adminId || null,
      actor.username || "system",
      actor.role || "",
      String(ev.action || ""),
      String(ev.resourceType || ""),
      ev.resourceId == null ? null : String(ev.resourceId),
      ev.doctorId == null ? 0 : Number(ev.doctorId) || 0,
      ev.patientId == null ? null : Number(ev.patientId) || null,
      ev.sessionId == null ? null : Number(ev.sessionId) || null,
      String(ev.riskLevel || ""),
      String(ev.channel || "web"),
      String(ev.outcome || "success"),
      auditText(ev.reason || "", 500),
      auditJson(ev.before),
      auditJson(ev.after),
      auditJson(ev.diff),
      auditJson(ev.meta),
      req ? clientIp(req).slice(0, 80) : "",
      req ? String(req.headers["user-agent"] || "").slice(0, 300) : "",
      requestId,
      now()
    ).lastInsertRowid;
  }catch(e){
    console.error("[audit] write failed:", e && e.message);
    throw new Error("审计写入失败");
  }
}
function adminAuditBestEffort(req, s, event){
  try{ return adminAudit(req, s, event); }
  catch(e){ return null; }
}
function auditRequestId(req){
  const header = String((req && req.headers["x-request-id"]) || "").trim();
  return header ? header.slice(0, 80) : crypto.randomBytes(8).toString("hex");
}
function auditAdminSnapshot(a){
  if(!a) return null;
  return {
    id:a.id,
    username:a.username,
    staffId:a.staff_id || "",
    displayName:a.display_name || "",
    role:a.role || "super",
    active:a.active !== 0,
    doctorIds:adminDoctorIds(a.id),
    note:a.note || "",
    createdAt:a.created_at || null,
    updatedAt:a.updated_at || null,
    lastLoginAt:a.last_login_at || null,
    passwordChangedAt:a.password_changed_at || null,
    disabledAt:a.disabled_at || null,
    disabledBy:a.disabled_by || null
  };
}
function auditOutboxSnapshot(rowOrId){
  const o = typeof rowOrId === "object" ? rowOrId : db.prepare("SELECT * FROM outbound_queue WHERE id=?").get(+rowOrId);
  if(!o) return null;
  return {
    id:o.id,
    doctorId:o.doctor_id,
    groupId:o.group_id || null,
    messageId:o.message_id || null,
    channelType:o.channel_type || "",
    status:o.status || "",
    source:o.source || "",
    priority:o.priority || "",
    assignee:o.assignee || null,
    sentMode:o.sent_mode || null,
    sentAt:o.sent_at || null,
    sentBy:o.sent_by || "",
    externalMsgId:o.external_msg_id ? "configured" : "",
    attempts:o.attempts || 0,
    sendError:o.send_error || "",
    text:auditText(o.text || "", 240),
    payload:parseJsonAny(o.payload, {})
  };
}
function auditDecisionSnapshot(id){
  const d = db.prepare(`SELECT x.*, s.doctor_id AS doctor_id, s.patient_id AS patient_id
    FROM triage_decisions x JOIN triage_sessions s ON s.id=x.session_id WHERE x.id=?`).get(+id);
  if(!d) return null;
  return {
    id:d.id,
    doctorId:d.doctor_id,
    patientId:d.patient_id || null,
    sessionId:d.session_id,
    messageId:d.message_id || null,
    riskLevel:d.risk_level || "",
    status:d.status || "",
    canAutoSend:!!d.can_auto_send,
    needsHuman:!!d.needs_human,
    decidedBy:d.decided_by || "",
    finalText:auditText(d.final_text || "", 240)
  };
}
function auditOut(row, includeDetail){
  const base = {
    id:row.id,
    actorAdminId:row.actor_admin_id || null,
    actorUsername:row.actor_username || "",
    actorRole:row.actor_role || "",
    action:row.action,
    resourceType:row.resource_type,
    resourceId:row.resource_id,
    doctorId:row.doctor_id || 0,
    patientId:row.patient_id || null,
    sessionId:row.session_id || null,
    riskLevel:row.risk_level || "",
    channel:row.channel || "",
    outcome:row.outcome || "",
    reason:row.reason || "",
    meta:parseJsonAny(row.meta_json, {}),
    requestId:row.request_id || "",
    createdAt:row.created_at
  };
  if(includeDetail){
    base.before = parseJsonAny(row.before_json, {});
    base.after = parseJsonAny(row.after_json, {});
    base.diff = parseJsonAny(row.diff_json, {});
    base.ip = row.ip || "";
    base.userAgent = row.user_agent || "";
  }
  return base;
}

/* 管理员账号生命周期：仅超级管理员可管理他人；所有账号可改自己的密码 */
/* 医生管理 */
function doctorGroupMemberCount(doctorId){
  const did = +doctorId;
  const row = db.prepare(`SELECT COALESCE(SUM(g.member_count), 0) AS c
    FROM community_groups g
    WHERE g.is_business = 1
      AND (
        g.doctor_id = ?
        OR EXISTS (
          SELECT 1 FROM community_group_doctors d
          WHERE d.group_id = g.id AND d.doctor_id = ? AND d.role = 'primary'
        )
      )`).get(did, did);
  return row ? (+row.c || 0) : 0;
}
function doctorListOut(row){
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    title: row.title,
    hospital: row.hospital,
    dept: row.dept,
    specialty: row.specialty,
    hospital_phone: row.hospital_phone,
    active: row.active,
    member_count: doctorGroupMemberCount(row.id)
  };
}
/* 医生管理 → routes/doctors-admin.js */
/* 后台鉴权 / 账号 / 审计 → routes/auth-admin.js */
registerAuthAdminRoutes(route, {
  parseBody, json, gate, requireAdminAction,
  db, now, hashPw, authz, sessions,
  MESSAGE_MAX_BODY, ADMIN_SESSION_COOKIE_MAX_AGE,
  loginLimitStatus, recordLoginFailure, clearLoginFailure,
  activeAdminRow, buildSession, sessionCookie, cookies,
  authed, adminRow, adminOut, auditAdminSnapshot, adminAudit,
  allowDoctor, adminScopeTextFor, tabCapabilitiesFor, actionCapabilitiesFor,
  allocateStaffId, cleanText, auditOut,
  clearSessionsForAdmin, canAdmin,
  normalizeAdminRole, normalizeDoctorIds, replaceAdminDoctors,
  adminDoctorIds,   lastSuperViolation, generatedPassword
});
registerChunyuOpenRoutes(route, {
  parseBody, json, db, MESSAGE_MAX_BODY, authed, allowDoctor
});

registerDoctorsAdminRoutes(route, {
  parseBody, json, gate, rowDoctorId, requireAdminAction, db, adminScope, now,
  doctorListOut, patientProfile, inviteStore, inviteUrlForToken, adminAudit, cleanText,
    afterDoctorProvisioned, rememberRemovedDoctorSlug, forgetRemovedDoctorSlug
});

/* rules/FAQ/submissions/stats/dashboard/knowledge 已迁至 routes/content-admin.js */

/* 建档邀请链接已迁入 routes/doctors-admin.js */

/* 患者档案 → routes/patients-admin.js */
registerPatientsAdminRoutes(route, {
  parseBody, json, gate, rowDoctorId, requireAdminAction, db, adminScope, now,
  profileStore, autoMergePatientsByUserId, reconcileVerifiedPhonePersons, reconcileQiweIdentityPersons, mergePersons, mergePatients,
  preferDisplayName, patientArchive,
  decorateAdminPatient, hydrateAdminMessageRow, friendlyPatientLabel, patientArchiveLabel,
  allocateStaffId, stripChannelSuffix, isPlaceholderDisplayName, resolvePersonWechatName,
  maskPII, patientProfile, personRowForPatient
});

/* 社群运营接入层 → routes/community-public.js（模块化试点） */
registerCommunityPublicRoutes(route, {
  parseBody, json, community, authz, COMMUNITY_DEMO_TOKEN
});
/* —— 企业微信入站消息处理：复用 community.handleInbound（engine→triage→出站队列）——
   不变量3 收口：企微入站「真正零自动发」，AI/系统绝不在回调里向企微发任何内容；
   所有产出（规则命中/编号/AI 草稿）一律入队列 pending，等医助在后台「确认发送」才发。 */
/* 企微/QiWe 回调与凭证 → routes/channel-bridges.js */
registerChannelBridgeRoutes(route, {
  parseBody, json, gate, requireAdminAction, send, readRaw,
  db, wecom, qiwe, qiweBridge, community, patientReply, authz,
  QIWE_DEMO_SECRET, parseBodyBigIntSafe, MESSAGE_MAX_BODY,
  adminAudit, adminAuditBestEffort, auditRequestId, auditText
});

registerLlmAdminRoutes(route, { parseBody, json, gate, requireAdminAction, adminAudit, db });
registerVideoChannelAdminRoutes(route, { parseBody, json, gate, requireAdminAction, adminAudit, db });

/* 社群管理后台 → routes/community-admin.js */
registerCommunityAdminRoutes(route, {
  parseBody, json, gate, rowDoctorId, requireAdminAction,
  db, community, adminScope, isSuperSession, allowDoctor, maskPII
});

/* 出站审核台 → routes/outbox-admin.js（模块化 Phase 3） */
registerOutboxAdminRoutes(route, {
  parseBody, json, gate, rowDoctorId, requireAdminAction,
  db, adminScope, auditRequestId, auditOutboxSnapshot,
  adminAudit, adminAuditBestEffort,
  outboxMod, community
});

/* 群风控处置 → routes/community-moderation.js */
registerCommunityModerationRoutes(route, {
  parseBody, json, gate, requireAdminAction,
  db, community, adminAudit
});

/* 企微侧边栏 → routes/wecom-sidebar.js */
registerWecomSidebarRoutes(route, {
  json, gate, rowDoctorId,
  db, community, triage, qiwe, qiweBridge, adminScope
});

/* 运营策略台：知识库分层 / 群运营边界 / 医生画像 / 效果回收 */
const KNOWLEDGE_LAYERS = new Set(["医院通用","医院/科室通用","医生个人","群运营动态"]);
const KNOWLEDGE_MODES = new Set(["预制菜","半预制","现炒菜"]);
const KNOWLEDGE_STATUS = new Set(["draft","ready","retired"]);
function cleanText(v, max){ return String(v==null?"":v).trim().slice(0, max||2000); }
function cleanInt(v){ const n = Number(v); return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0; }
function doctorRow(doctorId){ return db.prepare("SELECT id,slug,name,title,hospital,dept,specialty FROM doctors WHERE id=?").get(+doctorId); }
function opsStrategyDefaults(d){
  const specialty = String((d.specialty || "") + (d.dept || ""));
  const goodDept = /外科|骨科|消化/.test(specialty);
  const weakDept = /神经|皮肤|儿科/.test(specialty);
  return {
    group_mode:"以微信群运营为主：入群欢迎、编号菜单、每周科普、门诊/复诊提醒、常见问题答疑；AI先做助理草稿和低风险自动回复。",
    private_chat_policy:"默认不主动加患者微信私聊。仅在患者主动提交联络表、加号、住院等表单，或医生明确授权的场景下进入一对一承接。",
    doctor_profile:"优先匹配两类医生：一流三甲的二流医生（刚晋升副主任、业务热情高、追求个人发展），以及二流医院的一流医生（区域普通三甲主任/骨干专家）。",
    specialty_fit: goodDept ? "当前科室适配度高：外科/骨科/消化内科就医路径明确，复诊、检查、住院、加号和随访抓手强。" :
      weakDept ? "当前科室需谨慎试点：神经/皮肤/儿科横向反馈偏弱，建议先小样本验证内容、转化和合规边界。" :
      "当前科室建议作为观察组评估：先看医生配合度、可承接服务和群运营素材质量。",
    pharma_value:"药企价值以医生合作破冰为主：把工具赠送给目标医生，帮助医生做患者服务与科普运营，从一次性拜访变成持续触点。",
    notes:"效果评估不做强因果承诺。建议每月回收医生门诊量趋势、群活跃、患者意向与医生主观感受；约40%医生可能直观感受到门诊量增长。"
  };
}
function opsMetricsHint(doctorId){
  const did = +doctorId;
  const since7 = new Date();
  since7.setDate(since7.getDate() - 7);
  const sinceIso = since7.toISOString();
  const inbound7d = db.prepare("SELECT COUNT(*) c FROM community_messages WHERE doctor_id=? AND created_at>=?").get(did, sinceIso)?.c || 0;
  const consultLeads = db.prepare(`SELECT COUNT(*) c FROM submissions WHERE doctor_id=? AND (
    type LIKE '%加号%' OR type LIKE '%住院%' OR type LIKE '%联络%' OR type LIKE '%建档%' OR type LIKE '%感谢%'
  )`).get(did)?.c || 0;
  return { inbound7d:+inbound7d || 0, consultLeads:+consultLeads || 0 };
}
function ensureOpsAssets(doctorId){
  const d = doctorRow(doctorId);
  if(!d) return null;
  const nowIso = now();
  const defs = opsStrategyDefaults(d);
  db.prepare(`INSERT OR IGNORE INTO ops_strategy(
    doctor_id,group_mode,private_chat_policy,doctor_profile,specialty_fit,pharma_value,notes,updated_at
  ) VALUES(?,?,?,?,?,?,?,?)`).run(
    d.id,
    defs.group_mode,
    defs.private_chat_policy,
    defs.doctor_profile,
    defs.specialty_fit,
    defs.pharma_value,
    defs.notes,
    nowIso
  );
  const existing = db.prepare("SELECT COUNT(*) c FROM knowledge_items WHERE doctor_id=?").get(d.id).c;
  if(existing === 0){
    const ins = db.prepare(`INSERT INTO knowledge_items(doctor_id,layer,mode,title,body,source,owner,status,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?)`);
    knowledgeLayerSeedRows(d, nowIso).forEach((row) => {
      ins.run(d.id, row.layer, row.mode, row.title, row.body, row.source, row.owner, row.status, row.updated_at);
    });
  }
  return d;
}
function outcomeOut(r){
  return { id:r.id, period:r.period, outpatient_baseline:r.outpatient_baseline||0, outpatient_current:r.outpatient_current||0,
    perceived_growth:!!r.perceived_growth, group_active:r.group_active||0, consult_leads:r.consult_leads||0,
    notes:r.notes||"", created_at:r.created_at };
}
function importMissingKnowledgeLayers(doctorId){
  const d = doctorRow(doctorId);
  if(!d) return { added:0, layers:[] };
  const existing = new Set(db.prepare("SELECT DISTINCT layer FROM knowledge_items WHERE doctor_id=?").all(+doctorId).map(r=>r.layer));
  const ins = db.prepare(`INSERT INTO knowledge_items(doctor_id,layer,mode,title,body,source,owner,status,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?)`);
  const added = [];
  for(const row of knowledgeLayerSeedRows(d, now())){
    if(existing.has(row.layer)) continue;
    const r = ins.run(d.id, row.layer, row.mode, row.title, row.body, row.source, row.owner, row.status, row.updated_at);
    added.push({ id:r.lastInsertRowid, layer:row.layer, title:row.title });
    existing.add(row.layer);
  }
  return { added:added.length, layers:added };
}
function knowledgeOut(row, vecRow){
  const hash = triage.knowledgeContentHash(row.title, row.body);
  const embedded = !!(vecRow && vecRow.content_hash === hash);
  const needsEmbed = row.status === "ready" && (!vecRow || vecRow.content_hash !== hash);
  return {
    id:row.id,
    layer:row.layer,
    mode:row.mode,
    title:row.title,
    body:row.body,
    source:row.source || "",
    owner:row.owner || "",
    status:row.status,
    updated_at:row.updated_at,
    embedded,
    vectorStale:!!(vecRow && vecRow.content_hash !== hash),
    needsEmbed,
    embeddedAt:vecRow && vecRow.content_hash === hash ? (vecRow.embedded_at || null) : null
  };
}

const CONFIG_DOMAIN_ORDER = opsMod.CONFIG_DOMAIN_ORDER;
function configIsSuper(s){ return adminScope(s) === null; }
function configMeta(domain){ return opsMod.configMeta(domain); }
function configOwnerId(domain, doctorId){
  return opsMod.ownerIdForDomain(domain, doctorId);
}
function parseConfigJson(text, fallback){ return opsMod.parseConfigJson(text, fallback); }
function parseJsonAny(text, fallback){ try{ const v = JSON.parse(text || "null"); return v==null ? fallback : v; }catch(e){ return fallback; } }
function stableJson(v){ return opsMod.stableJson(v); }
function publicGroupName(v){ return String(v || "").replace(/（群名待甲方确认）|\(群名待甲方确认\)/g, "").trim(); }
function doctorContent(did){
  const r = db.prepare("SELECT content FROM doctors WHERE id=?").get(+did);
  return parseConfigJson(r && r.content, {});
}
const LV_DOCX_SCRIPTS = {
  groupWelcome:"👏您好，欢迎加入吕富靖主任建立的【院外公益健康群】\n⭐点击【医患联络表】提交基础信息，便于医生了解您的情况☑\n⭐“1”😄在群里输入数字，查看所有群功能⭐\n💗点击下方小程序观看吕富靖主任给您的视频问候",
  code101:"为保护您的隐私，请通过医生小程序主页相关服务进行 1对1 咨询医生，医生利用空闲时间回复，请耐心等待。感谢您的理解和配合[玫瑰][玫瑰]。\n🌻 紧急情况，请及时到医院就诊。",
  code102:"为保护您的隐私，请通过医生小程序主页视频问诊服务进行 1对1 咨询医生，医生利用空闲时间回复，请耐心等待。感谢您的理解和配合[玫瑰][玫瑰]。\n🌻 紧急情况，请及时到医院就诊。",
  code103:"西城院区010-63138585、科室电话：010-63014411，地址 北京市西城区永安路95号。\n通州院区010-80838585，地址 北京市通州区潞苑东路101号院。\n顺义院区010-81608585，地址 北京市顺义区友谊南街1号。",
  code105:"点击问诊小程序，查看医生回复，如果未回复请耐心等待一下。",
  code201:"请您选择合适的时间，通过医院官方挂号平台挂号，挂号成功后持医保卡前往医院取号。",
  code202:"-",
  code301:"注意：本次加号为群内专属，与医院官方发布门诊信息不互通。请留意医院公众号及群内通知，排除医生停诊日，停诊日加号无效。\n📢 【申请加号】操作步骤如下：\n1、打开【小程序链接】，选择【预约就诊】，根据流程操作。\n2、申请加号后，您可通过订单页面查看加号结果。",
  code302:"📝 填写须知：\n1、请填写【住院申请表】，向医生申请住院。最终能否入院及具体入院时间，由院方审核后再行通知。\n2、由于医院床位紧张，请各位朋友提前做好安排，避免错过最佳治疗时机。\n🌻 友情提醒：\n1. 填写完信息后，请在群里【告知医助】，以便及时为您跟进。\n2. 床位安排确定后，住院部医生会提前电话通知，最终住院时间以医生电话通知为准。",
  code501:"-",
  code606:"🌻 吕主任的科普在以下渠道发布，欢迎大家关注\n1、抖音：消化内科吕富靖\n2、小红书：消化内科吕富靖\n3、百家号：消化内科吕富靖\n4、快手：消化内科吕富靖\n5、微信公众号：吃好喝好",
  code616:"直接弹出链接",
  code626:"直接弹出链接",
  code808:"直接弹出链接",
  code818:"🌻 感谢您转发海报，让更多患者获得主任的帮助\n👉🏻 转发方法：保存图片，转发到朋友圈、微信好友或微信群",
  code888:"-",
  code909:"感谢您的信任与认可，祝您后续诊疗一切顺利，早日痊愈。",
  code919:"分享您的就医感受，让更多人了解吕主任。",
  code979:"请点击下方【医患联络表】提交基础信息，便于医生了解您的情况。\n建议将群昵称改为「真实姓名」，方便医助识别跟进。",
  "code联络表":"请点击下方【医患联络表】提交基础信息，便于医生了解您的情况。\n建议将群昵称改为「真实姓名」，方便医助识别跟进。",
  memberVisit:"【新患者到访 · 仅供医助关注，无需发送】{patient} 首次在群内发言，系统已发送入群欢迎。建议医助关注后续消息，必要时确认身份、备注为「姓名+疾病」，并主动引导 101 咨询/201 挂号等入口。"
};
function liveDoctorGroupConfig(did){
  const d = doctorRow(did) || { id:did, name:"医生", hospital:"医院", dept:"科室", title:"", specialty:"" };
  const c = doctorContent(did);
  const groups = db.prepare("SELECT id,name,external_group_id,channel_type,welcome_enabled,auto_reply_enabled,review_mode,status,is_business,data_source FROM community_groups WHERE doctor_id=? ORDER BY id").all(+did);
  const storedDefaults = c.defaultNewGroup || {};
  return {
    doctor:{ id:d.id, name:d.name, hospital:d.hospital, dept:d.dept, title:d.title || "", specialty:d.specialty || "", profile:(c.doctorProfile && c.doctorProfile.intro) || "" },
    groups:groups.map(g=>({
      id:g.id, name:g.name, externalGroupId:g.external_group_id, channelType:g.channel_type,
      welcomeEnabled:!!g.welcome_enabled, autoReplyEnabled:!!g.auto_reply_enabled, reviewMode:g.review_mode,
      status:g.status || "", isBusiness:!!g.is_business, dataSource:g.data_source || ""
    })),
    defaultNewGroup:{
      welcomeEnabled: storedDefaults.welcomeEnabled !== false,
      autoReplyEnabled: !!storedDefaults.autoReplyEnabled,
      reviewMode: storedDefaults.reviewMode || "human_review",
      owner: storedDefaults.owner || "医助运营"
    }
  };
}
function defaultOpsConfig(domain, did){
  const d = doctorRow(did) || { name:"医生", hospital:"医院", dept:"科室", specialty:"" };
  const c = doctorContent(did);
  const groups = db.prepare("SELECT id,name,external_group_id,channel_type,welcome_enabled,auto_reply_enabled,review_mode FROM community_groups WHERE doctor_id=? ORDER BY id").all(+did);
  const rules = db.prepare("SELECT code,aliases,match_type,bot,responses,enabled,sort FROM rules WHERE doctor_id=? ORDER BY sort,id").all(+did)
    .map(r=>({ code:r.code, aliases:parseJsonAny(r.aliases, []), matchType:r.match_type, bot:r.bot, responses:parseJsonAny(r.responses, []), enabled:!!r.enabled, sort:r.sort||0 }));
  const cards = db.prepare("SELECT code,title,app_id,username,page_path,source_short_link,source_type,desc FROM qiwe_weapp_templates WHERE doctor_id=? ORDER BY code,id").all(+did);
  if(domain === "prompts") return {
    riskAssessment:"你是主任团队医助，只做预分诊与草稿整理，不替医生诊断。先半句接住患者原话，再问 1–2 个关键问题或标出待补充信息。风险两轴：ClinicalRisk（病情）× SendPolicy（出站）。不降低本地安全规则；中风险仅发卡可自动；自由医疗建议须人工。",
    intakeCard:"像医助接诊前整理病历：主诉、症状特点、持续时间、伴随症状、既往史与用药、患者诉求。缺失写「待补充」，不编造。",
    lowRiskReply:"以主任团队医助口吻：先半句接住患者，再问 1–2 个关键问题或给 1–2 条可执行建议。80–200 字、最多 4–5 句，禁止客服腔。症状问部位/时长/加重/伴随；轻症不罗列长红旗。服务类可自然引导入口，不只教编号。不诊断、不开药、不解读报告。",
    intentRecognition:"识别咨询、挂号、住院、随访、投诉、闲聊、紧急症状与编号硬跳转。拿不准或涉病情判断时转人工；优先自然语言引导，不让患者觉得被机器打发。",
    replySplitMinTotal:"120",
    replySplitMaxBubble:"280",
    replySplitDelayMs:"420",
    personaHealthReport:"【健康报告】先接住患者对指标或异常的担心。群里不做正式报告解读或良恶性判断；可帮说清最担心哪几项、是否需尽快线下复核原件。自然引导一对一补充资料，语气像值班医助。",
    personaCaseAnalysis:"【病例整理】帮患者理清时间线，追问开始时间、主要不适、加重或缓解、已做检查/用药。不下诊断，整理后交医助或医生复核。",
    personaCarePlan:"【护理照护】给 1–2 条可执行日常建议（休息、饮食、观察要点）。不开药、不替代复诊医嘱；发热、剧痛、出血等红旗提示急诊。",
    // 待办#13：通用安全风险分层提示词（医院 / 科室 / 个人）
    safetyHospital:"【医院层】仅做院内正式服务入口引导，不替医院承诺号源/疗效/床位；涉及合规宣传口径以医院官方服务号为准；急危重症一律引导线下急诊或 120。",
    safetyDept:"【科室层】服务边界限定本科室常见路径（门诊、检查预约、随访引导）；不跨科室给诊疗建议；科室共性宣教只做一般性说明并注明以面诊为准。",
    safetyPersonal:"【医生个人层】不伪装成医生本人发言；不承诺该医生一定出诊/加号成功；医生个人科普与病例素材须经审核后再用；群内不展开个人病情细节。"
  };
  if(domain === "safety") return {
    redFlags:["胸痛","呼吸困难","呕血","黑便","便血","剧烈腹痛","持续高热","意识不清"],
    humanTriggers:["要不要手术","怎么吃药","报告怎么看","是不是癌","处方","诊断"],
    levels:{
      high:{ name:"高风险", action:"自动发送固定安全话术并转人工跟进；禁止自由医疗建议；提示线下急诊/120", modelAllowed:false, sendPolicy:"block" },
      medium:{ name:"中风险", action:"仅发卡（短交接语+春雨卡）可自动；夹带病情解读/用药建议必须人工确认", modelAllowed:true, sendPolicy:"card_only_or_review" },
      low:{ name:"低风险", action:"服务类自然语言引导与发卡可自动；仍过二次安全扫描，不可诊断/开药", modelAllowed:true, sendPolicy:"auto" }
    },
    layers:{
      hospital:{ name:"医院", promptKey:"safetyHospital" },
      dept:{ name:"科室", promptKey:"safetyDept" },
      personal:{ name:"医生个人", promptKey:"safetyPersonal" }
    }
  };
  if(domain === "scripts"){
    const welcomeGroupName = publicGroupName(groups[0] && groups[0].name ? groups[0].name : `${d.name}医生健康群`) || `${d.name}医生健康群`;
    const baseScripts = {
    groupWelcome:`新朋友，欢迎加入${welcomeGroupName}！这里由${d.name}医生团队和医助共同维护，我会先帮大家整理问题、引导到合适入口，复杂情况再找医生确认。\n\n为方便医生快速识别您的情况，建议把群昵称改成「姓名+疾病」（例如：王先生+胃炎）。\n· 发送 1 查看群功能菜单\n· 发送 101 向医生咨询\n· 想了解挂号/出诊时间，发送 303\n\n群内以健康科普与就医服务为主；涉及具体病情、用药、检查报告判断会找医生确认。若出现胸痛、呼吸困难、呕血、剧烈腹痛等紧急情况，请直接线下就医或拨打 120。`,
    code101:"我收到您的咨询需求了。发送 101 后，我会把医生春雨主页/咨询入口发给您，您可以在里面选择图文、电话、视频或预约就诊等合适方式；涉及具体病情时，也会由医助继续跟进，不会把您落下。",
    code303:"我来帮您看挂号和出诊相关入口。发送 303 后，医助会回复医院挂号通道、出诊时间与就诊地点；如果页面信息不够明确，也可以继续在群里说明，我会转医助帮您确认。",
    transferHuman:"收到，涉及病情判断需要医生看。我先帮您转人工，稍等；若症状加重，请优先线下就医。",
    emergency:"情况可能比较急，不建议只在群里等。请尽快去急诊或正规医院，必要时打 120。",
    nonText:"您发来的图片/资料我已经收到。图片内容需要医助人工查看，我会帮您转给医助跟进；如果方便，也请补充一句文字说明您最想咨询的问题，这样处理会更快。",
    voice:"不好意思，您的语音我这边暂时没能听清/稳定识别。为了不漏掉您的情况，麻烦您用文字简单补充一下；如果不方便打字，我也会帮您转医助人工查看。",
    memberVisit:"【新患者到访 · 仅供医助关注，无需发送】{patient} 首次在群内发言，系统已发送入群欢迎。建议医助关注后续消息，必要时确认身份、备注为「姓名+疾病」，并主动引导 101 咨询/303 挂号等入口。"
    };
    return d.slug === "lvfujing" ? Object.assign({}, baseScripts, LV_DOCX_SCRIPTS) : baseScripts;
  }
  if(domain === "doctor_group") return liveDoctorGroupConfig(did);
  if(domain === "contact_form"){
    const cf = c.contactForm || {};
    const diseaseField = (cf.fields || []).find((f) => f && f.key === "disease");
    const opts = Array.isArray(diseaseField && diseaseField.options) ? diseaseField.options.map(String) : ["消化系统疾病", "其它"];
    return {
      title: cf.title || "医患通患者档案",
      desc: cf.desc || "提交基础信息建档（仅医生团队可见）",
      diseaseOptions: opts,
      submitText: cf.submitText || "提交建档",
      successTitle: (cf.success && cf.success.title) || "已提交",
      successDesc: (cf.success && cf.success.desc) || "医助会联系您。"
    };
  }
  if(domain === "codes_cards") return {
    codes:rules.map(r=>({ id:r.id, code:r.code, aliases:parseJsonAny(r.aliases, []), enabled:!!r.enabled, responses:parseJsonAny(r.responses, []), matchType:r.match_type, bot:r.bot, sort:r.sort||0 })),
    cards:cards.map(x=>({ id:x.id, code:x.code, title:x.title||"", desc:x.desc||"", appId:x.app_id ? "configured" : "", username:x.username ? "configured" : "", pagePath:x.page_path ? "configured" : "", sourceType:x.source_type||"", sourceShortLink:x.source_short_link||"" })),
    fallback:{ missingCard:(c.codesCardsFallback && c.codesCardsFallback.missingCard) || "原生卡片未就绪时，按文字/链接/问卷承接；404 页面不存在时使用 101 医生主页卡兜底。" }
  };
  return {};
}
const OLD_PROMPT_DEFAULTS = {
  riskAssessment:"系统只做预分诊和医助草稿，不替医生诊断。AI 只能补充表达，不能降低安全规则判定的风险等级。",
  intakeCard:"提取主诉、症状特点、持续时间、伴随症状、既往史与用药、患者诉求。缺失信息标注待补充。",
  lowRiskReply:"若问症状/疾病：优先引导「101」问诊；常识靠后。仅做服务引导，不给诊断、用药、检查解读或治疗方案。",
  intentRecognition:"识别编号、挂号、咨询、住院、随访、投诉、闲聊、紧急症状等意图；无法判断时转人工。"
};
/** 对话 Agent 上线前的 prompts 默认值（精确匹配则升级） */
const PRE_AGENT_PROMPT_DEFAULTS = {
  riskAssessment:"你是吕富靖主任团队的医助助手，只做预分诊和医助草稿，不替医生诊断。先体现“已经认真看到患者的问题”，再整理风险；AI 助手只能补充表达，不能降低本地安全规则判定的风险等级。",
  lowRiskReply:"以“主任团队医助”的身份回复：先一句接住患者；若在询问症状/疾病，优先引导发送「101」一对一问诊，常识提醒最多一句且放在问诊引导之后；挂号/加号等服务流程引导对应编号。不诊断、不用药、不解读检查报告、不承诺疗效。",
  intentRecognition:"识别编号、挂号、咨询、住院、随访、投诉、闲聊、紧急症状等意图；拿不准或涉及具体病情判断时转人工。不要让患者觉得被机器打发，要给出下一步明确入口。"
};
/** 真人医助人设 prompts（2026-07-22；精确匹配或命中旧口径则升级） */
const PERSONA_PROMPT_DEFAULTS = {
  riskAssessment:"你是吕富靖主任团队的医助助手，只做预分诊和医助草稿，不替医生诊断。先体现“已经认真看到患者的问题”。风险用两轴：ClinicalRisk（low/medium/high）看病情敏感度；SendPolicy（auto/card_only/review/block）看出站。AI 只能补充表达，不能降低本地安全规则。中风险仅发卡可自动；自由医疗建议必须转人工。",
  lowRiskReply:"以“主任团队医助”的身份回复：先一句接住患者；用自然语言说明下一步，并配合系统发卡/服务入口，不要只教患者发送编号口令。挂号/加号等走服务引导。不诊断、不用药、不解读检查报告、不承诺疗效。",
  intentRecognition:"识别咨询、挂号、住院、随访、投诉、闲聊、紧急症状与编号硬跳转等意图；拿不准或涉及具体病情判断时转人工。优先自然语言引导入口，不要让患者觉得被机器打发。"
};
/** 对话 Agent 上线前的安全等级默认值（精确匹配则升级） */
const PRE_AGENT_SAFETY_LEVEL_DEFAULTS = {
  high:{ action:"立即转人工并提示线下急诊/正规医院就诊", sendPolicy:"safe_template_plus_human" },
  medium:{ action:"生成草稿，必须人工确认", sendPolicy:"human_confirm" },
  low:{ action:"可生成服务型回复，仍需二次安全扫描", sendPolicy:"guarded_auto_or_confirm" }
};
const OLD_SCRIPT_DEFAULTS = {
  code101:"发送 101 后，医助会发送医生春雨主页/咨询入口。请选择适合的问诊方式。",
  code303:"发送 303 后，医助会回复医院挂号通道、出诊时间与就诊地点。",
  transferHuman:"您的情况需要医助进一步确认，我已为您转人工，请稍等。",
  emergency:"如症状紧急或持续加重，请立即到线下急诊/正规医院就诊，必要时拨打 120。",
  nonText:"图片或文件内容暂由医助人工查看处理，请稍等。",
  voice:"语音内容暂时无法稳定自动识别，请补充文字描述；医助也会人工查看。",
  memberVisit:"【新患者到访 · 仅供医助关注，无需发送】{patient} 首次在群内发言，已自动发送入群欢迎。建议：确认身份、备注为「姓名+疾病」，并留意其后续咨询。"
};
const CURRENT_SCRIPT_DEFAULTS = {
  code101:"我收到您的咨询需求了。发送 101 后，我会把医生春雨主页/咨询入口发给您，您可以在里面选择图文、电话、视频或预约就诊等合适方式；涉及具体病情时，也会由医助继续跟进，不会把您落下。",
  code303:"我来帮您看挂号和出诊相关入口。发送 303 后，医助会回复医院挂号通道、出诊时间与就诊地点；如果页面信息不够明确，也可以继续在群里说明，我会转医助帮您确认。",
  transferHuman:"您的情况我已经收到，涉及具体病情判断，需要医助进一步确认。我先帮您转人工，请稍等一下；如果症状持续加重，请优先线下就医。",
  emergency:"您描述的情况可能需要尽快由线下医生判断。为安全起见，请不要只在群里等待回复；如症状紧急或持续加重，请立即到线下急诊/正规医院就诊，必要时拨打 120。医助也会继续关注这条消息。",
  nonText:"您发来的图片/资料我已经收到。图片内容需要医助人工查看，我会帮您转给医助跟进；如果方便，也请补充一句文字说明您最想咨询的问题，这样处理会更快。",
  voice:"不好意思，您的语音我这边暂时没能听清/稳定识别。为了不漏掉您的情况，麻烦您用文字简单补充一下；如果不方便打字，我也会帮您转医助人工查看。",
  memberVisit:"【新患者到访 · 仅供医助关注，无需发送】{patient} 首次在群内发言，系统已发送入群欢迎。建议医助关注后续消息，必要时确认身份、备注为「姓名+疾病」，并主动引导 101 咨询/303 挂号等入口。"
};
const LEGACY_LV_DOCX_SCRIPT_DEFAULTS = {
  code101:"为保护您的隐私，关于您的问题请通过下方链接 1对1 咨询医生，医生利用空闲时间回复，请耐心等待。感谢您的理解和配合[玫瑰][玫瑰]。\n🌻 紧急情况，请及时到医院就诊。",
  code102:"为保护您的隐私，关于您的问题请通过下方链接 1对1 咨询医生，医生利用空闲时间回复，请耐心等待。感谢您的理解和配合[玫瑰][玫瑰]。\n🌻 紧急情况，请及时到医院就诊。",
  code818:"🌻 感谢您转发海报，让更多患者获得主任的帮助\n👉🏻 转发方法：只需1步，保存图片，并转发到朋友圈"
};
function normalizeWelcomeScriptText(v){
  let s = String(v || "");
  if(!s) return s;
  s = s.replace(/（群名待甲方确认）|\(群名待甲方确认\)/g, "");
  s = s.replace(/复杂情况再转人工[\/／]医生确认/g, "复杂情况再找医生确认");
  s = s.replace(/会转人工处理/g, "会找医生确认");
  s = s.replace(/转人工/g, "找医生");
  s = s.replace(/呕血、黑便、/g, "呕血、");
  s = s.replace(/、黑便/g, "");
  s = s.replace(/发送 3 查看/g, "发送 1 查看");
  s = s.replace(/发 3 看/g, "发 1 看");
  s = s.replace(/数字[「“"]3[」”"]/g, "数字「1」");
  return s;
}
function upgradeDefaultOpsConfigValues(domain, cfg, def){
  let changed = false;
  if(!cfg || typeof cfg !== "object" || Array.isArray(cfg)) return { cfg:def, changed:true };
  if(domain === "prompts"){
    [OLD_PROMPT_DEFAULTS, PRE_AGENT_PROMPT_DEFAULTS, PERSONA_PROMPT_DEFAULTS].forEach(defaults=>{
      Object.keys(defaults).forEach(k=>{
        if(cfg[k] === defaults[k] && def[k]){
          cfg[k] = def[k];
          changed = true;
        }
      });
    });
    // 语义升级：仍是旧单轴口径、未写入两轴关键词的，对齐到 Agent 默认
    if(typeof cfg.riskAssessment === "string" && def.riskAssessment
      && /只做预分诊|已经认真看到/.test(cfg.riskAssessment)
      && !/先半句接住/.test(cfg.riskAssessment)){
      cfg.riskAssessment = def.riskAssessment;
      changed = true;
    }
    if(typeof cfg.lowRiskReply === "string" && def.lowRiskReply
      && !/50–120|50-120/.test(cfg.lowRiskReply)
      && (/先一句接住|优先引导发送[「"]?101|引导对应编号|自然语言说明下一步/.test(cfg.lowRiskReply))){
      cfg.lowRiskReply = def.lowRiskReply;
      changed = true;
    }
    if(typeof cfg.intentRecognition === "string" && def.intentRecognition
      && /识别编号、挂号|识别咨询、挂号/.test(cfg.intentRecognition)
      && !/不让患者觉得被机器打发/.test(cfg.intentRecognition)){
      cfg.intentRecognition = def.intentRecognition;
      changed = true;
    }
    ["personaHealthReport","personaCaseAnalysis","personaCarePlan","replySplitMinTotal","replySplitMaxBubble","replySplitDelayMs"].forEach(k=>{
      if(!cfg[k] && def[k]){
        cfg[k] = def[k];
        changed = true;
      }
    });
  }
  if(domain === "safety"){
    if(!cfg.levels || typeof cfg.levels !== "object"){
      cfg.levels = def.levels;
      changed = true;
    } else {
      ["high","medium","low"].forEach(k=>{
        const cur = cfg.levels[k] || {};
        const old = PRE_AGENT_SAFETY_LEVEL_DEFAULTS[k] || {};
        const next = (def.levels && def.levels[k]) || {};
        if(!cfg.levels[k]){
          cfg.levels[k] = next;
          changed = true;
          return;
        }
        const actionOld = cur.action === old.action;
        const policyOld = cur.sendPolicy === old.sendPolicy;
        if((actionOld || policyOld) && next.action){
          cfg.levels[k] = Object.assign({}, cur, next);
          changed = true;
        }
      });
    }
  }
  if(domain === "scripts"){
    if(typeof cfg.groupWelcome === "string"){
      const normalizedWelcome = normalizeWelcomeScriptText(cfg.groupWelcome);
      if(normalizedWelcome !== cfg.groupWelcome){
        cfg.groupWelcome = normalizedWelcome;
        changed = true;
      }
    }
    if(typeof cfg.groupWelcome === "string" &&
      /发送 1 查看全部功能；发送 101 获取医生咨询入口；出现胸痛、呼吸困难、呕血等紧急情况请立即线下就医或拨打 120。$/.test(cfg.groupWelcome) &&
      def.groupWelcome){
      cfg.groupWelcome = def.groupWelcome;
      changed = true;
    }
    if(typeof cfg.groupWelcome === "string" && /^您好，欢迎加入吕富靖主任/.test(String(def.groupWelcome || "")) &&
      /医生团队和医助共同维护|发送 101 向医生咨询|想了解挂号\/出诊时间/.test(cfg.groupWelcome)){
      cfg.groupWelcome = def.groupWelcome;
      changed = true;
    }
    Object.keys(def || {}).forEach(k=>{
      if(!(k in cfg)){
        cfg[k] = def[k];
        changed = true;
      }
    });
    [OLD_SCRIPT_DEFAULTS, CURRENT_SCRIPT_DEFAULTS, LEGACY_LV_DOCX_SCRIPT_DEFAULTS].forEach(defaults=>{
      Object.keys(defaults).forEach(k=>{
        if(cfg[k] === defaults[k] && def[k]){
          cfg[k] = def[k];
          changed = true;
        }
      });
    });
  }
  return { cfg, changed };
}
function maybeUpgradeOpsConfigDefaults(row, did){
  if(!row || !["prompts","scripts","safety"].includes(row.domain)) return row;
  const def = defaultOpsConfig(row.domain, did);
  const draft = upgradeDefaultOpsConfigValues(row.domain, parseConfigJson(row.draft_json, {}), def);
  const pub = upgradeDefaultOpsConfigValues(row.domain, parseConfigJson(row.published_json, {}), def);
  if(!draft.changed && !pub.changed) return row;
  const nowIso = now();
  const updated = opsMod.applyUpgradedDefaults(row, draft.cfg, pub.cfg, nowIso);
  configAudit(row.id, row.doctor_id, row.domain, "seed", "system", { upgradedDefaults:true }, { ok:true });
  return updated;
}
function configAudit(configId, did, domain, action, actor, snapshot, result){
  opsMod.recordAudit({
    configId, doctorId:did, domain, action, actor, snapshot, result, createdAt:now()
  });
  adminAudit(null, auditSessionForUsername(actor || "system"), {
    action:"config." + String(action || "update"),
    resourceType:"ops_config",
    resourceId:configId || null,
    doctorId:did || 0,
    outcome:result && result.ok === false ? "failed" : "success",
    after:snapshot,
    meta:{ domain, result }
  });
}
function ensureOpsConfig(domain, did){
  return opsMod.ensure({
    domain,
    doctorId: did,
    nowIso: now(),
    getDefault: defaultOpsConfig,
    upgradeDefaults: maybeUpgradeOpsConfigDefaults,
    onSeeded: (row, def)=> configAudit(row.id, row.doctor_id, row.domain, "seed", "system", def, { ok:true })
  });
}
function configOut(row, did, canEdit){
  const meta = configMeta(row.domain) || {};
  let draft = parseConfigJson(row.draft_json, {});
  let published = parseConfigJson(row.published_json, {});
  if(row.domain === "doctor_group"){
    const live = liveDoctorGroupConfig(did);
    const hasDraft = draft && typeof draft === "object" && (draft.groups || draft.doctor || draft.defaultNewGroup);
    if(!hasDraft) draft = live;
    published = live;
  }else if(row.domain === "codes_cards"){
    const live = defaultOpsConfig("codes_cards", did);
    const hasDraft = draft && typeof draft === "object" && Array.isArray(draft.codes);
    if(!hasDraft) draft = live;
    published = live;
  }
  return {
    id:row.id, doctorId:row.doctor_id, requestedDoctorId:did, domain:row.domain, title:row.title || meta.title || row.domain,
    desc:meta.desc || "", scope:row.scope || meta.scope || "doctor", superOnly:!!meta.superOnly, canEdit:!!canEdit,
    draft, published,
    publishedVersion:row.published_version||0, status:row.status, updatedBy:row.updated_by||"", updatedAt:row.updated_at||"",
    publishedBy:row.published_by||"", publishedAt:row.published_at||""
  };
}
function configAccess(req, res, id, action){
  const row = opsMod.getById(+id);
  const s = gate(req, res, row ? (row.doctor_id ? row.doctor_id : undefined) : null);
  if(!s) return {};
  if(!row){ json(res,404,{error:"配置不存在"}); return {}; }
  const meta = configMeta(row.domain);
  if(!meta){ json(res,400,{error:"未知配置域"}); return {}; }
  if(row.doctor_id === 0 && !configIsSuper(s)){ json(res,403,{error:"仅超级管理员可操作全局配置"}); return {}; }
  if(meta.superOnly && !configIsSuper(s)){ json(res,403,{error:"仅超级管理员可操作该配置"}); return {}; }
  if(action && !requireAdminAction(req,res,s,action,{doctorId:row.doctor_id || undefined}, action === "config.publish" ? "无发布运营配置权限" : "无保存运营配置草稿权限")) return {};
  return { row, s, meta };
}
function validateOpsConfig(domain, cfg){ return opsMod.validateOpsConfig(domain, cfg); }
function applyContactFormConfig(did, cfg){
  if(!cfg || typeof cfg !== "object") return;
  const content = doctorContent(did);
  const opts = Array.isArray(cfg.diseaseOptions) ? cfg.diseaseOptions.map((x) => String(x).trim()).filter(Boolean) : [];
  content.contactForm = {
    title: String(cfg.title || "医患通患者档案").trim(),
    desc: String(cfg.desc || "").trim(),
    fields: patientProfile.defaultContactProfileFields(opts.length ? opts : null),
    submitText: String(cfg.submitText || "提交建档").trim(),
    success: {
      title: String(cfg.successTitle || "已提交").trim(),
      desc: String(cfg.successDesc || "").trim()
    }
  };
  db.prepare("UPDATE doctors SET content=? WHERE id=?").run(JSON.stringify(content), +did);
}
function applyDoctorGroupConfig(did, cfg){
  if(!cfg || typeof cfg !== "object") return;
  const doctor = cfg.doctor || {};
  if(doctor.profile != null){
    const content = doctorContent(did);
    content.doctorProfile = content.doctorProfile || {};
    content.doctorProfile.intro = String(doctor.profile || "").trim();
    db.prepare("UPDATE doctors SET content=? WHERE id=?").run(JSON.stringify(content), +did);
  }
  const defaults = cfg.defaultNewGroup || {};
  if(defaults && typeof defaults === "object"){
    const content = doctorContent(did);
    content.defaultNewGroup = Object.assign({}, content.defaultNewGroup || {}, {
      welcomeEnabled: defaults.welcomeEnabled !== false,
      autoReplyEnabled: !!defaults.autoReplyEnabled,
      reviewMode: String(defaults.reviewMode || "human_review"),
      owner: String(defaults.owner || "医助运营")
    });
    db.prepare("UPDATE doctors SET content=? WHERE id=?").run(JSON.stringify(content), +did);
  }
  (cfg.groups || []).forEach(g=>{
    const gid = +g.id;
    if(!gid) return;
    const row = require("./modules/community/repo.js").getGroupById(gid);
    if(!row || +row.doctor_id !== +did) return;
    require("./modules/community/repo.js").setWelcomeFlags(gid, {
      welcomeEnabled: g.welcomeEnabled !== false,
      autoReplyEnabled: !!g.autoReplyEnabled,
      reviewMode: String(g.reviewMode || "human_review")
    });
  });
}
function applyCodesCardsConfig(did, cfg){
  if(!cfg || typeof cfg !== "object") return;
  const content = doctorContent(did);
  content.codesCardsFallback = Object.assign({}, content.codesCardsFallback || {}, cfg.fallback || {});
  db.prepare("UPDATE doctors SET content=? WHERE id=?").run(JSON.stringify(content), +did);
  const existing = db.prepare("SELECT id, code FROM rules WHERE doctor_id=?").all(+did);
  const byId = new Map(existing.map(r=>[+r.id, r.code]));
  const byCode = new Map(existing.map(r=>[String(r.code), +r.id]));
  (cfg.codes || []).forEach((c, idx)=>{
    const code = String(c.code || "").trim();
    if(!code) return;
    const aliases = JSON.stringify(Array.isArray(c.aliases) ? c.aliases : []);
    const responses = JSON.stringify(Array.isArray(c.responses) ? c.responses : []);
    const enabled = c.enabled === false ? 0 : 1;
    const sort = Number.isFinite(+c.sort) ? +c.sort : idx;
    const rid = +c.id;
    if(rid && byId.has(rid)){
      db.prepare("UPDATE rules SET code=?,aliases=?,responses=?,enabled=?,sort=? WHERE id=? AND doctor_id=?")
        .run(code, aliases, responses, enabled, sort, rid, +did);
      return;
    }
    const byCodeId = byCode.get(code);
    if(byCodeId){
      db.prepare("UPDATE rules SET aliases=?,responses=?,enabled=?,sort=? WHERE id=? AND doctor_id=?")
        .run(aliases, responses, enabled, sort, byCodeId, +did);
      return;
    }
    db.prepare("INSERT INTO rules(doctor_id,code,aliases,match_type,bot,responses,enabled,sort) VALUES(?,?,?,?,?,?,?,?)")
      .run(+did, code, aliases, String(c.matchType || "exact"), String(c.bot || "小宝医助"), responses, enabled, sort);
  });
  (cfg.cards || []).forEach(card=>{
    const cid = +card.id;
    if(!cid) return;
    db.prepare("UPDATE qiwe_weapp_templates SET title=?, desc=? WHERE id=? AND doctor_id=?")
      .run(String(card.title || ""), String(card.desc || ""), cid, +did);
  });
}

/** 话术发布：若填写了医生主页短链，写入 content 并同步到本医生主页类 mp 卡（默认 101/102/301/909）。 */
function applyScriptsConfig(did, cfg){
  if(!cfg || typeof cfg !== "object") return;
  const shortLink = String(cfg.doctorHomeShortLink || "").trim();
  if(!shortLink) return;
  const content = doctorContent(did);
  const integ = Object.assign({}, content.chunyuIntegration || {});
  integ.doctorHomeShortLink = shortLink;
  if(!integ.defaultMiniProgram || typeof integ.defaultMiniProgram !== "object") integ.defaultMiniProgram = {};
  integ.defaultMiniProgram.shortLink = shortLink;
  const codes = Array.isArray(integ.homeMpCodes) && integ.homeMpCodes.length
    ? integ.homeMpCodes.map(String)
    : ["101", "102", "301", "909"];
  integ.homeMpCodes = codes;
  content.chunyuIntegration = integ;
  db.prepare("UPDATE doctors SET content=? WHERE id=?").run(JSON.stringify(content), +did);

  const scope = String((integ.defaultMiniProgram && integ.defaultMiniProgram.shortLinkScope) || "医生主页") ;
  codes.forEach(code=>{
    const row = db.prepare("SELECT id, responses FROM rules WHERE doctor_id=? AND code=?").get(+did, code);
    if(!row) return;
    let responses = [];
    try{ responses = JSON.parse(row.responses || "[]"); }catch(e){ responses = []; }
    let changed = false;
    responses = (Array.isArray(responses) ? responses : []).map(r=>{
      if(!r || typeof r !== "object") return r;
      const isMp = r.type === "mp" || (r.external && (r.external.mode === "mini_program" || r.external.shortLink));
      if(!isMp) return r;
      const external = Object.assign({}, r.external || {}, {
        shortLink,
        shortLinkScope: r.external && r.external.shortLinkScope ? r.external.shortLinkScope : scope,
        status: "short_link_ready",
        mode: r.external && r.external.mode ? r.external.mode : "mini_program"
      });
      changed = true;
      return Object.assign({}, r, { external });
    });
    if(changed){
      db.prepare("UPDATE rules SET responses=? WHERE id=? AND doctor_id=?").run(JSON.stringify(responses), row.id, +did);
    }
  });
  try{ require("./qiwe.js").syncWeappTemplatesFromRules(+did); }catch(e){}
}
function parseConfigBody(body){
  if(body && body.config && typeof body.config === "object" && !Array.isArray(body.config)) return body.config;
  if(typeof body.json === "string"){
    const v = JSON.parse(body.json);
    if(v && typeof v === "object" && !Array.isArray(v)) return v;
  }
  throw new Error("配置内容格式不正确");
}

/* 配置中心 → routes/config-center.js（ops 写路径归属 modules/ops） */
registerConfigCenterRoutes(route, {
  parseBody, json, gate, requireAdminAction, now,
  doctorRow, canAdmin, configIsSuper,
  opsMod, configOut, configAccess, configAudit,
  ensureOpsConfig, parseConfigBody,
  applyDoctorGroupConfig, applyContactFormConfig,
  applyCodesCardsConfig, applyScriptsConfig
});

/* 群功能编号总览：按医生聚合规则 + 话术摘要 + 企微原生卡状态 */
/* 运营台 group-codes / ops-strategy → routes/ops-desk.js */
registerOpsDeskRoutes(route, {
  parseBody, json, gate, requireAdminAction,
  db, now, cleanText,
  doctorRow, doctorContent, parseConfigJson, opsMod,
  ensureOpsAssets, knowledgeOut, outcomeOut,
  opsStrategyDefaults, opsMetricsHint
});

/* 内容台 rules/FAQ/提交/统计/知识/效果 → routes/content-admin.js */
registerContentAdminRoutes(route, {
  parseBody, json, gate, rowDoctorId, requireAdminAction,
  db, now, adminScope, cleanText, cleanInt, doctorRow,
  KNOWLEDGE_LAYERS, KNOWLEDGE_MODES, KNOWLEDGE_STATUS,
  validateKnowledgeQuality, importMissingKnowledgeLayers, triage
});
/* 编号与推送 outbound 素材/触发 → routes/outbound-admin.js */
registerOutboundAdminRoutes(route, {
  parseBody, json, gate, rowDoctorId, requireAdminAction
});
registerServicePackageAdminRoutes(route, {
  parseBody, json, gate, requireAdminAction, db,
});

/* AI 分诊台 → routes/triage-admin.js */
registerTriageAdminRoutes(route, {
  parseBody, json, gate, rowDoctorId, requireAdminAction, db, adminScope, now,
  triage, community, outboxMod, decisionDoctorId, auditRequestId, adminAudit, adminAuditBestEffort, auditOutboxSnapshot,
  auditDecisionSnapshot, auditText, triageSessionDeliveryTarget
});

/* Agent 群聊沙盒 → routes/agent-sandbox-admin.js */
registerAgentSandboxAdminRoutes(route, { parseBody, json, gate });

/* 消息工作台 → routes/messages-admin.js */
registerMessagesAdminRoutes(route, {
  parseBody, json, gate, rowDoctorId, requireAdminAction, db, adminScope, now,
  hydrateAdminMessageRow, maskPII, triage, outboxMod, qiweBridge, friendlyPatientLabel,
  authed, allowDoctor, decorateAdminPatient, gateMessageLog
});


/* [v2.1] 医生待处理通知列表 */
/* doctor-notifications 已并入 routes/messages-admin.js */

/* [v2.1] 记录全量消息（内部调用） */
function logMessage(opts){
  try {
    db.prepare(`INSERT INTO message_log(doctor_id,patient_id,patient_name,sender_id,channel,direction,text,level,level_label,action_taken,ai_draft,triage_session_id,group_id,reply_status)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      opts.doctorId, opts.patientId||null, opts.patientName||null, opts.senderId||null,
      opts.channel||"qiwe", opts.direction||"inbound", opts.text||"",
      opts.level||4, opts.levelLabel||"", opts.action||"",
      opts.aiDraft||null, opts.triageSessionId||null, opts.groupId||null,
      opts.replyStatus||"pending"
    );
  } catch(e){ console.error("[logMessage]", e.message); }
}

/* ---------- 静态文件 ---------- */
function serveStatic(req,res){
  let p;
  try{ p = decodeURIComponent(req.url.split("?")[0]); }
  catch(e){ return send(res,400,"bad request","text/plain; charset=utf-8"); } // 畸形 % 转义 → decodeURIComponent 抛 URIError
  if(p.indexOf("\0") !== -1) return send(res,400,"bad request","text/plain; charset=utf-8"); // 路径含 null 字节 → fs.readFile 会同步抛错
  if(p==="/") p="/index.html";
  // 新医助后台（Art Design Pro 套壳）：/admin → admin-v2；旧版兜底 /admin-legacy
  if(p==="/admin"||p==="/admin/") p="/admin-v2/index.html";
  if(p==="/admin-legacy"||p==="/admin-legacy/") p="/admin-legacy.html";
  if(p==="/admin-v2"||p==="/admin-v2/") p="/admin-v2/index.html";
  if(p==="/wecom/sidebar"||p==="/wecom/sidebar/") p="/wecom-sidebar.html";
  const file = path.join(PUB, path.normalize(p));
  if(!file.startsWith(PUB)) return send(res,403,"forbidden","text/plain");
  const ext = path.extname(file).toLowerCase();
  const type = MIME[ext] || "application/octet-stream";
  const cache = staticCacheHeaders(p);
  const wantsGzip = /\bgzip\b/.test(String(req.headers["accept-encoding"] || ""));
  const trySend = (absPath, payload, hdrs)=>{
    send(res,200,payload,type,hdrs);
  };
  const readUncompressed = ()=>{
    fs.readFile(file,(err,data)=>{
      // SPA hash 模式下仅需 index；若日后切 history，未命中资源回落 index.html
      if(err && p.startsWith("/admin-v2/") && !path.extname(p)){
        return fs.readFile(path.join(PUB,"admin-v2","index.html"),(e2,d2)=>{
          if(e2) return send(res,404,"404 Not Found","text/plain; charset=utf-8");
          send(res,200,d2, MIME[".html"], staticCacheHeaders("/admin-v2/index.html"));
        });
      }
      if(err) return send(res,404,"404 Not Found","text/plain; charset=utf-8");
      trySend(file, data, cache);
    });
  };
  if(wantsGzip && STATIC_GZ_EXT.has(ext)){
    const gzPath = file + ".gz";
    return fs.readFile(gzPath,(gzErr,gzData)=>{
      if(gzErr) return readUncompressed();
      trySend(gzPath, gzData, Object.assign({}, cache, {
        "Content-Encoding":"gzip",
        "Vary":"Accept-Encoding"
      }));
    });
  }
  readUncompressed();
}

/* ---------- 主处理 ---------- */
// 日志/回显脱敏：qiwe 回调的 URL 令牌即回调密钥，绝不进日志或错误响应——只对 /api/qiwe/callback 前缀生效（不影响其他路由排障）。
function redactQiweUrl(u){
  const s = String(u || "");
  if(!s.startsWith("/api/qiwe/callback")) return s;
  return s.replace(/^(\/api\/qiwe\/callback)\/[^/?#]+/, "$1/<token>").replace(/([?&]t=)[^&#]*/g, "$1<token>");
}
const server = http.createServer(async (req,res)=>{
  try{
    const u = new URL(req.url, "http://localhost");
    const q = Object.fromEntries(u.searchParams);
    // 建档邀请短链 → 患者 H5 问卷页
    // 注意：公网 Nginx 把 `/` 给了营销站 chunyu-site，不能再 302 到 `/?p=invite`。
    // 落到 `/p/` 前缀（由 Nginx 整段反代到本服务），相对静态资源 app.css / src/* 才能一并命中。
    const invitePath = u.pathname.match(/^\/i\/([A-Za-z0-9_-]+)\/?$/);
    if(invitePath && (req.method === "GET" || req.method === "HEAD")){
      const loc = "/p/?p=invite&t=" + encodeURIComponent(invitePath[1]);
      res.writeHead(302, { Location: loc, "Cache-Control": "no-store" });
      return res.end();
    }
    // 患者 H5 挂载前缀：/p 与 /p/* → 剥前缀后走静态（与营销站根路径隔离）
    if((u.pathname === "/p" || u.pathname.startsWith("/p/")) && (req.method === "GET" || req.method === "HEAD")){
      const rest = u.pathname === "/p" || u.pathname === "/p/" ? "/" : u.pathname.slice(2);
      req.url = rest + (u.search || "");
      return serveStatic(req, res);
    }
    if(u.pathname.startsWith("/api/")){
      if(u.pathname.startsWith("/api/admin/") && !["GET","HEAD","OPTIONS"].includes(req.method) && !adminWriteOriginAllowed(req)){
        return json(res,403,{error:"后台写接口来源校验失败"});
      }
      const hit = routeIndex.match(req.method, u.pathname);
      if(hit){ await hit.entry.fn(req,res,hit.match,q); return; }
      return json(res,404,{error:"接口不存在: "+req.method+" "+redactQiweUrl(u.pathname)});
    }
    serveStatic(req,res);
  }catch(e){
    // 错误边界：任何路由（同步或异步）抛错都在此收口，返回 500 而非崩掉整个进程
    console.error("[request error]", req.method, redactQiweUrl(req.url), e && e.message);
    if(!res.headersSent){ try{ json(res,500,{error:"服务器内部错误"}); }catch(_){ try{ res.end(); }catch(__){} } }
    else { try{ res.end(); }catch(_){} }
  }
});

// 进程级最后兜底：漏网的异常/拒绝只记录、不退出，保证服务不被单个畸形请求打挂
process.on("uncaughtException", (e)=>console.error("[uncaughtException]", e && (e.stack||e.message||e)));
process.on("unhandledRejection", (e)=>console.error("[unhandledRejection]", e && (e.stack||e.message||e)));

// 仅作为主进程启动时才 listen / 起定时器（require.main 守卫）：让 server.js 可被测试文件 require 以取用其导出的纯函数（如 preserveBigIntIds），
//   而不触发监听端口/定时器副作用。生产/npm start 仍是 `node server.js`（require.main===module 恒真）→ listen 照常，行为零变化。零 require 依赖（无文件 require 本模块）。
/* Task 4 缺口：已有医生 content.contactForm 升级为医患通 11 项（保留疾病 options / 文案） */
function ensureContactProfileSchema(){
  const rows = db.prepare("SELECT id, content FROM doctors").all();
  const upd = db.prepare("UPDATE doctors SET content=? WHERE id=?");
  let migrated = 0;
  for(const row of rows){
    let content;
    try{ content = JSON.parse(row.content || "{}"); }catch(e){ content = {}; }
    if(!content || typeof content !== "object") content = {};
    const cf = content.contactForm && typeof content.contactForm === "object" ? content.contactForm : {};
    const fields = Array.isArray(cf.fields) ? cf.fields : [];
    const keys = new Set(fields.map(f=>f && f.key).filter(Boolean));
    // 2026-08-13：含 idNumber 的旧联络表需重写，去掉身份证号采集
    const needsMigrate = fields.length < 10
      || !keys.has("gender")
      || !keys.has("birthDate")
      || !keys.has("outpatientVoucher")
      || keys.has("idNumber");
    if(!needsMigrate) continue;

    let diseaseOptions = null;
    const oldDisease = fields.find(f=>f && (
      f.key === "disease"
      || f.label === "您所患的疾病"
      || f.label === "主要疾病"
      || f.key === "主要疾病"
    ));
    if(oldDisease && Array.isArray(oldDisease.options) && oldDisease.options.length){
      diseaseOptions = oldDisease.options.map(String);
    }

    content.contactForm = {
      title: cf.title || "医患通患者档案",
      desc: cf.desc || "提交基础信息建档（仅医生团队可见）",
      fields: patientProfile.defaultContactProfileFields(diseaseOptions),
      submitText: cf.submitText || "提交建档",
      success: cf.success || { title:"已提交", desc:"医助会联系您。" }
    };
    upd.run(JSON.stringify(content), row.id);
    migrated++;
  }
  return migrated;
}


if(require.main === module){
const shutdownTimeoutMs = Number(process.env.SHUTDOWN_TIMEOUT_MS) || 15000;
const gracefulShutdown = createGracefulShutdown({
  server,
  dispose: () => patientPublicLifecycle.dispose(),
  closeDb: () => {
    if(db && typeof db.close === "function") db.close();
  },
  timeoutMs: shutdownTimeoutMs,
  exit: (code) => process.exit(code),
  log: (...args) => console.error(...args)
});
process.once("SIGTERM", () => { void gracefulShutdown("SIGTERM"); });
process.once("SIGINT", () => { void gracefulShutdown("SIGINT"); });
server.listen(PORT, ()=>{
  try{
    const firstDoctor = db.prepare("SELECT id FROM doctors ORDER BY id LIMIT 1").get();
    const seedDid = firstDoctor && firstDoctor.id ? firstDoctor.id : 1;
    ensureOpsConfig("safety", seedDid);
    const docs = db.prepare("SELECT id FROM doctors").all();
    docs.forEach(d=>ensureOpsConfig("prompts", d.id));
    console.log("  [ops] safety/prompts 默认口径已与 Agent 两轴对齐检查");
  }catch(e){
    console.error("  [ops] 配置升级跳过", e && (e.message||e));
  }
  try{
    const n = ensureContactProfileSchema();
    if(n) console.log("  [profile] contactForm 已升级医生数:", n);
  }catch(e){
    console.error("  [profile] contactForm 升级跳过", e && (e.message||e));
  }
  console.log(`\n  医患通 · 本地全栈服务已启动`);
  console.log(`  患者端:  http://localhost:${PORT}/`);
  console.log(`  运营后台: http://localhost:${PORT}/admin   ${process.env.ADMIN_PASSWORD ? "(口令见 ADMIN_PASSWORD 环境变量)" : "(admin / admin888)"}`);
  console.log(`  旧版后台: http://localhost:${PORT}/admin-legacy`);
  if(!process.env.ADMIN_PASSWORD) console.log("  ⚠️  后台使用默认口令 admin888；上线前请设置环境变量 ADMIN_PASSWORD 修改");

const smsProvider = require("./sms_provider.js");
console.log(`  短信验证码: ${smsProvider.describeMode()}${SMS_DEMO ? "；演示响应可含明文 code" : ""}\n`);
});

// 周五定时群运营（默认关；WEEKLY_OPS_AUTO=1 才起）：每小时 tick → community.runWeeklyAuto 判周五/窗口/幂等 → 仅产 pending 草稿，绝不自动发。
// 进程级便利定时器，仅单进程 demo/小规模部署用；生产更稳 = 关掉它、用外部 cron 每周五定点打 POST /api/admin/community/campaigns/weekly。
if(process.env.WEEKLY_OPS_AUTO === "1"){
  try{ const gen = community.runWeeklyAuto(new Date()); if(gen.length) console.log("[weekly-auto] 启动生成", gen.length, "条周运营草稿"); }
  catch(e){ console.error("[weekly-auto]", e && e.message); }
  setInterval(()=>{ try{ community.runWeeklyAuto(new Date()); }catch(e){ console.error("[weekly-auto]", e && e.message); } }, 3600000);
  console.log("  周五群运营自动草稿: 已开启（每小时检查；仅产待审草稿，绝不自动发）");
}

// 科普提醒计划：默认开启（SCIENCE_REMINDER_AUTO=0 可关）；每分钟检查，仅生成 pending，绝不自动发。
if(process.env.SCIENCE_REMINDER_AUTO !== "0"){
  const tickScienceReminders = async ()=>{
    try{
      const generated = await community.scienceReminders.runScienceReminderTick(new Date());
      if(generated.length) console.log("[science-reminder] 生成", generated.length, "条");
    }catch(e){ console.error("[science-reminder]", e && e.message); }
  };
  void tickScienceReminders();
  setInterval(()=>{ void tickScienceReminders(); }, 60000);
  console.log("  科普提醒计划: 已开启（每分钟检查；仅产待审草稿，绝不自动发）");
}

// 视频号定时转发：只处理已由运营创建的单次任务；官方同步未配置时保持 fail-closed。
try{
  const videoChannels = require("./modules/video-channel/index.js").service;
  const tickVideoSchedules = ()=>videoChannels.runDueSchedules(new Date()).catch(e=>console.error("[video-channel-schedule]", e && e.message));
  void tickVideoSchedules();
  setInterval(()=>{ void tickVideoSchedules(); }, 60000);
}catch(e){ console.error("[video-channel] scheduler unavailable", e && e.message); }

// Agent 会话清理（10 分钟）：内存 Map 过期清理 + SQLite 过期清理，防长期运行内存/SQLite 膨胀。
// 默认内存 24h、DB 7 天，均可用环境变量覆盖；失败不影响主流程。
try{
  const agentSession = require("./agent/session.js");
  if(agentSession && typeof agentSession.purgeMemory === "function"){
    setInterval(()=>{
      try{
        const mem = agentSession.purgeMemory();
        const dbn = agentSession.purgeDatabase();
        if(mem || dbn) console.log(`[agent-session] 清理内存 ${mem} 条 / 数据库 ${dbn} 条`);
      }catch(e){
        console.error("[agent-session] 清理异常", e && e.message);
      }
    }, 600000);
    console.log("  Agent 会话自动清理: 已开启（10 分钟；内存默认 24h / 数据库默认 7 天）");
  }
}catch(e){
  console.error("[agent-session] 定时器初始化跳过", e && e.message);
}

// LLM 健康探针（5 分钟）：连续失败告警，避免 Agent 静默降级软模板无人察觉。
try{
  const { startLlmHealthCheck } = require("./llm_health.js");
  startLlmHealthCheck({});
}catch(e){
  console.error("[llm-health] 探针初始化跳过", e && e.message);
}
}  // ← require.main 守卫闭合

// 导出纯函数供测试（require 本模块不触发 listen，见上方 require.main 守卫）：preserveBigIntIds = qiwe 回调大整数 ID 保真。
module.exports = { preserveBigIntIds, runtimeHealth };
