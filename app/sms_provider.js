"use strict";
/**
 * 短信验证码发送（零 npm 依赖）。
 *
 * SMS_PROVIDER:
 *   - aliyun   阿里云短信 SendSms（生产推荐）
 *   - tencent  腾讯云短信 SendSms
 *   - webhook  POST JSON 到自建网关 { phone, code, scene: "verify" }
 *   - log      仅写日志（联调，不向用户发真短信）
 *   - off      未配置（演示模式 SMS_DEMO=1 时仍可内存验码）
 *
 * 演示：node server.js --demo 或 SMS_DEMO=1 → 响应可返回明文 code，可不配真实通道。
 * 生产：node server.js + SMS_PROVIDER=aliyun + 下方密钥。
 */

const crypto = require("crypto");
const https = require("https");
const runtimeConfig = require("./mp_runtime_config.js");

function env(name) {
  return String(process.env[name] || "").trim();
}

function isDemoMode() {
  return !runtimeConfig.isProduction(process.env)
    && runtimeConfig.smsDemoRequested(process.env, process.argv);
}

function resolveProviderName() {
  const explicit = env("SMS_PROVIDER").toLowerCase();
  if (explicit) {
    if (runtimeConfig.isProduction(process.env)
      && (explicit === "demo" || explicit === "log")) return "off";
    return explicit;
  }
  if (env("ALIYUN_ACCESS_KEY_ID") && env("ALIYUN_SMS_SIGN_NAME") && env("ALIYUN_SMS_TEMPLATE_CODE")) {
    return "aliyun";
  }
  if (env("TENCENT_SMS_SECRET_ID") && env("TENCENT_SMS_SDK_APP_ID") && env("TENCENT_SMS_TEMPLATE_ID")) {
    return "tencent";
  }
  if (env("SMS_WEBHOOK_URL")) return "webhook";
  return isDemoMode() ? "demo" : "off";
}

function aliyunPercentEncode(str) {
  return encodeURIComponent(String(str))
    .replace(/\+/g, "%20")
    .replace(/\*/g, "%2A")
    .replace(/%7E/g, "~");
}

function aliyunSign(params, accessKeySecret) {
  const keys = Object.keys(params).sort();
  const canonical = keys
    .map((k) => aliyunPercentEncode(k) + "=" + aliyunPercentEncode(params[k]))
    .join("&");
  const stringToSign = "GET&" + aliyunPercentEncode("/") + "&" + aliyunPercentEncode(canonical);
  return crypto
    .createHmac("sha1", accessKeySecret + "&")
    .update(stringToSign)
    .digest("base64");
}

function httpsJson(method, url, headers, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = body ? Buffer.from(body) : null;
    const req = https.request(
      {
        method,
        hostname: u.hostname,
        path: u.pathname + u.search,
        headers: Object.assign(
          {},
          headers || {},
          data ? { "Content-Length": data.length } : {}
        ),
      },
      (res) => {
        let raw = "";
        res.on("data", (c) => { raw += c; });
        res.on("end", () => {
          let parsed = {};
          try { parsed = JSON.parse(raw || "{}"); } catch (e) { parsed = { raw }; }
          resolve({ status: res.statusCode || 0, body: parsed, raw });
        });
      }
    );
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

function sha256Hex(s) {
  return crypto.createHash("sha256").update(s, "utf8").digest("hex");
}

function hmacSha256(key, msg, encoding) {
  return crypto.createHmac("sha256", key).update(msg, "utf8").digest(encoding);
}

function tencentTc3Sign({ secretId, secretKey, service, host, payload, timestamp, action }) {
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
  const canonicalHeaders = "content-type:application/json; charset=utf-8\nhost:" + host + "\n";
  const signedHeaders = "content-type;host";
  const hashedPayload = sha256Hex(payload);
  const canonicalRequest = [
    "POST",
    "/",
    "",
    canonicalHeaders,
    signedHeaders,
    hashedPayload,
  ].join("\n");
  const credentialScope = date + "/" + service + "/tc3_request";
  const stringToSign = [
    "TC3-HMAC-SHA256",
    String(timestamp),
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");
  const secretDate = hmacSha256("TC3" + secretKey, date);
  const secretService = hmacSha256(secretDate, service);
  const secretSigning = hmacSha256(secretService, "tc3_request");
  const signature = hmacSha256(secretSigning, stringToSign, "hex");
  return "TC3-HMAC-SHA256 Credential=" + secretId + "/" + credentialScope
    + ", SignedHeaders=" + signedHeaders + ", Signature=" + signature;
}

function providerError(code) {
  const err = new Error(code || "sms_send_failed");
  err.code = code || "sms_send_failed";
  return err;
}

async function sendAliyun(phone, code) {
  const accessKeyId = env("ALIYUN_ACCESS_KEY_ID");
  const accessKeySecret = env("ALIYUN_ACCESS_KEY_SECRET");
  const signName = env("ALIYUN_SMS_SIGN_NAME");
  const templateCode = env("ALIYUN_SMS_TEMPLATE_CODE");
  const regionId = env("ALIYUN_SMS_REGION") || "cn-hangzhou";
  if (!accessKeyId || !accessKeySecret || !signName || !templateCode) {
    throw providerError("sms_not_configured");
  }
  const templateParamKey = env("ALIYUN_SMS_TEMPLATE_PARAM") || "code";
  const params = {
    AccessKeyId: accessKeyId,
    Action: "SendSms",
    Format: "JSON",
    PhoneNumbers: phone,
    RegionId: regionId,
    SignName: signName,
    SignatureMethod: "HMAC-SHA1",
    SignatureNonce: crypto.randomBytes(16).toString("hex"),
    SignatureVersion: "1.0",
    TemplateCode: templateCode,
    TemplateParam: JSON.stringify({ [templateParamKey]: code }),
    Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    Version: "2017-05-25",
  };
  params.Signature = aliyunSign(params, accessKeySecret);
  const qs = Object.keys(params)
    .sort()
    .map((k) => encodeURIComponent(k) + "=" + encodeURIComponent(params[k]))
    .join("&");
  const url = "https://dysmsapi.aliyuncs.com/?" + qs;
  const res = await httpsJson("GET", url);
  const body = res.body || {};
  if (body.Code !== "OK") {
    console.error("[sms/aliyun] provider_error");
    throw providerError("sms_provider_error");
  }
  return { provider: "aliyun", requestId: body.RequestId || null };
}

async function sendTencent(phone, code) {
  const secretId = env("TENCENT_SMS_SECRET_ID");
  const secretKey = env("TENCENT_SMS_SECRET_KEY");
  const sdkAppId = env("TENCENT_SMS_SDK_APP_ID");
  const signName = env("TENCENT_SMS_SIGN_NAME");
  const templateId = env("TENCENT_SMS_TEMPLATE_ID");
  if (!secretId || !secretKey || !sdkAppId || !signName || !templateId) {
    throw providerError("sms_not_configured");
  }
  const host = "sms.tencentcloudapi.com";
  const payload = JSON.stringify({
    PhoneNumberSet: ["+86" + phone],
    SmsSdkAppId: sdkAppId,
    SignName: signName,
    TemplateId: templateId,
    TemplateParamSet: [code],
  });
  const timestamp = Math.floor(Date.now() / 1000);
  const authorization = tencentTc3Sign({
    secretId,
    secretKey,
    service: "sms",
    host,
    payload,
    timestamp,
    action: "SendSms",
  });
  const res = await httpsJson("POST", "https://" + host, {
    "Content-Type": "application/json; charset=utf-8",
    Host: host,
    "X-TC-Action": "SendSms",
    "X-TC-Version": "2021-01-11",
    "X-TC-Timestamp": String(timestamp),
    "X-TC-Region": env("TENCENT_SMS_REGION") || "ap-guangzhou",
    Authorization: authorization,
  }, payload);
  const resp = res.body && res.body.Response;
  if (!resp || resp.Error) {
    console.error("[sms/tencent] provider_error");
    throw providerError("sms_provider_error");
  }
  const status = resp.SendStatusSet && resp.SendStatusSet[0];
  if (status && status.Code !== "Ok") {
    console.error("[sms/tencent] provider_rejected");
    throw providerError("sms_provider_error");
  }
  return { provider: "tencent", requestId: resp.RequestId || null };
}

async function sendWebhook(phone, code) {
  const url = env("SMS_WEBHOOK_URL");
  if (!url) throw providerError("sms_not_configured");
  const body = JSON.stringify({ phone, code, scene: "verify", ts: Date.now() });
  const headers = { "Content-Type": "application/json" };
  const secret = env("SMS_WEBHOOK_SECRET");
  if (secret) {
    headers["X-Sms-Signature"] = crypto.createHmac("sha256", secret).update(body).digest("hex");
  }
  const res = await httpsJson("POST", url, headers, body);
  if (res.status < 200 || res.status >= 300) {
    console.error("[sms/webhook] provider_error");
    throw providerError("sms_provider_error");
  }
  if (res.body && res.body.ok === false) {
    throw providerError("sms_provider_error");
  }
  return { provider: "webhook" };
}

function isConfigured() {
  const name = resolveProviderName();
  if (name === "off") return false;
  if (name === "demo" || name === "log") {
    return !runtimeConfig.isProduction(process.env);
  }
  if (name === "aliyun") {
    return !!(env("ALIYUN_ACCESS_KEY_ID") && env("ALIYUN_ACCESS_KEY_SECRET")
      && env("ALIYUN_SMS_SIGN_NAME") && env("ALIYUN_SMS_TEMPLATE_CODE"));
  }
  if (name === "tencent") {
    return !!(env("TENCENT_SMS_SECRET_ID") && env("TENCENT_SMS_SECRET_KEY")
      && env("TENCENT_SMS_SDK_APP_ID") && env("TENCENT_SMS_SIGN_NAME") && env("TENCENT_SMS_TEMPLATE_ID"));
  }
  if (name === "webhook") return !!env("SMS_WEBHOOK_URL");
  return false;
}

function describeMode() {
  const name = resolveProviderName();
  if (name === "demo") return "演示模式（内存验码，响应可含明文 code）";
  if (name === "off") return "未配置（生产将拒绝发码；请设 SMS_PROVIDER 或 --demo）";
  if (name === "log") return "日志模式（不向用户发送真实短信）";
  if (name === "aliyun") return isConfigured() ? "阿里云短信" : "阿里云（配置不完整）";
  if (name === "tencent") return isConfigured() ? "腾讯云短信" : "腾讯云（配置不完整）";
  if (name === "webhook") return isConfigured() ? "Webhook 网关" : "Webhook（URL 未配置）";
  return name;
}

/**
 * 发送验证码短信。演示模式下跳过真实发送（由路由层返回 demo code）。
 * @returns {Promise<{provider:string, skipped?:boolean}>}
 */
async function sendVerificationCode(phone, code) {
  const p = String(phone || "").trim();
  const c = String(code || "").trim();
  if (!/^1[3-9]\d{9}$/.test(p)) throw providerError("invalid_phone");
  if (!/^\d{4,8}$/.test(c)) throw providerError("invalid_code");

  const provider = resolveProviderName();
  if (runtimeConfig.isProduction(process.env)
    && (provider === "demo" || provider === "log")) {
    throw providerError("sms_not_configured");
  }
  if (provider === "demo") {
    return { provider: "demo", skipped: true };
  }
  if (provider === "log") {
    console.log("[sms/log] verification_skipped", p.slice(0, 3) + "****" + p.slice(-4));
    return { provider: "log" };
  }
  if (provider === "off") {
    throw providerError("sms_not_configured");
  }
  if (provider === "aliyun") return sendAliyun(p, c);
  if (provider === "tencent") return sendTencent(p, c);
  if (provider === "webhook") return sendWebhook(p, c);
  throw providerError("sms_not_configured");
}

module.exports = {
  sendVerificationCode,
  isConfigured,
  describeMode,
  resolveProviderName,
  isDemoMode,
  // 测试用
  aliyunPercentEncode,
  aliyunSign,
};
