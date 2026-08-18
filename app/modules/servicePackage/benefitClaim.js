"use strict";

/**
 * 权益领取对接模块（PRD §8.14 / §11.1）
 *
 * 首期复用权益服务系统领取码接口：
 *   POST {EQUITY_API_BASE}/integration/v2/code-claims
 *
 * 认证方式（权益系统 integration-auth 中间件）：
 *   请求头：
 *     x-api-key     = integrationCredential.keyId
 *     x-timestamp   = 毫秒时间戳（±5 分钟窗口）
 *     x-nonce       = 单次随机串（服务端防重放）
 *     x-signature   = HMAC-SHA256(secret, "timestamp\nnonce\nMETHOD\noriginalUrl\nsha256(rawBody)") 小写 hex
 *     x-request-id  = 可选请求追踪号
 *     Content-Type  = application/json
 *
 * 幂等：
 *   claim_request_id = `MP${orderNo}`（服务端生成，权益系统按 (channelId, claimRequestId) 幂等）
 *   本模块将领取结果写入 mall_integration_outbox（event_type=benefit_claim_*），
 *   重复调用不会重复发码。
 *
 * 配置（环境变量，未配置时返回 501 benefit_claim_not_configured）：
 *   EQUITY_API_BASE         权益系统地址（默认 http://127.0.0.1:4100）
 *   EQUITY_API_KEY          integrationCredential.keyId
 *   EQUITY_API_SECRET       integrationCredential secret（明文，用于 HMAC）
 *   EQUITY_CHANNEL_CODE     渠道 code（权益系统 Channel.code）
 *   EQUITY_MCHID            商户号 mchid（微信支付商户号）
 *   EQUITY_SOURCE_SYSTEM    来源系统码（默认 chunyu-mp）
 *   EQUITY_PAYMENT_CHANNEL  支付渠道码（默认 WECHAT_JSAPI）
 */

const crypto = require("crypto");
const http = require("http");
const https = require("https");

const { nowIso } = require("./schema.js");
const { parseJson } = require("./catalog.js");

function env(name, fallback = "") {
  const v = process.env[name];
  return v == null || String(v).trim() === "" ? fallback : String(v).trim();
}

function isConfigured() {
  return !!(env("EQUITY_API_KEY") && env("EQUITY_API_SECRET") && env("EQUITY_CHANNEL_CODE") && env("EQUITY_MCHID"));
}

function apiBase() {
  return env("EQUITY_API_BASE", "http://127.0.0.1:4100").replace(/\/+$/, "");
}

function genNonce() {
  return crypto.randomBytes(16).toString("hex");
}

function sha256Hex(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function hmacSha256Hex(secret, value) {
  return crypto.createHmac("sha256", secret).update(value, "utf8").digest("hex");
}

/** 组装签名原文：timestamp\nnonce\nMETHOD\noriginalUrl\nsha256(rawBody) */
function buildSignatureSource(timestamp, nonce, method, originalUrl, rawBody) {
  return [String(timestamp), nonce, method.toUpperCase(), originalUrl, sha256Hex(rawBody || "")].join("\n");
}

/** 发送签名 POST JSON；返回 { status, body } */
function postSigned(urlObj, path, body, secret, keyId, timeoutMs) {
  return new Promise((resolve, reject) => {
    const raw = JSON.stringify(body);
    const timestamp = String(Date.now());
    const nonce = genNonce();
    const signature = hmacSha256Hex(secret, buildSignatureSource(timestamp, nonce, "POST", path, raw));
    const mod = urlObj.protocol === "https:" ? https : http;
    const req = mod.request(
      {
        method: "POST",
        hostname: urlObj.hostname,
        port: urlObj.port || (urlObj.protocol === "https:" ? 443 : 80),
        path: urlObj.pathname + (urlObj.search || ""),
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(raw),
          "x-api-key": keyId,
          "x-timestamp": timestamp,
          "x-nonce": nonce,
          "x-signature": signature,
          "x-request-id": body.claim_request_id || "claim",
        },
        timeout: timeoutMs || 10000,
      },
      (res) => {
        let rawResp = "";
        res.on("data", (c) => {
          rawResp += c;
        });
        res.on("end", () => {
          let parsed = null;
          try {
            parsed = JSON.parse(rawResp);
          } catch (_) {
            parsed = null;
          }
          resolve({ status: res.statusCode || 0, body: parsed, raw: rawResp });
        });
      }
    );
    req.on("timeout", () => {
      req.destroy(new Error("benefit claim http timeout"));
    });
    req.on("error", (e) => reject(e));
    req.write(raw);
    req.end();
  });
}

/**
 * 构造领取请求体（PRD codeClaimSchema）。
 * order 来自 svc_orders（mapOrder 输出）；payment 来自 svc_payments（最近一条成功支付）。
 */
function buildClaimBody(order, payment, person) {
  const snapshot = (order && order.snapshot) || {};
  const lines = (order && order.lines) || [];
  const firstLine = lines[0] || {};
  const spuId = order.spuId || snapshot.spuId || firstLine.spuId;
  const skuId = order.skuId || snapshot.skuId || firstLine.skuId;
  const productSku =
    snapshot.productCode ||
    (spuId && skuId ? `SPU${spuId}-SKU${skuId}` : "") ||
    String(firstLine.title || "SERVICE_PACKAGE").slice(0, 64);

  return {
    claim_request_id: `MP${String(order.orderNo || order.id || "").slice(0, 120)}`,
    requested_at: nowIso(),
    channel_code: env("EQUITY_CHANNEL_CODE"),
    source_system_code: env("EQUITY_SOURCE_SYSTEM", "chunyu-mp"),
    source_platform_order_no: String(order.orderNo || ""),
    mchid: env("EQUITY_MCHID"),
    merchant_order_no: String(order.orderNo || ""),
    wechat_order_no: (payment && payment.providerTradeNo) || "",
    payment_channel_code: env("EQUITY_PAYMENT_CHANNEL", "WECHAT_JSAPI"),
    order_type: "FIRST_PURCHASE",
    product_sku: productSku,
    configuration_no: snapshot.configurationNo || "",
    amount_cents: Number(order.payableAmountCents != null ? order.payableAmountCents : order.totalAmountCents) || 0,
    currency: "CNY",
    paid_at: (order.paidAt || payment && payment.paidAt || nowIso()),
    phone: (person && person.phone) || (order.contactPhone) || "",
  };
}

/**
 * 执行一次领取（幂等）：
 * - 已成功 → 直接返回既有结果（不重复调权益系统）
 * - 已失败但可重试 → 重发
 * - 写入 mall_integration_outbox 追踪
 */
function createBenefitClaim(db, ordersApi) {
  function outboxGet(idempotencyKey) {
    return db
      .prepare(`SELECT * FROM mall_integration_outbox WHERE idempotency_key=?`)
      .get(idempotencyKey) || null;
  }

  function outboxInsert(entry) {
    const ts = nowIso();
    db.prepare(
      `INSERT OR IGNORE INTO mall_integration_outbox(
        package_instance_id,package_component_instance_id,event_type,status,idempotency_key,
        payload_json,result_json,error_message,attempts,next_retry_at,created_at,updated_at
      ) VALUES (NULL,NULL,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      entry.eventType,
      entry.status,
      entry.idempotencyKey,
      JSON.stringify(entry.payload || {}),
      JSON.stringify(entry.result || {}),
      entry.errorMessage || null,
      Number(entry.attempts) || 0,
      entry.nextRetryAt || null,
      ts,
      ts
    );
  }

  function outboxUpdate(id, patch) {
    const row = db.prepare(`SELECT * FROM mall_integration_outbox WHERE id=?`).get(+id);
    if (!row) return;
    db.prepare(
      `UPDATE mall_integration_outbox SET status=?, result_json=?, error_message=?, attempts=?, next_retry_at=?, updated_at=? WHERE id=?`
    ).run(
      patch.status || row.status,
      patch.result ? JSON.stringify(patch.result) : row.result_json,
      patch.errorMessage != null ? patch.errorMessage : row.error_message,
      patch.attempts != null ? Number(patch.attempts) : row.attempts,
      patch.nextRetryAt != null ? patch.nextRetryAt : row.next_retry_at,
      nowIso(),
      +id
    );
  }

  function lastPaidPayment(orderId) {
    try {
      const row = db
        .prepare(`SELECT * FROM svc_payments WHERE order_id=? AND status IN ('paid','succeeded') ORDER BY id DESC LIMIT 1`)
        .get(+orderId);
      if (!row) return null;
      return {
        provider: row.provider,
        outTradeNo: row.out_trade_no,
        providerTradeNo: row.provider_trade_no || "",
        amountCents: Number(row.amount_cents || 0),
        paidAt: row.paid_at || "",
      };
    } catch (_) {
      return null;
    }
  }

  /**
   * 对指定订单发起领取。
   * @returns {Promise<{ok:boolean, status:string, claim?:object, error?:string, code?:string}>}
   */
  async function claimForOrder(orderId, person) {
    const raw = ordersApi.getRaw ? ordersApi.getRaw(orderId) : null;
    if (!raw) {
      const err = new Error("订单不存在");
      err.code = "not_found";
      throw err;
    }
    if (raw.person_id != null && person && person.person_id != null && +raw.person_id !== +person.person_id) {
      const err = new Error("无权操作该订单");
      err.code = "forbidden";
      throw err;
    }
    const order = ordersApi.mapOrder ? ordersApi.mapOrder(raw) : raw;
    if (order.status !== "active" && order.status !== "paid_pending_profile" && order.status !== "pending_review") {
      const err = new Error("订单未支付成功，暂不可领取权益");
      err.code = "order_not_payable";
      throw err;
    }

    if (!isConfigured()) {
      const err = new Error("权益领取接口未配置（EQUITY_API_* 环境变量缺失）");
      err.code = "benefit_claim_not_configured";
      throw err;
    }

    const payment = lastPaidPayment(orderId);
    const claimRequestId = `MP${String(order.orderNo || order.id || "").slice(0, 120)}`;
    const existing = outboxGet(claimRequestId);

    // 幂等：已成功直接返回
    if (existing && existing.status === "succeeded") {
      const saved = parseJson(existing.result_json, {});
      return { ok: true, status: "succeeded", claim: saved, idempotent: true };
    }

    const payload = buildClaimBody(order, payment, person);
    const path = "/integration/v2/code-claims";
    const urlObj = new URL(apiBase() + path);

    // 记录 pending（幂等键 = claim_request_id）
    if (!existing) {
      outboxInsert({
        eventType: "benefit_claim_requested",
        status: "pending",
        idempotencyKey: claimRequestId,
        payload,
      });
    } else {
      outboxUpdate(existing.id, { status: "pending" });
    }

    let result;
    try {
      result = await postSigned(
        urlObj,
        path,
        payload,
        env("EQUITY_API_SECRET"),
        env("EQUITY_API_KEY")
      );
    } catch (e) {
      const row = db.prepare(`SELECT id FROM mall_integration_outbox WHERE idempotency_key=?`).get(claimRequestId);
      if (row) {
        outboxUpdate(row.id, {
          status: "failed",
          errorMessage: `网络错误：${e && e.message ? e.message : "unknown"}`,
          attempts: (existing ? existing.attempts : 0) + 1,
        });
      }
      const err = new Error("权益领取服务暂时不可用，请稍后重试");
      err.code = "benefit_claim_network_error";
      throw err;
    }

    const row = db.prepare(`SELECT id FROM mall_integration_outbox WHERE idempotency_key=?`).get(claimRequestId);

    if (result.status >= 200 && result.status < 300 && result.body && (result.body.code === 0 || result.body.code === 200 || result.body.code == null)) {
      const claim = result.body.data || result.body || {};
      if (row) {
        outboxUpdate(row.id, {
          status: "succeeded",
          result: claim,
          errorMessage: null,
          attempts: (existing ? existing.attempts : 0) + 1,
        });
      }
      return { ok: true, status: "succeeded", claim, idempotent: false };
    }

    // 权益系统业务错误
    const message = (result.body && (result.body.message || result.body.msg)) || `权益系统返回 ${result.status}`;
    if (row) {
      outboxUpdate(row.id, {
        status: "failed",
        errorMessage: message,
        attempts: (existing ? existing.attempts : 0) + 1,
      });
    }
    const err = new Error(String(message).slice(0, 300));
    err.code = "benefit_claim_rejected";
    err.status = result.status;
    throw err;
  }

  /** 查询领取状态（只读） */
  function claimStatus(orderId) {
    const raw = ordersApi.getRaw ? ordersApi.getRaw(orderId) : null;
    if (!raw) return null;
    const claimRequestId = `MP${String(raw.order_no || raw.id || "").slice(0, 120)}`;
    const row = outboxGet(claimRequestId);
    if (!row) return { status: "none" };
    return {
      status: row.status,
      eventType: row.event_type,
      claim: parseJson(row.result_json, {}),
      error: row.error_message,
      attempts: row.attempts,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  return { claimForOrder, claimStatus, isConfigured };
}

module.exports = { createBenefitClaim, buildClaimBody, isConfigured, postSigned };
