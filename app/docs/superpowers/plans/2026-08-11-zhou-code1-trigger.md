# 周玉春发编号 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 仅为周玉春创建可在现有触发编排中编辑的“发编号 1”，返回指定菜单文案且不恢复 606。

**Architecture:** 复用现有 outbound trigger、asset、step 三张表。启动补丁幂等创建周玉春 code=1；规则引擎优先匹配 outbound，存在但停用时不回退旧动态菜单。

**Tech Stack:** Node.js、node:sqlite、现有 outbound 模块。

---

### Task 1: 回归测试

**Files:**
- Create: `app/_zhou_menu_trigger_test.js`

- [x] 写测试覆盖：仅周玉春创建、文案正确、606 不受影响、重复执行不重复、停用后不兜底、其他医生仍走旧菜单。
- [x] 运行 `node _zhou_menu_trigger_test.js`，确认因功能缺失而失败。

### Task 2: 最小实现

**Files:**
- Modify: `app/modules/outbound/migrate.js`
- Modify: `app/modules/outbound/resolve.js`
- Modify: `app/engine.js`
- Modify: `app/db.js`

- [x] 在迁移模块增加周玉春专用幂等创建函数，复用现有 repo 写入一条文本素材、一条 code=1 触发和一个步骤。
- [x] 在 resolve 增加包含停用记录的 code 存在性查询。
- [x] 调整 engine 顺序：菜单意图先匹配 outbound；code=1 存在但停用时返回 null；无 code=1 的医生保留旧菜单。
- [x] 在 db 启动阶段调用周玉春专用补丁。
- [x] 运行回归测试与现有 outbound 测试，确认通过。

### Task 3: 云端发布

**Files:**
- Deploy: `app/engine.js`
- Deploy: `app/db.js`
- Deploy: `app/modules/outbound/migrate.js`
- Deploy: `app/modules/outbound/resolve.js`

- [x] 线上只读核对周玉春、code=1 与 606 当前状态。
- [x] 备份线上数据库和待覆盖文件。
- [x] 上传文件并重启服务。
- [x] 核对 code=1 数据、菜单文案、停用语义所需结构、606 状态及服务健康。
