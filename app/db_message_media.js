"use strict";
/**
 * 消息媒资元数据（从 db.js 物理迁出，零行为变更）。
 * 只读 community_messages / 本地 uploads；不改表结构、不做 bulk 写。
 */
const fs = require("fs");
const path = require("path");

function attachMessageMediaHelpers(db, appRoot){
  const root = appRoot || __dirname;

  /* 可预览的图片 URL：本地落地副本、企微/个微临时下载链、常见 CDN。 */
  function looksLikeImageUrl(s){
    const u = String(s || "").trim();
    if(!u) return false;
    if(/^\/uploads\/qiwe-media\//i.test(u)) return true;
    if(/^https?:\/\//i.test(u)){
      if(/\.(jpe?g|png|gif|webp|bmp)(\?|#|$)/i.test(u)) return true;
      if(/mmbiz\.qpic\.cn|wx\.qlogo\.cn|wework\.qpic\.cn|qpic\.cn|sinaimg|imunion\.weixin\.qq\.com|tpdownloadmedia|cdn/i.test(u)) return true;
    }
    return false;
  }

  function preferImageUrlOrder(urls){
    const rank = (u)=>{
      const s = String(u || "").toLowerCase();
      if(s.startsWith("/uploads/qiwe-media/")) return 0;
      if(/wework\.qpic\.cn/.test(s)) return 1;
      if(/\.(jpe?g|png|webp)(\?|#|$)/i.test(s)) return 2;
      if(/imunion\.weixin\.qq\.com|tpdownloadmedia/.test(s)) return 3;
      return 4;
    };
    return [...urls].sort((a, b)=>rank(a) - rank(b));
  }

  /* 从社区消息 raw_payload 抽出可预览图片 URL（含企微临时链与本地落地路径） */
  function collectImageUrls(node, out, depth){
    if(depth > 6 || !out || out.length >= 8) return;
    if(typeof node === "string"){
      const s = node.trim();
      if(looksLikeImageUrl(s) && !out.includes(s)) out.push(s);
      return;
    }
    if(Array.isArray(node)){
      for(const x of node) collectImageUrls(x, out, depth + 1);
      return;
    }
    if(node && typeof node === "object"){
      const preferredKeys = [
        "localPreviewUrl", "localPreviewUrls", "_localPreviewUrl", "_localPreviewUrls",
        "fileBigHttpUrl", "fileMiddleHttpUrl", "fileThumbHttpUrl",
        "cloudUrl", "previewUrl", "imageUrl", "thumbUrl"
      ];
      for(const k of preferredKeys){
        if(!(k in node)) continue;
        collectImageUrls(node[k], out, depth + 1);
      }
      for(const [k, v] of Object.entries(node)){
        const key = String(k).toLowerCase();
        if(preferredKeys.some(p=>p.toLowerCase() === key)) continue;
        if(typeof v === "string" && /url|cdn|thumb|image|pic|cover|preview|media|http/.test(key)){
          collectImageUrls(v, out, depth + 1);
        }else if(v && typeof v === "object"){
          collectImageUrls(v, out, depth + 1);
        }
      }
    }
  }

  function mediaMetaForMessageRow(row){
    const text = String(row && row.text || "");
    const placeholder = /^\[[^\]]{0,24}消息\]$/.test(text);
    let msgType = "";
    let urls = [];
    const sid = Number(row && row.source_message_id);
    if(Number.isInteger(sid) && sid > 0){
      try{
        const cm = db.prepare("SELECT msg_type, raw_payload FROM community_messages WHERE id=?").get(sid);
        if(cm){
          msgType = String(cm.msg_type || "").trim();
          let raw = {};
          try{ raw = JSON.parse(cm.raw_payload || "{}"); }catch(e){ raw = {}; }
          collectImageUrls(raw, urls, 0);
          urls = preferImageUrlOrder(urls);
          const localOnly = urls.filter(u => /^\/uploads\/qiwe-media\//i.test(String(u))).filter(rel => {
            try{
              const abs = path.join(root, "public", String(rel).replace(/^\//, "").replace(/\//g, path.sep));
              return fs.existsSync(abs) && fs.statSync(abs).size > 512;
            }catch(e){ return false; }
          });
          if(localOnly.length){
            urls = [localOnly[0]];
          }else if(
            urls.some(u => /^https?:\/\//i.test(String(u)))
            || msgType === "image" || msgType === "media"
            || Number(raw.msgType) === 101 || Number(raw.msgType) === 14
          ){
            urls = [];
          }
        }
      }catch(e){}
    }
    if(!msgType && placeholder){
      const m = text.match(/^\[([^\]]+)消息\]$/);
      msgType = m ? m[1] : "media";
    }
    if((!msgType || msgType === "text") && !urls.length && !placeholder) return null;
    const kind = msgType === "voice" || msgType === "audio" ? "voice"
      : msgType === "weapp" ? "weapp"
      : (urls.length || msgType === "image" || msgType === "media" || placeholder) ? "image"
      : msgType || "media";
    return {
      kind,
      msg_type: msgType || kind,
      urls,
      placeholder: !urls.length && (placeholder || kind === "image" || kind === "media")
    };
  }

  return { looksLikeImageUrl, preferImageUrlOrder, collectImageUrls, mediaMetaForMessageRow };
}

module.exports = { attachMessageMediaHelpers };
