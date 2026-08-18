# Followup 真模块 Implementation Plan

> **For agentic workers:** 本地验证；勿上云。

**Goal:** `followups` 表与节点规则归属 `modules/followup`（第二个「自管数据」真模块）。

**Architecture:** repo（SQL）+ rules（时间轴/节点状态）+ service（业务 API）；根目录 `followup.js` 改为再导出兼容层。

---

- [x] `modules/followup/{repo,rules,service}.js`
- [x] `modules/followup/index.js` 导出 service
- [x] `followup.js` → `module.exports = require("./modules/followup")`
- [x] `_followup_module_test.js` + 回归
