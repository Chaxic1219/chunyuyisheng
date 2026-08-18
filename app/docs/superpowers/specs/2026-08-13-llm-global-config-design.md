# 医生与系统 · 大模型 API 全局配置

日期：2026-08-13  
状态：已确认（方案 A）

## 目标

在「医生与系统」新增「大模型配置」页：统一设置 Base URL / API Key / 模型 / 超时 / 总开关，并支持连通性测试；各业务链路共用。

## 存储

表 `llm_global_config`（单行 `id=1`）。优先于环境变量；无库配置时回退 `DEEPSEEK_*` / `MP_AI_*`。

## API

- `GET /api/admin/llm/config` — 脱敏配置 + 业务一览
- `PUT /api/admin/llm/config` — 保存（apiKey 空=不改）
- `POST /api/admin/llm/test` — 连通性测试

权限：`credential.manage`（仅超管）

## 接入

`triage.modelConfig`、`mpAi/client.resolveConfig`、`llm_health` 统一经 `llm_config.resolveRuntime`。
