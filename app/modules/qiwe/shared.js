"use strict";
/* QiWe 桥共享：db 代理、常量、范围闸、通用工具 */
/* QiWe 单聊桥：把第三方企微回调转换成患者消息，再通过 QiWe 真实账号发回去。
   文本走患者回复链路；小程序卡片回调用来采集 /msg/sendWeapp 模板。 */
const fs = require("fs");
const path = require("path");
/* 禁止顶层解构 db：循环依赖时会拿到 undefined 并永久失效。 */
function getDb(){
  return require("../../db.js").db;
}
const db = new Proxy({}, {
  get(_t, prop){
    const real = getDb();
    const v = real[prop];
    return typeof v === "function" ? v.bind(real) : v;
  }
});
const { resolvePatient, isPlaceholderDisplayName, friendlyPatientLabel, patientArchiveLabel } = require("../../db.js");
const qiwe = require("../../qiwe.js");
const opsConfig = require("../../ops_config.js");
const groupGate = require("../../group_gate.js");
const triage = require("../../triage.js");
const { logInboundMessage } = require("../../message_log.js");
const { buildPatientReply, responsesToQiweText, miniProgramResponses } = require("../../patient_reply.js");
const { splitReplyBubbles, resolveReplyBubbleConfig } = require("../../reply_bubbles.js");

function outbox(){
  return require("../outbox");
}

// 静态海报只读白名单目录（与 server.js 静态目录同源）：仅此目录下 jpg/jpeg/png 可作为 818 真图发送素材。
const ASSETS_DIR = path.join(__dirname, "..", "..", "public", "assets");
const QIWE_MEDIA_DIR = path.join(__dirname, "..", "..", "public", "uploads", "qiwe-media");

const pendingTemplateCodes = new Map();
const DEDUP_MS = 10 * 60 * 1000;
const PENDING_TEMPLATE_MS = 10 * 60 * 1000;

function now(){ return Date.now(); }

/* 与患者档案同口径：微信名·企微；回调缺名时仍可从社群成员还原。
 * 群消息占位「群友」；企微好友私聊占位「好友」。 */
function patientLogName(doctorId, patientId, fallback, senderId, opts){
  const o = opts || {};
  const hasGroupHint = Object.prototype.hasOwnProperty.call(o, "isGroup");
  const groupHint = hasGroupHint ? { isGroup: !!o.isGroup } : {};
  const did = doctorId != null ? +doctorId : null;
  if(did && patientId){
    try{
      const label = patientArchiveLabel({
        doctorId:did, patientId:+patientId, displayName:fallback,
        channels:"qiwe", externalId:senderId || "", ...groupHint
      });
      if(label && !isPlaceholderDisplayName(label.replace(/·(?:企微|微信|联络表|本地|其他)$/, "").trim())) return label;
    }catch(e){}
  }
  if(patientId){
    try{
      const p = db.prepare("SELECT real_name,display_name FROM patients WHERE id=?").get(patientId);
      if(p){
        const n = String(p.real_name || p.display_name || "").trim();
        if(n && !isPlaceholderDisplayName(n)) return n;
      }
    }catch(e){}
  }
  return friendlyPatientLabel(fallback, senderId, groupHint);
}

/* 回调缺昵称或只给 userId 时：优先用社群成员备注名/群昵称 */
function resolveSenderDisplayName(doctorId, senderId, senderName){
  const raw = String(senderName || "").trim();
  if(raw && !isPlaceholderDisplayName(raw)) return raw.slice(0, 80);
  const sid = String(senderId || "").trim();
  if(sid){
    try{
      const m = db.prepare(`SELECT display_name FROM community_members
        WHERE doctor_id=? AND external_user_id=? AND display_name IS NOT NULL AND trim(display_name)!=''
        ORDER BY id DESC LIMIT 1`).get(doctorId, sid);
      if(m && m.display_name && !isPlaceholderDisplayName(m.display_name)) return String(m.display_name).slice(0, 80);
    }catch(e){}
  }
  return raw || "企微患者";
}

function textBeforeRichDelayMs(){
  if(Object.prototype.hasOwnProperty.call(process.env, "QIWE_TEXT_BEFORE_RICH_DELAY_MS")){
    const n = Number(process.env.QIWE_TEXT_BEFORE_RICH_DELAY_MS);
    return Number.isFinite(n) && n >= 0 ? Math.min(Math.round(n), 10000) : 0;
  }
  return qiwe.DRY_RUN ? 0 : 3000;
}

function sleep(ms){ return new Promise(resolve=>setTimeout(resolve, ms)); }

function hasSentTextPart(sentParts){
  return (sentParts || []).some(p=>{
    const type = String((p && p.type) || "");
    return type === "text"
      || type === "hypertext_atmember"
      || type === "text_atmember_fallback"
      || type === "hypertext_atall"
      || type === "text_atall_fallback"
      || type === "text_fallback";
  });
}

async function delayTextBeforeRich(sentParts, hasRich){
  const ms = hasRich && hasSentTextPart(sentParts) ? textBeforeRichDelayMs() : 0;
  if(ms > 0) await sleep(ms);
  return ms;
}

/* 回调去重落 DB（防重放/防重复处理，红线）：从内存 Map 改为 qiwe_seen 持久表 → 重启仍记得。
   语义与旧内存逻辑 1:1：读时 TTL 清理(超 DEDUP_MS 视为新消息) → 命中返 true(跳过) → 否则登记返 false。 */
function seenDuplicate(key, cur){
  if(!key) return false;
  db.prepare("DELETE FROM qiwe_seen WHERE seen_at < ?").run(cur - DEDUP_MS);
  if(db.prepare("SELECT 1 FROM qiwe_seen WHERE msg_id=?").get(key)) return true;
  db.prepare("INSERT OR IGNORE INTO qiwe_seen(msg_id, seen_at) VALUES(?,?)").run(key, cur);
  return false;
}

function activeDoctorId(cfg){
  if(cfg && cfg.doctorId && db.prepare("SELECT 1 FROM doctors WHERE id=?").get(+cfg.doctorId)) return +cfg.doctorId;
  const first = db.prepare("SELECT id FROM doctors ORDER BY id LIMIT 1").get();
  return first ? first.id : null;
}

function currentQiweDoctorId(cfg){
  const did = Number(cfg && cfg.doctorId);
  return Number.isInteger(did) && did > 0 && db.prepare("SELECT 1 FROM doctors WHERE id=?").get(did) ? did : null;
}

function resolveDirectDoctorId(evt, cfg){
  const did = currentQiweDoctorId(cfg);
  if(did) return did;
  return null;
}

function resolveEventDoctorId(evt, cfg){
  const fallback = currentQiweDoctorId(cfg) || activeDoctorId(cfg);
  if(!evt || !(evt.isGroup || evt.fromRoomId)) return fallback;
  try{
    const community = require("../community");
    const hit = community.findQiweBusinessGroupByRoom
      ? community.findQiweBusinessGroupByRoom(evt.fromRoomId)
      : null;
    if(hit && hit.accepted && hit.primaryDoctorId) return hit.primaryDoctorId;
  }catch(e){}
  return fallback;
}

/* 企微 roomId 形态归一：8 位内部 roomid 与 17 位 chat_id 互为前后缀。
   白名单/群匹配时，命中精确值或「互为前缀」即放行——新增群无论回调下发哪种形态都能匹配，
   且不扩大越界范围（前缀命中仅限白名单既有 ID 的变体，无关群不受影响）。 */
function idAllowedMatch(target, allowed){
  const t = String(target || "").trim();
  if(!t) return false;
  if(allowed.has(t)) return true;
  const min = Math.min(t.length, 8);
  if(min < 8) return false;
  const head = t.slice(0, min);
  for(const a of allowed){
    const s = String(a || "");
    if(s.length < 8) continue;
    if(s.startsWith(head) || t.startsWith(s.slice(0, min))) return true;
  }
  return false;
}

function idAllowed(evt, cfg){
  const targets = String((cfg && cfg.testToId) || "")
    .split(/[\s,，;；]+/)
    .map(x=>x.trim())
    .filter(Boolean);
  if(!targets.length) return true;
  const allowed = new Set(targets);
  // 群消息：范围以群(fromRoomId)为准——不得用登录账号本人(receiverId/loggedInUserId)命中白名单蒙混，
  // 否则只要本人在白名单，任何未列入的群都被放行（欢迎/回复真发到越界群，codex 复核抓出）。
  if(evt.isGroup || evt.fromRoomId){
    return idAllowedMatch(evt.fromRoomId, allowed);
  }
  return [evt.senderId, evt.receiverId, evt.replyToId, evt.loggedInUserId].some(x=>idAllowedMatch(x, allowed));
}

/* 严格版白名单（仅非文字转人工兜底路径用）：与 idAllowed 完全一致，唯独 DM 分支去掉 evt.loggedInUserId——
   loggedInUserId 在 raw.userId 缺失时会回落成 selfUserId（qiwe.js normalizeEvent），若 selfUserId∈testToId（常见配置），
   「省略 userId、sender/receiver 均不在白名单」的越界伪造消息会借此过 idAllowed。转人工 pending 队列不该被这种自回落越界消息污染，
   故只认真实发件三元 [senderId, receiverId, replyToId]（群分支不变，仍只认 fromRoomId）。text/voice 既存路径的 idAllowed 不动（本批不放大 blast radius）。 */
function idAllowedStrict(evt, cfg){
  const targets = String((cfg && cfg.testToId) || "")
    .split(/[\s,，;；]+/)
    .map(x=>x.trim())
    .filter(Boolean);
  if(!targets.length) return true;
  const allowed = new Set(targets);
  if(evt.isGroup || evt.fromRoomId){
    return idAllowedMatch(evt.fromRoomId, allowed);
  }
  return [evt.senderId, evt.receiverId, evt.replyToId].some(x=>idAllowedMatch(x, allowed));
}

function cleanText(v, n){
  return String(v == null ? "" : v).trim().slice(0, n || 240);
}

function publicGroupName(v){
  return cleanText(v, 120).replace(/（群名待甲方确认）|\(群名待甲方确认\)/g, "").trim();
}

function qiweScriptVars(doctorId, patientName, extra){
  let d = {};
  try{ d = db.prepare("SELECT name,hospital,dept,specialty,group_name FROM doctors WHERE id=?").get(+doctorId) || {}; }catch(e){ d = {}; }
  const ext = extra || {};
  return {
    patient: cleanText(patientName || ext.patient || "", 80),
    group: publicGroupName(ext.group || d.group_name || ""),
    doctor: cleanText(d.name || "", 80),
    dept: cleanText(d.dept || d.specialty || "", 80),
    hospital: cleanText(d.hospital || "", 120),
    senderId: cleanText(ext.senderId || "", 120),
    roomId: cleanText(ext.roomId || "", 120)
  };
}

function configuredScript(doctorId, keys, vars){
  const list = Array.isArray(keys) ? keys : [keys];
  const scripts = opsConfig.scripts(doctorId);
  for(const k of list){
    const v = opsConfig.render(opsConfig.scriptValue(scripts, k), vars);
    if(v) return v;
  }
  return "";
}

/* 缺陷二修（甲方验收实弹 2026-07-03 夜·测试群①实拍；codex 复核续修「0/前导0」形态）：@指定成员 userId 防呆。
   qiweapi sendHyperText 的 @段 text=对方 userId，平台把无效 userId 按 0 处理，而「text 空或 0 = @所有人」
   （api-344613914 官方语义，见 sendHyperText 注释）——非数字（生产冒烟 senderId="smoke-lowllm-0703"）与纯 0/前导 0
   形态（"0"/"00"/"0123"，qiweapi 皆当 0）都会被渲染成 @所有人（真实患者群事故隐患）。
   fail-closed：仅「不带前导 0 的正整数串」才允许走 sendHyperText @指定成员——真实 qiwe userId 恒为此形态
   （如 1688857254811415）；"0"/"00"/前导 0/非数字一律跳过 @、直接 sendText（内容照发，只降 @）。
   needAtAll（显式 @所有人广播）语义不动。 */
function atMemberIdSendable(v){
  return /^[1-9]\d*$/.test(String(v == null ? "" : v).trim());
}

function escapeRegExp(s){
  return String(s || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function realMentionName(v){
  let s = cleanText(v, 80).replace(/^@+/, "").trim();
  s = s.replace(/^(?:微信的|企业微信的|微信用户)/, "").trim();
  s = s.replace(/[，,。；;：:\s]+$/g, "").trim();
  if(!s || s === "企微患者" || s === "新朋友" || s === "新成员") return "";
  if(/小助手|助手|机器人|系统|企业微信团队|群聊|外部群聊|邀请|欢迎/.test(s)) return "";
  return s.slice(0, 40);
}

/* 群聊 @ 与正文分隔：固定模板（编号/欢迎/安全话术）用换行；AI 自由回答保留空格。 */
function atBodySeparatorForSource(source){
  const s = String(source || "").trim();
  if(s === "ai_triage" || s === "dialogue_agent" || s === "triage_error") return " ";
  if(!s) return " "; // 旧草稿/未知来源：保守保留空格，避免误伤 AI
  return "\n";
}

function ensureTextMention(text, patientName, opts){
  opts = opts || {};
  const body = String(text || "").trim();
  const name = realMentionName(patientName);
  if(!name || !body || body.startsWith("@")) return body;
  const sep = opts.sep === "\n" ? "\n" : " ";
  // 文案已以姓名开头时仍要在姓名与正文间留分隔，避免「@Chaxic拉肚子」粘连
  if(body.startsWith(name)){
    const rest = body.slice(name.length).replace(/^[，,、：:\s]*/, "");
    return rest ? ("@" + name + sep + rest) : ("@" + name);
  }
  return "@" + name + sep + body;
}

function stripTextMention(text, patientName){
  const body = String(text || "").trim();
  const name = realMentionName(patientName);
  if(!name || !body) return body;
  const re = new RegExp("^@?" + escapeRegExp(name) + "[，,、：:\\s]*");
  const stripped = body.replace(re, "").trim();
  return stripped || body;
}

function httpUrl(v){
  const s = cleanText(v, 1000);
  return /^https?:\/\//i.test(s) ? s : "";
}

/* 企微/微信拉链接卡 icon 时，URL path 含中文（如 cover-4-联络表-xxx.png）常失败并回退默认链环图。
   对 path 分段做百分号编码；已是 %XX 的段保持不动。 */
function encodeUrlForWechatFetch(v){
  const raw = httpUrl(v);
  if(!raw) return "";
  try{
    const u = new URL(raw);
    u.pathname = u.pathname
      .split("/")
      .map((seg)=>{
        if(!seg) return "";
        try{ return encodeURIComponent(decodeURIComponent(seg)); }
        catch(e){ return encodeURIComponent(seg); }
      })
      .join("/");
    return u.toString();
  }catch(e){
    return raw;
  }
}

/* 相对深链补全（域名深链承接，甲方 2026-07-03，fail-closed）：seed 里深链卡 linkUrl 存相对路径 /?p=<key>（可移植纪律：不硬编码域名）。
   发企微链接卡片必须是绝对 https；以 "/" 开头的相对 linkUrl 用 publicOrigin() 补全成绝对地址后再交 httpUrl 校验。
   PUBLIC_ORIGIN 为空 → 返回空串（下游据此跳过该卡，绝不发相对路径死链）。非 "/" 开头（已是绝对 http/s 或其它）按原样返回、由 httpUrl 兜底。 */
function resolveLinkUrl(v){
  const s = cleanText(v, 1000);
  if(/^\//.test(s)){
    const origin = publicOrigin();
    return origin ? origin + s : "";   // origin 空 → 空串 → linkCardFromResponse 跳过该卡（fail-closed，不发死链）
  }
  return s;
}

function publicOrigin(){
  // 可移植纪律（CLAUDE.md）：app 代码不硬编码任何 self-URL/域名，只从 env 注入（本地=空→localhost 由部署侧配）。
  // 无 env → 返回空串；下游 defaultLinkIconUrl 据此回退空 iconUrl（不因缺域名丢卡，见 linkCardFromResponse）。
  return cleanText(process.env.PUBLIC_ORIGIN || process.env.APP_PUBLIC_ORIGIN || "", 240).replace(/\/+$/, "");
}

function defaultLinkIconUrl(){
  const origin = publicOrigin();
  // /assets/chunyu-doctor-icon.png 在 yht 域名下会被官网 SPA 吃掉返回 HTML；
  // 改用 /uploads/link-icons/default.png（nginx ^~ /uploads/ 直出静态文件）。
  return origin ? origin + "/uploads/link-icons/default.png" : "";
}


module.exports = {
  fs, path, db, qiwe, opsConfig, groupGate, triage,
  resolvePatient, isPlaceholderDisplayName, friendlyPatientLabel, patientArchiveLabel,
  logInboundMessage, buildPatientReply, responsesToQiweText, miniProgramResponses,
  splitReplyBubbles, resolveReplyBubbleConfig,
  outbox, ASSETS_DIR, QIWE_MEDIA_DIR,
  pendingTemplateCodes, DEDUP_MS, PENDING_TEMPLATE_MS,
  now, patientLogName, resolveSenderDisplayName,
  textBeforeRichDelayMs, sleep, hasSentTextPart, delayTextBeforeRich,
  seenDuplicate, activeDoctorId, currentQiweDoctorId, resolveDirectDoctorId, resolveEventDoctorId, idAllowed, idAllowedStrict, idAllowedMatch,
  cleanText, publicGroupName, qiweScriptVars, configuredScript,
  atMemberIdSendable, escapeRegExp, realMentionName, atBodySeparatorForSource, ensureTextMention, stripTextMention,
  httpUrl, encodeUrlForWechatFetch, resolveLinkUrl, publicOrigin, defaultLinkIconUrl
};
