# Community Messages 所有权 Implementation Plan

> 本地验证；勿上云。

**Goal:** `community_messages` 写入归属 `modules/community/repo`；归档/风控/入站管线只经 repo。

**Architecture:** 扩展现有 community repo；编排逻辑仍可留在 `community.js`，SQL 全部下沉。

---

- [x] repo：insertMessage / moderation & process_status UPDATE / reassignMessageGroup
- [x] community.js / cgd / qiwe_media 改调
- [x] ownership 测试扩到 messages
- [x] 回归
