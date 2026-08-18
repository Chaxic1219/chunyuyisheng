"use strict";

/**
 * 微信支付 APIv3（原生 Node crypto + https，无 npm SDK）
 *
 * 回调验签需要平台证书：请设置 WX_PLATFORM_CERT_PATH。
 * 若缺失，handleNotify 抛出 platform_cert_required（生产必须验签）。
 */

const crypto = require("crypto");
const https = require("https");
const { getWechatPayConfig } = require("./wechatConfig.js");

const API_HOST = "api.mch.weixin.qq.com";

function randomNonce(len) {
  return crypto.randomBytes(Math.ceil((len || 32) / 2)).toString("hex").slice(0, len || 32);
}

function buildAuthorization(config, method, urlPath, body) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonceStr = randomNonce(32);
  const bodyStr = body == null || body === "" ? "" : String(body);
  const message = `${method}\n${urlPath}\n${timestamp}\n${nonceStr}\n${bodyStr}\n`;
  const signature = crypto
    .createSign("RSA-SHA256")
    .update(message)
    .sign(config.privateKeyPem, "base64");
  return (
    `WECHATPAY2-SHA256-RSA2048 mchid="${config.mchId}",` +
    `nonce_str="${nonceStr}",` +
    `signature="${signature}",` +
    `timestamp="${timestamp}",` +
    `serial_no="${config.mchSerialNo}"`
  );
}

/**
 * 小程序调起支付签名：appId\\ntimeStamp\\nnonceStr\\npackage\\n
 */
function buildJsapiPaySign(privateKeyPem, { appId, timeStamp, nonceStr, package: pkg }) {
  const message = `${appId}\n${timeStamp}\n${nonceStr}\n${pkg}\n`;
  return crypto.createSign("RSA-SHA256").update(message).sign(privateKeyPem, "base64");
}

/**
 * APIv3 通知 resource AES-256-GCM 解密
 * ciphertext base64：末 16 字节为 authTag
 */
function decryptAesGcm(apiV3Key, { ciphertext, nonce, associated_data: associatedData }) {
  const key = Buffer.from(String(apiV3Key), "utf8");
  if (key.length !== 32) {
    const err = new Error("WX_API_V3_KEY 必须为 32 字节");
    err.code = "invalid_api_v3_key";
    throw err;
  }
  const data = Buffer.from(String(ciphertext), "base64");
  if (data.length <= 16) {
    const err = new Error("ciphertext 过短");
    err.code = "decrypt_failed";
    throw err;
  }
  const authTag = data.subarray(data.length - 16);
  const enc = data.subarray(0, data.length - 16);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(String(nonce), "utf8"));
  if (associatedData != null && associatedData !== "") {
    decipher.setAAD(Buffer.from(String(associatedData), "utf8"));
  }
  decipher.setAuthTag(authTag);
  const plain = Buffer.concat([decipher.update(enc), decipher.final()]);
  return plain.toString("utf8");
}

function requestJson(config, method, urlPath, bodyObj) {
  const body = bodyObj == null ? "" : JSON.stringify(bodyObj);
  const authorization = buildAuthorization(config, method, urlPath, body);
  const headers = {
    Authorization: authorization,
    Accept: "application/json",
    "User-Agent": "chunyu-service-package-wechat/1.0",
  };
  if (body) {
    headers["Content-Type"] = "application/json";
    headers["Content-Length"] = Buffer.byteLength(body);
  }

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: API_HOST,
        path: urlPath,
        method,
        headers,
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          let json = null;
          if (raw) {
            try {
              json = JSON.parse(raw);
            } catch (e) {
              const err = new Error(`微信响应非 JSON: ${raw.slice(0, 200)}`);
              err.code = "wechat_bad_response";
              err.statusCode = res.statusCode;
              return reject(err);
            }
          }
          if (res.statusCode < 200 || res.statusCode >= 300) {
            const err = new Error(
              (json && (json.message || json.detail)) || `微信 API HTTP ${res.statusCode}`
            );
            err.code = (json && json.code) || "wechat_api_error";
            err.statusCode = res.statusCode;
            err.response = json;
            return reject(err);
          }
          resolve(json || {});
        });
      }
    );
    req.on("error", (e) => {
      const err = e instanceof Error ? e : new Error(String(e));
      if (!err.code) err.code = "network_error";
      reject(err);
    });
    if (body) req.write(body);
    req.end();
  });
}

function headerGet(headers, name) {
  if (!headers) return "";
  const lower = String(name).toLowerCase();
  for (const k of Object.keys(headers)) {
    if (String(k).toLowerCase() === lower) {
      const v = headers[k];
      return Array.isArray(v) ? String(v[0] || "") : String(v == null ? "" : v);
    }
  }
  return "";
}

function verifyNotifySignature(verifyPem, headers, rawBody) {
  const timestamp = headerGet(headers, "Wechatpay-Timestamp");
  const nonce = headerGet(headers, "Wechatpay-Nonce");
  const signature = headerGet(headers, "Wechatpay-Signature");
  if (!timestamp || !nonce || !signature) {
    const err = new Error("缺少 Wechatpay 验签头");
    err.code = "notify_headers_missing";
    throw err;
  }
  const bodyStr = Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : String(rawBody == null ? "" : rawBody);
  const message = `${timestamp}\n${nonce}\n${bodyStr}\n`;
  const verifier = crypto.createVerify("RSA-SHA256");
  verifier.update(message);
  const ok = verifier.verify(verifyPem, signature, "base64");
  if (!ok) {
    const err = new Error("微信支付回调签名校验失败");
    err.code = "notify_signature_invalid";
    throw err;
  }
}

function createWechatProvider(config) {
  const cfg = config || getWechatPayConfig();
  if (!cfg || !cfg.privateKeyPem || !cfg.mchId || !cfg.appId || !cfg.apiV3Key || !cfg.mchSerialNo || !cfg.notifyUrl) {
    const err = new Error("WechatPayProvider 配置不完整");
    err.code = "pay_not_configured";
    throw err;
  }

  return {
    name: "wechat",

    async create({ outTradeNo, amountCents, description, openid }) {
      if (!openid) {
        const err = new Error("缺少 openid");
        err.code = "openid_required";
        throw err;
      }
      const payload = {
        appid: cfg.appId,
        mchid: cfg.mchId,
        description: description || "服务包",
        out_trade_no: String(outTradeNo),
        notify_url: cfg.notifyUrl,
        amount: {
          total: Math.round(Number(amountCents)),
          currency: "CNY",
        },
        payer: { openid: String(openid) },
      };
      const res = await requestJson(cfg, "POST", "/v3/pay/transactions/jsapi", payload);
      const prepayId = res.prepay_id;
      if (!prepayId) {
        const err = new Error("微信下单未返回 prepay_id");
        err.code = "wechat_no_prepay_id";
        err.response = res;
        throw err;
      }
      const timeStamp = String(Math.floor(Date.now() / 1000));
      const nonceStr = randomNonce(32);
      const pkg = `prepay_id=${prepayId}`;
      const paySign = buildJsapiPaySign(cfg.privateKeyPem, {
        appId: cfg.appId,
        timeStamp,
        nonceStr,
        package: pkg,
      });
      const prepay = {
        timeStamp,
        nonceStr,
        package: pkg,
        signType: "RSA",
        paySign,
        appId: cfg.appId,
      };
      return {
        provider: "wechat",
        outTradeNo: String(outTradeNo),
        amountCents: Math.round(Number(amountCents)),
        status: "pending",
        prepay,
      };
    },

    async query({ outTradeNo }) {
      const path = `/v3/pay/transactions/out-trade-no/${encodeURIComponent(String(outTradeNo))}?mchid=${encodeURIComponent(cfg.mchId)}`;
      const res = await requestJson(cfg, "GET", path, null);
      const tradeState = res.trade_state || "";
      let status = "unknown";
      if (tradeState === "SUCCESS") status = "paid";
      else if (tradeState === "NOTPAY" || tradeState === "USERPAYING") status = "pending";
      else if (tradeState === "CLOSED" || tradeState === "REVOKED" || tradeState === "PAYERROR") status = "failed";
      else if (tradeState === "REFUND") status = "refunded";
      return {
        outTradeNo: res.out_trade_no || String(outTradeNo),
        providerTradeNo: res.transaction_id || null,
        tradeState,
        status,
        paid: tradeState === "SUCCESS",
        raw: res,
      };
    },

    async handleNotify(headers, rawBody) {
      const verifyPem = cfg.platformCertPem || cfg.platformPubKeyPem;
      if (!verifyPem) {
        const err = new Error(
          "微信支付回调验签需要平台证书或公钥：请设置 WX_PLATFORM_CERT_PATH 或 WX_PLATFORM_PUB_KEY_PATH"
        );
        err.code = "platform_cert_required";
        throw err;
      }
      verifyNotifySignature(verifyPem, headers, rawBody);
      const bodyStr = Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : String(rawBody == null ? "" : rawBody);
      let envelope;
      try {
        envelope = JSON.parse(bodyStr);
      } catch (e) {
        const err = new Error("回调 body 非 JSON");
        err.code = "notify_bad_body";
        throw err;
      }
      const resource = envelope.resource;
      if (!resource || !resource.ciphertext) {
        const err = new Error("回调缺少 resource.ciphertext");
        err.code = "notify_no_resource";
        throw err;
      }
      const plain = decryptAesGcm(cfg.apiV3Key, resource);
      let data;
      try {
        data = JSON.parse(plain);
      } catch (e) {
        const err = new Error("解密后非 JSON");
        err.code = "decrypt_bad_json";
        throw err;
      }
      return {
        outTradeNo: data.out_trade_no || null,
        providerTradeNo: data.transaction_id || null,
        paid: data.trade_state === "SUCCESS",
        tradeState: data.trade_state || null,
        raw: data,
      };
    },

    async refund({ outRefundNo, outTradeNo, amountCents, totalCents, reason }) {
      const refund = Math.round(Number(amountCents));
      const total = Math.round(Number(totalCents != null ? totalCents : amountCents));
      const payload = {
        out_trade_no: String(outTradeNo),
        out_refund_no: String(outRefundNo),
        reason: reason || "服务包退款",
        amount: {
          refund,
          total,
          currency: "CNY",
        },
      };
      const res = await requestJson(cfg, "POST", "/v3/refund/domestic/refunds", payload);
      const st = String(res.status || "").toUpperCase();
      let status = "pending";
      if (st === "SUCCESS") status = "refunded";
      else if (st === "PROCESSING") status = "processing";
      else if (st === "ABNORMAL") status = "pending";
      else if (st === "CLOSED") status = "failed";
      return {
        provider: "wechat",
        outRefundNo: res.out_refund_no || String(outRefundNo),
        outTradeNo: res.out_trade_no || String(outTradeNo),
        providerRefundNo: res.refund_id || null,
        amountCents: refund,
        status,
        raw: res,
      };
    },
  };
}

async function fetchPlatformCertificatePem(config) {
  const cfg = config || getWechatPayConfig();
  if (!cfg) {
    const err = new Error("WechatPayProvider 配置不完整");
    err.code = "pay_not_configured";
    throw err;
  }
  const res = await requestJson(cfg, "GET", "/v3/certificates", null);
  const rows = Array.isArray(res.data) ? res.data : [];
  if (!rows.length) {
    const err = new Error("微信未返回平台证书");
    err.code = "platform_cert_empty";
    throw err;
  }
  const latest = rows[0];
  const enc = latest.encrypt_certificate;
  if (!enc || !enc.ciphertext) {
    const err = new Error("平台证书结构异常");
    err.code = "platform_cert_invalid";
    throw err;
  }
  return {
    pem: decryptAesGcm(cfg.apiV3Key, enc),
    serialNo: latest.serial_no || null,
  };
}

module.exports = {
  createWechatProvider,
  buildJsapiPaySign,
  buildAuthorization,
  decryptAesGcm,
  verifyNotifySignature,
  fetchPlatformCertificatePem,
  requestJson,
};
