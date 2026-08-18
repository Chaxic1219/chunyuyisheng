/* 企业微信接入核心：回调验签 + AES 加解密(WXBizMsgCrypt) + URL 验证 + access_token + 出站发送。
   纯 Node 内置 crypto + https，零运行时依赖。
   - 未配置（缺 Token/EncodingAESKey）时：回调路由返回 501，不做任何外呼。
   - WECOM_DRY_RUN=1 时：access_token / send 不真正联网，只打日志，便于离线自测与现有测试。
   渠道无关：本模块只负责"搬运字节"，风险判定/是否自动发等安全不变量仍全部在 triage.js / community.js。 */
const crypto = require("crypto");
const https = require("https");
const { db } = require("./db.js");

const DRY_RUN = process.env.WECOM_DRY_RUN === "1";
const tokenCache = new Map(); // "corpid:secret" -> { value, expiresAt, inflight }

/* ---------- 配置 ---------- */
function envConfig(){
  return {
    corpId: process.env.WECOM_CORP_ID || "",
    secret: process.env.WECOM_SECRET || "",
    callbackToken: process.env.WECOM_CALLBACK_TOKEN || "",
    aesKey: process.env.WECOM_AES_KEY || "",
    robotKey: process.env.WECOM_ROBOT_KEY || ""
  };
}
function loadConfig(){
  const env = envConfig();
  let row = null;
  try{ row = db.prepare("SELECT * FROM wecom_configs ORDER BY id DESC LIMIT 1").get(); }catch(e){}
  return {
    corpId: (row && row.corp_id) || env.corpId,
    secret: (row && row.secret) || env.secret,
    callbackToken: (row && row.callback_token) || env.callbackToken,
    aesKey: (row && row.encoding_aes_key) || env.aesKey,
    robotKey: (row && row.robot_key) || env.robotKey,
    agentId: (row && row.agent_id) || process.env.WECOM_AGENT_ID || "",
    doctorId: (row && row.doctor_id) || (process.env.WECOM_DOCTOR_ID ? +process.env.WECOM_DOCTOR_ID : null)
  };
}
function isConfigured(){ const c = loadConfig(); return !!(c.callbackToken && c.aesKey); }
function saveConfig(input){
  const v = k => String(input[k] == null ? "" : input[k]).trim().slice(0, 200);
  db.prepare(`INSERT INTO wecom_configs(doctor_id,corp_id,secret,agent_id,callback_token,encoding_aes_key,robot_key,kf_open_kfid,note,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?)`).run(
    input.doctorId ? +input.doctorId : null, v("corpId"), v("secret"), v("agentId"),
    v("callbackToken"), v("aesKey"), v("robotKey"), v("openKfid"), v("note"), new Date().toISOString()
  );
  const c = loadConfig();
  // 回包脱敏：不回显 secret / aesKey 原文
  return { corpId:c.corpId, agentId:c.agentId, callbackToken: c.callbackToken ? "已配置" : "",
    aesKey: c.aesKey ? "已配置" : "", secret: c.secret ? "已配置" : "", robotKey: c.robotKey ? "已配置" : "" };
}

/* ---------- 验签 / 加解密（WXBizMsgCrypt: AES-256-CBC, IV=key[0:16], PKCS7, 块=32） ---------- */
function signature(token, timestamp, nonce, encrypt){
  return crypto.createHash("sha1").update([String(token), String(timestamp), String(nonce), String(encrypt)].sort().join("")).digest("hex");
}
function aesKeyBytes(encodingAESKey){
  const k = Buffer.from(encodingAESKey + "=", "base64");
  if(k.length !== 32) throw new Error("EncodingAESKey 非法（解码后应为 32 字节）");
  return k;
}
function decrypt(encodingAESKey, encrypted){
  const key = aesKeyBytes(encodingAESKey);
  const decipher = crypto.createDecipheriv("aes-256-cbc", key, key.subarray(0, 16));
  decipher.setAutoPadding(false);
  let buf = Buffer.concat([decipher.update(Buffer.from(encrypted, "base64")), decipher.final()]);
  const pad = buf[buf.length - 1];
  if(pad < 1 || pad > 32) throw new Error("AES 填充非法");
  buf = buf.subarray(0, buf.length - pad);
  const msgLen = buf.readUInt32BE(16);            // 16 字节随机 + 4 字节长度(大端) + msg + receiveId
  const message = buf.subarray(20, 20 + msgLen).toString("utf8");
  const receiveId = buf.subarray(20 + msgLen).toString("utf8");
  return { message, receiveId };
}
function encrypt(encodingAESKey, message, receiveId){
  const key = aesKeyBytes(encodingAESKey);
  const msg = Buffer.from(message, "utf8");
  const lenBuf = Buffer.alloc(4); lenBuf.writeUInt32BE(msg.length, 0);
  let raw = Buffer.concat([crypto.randomBytes(16), lenBuf, msg, Buffer.from(String(receiveId), "utf8")]);
  const pad = 32 - (raw.length % 32);             // PKCS7（块=32，余 0 也补 32）
  raw = Buffer.concat([raw, Buffer.alloc(pad, pad)]);
  const cipher = crypto.createCipheriv("aes-256-cbc", key, key.subarray(0, 16));
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(raw), cipher.final()]).toString("base64");
}

/* URL 首次验证：校验签名 → 解密 echostr → 返回明文（原样回给企微，不是 JSON） */
function verifyUrl(cfg, { msg_signature, timestamp, nonce, echostr }){
  if(signature(cfg.callbackToken, timestamp, nonce, echostr) !== msg_signature) throw new Error("URL 验证签名不匹配");
  return decrypt(cfg.aesKey, echostr).message;
}
/* 业务回调：校验签名 → 解密 <Encrypt> 密文 → { message(xml), receiveId } */
function decryptCallback(cfg, { msg_signature, timestamp, nonce }, encryptText){
  if(signature(cfg.callbackToken, timestamp, nonce, encryptText) !== msg_signature) throw new Error("回调签名不匹配");
  return decrypt(cfg.aesKey, encryptText);
}

/* ---------- 回调防重放（独立于 decryptCallback，避免破坏 _wecomtest 的固定 timestamp 断言）----------
   纯内存 + 零依赖。由 server.js 回调路由层在「验签前/后」调用：
   - timestamp 新鲜度：拒绝过期/超前的回调（企微回调 timestamp 为秒级 epoch）。
   - nonce 去重：缓存近窗口内见过的 nonce，命中即判定为重放并丢弃。
   定位：搬运层安全（不碰 risk/urgency/canAutoSend 等业务不变量）。 */
const REPLAY_WINDOW_MS = 5 * 60 * 1000;          // ±5 分钟新鲜度窗口
const seenNonces = new Map();                    // nonce -> 首次见到的本地时间戳(ms)
function freshTimestamp(timestamp, nowMs){
  const ts = Number(timestamp);
  if(!Number.isFinite(ts) || ts <= 0) return false;        // 缺/非法 timestamp → 不新鲜（拒绝）
  const tsMs = ts * 1000;                                  // 企微回调 timestamp 为秒
  const cur = Number.isFinite(nowMs) ? nowMs : Date.now();
  return Math.abs(cur - tsMs) <= REPLAY_WINDOW_MS;
}
/* 返回 true=首次（放行）；false=空/缺 nonce 或窗口内重复 nonce（重放，拒绝）。顺带惰性清理过期项。
   企微回调本就总带 nonce，故"缺 nonce 直接拒"更严且无副作用（不会误拒合法回调），避免无 nonce 回调绕过去重。 */
function seenNonce(nonce, nowMs){
  const cur = Number.isFinite(nowMs) ? nowMs : Date.now();
  for(const [k, t] of seenNonces){ if(cur - t > REPLAY_WINDOW_MS) seenNonces.delete(k); }
  const key = String(nonce == null ? "" : nonce);
  if(!key) return false;                                   // 空/缺 nonce → 拒绝（不放行，堵防重放绕过）
  if(seenNonces.has(key)) return false;
  seenNonces.set(key, cur);
  return true;
}
/* 组合判定：新鲜 且 非重放 nonce → true（放行）；否则 false（拒绝/丢弃）。 */
function callbackReplayOk({ timestamp, nonce }, nowMs){
  return freshTimestamp(timestamp, nowMs) && seenNonce(nonce, nowMs);
}

/* ---------- XML 解析（回调体很小，正则足够；CDATA 兼容） ---------- */
function xmlField(xml, tag){
  const m = new RegExp("<" + tag + ">(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</" + tag + ">").exec(xml || "");
  return m ? m[1] : "";
}
function extractEncrypt(xmlBody){ return xmlField(xmlBody, "Encrypt"); }
/* 把企微回调 XML 归一化为 community.handleInbound 的 input；区分客服事件与普通文本消息 */
function parseInboundXml(xml){
  const event = xmlField(xml, "Event");
  if(event === "kf_msg_or_event"){
    return { kind:"kf_event", token: xmlField(xml, "Token"), openKfid: xmlField(xml, "OpenKfId") };
  }
  const msgType = xmlField(xml, "MsgType");
  if(msgType === "text"){
    const from = xmlField(xml, "FromUserName");
    const chatId = xmlField(xml, "ChatId");
    return { kind:"text", input:{
      channelType:"wecom",
      externalGroupId: chatId || ("user-" + from),
      externalUserId: from,
      senderName: from,
      senderRole:"patient",
      msgType:"text",
      text: xmlField(xml, "Content"),
      externalMsgId: xmlField(xml, "MsgId"),
      rawPayload: xml
    }};
  }
  if(msgType === "image" || msgType === "voice" || msgType === "file" || msgType === "video"){
    const from = xmlField(xml, "FromUserName");
    return { kind:"media", mediaType:msgType, input:{
      channelType:"wecom",
      externalGroupId: xmlField(xml, "ChatId") || ("user-" + from),
      externalUserId: from,
      senderName: from,
      senderRole:"patient",
      msgType,
      mediaId: xmlField(xml, "MediaId"),
      picUrl: xmlField(xml, "PicUrl"),
      format: xmlField(xml, "Format"),
      externalMsgId: xmlField(xml, "MsgId"),
      rawPayload: xml
    }};
  }
  if(xmlField(xml, "Event") === "add_to_chat" || msgType === "event"){
    return { kind:"event", event: xmlField(xml, "Event") };
  }
  return { kind:"other", msgType, event };
}

/* ---------- access_token（内存缓存 + 并发去重，DRY_RUN 不联网） ---------- */
function httpsGetJson(url){
  return new Promise((resolve, reject)=>{
    https.get(url, r=>{ let d=""; r.on("data", c=>d+=c); r.on("end", ()=>{ try{ resolve(JSON.parse(d)); }catch(e){ reject(new Error("企微返回非 JSON")); } }); }).on("error", reject);
  });
}
function httpsPostJson(url, body){
  return new Promise((resolve, reject)=>{
    const data = Buffer.from(JSON.stringify(body));
    const u = new URL(url);
    const req = https.request({ method:"POST", hostname:u.hostname, path:u.pathname + u.search,
      headers:{ "Content-Type":"application/json", "Content-Length":data.length } },
      r=>{ let d=""; r.on("data", c=>d+=c); r.on("end", ()=>{ try{ resolve(JSON.parse(d)); }catch(e){ reject(new Error("企微返回非 JSON")); } }); });
    req.on("error", reject); req.write(data); req.end();
  });
}
async function getAccessToken(cfg){
  cfg = cfg || loadConfig();
  if(DRY_RUN) return "DRYRUN_TOKEN";
  if(!cfg.corpId || !cfg.secret) throw new Error("缺少 corpId/secret，无法获取 access_token");
  const k = cfg.corpId + ":" + cfg.secret;
  const c = tokenCache.get(k);
  if(c && c.value && c.expiresAt > Date.now()) return c.value;
  if(c && c.inflight) return c.inflight;
  const p = (async ()=>{
    const j = await httpsGetJson(`https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${encodeURIComponent(cfg.corpId)}&corpsecret=${encodeURIComponent(cfg.secret)}`);
    if(j.errcode) throw new Error("gettoken 失败：" + j.errcode + " " + j.errmsg);
    tokenCache.set(k, { value:j.access_token, expiresAt: Date.now() + Math.max(300, (j.expires_in || 7200) - 300) * 1000 });
    return j.access_token;
  })();
  tokenCache.set(k, Object.assign({}, c, { inflight:p }));
  try{ return await p; }
  finally{ const cur = tokenCache.get(k); if(cur && cur.inflight === p) delete cur.inflight; }
}

/* ---------- 出站发送（DRY_RUN 只打日志；按渠道选 API） ---------- */
async function send(out){
  const cfg = out.cfg || loadConfig();
  const text = String(out.text || "");
  if(DRY_RUN){
    console.log("[wecom][DRY_RUN] send", out.channel, "->", out.toUser || out.chatId || out.openKfid || "robot", ":", text.slice(0, 80));
    return { ok:true, dryRun:true, msgid:"dryrun" };
  }
  if(out.channel === "wecom_robot" || (out.channel === "wecom" && (out.robotKey || cfg.robotKey))){
    const key = out.robotKey || cfg.robotKey;
    if(!key) throw new Error("缺少群机器人 webhook key");
    const j = await httpsPostJson(`https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=${encodeURIComponent(key)}`, { msgtype:"text", text:{ content:text } });
    if(j.errcode) throw new Error("群机器人发送失败：" + j.errcode + " " + j.errmsg);
    return { ok:true };
  }
  if(out.channel === "wecom_kf"){
    const token = await getAccessToken(cfg);
    const j = await httpsPostJson(`https://qyapi.weixin.qq.com/cgi-bin/kf/send_msg?access_token=${encodeURIComponent(token)}`,
      { touser: out.toUser, open_kfid: out.openKfid, msgtype:"text", text:{ content:text } });
    if(j.errcode) throw new Error("微信客服发送失败：" + j.errcode + " " + j.errmsg);
    return { ok:true, msgid:j.msgid };
  }
  throw new Error("未实现/未配置的发送通道：" + out.channel + "（待联调）");
}

/* 自建应用发送文本消息（显示为应用，非本人）。touser=成员/外部 userid */
async function sendAppText(cfg, touser, text){
  cfg = cfg || loadConfig();
  if(DRY_RUN){ console.log("[wecom][DRY_RUN] app->", touser, ":", String(text || "").slice(0, 80)); return { ok:true, dryRun:true }; }
  if(!cfg.agentId) throw new Error("缺少 agentId（自建应用 AgentId）");
  const token = await getAccessToken(cfg);
  const j = await httpsPostJson(`https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${encodeURIComponent(token)}`,
    { touser, msgtype:"text", agentid:Number(cfg.agentId), text:{ content:String(text || "") }, enable_duplicate_check:0 });
  if(j.errcode) throw new Error("应用消息发送失败：" + j.errcode + " " + j.errmsg);
  return { ok:true, msgid:j.msgid };
}

module.exports = {
  loadConfig, isConfigured, saveConfig,
  signature, decrypt, encrypt, verifyUrl, decryptCallback,
  freshTimestamp, seenNonce, callbackReplayOk,
  extractEncrypt, parseInboundXml,
  getAccessToken, send, sendAppText,
  DRY_RUN
};
