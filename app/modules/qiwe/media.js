"use strict";
/* QiWe 入站图片预览 + 818 海报素材 */
const S = require("./shared");
const { fs, path, db, qiwe, ASSETS_DIR, QIWE_MEDIA_DIR, publicOrigin } = S;

function sniffImageExt(buf){
  if(!buf || buf.length < 4) return ".jpg";
  if(buf[0] === 0x89 && buf[1] === 0x50) return ".png";
  if(buf[0] === 0x47 && buf[1] === 0x49) return ".gif";
  if(buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46) return ".webp";
  return ".jpg";
}

/* 入站图片：尽快换成可给分诊台预览的地址。
   ① 个微 101 回调常自带 fileBig/Middle/ThumbHttpUrl → 先写入 raw，再尽力落地本地副本；
   ② 企微 14 无 HTTP 链 → /cloud/wxWorkDownload 换 cloudUrl 再落地。
   全程短超时、失败不阻断转人工草稿。 */
async function attachInboundImagePreview(evt, cfg){
  if(!evt || !evt.raw) return null;
  const md = (evt.msgData && typeof evt.msgData === "object") ? evt.msgData : {};
  if(!evt.raw.msgData || typeof evt.raw.msgData !== "object") evt.raw.msgData = Object.assign({}, md);

  let urls = qiwe.extractImageHttpUrls(evt.raw.msgData);
  const msgType = Number(evt.raw.msgType != null ? evt.raw.msgType : evt.msgType);

  // 个微 101：优先 /cloud/wxDownload 换 OSS 链（imunion 临时链极易过期）
  if(Number(msgType) === 101 && qiwe.wxPersonalDownloadParams(evt.raw.msgData, msgType)){
    for(const ft of [2, 3, 1]){
      try{
        const dl = await qiwe.downloadWxPersonalFile(evt.raw.msgData, msgType, cfg, ft);
        const cloudUrl = cleanText((dl && dl.data && dl.data.cloudUrl) || "", 2000);
        if(/^https?:\/\//i.test(cloudUrl)){
          urls = [cloudUrl];
          evt.raw.msgData.cloudUrl = cloudUrl;
          break;
        }
      }catch(e){
        if(ft === 1) console.warn("[qiwe] 个微 wxDownload 换链失败：", e && e.message);
      }
    }
  }

  if(!urls.length && (evt.isImage || qiwe.isImageMsgType(evt.msgType))){
    const params = qiwe.imageDownloadParams(evt.raw.msgData, evt.msgType);
    if(params){
      try{
        const dl = await qiwe.downloadWxWorkFile(params, cfg);
        const cloudUrl = cleanText((dl && dl.data && (dl.data.cloudUrl || dl.data.url)) || "", 2000);
        if(/^https?:\/\//i.test(cloudUrl)){
          urls = [cloudUrl];
          evt.raw.msgData.cloudUrl = cloudUrl;
        }
      }catch(e){
        console.warn("[qiwe] 图片下载换链失败：", e && e.message);
      }
    }
  }
  if(!urls.length) return null;

  // 先把远程链写回，保证即便落地失败分诊台也能尝试预览（新鲜链可用）
  evt.raw.msgData._remotePreviewUrls = urls.slice(0, 3);

  let localRel = "";
  try{
    if(!fs.existsSync(QIWE_MEDIA_DIR)) fs.mkdirSync(QIWE_MEDIA_DIR, { recursive:true });
    // 逐个 URL 尝试：避免只用 fileBigHttpUrl（大图）导致落地失败。
    const tryUrls = urls.slice(0, 5);
    const timeoutMs = 9000; // 临时链可能较慢：给更宽裕
    for(const u of tryUrls){
      if(!u || !/^https?:\/\//i.test(String(u))) continue;
      const buf = await qiwe.getUrlBuffer(u, timeoutMs);
      if(buf && buf.length && buf.length > 1024){
        const safeId = String(evt.externalMsgId || Date.now()).replace(/[^\w.-]/g, "").slice(0, 80) || String(Date.now());
        const filename = safeId + sniffImageExt(buf);
        const abs = path.join(QIWE_MEDIA_DIR, filename);
        fs.writeFileSync(abs, buf);
        localRel = "/uploads/qiwe-media/" + filename;
        evt.raw.msgData.localPreviewUrl = localRel;
        evt.raw.msgData._localPreviewUrls = [localRel];
        break;
      }
    }
  }catch(e){
    console.warn("[qiwe] 图片落地失败：", e && e.message);
  }
  return { remoteUrls:urls, localUrl:localRel || null };
}


function hasPosterImageResponse(reply){
  const responses = Array.isArray(reply) ? reply : (reply && reply.responses);
  return (Array.isArray(responses) ? responses : []).some(r=>
    r && r.type === "image" && (r.page === "poster" || r.svg === "poster"));
}

function doctorPosterImagePath(doctorId){
  let content = {};
  try{ content = JSON.parse((db.prepare("SELECT content FROM doctors WHERE id=?").get(+doctorId) || {}).content || "{}"); }catch(e){ content = {}; }
  const s = String((content && content.posterImage) || "").trim();
  // 白名单：仅 /assets/<basename>.{jpg,jpeg,png}，basename 不含路径分隔/穿越段（与 ui.js validPosterImage 同口径）。
  if(!/^\/assets\/[A-Za-z0-9_.\-]+\.(jpg|jpeg|png)$/i.test(s)) return "";
  return s;
}

function resolvePosterAsset(doctorId, reply){
  if(!doctorId || !hasPosterImageResponse(reply)) return null;
  return loadPosterAssetBytes(doctorId);
}

/* deliverOutbox（医助确认发送）路径专用：只有持久化 row（无活 reply 对象），故按 code 反查该规则响应判是否含海报 image 响应。
   与 codeNativeWeappAllowed 同源的确定性 DB 反查（不加 payload 字段、旧 pending 行零 schema 变更、向后兼容）。同样仅在开态被调用。 */
function resolvePosterAssetByCode(doctorId, code){
  if(!doctorId || !code) return null;
  let responses = [];
  try{
    const r = db.prepare("SELECT responses FROM rules WHERE doctor_id=? AND code=? AND enabled=1").get(doctorId, String(code));
    const parsed = r && r.responses ? JSON.parse(r.responses) : [];
    responses = Array.isArray(parsed) ? parsed : [];
  }catch(e){ responses = []; }
  if(!hasPosterImageResponse({ responses })) return null;
  return loadPosterAssetBytes(doctorId);
}

function resolveOutboundImageAsset(url){
  const rel = String(url || "").trim();
  if(!/^\/uploads\/outbound-assets\/[A-Za-z0-9_.-]+\.(jpg|jpeg|png|webp|gif)$/i.test(rel)) return null;
  const filename = path.basename(rel);
  const resolved = path.resolve(path.join(__dirname, "..", "..", "public", "uploads", "outbound-assets", filename));
  let buffer = null;
  try{ if(fs.existsSync(resolved)) buffer = fs.readFileSync(resolved); }catch(e){ buffer = null; }
  if(!buffer || !buffer.length) return null;
  const origin = publicOrigin();
  return { path:resolved, filename, buffer, fileUrl:origin ? origin + rel : "" };
}

// 共用：读该医生 content.posterImage 真实 jpg 字节（白名单 + 路径穿越双防护）。无 posterImage / 非法 / 文件缺失 → null。
function loadPosterAssetBytes(doctorId){
  const rel = doctorPosterImagePath(doctorId);
  if(!rel) return null;
  const basename = rel.replace(/^\/assets\//, "");
  const resolved = path.resolve(path.join(ASSETS_DIR, basename));
  // 路径穿越二次防护：解析后的绝对路径必须仍在 ASSETS_DIR 内（前缀 + 分隔符锚定，杜绝 assetsX 同前缀绕过）。
  if(resolved !== path.resolve(ASSETS_DIR, basename)) return null;
  if(resolved.indexOf(path.resolve(ASSETS_DIR) + path.sep) !== 0) return null;
  let buffer = null;
  try{ if(fs.existsSync(resolved)) buffer = fs.readFileSync(resolved); }catch(e){ buffer = null; }
  if(!buffer || !buffer.length) return null;
  const origin = publicOrigin();
  return { path:resolved, filename:basename, buffer, fileUrl:origin ? origin + rel : "" };
}

/* deliverOutbox 发原生卡前的二次判定（fail-closed，堵 105/909 fallback 冒充原生直达洞）：
   按 doctorId+code 取该 code 当前规则响应，用与 prepareDelivery 同源的 nativeWeappResponses
   (miniProgramResponses ∘ nativeWeappAllowedResponse) 判定是否允许企微原生直达。
   为何必要：草稿旗标 weappReadyAtDraft 对「缺该字段的旧 pending 行 / 手工构造 payload」(===undefined)
   会因 !==false 默认放行——而 105 或其它 status=fallback_short_link 的响应，其模板可能经同一短链
   被 hydrateRelatedTemplates 补成 ready，于是 deliverOutbox 会误发原生卡冒充「已直达」。此处按 code 当前规则响应重判：
   只有响应确实允许原生直达（非 fallback_short_link / nativeCard!==false）才返回 true；
   code 不存在 / 规则关闭 / 无原生候选响应 → false（缺字段旧行也不发原生卡，fail-closed）。 */

module.exports = {
  sniffImageExt,
  attachInboundImagePreview,
  hasPosterImageResponse,
  doctorPosterImagePath,
  resolvePosterAsset,
  resolvePosterAssetByCode,
  resolveOutboundImageAsset,
  loadPosterAssetBytes
};
