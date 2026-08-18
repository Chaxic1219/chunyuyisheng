# 小程序微信登录环境变量

本文档说明患者端小程序（MP）登录 / 绑手机所需环境变量。**不要将真实 AppSecret 写入仓库**。

## 服务端（`app`）

```bash
# 微信小程序凭证（与公众号 WECHAT_OA_* 分离）
WECHAT_MP_APP_ID=
WECHAT_MP_APP_SECRET=

# 本地开发：无真实微信时启用 stub 登录
MP_AUTH_STUB=1

# stub 绑手机默认号（可覆盖）
MP_STUB_PHONE=13900001111

# 生产真短信见 docs/sms-config.md（阿里云 / 腾讯云 / Webhook）
SMS_DEMO=1

# 小程序独立 AI 对话（/api/mp/ai-chat，不走 /api/message 分诊）
# 优先 MP_AI_*；未配时可回退 DEEPSEEK_*
MP_AI_API_KEY=
MP_AI_BASE_URL=
MP_AI_MODEL=
# MP_AI_TIMEOUT_MS=30000
```

真短信配置详见 [sms-config.md](./sms-config.md)。

## 客户端（`patient-uniapp`）

`PHONE_BIND_MODE` 控制绑手机 UI：

| 值 | 行为 |
|------|------|
| `auto` | 优先微信一键取号，失败/未配置时回退短信 |
| `wechat` | 仅微信一键 |
| `sms` | 仅短信验证（本地联调常用） |

示例（构建时或 `src/api/config.ts` 等配置）：

```text
PHONE_BIND_MODE=auto|wechat|sms
```

## 本地验证

```bash
cd app && set MP_AUTH_STUB=1 && node _mp_auth_test.js
cd patient-uniapp && pnpm run test:ui
```

咨询：小程序咨询页走独立 `POST /api/mp/ai-chat`（不写 message_log）；H5/企微仍可用 `/api/message`。
若请求带合法 `Authorization: Bearer <mpToken>` 且会话已 `phone_bound`，仅作可选身份识别，AI 对话本身不强制登录。
