"use strict";

/**
 * 患者端公开面路由（从 server.js 迁出）：
 * bootstrap / 微信 JS / 消息 / 短信 / 凭证 / 投稿 / 邀请建档 / 候补 / 我的回复 / 感谢 / 口碑
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const smsProvider = require("../sms_provider.js");
const mpAuth = require("../mp_auth.js");
const { createFixedWindowLimiter } = require("../rate_limit.js");
const { bearerToken, clientIp } = require("./mp-auth.js");
const { isProduction, preparePrivateUploadDirectory } = require("../mp_runtime_config.js");

const VOUCHER_UPLOAD_LIMIT = 10;
const VOUCHER_DOWNLOAD_LIMIT = 60;
const VOUCHER_MAX_BYTES = 4 * 1024 * 1024;
const VOUCHER_PENDING_MAX_AGE_MS = 15 * 60 * 1000;
const VOUCHER_UNCLAIMED_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const VOUCHER_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
const VOUCHER_CLEANUP_BATCH_SIZE = 100;

function resolvePrivateVoucherDirectory(){
  const prepared = preparePrivateUploadDirectory({
    env: process.env,
    appDir: path.join(__dirname, "..")
  });
  if(!prepared.ok) return null;
  return prepared.directory;
}

function privateVoucherDirectory(){
  const directory = resolvePrivateVoucherDirectory();
  if(!directory) throw new Error("private_upload_dir_unavailable");
  return directory;
}

function positiveInteger(value){
  if(typeof value === "number"){
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }
  if(typeof value !== "string" || !/^[1-9]\d*$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function strictBase64(value){
  const encoded = String(value || "");
  if(!encoded || encoded.length % 4 !== 0) return null;
  const firstPadding = encoded.indexOf("=");
  const dataEnd = firstPadding < 0 ? encoded.length : firstPadding;
  const paddingLength = encoded.length - dataEnd;
  if(paddingLength > 2) return null;
  for(let index = dataEnd; index < encoded.length; index += 1){
    if(encoded.charCodeAt(index) !== 61) return null;
  }
  for(let index = 0; index < dataEnd; index += 1){
    const code = encoded.charCodeAt(index);
    const allowed = (code >= 48 && code <= 57)
      || (code >= 65 && code <= 90)
      || (code >= 97 && code <= 122)
      || code === 43
      || code === 47;
    if(!allowed) return null;
  }
  const decoded = Buffer.from(encoded, "base64");
  return decoded.toString("base64") === encoded ? decoded : null;
}

function detectedVoucherMime(buffer){
  if(buffer.length >= 3
    && buffer[0] === 0xff
    && buffer[1] === 0xd8
    && buffer[2] === 0xff){
    return "image/jpeg";
  }
  const pngSignature = Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]);
  if(buffer.length >= pngSignature.length
    && buffer.subarray(0, pngSignature.length).equals(pngSignature)){
    return "image/png";
  }
  if(buffer.length >= 12
    && buffer.subarray(0, 4).toString("ascii") === "RIFF"
    && buffer.subarray(8, 12).toString("ascii") === "WEBP"){
    return "image/webp";
  }
  if(buffer.length >= 5 && buffer.subarray(0, 5).toString("ascii") === "%PDF-"){
    return "application/pdf";
  }
  return "";
}

function parseVoucherDataUrl(value){
  if(typeof value !== "string") return null;
  const match = value.match(
    /^data:(image\/jpeg|image\/png|image\/webp|application\/pdf);base64,([A-Za-z0-9+/=]+)$/
  );
  if(!match) return null;
  const buffer = strictBase64(match[2]);
  if(!buffer) return null;
  const mime = detectedVoucherMime(buffer);
  if(!mime || mime !== match[1]) return null;
  return { buffer, mime };
}

function voucherExtension(mime){
  if(mime === "image/jpeg") return "jpg";
  if(mime === "image/png") return "png";
  if(mime === "image/webp") return "webp";
  return "pdf";
}

function safeOriginalName(value){
  const raw = String(value || "").replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if(!raw) return null;
  return path.basename(raw).slice(0, 255) || null;
}

function voucherAuthorizationHeader(req){
  const headers = (req && req.headers) || {};
  return String(headers.authorization || headers.Authorization || "").trim();
}

function hasAuthorizationHeader(req){
  const headers = (req && req.headers) || {};
  return Object.keys(headers).some((name) => name.toLowerCase() === "authorization");
}

function uploadRateKey(req, token){
  const tokenDigest = crypto.createHash("sha256").update(String(token)).digest("hex");
  return tokenDigest + "|" + clientIp(req);
}

function downloadRateKey(req, identity){
  const identityDigest = crypto.createHash("sha256")
    .update(String(identity || ""))
    .digest("hex");
  return identityDigest + "|" + clientIp(req);
}

function currentStoredSession(db, token){
  const row = db.prepare(`SELECT * FROM mp_sessions
    WHERE token=? AND revoked_at IS NULL
      AND token=(
        SELECT token FROM mp_sessions AS latest
        WHERE latest.openid=mp_sessions.openid AND latest.revoked_at IS NULL
        ORDER BY latest.created_at DESC, latest.rowid DESC
        LIMIT 1
      )`).get(String(token || ""));
  if(!row) return null;
  const expiresAt = Date.parse(String(row.expires_at || ""));
  return Number.isFinite(expiresAt) && expiresAt > Date.now() ? row : null;
}

async function safeUnlink(file, logContext = "[patient/voucher-upload]"){
  if(!file) return true;
  try{
    await fs.promises.unlink(file);
    return true;
  }catch(error){
    if(error && error.code === "ENOENT") return true;
    console.error(`${logContext} cleanup_failed`);
    return false;
  }
}

function pathInsideDirectory(directory, candidate){
  const root = path.resolve(directory);
  const resolved = path.resolve(root, candidate);
  return resolved !== root && resolved.startsWith(root + path.sep)
    ? resolved
    : "";
}

function pendingVoucherTempPath(directory, storageName){
  return pathInsideDirectory(directory, `.${String(storageName || "")}.tmp`);
}

async function recoverStaleVoucherUploads(db, options = {}){
  const nowFn = typeof options.now === "function" ? options.now : Date.now;
  const pendingMaxAgeMs = Number.isFinite(+options.maxAgeMs) && +options.maxAgeMs > 0
    ? +options.maxAgeMs
    : VOUCHER_PENDING_MAX_AGE_MS;
  const unclaimedMaxAgeMs = Number.isFinite(+options.unclaimedMaxAgeMs)
    && +options.unclaimedMaxAgeMs > 0
    ? +options.unclaimedMaxAgeMs
    : VOUCHER_UNCLAIMED_MAX_AGE_MS;
  const directory = options.directory || privateVoucherDirectory();
  const nowMs = Number(nowFn());
  const batchSize = Math.min(
    Number.isInteger(+options.batchSize) && +options.batchSize > 0
      ? +options.batchSize
      : VOUCHER_CLEANUP_BATCH_SIZE,
    VOUCHER_CLEANUP_BATCH_SIZE
  );
  const pendingCutoff = new Date(nowMs - pendingMaxAgeMs).toISOString();
  const unclaimedCutoff = new Date(nowMs - unclaimedMaxAgeMs).toISOString();
  const candidates = db.prepare(
    `SELECT id,storage_name,created_at,state,claimed_at
     FROM mp_private_files
     WHERE claimed_at LIKE 'cleanup:%'
       OR (
         claimed_at IS NULL
         AND (
           (state='pending' AND (
             created_at<=? OR julianday(created_at) IS NULL
           ))
           OR
           (state='ready' AND (
             created_at<=? OR julianday(created_at) IS NULL
           ))
         )
       )
     ORDER BY created_at ASC,id ASC
     LIMIT ?`
  ).all(pendingCutoff, unclaimedCutoff, batchSize);
  for(const file of candidates){
    const reserved = String(file.claimed_at || "").startsWith("cleanup:");
    const cleanupMarker = reserved
      ? String(file.claimed_at)
      : `cleanup:${new Date(nowMs).toISOString()}`;
    if(!reserved){
      const reservation = db.prepare(`UPDATE mp_private_files
        SET claimed_at=?
        WHERE id=? AND state=? AND claimed_at IS NULL`
      ).run(cleanupMarker, file.id, file.state);
      if(reservation.changes !== 1) continue;
    }
    const finalPath = pathInsideDirectory(directory, String(file.storage_name || ""));
    const tempPath = pendingVoucherTempPath(directory, file.storage_name);
    const tempDeleted = await safeUnlink(
      tempPath,
      "[patient/voucher-recovery]"
    );
    const finalDeleted = await safeUnlink(
      finalPath,
      "[patient/voucher-recovery]"
    );
    if(tempDeleted && finalDeleted){
      db.prepare("DELETE FROM mp_private_files WHERE id=? AND claimed_at=?")
        .run(file.id, cleanupMarker);
    }else{
      db.prepare(`UPDATE mp_private_files SET claimed_at=NULL
        WHERE id=? AND claimed_at=?`
      ).run(file.id, cleanupMarker);
    }
  }
}

function createInviteProofStore(options = {}){
  const ttlMs = Number.isFinite(+options.ttlMs) && +options.ttlMs > 0
    ? +options.ttlMs
    : 5 * 60 * 1000;
  const maxEntries = Number.isInteger(+options.maxEntries) && +options.maxEntries > 0
    ? +options.maxEntries
    : 5000;
  const nowFn = typeof options.now === "function" ? options.now : Date.now;
  const randomBytes = typeof options.randomBytes === "function"
    ? options.randomBytes
    : crypto.randomBytes;
  const proofs = new Map();

  function currentTime(){
    return Number(nowFn());
  }

  function normalizeBinding(binding){
    return {
      inviteToken:String((binding && binding.inviteToken) || ""),
      doctorId:+(binding && binding.doctorId),
      phone:String((binding && binding.phone) || "").trim()
    };
  }

  function cleanup(){
    const ts = currentTime();
    for(const [token, proof] of proofs){
      if(proof.expiresAt > ts) continue;
      proofs.delete(token);
    }
    while(proofs.size > maxEntries){
      const oldest = proofs.keys().next().value;
      if(oldest == null) break;
      proofs.delete(oldest);
    }
  }

  function matches(proof, binding){
    const expected = normalizeBinding(binding);
    return !!proof
      && proof.inviteToken === expected.inviteToken
      && proof.doctorId === expected.doctorId
      && proof.phone === expected.phone;
  }

  function issue(binding){
    cleanup();
    while(proofs.size >= maxEntries){
      const oldest = proofs.keys().next().value;
      if(oldest == null) break;
      proofs.delete(oldest);
    }
    let token;
    do{
      token = randomBytes(24).toString("base64url");
    }while(proofs.has(token));
    proofs.set(token, {
      ...normalizeBinding(binding),
      expiresAt:currentTime() + ttlMs
    });
    return token;
  }

  function validate(token, binding){
    cleanup();
    return matches(proofs.get(String(token || "").trim()), binding);
  }

  function consume(token, binding){
    const key = String(token || "").trim();
    if(!validate(key, binding)) return false;
    proofs.delete(key);
    return true;
  }

  const cleanupTimer = setInterval(cleanup, Math.min(ttlMs, 60 * 1000));
  if(cleanupTimer && typeof cleanupTimer.unref === "function") cleanupTimer.unref();

  function dispose(){
    clearInterval(cleanupTimer);
  }

  return { issue, validate, consume, dispose };
}

function registerPatientPublicRoutes(route, ctx){
  const {
    parseBody, json, gate, rowDoctorId, requireAdminAction,
    db, now,
    SMS_DEMO, MESSAGE_MAX_BODY,
    smsCodes, smsThrottle,
    isPhone, verifySms, contentForDoctor, hasContactFormForPhone,
    doctorOut, faqGrouped, wechatEnv, buildWechatJsConfig,
    cleanAttachments, patientFromRequest, patientReply,
    patientProfile, profileStore, resolvePatient,
    updatePersonIdentity, personIdForPatientId,
    inviteStore, patientInvite, patientSessionCookie,
    followup,
    SUBMIT_TYPES, SUBMIT_FORM_KEYS,
    submitWhitelistForType, maskPayloadExceptWhitelist, maskPII, maskPIIStrict
  } = ctx;
  const cryptoApi = crypto;
  const INVITE_PROOF_TTL_MS = 5 * 60 * 1000;
  const INVITE_PROOF_MAX = 5000;
  const inviteProofStore = createInviteProofStore({
    ttlMs:INVITE_PROOF_TTL_MS,
    maxEntries:INVITE_PROOF_MAX,
    now:Date.now,
    randomBytes:cryptoApi.randomBytes
  });
  const voucherUploadLimiter = createFixedWindowLimiter({
    limit:VOUCHER_UPLOAD_LIMIT,
    windowMs:60_000,
    maxKeys:10_000
  });
  const voucherDownloadLimiter = createFixedWindowLimiter({
    limit:VOUCHER_DOWNLOAD_LIMIT,
    windowMs:60_000,
    maxKeys:10_000
  });
  const voucherNow = typeof ctx.voucherNow === "function"
    ? ctx.voucherNow
    : Date.now;
  const voucherDirectory = resolvePrivateVoucherDirectory();
  const voucherRecoveryOptions = {
    now:voucherNow,
    maxAgeMs:ctx.voucherPendingMaxAgeMs,
    unclaimedMaxAgeMs:ctx.voucherUnclaimedMaxAgeMs,
    batchSize:VOUCHER_CLEANUP_BATCH_SIZE,
    directory:voucherDirectory || undefined
  };
  let voucherRecoveryInFlight = null;
  let voucherCleanupDisposed = false;
  function runVoucherRecovery(){
    if(voucherCleanupDisposed || !voucherDirectory) return Promise.resolve();
    if(voucherRecoveryInFlight) return voucherRecoveryInFlight;
    voucherRecoveryInFlight = recoverStaleVoucherUploads(
      db,
      voucherRecoveryOptions
    ).catch(()=>{
      console.error("[patient/voucher-recovery] recovery_failed");
    }).finally(()=>{
      voucherRecoveryInFlight = null;
    });
    return voucherRecoveryInFlight;
  }
  const voucherRecoveryPromise = runVoucherRecovery();
  const voucherCleanupIntervalMs = Number.isFinite(+ctx.voucherCleanupIntervalMs)
    && +ctx.voucherCleanupIntervalMs > 0
    ? +ctx.voucherCleanupIntervalMs
    : VOUCHER_CLEANUP_INTERVAL_MS;
  const voucherSetInterval = typeof ctx.voucherSetInterval === "function"
    ? ctx.voucherSetInterval
    : setInterval;
  const voucherClearInterval = typeof ctx.voucherClearInterval === "function"
    ? ctx.voucherClearInterval
    : clearInterval;
  const voucherCleanupTimer = voucherSetInterval(
    () => runVoucherRecovery(),
    voucherCleanupIntervalMs
  );
  if(voucherCleanupTimer && typeof voucherCleanupTimer.unref === "function"){
    voucherCleanupTimer.unref();
  }
  async function dispose(){
    if(voucherCleanupDisposed) return;
    voucherCleanupDisposed = true;
    voucherClearInterval(voucherCleanupTimer);
    inviteProofStore.dispose();
    if(voucherRecoveryInFlight) await voucherRecoveryInFlight;
  }

  /** 小程序已绑手机且号码一致时，视为已验证（免短信验证码） */
  function mpSessionVerifiedPhone(req, doctorId, phone){
    try{
      const { bearerToken } = require("./mp-auth.js");
      const mpAuth = require("../mp_auth.js");
      const tok = bearerToken(req);
      if(!tok) return null;
      const sess = mpAuth.requireBoundSession(tok, { doctorId });
      const person = db.prepare("SELECT phone, phone_verified FROM persons WHERE id=?").get(sess.person_id);
      if(!person || !person.phone_verified || !person.phone) return null;
      const submitted = String(phone || "").trim();
      if(submitted !== String(person.phone).trim()) return null;
      return {
        phone:submitted,
        source:"mp",
        doctorId:+sess.doctor_id,
        personId:+sess.person_id,
        patientId:+sess.patient_id
      };
    }catch(e){
      return null;
    }
  }

  /** 网页 psid 会话：已验证手机与提交号码一致时免短信 */
  function psidSessionVerifiedPhone(req, doctorId, phone){
    try{
      const sess = patientFromRequest(req, doctorId);
      if(!sess) return null;
      const row = db.prepare(`SELECT p.id,p.person_id,p.phone,p.phone_verified,
        per.phone AS person_phone,per.phone_verified AS person_verified
        FROM patients p LEFT JOIN persons per ON per.id=p.person_id
        WHERE p.id=? AND p.doctor_id=?`).get(sess.patientId, +doctorId);
      if(!row) return null;
      const verified = row.phone_verified === 1 || row.person_verified === 1;
      if(!verified) return null;
      const stored = String(row.phone || row.person_phone || "").trim();
      const submitted = String(phone || "").trim();
      if(!stored || stored !== submitted) return null;
      return {
        phone:submitted,
        source:"web",
        doctorId:+doctorId,
        personId:+row.person_id,
        patientId:+row.id
      };
    }catch(e){
      return null;
    }
  }

  function trustedPhoneVerification(req, doctorId, phone){
    return mpSessionVerifiedPhone(req, doctorId, phone)
      || psidSessionVerifiedPhone(req, doctorId, phone);
  }

  function requestCookie(req, name){
    const raw = String((req.headers && req.headers.cookie) || "");
    for(const part of raw.split(";")){
      const index = part.indexOf("=");
      if(index < 0) continue;
      if(part.slice(0, index).trim() !== name) continue;
      try{ return decodeURIComponent(part.slice(index + 1).trim()); }
      catch(_){ return ""; }
    }
    return "";
  }

  function inviteVerificationError(status, code){
    const error = new Error(code);
    error.status = status;
    error.code = code;
    return error;
  }

  function voucherValidationError(status, code){
    const error = new Error(code);
    error.status = status;
    error.code = code;
    return error;
  }

  function verifiedIdentityForPhone(doctorId, phone){
    const submitted = String(phone || "").trim();
    const person = db.prepare(
      `SELECT id FROM persons
       WHERE phone=? AND phone_verified=1
       ORDER BY id ASC LIMIT 1`
    ).get(submitted);
    if(!person) return null;
    const patient = db.prepare(
      `SELECT id,person_id FROM patients
       WHERE doctor_id=? AND person_id=?
       ORDER BY id ASC LIMIT 1`
    ).get(+doctorId, +person.id);
    if(!patient) return null;
    return {
      doctorId:+doctorId,
      personId:+patient.person_id,
      patientId:+patient.id
    };
  }

  function normalizedVoucherUrl(value){
    const url = String(value || "").trim();
    if(!url) return "";
    const match = url.match(/^\/api\/patient\/voucher\/([A-Za-z0-9_-]+)$/);
    if(!match) throw voucherValidationError(400, "invalid_voucher_url");
    return `/api/patient/voucher/${match[1]}`;
  }

  function readyVoucherForIdentity(value, identity){
    const url = normalizedVoucherUrl(value);
    if(!url) return { url:"", file:null };
    if(!identity
      || !positiveInteger(identity.doctorId)
      || !positiveInteger(identity.personId)
      || !positiveInteger(identity.patientId)){
      throw voucherValidationError(400, "voucher_unavailable");
    }
    const fileId = url.slice(url.lastIndexOf("/") + 1);
    const file = db.prepare(
      `SELECT * FROM mp_private_files
       WHERE id=? AND state='ready'
         AND (claimed_at IS NULL OR claimed_at NOT LIKE 'cleanup:%')`
    ).get(fileId);
    if(!file) throw voucherValidationError(400, "voucher_unavailable");
    const owned = +file.doctor_id === +identity.doctorId
      && +file.person_id === +identity.personId
      && +file.patient_id === +identity.patientId;
    if(!owned) throw voucherValidationError(403, "voucher_forbidden");
    return { url, file };
  }

  function claimVoucherForIdentity(voucher, identity){
    if(!voucher || !voucher.url || !voucher.file) return;
    const fileId = voucher.url.slice(voucher.url.lastIndexOf("/") + 1);
    const claimedAt = String(voucher.file.claimed_at || "");
    if(claimedAt && !claimedAt.startsWith("cleanup:")) return;
    const claimed = db.prepare(`UPDATE mp_private_files
      SET claimed_at=?
      WHERE id=? AND state='ready' AND claimed_at IS NULL
        AND doctor_id=? AND person_id=? AND patient_id=?`
    ).run(
      now(),
      fileId,
      +identity.doctorId,
      +identity.personId,
      +identity.patientId
    );
    if(claimed.changes === 1) return;
    const existing = db.prepare(`SELECT 1 FROM mp_private_files
      WHERE id=? AND state='ready'
        AND claimed_at IS NOT NULL
        AND claimed_at NOT LIKE 'cleanup:%'
        AND doctor_id=? AND person_id=? AND patient_id=?`
    ).get(
      fileId,
      +identity.doctorId,
      +identity.personId,
      +identity.patientId
    );
    if(!existing) throw voucherValidationError(400, "voucher_unavailable");
  }

  function precheckVoucherForUnverifiedPhone(value, identity){
    const url = normalizedVoucherUrl(value);
    if(!url) return "";
    if(!identity
      || !positiveInteger(identity.doctorId)
      || !positiveInteger(identity.personId)
      || !positiveInteger(identity.patientId)){
      throw voucherValidationError(400, "voucher_unavailable");
    }
    const fileId = url.slice(url.lastIndexOf("/") + 1);
    const match = db.prepare(`SELECT 1 FROM mp_private_files
      WHERE id=? AND state='ready'
        AND (claimed_at IS NULL OR claimed_at NOT LIKE 'cleanup:%')
        AND doctor_id=? AND person_id=? AND patient_id=?`
    ).get(
      fileId,
      +identity.doctorId,
      +identity.personId,
      +identity.patientId
    );
    if(!match) throw voucherValidationError(400, "voucher_unavailable");
    return url;
  }

  function smsCodeMatchesWithoutConsume(phone, code){
    if(!smsCodes || typeof smsCodes.get !== "function") return false;
    const record = smsCodes.get(String(phone || "").trim());
    if(!record || Number(record.expiresAt) <= Date.now()) return false;
    const expected = Buffer.from(String(record.code || ""));
    const provided = Buffer.from(String(code || "").trim());
    return expected.length > 0
      && expected.length === provided.length
      && cryptoApi.timingSafeEqual(expected, provided);
  }

  function inviteBearerVerifiedPhone(req, doctorId, phone){
    const submitted = String(phone || "").trim();
    const authHeader = String(
      (req.headers && (req.headers.authorization || req.headers.Authorization)) || ""
    );
    if(!/^\s*Bearer\b/i.test(authHeader)) return null;
    const { bearerToken } = require("./mp-auth.js");
    const mpAuth = require("../mp_auth.js");
    const token = bearerToken(req);
    if(!token) throw inviteVerificationError(401, "unauthorized");
    let session;
    try{ session = mpAuth.requireBoundSession(token, { doctorId }); }
    catch(error){
      if(error && error.message === "account_not_bound"){
        throw inviteVerificationError(401, "phone_verification_required");
      }
      throw inviteVerificationError(401, "unauthorized");
    }
    const person = db.prepare(
      "SELECT phone,phone_verified FROM persons WHERE id=?"
    ).get(session.person_id);
    if(!person || person.phone_verified !== 1 || !String(person.phone || "").trim()){
      throw inviteVerificationError(401, "phone_verification_required");
    }
    if(String(person.phone).trim() !== submitted){
      throw inviteVerificationError(403, "phone_mismatch");
    }
    return {
      source:"mp",
      doctorId:+session.doctor_id,
      personId:+session.person_id,
      patientId:+session.patient_id
    };
  }

  function createInviteVerificationProof(inviteToken, doctorId, phone){
    return inviteProofStore.issue({
      inviteToken:String(inviteToken || ""),
      doctorId:+doctorId,
      phone:String(phone || "").trim()
    });
  }

  function readInviteVerificationProof(proofToken, inviteToken, doctorId, phone){
    const token = String(proofToken || "").trim();
    if(!inviteProofStore.validate(token, {
      inviteToken,
      doctorId,
      phone
    })){
      throw inviteVerificationError(401, "phone_verification_required");
    }
    return token;
  }

  function consumeInviteVerificationProof(proofToken, inviteToken, doctorId, phone){
    return inviteProofStore.consume(proofToken, {
      inviteToken,
      doctorId,
      phone
    });
  }

  function inviteVerifiedPhone(req, doctorId, phone, smsCode, proofToken, inviteToken, bearerVerification, options){
    const submitted = String(phone || "").trim();
    const consumeSms = !options || options.consumeSms !== false;
    if(bearerVerification) return bearerVerification;

    if(String(proofToken || "").trim()){
      return {
        source:"proof",
        proofToken:readInviteVerificationProof(
          proofToken,
          inviteToken,
          doctorId,
          submitted
        )
      };
    }

    const psid = requestCookie(req, "psid");
    if(psid){
      const session = inviteStore.getSession(psid);
      if(session && +session.doctor_id === +doctorId){
        const row = db.prepare(`SELECT p.phone,p.phone_verified,
          per.phone AS person_phone,per.phone_verified AS person_verified
          FROM patients p LEFT JOIN persons per ON per.id=p.person_id
          WHERE p.id=? AND p.doctor_id=?`).get(session.patient_id, +doctorId);
        const patientMatches = !!(row && row.phone_verified === 1
          && String(row.phone || "").trim() === submitted);
        const personMatches = !!(row && row.person_verified === 1
          && String(row.person_phone || "").trim() === submitted);
        if(patientMatches || personMatches){
          if(consumeSms) inviteStore.touchSession(psid);
          return { source:"web" };
        }
      }
    }

    if(!String(smsCode || "").trim()){
      // 医助分享的 H5 建档链接：生产未接短信时允许仅格式校验落库（未验证手机号）。
      // 带 Bearer 的小程序通道仍走上方绑定校验；已配置短信时仍要求验证码。
      const authHeader = String(
        (req.headers && (req.headers.authorization || req.headers.Authorization)) || ""
      );
      if(!smsProvider.isConfigured() && !/^\s*Bearer\b/i.test(authHeader)){
        return { source:"invite_format", phoneVerified:false };
      }
      throw inviteVerificationError(401, "phone_verification_required");
    }
    if(!smsProvider.isConfigured()){
      throw inviteVerificationError(503, "sms_unavailable");
    }
    if(!consumeSms && smsCodeMatchesWithoutConsume(submitted, smsCode)){
      return { source:"sms_preview" };
    }
    let smsError;
    try{ smsError = verifySms(submitted, smsCode); }
    catch(error){
      const code = String((error && (error.code || error.message)) || "");
      if(code === "sms_not_configured" || code === "sms_not_wired" || code === "sms_unavailable"){
        throw inviteVerificationError(503, "sms_unavailable");
      }
      throw inviteVerificationError(400, "invalid_sms_code");
    }
    if(smsError){
      const code = String(smsError);
      if(code === "sms_not_configured" || code === "sms_not_wired" || code === "sms_unavailable"){
        throw inviteVerificationError(503, "sms_unavailable");
      }
      throw inviteVerificationError(400, "invalid_sms_code");
    }
    if(!consumeSms){
      console.error("[invite/submit] sms_preview_mismatch");
      throw inviteVerificationError(503, "sms_unavailable");
    }
    return { source:"sms" };
  }

  function assertInvitePhoneIdentity(patientId, phone){
    const row = db.prepare(`SELECT p.id,p.person_id,per.phone AS person_phone
      FROM patients p LEFT JOIN persons per ON per.id=p.person_id
      WHERE p.id=?`).get(Number(patientId));
    if(!row) throw inviteVerificationError(500, "server_error");
    const personPhone = String(row.person_phone || "").trim();
    if(personPhone && personPhone !== String(phone || "").trim()){
      throw inviteVerificationError(409, "phone_identity_conflict");
    }
    return row;
  }

  function markInvitePhoneVerified(patientId, phone, identity){
    const submitted = String(phone || "").trim();
    const ts = now();
    db.prepare(
      "UPDATE patients SET phone=?,phone_verified=1,updated_at=? WHERE id=?"
    ).run(submitted, ts, Number(patientId));
    if(identity && identity.person_id){
      db.prepare(`UPDATE persons SET
        phone=CASE WHEN phone IS NULL OR trim(phone)='' THEN ? ELSE phone END,
        phone_verified=1,updated_at=? WHERE id=?`
      ).run(submitted, ts, +identity.person_id);
    }
  }

  function runDbTransaction(fn){
    db.exec("BEGIN IMMEDIATE");
    try{
      const result = fn();
      db.exec("COMMIT");
      return result;
    }catch(error){
      try{ db.exec("ROLLBACK"); }catch(_){}
      throw error;
    }
  }

  function writeVoucherHealthRecord(doctorId, patientId, voucherUrl){
    if(!voucherUrl) return;
    const attachments = JSON.stringify([{ url:voucherUrl, name:"门诊凭证" }]);
    const ts = now();
    const personId = personIdForPatientId(patientId);
    const existing = personId
      ? db.prepare(
        `SELECT id FROM patient_health_records
         WHERE person_id=? AND doctor_id=? AND patient_id=? AND category=? AND title=?`
      ).get(personId, doctorId, patientId, "medical_certificate", "门诊凭证")
      : db.prepare(
        "SELECT id FROM patient_health_records WHERE patient_id=? AND doctor_id=? AND category=? AND title=?"
      ).get(patientId, doctorId, "medical_certificate", "门诊凭证");
    if(existing){
      db.prepare("UPDATE patient_health_records SET attachments=?, updated_at=? WHERE id=?")
        .run(attachments, ts, existing.id);
      return;
    }
    db.prepare(`INSERT INTO patient_health_records
      (doctor_id,patient_id,person_id,category,title,summary,recorded_at,extra,
       attachments,created_by,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      doctorId,
      patientId,
      personId,
      "medical_certificate",
      "门诊凭证",
      "",
      null,
      "{}",
      attachments,
      "patient",
      ts,
      ts
    );
  }

  function maskPhoneSimple(phone){
    const p = String(phone || "").trim();
    if(p.length < 7) return "***";
    return p.slice(0, 3) + "****" + p.slice(-4);
  }

  function resolvePatientSession(req, doctorId){
    const did = +doctorId;
    if(!did) return { phoneBound: false };
    try{
      const { bearerToken } = require("./mp-auth.js");
      const mpAuth = require("../mp_auth.js");
      const tok = bearerToken(req);
      if(tok){
        const sess = mpAuth.requireBoundSession(tok, { doctorId: did });
        if(sess){
          const person = db.prepare("SELECT phone, phone_verified FROM persons WHERE id=?").get(sess.person_id);
          if(person && person.phone_verified && person.phone){
            return {
              phoneBound: true,
              phoneMasked: maskPhoneSimple(person.phone),
              patientId: sess.patient_id != null ? +sess.patient_id : null,
              personId: +sess.person_id,
              source: "mp"
            };
          }
        }
      }
    }catch(e){}
    const sess = patientFromRequest(req, did);
    if(!sess) return { phoneBound: false };
    const row = db.prepare(`SELECT p.id, p.phone, p.phone_verified, per.phone AS person_phone, per.phone_verified AS person_verified
      FROM patients p LEFT JOIN persons per ON per.id=p.person_id
      WHERE p.id=? AND p.doctor_id=?`).get(sess.patientId, did);
    if(!row) return { phoneBound: false, patientId: sess.patientId, source: "web_session" };
    const verified = row.phone_verified === 1 || row.person_verified === 1;
    const phone = String(row.phone || row.person_phone || "").trim();
    return {
      phoneBound: !!(verified && phone),
      phoneMasked: phone ? maskPhoneSimple(phone) : null,
      patientId: +row.id,
      source: verified ? "web" : "web_session"
    };
  }

route("GET", /^\/api\/patient\/session$/, (req,res,m,q)=>{
  const doctorId = +(q.doctorId || 0);
  if(!doctorId) return json(res,400,{error:"缺少 doctorId"});
  if(!db.prepare("SELECT 1 FROM doctors WHERE id=?").get(doctorId)) return json(res,404,{error:"医生不存在"});
  json(res,200, resolvePatientSession(req, doctorId));
});

route("GET", /^\/api\/bootstrap$/, (req,res,m,q)=>{
  // 医生归属：邀请/显式 doctorId/群归属优先；不再依赖 doctors.active「上下线」
  let doc = null;
  if(q.doctorId){
    const requestedDoctorId = positiveInteger(q.doctorId);
    if(!requestedDoctorId){
      return json(res,400,{error:"invalid_doctor"});
    }
    doc = db.prepare("SELECT * FROM doctors WHERE id=?").get(requestedDoctorId);
    if(!doc) return json(res,404,{error:"doctor_unavailable"});
  }else if(q.groupId){
    const group = db.prepare("SELECT doctor_id FROM community_groups WHERE id=?").get(q.groupId);
    if(group && group.doctor_id){
      doc = db.prepare("SELECT * FROM doctors WHERE id=?").get(group.doctor_id);
    }
  }else if(q.t && inviteStore){
    // 建档邀请深链：bootstrap 必须跟邀请 token 绑定医生
    const link = inviteStore.getByToken(String(q.t || "").trim());
    if(link && link.doctor_id){
      doc = db.prepare("SELECT * FROM doctors WHERE id=?").get(link.doctor_id);
    }
  }
  if(!doc && q.lastDoctorId){
    const lastId = positiveInteger(q.lastDoctorId);
    if(lastId) doc = db.prepare("SELECT * FROM doctors WHERE id=?").get(lastId);
  }
  if(!doc) doc = q.doctor ? db.prepare("SELECT * FROM doctors WHERE slug=?").get(q.doctor) : null;
  if(!doc) doc = db.prepare("SELECT * FROM doctors ORDER BY id LIMIT 1").get();
  if(!doc) return json(res,404,{error:"无医生数据"});
  const content = JSON.parse(doc.content||"{}");
  const intro = JSON.parse(doc.intro||"{}");
  // 待办#8：报道仅暴露春雨域名条目（可贴图）；其它外链不出患者端。
  try{
    const scienceContent = require("../science_content.js");
    if(!content.doctorProfile || typeof content.doctorProfile !== "object") content.doctorProfile = {};
    content.doctorProfile.news = scienceContent.normalizeHomepageNews(content);
  }catch(e){}
  // 2026-08-13：患者端不下发身份证号字段（防旧 content 仍带 idNumber）
  try{
    const cf = content.contactForm;
    if(cf && Array.isArray(cf.fields)){
      cf.fields = cf.fields.filter((f)=>f && f.key !== "idNumber" && f.label !== "身份证号");
    }
  }catch(e){}
  const allDoctors = db.prepare("SELECT slug,name,title,hospital,dept,active FROM doctors ORDER BY id").all();
  json(res,200,{ doctor:doctorOut(doc), content, intro, faq:faqGrouped(doc.id),
    capabilities:{ smsAvailable:smsProvider.isConfigured() },
    menu:content.menu, quickKeywords:content.quickKeywords||[], doctors:allDoctors });
});

/* 微信开放标签 wx-open-launch-weapp：生产需公众号 JS 安全域名 + WECHAT_OA_APP_ID/SECRET */
route("GET", /^\/api\/wechat\/js-config$/, async (req,res,m,q)=>{
  const target = String(q.url || "").slice(0, 2048);
  if(!/^https?:\/\/[^#]+/i.test(target)) return json(res,400,{configured:false,error:"缺少合法 url"});
  if(!wechatEnv().appId || !wechatEnv().secret){
    return json(res,501,{configured:false,error:"缺少 WECHAT_OA_APP_ID / WECHAT_OA_APP_SECRET，不能生成微信 JS-SDK 签名"});
  }
  try{ json(res,200, await buildWechatJsConfig(target)); }
  catch(e){ json(res,502,{configured:false,error:e.message || "微信 JS-SDK 签名失败"}); }
});

/* 患者发消息 → 服务端引擎 */
route("POST", /^\/api\/message$/, async (req,res)=>{
  const b = await parseBody(req, MESSAGE_MAX_BODY);
  if(b.__oversize) return json(res,413,{error:"请求体过大（上限 6MB）"});
  let attachments = [];
  try{ attachments = cleanAttachments(b.attachments); }
  catch(e){ return json(res,400,{error:e.message}); }
  // 小程序已绑手机会话：合法 Bearer 优先挂正式 patient（咨询仍允许匿名，无 token 不拦）
  const { bearerToken } = require("./mp-auth.js");
  let mpSess = null;
  if(hasAuthorizationHeader(req)){
    try{
    const tok = bearerToken(req);
    if(!tok) return json(res,401,{error:"unauthorized"});
      mpSess = mpAuth.requireBoundSession(tok);
    }catch(error){
      if(error && (error.message === "account_not_bound" || error.message === "identity_mismatch")){
        return json(res,403,{error:"patient_binding_required"});
      }
      return json(res,401,{error:"unauthorized"});
    }
    const requestedDoctorId = positiveInteger(b.doctorId);
    if(!requestedDoctorId || requestedDoctorId !== positiveInteger(mpSess.doctor_id)){
      return json(res,403,{error:"doctor_mismatch"});
    }
    if(b.patientId != null && b.patientId !== ""){
      const requestedPatientId = positiveInteger(b.patientId);
      if(!requestedPatientId) return json(res,400,{error:"invalid_patient"});
      if(requestedPatientId !== positiveInteger(mpSess.patient_id)){
        return json(res,403,{error:"patient_mismatch"});
      }
    }
  }
  try{
    const serverSession = mpSess ? null : patientFromRequest(req, b.doctorId);
    const requestedDoctorId = positiveInteger(b.doctorId);
    const psidPatientId = serverSession
      && positiveInteger(serverSession.doctorId) === requestedDoctorId
      ? positiveInteger(serverSession.patientId)
      : null;
    const patientId = mpSess
      ? positiveInteger(mpSess.patient_id)
      : (psidPatientId || undefined);
    const patientKey = mpSess
      ? `mp-patient-${patientId}`
      : psidPatientId
        ? `psid-patient-${psidPatientId}`
        : `anonymous:${cryptoApi.randomBytes(24).toString("base64url")}`;
    json(res,200, await patientReply.buildPatientReply({
      doctorId:b.doctorId,
      text:b.text,
      attachments,
      patientName:b.patientName,
      patientKey,
      patientId,
      channel:b.channel,
      history:b.history
    }));
  }catch(e){
    json(res,e.status || 500,{error:e.message || "消息处理失败"});
  }
});

/* 短信验证码：生产经 sms_provider 发真短信；演示态(--demo)响应可含明文 code */
route("POST", /^\/api\/sms\/send$/, async (req,res)=>{
  const b = await parseBody(req);
  if(b.__oversize) return json(res,413,{error:"请求体过大（上限 1MB）"});
  const phone = String(b.phone||"").trim();
  if(!isPhone(phone)) return json(res,400,{error:"invalid_phone"});
  const lastAt = smsThrottle.get(phone);
  if(lastAt && Date.now()-lastAt < 30*1000){
    return json(res,429,{error:"sms_rate_limited"});
  }
  const code = String(100000 + cryptoApi.randomInt(900000));
  let sent;
  try{
    sent = await smsProvider.sendVerificationCode(phone, code);
  }catch(e){
    const status = e.code === "sms_not_configured" ? 503 : 502;
    const publicCode = status === 503 ? "sms_unavailable" : "sms_send_failed";
    console.error(
      "[sms/send]",
      phone.slice(0,3)+"****"+phone.slice(-4),
      e && /^[a-z][a-z0-9_]{0,63}$/.test(String(e.code || ""))
        ? e.code
        : "sms_send_failed"
    );
    return json(res, status, { error: publicCode });
  }
  smsCodes.set(phone, { code, expiresAt:Date.now()+5*60*1000, attempts:0, sentAt:Date.now() });
  smsThrottle.set(phone, Date.now());   // 节流独立记录：verifySms 在锁定/消费时会删 smsCodes，但不影响这里的 30s 限流
  const payload = { ok:true, expiresIn:300 };
  if(!isProduction(process.env)
    && SMS_DEMO
    && (sent.skipped || sent.provider === "demo" || sent.provider === "log")){
    payload.code = code;
    payload.demo = true;
  }
  json(res,200, payload);
});

/* 患者门诊凭证上传（联络表前置；JSON + dataUrl，对齐医助头像写入 uploads） */
route("POST", /^\/api\/patient\/voucher-upload$/, async (req,res)=>{
  if(!voucherDirectory){
    return json(res,503,{error:"private_upload_dir_unavailable"});
  }
  const token = bearerToken(req);
  if(!token) return json(res,401,{error:"unauthorized"});

  const storedSession = currentStoredSession(db, token);
  if(storedSession && (
    !storedSession.phone_bound
    || !positiveInteger(storedSession.doctor_id)
    || !positiveInteger(storedSession.person_id)
    || !positiveInteger(storedSession.patient_id)
  )){
    return json(res,403,{error:"patient_binding_required"});
  }

  let session;
  try{
    session = mpAuth.requireBoundSession(token);
  }catch(error){
    return json(res,401,{error:"unauthorized"});
  }
  let sessionDoctorId = positiveInteger(session.doctor_id);
  let sessionPersonId = positiveInteger(session.person_id);
  let sessionPatientId = positiveInteger(session.patient_id);
  if(!session.phone_bound || !sessionDoctorId || !sessionPersonId || !sessionPatientId){
    return json(res,403,{error:"patient_binding_required"});
  }

  await runVoucherRecovery();
  let body;
  try{
    body = await parseBody(req, MESSAGE_MAX_BODY);
  }catch(error){
    return json(res,400,{error:"invalid_voucher_file"});
  }
  if(!body || typeof body !== "object" || Array.isArray(body)){
    return json(res,400,{error:"invalid_voucher_file"});
  }
  if(body.__oversize) return json(res,413,{error:"voucher_too_large"});

  const doctorId = positiveInteger(body.doctorId);
  if(!doctorId) return json(res,400,{error:"invalid_doctor"});
  if(doctorId !== sessionDoctorId){
    return json(res,403,{error:"doctor_mismatch"});
  }

  try{
    session = mpAuth.requireBoundSession(token);
  }catch(error){
    return json(res,401,{error:"unauthorized"});
  }
  sessionDoctorId = positiveInteger(session.doctor_id);
  sessionPersonId = positiveInteger(session.person_id);
  sessionPatientId = positiveInteger(session.patient_id);
  if(doctorId !== sessionDoctorId){
    return json(res,403,{error:"doctor_mismatch"});
  }

  const rate = voucherUploadLimiter.consume(uploadRateKey(req, token));
  if(!rate.allowed){
    res.setHeader("Retry-After", String(rate.retryAfter));
    return json(res,429,{error:"rate_limited"});
  }

  const parsed = parseVoucherDataUrl(body.dataUrl);
  if(!parsed) return json(res,400,{error:"invalid_voucher_file"});
  if(parsed.buffer.length > VOUCHER_MAX_BYTES){
    return json(res,413,{error:"voucher_too_large"});
  }
  if(parsed.buffer.length < 1){
    return json(res,400,{error:"invalid_voucher_file"});
  }

  const directory = voucherRecoveryOptions.directory;
  const fileId = cryptoApi.randomBytes(18).toString("base64url");
  const extension = voucherExtension(parsed.mime);
  const storageName = `${fileId}.${extension}`;
  const finalPath = path.join(directory, storageName);
  const tempPath = pendingVoucherTempPath(directory, storageName);
  let transactionOpen = false;
  let metadataInserted = false;
  try{
    db.exec("BEGIN IMMEDIATE");
    transactionOpen = true;
    try{
      session = mpAuth.requireBoundSession(token);
    }catch(error){
      const unauthorized = new Error("unauthorized");
      unauthorized.voucherStatus = 401;
      throw unauthorized;
    }
    sessionDoctorId = positiveInteger(session.doctor_id);
    sessionPersonId = positiveInteger(session.person_id);
    sessionPatientId = positiveInteger(session.patient_id);
    if(doctorId !== sessionDoctorId){
      const mismatch = new Error("doctor_mismatch");
      mismatch.voucherStatus = 403;
      throw mismatch;
    }
    db.prepare(`INSERT INTO mp_private_files(
      id,doctor_id,person_id,patient_id,storage_name,original_name,mime,
      size_bytes,created_at,state
    ) VALUES(?,?,?,?,?,?,?,?,?,?)`).run(
      fileId,
      sessionDoctorId,
      sessionPersonId,
      sessionPatientId,
      storageName,
      safeOriginalName(body.originalName || body.fileName),
      parsed.mime,
      parsed.buffer.length,
      new Date(Number(voucherNow())).toISOString(),
      "pending"
    );
    db.exec("COMMIT");
    transactionOpen = false;
    metadataInserted = true;

    await fs.promises.mkdir(directory, { recursive:true, mode:0o700 });
    await fs.promises.writeFile(tempPath, parsed.buffer, {
      flag:"wx",
      mode:0o600
    });
    await fs.promises.rename(tempPath, finalPath);

    db.exec("BEGIN IMMEDIATE");
    transactionOpen = true;
    const ready = db.prepare(
      "UPDATE mp_private_files SET state='ready' WHERE id=? AND state='pending'"
    ).run(fileId);
    if(ready.changes !== 1) throw new Error("voucher_state_conflict");
    db.exec("COMMIT");
    transactionOpen = false;
  }catch(error){
    if(transactionOpen){
      try{ db.exec("ROLLBACK"); }catch(rollbackError){}
    }
    if(error && error.voucherStatus){
      return json(res,error.voucherStatus,{error:error.message});
    }
    const tempDeleted = await safeUnlink(tempPath);
    const finalDeleted = await safeUnlink(finalPath);
    if(metadataInserted && tempDeleted && finalDeleted){
      try{
        db.prepare("DELETE FROM mp_private_files WHERE id=?").run(fileId);
      }catch(cleanupError){
        console.error("[patient/voucher-upload] cleanup_failed");
      }
    }
    console.error("[patient/voucher-upload] upload_failed");
    return json(res,500,{error:"upload_failed"});
  }

  json(res,200,{
    ok:true,
    fileId,
    url:`/api/patient/voucher/${fileId}`,
    mime:parsed.mime
  });
});

route("GET", /^\/api\/patient\/voucher\/([A-Za-z0-9_-]+)$/, async (req,res,match)=>{
  const fileId = match && match[1] ? String(match[1]) : "";
  const authHeader = voucherAuthorizationHeader(req);
  let session = null;
  let downloadIdentity = "";
  if(authHeader){
    const token = bearerToken(req);
    if(!token) return json(res,401,{error:"unauthorized"});
    try{
      session = mpAuth.requireBoundSession(token);
    }catch(error){
      return json(res,401,{error:"unauthorized"});
    }
    downloadIdentity = "mp:" + token;
  }else{
    const adminSession = gate(req,res);
    if(!adminSession) return;
    const adminId = positiveInteger(adminSession.adminId || adminSession.id);
    const cookie = String((req.headers && req.headers.cookie) || "");
    downloadIdentity = adminId ? `admin:${adminId}` : `admin-cookie:${cookie}`;
  }

  await voucherRecoveryPromise;
  const rate = voucherDownloadLimiter.consume(
    downloadRateKey(req, downloadIdentity)
  );
  if(!rate.allowed){
    res.setHeader("Retry-After", String(rate.retryAfter));
    return json(res,429,{error:"rate_limited"});
  }

  const file = db.prepare(
    "SELECT * FROM mp_private_files WHERE id=? AND state='ready'"
  ).get(fileId);
  if(!file) return json(res,404,{error:"not_found"});

  if(session){
    const ownsFile = positiveInteger(session.doctor_id) === +file.doctor_id
      && positiveInteger(session.person_id) === +file.person_id
      && positiveInteger(session.patient_id) === +file.patient_id;
    if(!ownsFile) return json(res,403,{error:"forbidden"});
  }else if(!gate(req,res,+file.doctor_id)){
    return;
  }

  const directory = voucherRecoveryOptions.directory;
  const resolvedPath = pathInsideDirectory(directory, String(file.storage_name || ""));
  if(!resolvedPath) return json(res,500,{error:"file_unavailable"});

  let payload;
  try{
    const stat = await fs.promises.lstat(resolvedPath);
    if(!stat.isFile() || stat.isSymbolicLink()){
      return json(res,500,{error:"file_unavailable"});
    }
    payload = await fs.promises.readFile(resolvedPath);
  }catch(error){
    if(error && error.code === "ENOENT"){
      return json(res,404,{error:"not_found"});
    }
    console.error("[patient/voucher-read] file_unavailable");
    return json(res,500,{error:"file_unavailable"});
  }

  const extension = voucherExtension(file.mime);
  res.setHeader("Content-Type", file.mime);
  res.setHeader("Content-Length", String(payload.length));
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Disposition", `attachment; filename="voucher.${extension}"`);
  res.end(payload);
});

/* 患者提交表单（联络表/加号/住院/感谢信） */
route("POST", /^\/api\/submit$/, async (req,res)=>{
  const b = await parseBody(req);
  if(b.__oversize) return json(res,413,{error:"请求体过大（上限 1MB）"});
  if(!b.doctorId||!b.type) return json(res,400,{error:"缺少参数"});
  if(!SUBMIT_TYPES.has(b.type)) return json(res,400,{error:"不支持的提交类型"}); // 防止经 /api/submit 伪造口碑等受门控/系统内部类型
  const content = contentForDoctor(b.doctorId);
  if(!content) return json(res,404,{error:"医生不存在"});
  const payload = b.payload || {};

  // 服务端自写标志键（codex 第八轮 §2）：这些键的权威值由服务端生成，客户端传值无意义且不可信。
  // 先在验证链路里收集权威值，掩码之后覆写到存储副本上——客户端传的同名键值先被掩（防伪造系统键夹带 PII），再被服务端权威值覆盖。
  const serverAuthoredKeys = {};
  let contactExtracted = null; // 联络表建档：校验通过后的结构化档案，供落库/健康记录复用
  let contactPatientId = null;
  let contactVerifySource = null;
  let contactIdentity = null;
  let contactVoucherUrl = "";
  if(b.type === "联络表"){
    const phone = String(b.phone || payload["手机号"] || "").trim();
    if(!isPhone(phone)) return json(res,400,{error:"请输入正确手机号"});
    if(b.consent !== true) return json(res,400,{error:"请先阅读并同意用户协议与隐私政策"});
    // 2026-08-13：身份证号已下线，提交侧丢弃以免入库
    try{ delete payload["身份证号"]; delete payload.idNumber; }catch(e){}
    contactExtracted = patientProfile.extractProfileFromPayload(Object.assign({}, payload, {
      phone,
      outpatientVoucherUrl: b.outpatientVoucherUrl || payload.outpatientVoucherUrl || payload["请上传门诊凭证"] || ""
    }));
    const verrs = patientProfile.validateContactProfile(contactExtracted);
    if(verrs.length) return json(res,400,{ error:verrs[0] });

    const trusted = trustedPhoneVerification(req, b.doctorId, phone);
    try{
      if(trusted){
        contactVerifySource = trusted.source;
        contactIdentity = trusted;
        contactVoucherUrl = readyVoucherForIdentity(
          contactExtracted.outpatientVoucherUrl,
          contactIdentity
        ).url;
      }else{
        contactIdentity = verifiedIdentityForPhone(b.doctorId, phone);
        const requestedVoucherUrl = normalizedVoucherUrl(
          contactExtracted.outpatientVoucherUrl
        );
        if(requestedVoucherUrl && !smsCodeMatchesWithoutConsume(phone, b.code)){
          const smsError = verifySms(phone, b.code);
          if(smsError) return json(res,400,{error:smsError});
          console.error("[patient/submit] sms_preview_mismatch");
          return json(res,503,{error:"sms_unavailable"});
        }
        contactVoucherUrl = precheckVoucherForUnverifiedPhone(
          requestedVoucherUrl,
          contactIdentity
        );
        const smsError = verifySms(phone, b.code);
        if(smsError) return json(res,400,{error:smsError});
        contactVerifySource = "sms";
      }
      contactExtracted.outpatientVoucherUrl = contactVoucherUrl;
    }catch(error){
      return json(res, error.status || 500, {
        error:error.code || "server_error"
      });
    }
    // 快照用 label 键（兼容旧列表展示）+ outpatientVoucherUrl；多选保持对象，掩码白名单整值保留
    Object.assign(payload, {
      "姓名": contactExtracted.name,
      "性别": contactExtracted.gender,
      "出生日期": contactExtracted.birthDate,
      "手机号": contactExtracted.phone,
      "您所患的疾病": contactExtracted.disease,
      "主要疾病": contactExtracted.disease,
      "是否妊娠哺乳": contactExtracted.pregnancyStatus || "",
      "食物、接触物过敏": contactExtracted.foodContactAllergies,
      "药物过敏": contactExtracted.drugAllergies,
      "疾病史": contactExtracted.diseaseHistory,
      "血型": contactExtracted.bloodType || "",
      "身高": contactExtracted.heightCm || "",
      "体重": contactExtracted.weightKg || "",
      "健康备注": contactExtracted.healthNotes || "",
      "请上传门诊凭证": contactExtracted.outpatientVoucherUrl,
      outpatientVoucherUrl: contactExtracted.outpatientVoucherUrl
    });
    serverAuthoredKeys["手机号验证"] = contactVerifySource === "mp" ? "已验证(小程序)"
      : contactVerifySource === "web" ? "已验证(网页会话)"
      : "已验证";
    serverAuthoredKeys["敏感信息单独同意"] = now();
  }

  if(b.type === "加号"){
    const slot = String(b.date || payload["期望就诊日"] || "").trim();
    const addPhone = String(payload["手机号"] || payload.phone || "").trim();
    const an = content.addNumber || {};
    // 白名单收紧：仅允许医生 addNumber.date 字段配置的合法出诊档；直连接口绕过 UI select 传任意串/空串 → 400（等价补上 date required 强制）。
    // 向后兼容：未配置 date options 的医生（白名单为空）跳过校验，回落原行为，不误伤简化医生。
    const validSlots = ((an.fields||[]).find(f=>f && f.key==="date")||{}).options || [];
    if(validSlots.length && !validSlots.includes(slot)){   // 不加 slot && 守卫：空串/全空白(trim 后"")也不在 options → 被拦
      return json(res,400,{error:"请选择有效的就诊时段"});
    }
    const blocked = (an.unavailableSlots)||[];
    if(slot && blocked.includes(slot)){   // 黑名单 409 保留 slot && 守卫：空 slot 本就不该走候补
      return json(res,409,{error:"该门诊时段本周停诊/已约满，请选择其他就诊日", waitlistable:true, slot});
    }
    if(!isPhone(addPhone)) return json(res,400,{error:"请填写正确手机号"});
    if(!hasContactFormForPhone(b.doctorId, addPhone)){
      return json(res,400,{error:"请先提交医患联络表，完成基础信息建档后再申请加号", needsContactForm:true, nextPage:"contact-form"});
    }
  }
  // 建档延后到价值动作时刻：加号/住院在采集姓名手机的同时即时取得「单独同意」（PIPL）
  if(b.type === "加号" || b.type === "住院预约"){
    if(b.consent !== true) return json(res,400,{error:"请先阅读并同意信息处理告知"});
    serverAuthoredKeys["单独同意"] = now();
  }
  // PII 存储侧脱敏（生产DB架构 v1.0 §3-2，2026-07-04；codex FAIL 修 fail-closed 反转，第八轮按 type 收紧 + 自写键覆写）：
  // /api/submit 公开、payload 键名客户端任意 → 白名单外一切字符串/数字 PII 形态一律掩。白名单按 type 精确组装（submitWhitelistForType）：
  // 该 type 表单非 textarea 字段 label + 家庭代办四键（三 type 通用块）；不再全局拼系统键、story 只放行 name（不串味其它 type）。
  // 服务端自写标志键（手机号验证/敏感信息单独同意/单独同意）不进白名单——客户端传的同名键值先被掩（防伪造夹带 PII），
  // 再由服务端在掩码副本上覆写权威值。掩码只作用于存储副本，不改内存 payload（下方联络表建档/随访入组还读内存结构字段）。
  const submitWhitelist = submitWhitelistForType(b.type, (content[SUBMIT_FORM_KEYS[b.type]] || {}).fields);
  const storedPayload = maskPayloadExceptWhitelist(payload, submitWhitelist);
  Object.keys(serverAuthoredKeys).forEach(k=>{ storedPayload[k] = serverAuthoredKeys[k]; });   // 服务端权威值覆写掩码副本（客户端伪造的同名键值已在上一步被掩）
  let r;
  if(b.type === "联络表"){
    try{
      const contactResult = runDbTransaction(()=>{
        if(contactVoucherUrl){
          contactVoucherUrl = readyVoucherForIdentity(
            contactVoucherUrl,
            contactIdentity
          ).url;
        }
        const cfPhone = String(
          (contactExtracted && contactExtracted.phone)
          || b.phone
          || payload["手机号"]
          || ""
        ).trim();
        const cfName = String(
          (contactExtracted && contactExtracted.name)
          || payload["姓名"]
          || ""
        ).trim();
        const pid = contactVoucherUrl && contactIdentity
          ? +contactIdentity.patientId
          : resolvePatient({
            doctorId:b.doctorId,
            channel:"sms",
            externalId:"phone:"+cfPhone,
            phone:cfPhone,
            displayName:cfName,
            phoneVerified:true
          });
        if(!pid) throw new Error("patient_resolution_failed");

        const ex = contactExtracted || {};
        const rel = db.prepare("SELECT person_id FROM patients WHERE id=?").get(pid);
        if (rel && rel.person_id) {
          updatePersonIdentity(rel.person_id, {
            realName: cfName,
            gender: ex.gender,
            birthDate: ex.birthDate,
            phone: cfPhone
          });
        }
        db.prepare("UPDATE patients SET real_name=?, gender=?, birth_date=?, updated_at=? WHERE id=?")
          .run(cfName || null, ex.gender || null, ex.birthDate || null, now(), pid);
        profileStore.upsertFieldsInTransaction(b.doctorId, pid, {
          disease: ex.disease || "",
          pregnancyStatus: ex.pregnancyStatus || "",
          foodContactAllergies: ex.foodContactAllergies,
          drugAllergies: ex.drugAllergies,
          diseaseHistory: ex.diseaseHistory,
          ...patientProfile.extraProfileFields(ex)
        }, "patient", "patient");
        writeVoucherHealthRecord(b.doctorId, pid, contactVoucherUrl);
        const submission = db.prepare(
          "INSERT INTO submissions(doctor_id,type,payload,patient_id,created_at) VALUES(?,?,?,?,?)"
        ).run(
          b.doctorId,
          b.type,
          JSON.stringify(storedPayload),
          pid,
          now()
        );
        if(contactVoucherUrl){
          claimVoucherForIdentity(
            readyVoucherForIdentity(contactVoucherUrl, contactIdentity),
            contactIdentity
          );
        }
        return { patientId:pid, submission };
      });
      contactPatientId = contactResult.patientId;
      r = contactResult.submission;
    }catch(error){
      if(error && error.status && error.code){
        return json(res,error.status,{error:error.code});
      }
      console.error("[patient/submit] transaction_failed");
      return json(res,500,{error:"submit_failed"});
    }
  }else{
    r = db.prepare(
      "INSERT INTO submissions(doctor_id,type,payload,created_at) VALUES(?,?,?,?)"
    ).run(b.doctorId, b.type, JSON.stringify(storedPayload), now());
  }
  // 建档即入组：选了随访方案则自动加入对应 SOP（随访起算 = 手术/治疗日期，缺省为建档日）
  let enrolledPlan = null;
  if(b.type === "联络表"){
    const planName = payload["随访方案"];
    if(planName && planName !== "暂不需要" && followup.findPlan(b.doctorId, planName)){
      // 随访起算日期字段标签按医生 seed 而异（黄安华="手术/治疗日期"、吕富靖="检查/治疗日期"）；
      // payload 以字段 label 为键（patient.js 用 f.label），故两种 label 都兼容读取，避免改名后日期捕获不到。
      const fu = followup.enroll(b.doctorId, { name:payload["姓名"], phone:String(b.phone||payload["手机号"]||"").trim(), planKey:planName, enrolledAt:payload["手术/治疗日期"] || payload["检查/治疗日期"] });
      if(fu) enrolledPlan = planName;
    }
  }
  if(b.type === "联络表" && contactPatientId){
    const psid = inviteStore.createSession({ doctorId: b.doctorId, patientId: contactPatientId, ttlDays: 90 });
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Set-Cookie": patientSessionCookie(req, psid, 90 * 24 * 3600)
    });
    res.end(JSON.stringify({ ok:true, id:r.lastInsertRowid, enrolledPlan, patientId: contactPatientId, patientSessionSet: true }));
    return;
  }
  let chunyu = null;
  if (b.type === "加号" || b.type === "住院" || b.type === "住院预约") {
    try {
      const open = require("../chunyu_open.js");
      if (open.cfg().configured) {
        const phone = String(b.phone || payload["手机号"] || "").trim();
        const userId = open.chunyuUserId(null, phone);
        chunyu = {
          kind: "expert",
          h5Url: open.expertH5Url(userId),
          note: "green_channel_h5"
        };
      }
    } catch (e) {
      chunyu = null;
    }
  }
  json(res,200,{ ok:true, id:r.lastInsertRowid, enrolledPlan, chunyu });
});


function applyInviteProfileToPatient(doctorId, pid, extracted, voucherUrl){
  const ex = extracted || {};
  const name = String(ex.name || "").trim();
  const rel = db.prepare("SELECT person_id FROM patients WHERE id=?").get(pid);
  if (rel && rel.person_id) {
    updatePersonIdentity(rel.person_id, {
      realName: name,
      gender: ex.gender,
      birthDate: ex.birthDate,
      phone: ex.phone
    });
  }
  db.prepare("UPDATE patients SET real_name=COALESCE(NULLIF(?,''),real_name), display_name=CASE WHEN display_name IS NULL OR trim(display_name)='' OR display_name='网页咨询者' THEN ? ELSE display_name END, gender=COALESCE(NULLIF(?,''),gender), birth_date=COALESCE(NULLIF(?,''),birth_date), phone=COALESCE(NULLIF(?,''),phone), updated_at=? WHERE id=?")
    .run(name, name || "建档患者", ex.gender || null, ex.birthDate || null, ex.phone || null, now(), pid);
  profileStore.upsertFieldsInTransaction(
    doctorId,
    pid,
    {
      disease: ex.disease || "",
      pregnancyStatus: ex.pregnancyStatus || "",
      foodContactAllergies: ex.foodContactAllergies,
      drugAllergies: ex.drugAllergies,
      diseaseHistory: ex.diseaseHistory,
      ...patientProfile.extraProfileFields(ex)
    },
    "invite",
    "patient"
  );
  writeVoucherHealthRecord(doctorId, pid, voucherUrl);
}

/* 建档邀请：公开查询 */
route("GET", /^\/api\/invite\/([A-Za-z0-9_-]+)$/, (req,res,m)=>{
  const token = m[1];
  const link = inviteStore.getByToken(token);
  if(!link) return json(res,410,{error:"邀请链接无效或已过期"});
  const doc = db.prepare("SELECT id,name,title,hospital,dept FROM doctors WHERE id=?").get(link.doctor_id);
  if(!doc) return json(res,410,{error:"医生不存在"});
  const content = contentForDoctor(doc.id) || {};
  const diseaseOpts = ((content.contactForm || {}).fields || []).find(f => f && f.key === "disease");
  const fields = patientProfile.defaultContactProfileFields(diseaseOpts && diseaseOpts.options);
  json(res,200,{
    ok:true,
    doctorId:doc.id,
    doctorName:doc.name,
    doctorTitle:doc.title || "",
    hospital:doc.hospital || "",
    requireSms:smsProvider.isConfigured(),
    allowBoundSession:true,
    smsAvailable:smsProvider.isConfigured(),
    consentText: content.consentText || null,
    fields,
    success: (content.contactForm && content.contactForm.success) || { title:"建档成功", desc:"您的信息已提交，医生团队可见。后续提问将关联本档案。" }
  });
});

/* 建档邀请：问卷提交（可信手机验证；策略 B + 同号未验证需确认） */
route("POST", /^\/api\/invite\/([A-Za-z0-9_-]+)\/submit$/, async (req,res,m)=>{
  const token = m[1];
  const link = inviteStore.getByToken(token);
  if(!link) return json(res,410,{error:"邀请链接无效或已过期"});
  const b = await parseBody(req, MESSAGE_MAX_BODY);
  if(b.__oversize) return json(res,413,{error:"请求体过大（上限 6MB）"});
  const doctorId = +b.doctorId;
  if(!doctorId || doctorId !== +link.doctor_id) return json(res,400,{error:"医生参数与邀请不匹配"});
  if(b.consent !== true) return json(res,400,{error:"请先阅读并同意用户协议与隐私政策"});
  const phone = String(b.phone || (b.payload && b.payload["手机号"]) || "").trim();
  if(!patientInvite.isInvitePhone(phone)) return json(res,400,{error:"请输入正确手机号"});

  let bearerVerification;
  try{
    bearerVerification = inviteBearerVerifiedPhone(req, doctorId, phone);
  }catch(error){
    return json(res, error.status || 500, { error:error.code || "server_error" });
  }

  const payload = b.payload || {};
  const extracted = patientProfile.extractProfileFromPayload(Object.assign({}, payload, {
    phone,
    outpatientVoucherUrl: b.outpatientVoucherUrl || payload.outpatientVoucherUrl || payload["请上传门诊凭证"] || ""
  }));
  const verrs = patientProfile.validateContactProfile(extracted);
  if(verrs.length) return json(res,400,{ error:verrs[0] });

  try{
    inviteVerifiedPhone(
      req,
      doctorId,
      phone,
      b.smsCode,
      b.verificationProof,
      token,
      bearerVerification,
      { consumeSms:false }
    );
  }catch(error){
    return json(res, error.status || 500, { error:error.code || "server_error" });
  }

  try{
    const precheckIdentity = bearerVerification
      || verifiedIdentityForPhone(doctorId, phone);
    extracted.outpatientVoucherUrl = bearerVerification
      ? readyVoucherForIdentity(
        extracted.outpatientVoucherUrl,
        precheckIdentity
      ).url
      : precheckVoucherForUnverifiedPhone(
        extracted.outpatientVoucherUrl,
        precheckIdentity
      );
  }catch(error){
    return json(res, error.status || 500, {
      error:error.code || "server_error"
    });
  }

  let phoneVerification;
  try{
    phoneVerification = inviteVerifiedPhone(
      req,
      doctorId,
      phone,
      b.smsCode,
      b.verificationProof,
      token,
      bearerVerification
    );
  }catch(error){
    return json(res, error.status || 500, { error:error.code || "server_error" });
  }

  const phoneTrusted = phoneVerification.source !== "invite_format"
    && phoneVerification.source !== "sms_preview";
  const phoneVerifyLabel = phoneVerification.source === "mp" ? "已验证(小程序)"
    : phoneVerification.source === "web" ? "已验证(网页会话)"
    : phoneVerification.source === "proof" ? "已验证(短信凭证)"
    : phoneVerification.source === "invite_format" ? "未验证(邀请链接)"
    : "已验证(短信)";

  let transactionResult;
  try{
    transactionResult = runDbTransaction(()=>{
      const resolved = inviteStore.resolveInvitePatient(resolvePatient, {
        doctorId,
        phone,
        name: extracted.name,
        inviteToken: token,
        confirmMergePatientId: b.confirmMergePatientId,
        forceCreate: b.forceCreate === true,
        phoneVerified: phoneTrusted
      });
      if(resolved.status === "needs_confirm"){
        return { kind:"needs_confirm", resolved };
      }
      if(resolved.status === "error"){
        return { kind:"resolve_error", resolved };
      }

      const pid = resolved.patientId;
      const identity = assertInvitePhoneIdentity(pid, phone);
      const voucher = readyVoucherForIdentity(
        extracted.outpatientVoucherUrl,
        {
          doctorId,
          personId:+identity.person_id,
          patientId:+pid
        }
      );
      if(phoneTrusted){
        markInvitePhoneVerified(pid, phone, identity);
      }else{
        const ts = now();
        db.prepare(
          "UPDATE patients SET phone=?,phone_verified=0,updated_at=? WHERE id=?"
        ).run(phone, ts, Number(pid));
      }
      applyInviteProfileToPatient(doctorId, pid, extracted, voucher.url);

      const storedPayload = {
        "姓名": extracted.name,
        "性别": extracted.gender,
        "出生日期": extracted.birthDate,
        "手机号": extracted.phone,
        "您所患的疾病": extracted.disease,
        "主要疾病": extracted.disease,
        "是否妊娠哺乳": extracted.pregnancyStatus || "",
        "食物、接触物过敏": extracted.foodContactAllergies,
        "药物过敏": extracted.drugAllergies,
        "疾病史": extracted.diseaseHistory,
        "请上传门诊凭证": voucher.url,
        outpatientVoucherUrl: voucher.url,
        "建档来源": "邀请问卷",
        "手机号验证": phoneVerifyLabel,
        "并档方式": resolved.reason || "",
        "敏感信息单独同意": now()
      };
      const sub = db.prepare(
        "INSERT INTO submissions(doctor_id,type,payload,patient_id,created_at) VALUES(?,?,?,?,?)"
      ).run(doctorId, "联络表", JSON.stringify(storedPayload), pid, now());
      inviteStore.bumpUse(token);
      const psid = inviteStore.createSession({
        doctorId,
        patientId:pid,
        ttlDays:90
      });
      claimVoucherForIdentity(voucher, {
        doctorId,
        personId:+identity.person_id,
        patientId:+pid
      });
      return {
        kind:"success",
        resolved,
        patientId:pid,
        submissionId:sub.lastInsertRowid,
        psid
      };
    });
  }catch(error){
    if(!error || error.code !== "phone_identity_conflict"){
      console.error("[invite/submit] transaction_failed", error && error.message);
    }
    return json(res, error.status || 500, {
      error:error.status && error.code ? error.code : "server_error"
    });
  }

  if(transactionResult.kind === "needs_confirm"){
    const resolved = transactionResult.resolved;
    const verificationProof = phoneVerification.source === "sms"
      ? createInviteVerificationProof(token, doctorId, phone)
      : phoneVerification.source === "proof"
        ? phoneVerification.proofToken
        : undefined;
    return json(res,200,{
      ok:false,
      needsMergeConfirm:true,
      message:"发现同号档案，请确认是否并入已有档案，或新建档案",
      candidates: resolved.candidates,
      ...(verificationProof ? { verificationProof } : {})
    });
  }
  if(transactionResult.kind === "resolve_error"){
    return json(res,400,{
      error:transactionResult.resolved.error || "并档确认失败"
    });
  }

  if(phoneVerification.source === "proof"){
    const consumed = consumeInviteVerificationProof(
      phoneVerification.proofToken,
      token,
      doctorId,
      phone
    );
    if(!consumed) console.error("[invite/submit] committed_proof_missing");
  }

  const resolved = transactionResult.resolved;
  const mergeMsg = resolved.reason === "verified" || resolved.reason === "user_confirm"
    ? "已更新已有档案"
    : "建档成功";
  res.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
    "Set-Cookie": patientSessionCookie(
      req,
      transactionResult.psid,
      90 * 24 * 3600
    )
  });
  res.end(JSON.stringify({
    ok:true,
    id: transactionResult.submissionId,
    patientId: transactionResult.patientId,
    merged: resolved.reason === "verified" || resolved.reason === "user_confirm",
    mergeReason: resolved.reason,
    message: mergeMsg,
    patientSessionSet: true
  }));
});

/* 智能候补名单：加号撞停诊/满号时可加入候补；名额释放→批量自动通知 */
route("POST", /^\/api\/waitlist$/, async (req,res)=>{
  const b = await parseBody(req);
  if(b.__oversize) return json(res,413,{error:"请求体过大（上限 1MB）"});
  const did = b.doctorId, slot = String(b.slot||"").trim();
  const name = String(b.name||"").trim(), phone = String(b.phone||"").trim();
  if(!did || !db.prepare("SELECT 1 FROM doctors WHERE id=?").get(did)) return json(res,404,{error:"医生不存在"});
  if(!slot) return json(res,400,{error:"缺少就诊时段"});
  if(!isPhone(phone)) return json(res,400,{error:"请输入正确手机号"});
  if(b.consent !== true) return json(res,400,{error:"请先阅读并同意信息处理告知"});
  const dup = db.prepare("SELECT id FROM waitlist WHERE doctor_id=? AND slot=? AND patient_phone=? AND status='waiting'").get(did, slot, phone);
  if(dup) return json(res,200,{ ok:true, id:dup.id, already:true });
  const r = db.prepare("INSERT INTO waitlist(doctor_id,slot,patient_name,patient_phone,status,created_at) VALUES(?,?,?,?,?,?)")
    .run(did, slot, name||"候补患者", phone, "waiting", now());
  json(res,200,{ ok:true, id:r.lastInsertRowid });
});
route("GET", /^\/api\/admin\/waitlist$/, (req,res,m,q)=>{ const s=gate(req,res,+q.doctorId); if(!s)return;
  json(res,200, db.prepare("SELECT * FROM waitlist WHERE doctor_id=? ORDER BY slot, id").all(+q.doctorId)
    .map(w=>({ id:w.id, slot:w.slot, name:w.patient_name, tail:String(w.patient_phone||"").slice(-4), status:w.status, at:w.created_at, notifiedAt:w.notified_at }))); });
route("POST", /^\/api\/admin\/waitlist\/release$/, async (req,res)=>{
  const b = await parseBody(req);
  if(!b.doctorId || !b.slot) return json(res,400,{error:"缺少 doctorId 或 slot"});
  const s=gate(req,res,+b.doctorId); if(!s)return;
  if(!requireAdminAction(req,res,s,"waitlist.manage",{doctorId:+b.doctorId},"无候补名单处理权限")) return;
  const r = db.prepare("UPDATE waitlist SET status='notified', notified_at=? WHERE doctor_id=? AND slot=? AND status='waiting'").run(now(), b.doctorId, String(b.slot));
  json(res,200,{ ok:true, notified:r.changes }); });
route("POST", /^\/api\/admin\/waitlist\/(\d+)\/notify$/, async (req,res,m)=>{ const s=gate(req,res, rowDoctorId("waitlist",+m[1])); if(!s)return;
  const did = rowDoctorId("waitlist",+m[1]);
  if(!requireAdminAction(req,res,s,"waitlist.manage",{doctorId:did},"无候补名单处理权限")) return;
  db.prepare("UPDATE waitlist SET status='notified', notified_at=? WHERE id=?").run(now(), +m[1]);
  json(res,200,{ ok:true }); });

/* 患者查看自己的提交/回复状态：短信 或 小程序已绑号 Bearer（会话手机为准） */
route("POST", /^\/api\/replies\/mine$/, async (req,res)=>{
  const b = await parseBody(req);
  if(b.__oversize) return json(res,413,{error:"请求体过大（上限 1MB）"});
  const did = b.doctorId;
  if(!did || !db.prepare("SELECT 1 FROM doctors WHERE id=?").get(did)) return json(res,404,{error:"医生不存在"});

  let phone = String(b.phone||"").trim();
  let usedMp = false;
  const { bearerToken } = require("./mp-auth.js");
  const mpAuth = require("../mp_auth.js");
  const tok = bearerToken(req);
  if(tok){
    let sess;
    try{
      sess = mpAuth.requireBoundSession(tok);
    }catch(e){
      return json(res,401,{error:"unauthorized"});
    }
    if(+sess.doctor_id !== +did) return json(res,403,{error:"医生不匹配"});
    const person = db.prepare("SELECT phone, phone_verified FROM persons WHERE id=?").get(sess.person_id);
    if(!person || !person.phone_verified || !person.phone) return json(res,401,{error:"请先绑定手机号"});
    phone = String(person.phone).trim();
    usedMp = true;
  }

  if(!usedMp){
    if(!isPhone(phone)) return json(res,400,{error:"请输入正确手机号"});
    const smsError = verifySms(phone, b.code);
    if(smsError) return json(res,400,{error:smsError});
  }

  const rows = db.prepare("SELECT id,type,payload,status,created_at FROM submissions WHERE doctor_id=? ORDER BY id DESC LIMIT 500").all(did);
  const mine = rows.map(r=>{
    let p={}; try{ p=JSON.parse(r.payload||"{}"); }catch(e){}
    const phones = [p["手机号"], p["患者手机号"], p["代办人手机"], p["联系电话"], p["手机"]].filter(Boolean).map(String);
    return { r, p, hit:phones.includes(phone) };
  }).filter(x=>x.hit).slice(0,50).map(x=>({
    id:x.r.id,
    type:x.r.type,
    status:x.r.status,
    at:x.r.created_at,
    summary:Object.entries(x.p).filter(([k])=>!/(手机号|手机|身份证|验证|同意)/.test(k)).slice(0,6).map(([k,v])=>`${k}：${String(v).slice(0,60)}`)
  }));
  json(res,200,{ ok:true, replies:mine, followups:followup.mine(did, phone) });
});

/* 感谢医生：患者手机号验证后进入后台待审核，不直接公开 */
route("POST", /^\/api\/thanks$/, async (req,res)=>{
  const b = await parseBody(req);
  if(b.__oversize) return json(res,413,{error:"请求体过大（上限 1MB）"});
  const did = b.doctorId, phone = String(b.phone||"").trim();
  // 掩码先于截断（生产DB架构 v1.0 §3-1，2026-07-04；与 7-03 注入侧修复同型不变量）：先对全文 maskPIIStrict（含分隔号增强）
  // 再 slice——旧序「先截断后掩码」会把跨 1000 位的号码切半、残段不再命中正则而明文入库。
  const text = maskPIIStrict(String(b.text||"").trim()).slice(0,1000);
  if(!did || !db.prepare("SELECT 1 FROM doctors WHERE id=?").get(did)) return json(res,404,{error:"医生不存在"});
  if(!isPhone(phone)) return json(res,400,{error:"请输入正确手机号"});
  if(b.consent !== true) return json(res,400,{error:"请先阅读并同意信息处理告知"});
  if(text.length < 5) return json(res,400,{error:"感谢内容至少 5 个字"});
  const smsError = verifySms(phone, b.code);
  if(smsError) return json(res,400,{error:smsError});
  const payload = { 手机号:phone, 内容:text, 来源:"患者感谢医生", 手机尾号:phone.slice(-4) };
  const r = db.prepare("INSERT INTO submissions(doctor_id,type,payload,status,created_at) VALUES(?,?,?,?,?)")
    .run(did, "感谢医生", JSON.stringify(payload), "待审核", now());
  json(res,200,{ ok:true, id:r.lastInsertRowid });
});

/* 随访：医助后台队列 + 手动入组 + 节点状态流转 → 已迁至 routes/followup.js */

/* 感谢信公开读取最近感谢信（正文输出前做 PII 脱敏，不改存储） */
route("GET", /^\/api\/stories$/, (req,res,m,q)=>{
  const rows = db.prepare("SELECT payload,created_at FROM submissions WHERE doctor_id=? AND type='story' ORDER BY id DESC LIMIT 20").all(q.doctorId);
  json(res,200, rows.map(r=>{ const p=JSON.parse(r.payload); return { ...p, text:maskPII(p.text), at:r.created_at }; }));
});

/* 建档患者认证口碑墙：仅「联络表已建档」+「本人手机短信验证」双重门控可发，杜绝刷评 */
function isRegistered(doctorId, phone){
  const rows = db.prepare("SELECT payload FROM submissions WHERE doctor_id=? AND type='联络表'").all(doctorId);
  return rows.some(r=>{ try{ return JSON.parse(r.payload||"{}")["手机号"] === phone; }catch(e){ return false; } });
}
function registeredName(doctorId, phone){
  const reg = db.prepare("SELECT payload FROM submissions WHERE doctor_id=? AND type='联络表' ORDER BY id DESC").all(doctorId)
    .map(r=>{ try{ return JSON.parse(r.payload||"{}"); }catch(e){ return {}; } })
    .find(p=>p["手机号"]===phone);
  return (reg && reg["姓名"]) ? String(reg["姓名"]).trim() : "建档患者";
}
function maskName(name){ const s=String(name||"").trim(); return s.length<=1 ? (s+"**") : (s[0]+"*".repeat(Math.max(1,s.length-1))); }
/* maskPII 本地副本已合并至 pii.js 单一模块（生产DB架构 v1.0 §3-4，2026-07-04）：正则原样搬家、行为不变，见顶部 require */
route("GET", /^\/api\/testimonials$/, (req,res,m,q)=>{
  const rows = db.prepare("SELECT payload,created_at FROM submissions WHERE doctor_id=? AND type='口碑' AND status!='已隐藏' ORDER BY id DESC LIMIT 30").all(q.doctorId);
  json(res,200, rows.map(r=>{ const p=JSON.parse(r.payload||"{}"); return { name:p["姓名"]||"建档患者", text:p["内容"]||"", tail:p["手机尾号"]||"", verified:true, at:r.created_at }; }));
});
route("POST", /^\/api\/testimonial$/, async (req,res)=>{
  const b = await parseBody(req);
  if(b.__oversize) return json(res,413,{error:"请求体过大（上限 1MB）"});
  const did = b.doctorId;
  const phone = String(b.phone||"").trim();
  const text = String(b.text||"").trim().slice(0,1000);
  if(!did || !db.prepare("SELECT 1 FROM doctors WHERE id=?").get(did)) return json(res,404,{error:"医生不存在"});
  if(!isPhone(phone)) return json(res,400,{error:"请输入正确手机号"});
  if(text.length < 10) return json(res,400,{error:"认证评价至少 10 个字，请多写一点您的真实就医体验"});
  const smsError = verifySms(phone, b.code);          // 本人手机验证（消费验证码）
  if(smsError) return json(res,400,{error:smsError});
  if(!isRegistered(did, phone)) return json(res,403,{error:"仅建档患者可写认证评价，请先在「医患联络表」完成建档"});
  // 署名强制用「建档姓名」脱敏（不接受自填署名，保证认证墙署名=本人建档身份）；正文做 PII 脱敏
  const masked = maskName(registeredName(did, phone));
  const payload = { 姓名:masked, 内容:maskPII(text), 已认证:"是", 手机尾号:phone.slice(-4) };
  const r = db.prepare("INSERT INTO submissions(doctor_id,type,payload,status,created_at) VALUES(?,?,?,?,?)")
    .run(did, "口碑", JSON.stringify(payload), "已认证", now());
  json(res,200,{ ok:true, id:r.lastInsertRowid, name:masked });
});

return { dispose };
}

module.exports = {
  registerPatientPublicRoutes,
  createInviteProofStore,
  VOUCHER_UPLOAD_LIMIT,
  VOUCHER_DOWNLOAD_LIMIT,
  VOUCHER_PENDING_MAX_AGE_MS,
  VOUCHER_UNCLAIMED_MAX_AGE_MS,
  VOUCHER_CLEANUP_INTERVAL_MS,
  VOUCHER_CLEANUP_BATCH_SIZE
};
