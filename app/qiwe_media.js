/* 企微/个微入站图片：QiWe 换链 + 落地本地，供分诊台稳定预览。 */
const fs = require("fs");
const path = require("path");
const { db, collectImageUrls, preferImageUrlOrder } = require("./db.js");
const qiwe = require("./qiwe.js");

const QIWE_MEDIA_DIR = path.join(__dirname, "public", "uploads", "qiwe-media");

function sniffImageExt(buf){
  if(!buf || buf.length < 4) return ".jpg";
  if(buf[0] === 0x89 && buf[1] === 0x50) return ".png";
  if(buf[0] === 0x47 && buf[1] === 0x49) return ".gif";
  if(buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46) return ".webp";
  return ".jpg";
}

function ensureMediaDir(){
  if(!fs.existsSync(QIWE_MEDIA_DIR)) fs.mkdirSync(QIWE_MEDIA_DIR, { recursive:true });
}

function readRawCommunityMessage(id){
  const row = db.prepare("SELECT id,msg_type,external_msg_id,raw_payload FROM community_messages WHERE id=?").get(+id);
  if(!row) return null;
  let raw = {};
  try{ raw = JSON.parse(row.raw_payload || "{}"); }catch(e){ raw = {}; }
  if(!raw.msgData || typeof raw.msgData !== "object") raw.msgData = {};
  return { row, raw };
}

function localUrlsFromRaw(raw){
  const urls = [];
  collectImageUrls(raw, urls, 0);
  return preferImageUrlOrder(urls).filter(u => /^\/uploads\/qiwe-media\//i.test(String(u)));
}

function existingLocalFiles(urls){
  return urls.filter(rel => {
    try{
      const abs = path.join(__dirname, "public", String(rel).replace(/^\//, "").replace(/\//g, path.sep));
      return fs.existsSync(abs) && fs.statSync(abs).size > 512;
    }catch(e){ return false; }
  });
}

async function fetchCloudUrls(raw, msgType, cfg){
  const md = raw.msgData || {};
  const mt = Number(raw.msgType != null ? raw.msgType : msgType) || 0;
  const out = [];

  if(mt === 101 && qiwe.wxPersonalDownloadParams(md, mt)){
    for(const ft of [2, 3, 1]){
      try{
        const dl = await qiwe.downloadWxPersonalFile(md, mt, cfg, ft);
        const u = String(((dl && dl.data) || {}).cloudUrl || "").trim();
        if(u && !out.includes(u)) out.push(u);
        if(out.length) break;
      }catch(e){
        if(ft === 1) console.warn("[qiwe_media] wxDownload", e && e.message);
      }
    }
  }

  const params = qiwe.imageDownloadParams(md, mt);
  if(!out.length && params){
    try{
      const dl = await qiwe.downloadWxWorkFile(params, cfg);
      const u = String(((dl && dl.data) || {}).cloudUrl || "").trim();
      if(u) out.push(u);
    }catch(e){
      console.warn("[qiwe_media] wxWorkDownload", e && e.message);
    }
  }

  if(!out.length){
    for(const u of qiwe.extractImageHttpUrls(md)){
      if(/^https?:\/\//i.test(u) && !out.includes(u)) out.push(u);
    }
  }
  return out;
}

async function persistCommunityMessageMedia(communityMessageId, opts){
  const id = +communityMessageId;
  if(!Number.isInteger(id) || id <= 0) return { ok:false, urls:[] };
  const pack = readRawCommunityMessage(id);
  if(!pack) return { ok:false, urls:[] };

  const cached = existingLocalFiles(localUrlsFromRaw(pack.raw));
  if(cached.length) return { ok:true, urls:cached, cached:true };

  ensureMediaDir();
  const cfg = (opts && opts.cfg) || qiwe.loadConfig();
  const cloudUrls = await fetchCloudUrls(pack.raw, pack.row.msg_type, cfg);
  const localUrls = [];
  const safeId = String(pack.row.external_msg_id || pack.row.id).replace(/[^\w.-]/g, "").slice(0, 64) || String(pack.row.id);

  for(let i=0; i<Math.min(cloudUrls.length, 3); i++){
    const u = cloudUrls[i];
    if(!u) continue;
    try{
      const buf = await qiwe.getUrlBuffer(u, 25000);
      if(!buf || buf.length <= 512) continue;
      const filename = `cm${pack.row.id}-${safeId}${localUrls.length ? "-"+localUrls.length : ""}${sniffImageExt(buf)}`;
      fs.writeFileSync(path.join(QIWE_MEDIA_DIR, filename), buf);
      localUrls.push("/uploads/qiwe-media/" + filename);
    }catch(e){
      console.warn("[qiwe_media] save", e && e.message);
    }
  }

  if(localUrls.length){
    pack.raw.msgData.localPreviewUrl = localUrls[0];
    pack.raw.msgData._localPreviewUrls = localUrls;
    require("./modules/community/repo.js").setRawPayload(pack.row.id, JSON.stringify(pack.raw));
    return { ok:true, urls:localUrls, persisted:true };
  }

  return { ok:false, urls:[], reason:"download_failed" };
}

function adminMediaProxyUrl(communityMessageId, index){
  const q = `communityMessageId=${encodeURIComponent(String(communityMessageId))}`;
  return index > 0 ? `/api/admin/messages/media?${q}&index=${index}` : `/api/admin/messages/media?${q}`;
}

function mimeForPath(rel){
  const ext = path.extname(String(rel || "")).toLowerCase();
  if(ext === ".png") return "image/png";
  if(ext === ".gif") return "image/gif";
  if(ext === ".webp") return "image/webp";
  return "image/jpeg";
}

/** 1x1 透明 PNG：换链失败时仍返回 200，避免 <img>/ElImage 在控制台刷 404 */
const PLACEHOLDER_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO5W2ZQAAAAASUVORK5CYII=",
  "base64"
);

async function serveAdminMessageMedia(req, res, communityMessageId, index){
  const result = await persistCommunityMessageMedia(communityMessageId, {});
  const urls = result.urls || [];
  if(!urls.length){
    return {
      status:200,
      body:PLACEHOLDER_PNG,
      headers:{
        "Content-Type":"image/png",
        "Cache-Control":"no-store",
        "X-Media-Status":"unavailable",
        "X-Media-Error":"expired_or_fetch_failed"
      }
    };
  }

  const idx = Number.isFinite(+index) && +index >= 0 ? Math.min(+index, urls.length - 1) : 0;
  const rel = urls[idx];
  const abs = path.join(__dirname, "public", String(rel).replace(/^\//, "").replace(/\//g, path.sep));
  if(!fs.existsSync(abs)){
    return {
      status:200,
      body:PLACEHOLDER_PNG,
      headers:{
        "Content-Type":"image/png",
        "Cache-Control":"no-store",
        "X-Media-Status":"missing_file"
      }
    };
  }
  const buf = fs.readFileSync(abs);
  return { status:200, body:buf, headers:{ "Content-Type":mimeForPath(rel), "Cache-Control":"public, max-age=86400" } };
}

async function backfillAllImageMessages(options){
  const opts = options || {};
  const limit = Number(opts.limit) > 0 ? Number(opts.limit) : 500;
  const rows = db.prepare(`SELECT id FROM community_messages
    WHERE msg_type IN ('image','media') ORDER BY id DESC LIMIT ?`).all(limit);
  let ok = 0, fail = 0;
  for(const r of rows){
    try{
      const out = await persistCommunityMessageMedia(r.id, opts);
      if(out.urls && out.urls.length) ok++; else fail++;
    }catch(e){ fail++; }
  }
  return { checked:rows.length, ok, fail };
}

module.exports = {
  persistCommunityMessageMedia,
  adminMediaProxyUrl,
  serveAdminMessageMedia,
  backfillAllImageMessages,
  QIWE_MEDIA_DIR
};
