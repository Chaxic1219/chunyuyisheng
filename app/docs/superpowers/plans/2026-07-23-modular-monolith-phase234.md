# 模块化单体 Phase 2–4 Implementation Plan

> **For agentic workers:** 按任务顺序执行；每步可本地验证。**勿直接部署云服务器**，待本地回归通过后再同步。

**Goal:** 在 Phase 0–1（outbox + routes 试点）之上，完成解环、service 门面、运营配置事件化，行为零回归。

**Architecture:** 同进程模块化单体。`qiwe_bridge` 与 `community` 不再顶层互相 require；跨模块经 `modules/*` 门面与 `eventBus`。

**Tech Stack:** Node 原生 HTTP、`node:sqlite`、现有业务实现文件（暂不物理搬家大文件）

---

## 映射

| 阶段 | 内容 | 成功标准 |
|------|------|----------|
| **P2** | 解 `community ↔ qiwe_bridge` | 顶层无环；qiwe→`modules/community`；出站投递→`modules/qiwe` |
| **P3** | 更多 routes + service 门面 | 出站审核路由迁出；`modules/followup`、`modules/ops` 可引用 |
| **P4** | 配置平台化（事件） | 发布配置发 `ops.config.published` |

## 文件地图

| 路径 | 职责 |
|------|------|
| `modules/community/index.js` | 社群 Query/Command 门面（懒加载 community.js + 事件） |
| `modules/qiwe/index.js` | 企微投递门面（懒加载 qiwe_bridge） |
| `modules/followup/index.js` | 随访门面 |
| `modules/ops/index.js` | 运营只读配置门面 + publish 事件辅助 |
| `modules/wiring.js` | 可选副作用订阅（审计日志等） |
| `routes/outbox-admin.js` | 出站 send/cancel/edit/… |
| `community.js` | 去掉顶层 `qiwe_bridge` require |
| `qiwe_bridge.js` | 改调 `modules/community` |
| `server.js` | 挂载新路由；publish 发事件；require wiring |

---

### Task P2

- [x] Create `modules/community` / `modules/qiwe`
- [x] `community.setOutboxStatus` 经 `modules/qiwe.deliverOutbox`
- [x] `qiwe_bridge` 经 `modules/community` 查群/归档/风控
- [x] 冒烟：加载无环 + `_qiwe_business_test.js`

### Task P3

- [x] Create `routes/outbox-admin.js` 并挂载
- [x] Create `modules/followup` / `modules/ops` 门面
- [x] `server` 随访/配置读路径可改用门面（渐进）

### Task P4

- [x] publish/rollback 后 `eventBus.emit("ops.config.published"|"ops.config.rolled_back")`
- [x] `modules/wiring.js` 注册轻量日志订阅
- [x] 更新 `shared/ARCHITECTURE.md`
- [x] 回归：`_outbox_module_test` / `_agent_test` / `_qiwe_business_test` / 新冒烟测

### 云端

- [ ] 本阶段不上云
