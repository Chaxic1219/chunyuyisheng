# Community 群/成员所有权 Implementation Plan

> **For agentic workers:** 本地验证；勿上云。

**Goal:** `community_groups` / `community_members` 写入归属 `modules/community/repo`。

**Architecture:** repo（唯一 SQL）+ rules（整形/枚举）+ service（查群/建群/成员）；旧 `community.js` 与 sync/merge/ops 改调 repo。

**Tech Stack:** Node、`node:sqlite`

---

- [x] `modules/community/{repo,rules,service}.js`
- [x] 调用方改调（community / qiwe_sync / cgd / server）
- [x] `_community_ownership_test.js` + 回归
