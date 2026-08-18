# Ops 写路径真模块 Implementation Plan

> **For agentic workers:** 本地验证；**勿上云**。

**Goal:** `ops_configs` / `ops_config_audit` 的写入归属 `modules/ops`；配置中心 HTTP 迁至 `routes/config-center.js`。

**Architecture:**
- `repo.js`：本表 **唯一** INSERT/UPDATE
- `rules.js`：校验 `validateOpsConfig` + 域元数据
- `service.js`：saveDraft / publish / rollback / ensure + 事件
- 发布后副作用（改 doctors / rules / community_groups）仍由路由编排层调用，**不**并入 ops 内写他人表

**Tech Stack:** Node、`node:sqlite`、现有 eventBus

---

## 文件地图

| 路径 | 职责 |
|------|------|
| `modules/ops/repo.js` | ops_configs / ops_config_audit 读写 |
| `modules/ops/rules.js` | validate + CONFIG_DOMAINS 元数据 |
| `modules/ops/service.js` | draft/publish/rollback/ensure + emit |
| `routes/config-center.js` | config-center HTTP |
| `server.js` | 删除直写 SQL；提供 apply* / defaultOpsConfig 给路由 |
| `_ops_module_test.js` | 扩展写路径 + 源码扫描 |

---

- [x] `modules/ops/repo.js` 写 API
- [x] `modules/ops/rules.js` validate + 域元数据
- [x] `modules/ops/service.js` saveDraft/publish/rollback/ensure
- [x] `routes/config-center.js`
- [x] `server.js` 去掉直写；注入 apply*
- [x] `_ops_module_test.js` 源码扫描 + draft/publish
- [x] 回归 `_agent_test` / `_modular_phase234_test`

---

## 不做

- 不把 `applyDoctorGroupConfig` 等跨表副作用搬进 ops
- 不上云
