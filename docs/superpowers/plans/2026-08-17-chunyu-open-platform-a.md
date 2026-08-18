# 春雨开放平台 A 方案 Implementation Plan

> **For agentic workers:** 按任务逐步实现。101 企微卡片不改。

**Goal:** 用 partner 签名把图文/视频问诊、jump_wxapp、就医绿通、报告解读从「复制短链」升级为可履约跳转与本地对账。

**Architecture:** 服务端统一签名（密钥只进环境变量）；小程序走本站 `/api/mp/chunyu/*`；春雨回调回写 `chunyu_orders`。不改 101 出站卡。

**Tech Stack:** Node `crypto`/`https`，SQLite，uni-app

---
