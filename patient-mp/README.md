# patient-mp · 医患通微信小程序（支付链路版）

春雨医生 · 患者端微信小程序。原生微信小程序（WXML/JS），无构建依赖，微信开发者工具直接打开。

## 页面

| 页面 | 路径 | 说明 |
|---|---|---|
| 登录 | `pages/login/login` | 微信登录（code2session）+ 绑定手机号（getPhoneNumber 一键授权 / 短信码） |
| 健康服务 | `pages/services/services` | 服务包列表（`GET /api/mp/service-products`） |
| 服务详情 | `pages/detail/detail` | 商品详情，底部"立即购买" |
| 确认订单 | `pages/checkout/checkout` | 收货信息 + 协议 → 下单（`POST /api/mp/orders`） |
| 收银台 | `pages/pay/pay` | **支付页**：wechat 分支拉微信收银台 / mock 分支显示仿真收银台 |
| 支付结果 | `pages/result/result` | 轮询 `GET /api/mp/orders/:id/payment-status` |
| 我的服务 | `pages/orders/orders` | 订单列表（`GET /api/mp/orders`） |

## 快速开始

1. 打开微信开发者工具 → 导入项目 → 选择本目录
2. AppID 已在 `project.config.json` 配置（`wx2ad967ec3c627676`），无需修改
3. 详情页 → 勾选 **"不校验合法域名、web-view（业务域名）、TLS 版本以及 HTTPS 证书"**（开发阶段）
4. 编译运行 → 微信登录（开发者工具用正式 AppID 时 wx.login 返回真实 code，后端 code2session 可用）
5. 绑定手机号：开发者工具"模拟器"面板可模拟 getPhoneNumber 授权；真机需小程序已认证
6. 进入 健康服务 → 骨科术后康复服务包 → 立即购买 → 填收货信息 → 确认支付

## 支付模式

后端按 `SERVICE_PAY_PROVIDER` 环境变量返回支付参数：

- `mock`（当前生产）：收银台页显示**仿真微信收银台**，点"确认支付"→ `POST /api/mp/orders/:id/pay/mock-complete` 完成支付，**不扣款**
- `wechat`（商户号配置完成后切换）：收银台页自动调 `wx.requestPayment` 拉起**真实微信收银台**

前端两个分支都已实现，切换后端配置后前端零改动。

## API 域名

默认 `https://yht.chunyutianxia.com`（nginx 已反代后端 3200 端口）。修改 `app.js` 的 `globalData.apiBase` 即可切换。

## 真实微信支付接入

见项目根目录 `docs/微信支付接入指南.md`（商户号申请 → 证书 → HTTPS → 环境变量 → 真机 1 分钱测试）。
