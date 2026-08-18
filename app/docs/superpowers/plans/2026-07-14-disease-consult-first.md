# 问病优先 101 + 无意义静默 — Implementation Plan

> **For agentic workers:** execute task-by-task in this session.

**Goal:** 问病优先引导 101；无意义群消息不触发 AI（含业务群）。

**Architecture:** 门控/桥接层做无意义静默；低危 LLM 提示词调口径 + 确定性缺 101 兜底。

**Tech Stack:** Node.js、现有 `group_gate` / `triage` / `qiwe_bridge`

---

### Task 1: `group_gate.js` 无意义 + 扩症状
### Task 2: `qiwe_bridge.js` 业务群补静默
### Task 3: `triage.js` 问病优先 101
### Task 4: 默认话术 + 测试 + 部署
