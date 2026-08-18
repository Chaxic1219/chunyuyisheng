"use strict";
/* 小程序贴片封面运维：解锁 → 待采集 → 真机回调落库 → 同组 hydrate */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { db } = require("../../db.js");
const qiwe = require("../../qiwe.js");

const CAPTURE_TTL_MS = 10 * 60 * 1000;
/* 企微 cdnBigUpload fileType=1 按 JPEG；手机端对超大/伪 JPEG 封面常解码失败显示链环占位，电脑端较宽松。
   真机采集封面量级约 50–120KB；自定义上传统一压成真实 JPEG。 */
const COVER_MAX_BYTES = 120 * 1024;
const COVER_HARD_MAX_BYTES = 200 * 1024;

function clean(v, n){
  return String(v == null ? "" : v).trim().slice(0, n || 500);
}

function captureRoomKey(evt, cfg){
  if(evt && evt.fromRoomId) return "room:" + String(evt.fromRoomId);
  const id = clean((evt && (evt.senderId || evt.receiverId || evt.replyToId)) || (cfg && cfg.selfUserId) || "", 160);
  return id ? ("dm:" + id) : "default";
}

function ensureCaptureTable(){
  db.exec(`
CREATE TABLE IF NOT EXISTS qiwe_capture_pending(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doctor_id INTEGER NOT NULL,
  code TEXT NOT NULL,
  room_key TEXT,
  status TEXT DEFAULT 'pending',
  backup_json TEXT,
  started_at TEXT,
  expires_at TEXT,
  completed_at TEXT,
  started_by TEXT,
  note TEXT
);
CREATE INDEX IF NOT EXISTS idx_qiwe_capture_pending_doctor ON qiwe_capture_pending(doctor_id, status, expires_at);
`);
}

ensureCaptureTable();

function expireStalePending(doctorId){
  const now = new Date().toISOString();
  db.prepare(`UPDATE qiwe_capture_pending SET status='expired'
    WHERE doctor_id=? AND status='pending' AND expires_at < ?`).run(Number(doctorId), now);
}

function getTemplateRow(doctorId, code){
  return db.prepare("SELECT * FROM qiwe_weapp_templates WHERE doctor_id=? AND code=?").get(Number(doctorId), clean(code, 40));
}

function siblingCodes(doctorId, sourceShortLink, excludeCode){
  if(!sourceShortLink) return [];
  return db.prepare(`SELECT code FROM qiwe_weapp_templates
    WHERE doctor_id=? AND source_short_link=? AND code<>?
    ORDER BY code`).all(Number(doctorId), sourceShortLink, clean(excludeCode, 40))
    .map(r=>String(r.code));
}

function backupTemplates(doctorId, codes){
  const rows = [];
  for(const code of codes){
    const row = getTemplateRow(doctorId, code);
    if(row) rows.push(row);
  }
  return rows;
}

function unlockCover(doctorId, code){
  const now = new Date().toISOString();
  return db.prepare(`UPDATE qiwe_weapp_templates SET
    raw_payload='',
    cover_file_aes_key='',
    cover_file_id='',
    cover_file_size=0,
    updated_at=?
    WHERE doctor_id=? AND code=?`).run(now, Number(doctorId), clean(code, 40)).changes || 0;
}

function activePending(doctorId, code){
  expireStalePending(doctorId);
  const now = new Date().toISOString();
  const args = [Number(doctorId), now];
  let sql = `SELECT * FROM qiwe_capture_pending WHERE doctor_id=? AND status='pending' AND expires_at>=?`;
  if(code){
    sql += " AND code=?";
    args.push(clean(code, 40));
  }
  sql += " ORDER BY id DESC LIMIT 1";
  return db.prepare(sql).get(...args) || null;
}

function listCoverTemplates(doctorId){
  qiwe.syncWeappTemplatesFromRules(Number(doctorId));
  try{ bootstrapAllH5Jumps(Number(doctorId)); }catch(e){}
  expireStalePending(doctorId);
  const rows = db.prepare(`SELECT * FROM qiwe_weapp_templates WHERE doctor_id=? ORDER BY code,id`).all(Number(doctorId));
  const pendingRows = db.prepare(`SELECT code,started_at,expires_at,started_by FROM qiwe_capture_pending
    WHERE doctor_id=? AND status='pending' AND expires_at>=?`).all(Number(doctorId), new Date().toISOString());
  const pendingByCode = new Map(pendingRows.map(r=>[String(r.code), r]));
  return rows.map(row=>{
    const tpl = qiwe.loadWeappTemplate(Number(doctorId), row.code);
    const pending = pendingByCode.get(String(row.code)) || null;
    let coverSource = "none";
    try{
      const raw = row.raw_payload ? JSON.parse(row.raw_payload) : null;
      if(raw && raw.source === "custom_upload") coverSource = "custom";
      else if(row.raw_payload && row.cover_file_id) coverSource = "capture";
      else if(tpl && tpl.ready) coverSource = "ready";
    }catch(e){
      if(row.raw_payload && row.cover_file_id) coverSource = "capture";
    }
    const localThumb = /^\/uploads\/qiwe-covers\//i.test(String(row.thumb_url || ""))
      ? String(row.thumb_url)
      : "";
    return {
      code: row.code,
      title: row.title || "",
      desc: row.desc || "",
      sourceShortLink: row.source_short_link || "",
      sourceType: row.source_type || "",
      appId: row.app_id || "",
      pagePath: row.page_path || "",
      thumbUrl: row.thumb_url || "",
      previewThumb: localThumb,
      coverSource,
      coverFileSize: Number(row.cover_file_size) || 0,
      locked: !!(row.raw_payload && String(row.raw_payload).length),
      ready: !!(tpl && tpl.ready),
      missing: (tpl && tpl.missing) || [],
      updatedAt: row.updated_at || "",
      capturePending: pending ? {
        startedAt: pending.started_at,
        expiresAt: pending.expires_at,
        startedBy: pending.started_by || ""
      } : null,
      relatedCodes: siblingCodes(Number(doctorId), row.source_short_link, row.code)
    };
  });
}

function recaptureGuide(code, shortLink){
  const c = clean(code, 40);
  const link = clean(shortLink, 500);
  return {
    title: `更新编号 ${c} 的小程序贴片封面`,
    steps: [
      "点击下方「开始真机重采」后，系统只解锁旧封面并进入 10 分钟采集窗口，不会向任何群自动发编号或卡片。",
      `请您本人用企微托管号，在选定的单个测试群/会话中手动发送文本：${c}`,
      link
        ? `随后在同一会话中手动转发/发送一张带真实封面的小程序卡（短链参考：${link}）。`
        : "随后在同一会话中手动转发/发送一张带真实封面的小程序卡。",
      "采集成功后，本页状态会变为「封面就绪」；同短链组的其它编号会自动同步封面。",
      `需要验图时，请您自行在该测试会话发送 ${c}，确认卡片大图不再灰底。`
    ],
    ttlMinutes: Math.round(CAPTURE_TTL_MS / 60000),
    shortLink: link
  };
}

function splitTestTargets(testToId, selfUserId){
  const raw = clean(testToId, 4000);
  const parts = raw.split(/[\r\n,;]+/).map(x=>clean(x, 160)).filter(Boolean);
  if(!parts.length && selfUserId) parts.push(clean(selfUserId, 160));
  return [...new Set(parts)];
}

async function prepareRecapture(input){
  input = input || {};
  const doctorId = Number(input.doctorId);
  const code = clean(input.code, 40);
  const syncSiblings = input.syncSiblings !== false;
  // 甲方要求：真机采样绝不自动群发编号/卡片；编号与卡片一律由运营手动发送。
  // 忽略 autoSendCode（即使前端误传 true），避免 testToId 白名单（含全部入群）被扫射。
  const startedBy = clean(input.startedBy, 120) || "admin";
  if(!Number.isFinite(doctorId) || !code) throw new Error("缺少 doctorId 或 code");

  const row = getTemplateRow(doctorId, code);
  if(!row) throw new Error(`编号 ${code} 尚无小程序模板行，请先在规则里配置 mp 卡`);

  const siblings = syncSiblings ? siblingCodes(doctorId, row.source_short_link, code) : [];
  const unlockCodes = [code, ...siblings];
  const backup = backupTemplates(doctorId, unlockCodes);

  db.prepare(`UPDATE qiwe_capture_pending SET status='cancelled'
    WHERE doctor_id=? AND code=? AND status='pending'`).run(doctorId, code);
  for(const c of unlockCodes) unlockCover(doctorId, c);

  const startedAt = new Date();
  const expiresAt = new Date(startedAt.getTime() + CAPTURE_TTL_MS);
  const cfg = qiwe.loadConfig();
  const roomKey = splitTestTargets(cfg.testToId, cfg.selfUserId).map(t=>(t.indexOf("room:") === 0 || t.indexOf("dm:") === 0) ? t : ("room:" + t))[0] || "default";

  const ins = db.prepare(`INSERT INTO qiwe_capture_pending(
    doctor_id,code,room_key,status,backup_json,started_at,expires_at,started_by,note
  ) VALUES(?,?,?,?,?,?,?,?,?)`);
  ins.run(
    doctorId, code, roomKey, "pending",
    JSON.stringify({ at: startedAt.toISOString(), templates: backup }),
    startedAt.toISOString(), expiresAt.toISOString(), startedBy,
    syncSiblings ? ("sync:" + siblings.join(",")) : ""
  );

  return {
    ok: true,
    doctorId,
    code,
    unlockedCodes: unlockCodes,
    backupCount: backup.length,
    pending: {
      startedAt: startedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      roomKey
    },
    guide: recaptureGuide(code, row.source_short_link),
    autoSend: { attempted: false, sent: [], errors: [], disabled: true, reason: "manual_only" }
  };
}

function takeDbPendingCaptureCode(doctorId, evt, cfg){
  if(!doctorId) return "";
  expireStalePending(doctorId);
  const now = new Date().toISOString();
  const roomKey = captureRoomKey(evt, cfg);
  let row = db.prepare(`SELECT code FROM qiwe_capture_pending
    WHERE doctor_id=? AND status='pending' AND expires_at>=? AND room_key=?
    ORDER BY id DESC LIMIT 1`).get(Number(doctorId), now, roomKey);
  if(!row){
    row = db.prepare(`SELECT code FROM qiwe_capture_pending
      WHERE doctor_id=? AND status='pending' AND expires_at>=?
      ORDER BY id DESC LIMIT 1`).get(Number(doctorId), now);
  }
  return row ? String(row.code) : "";
}

function completePendingCapture(doctorId, code){
  if(!doctorId || !code) return 0;
  const now = new Date().toISOString();
  return db.prepare(`UPDATE qiwe_capture_pending SET status='done', completed_at=?
    WHERE doctor_id=? AND code=? AND status='pending'`).run(now, Number(doctorId), clean(code, 40)).changes || 0;
}

function cancelRecapture(doctorId, code){
  const now = new Date().toISOString();
  return db.prepare(`UPDATE qiwe_capture_pending SET status='cancelled', completed_at=?
    WHERE doctor_id=? AND code=? AND status='pending'`).run(now, Number(doctorId), clean(code, 40)).changes || 0;
}

function recaptureStatus(doctorId, code){
  expireStalePending(doctorId);
  const tpl = qiwe.loadWeappTemplate(Number(doctorId), clean(code, 40));
  const pending = activePending(doctorId, code);
  const row = getTemplateRow(doctorId, code);
  return {
    doctorId: Number(doctorId),
    code: clean(code, 40),
    ready: !!(tpl && tpl.ready),
    missing: (tpl && tpl.missing) || [],
    locked: !!(row && row.raw_payload),
    coverFileSize: row ? Number(row.cover_file_size) || 0 : 0,
    updatedAt: row ? row.updated_at || "" : "",
    pending: pending ? {
      status: pending.status,
      startedAt: pending.started_at,
      expiresAt: pending.expires_at,
      startedBy: pending.started_by || ""
    } : null,
    guide: recaptureGuide(code, row && row.source_short_link)
  };
}

function publicOrigin(){
  return String(process.env.PUBLIC_ORIGIN || process.env.APP_PUBLIC_ORIGIN || "").trim().replace(/\/+$/, "");
}

function updateCardCopy(input){
  input = input || {};
  const doctorId = Number(input.doctorId);
  const code = clean(input.code, 40);
  if(!Number.isFinite(doctorId) || !code) throw new Error("缺少 doctorId 或 code");
  const row = getTemplateRow(doctorId, code);
  if(!row) throw new Error(`编号 ${code} 尚无小程序模板行`);
  const title = clean(input.title, 180);
  const desc = clean(input.desc, 500);
  if(!title) throw new Error("标题不能为空");
  const now = new Date().toISOString();
  db.prepare(`UPDATE qiwe_weapp_templates SET title=?, desc=?, updated_at=? WHERE doctor_id=? AND code=?`)
    .run(title, desc, now, doctorId, code);
  return {
    ok: true,
    doctorId,
    code,
    title,
    desc,
    updatedAt: now
  };
}

function writeCoverFields(doctorId, code, fields){
  const now = new Date().toISOString();
  db.prepare(`UPDATE qiwe_weapp_templates SET
    thumb_url=?,
    cover_file_aes_key=?,
    cover_file_id=?,
    cover_file_size=?,
    raw_payload=?,
    updated_at=?
    WHERE doctor_id=? AND code=?`).run(
    fields.thumbUrl,
    fields.coverFileAesKey,
    fields.coverFileId,
    Number(fields.coverFileSize) || 0,
    fields.rawPayload,
    now,
    Number(doctorId),
    clean(code, 40)
  );
}

function httpUrlLoose(v){
  const s = String(v || "").trim();
  return /^https?:\/\//i.test(s) ? s.slice(0, 2000) : "";
}

function extractRuleH5Url(doctorId, code){
  let responses = [];
  try{
    const r = db.prepare("SELECT responses FROM rules WHERE doctor_id=? AND code=? AND enabled=1").get(Number(doctorId), clean(code, 40));
    responses = r && r.responses ? JSON.parse(r.responses) : [];
    if(!Array.isArray(responses)) responses = [];
  }catch(e){ responses = []; }
  for(const item of responses){
    if(!item || typeof item !== "object") continue;
    const ext = item.external || {};
    const url = httpUrlLoose(item.linkUrl || item.url || ext.url || ext.urlLink || ext.linkUrl);
    if(url) return url;
  }
  return "";
}

function findDonorWeappJump(doctorId){
  const local = db.prepare(`SELECT app_id, username FROM qiwe_weapp_templates
    WHERE doctor_id=? AND COALESCE(app_id,'')<>'' AND COALESCE(username,'')<>''
    ORDER BY CASE WHEN COALESCE(cover_file_id,'')<>'' THEN 0 ELSE 1 END,
             CASE WHEN code IN ('808','101','414','302') THEN 0 ELSE 1 END,
             updated_at DESC, id DESC
    LIMIT 1`).get(Number(doctorId));
  if(local) return local;
  // 本医生已有 appId 但缺 username：同 appId 跨医生借 username（春雨医生共用主体）
  const partial = db.prepare(`SELECT app_id FROM qiwe_weapp_templates
    WHERE doctor_id=? AND COALESCE(app_id,'')<>'' ORDER BY updated_at DESC LIMIT 1`).get(Number(doctorId));
  if(partial && partial.app_id){
    const peer = db.prepare(`SELECT app_id, username FROM qiwe_weapp_templates
      WHERE app_id=? AND COALESCE(username,'')<>'' ORDER BY updated_at DESC LIMIT 1`).get(partial.app_id);
    if(peer) return peer;
  }
  return null;
}

function ensureMpResponseForH5(doctorId, code, h5Url, meta){
  const row = db.prepare("SELECT id, responses FROM rules WHERE doctor_id=? AND code=? AND enabled=1").get(Number(doctorId), clean(code, 40));
  if(!row) return false;
  let responses = [];
  try{ responses = JSON.parse(row.responses || "[]"); }catch(e){ responses = []; }
  if(!Array.isArray(responses)) responses = [];
  const hasMp = responses.some(r=>r && r.type === "mp");
  if(hasMp) return false;
  const title = clean((meta && meta.title) || code, 180) || String(code);
  const desc = clean((meta && meta.desc) || "在线填写", 240);
  const mp = {
    type: "mp",
    title,
    sub: desc,
    page: clean((meta && meta.sourcePage) || "", 80) || "admission",
    thumb: "mpBed",
    external: {
      provider: "春雨医生",
      label: title,
      mode: "h5",
      service: title,
      status: "ready",
      url: h5Url,
      note: "点击打开小程序网页填写。",
      requires: []
    }
  };
  // 保留原 link 作兜底，mp 置前以便优先发小程序卡
  const next = [mp].concat(responses);
  db.prepare("UPDATE rules SET responses=? WHERE id=?").run(JSON.stringify(next), row.id);
  return true;
}

/* 纯 H5 编号（如王/周 302）无 appId/username/pagePath 时：用本医生已有小程序身份 + h5_webview 包装规则 URL，补齐后再允许自定义封面。 */
function ensureWeappJumpInfo(doctorId, code){
  let row = getTemplateRow(doctorId, code);
  if(!row) throw new Error(`编号 ${code} 尚无小程序模板行，请先在规则里配置 mp/link 卡`);
  if(row.app_id && row.username && row.page_path) return row;

  const h5Url = extractRuleH5Url(doctorId, code);
  if(!row.page_path && !h5Url){
    throw new Error("模板缺少 appId/username/pagePath，且规则中无可用 H5 链接。请先用「真机重采」采集小程序卡，或在编号规则里配置带跳转信息的 mp 卡。");
  }
  const donor = findDonorWeappJump(doctorId);
  const appId = row.app_id || (donor && donor.app_id) || "";
  const username = row.username || (donor && donor.username) || "";
  if(!appId || !username){
    throw new Error("模板缺少小程序跳转信息，且本医生尚无可用的 appId/username（请先完成 808/101 等任一编号的真机采集，再上传封面）。");
  }
  // 非春雨业务域名（如 yht.chunyutianxia.com）不可包进春雨小程序 h5_webview，否则点开会「不支持打开」。
  const { isChunyuH5WebviewHostAllowed } = require("./cards");
  if(!row.page_path && h5Url && !isChunyuH5WebviewHostAllowed(h5Url)){
    // 已有封面三件套时允许仅刷新封面（如 979 链接卡图标），不强制包装为小程序网页卡
    if(row.cover_file_aes_key && row.cover_file_id) return row;
    throw new Error("该 H5 域名不在春雨小程序业务域名白名单内，无法包装为小程序网页卡；请保留规则里的链接卡，由企微直接打开。");
  }
  const pagePath = row.page_path || ("pages/h5_webview/index.html?url=" + encodeURIComponent(h5Url));
  const now = new Date().toISOString();
  db.prepare(`UPDATE qiwe_weapp_templates SET
    app_id=?, username=?, page_path=?,
    source_type=CASE WHEN COALESCE(source_type,'')='' OR source_type LIKE 'link:%' THEN 'mp:h5_webview' ELSE source_type END,
    updated_at=?
    WHERE doctor_id=? AND code=?`).run(
    appId, username, pagePath, now, Number(doctorId), clean(code, 40)
  );
  if(h5Url){
    ensureMpResponseForH5(doctorId, code, h5Url, {
      title: row.title,
      desc: row.desc,
      sourcePage: row.source_page
    });
  }
  row = getTemplateRow(doctorId, code);
  if(!row || !row.app_id || !row.username || !row.page_path){
    throw new Error("自动补齐小程序跳转信息失败，请重试或改用真机重采");
  }
  return row;
}

/* 全量：凡规则里带 http(s) 短链/H5 且模板缺跳转三件套的编号，一律按 h5_webview 规则补齐。 */
function bootstrapAllH5Jumps(doctorId){
  const did = doctorId == null || doctorId === "" ? null : Number(doctorId);
  if(did != null){
    if(!Number.isFinite(did) || did <= 0) throw new Error("doctorId 无效");
    try{ qiwe.syncWeappTemplatesFromRules(did); }catch(e){}
  }else{
    const docs = db.prepare("SELECT id FROM doctors").all();
    for(const d of docs){
      try{ qiwe.syncWeappTemplatesFromRules(d.id); }catch(e){}
    }
  }
  const rows = did != null
    ? db.prepare(`SELECT doctor_id, code, app_id, username, page_path, source_type FROM qiwe_weapp_templates WHERE doctor_id=?`).all(did)
    : db.prepare(`SELECT doctor_id, code, app_id, username, page_path, source_type FROM qiwe_weapp_templates`).all();
  const ok = [];
  const skipped = [];
  for(const r of rows){
    const code = String(r.code || "");
    const doctor = Number(r.doctor_id);
    if(r.app_id && r.username && r.page_path){
      skipped.push({ doctorId:doctor, code, reason:"already_complete" });
      continue;
    }
    const h5 = extractRuleH5Url(doctor, code);
    if(!h5){
      skipped.push({ doctorId:doctor, code, reason:"no_h5_url" });
      continue;
    }
    try{
      ensureWeappJumpInfo(doctor, code);
      ok.push({ doctorId:doctor, code, url:h5.slice(0, 120) });
    }catch(e){
      skipped.push({ doctorId:doctor, code, reason:(e && e.message) || "failed" });
    }
  }
  return { ok, skipped, okCount:ok.length, skippedCount:skipped.length };
}

/* 将上传图压成真实 JPEG（企微 fileType=1）。优先 scripts/compress_weapp_cover.py（Pillow）。 */
function compressCoverToJpeg(buf){
  const raw = Buffer.isBuffer(buf) ? buf : Buffer.from(buf || []);
  if(!raw.length) throw new Error("图片字节为空");
  const isJpeg = raw.length >= 3 && raw[0] === 0xff && raw[1] === 0xd8 && raw[2] === 0xff;
  if(isJpeg && raw.length <= COVER_MAX_BYTES){
    return { buffer: raw, mime: "image/jpeg", compressed: false };
  }

  const script = path.join(__dirname, "..", "..", "scripts", "compress_weapp_cover.py");
  const tmpDir = path.join(__dirname, "..", "..", "public", "uploads", "qiwe-covers", "_tmp");
  try{ fs.mkdirSync(tmpDir, { recursive:true }); }catch(e){}
  const stamp = Date.now() + "-" + Math.random().toString(36).slice(2, 8);
  const inPath = path.join(tmpDir, "in-" + stamp + (isJpeg ? ".jpg" : ".bin"));
  const outPath = path.join(tmpDir, "out-" + stamp + ".jpg");
  try{
    fs.writeFileSync(inPath, raw);
    const py = process.platform === "win32" ? "python" : "python3";
    const r = spawnSync(py, [script, inPath, outPath], { encoding: "utf8", timeout: 60000 });
    if(r.status !== 0 || !fs.existsSync(outPath)){
      const err = clean((r.stderr || r.stdout || "").trim() || ("exit " + r.status), 240);
      if(isJpeg && raw.length <= COVER_HARD_MAX_BYTES){
        console.warn("[weapp-cover] compress skipped, using original jpeg:", err);
        return { buffer: raw, mime: "image/jpeg", compressed: false };
      }
      throw new Error("封面压缩失败（需安装 Pillow：python3-pil）：" + err);
    }
    const out = fs.readFileSync(outPath);
    if(!out.length || out.length > COVER_HARD_MAX_BYTES){
      throw new Error("封面压缩后仍过大（需 ≤200KB）");
    }
    return { buffer: out, mime: "image/jpeg", compressed: true, note: clean(r.stdout, 160) };
  }finally{
    try{ fs.unlinkSync(inPath); }catch(e){}
    try{ fs.unlinkSync(outPath); }catch(e){}
  }
}

async function applyCustomCover(input){
  input = input || {};
  const doctorId = Number(input.doctorId);
  const code = clean(input.code, 40);
  const syncSiblings = input.syncSiblings !== false;
  const startedBy = clean(input.startedBy, 120) || "admin";
  if(!Number.isFinite(doctorId) || !code) throw new Error("缺少 doctorId 或 code");

  const row = ensureWeappJumpInfo(doctorId, code);

  const dataUrl = String(input.imageDataUrl || "").trim();
  const m = dataUrl.match(/^data:(image\/(?:jpeg|jpg|png));base64,([A-Za-z0-9+/=\s]+)$/i);
  if(!m) throw new Error("图片格式仅支持 JPEG/PNG（请用 dataURL 上传）");
  const mimeIn = m[1].toLowerCase().replace("image/jpg", "image/jpeg");
  const bufIn = Buffer.from(m[2].replace(/\s+/g, ""), "base64");
  if(!bufIn.length || bufIn.length > 2 * 1024 * 1024) throw new Error("图片过大（需 ≤2MB）");

  const packed = compressCoverToJpeg(bufIn);
  const buf = packed.buffer;
  const mime = packed.mime;

  const dir = path.join(__dirname, "..", "..", "public", "uploads", "qiwe-covers");
  try{ fs.mkdirSync(dir, { recursive:true }); }catch(e){}
  const fileName = `cover-${doctorId}-${code}-${Date.now()}.jpg`;
  const abs = path.join(dir, fileName);
  fs.writeFileSync(abs, buf);
  const relativeUrl = `/uploads/qiwe-covers/${fileName}`;
  const origin = publicOrigin();
  const thumbUrl = origin ? (origin + relativeUrl) : relativeUrl;

  const cfg = qiwe.loadConfig();
  const up = await qiwe.uploadCdnImageForCover(buf, fileName, cfg, mime);
  const d = (up && up.data) || {};
  const coverFileAesKey = d.fileAesKey || d.fileAeskey;
  const coverFileId = d.fileId;
  const coverFileSize = Number(d.fileSize) || buf.length;
  if(!coverFileAesKey || !coverFileId || !(coverFileSize > 0)){
    throw new Error("CDN 上传未返回完整封面三件套");
  }

  const rawPayload = JSON.stringify({
    source: "custom_upload",
    at: new Date().toISOString(),
    startedBy,
    localPath: relativeUrl,
    thumbUrl,
    compressed: !!packed.compressed,
    sourceMime: mimeIn,
    dryRun: !!d.dryRun,
    jumpBootstrapped: true
  });

  const siblings = syncSiblings ? siblingCodes(doctorId, row.source_short_link, code) : [];
  const codes = [code, ...siblings];
  for(const c of codes){
    writeCoverFields(doctorId, c, {
      thumbUrl,
      coverFileAesKey,
      coverFileId,
      coverFileSize,
      rawPayload
    });
  }

  // 取消该编号进行中的真机采集窗口，避免误覆盖
  cancelRecapture(doctorId, code);

  const tpl = qiwe.loadWeappTemplate(doctorId, code);
  return {
    ok: true,
    doctorId,
    code,
    syncedCodes: codes,
    thumbUrl,
    previewThumb: relativeUrl,
    coverFileSize,
    compressed: !!packed.compressed,
    ready: !!(tpl && tpl.ready),
    missing: (tpl && tpl.missing) || [],
    dryRun: !!d.dryRun,
    jumpBootstrapped: !!(row && row.page_path && /h5_webview/.test(String(row.page_path)))
  };
}

module.exports = {
  CAPTURE_TTL_MS,
  COVER_MAX_BYTES,
  listCoverTemplates,
  prepareRecapture,
  recaptureStatus,
  recaptureGuide,
  cancelRecapture,
  takeDbPendingCaptureCode,
  completePendingCapture,
  captureRoomKey,
  activePending,
  updateCardCopy,
  applyCustomCover,
  compressCoverToJpeg,
  ensureWeappJumpInfo,
  bootstrapAllH5Jumps
};
