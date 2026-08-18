# Outbox 真模块 + 写入硬闭环 Implementation Plan

> **For agentic workers:** 按任务顺序执行；每步可本地验证。**勿部署云端**。

**Goal:** `outbound_queue` 的写入与规则归属 `modules/outbox`；业务文件禁止直接 INSERT。

**Architecture:** repo（唯一 SQL 写入）+ rules（行整形/默认值）+ service（enqueue / insert / 事件）；`community.enqueue` 与 `qiwe_bridge` 全部改调 service。

**Tech Stack:** Node、`node:sqlite`、现有 eventBus

---

## 文件地图

| 路径 | 职责 |
|------|------|
| `modules/outbox/repo.js` | `outbound_queue` INSERT / getById |
| `modules/outbox/rules.js` | `toPublic`、状态/默认列规范化 |
| `modules/outbox/service.js` | `enqueue` / `enqueueDirect` / `insert` + 事件 |
| `modules/outbox/index.js` | 对外导出（薄） |
| `community.js` | `enqueue` 委托 outbox.service |
| `qiwe_bridge.js` | 6 处 INSERT → `outbox.insert` |
| `_outbox_ownership_test.js` | 扫描业务源码无直写 + 行为冒烟 |

---

### Task 1: repo + rules + service

- [x] 实现 `insert`（支持 sent_mode / data_source / external_msg_id）
- [x] `enqueue` / `enqueueDirect` 迁入 service，不再委托 community.enqueue 做写入
- [x] 事件仍发 `outbox.enqueued`

### Task 2: 收口调用方

- [x] `community.enqueue` → `require("./modules/outbox").enqueue`
- [x] `qiwe_bridge` 全部 INSERT → `outbox.insert`
- [x] Grep 确认业务 `.js` 仅 `modules/outbox/repo.js` 含 INSERT

### Task 3: 验证

- [x] `_outbox_ownership_test.js`
- [x] `_outbox_module_test.js` / `_agent_test.js` / `_qiwe_business_test.js`
