# Outbox UPDATE 硬闭环 Implementation Plan

> 本地验证；勿上云。

**Goal:** 业务侧禁止直接 `UPDATE/DELETE outbound_queue`；剩余两处改走 outbox API。

- [x] `repo.updatePendingDraft` + `service.updatePendingDraft`
- [x] `community.generateAssistantDraftForOutbox` 委托
- [x] `repo.reassignGroup` + `community_group_doctors` 改调
- [x] ownership 测试扩到 UPDATE/DELETE + 行为冒烟
