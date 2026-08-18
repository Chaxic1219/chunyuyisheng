# S4 真微信支付 — 设计规格

**日期：** 2026-08-06  
**状态：** S4 automated verification **PASS**（2026-08-06）— 自动化全绿；待主人 manual QA（商户配置 + 真机支付）  
**前置：** S1–S3；`SERVICE_PAY_PROVIDER=mock` 默认可用  
**决策回顾：** 支付红线优先；商户材料 **C（后配可开）**；技术路线调整为 **原生 Node 实现 APIv3**（本仓 `package.json` 声明应用零运行时依赖，不引入 `wechatpay-node-v3`）

---

## 1. 目标

1. 实现可切换的微信 JSAPI 支付：预下单 → 小程序 `requestPayment` → 回调/查单入账  
2. 退款对接真实接口；`processing` 可后续查单（S4 最小：同步等到成功或记 pending + 查询接口）  
3. **缺配置时**：`SERVICE_PAY_PROVIDER=wechat` 但密钥不全 → 明确 `pay_not_configured`，不假成功  
4. **默认仍 mock**，现有测试与演示不破  
5. 密钥仅服务端环境变量/文件；不进小程序包  
6. 三支柱（档案/咨询）不改  

---

## 2. 环境变量（仅服务端）

```bash
SERVICE_PAY_PROVIDER=mock|wechat   # 默认 mock

# wechat 时必填：
WX_MP_APPID=                      # 小程序 appId（可与现有 MP appid 同源）
WX_MCH_ID=                        # 商户号
WX_API_V3_KEY=                    # APIv3 密钥 32 字节
WX_MCH_SERIAL_NO=                 # 商户证书序列号
WX_MCH_PRIVATE_KEY_PATH=          # pem 私钥路径
WX_PAY_NOTIFY_URL=                # https://域名/api/mp/payments/wechat/notify

# 可选：
WX_PLATFORM_CERT_PATH=            # 平台证书（验签）；也可运行时下载缓存
SERVICE_PAY_QUERY_ON_STATUS=1     # payment-status 时主动查单补漏
```

配置校验：`wechat` 模式下启动或首次 create 时检查必填项。

---

## 3. Provider 接口（与现有一致）

`providers/wechat.js` → `createWechatProvider()`：

| 方法 | 行为 |
|------|------|
| `create({ outTradeNo, amountCents, description, openid })` | JSAPI 下单；返回 `prepay`：`timeStamp,nonceStr,package,signType,paySign`（小程序调起参数） |
| `query({ outTradeNo })` | 查单；映射 `SUCCESS`→paid |
| `handleNotify(headers, rawBody)` | 验签解密；返回 `{ outTradeNo, providerTradeNo, paid }` |
| `refund({ outRefundNo, outTradeNo, amountCents, totalCents, reason })` | 退款 |

`getPaymentProvider()`：wechat 且配置齐全 → 真实现；wechat 缺配置 → 仍抛 `pay_not_configured`（可保留 stub 行为）。

**openid：** `createPayment` 从 `persons.mp_openid` 或当前 `mp_sessions.openid` 读取；缺失则 `openid_required`。

---

## 4. 服务端支付流

1. `POST /orders/:id/pay` → `createPayment`  
   - amount = `payableAmountCents ?? totalAmountCents`  
   - mock：可 auto markPaid  
   - wechat：写 pending payment + 返回 prepay；**不** auto 入账  
2. `POST /api/mp/payments/wechat/notify`（**无用户 Bearer**；用微信签名）  
   - 幂等：已 paid 直接成功应答  
   - 成功 → `markPaid`（含券 redeem）  
3. `GET .../payment-status`：若仍 pending 且 `SERVICE_PAY_QUERY_ON_STATUS=1`，调 `provider.query` 补单  
4. `fullRefund`：调 wechat refund；若返回 processing，refund 行 status=pending，订单保持 refunding，直至查到成功再 refunded（S4 最小：轮询一次 query refund 或同步等；若 API 直接成功则一步到位）

---

## 5. 小程序

`checkout.vue` / `order-detail.vue` 支付辅助：

```text
pay = await payServiceOrder(id)
if pay.provider === 'mock' → 现有 mockComplete / 已自动 paid
if pay.provider === 'wechat' → uni.requestPayment(prepay 字段)
然后轮询 payment-status 直至 paid 或超时提示
redirect pay-result
```

**不以** `requestPayment` success 为入账依据。

---

## 6. 管理端（轻量）

- 商品管理旁或系统说明页：「支付模式」只读展示当前 `SERVICE_PAY_PROVIDER`（接口 `GET /api/admin/service-pay/status` 返回 provider + configured:boolean，不泄露密钥）  
- S4 可不做复杂配置 UI  

---

## 7. 测试策略

| 场景 | 做法 |
|------|------|
| mock 回归 | 现有 `_service_package_test.js` 全绿 |
| wechat 缺配置 | 单测：provider=wechat 无密钥 → create 抛 `pay_not_configured` |
| wechat 签名/加解密 | 用固定测试向量或 mock https（可选）；无真商户则不测打款 |
| notify 幂等 | 注入假 handleNotify 结果调 markPaid 两次 |

---

## 8. 明确不做（S4）

- 支付分账、合单、H5/Native 非小程序渠道  
- 部分退款自动化（仍整单 payable 全额）  
- 商户平台自动进件  
- 改档案/咨询主链  

---

## 9. 验收 DoD

- [x] 默认 mock：S1–S3 冒烟全过  
- [x] `SERVICE_PAY_PROVIDER=wechat` 缺配置：明确错误  
- [ ] 配置齐全（或集成环境）：预下单返回合法 prepay 结构；notify/query 可入账  
- [x] 小程序 wechat 分支调 `requestPayment` + 轮询  
- [x] 驳回退款走 provider.refund（mock 路径已回归；wechat refund 待 manual QA）  
- [x] 密钥未出现在前端构建产物  

---

## 10. 实现计划

见 `app/docs/superpowers/plans/2026-08-06-s4-wechat-pay.md`。
