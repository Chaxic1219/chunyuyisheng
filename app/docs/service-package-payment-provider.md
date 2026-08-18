# 服务包支付 Provider 切换说明

**日期：** 2026-08-06  
**范围：** `app/modules/servicePackage/providers`

## 当前默认

```bash
SERVICE_PAY_PROVIDER=mock|wechat   # 默认 mock
SERVICE_PAY_MOCK_AUTO=1            # mock 下单后自动记为已支付；设 0 则需调 POST /api/mp/orders/:id/pay/mock-complete
SERVICE_ORDER_TIMEOUT_MS=1800000   # 待支付超时关闭，默认 30 分钟
```

Mock 路径不会调用 `wx.requestPayment`。小程序 checkout 在 `provider=mock` 时走自动完成/轮询。

## 环境变量（仅服务端）

```bash
SERVICE_PAY_PROVIDER=mock|wechat   # 默认 mock

# wechat 时必填：
WX_MP_APPID=                      # 小程序 appId（可与 WECHAT_MP_APP_ID 同源）
WX_MCH_ID=                        # 商户号
WX_API_V3_KEY=                    # APIv3 密钥，须为 32 字节
WX_MCH_SERIAL_NO=                 # 商户证书序列号
WX_MCH_PRIVATE_KEY_PATH=          # 商户 API 私钥 pem 文件路径
WX_PAY_NOTIFY_URL=                # 回调 URL，如 https://域名/api/mp/payments/wechat/notify

# 可选：
WX_PLATFORM_CERT_PATH=            # 微信平台证书（回调验签）；缺失时 handleNotify 抛 platform_cert_required
SERVICE_PAY_QUERY_ON_STATUS=1     # GET payment-status 时对 pending 单主动查单补漏；设 0 关闭
```

密钥与证书**仅**通过环境变量或服务器文件路径注入，勿写入小程序包或前端构建产物。

## 切换到真实微信支付

实现位于 `app/modules/servicePackage/providers/wechat.js`：**原生 Node**（`crypto` + `https`），**零 npm 运行时依赖**，不引入 `wechatpay-node-v3`。

`providers/index.js` 的 `getPaymentProvider()`：`wechat` 且配置齐全 → `createWechatProvider()`；缺配置 → `pay_not_configured`。

### Provider 接口（与 mock 一致）

| 方法 | 行为 |
|------|------|
| `create({ outTradeNo, amountCents, description, openid })` | JSAPI 预下单；返回 `prepay`（`timeStamp, nonceStr, package, signType, paySign`） |
| `query({ outTradeNo })` | 查单 |
| `handleNotify(headers, rawBody)` | 验签解密；幂等入账 |
| `refund({ outRefundNo, outTradeNo, amountCents, totalCents, reason })` | 退款 |

### openid

`createPayment` 从 `persons.mp_openid` 或当前 `mp_sessions.openid` 读取；缺失则 `openid_required`（先于统一下单）。

### 回调与查单

1. `POST /api/mp/payments/wechat/notify`（无用户 Bearer，微信签名验签）→ `payments.handleNotify`，按 `out_trade_no` 幂等推进到 `paid_pending_profile`。
2. `GET /api/mp/orders/:id/payment-status`：若仍 pending 且 `SERVICE_PAY_QUERY_ON_STATUS=1`，调 `provider.query` 补单。

### 小程序

当 `pay` 返回 `provider=wechat` 且带有 `prepay` 时，调用 `uni.requestPayment` / `wx.requestPayment`，再轮询 `GET /api/mp/orders/:id/payment-status`；**不以前端 requestPayment 成功为最终入账依据**。

### 缺配置

`SERVICE_PAY_PROVIDER=wechat` 但必填 env 不全或私钥不可读 → `pay_not_configured`，不假成功。

### 管理端只读状态

`GET /api/admin/service-pay/status` → `{ data: { provider, configured } }`（不返回密钥）。`configured`：wechat 时为 `isWechatPayConfigured()`，mock 时为 `true`。

## 订单状态机（切换支付实现时勿改）

```text
pending_payment → paid_pending_profile → pending_review → active
pending_payment → closed_timeout
paid_pending_profile|pending_review → refunding → refunded
```

金额一律以 `svc_product_versions` 服务端计价，禁止信任前端金额。
