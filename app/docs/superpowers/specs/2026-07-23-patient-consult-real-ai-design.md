# 患者端小程序咨询接真 AI（方案 A）

**日期：** 2026-07-23  
**状态：** 已落地（小程序咨询 → `/api/message`；MaaS `qwen-turbo`）  
**决策：** 小程序 `POST /api/message` → `buildPatientReply`（与 H5/后台分诊同一人设）；LLM 使用阿里云 MaaS OpenAI 兼容 `qwen-turbo`。

## 范围

- `patient-uniapp`：咨询发送走真接口；解析 `responses[]`；去掉本地假分诊回复。
- `app`：`.env.local` 配置 MaaS；`load_env.js` 启动加载；密钥不进仓库。

## 非目标

- 不把 Key 打进小程序包。
- 本期不改 Dialogue Agent / 企微链路。
- 不改 admin-ui 分诊台 UI。
