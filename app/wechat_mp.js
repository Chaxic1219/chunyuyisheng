"use strict";
/**
 * 微信小程序开放接口封装（code2session / 手机号）。
 * stub：仅非生产环境显式 MP_AUTH_STUB=1 时走本地假数据。
 */
const https = require("https");
const { stubModeForEnv } = require("./mp_runtime_config.js");

let tokenCache = { value: null, expiresAt: 0, inflight: null };

function stubMode() {
  return stubModeForEnv(process.env);
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (r) => {
      let d = "";
      r.on("data", (c) => { d += c; });
      r.on("end", () => {
        try { resolve(JSON.parse(d || "{}")); }
        catch (e) { reject(new Error("wechat_non_json")); }
      });
    }).on("error", reject);
  });
}

function postJson(url, body) {
  return new Promise((resolve, reject) => {
    const data = Buffer.from(JSON.stringify(body || {}));
    const u = new URL(url);
    const req = https.request({
      method: "POST",
      hostname: u.hostname,
      path: u.pathname + u.search,
      headers: { "Content-Type": "application/json", "Content-Length": data.length }
    }, (r) => {
      let d = "";
      r.on("data", (c) => { d += c; });
      r.on("end", () => {
        try { resolve(JSON.parse(d || "{}")); }
        catch (e) { reject(new Error("wechat_non_json")); }
      });
    });
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

async function getAccessToken() {
  if (tokenCache.value && tokenCache.expiresAt > Date.now()) return tokenCache.value;
  if (tokenCache.inflight) return tokenCache.inflight;
  const appid = process.env.WECHAT_MP_APP_ID;
  const secret = process.env.WECHAT_MP_APP_SECRET;
  if (!appid || !secret) throw new Error("missing_wechat_mp_credentials");
  const p = (async () => {
    const url = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${encodeURIComponent(appid)}&secret=${encodeURIComponent(secret)}`;
    const data = await getJson(url);
    if (!data.access_token) throw new Error(data.errmsg || "access_token_failed");
    tokenCache.value = data.access_token;
    tokenCache.expiresAt = Date.now() + Math.max(300, (data.expires_in || 7200) - 300) * 1000;
    return tokenCache.value;
  })();
  tokenCache.inflight = p;
  try { return await p; }
  finally { if (tokenCache.inflight === p) tokenCache.inflight = null; }
}

async function code2Session(jsCode) {
  if (stubMode()) {
    const code = String(jsCode || "stub");
    return { openid: "stub-openid-" + code.slice(0, 16), session_key: "stub" };
  }
  const appid = process.env.WECHAT_MP_APP_ID;
  const secret = process.env.WECHAT_MP_APP_SECRET;
  if (!appid || !secret) throw new Error("missing_wechat_mp_credentials");
  const url = `https://api.weixin.qq.com/sns/jscode2session?appid=${encodeURIComponent(appid)}&secret=${encodeURIComponent(secret)}&js_code=${encodeURIComponent(jsCode)}&grant_type=authorization_code`;
  const data = await getJson(url);
  if (!data.openid) {
    // 微信业务错误：errmsg 含语义，errcode 便于程序识别（如 40029 无效 code / 40163 code 已使用）
    const errmsg = String(data.errmsg || "code2session_failed");
    const errcode = data.errcode != null ? String(data.errcode) : "";
    throw new Error(errcode ? `${errmsg} [${errcode}]` : errmsg);
  }
  return { openid: data.openid, session_key: data.session_key, unionid: data.unionid };
}

async function getPhoneNumberByCode(phoneCode) {
  if (stubMode()) {
    return { phone: process.env.MP_STUB_PHONE || "13900001111" };
  }
  const token = await getAccessToken();
  const url = `https://api.weixin.qq.com/wxa/business/getuserphonenumber?access_token=${encodeURIComponent(token)}`;
  const data = await postJson(url, { code: phoneCode });
  const phone = data && data.phone_info && data.phone_info.purePhoneNumber;
  if (!phone) throw new Error((data && data.errmsg) || "getphone_failed");
  return { phone: String(phone).trim() };
}

async function sendSubscribeMessage({ touser, templateId, page, data, miniprogramState }) {
  if (stubMode()) {
    return { errcode: 0, errmsg: "ok", stub: true };
  }
  const token = await getAccessToken();
  const url = `https://api.weixin.qq.com/cgi-bin/message/subscribe/send?access_token=${encodeURIComponent(token)}`;
  const res = await postJson(url, {
    touser: String(touser || ""),
    template_id: String(templateId || ""),
    page: page ? String(page) : "",
    miniprogram_state:
      miniprogramState || process.env.WECHAT_MP_SUBSCRIBE_STATE || "formal",
    lang: "zh_CN",
    data: data || {},
  });
  if (res.errcode && res.errcode !== 0) {
    const err = new Error(res.errmsg || "subscribe_send_failed");
    err.errcode = res.errcode;
    throw err;
  }
  return res;
}

module.exports = {
  stubMode,
  code2Session,
  getPhoneNumberByCode,
  sendSubscribeMessage,
  getJson,
  postJson,
  getAccessToken
};
