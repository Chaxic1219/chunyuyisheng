# Outbox 状态机迁入 Implementation Plan

> **For agentic workers:** 本地验证；勿上云。

**Goal:** `setOutboxStatus` / `editOutboxText` / `setOutboxAssignee` / `sendOutboxForDecision` 归属 `modules/outbox`，community 仅委托。

**Architecture:** repo 管 UPDATE；rules 管闸控常量；`status.js` 管真发编排（wecom / modules.qiwe）。

---

- [x] Expand `modules/outbox/repo.js`（状态/文本/分派/按 decision 查找）
- [x] Expand `modules/outbox/rules.js`（attempts、unavailable 文案）
- [x] Create `modules/outbox/status.js`（setOutboxStatus 真发）
- [x] `service.js` 改用本地实现，不再 `community().setOutboxStatus`
- [x] `community.js` 对应函数改为委托 outbox
- [x] 回归：`_outbox_ownership_test` / `_agent_test` / `_qiwe_business_test` / 可选 `_unittest` 出站段
