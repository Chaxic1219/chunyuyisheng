# 短信验证码配置

患者端「获取验证码」走 `POST /api/sms/send`，校验走内存 `smsCodes` + `verifySms()`（5 分钟有效、30 秒发码节流、最多 5 次错误）。

## 模式一览

| 场景 | 启动方式 | 行为 |
|------|----------|------|
| 本地联调 | `node server.js --demo` 或 `SMS_DEMO=1` | 不发真短信；响应含明文 `code` |
| 生产 | `node server.js` + 下方环境变量 | 经云厂商发真短信；响应不含 `code` |
| 仅日志 | `SMS_PROVIDER=log` | 控制台打印验证码（不向用户发送） |
| 自建网关 | `SMS_PROVIDER=webhook` | POST JSON 到你的短信服务 |

未配置且非演示模式时，`/api/sms/send` 返回 **503**（fail-closed）。

## 阿里云（推荐）

在 [阿里云短信控制台](https://dysmsapi.console.aliyun.com/) 申请签名与模板。模板变量名默认为 `code`，若不同请设 `ALIYUN_SMS_TEMPLATE_PARAM`。

```bash
SMS_PROVIDER=aliyun
ALIYUN_ACCESS_KEY_ID=你的AccessKeyId
ALIYUN_ACCESS_KEY_SECRET=你的AccessKeySecret
ALIYUN_SMS_SIGN_NAME=签名名称
ALIYUN_SMS_TEMPLATE_CODE=SMS_xxxxxx
# 可选
ALIYUN_SMS_REGION=cn-hangzhou
ALIYUN_SMS_TEMPLATE_PARAM=code
```

模板示例：`您的验证码为${code}，5分钟内有效。`

## 腾讯云

```bash
SMS_PROVIDER=tencent
TENCENT_SMS_SECRET_ID=
TENCENT_SMS_SECRET_KEY=
TENCENT_SMS_SDK_APP_ID=
TENCENT_SMS_SIGN_NAME=
TENCENT_SMS_TEMPLATE_ID=
# 可选
TENCENT_SMS_REGION=ap-guangzhou
```

## Webhook（自建）

```bash
SMS_PROVIDER=webhook
SMS_WEBHOOK_URL=https://your-sms-gateway.example/send
# 可选：请求体 HMAC-SHA256 十六进制，放在 X-Sms-Signature
SMS_WEBHOOK_SECRET=
```

请求体：

```json
{ "phone": "13800138000", "code": "123456", "scene": "verify", "ts": 1710000000000 }
```

网关应返回 HTTP 2xx；若 JSON 体含 `"ok": false` 则视为失败。

## 演示变量（勿用于生产）

```bash
SMS_DEMO=1          # 与 --demo 等效：响应可返回明文 code
```

## 验证

```bash
cd app
node _sms_provider_test.js

# 演示态全量 API（需另开终端 node server.js --demo）
node _fulltest.js
```
