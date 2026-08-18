# S4 真微信支付 Implementation Plan

> **Status (2026-08-06):** S4 automated verification **PASS** — `_service_package_test.js` 全绿（28/28）；`build:mp-weixin` 成功；dist 无密钥泄露；mock 仍为默认 provider。

> **For agentic workers:** REQUIRED SUB-SKILL: subagent-driven-development or executing-plans. Checkbox steps.

**Goal:** 可切换微信 JSAPI 支付（预下单/回调/查单/退款）；默认 mock；零新运行时 npm 依赖。

**Architecture:** `providers/wechat.js`（Node crypto+https APIv3）替换 stub；`payments.handleNotify` + notify 路由；小程序 `requestPayment`+轮询；配置校验。

**Tech Stack:** 现有 Node 服务、uni-app；微信 APIv3 文档

**Spec:** `app/docs/superpowers/specs/2026-08-06-s4-wechat-pay-design.md`

---

## File map

| 文件 | 职责 |
|------|------|
| `providers/wechat.js` | **新建** APIv3 客户端 |
| `providers/index.js` | 配置齐则 createWechatProvider |
| `providers/wechatConfig.js` | **新建** 读 env、isConfigured |
| `payments.js` | openid、handleNotify、query 补单、refund pending |
| `mp-service-package.js` | notify 路由（原始 body） |
| `server.js` 或路由层 | 确保 notify 能读 raw body |
| `_service_package_test.js` | mock 回归 + not_configured |
| `checkout.vue` / `order-detail.vue` | wechat 拉起支付 |
| `servicePackage.ts` | 类型 prepay 字段 |
| `service-package-payment-provider.md` | 更新操作说明 |
| 可选 admin status API + 只读页 | |

---

### Task 1: wechatConfig + not_configured behavior

- [ ] `wechatConfig.js`: `getWechatPayConfig()` → null if incomplete; `isWechatPayConfigured()`  
- [ ] `getPaymentProvider()`: wechat + configured → real; wechat + !configured → stub throwing `pay_not_configured`  
- [ ] Test: with env SERVICE_PAY_PROVIDER=wechat and no keys, createPayment throws pay_not_configured  
- [ ] Restore env after test; mock tests still pass  

---

### Task 2: wechat.js APIv3 core

Implement without npm SDK:

- [ ] RSA-SHA256 请求签名（Authorization: WECHATPAY2-SHA256-RSA2048 ...）  
- [ ] AES-GCM 回调解密（APIv3 key）  
- [ ] `create`: POST `/v3/pay/transactions/jsapi` with appid, mchid, description, out_trade_no, notify_url, amount.total, payer.openid  
- [ ] Build prepay: appId, timeStamp, nonceStr, package=`prepay_id=...`, signType=RSA, paySign  
- [ ] `query`: GET `/v3/pay/transactions/out-trade-no/{out}`  
- [ ] `refund`: POST `/v3/refund/domestic/refunds`  
- [ ] `handleNotify`: verify Wechatpay-Signature（平台证书）；decrypt resource  

If platform cert missing: document that notify verify needs `WX_PLATFORM_CERT_PATH` or download API; S4 minimum accept cert path env.

Unit-test signature helper with fixed private key fixture in test temp files (optional) OR skip live HTTP and test config gate only + mock provider injection.

**Pragmatic S4:** implement full client; tests mock `https.request` or test only config + prepay field shape with stubbed `_request`.

---

### Task 3: payments.js integration

- [ ] `createPayment`: pass `openid` from person/session; amount payable  
- [ ] `handleNotify(headers, rawBody)`: provider.handleNotify → find payment by out_trade_no → markPaid idempotent  
- [ ] `paymentStatus`: if pending && wechat && QUERY flag, query and markPaid  
- [ ] `fullRefund`: if result.status pending, keep order refunding / refund row pending；if refunded, current path  
- [ ] Export handleNotify  

Need helper to resolve openid:

```javascript
function resolveMpOpenid(personId) {
  const p = db.prepare(`SELECT mp_openid FROM persons WHERE id=?`).get(+personId);
  if (p?.mp_openid) return p.mp_openid;
  const s = db.prepare(`SELECT openid FROM mp_sessions WHERE person_id=? ORDER BY id DESC LIMIT 1`).get(+personId);
  return s?.openid || null;
}
```

---

### Task 4: Notify route + raw body

- [ ] `POST /api/mp/payments/wechat/notify`  
- [ ] Must receive **raw body string** for签名；check how `server.js` parses JSON — may need special-case path before JSON.parse  
- [ ] Respond WeChat success JSON `{ code: "SUCCESS", message: "成功" }`  

---

### Task 5: Miniapp requestPayment

- [ ] Shared util `payOrderFlow(orderId)` used by checkout + order-detail  
- [ ] wechat: `uni.requestPayment({ provider:'wxpay', ...prepay })` then poll `getPaymentStatus` every 1.5s max 20 times  
- [ ] mock: unchanged  
- [ ] build:mp-weixin  

---

### Task 6: Docs + admin status (optional light)

- [ ] Update `service-package-payment-provider.md` with env list and notify URL  
- [ ] `GET /api/admin/service-pay/status` → `{ provider, configured }`  
- [ ] Optional one-line in admin service-orders header  

---

### Task 7: E2E automated

- [x] Full `_service_package_test.js` with mock  
- [x] Test wechat not configured  
- [x] build miniapp  
- [x] Grep dist for WX_API_V3_KEY / mch private key strings — must not appear  
- [x] Mark plan verified  

---

## Spec coverage

| 项 | Task |
|----|------|
| 原生 wechat provider | 1–2 |
| openid / createPayment | 3 |
| notify / query | 3–4 |
| 小程序拉起 | 5 |
| 文档/状态 | 6 |
| mock 不破 | 7 |

---

## Execution handoff

**1. Subagent-Driven（推荐）**  
**2. Inline Execution**

Which approach?
