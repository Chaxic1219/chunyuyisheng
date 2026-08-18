# Community 真模块 · 第一刀（群/成员）设计

**日期:** 2026-07-23  
**状态:** 已按主人确认「按思路 A」执行

## 目标

`community_groups` / `community_members` 由 `modules/community` 自管数据和规则；业务文件禁止直接 INSERT/UPDATE 这两张表。

## 非目标（本刀不做）

- 不搬 `community_messages` / 入站管线 / 风控词表
- 不把 `handleInbound` 整段迁入模块
- 不上云

## 结构

```text
modules/community/
  repo.js     ← 唯一允许写 groups/members
  rules.js    ← groupOut、命名、占位 ID、枚举
  service.js  ← findQiwe* / ensureDefault / createGroup / findGroup / upsertMember …
  index.js    ← 对外门面（群 API + 仍懒加载旧入站/风控）
```

## 协作

| 调用方 | 方式 |
|--------|------|
| `community.js` | 委托 service / repo |
| `qiwe_sync.js` | 经 repo 写群成员 |
| `community_group_doctors.js` | 合并经 repo |
| `server.js` applyDoctorGroup | 经 repo |
| `db.js` 种子 | 允许直写（与 outbox 同例） |

## 成功标准

1. `_community_ownership_test.js`：业务源码无直写 groups/members（repo/db/测试除外）
2. 现有 `_qiwe_business_test` / `_agent_test` / `_outbox_ownership_test` 绿
3. `qiwe_bridge` 仍经 `modules/community` 查群
