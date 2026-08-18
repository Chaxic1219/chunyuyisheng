# QiWe Business Group Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让社群工作台只以管理员选中的真实 QiWe 业务群数据作为生产事实来源，同时保留但隔离模拟和手工入口。

**Architecture:** 在现有 SQLite 表上增加来源和业务群标记；新增独立的 QiWe 群同步模块；真实回调在现有回复逻辑之前执行业务群门禁和统一归档。后台增加同步按钮和业务群选择项。

**Tech Stack:** Node.js 24、`node:sqlite`、原生 HTTP、原生浏览器 JavaScript。

---

### Task 1: 数据来源与真实统计

**Files:**
- Modify: `db.js`
- Modify: `community.js`
- Test: `_unittest.js`

- [ ] 先写断言：手工/模拟数据不计入真实 KPI，只有 `data_source='qiwe' AND is_business=1` 的群及关联行计入。
- [ ] 运行 `node _unittest.js`，确认断言因缺少列和过滤逻辑失败。
- [ ] 使用 `ensureColumn` 增加来源、业务群、同步时间和版本字段，更新输出映射与 `overview()` 查询。
- [ ] 再次运行单元测试，确认通过。

### Task 2: QiWe 群和成员同步

**Files:**
- Create: `qiwe_sync.js`
- Modify: `qiwe.js`
- Modify: `community.js`
- Test: `_unittest.js`

- [ ] 先写同步测试：伪造群分页和群详情响应，验证群与成员幂等写入、退出成员变为非活动、业务群选择不被后续同步覆盖。
- [ ] 运行单元测试，确认同步函数不存在而失败。
- [ ] 实现群分页、会话补充、批量群详情和数据库对账；导出可注入 API 调用器的同步函数。
- [ ] 运行单元测试，确认同步测试通过。

### Task 3: 真实回调业务群门禁与统一归档

**Files:**
- Modify: `community.js`
- Modify: `qiwe_bridge.js`
- Test: `_unittest.js`

- [ ] 先写断言：非业务群返回 `non_business_group` 且不落库；业务群真实消息只落一条社群记录并关联真实成员。
- [ ] 运行单元测试，确认当前回调绕过社群完整入库而失败。
- [ ] 增加真实 QiWe 入站归档函数，并在 `processEvent()` 中执行业务群门禁；保留现有成熟回复和卡片发送路径，避免双重分诊。
- [ ] 运行单元测试，确认门禁、归档和去重通过。

### Task 4: 管理接口和后台界面

**Files:**
- Modify: `server.js`
- Modify: `public/src/admin.js`
- Test: `_fulltest.js`
- Test: `_uitest.js`

- [ ] 先写 API/UI 断言：存在同步接口、同步按钮、真实来源标记和业务群开关；模拟入口仍存在。
- [ ] 运行相关测试，确认失败。
- [ ] 添加 `/api/admin/community/qiwe/sync`，扩展群编辑接口保存 `isBusiness`；后台添加同步按钮、来源标签和业务群开关。
- [ ] 运行 API/UI 测试，确认通过。

### Task 5: 完整验证

**Files:**
- Verify: `db.js`, `qiwe_sync.js`, `community.js`, `qiwe_bridge.js`, `server.js`, `public/src/admin.js`

- [ ] 运行六个 JavaScript 文件的 `node --check`。
- [ ] 运行 `npm test`，要求退出码为 0。
- [ ] 用隔离数据库执行一次伪造同步和真实回调，核对群、成员、消息数量及来源字段。
