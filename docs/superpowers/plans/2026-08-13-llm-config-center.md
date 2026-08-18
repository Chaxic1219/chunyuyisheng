# 大模型配置中心实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将现有单一全局大模型配置升级为模型池，并允许五条业务分别配置主模型、备用模型与本地兜底。

**Architecture:** 继续以 `app/modules/llm_config.js` 作为唯一配置与运行时解析入口；新增模型表和业务路由表，并在首次启动时将 `llm_global_config` 无损迁移为默认模型。管理 API 按模型和路由拆分，业务调用通过明确的 `sceneId` 获取主备模型，数据库无新配置时保持现有环境变量回退行为。

**Tech Stack:** Node.js、SQLite（better-sqlite3）、Vue 3、TypeScript、Element Plus、现有零框架 Node 回归测试。

---

## 文件结构

- 修改 `app/modules/llm_config.js`：表结构、兼容迁移、模型 CRUD、路由 CRUD、公开脱敏、运行时解析。
- 修改 `app/routes/llm-admin.js`：模型池和业务路由管理接口、审计记录。
- 修改 `app/triage.js`：为分诊、Agent、科普草稿和健康探针传入业务场景。
- 修改 `app/modules/mpAi/client.js`：小程序 AI 使用 `mp_ai` 路由。
- 新建 `app/_llm_pool_test.js`：数据库迁移、密钥脱敏、引用约束和路由解析回归检查。
- 修改 `admin-ui/src/api/chunyu/index.ts`：模型、路由类型及 API。
- 修改 `admin-ui/src/views/chunyu/llm/index.vue`：页签、概览和页面状态协调。
- 新建 `admin-ui/src/views/chunyu/llm/ModelPoolPanel.vue`：左侧模型池和右侧模型详情。
- 新建 `admin-ui/src/views/chunyu/llm/BusinessRoutesPanel.vue`：五条业务路由编辑与风险提示。
- 新建 `admin-ui/_llm_config_center_test.cjs`：前端结构静态回归检查。

### Task 1：模型池数据层与旧配置迁移

**Files:**
- Modify: `app/modules/llm_config.js`
- Create: `app/_llm_pool_test.js`

- [ ] **Step 1：先写失败测试**

测试使用临时 SQLite 数据库注入 `ensureSchema(database)`，验证：旧表中的 `id=1` 被迁移成一个默认模型；重复执行迁移不重复插入；公开结果不包含 `api_key` 明文。

```js
assert.equal(store.listModels().length, 1);
assert.equal(store.listModels()[0].name, "默认模型");
assert.equal(store.listModels()[0].apiKeyMasked, "sk-a…7890");
assert.equal("apiKey" in store.listModels()[0], false);
```

- [ ] **Step 2：运行测试确认失败**

Run: `node app/_llm_pool_test.js`

Expected: FAIL，提示 `listModels is not a function`。

- [ ] **Step 3：新增最小表结构**

在 `ensureSchema` 中新增：

```sql
CREATE TABLE IF NOT EXISTS llm_models(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  provider TEXT NOT NULL,
  base_url TEXT NOT NULL,
  api_key TEXT,
  model TEXT NOT NULL,
  timeout_ms INTEGER NOT NULL DEFAULT 8000,
  enabled INTEGER NOT NULL DEFAULT 1,
  test_ok INTEGER NOT NULL DEFAULT 0,
  test_status INTEGER,
  test_latency_ms INTEGER,
  tested_at TEXT,
  updated_at TEXT,
  updated_by TEXT
);
CREATE TABLE IF NOT EXISTS llm_scene_routes(
  scene_id TEXT PRIMARY KEY,
  primary_model_id INTEGER NOT NULL,
  fallback_model_id INTEGER,
  fallback_action TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT,
  updated_by TEXT,
  FOREIGN KEY(primary_model_id) REFERENCES llm_models(id),
  FOREIGN KEY(fallback_model_id) REFERENCES llm_models(id)
);
```

迁移规则：仅在 `llm_models` 为空时读取 `llm_global_config`；创建“默认模型”；为五个场景写入默认主模型；不删除旧表。

- [ ] **Step 4：实现模型数据接口**

导出 `listModels`、`getModelPublic`、`saveModel`、`copyModel`、`setModelEnabled`、`deleteModel`。新建模型要求 API Key；编辑时空 API Key 保留旧值；删除和停用前查询路由引用并抛出“模型仍被业务使用”。

- [ ] **Step 5：运行回归测试**

Run: `node app/_llm_pool_test.js`

Expected: PASS，输出 `llm pool tests passed`。

### Task 2：业务路由与运行时解析

**Files:**
- Modify: `app/modules/llm_config.js`
- Modify: `app/_llm_pool_test.js`

- [ ] **Step 1：添加失败测试**

覆盖场景常量和约束：

```js
assert.deepEqual(store.SCENE_IDS, [
  "triage", "agent_draft", "science_reminder", "mp_ai", "health_probe"
]);
assert.throws(() => store.saveRoutes([{ sceneId: "mp_ai", primaryModelId: 1, fallbackModelId: 1 }]));
assert.equal(store.resolveRuntime({ sceneId: "mp_ai" }).modelId, primaryId);
assert.equal(store.resolveRuntime({ sceneId: "mp_ai", fallback: true }).modelId, fallbackId);
```

- [ ] **Step 2：运行测试确认失败**

Run: `node app/_llm_pool_test.js`

Expected: FAIL，提示缺少场景路由能力。

- [ ] **Step 3：实现路由接口**

新增 `listRoutes()` 与 `saveRoutes(routes, username)`。保存时校验场景白名单、主模型必填、主备不同、模型启用且最近一次测试成功。以事务一次保存全部路由，任一行失败则全部回滚。导出 `runWithFallback` 供所有业务统一执行主备切换。

- [ ] **Step 4：扩展运行时解析**

`resolveRuntime({ sceneId, fallback, multimodal })` 优先读取对应路由；`fallback=false` 返回主模型，`fallback=true` 返回备用模型。再新增唯一的主备执行器：

```js
async function runWithFallback(sceneId, run, opts) {
  const primary = resolveRuntime({ ...opts, sceneId });
  if (!primary) throw new Error("model_unavailable");
  try {
    return await run(primary);
  } catch (primaryError) {
    const fallback = resolveRuntime({ ...opts, sceneId, fallback: true });
    if (!fallback) throw primaryError;
    return run(fallback);
  }
}
```

`run` 只在上游 HTTP、超时或空响应时抛错；内容安全拦截仍按原业务逻辑直接进入本地兜底，不再次请求模型。没有新表数据时继续使用现有 `loadMerged()`，保证旧调用行为不变。

- [ ] **Step 5：运行测试**

Run: `node app/_llm_pool_test.js`

Expected: PASS。

### Task 3：管理 API 与审计

**Files:**
- Modify: `app/routes/llm-admin.js`
- Modify: `app/_llm_pool_test.js`

- [ ] **Step 1：为以下接口写失败检查**

```text
GET    /api/admin/llm/models
POST   /api/admin/llm/models
PUT    /api/admin/llm/models/:id
POST   /api/admin/llm/models/:id/copy
POST   /api/admin/llm/models/:id/test
DELETE /api/admin/llm/models/:id
GET    /api/admin/llm/routes
PUT    /api/admin/llm/routes
```

验证所有接口继续要求 `credential.manage`；返回体不包含明文密钥；保存、启停、删除、路由变更进入管理员审计。

- [ ] **Step 2：运行测试确认失败**

Run: `node app/_llm_pool_test.js`

Expected: FAIL，接口尚不存在。

- [ ] **Step 3：实现接口**

路由层只负责权限、请求体大小、参数转换、审计和 HTTP 状态；全部业务约束留在 `llm_config.js`。保留旧的 `/api/admin/llm/config` 与 `/api/admin/llm/test`，在一个发布周期内映射到默认模型，避免旧前端短暂失效。

- [ ] **Step 4：运行测试**

Run: `node app/_llm_pool_test.js`

Expected: PASS。

### Task 4：五条业务接入场景路由

**Files:**
- Modify: `app/triage.js`
- Modify: `app/modules/mpAi/client.js`
- Modify: `app/modules/community/moderation.js`
- Test: `app/_llm_pool_test.js`

- [ ] **Step 1：添加场景选择失败测试**

注入两个不同模型，验证分诊使用 `triage`、医助草稿使用 `agent_draft`、科普草稿使用 `science_reminder`、小程序使用 `mp_ai`、健康探针使用 `health_probe`；模拟主模型 HTTP 失败时只调用一次备用模型，备用模型也失败时进入现有本地兜底。

- [ ] **Step 2：运行测试确认失败**

Run: `node app/_llm_pool_test.js`

Expected: FAIL，当前调用均未传 `sceneId`。

- [ ] **Step 3：为现有调用补充明确场景**

将现有单模型请求包装进 `runWithFallback`，示例：

```js
return llmConfig.runWithFallback("mp_ai", cfg => requestChat(cfg, opts));
return llmConfig.runWithFallback("agent_draft", cfg => generateDraft(cfg, input));
return llmConfig.runWithFallback("triage", cfg => generateTriage(cfg, input), { multimodal: hasImages });
```

保持现有本地规则和安全兜底不变；本次不引入成本路由、并发竞速或自动负载均衡。

- [ ] **Step 4：运行相关测试**

Run: `node app/_llm_pool_test.js && node app/_mp_ai_test.js && node app/_qiwe_business_test.js`

Expected: 全部 PASS。

### Task 5：前端 API 与模型池页面

**Files:**
- Modify: `admin-ui/src/api/chunyu/index.ts`
- Modify: `admin-ui/src/views/chunyu/llm/index.vue`
- Create: `admin-ui/src/views/chunyu/llm/ModelPoolPanel.vue`
- Create: `admin-ui/_llm_config_center_test.cjs`

- [ ] **Step 1：写前端静态失败检查**

检查页面包含“模型配置”“业务路由”“模型池”“新增模型”“连通性检测”，且不再渲染旧“总开关 + 单一默认模型”布局。

- [ ] **Step 2：运行检查确认失败**

Run: `node admin-ui/_llm_config_center_test.cjs`

Expected: FAIL，缺少模型池组件。

- [ ] **Step 3：定义类型和 API**

新增 `ChunyuLlmModel`、`ChunyuLlmRoute`、`ChunyuLlmOverview` 类型及 Task 3 对应请求函数。密钥字段只有 `apiKeyMasked`、`apiKeyConfigured`，请求时使用可选 `apiKey`。

- [ ] **Step 4：实现模型池页面**

按照已确认原型实现左侧列表和右侧详情；新增、复制、删除、测试与保存直接复用 Element Plus 组件。编辑表单只维护当前选中模型，不创建额外全局状态层。

- [ ] **Step 5：运行检查和构建**

Run: `node admin-ui/_llm_config_center_test.cjs && pnpm --dir admin-ui build`

Expected: 检查 PASS，构建退出码 0。

### Task 6：业务路由页面

**Files:**
- Modify: `admin-ui/src/views/chunyu/llm/index.vue`
- Create: `admin-ui/src/views/chunyu/llm/BusinessRoutesPanel.vue`
- Modify: `admin-ui/_llm_config_center_test.cjs`

- [ ] **Step 1：添加失败检查**

验证五个固定场景、主模型、备用模型、失败后处理、风险定位和“主模型 → 备用模型 → 本地兜底”说明均存在。

- [ ] **Step 2：运行检查确认失败**

Run: `node admin-ui/_llm_config_center_test.cjs`

Expected: FAIL，业务路由组件尚不存在。

- [ ] **Step 3：实现路由编辑**

仅允许选择启用且测试成功的模型；备用模型排除当前主模型；后端返回风险时保留用户输入并高亮对应行。保存成功后重新加载服务器数据。

- [ ] **Step 4：运行检查和构建**

Run: `node admin-ui/_llm_config_center_test.cjs && pnpm --dir admin-ui build`

Expected: 全部 PASS，构建退出码 0。

### Task 7：迁移演练、云端部署与验收

**Files:**
- Use: `app/_run_deploy_llm_config.py`
- Create during execution: `_run_verify_llm_pool.py`（验证后删除）

- [ ] **Step 1：在生产数据库副本演练迁移**

备份 `/var/lib/chunyu-doctor/data.db` 后复制到临时路径，在副本执行 `ensureSchema`。检查默认模型数量为 1、五条路由均指向该模型、旧表仍存在。

- [ ] **Step 2：运行完整本地验证**

Run: `node app/_llm_pool_test.js && node app/_mp_ai_test.js && node app/_qiwe_business_test.js && node admin-ui/_llm_config_center_test.cjs && pnpm --dir admin-ui build`

Expected: 所有测试 PASS，构建退出码 0。

- [ ] **Step 3：备份并部署**

备份生产数据库、`app/modules/llm_config.js`、`app/routes/llm-admin.js`、相关业务文件和 `app/public/admin-v2`。上传后只重启 `chunyu-doctor` PM2 进程。

- [ ] **Step 4：线上验收**

验证：旧配置自动成为默认模型；API Key 只显示掩码；连通性测试能记录延迟；五条路由可读取；已有分诊和小程序 AI 请求仍可执行；异常模型不能保存到路由。

- [ ] **Step 5：清理临时验证脚本**

删除 `_run_verify_llm_pool.py`，保留数据库与静态资源备份路径用于回滚。

## 范围控制

本计划不包含调用次数、Token 成本、自动按延迟选模、并发竞速、熔断器和历史监控图表；这些能力在真实调用数据形成后再评估。
