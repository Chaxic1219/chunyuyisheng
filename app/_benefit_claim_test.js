#!/usr/bin/env node
"use strict";
/**
 * benefitClaim 模块专项测试：签名构造、幂等、outbox 记录、未配置回退
 * 运行：node _benefit_claim_test.js
 */
const assert = require("node:assert");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");
const { DatabaseSync } = require("node:sqlite");

const { ensureSchema } = require("./modules/servicePackage/schema.js");
const { ensureMallSchema } = require("./modules/servicePackage/mallSchema.js");
const { buildClaimBody, postSigned } = require("./modules/servicePackage/benefitClaim.js");
const crypto = require("node:crypto");

let passed = 0;
let failed = 0;
function ok(name) { passed++; console.log("ok -", name); }
function notOk(name, e) { failed++; console.log("not ok -", name, "->", e && e.message); }

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "benefit-claim-test-"));
const dbPath = path.join(tmpDir, "test.db");
const db = new DatabaseSync(dbPath);
ensureSchema(db);
ensureMallSchema(db);

// 1) 构造测试数据：订单 + 支付 + 权益组成
const ts = new Date().toISOString();
db.prepare(`INSERT INTO svc_orders(
  order_no,person_id,doctor_id,product_id,version_id,mall_spu_id,mall_sku_id,status,
  service_amount_cents,goods_amount_cents,shipping_amount_cents,total_amount_cents,
  payable_amount_cents,snapshot_json,cost_snapshot_json,service_for,paid_at,created_at,updated_at
) VALUES ('TEST20260814000001',1,5,0,1,1,1,'active',69900,0,0,69900,69900,'{"productCode":"SPU-WYC-FRACTURE-90"}','{}','self',?,?,?)`
).run(ts, ts, ts);
const orderId = Number(db.prepare(`SELECT id FROM svc_orders WHERE order_no='TEST20260814000001'`).get().id);
db.prepare(`INSERT INTO svc_payments(order_id,provider,out_trade_no,provider_trade_no,amount_cents,status,created_at,updated_at)
  VALUES (?,'wechat','OUTTEST0001','420000123420260814000001',69900,'paid',?,?)`).run(orderId, ts, ts);
db.prepare(`INSERT INTO svc_order_lines(order_id,product_id,version_id,mall_spu_id,mall_sku_id,qty,title,snapshot_json,service_amount_cents,goods_amount_cents,shipping_amount_cents,total_amount_cents,created_at)
  VALUES (?,0,1,1,1,1,'王云程骨折手术康复服务包 · 90天全功能版','{}',69900,0,0,69900,?)`).run(orderId, ts);

// 2) 测试 buildClaimBody 构造
try {
  const order = { orderNo: "TEST20260814000001", id: orderId, payableAmountCents: 69900, totalAmountCents: 69900, paidAt: ts, status: "active", contactPhone: "", snapshot: { productCode: "SPU-WYC-FRACTURE-90" } };
  const payment = { providerTradeNo: "420000123420260814000001", paidAt: ts };
  const person = { person_id: 1, phone: "13800138000" };
  const body = buildClaimBody(order, payment, person);
  assert.equal(body.claim_request_id, "MPTEST20260814000001");
  assert.equal(body.merchant_order_no, "TEST20260814000001");
  assert.equal(body.wechat_order_no, "420000123420260814000001");
  assert.equal(body.amount_cents, 69900);
  assert.equal(body.product_sku, "SPU-WYC-FRACTURE-90");
  assert.equal(body.phone, "13800138000");
  assert.equal(body.currency, "CNY");
  assert.equal(body.order_type, "FIRST_PURCHASE");
  ok("buildClaimBody 字段构造正确");
} catch (e) { notOk("buildClaimBody 字段构造正确", e); }

// 3) 测试签名可复现：同一输入应产生同一签名
try {
  const secret = "test-secret";
  const src1 = ["1700000000000", "nonce1", "POST", "/integration/v2/code-claims", crypto.createHash("sha256").update("{}").digest("hex")].join("\n");
  const s1 = crypto.createHmac("sha256", secret).update(src1).digest("hex");
  const s2 = crypto.createHmac("sha256", secret).update(src1).digest("hex");
  assert.equal(s1, s2);
  assert.match(s1, /^[a-f0-9]{64}$/);
  ok("HMAC-SHA256 签名确定性且 64 位 hex");
} catch (e) { notOk("HMAC-SHA256 签名确定性", e); }

// 4) 测试 postSigned 发出正确签名头（本地 mock server 校验）
try {
  const http = require("node:http");
  let received = null;
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      received = {
        method: req.method,
        url: req.url,
        headers: req.headers,
        rawBody: raw,
      };
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ code: 0, data: { claimNo: "CLM-001", benefitCode: "BCODE-123", redemptionUrl: "https://benefits.agentosay.com/redeem" } }));
    });
  });
  server.listen(0, "127.0.0.1", async () => {
    try {
      const port = server.address().port;
      const secret = "test-secret";
      const keyId = "key-1";
      const body = { claim_request_id: "MPTEST20260814000001", phone: "13800138000" };
      const urlObj = new URL(`http://127.0.0.1:${port}/integration/v2/code-claims`);
      const result = await postSigned(urlObj, "/integration/v2/code-claims", body, secret, keyId, 5000);
      assert.equal(result.status, 200);
      assert.equal(result.body.data.claimNo, "CLM-001");
      assert.ok(received, "请求已到达 mock server");
      assert.equal(received.method, "POST");
      assert.equal(received.headers["x-api-key"], keyId);
      assert.ok(received.headers["x-timestamp"], "有时间戳");
      assert.ok(received.headers["x-nonce"], "有 nonce");
      assert.match(received.headers["x-signature"], /^[a-f0-9]{64}$/);
      // 校验签名与源码一致
      const expected = crypto.createHmac("sha256", secret)
        .update([received.headers["x-timestamp"], received.headers["x-nonce"], "POST", received.url, crypto.createHash("sha256").update(received.rawBody).digest("hex")].join("\n"))
        .digest("hex");
      assert.equal(received.headers["x-signature"], expected);
      ok("postSigned 发送完整签名头且签名可验证");
      server.close();
    } catch (e) { notOk("postSigned 签名头", e); server.close(); }
  });
} catch (e) { notOk("postSigned 启动", e); }

// 5) 测试 createBenefitClaim 幂等与 outbox（用注入 ordersApi 的桩）
let done = false;
function finish() {
  if (done) return;
  done = true;
  try { db.close(); fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

setTimeout(() => {
  try {
    const { createBenefitClaim } = require("./modules/servicePackage/benefitClaim.js");
    const fakeOrders = {
      getRaw: (id) => db.prepare(`SELECT * FROM svc_orders WHERE id=?`).get(+id) || null,
      mapOrder: (row) => row ? { ...row, status: row.status, orderNo: row.order_no, payableAmountCents: row.payable_amount_cents, totalAmountCents: row.total_amount_cents, paidAt: row.paid_at, snapshot: JSON.parse(row.snapshot_json || "{}"), lines: [] } : null,
    };
    const claim = createBenefitClaim(db, fakeOrders);

    // 未配置 → 501 类错误（不配置 env）
    const prevKey = process.env.EQUITY_API_KEY;
    const prevSecret = process.env.EQUITY_API_SECRET;
    const prevChannel = process.env.EQUITY_CHANNEL_CODE;
    const prevMchid = process.env.EQUITY_MCHID;
    delete process.env.EQUITY_API_KEY;
    delete process.env.EQUITY_API_SECRET;
    delete process.env.EQUITY_CHANNEL_CODE;
    delete process.env.EQUITY_MCHID;
    claim.claimForOrder(orderId, { person_id: 1, phone: "13800138000" })
      .then(() => { notOk("未配置时应拒绝", new Error("未抛错")); finish(); })
      .catch((e) => {
        try {
          assert.equal(e.code, "benefit_claim_not_configured");
          ok("未配置时返回 benefit_claim_not_configured");
        } catch (e2) { notOk("未配置 code", e2); }
        // 恢复配置后，无真实权益系统 → 网络错误进入 outbox failed
        process.env.EQUITY_API_KEY = prevKey || "test-key";
        process.env.EQUITY_API_SECRET = prevSecret || "test-secret";
        process.env.EQUITY_CHANNEL_CODE = prevChannel || "CH-SDDCLB";
        process.env.EQUITY_MCHID = prevMchid || "1900000001";
        claim.claimForOrder(orderId, { person_id: 1, phone: "13800138000" })
          .then(() => { notOk("网络错误时应抛", new Error("未抛错")); finish(); })
          .catch((e2) => {
            try {
              assert.equal(e2.code, "benefit_claim_network_error");
              const status = claim.claimStatus(orderId);
              assert.equal(status.status, "failed");
              assert.ok(status.error, "有错误信息");
              ok("网络失败时 outbox 记录 failed");
            } catch (e3) { notOk("outbox failed 状态", e3); }
            finish();
          });
      });
  } catch (e) { notOk("createBenefitClaim 测试", e); finish(); }
}, 100);
