# 春雨医生 · 患者端 UniApp

微信小程序患者端（uni-app）。视觉令牌来自 `@chunyu/patient-design`（与现网 H5 `app.css` 同源）。

## 本地运行

```bash
cd patient-uniapp
pnpm install
pnpm run build:mp-weixin
```

用 **微信开发者工具** 打开目录：

`patient-uniapp/dist/build/mp-weixin`

热更新开发：`pnpm run dev:mp-weixin`，再打开 `dist/dev/mp-weixin`。

## 联调后端（回复真读 / 档案真读）

新接口在演示服部署前，请用本机 `app`：

```bash
# 终端 1
cd app
# Windows：.env.local 通常 PORT=3200；stub 便于无真微信登录
set MP_AUTH_STUB=1
set SMS_DEMO=1
node server.js

# 终端 2：构建指向本机
cd patient-uniapp
set VITE_API_BASE=http://127.0.0.1:3200
pnpm run build:mp-weixin
```

微信开发者工具请勾选「不校验合法域名、web-view、TLS 版本及 HTTPS 证书」。

默认 `.env.development` / `.env.production` 仍可指向演示服；本机联调请用上方 `VITE_API_BASE` 覆盖。

## 功能

- 首页：状态区（完善档案 / 待跟进）+ 主 CTA + 二级知识
- 咨询：真接口 `/api/message`（`CONSULT_USE_REAL`）
- 我的：档案 / 健康记录 / 回复；回复与档案可读服务端（绑手机后）
- 登录：`/api/mp/*`；查看回复免再输手机号

## 档案

- `pages/archive/index`：已退出 Tab，进入时重定向到「我的」
- `pages/archive/profile`：患者档案填写
- `pages/archive/health`：健康记录分类（仍可 mock）
