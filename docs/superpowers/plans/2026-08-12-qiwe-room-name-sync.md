# 企微群名称事件同步 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 微信端修改群名后，只同步后台对应群的名称与同步时间。

**Architecture:** 复用群详情 API，通过群通知触发单群查询；专用仓储更新函数限制数据库写入字段。

**Tech Stack:** Node.js、SQLite、QiWe Webhook

---

### Task 1: 单群名称同步

**Files:** `app/_qiwe_group_name_test.js`、`app/qiwe_sync.js`、`app/modules/community/repo.js`

- [ ] 编写失败测试，断言仅名称与同步时间变化。
- [ ] 实现 `syncRoomName` 与专用仓储更新函数。
- [ ] 运行测试确认通过。

### Task 2: 回调接入

**Files:** `app/qiwe.js`、`app/modules/qiwe/callback.js`、`app/_qiwe_group_name_test.js`

- [ ] 归一化 `isRoomNotice`。
- [ ] 群通知调用单群名称同步；失败保持现有链路。
- [ ] 验证成员数据未改变。

### Task 3: 回归与部署

- [ ] 运行新测试、企微业务群测试及相关回归。
- [ ] 备份、部署、重启并在线验证。

