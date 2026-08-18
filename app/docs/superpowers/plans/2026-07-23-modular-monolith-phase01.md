# 模块化单体 Phase 0–1 Implementation Plan

> **For agentic workers:** 按任务顺序执行；每步可本地验证。**勿直接部署云服务器**，待本地回归通过后再同步。

**Goal:** 在本地把「大单体」收成模块化单体骨架：统一出站（outbox）、引入 shared/eventBus、拆出第一批 routes，行为零回归。

**Architecture:** 同进程模块化单体。跨模块只允许 Query / Command / Event。本阶段不拆微服务、不换库。

**Tech Stack:** Node 原生 HTTP、`node:sqlite`、现有 `community`/`triage`/`agent`

---

## 文件地图

| 路径 | 职责 |
|------|------|
| `shared/eventBus.js` | 进程内事件总线 |
| `shared/ARCHITECTURE.md` | 依赖方向与禁令 |
| `modules/outbox/index.js` | 出站唯一门面：`enqueue` / `enqueueDirect` / `setOutboxStatus`… |
| `routes/createRouter.js` | `route`/`routes` 工厂 |
| `routes/followup.js` | 随访相关路由注册（试点） |
| `routes/community-public.js` | `/api/community/inbound` 试点 |
| `server.js` | 改用 outbox + 挂载已抽路由；逐步变薄 |
| `community.js` | 导出 `enqueue`；内部实现仍保留 |
| `docs/superpowers/plans/2026-07-23-modular-monolith-phase01.md` | 本计划 |

## 依赖方向（冻结）

```text
routes → modules.*.service → (repo) → shared/db
agent / triage  ↛  community
qiwe_bridge → community  仅临时允许（后续改事件）
出站写入  →  仅 modules/outbox
```

---

### Task 1: shared + 架构约定

- [x] Create `shared/eventBus.js`
- [x] Create `shared/ARCHITECTURE.md`

### Task 2: outbox 模块

- [x] Export `enqueue` from `community.js`
- [x] Create `modules/outbox/index.js`（门面 + `enqueueDirect`）
- [x] `server.js` 的 `insertDirectOutbound` 改为调 outbox
- [x] 手动回复路径改用 `outbox.setOutboxStatus`
- [x] Test: `_outbox_module_test.js`

### Task 3: routes 壳

- [x] Create `routes/createRouter.js`
- [x] Extract followup + community inbound 为独立注册函数
- [x] `server.js` 挂载；删除重复 `route(...)` 定义

### Task 4: 本地验证

- [x] `node _outbox_module_test.js`
- [x] `node _agent_test.js`
- [x] `node _qiwe_business_test.js`
- [x] 本地 `node server.js` 探活 `/api/bootstrap`（可选）

### Task 5: 云端（本阶段不做）

- [ ] 本地确认无误后再上传

---

## 成功标准

1. 业务代码新增出站不得再 `INSERT INTO outbound_queue`
2. `server.js` 至少有一块路由迁出且行为不变
3. eventBus 可 `emit/on`，outbox 入队时发 `outbox.enqueued`
4. 关键回归全绿
