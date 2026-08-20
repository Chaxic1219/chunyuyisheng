"use strict";

const assert = require("assert");
const { DatabaseSync } = require("node:sqlite");
const llm = require("./modules/llm_config.js");

const tests = [];
const FALLBACK_ACTIONS = {
  triage: "local_rule_triage",
  agent_draft: "basic_template",
  science_reminder: "stop_and_alert",
  mp_ai: "safe_message",
  health_probe: "log_error"
};

function test(name, fn) {
  tests.push([name, fn]);
}

function memoryDb() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  return db;
}

function addReadyModel(db, name, overrides) {
  const values = { enabled: 1, testOk: 1, ...(overrides || {}) };
  const result = db.prepare(`INSERT INTO llm_models
    (name,provider,base_url,api_key,model,timeout_ms,enabled,test_ok)
    VALUES(?,?,?,?,?,?,?,?)`).run(
    name, "openai", "https://api.example", "secret-" + name, "model-" + name, 8000,
    values.enabled, values.testOk
  );
  return Number(result.lastInsertRowid);
}

function fiveRoutes(primaryModelId, fallbackModelId) {
  return llm.SCENE_IDS.map((sceneId) => ({
    sceneId,
    primaryModelId,
    fallbackModelId: fallbackModelId == null ? null : fallbackModelId,
    fallbackAction: FALLBACK_ACTIONS[sceneId],
    enabled: true
  }));
}

test("两张新表具有完整字段、约束、默认值和外键", () => {
  const db = memoryDb();
  llm.ensureSchema(db);
  const models = db.prepare("PRAGMA table_info(llm_models)").all();
  const routes = db.prepare("PRAGMA table_info(llm_scene_routes)").all();
  assert.deepStrictEqual(models.map((column) => column.name), [
    "id", "name", "provider", "base_url", "api_key", "model", "timeout_ms", "enabled",
    "test_ok", "test_status", "test_latency_ms", "tested_at", "updated_at", "updated_by"
  ]);
  assert.deepStrictEqual(routes.map((column) => column.name), [
    "scene_id", "primary_model_id", "fallback_model_id", "fallback_action", "enabled", "updated_at", "updated_by"
  ]);

  const modelColumns = Object.fromEntries(models.map((column) => [column.name, column]));
  assert.equal(modelColumns.id.pk, 1);
  for (const name of ["name", "provider", "base_url", "model", "timeout_ms", "enabled", "test_ok"]) {
    assert.equal(modelColumns[name].notnull, 1, `${name} should be NOT NULL`);
  }
  assert.equal(modelColumns.timeout_ms.dflt_value, "8000");
  assert.equal(modelColumns.enabled.dflt_value, "1");
  assert.equal(modelColumns.test_ok.dflt_value, "0");

  const routeColumns = Object.fromEntries(routes.map((column) => [column.name, column]));
  assert.equal(routeColumns.scene_id.pk, 1);
  for (const name of ["primary_model_id", "fallback_action", "enabled"]) {
    assert.equal(routeColumns[name].notnull, 1, `${name} should be NOT NULL`);
  }
  assert.equal(routeColumns.enabled.dflt_value, "1");
  assert.deepStrictEqual(
    db.prepare("PRAGMA foreign_key_list(llm_scene_routes)").all()
      .map((foreignKey) => [foreignKey.from, foreignKey.table, foreignKey.to]).sort(),
    [
      ["fallback_model_id", "llm_models", "id"],
      ["primary_model_id", "llm_models", "id"]
    ]
  );
});

test("旧配置只迁移一次并创建五条场景路由", () => {
  const db = memoryDb();
  db.exec(`CREATE TABLE llm_global_config(
    id INTEGER PRIMARY KEY, provider TEXT, base_url TEXT, api_key TEXT,
    model TEXT, timeout_ms INTEGER, disabled INTEGER, updated_at TEXT, updated_by TEXT
  )`);
  db.prepare(`INSERT INTO llm_global_config
    (id,provider,base_url,api_key,model,timeout_ms,disabled,updated_at,updated_by)
    VALUES(1,?,?,?,?,?,?,?,?)`)
    .run("deepseek", "https://old.example", "secret-old", "old-model", 9000, 1, "2026-01-02", "legacy-admin");

  llm.ensureSchema(db);
  llm.ensureSchema(db);

  const models = db.prepare("SELECT * FROM llm_models").all();
  assert.equal(models.length, 1);
  assert.equal(models[0].name, "默认模型");
  assert.equal(models[0].provider, "deepseek");
  assert.equal(models[0].base_url, "https://old.example");
  assert.equal(models[0].api_key, "secret-old");
  assert.equal(models[0].model, "old-model");
  assert.equal(models[0].timeout_ms, 9000);
  assert.equal(models[0].enabled, 0);
  assert.equal(models[0].updated_at, "2026-01-02");
  assert.equal(models[0].updated_by, "legacy-admin");

  const routes = db.prepare("SELECT * FROM llm_scene_routes ORDER BY scene_id").all();
  assert.deepStrictEqual(routes.map((row) => row.scene_id), [
    "agent_draft", "health_probe", "mp_ai", "science_reminder", "triage"
  ]);
  assert.ok(routes.every((row) => row.primary_model_id === models[0].id));
  assert.ok(routes.every((row) => row.enabled === 0));
  assert.deepStrictEqual(
    Object.fromEntries(routes.map((row) => [row.scene_id, row.fallback_action])),
    FALLBACK_ACTIONS
  );
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='llm_global_config'").get());
});

test("模型池为空时导入真实环境模型且不伪造检测状态", () => {
  const names = [
    "DEEPSEEK_API_KEY", "DEEPSEEK_BASE_URL", "DEEPSEEK_MODEL", "TRIAGE_MODEL",
    "TRIAGE_AI_TIMEOUT_MS", "MP_AI_API_KEY", "MP_AI_BASE_URL", "MP_AI_MODEL"
  ];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  Object.assign(process.env, {
    DEEPSEEK_API_KEY: "dashscope-real-key",
    DEEPSEEK_BASE_URL: "https://workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
    DEEPSEEK_MODEL: "qwen-turbo",
    TRIAGE_AI_TIMEOUT_MS: "20000",
    MP_AI_API_KEY: "deepseek-real-key",
    MP_AI_BASE_URL: "https://api.deepseek.com",
    MP_AI_MODEL: "deepseek-chat"
  });
  try {
    const db = memoryDb();
    llm.ensureSchema(db);
    llm.ensureSchema(db);
    const models = llm.listModels(db);
    assert.equal(models.length, 2);
    assert.deepStrictEqual(models.map((model) => [model.provider, model.baseUrl, model.model, model.timeoutMs]), [
      ["bailian", "https://workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1", "qwen-turbo", 20000],
      ["deepseek", "https://api.deepseek.com", "deepseek-chat", 8000]
    ]);
    assert.ok(models.every((model) => model.enabled && !model.testOk && model.apiKeyConfigured));
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM llm_scene_routes").get().count, 0);
  } finally {
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  }
});

test("旧配置迁移任一路由失败时回滚模型和全部路由", () => {
  const db = memoryDb();
  db.exec(`CREATE TABLE llm_global_config(
    id INTEGER PRIMARY KEY, provider TEXT, base_url TEXT, api_key TEXT,
    model TEXT, timeout_ms INTEGER, disabled INTEGER, updated_at TEXT, updated_by TEXT
  );
  INSERT INTO llm_global_config
    (id,provider,base_url,api_key,model,timeout_ms,disabled,updated_at,updated_by)
    VALUES(1,'deepseek','https://old.example','secret-old','old-model',9000,0,'2026-01-02','legacy');
  CREATE TABLE llm_scene_routes(
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
  CREATE TRIGGER fail_science_route BEFORE INSERT ON llm_scene_routes
    WHEN NEW.scene_id = 'science_reminder'
    BEGIN SELECT RAISE(ABORT, 'controlled route failure'); END;`);

  assert.throws(() => llm.ensureSchema(db), /controlled route failure/);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM llm_models").get().count, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM llm_scene_routes").get().count, 0);
});

test("模型表非空时不迁移旧配置", () => {
  const db = memoryDb();
  llm.ensureSchema(db);
  db.prepare(`INSERT INTO llm_models
    (name,provider,base_url,api_key,model,timeout_ms,enabled)
    VALUES(?,?,?,?,?,?,?)`).run("已有模型", "openai", "https://new.example", "new-secret", "new-model", 8000, 1);
  db.prepare(`INSERT INTO llm_global_config
    (id,provider,base_url,api_key,model,timeout_ms,disabled,updated_at,updated_by)
    VALUES(1,?,?,?,?,?,?,?,?)`)
    .run("deepseek", "https://old.example", "old-secret", "old-model", 9000, 0, "2026-01-02", "legacy");

  llm.ensureSchema(db);

  const models = db.prepare("SELECT name,api_key FROM llm_models").all();
  assert.equal(models.length, 1);
  assert.equal(models[0].name, "已有模型");
  assert.equal(models[0].api_key, "new-secret");
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='llm_global_config'").get());
});

test("模型公开接口脱敏且编辑空密钥保留旧值", () => {
  const db = memoryDb();
  llm.ensureSchema(db);
  const created = llm.saveModel({
    name: "主模型", provider: "openai", baseUrl: "https://api.example/", apiKey: "sk-1234567890",
    model: "gpt-test", timeoutMs: 12000
  }, "alice", db);
  assert.equal(created.baseUrl, "https://api.example");
  assert.equal(created.apiKeyConfigured, true);
  assert.equal(created.apiKeyMasked, "sk-1…7890");
  assert.equal(Object.hasOwn(created, "api_key"), false);
  assert.equal(Object.hasOwn(created, "apiKey"), false);
  assert.equal(JSON.stringify(created).includes("sk-1234567890"), false);

  const edited = llm.saveModel({ id: created.id, name: "主模型二", baseUrl: created.baseUrl,
    model: created.model, timeoutMs: 12000, apiKey: "" }, "bob", db);
  assert.equal(edited.name, "主模型二");
  assert.equal(db.prepare("SELECT api_key FROM llm_models WHERE id=?").get(created.id).api_key, "sk-1234567890");
  assert.equal(JSON.stringify(llm.listModels(db)).includes("sk-1234567890"), false);
  assert.equal(JSON.stringify(llm.getModelPublic(created.id, db)).includes("sk-1234567890"), false);
});

test("新模型校验必填字段和超时范围", () => {
  const db = memoryDb();
  llm.ensureSchema(db);
  const base = { name: "模型", provider: "openai", baseUrl: "https://api.example", model: "m" };
  assert.throws(() => llm.saveModel(base, "alice", db), /API Key/i);
  assert.throws(() => llm.saveModel({ ...base, apiKey: "key", name: "" }, "alice", db), /名称/);
  assert.throws(() => llm.saveModel({ ...base, apiKey: "key", baseUrl: "" }, "alice", db), /Base URL/i);
  assert.throws(() => llm.saveModel({ ...base, apiKey: "key", model: "" }, "alice", db), /模型/);
  assert.throws(() => llm.saveModel({ ...base, apiKey: "key", timeoutMs: 999 }, "alice", db), /1000.*120000/);
  assert.throws(() => llm.saveModel({ ...base, apiKey: "key", timeoutMs: 120001 }, "alice", db), /1000.*120000/);
});

test("删除不存在模型抛出一致错误", () => {
  const db = memoryDb();
  llm.ensureSchema(db);
  assert.throws(() => llm.deleteModel(999, db), /模型不存在/);
});

test("被路由引用的模型禁止停用和删除", () => {
  const db = memoryDb();
  llm.ensureSchema(db);
  const model = llm.saveModel({ name: "引用模型", provider: "openai", baseUrl: "https://api.example",
    apiKey: "key", model: "m", timeoutMs: 8000 }, "alice", db);
  db.prepare(`INSERT INTO llm_scene_routes
    (scene_id,primary_model_id,fallback_action,enabled,updated_at,updated_by)
    VALUES(?,?,?,?,?,?)`).run("triage", model.id, "error", 1, "now", "alice");
  assert.throws(() => llm.saveModel({ id: model.id, name: model.name, baseUrl: model.baseUrl,
    model: model.model, timeoutMs: model.timeoutMs, apiKey: "", enabled: false }, "alice", db), /场景.*引用/);
  assert.throws(() => llm.setModelEnabled(model.id, false, "alice", db), /场景.*引用/);
  assert.throws(() => llm.deleteModel(model.id, db), /场景.*引用/);
  assert.equal(llm.setModelEnabled(model.id, true, "alice", db).enabled, true);
});

test("复制模型不复制测试成功状态", () => {
  const db = memoryDb();
  llm.ensureSchema(db);
  const model = llm.saveModel({ name: "可复制", provider: "openai", baseUrl: "https://api.example",
    apiKey: "copy-secret", model: "m", timeoutMs: 8000 }, "alice", db);
  db.prepare("UPDATE llm_models SET test_ok=1,test_status='ok',test_latency_ms=12,tested_at='now' WHERE id=?")
    .run(model.id);
  const copied = llm.copyModel(model.id, "bob", db);
  assert.notEqual(copied.id, model.id);
  assert.match(copied.name, /副本/);
  assert.equal(copied.testOk, false);
  assert.equal(copied.testStatus, "");
  assert.equal(copied.testLatencyMs, null);
  assert.equal(copied.testedAt, "");
  assert.equal(copied.apiKeyConfigured, true);
  assert.equal(JSON.stringify(copied).includes("copy-secret"), false);
});

test("编辑模型连接关键字段时清空测试状态", () => {
  const changes = [
    { provider: "anthropic" },
    { baseUrl: "https://other.example" },
    { apiKey: "new-secret" },
    { model: "other-model" }
  ];
  for (const change of changes) {
    const db = memoryDb();
    llm.ensureSchema(db);
    const model = llm.saveModel({ name: "模型", provider: "openai", baseUrl: "https://api.example",
      apiKey: "old-secret", model: "old-model", timeoutMs: 8000 }, "alice", db);
    db.prepare("UPDATE llm_models SET test_ok=1,test_status='ok',test_latency_ms=12,tested_at='now' WHERE id=?")
      .run(model.id);
    const saved = llm.saveModel({ id: model.id, ...change }, "bob", db);
    assert.equal(saved.testOk, false);
    assert.equal(saved.testStatus, "");
    assert.equal(saved.testLatencyMs, null);
    assert.equal(saved.testedAt, "");
  }
});

test("编辑模型非连接字段或保留密钥时保持测试状态", () => {
  const db = memoryDb();
  llm.ensureSchema(db);
  const model = llm.saveModel({ name: "模型", provider: "openai", baseUrl: "https://api.example",
    apiKey: "same-secret", model: "old-model", timeoutMs: 8000 }, "alice", db);
  db.prepare("UPDATE llm_models SET test_ok=1,test_status='ok',test_latency_ms=12,tested_at='now' WHERE id=?")
    .run(model.id);
  const saved = llm.saveModel({ id: model.id, name: "新名字", timeoutMs: 9000, apiKey: "" }, "bob", db);
  assert.equal(saved.testOk, true);
  assert.equal(saved.testStatus, "ok");
  assert.equal(saved.testLatencyMs, 12);
  assert.equal(saved.testedAt, "now");
  assert.equal(llm.saveModel({ id: model.id, apiKey: "same-secret" }, "bob", db).testOk, true);
});

test("旧接口兼容且新增接口默认读取 getDb", async () => {
  const db = memoryDb();
  const dbModulePath = require.resolve("./db.js");
  const previousDbModule = require.cache[dbModulePath];
  const previousFetch = global.fetch;
  const previousDisabled = process.env.TRIAGE_AI_DISABLED;
  require.cache[dbModulePath] = {
    id: dbModulePath,
    filename: dbModulePath,
    loaded: true,
    exports: { db }
  };
  process.env.TRIAGE_AI_DISABLED = "";
  try {
    const saved = llm.saveConfig({
      provider: "openai", baseUrl: "https://compat.example/", apiKey: "compat-secret",
      model: "compat-model", timeoutMs: 5000, disabled: false
    }, "compat-user");
    assert.equal(saved.baseUrl, "https://compat.example");
    assert.equal(saved.apiKeyConfigured, true);
    assert.equal(JSON.stringify(saved).includes("compat-secret"), false);

    const merged = llm.loadMerged();
    assert.equal(merged.apiKey, "compat-secret");
    assert.equal(merged.model, "compat-model");
    const runtime = llm.resolveRuntime({});
    assert.equal(runtime.key, "compat-secret");
    assert.equal(runtime.url, "https://compat.example/chat/completions");
    assert.equal(llm.getPublic().model, "compat-model");

    let requested = null;
    global.fetch = async (url, options) => {
      requested = { url, options };
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ choices: [{ message: { content: "pong" } }] })
      };
    };
    const connection = await llm.testConnection({});
    assert.equal(connection.ok, true);
    assert.equal(connection.model, "compat-model");
    assert.equal(requested.url, "https://compat.example/chat/completions");
    assert.equal(requested.options.headers.Authorization, "Bearer compat-secret");

    const models = llm.listModels();
    assert.equal(models.length, 1);
    assert.equal(models[0].model, "compat-model");
    assert.equal(JSON.stringify(models).includes("compat-secret"), false);
  } finally {
    global.fetch = previousFetch;
    if (previousDisabled === undefined) delete process.env.TRIAGE_AI_DISABLED;
    else process.env.TRIAGE_AI_DISABLED = previousDisabled;
    if (previousDbModule) require.cache[dbModulePath] = previousDbModule;
    else delete require.cache[dbModulePath];
  }
});

test("SCENE_IDS has the fixed public order", () => {
  assert.deepStrictEqual(llm.SCENE_IDS, [
    "triage", "agent_draft", "science_reminder", "mp_ai", "qiwe_dm", "health_probe"
  ]);
});

test("saveRoutes saves and listRoutes returns five sanitized routes", () => {
  const db = memoryDb();
  llm.ensureSchema(db);
  const primary = addReadyModel(db, "primary");
  const fallback = addReadyModel(db, "fallback");
  const saved = llm.saveRoutes(fiveRoutes(primary, fallback), "alice", db);
  assert.deepStrictEqual(saved.map((route) => route.sceneId), llm.SCENE_IDS);
  assert.ok(saved.every((route) => route.primaryModel.id === primary));
  assert.ok(saved.every((route) => route.fallbackModel.id === fallback));
  assert.ok(!JSON.stringify(saved).includes("secret-"));
  assert.deepStrictEqual(llm.listRoutes(db), saved);
});

test("saveRoutes rejects missing duplicate and unknown scenes", () => {
  const db = memoryDb();
  llm.ensureSchema(db);
  const primary = addReadyModel(db, "primary");
  const routes = fiveRoutes(primary);
  assert.throws(() => llm.saveRoutes(routes.slice(0, 4), "alice", db), /five|scene|场景/i);
  assert.throws(() => llm.saveRoutes([...routes.slice(0, 4), routes[0]], "alice", db), /duplicate|scene|场景/i);
  assert.throws(() => llm.saveRoutes([...routes.slice(0, 4), { ...routes[4], sceneId: "unknown" }], "alice", db), /unknown|scene|场景/i);
});

test("saveRoutes rejects the same primary and fallback model", () => {
  const db = memoryDb();
  llm.ensureSchema(db);
  const primary = addReadyModel(db, "primary");
  assert.throws(() => llm.saveRoutes(fiveRoutes(primary, primary), "alice", db), /same|相同/i);
});

test("saveRoutes requires a primary model and supported fallback action", () => {
  const db = memoryDb();
  llm.ensureSchema(db);
  const primary = addReadyModel(db, "primary");
  const missingPrimary = fiveRoutes(primary);
  delete missingPrimary[0].primaryModelId;
  assert.throws(() => llm.saveRoutes(missingPrimary, "alice", db), /primary|主模型/i);
  const badAction = fiveRoutes(primary);
  badAction[0].fallbackAction = "anything";
  assert.throws(() => llm.saveRoutes(badAction, "alice", db), /fallback action|回退/i);
  const wrongSceneAction = fiveRoutes(primary);
  wrongSceneAction[0].fallbackAction = FALLBACK_ACTIONS.agent_draft;
  assert.throws(() => llm.saveRoutes(wrongSceneAction, "alice", db), /fallback action|回退/i);
});

test("saveRoutes rejects nonexistent model ids and an empty fallback action", () => {
  const db = memoryDb();
  llm.ensureSchema(db);
  const primary = addReadyModel(db, "primary");
  const fallback = addReadyModel(db, "fallback");
  const badPrimary = fiveRoutes(primary, fallback);
  badPrimary[0].primaryModelId = 99999;
  assert.throws(() => llm.saveRoutes(badPrimary, "alice", db), /primary|available|可用/i);
  const badFallback = fiveRoutes(primary, fallback);
  badFallback[0].fallbackModelId = 99999;
  assert.throws(() => llm.saveRoutes(badFallback, "alice", db), /fallback|available|可用/i);
  const emptyAction = fiveRoutes(primary, fallback);
  emptyAction[0].fallbackAction = "";
  assert.throws(() => llm.saveRoutes(emptyAction, "alice", db), /fallback action|回退/i);
});

test("saveRoutes rejects disabled or untested models", () => {
  const db = memoryDb();
  llm.ensureSchema(db);
  const ready = addReadyModel(db, "ready");
  const disabled = addReadyModel(db, "disabled", { enabled: 0 });
  const untested = addReadyModel(db, "untested", { testOk: 0 });
  assert.throws(() => llm.saveRoutes(fiveRoutes(disabled), "alice", db), /available|enabled|tested|可用/i);
  assert.throws(() => llm.saveRoutes(fiveRoutes(ready, untested), "alice", db), /available|enabled|tested|可用/i);
});

test("saveRoutes rolls back every row when one write fails", () => {
  const db = memoryDb();
  llm.ensureSchema(db);
  const primary = addReadyModel(db, "primary");
  db.exec(`CREATE TRIGGER fail_mp_route BEFORE INSERT ON llm_scene_routes
    WHEN NEW.scene_id = 'mp_ai' BEGIN SELECT RAISE(ABORT, 'controlled save failure'); END;`);
  assert.throws(() => llm.saveRoutes(fiveRoutes(primary), "alice", db), /controlled save failure/);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM llm_scene_routes").get().count, 0);
});

test("resolveRuntime selects primary and fallback route models", () => {
  const db = memoryDb();
  llm.ensureSchema(db);
  const primary = addReadyModel(db, "primary");
  const fallback = addReadyModel(db, "fallback");
  llm.saveRoutes(fiveRoutes(primary, fallback), "alice", db);
  const main = llm.resolveRuntime({ sceneId: "triage", database: db });
  const backup = llm.resolveRuntime({ sceneId: "triage", fallback: true, database: db });
  assert.equal(main.modelId, primary);
  assert.equal(main.model, "model-primary");
  assert.equal(backup.modelId, fallback);
  assert.equal(backup.model, "model-fallback");
});

test("resolveRuntime returns null for a disabled route", () => {
  const db = memoryDb();
  llm.ensureSchema(db);
  const primary = addReadyModel(db, "primary");
  llm.saveRoutes(fiveRoutes(primary), "alice", db);
  db.prepare("UPDATE llm_scene_routes SET enabled=0 WHERE scene_id='triage'").run();
  assert.equal(llm.resolveRuntime({ sceneId: "triage", database: db }), null);
  db.prepare("UPDATE llm_scene_routes SET enabled=1 WHERE scene_id='triage'").run();
  db.prepare("UPDATE llm_models SET enabled=0 WHERE id=?").run(primary);
  assert.equal(llm.resolveRuntime({ sceneId: "triage", database: db }), null);
});

test("resolveRuntime returns null without fallback or when a selected model is untested", () => {
  const db = memoryDb();
  llm.ensureSchema(db);
  const primary = addReadyModel(db, "primary");
  const fallback = addReadyModel(db, "fallback");
  llm.saveRoutes(fiveRoutes(primary), "alice", db);
  assert.equal(llm.resolveRuntime({ sceneId: "triage", fallback: true, database: db }), null);

  llm.saveRoutes(fiveRoutes(primary, fallback), "alice", db);
  db.prepare("UPDATE llm_models SET test_ok=0 WHERE id=?").run(primary);
  assert.equal(llm.resolveRuntime({ sceneId: "triage", database: db }), null);
  db.prepare("UPDATE llm_models SET test_ok=1 WHERE id=?").run(primary);
  db.prepare("UPDATE llm_models SET test_ok=0 WHERE id=?").run(fallback);
  assert.equal(llm.resolveRuntime({ sceneId: "triage", fallback: true, database: db }), null);
});

test("resolveRuntime keeps multimodal null behavior for scene routes", () => {
  const db = memoryDb();
  llm.ensureSchema(db);
  const primary = addReadyModel(db, "primary");
  llm.saveRoutes(fiveRoutes(primary), "alice", db);
  assert.equal(llm.resolveRuntime({ sceneId: "triage", multimodal: true, database: db }), null);
});

test("runWithFallback calls the primary model once on success", async () => {
  const db = memoryDb();
  llm.ensureSchema(db);
  const primary = addReadyModel(db, "primary");
  const fallback = addReadyModel(db, "fallback");
  llm.saveRoutes(fiveRoutes(primary, fallback), "alice", db);
  const calls = [];
  const result = await llm.runWithFallback("triage", async (runtime) => {
    calls.push(runtime.modelId);
    return "ok";
  }, {}, db);
  assert.equal(result, "ok");
  assert.deepStrictEqual(calls, [primary]);
});

test("runWithFallback passes all five business scene ids to the routed runtime", async () => {
  const db = memoryDb();
  llm.ensureSchema(db);
  const primary = addReadyModel(db, "primary");
  llm.saveRoutes(fiveRoutes(primary), "alice", db);
  const seen = [];
  for (const sceneId of llm.SCENE_IDS) {
    await llm.runWithFallback(sceneId, async (runtime) => {
      seen.push([sceneId, runtime.modelId]);
      return "ok";
    }, {}, db);
  }
  assert.deepStrictEqual(seen, llm.SCENE_IDS.map((sceneId) => [sceneId, primary]));
});

test("runWithFallback uses the legacy runtime only when the scene route is absent", async () => {
  const db = memoryDb();
  llm.ensureSchema(db);
  db.prepare(`INSERT INTO llm_global_config
    (id,provider,base_url,api_key,model,timeout_ms,disabled)
    VALUES(1,'openai','https://legacy.example','legacy-secret','legacy-model',8000,0)`).run();
  const seen = [];
  const result = await llm.runWithFallback("triage", async (runtime) => {
    seen.push(runtime.model);
    return "legacy ok";
  }, {}, db);
  assert.equal(result, "legacy ok");
  assert.deepStrictEqual(seen, ["legacy-model"]);
});

test("runWithFallback does not bypass a configured but unavailable scene route", async () => {
  const db = memoryDb();
  llm.ensureSchema(db);
  db.prepare(`INSERT INTO llm_global_config
    (id,provider,base_url,api_key,model,timeout_ms,disabled)
    VALUES(1,'openai','https://legacy.example','legacy-secret','legacy-model',8000,0)`).run();
  const unavailable = addReadyModel(db, "unavailable", { testOk: 0 });
  db.prepare(`INSERT INTO llm_scene_routes
    (scene_id,primary_model_id,fallback_model_id,fallback_action,enabled)
    VALUES(?,?,?,?,1)`).run("triage", unavailable, null, FALLBACK_ACTIONS.triage);
  let calls = 0;
  await assert.rejects(
    () => llm.runWithFallback("triage", async () => { calls += 1; }, {}, db),
    /unavailable/i
  );
  assert.equal(calls, 0);
});

test("five production call paths use their dedicated fallback scenes", () => {
  const fs = require("fs");
  const path = require("path");
  const triageSource = fs.readFileSync(path.join(__dirname, "triage.js"), "utf8");
  const mpSource = fs.readFileSync(path.join(__dirname, "modules/mpAi/client.js"), "utf8");
  const healthSource = fs.readFileSync(path.join(__dirname, "llm_health.js"), "utf8");
  const moderationSource = fs.readFileSync(path.join(__dirname, "modules/community/moderation.js"), "utf8");
  assert.match(triageSource, /fetchSceneJson\("triage"/);
  assert.match(triageSource, /input\.contextType === "science_reminder"\s*\?\s*"science_reminder"\s*:\s*"agent_draft"/);
  assert.match(mpSource, /runWithFallback\("mp_ai"/);
  assert.match(healthSource, /runWithFallback\("health_probe"/);
  assert.match(moderationSource, /runWithFallback\("triage"/);
});

test("triage legacy MiMo config preserves text, multimodal, URL and api-key semantics", () => {
  const previous = { key:process.env.MIMO_API_KEY, base:process.env.MIMO_BASE_URL, text:process.env.MIMO_TEXT_MODEL, vision:process.env.MIMO_MULTIMODAL_MODEL };
  process.env.MIMO_API_KEY = "tp-test-key";
  delete process.env.MIMO_BASE_URL;
  process.env.MIMO_TEXT_MODEL = "mimo-text-test";
  process.env.MIMO_MULTIMODAL_MODEL = "mimo-vision-test";
  const triage = require("./triage.js");
  const textCfg = triage.modelConfig({});
  const visionCfg = triage.modelConfig({ multimodal:true });
  assert.equal(textCfg.model, "mimo-text-test");
  assert.equal(visionCfg.model, "mimo-vision-test");
  assert.match(textCfg.url, /^https:\/\/token-plan-cn\.xiaomimimo\.com\/v1\/chat\/completions$/);
  assert.equal(textCfg.headers["api-key"], "tp-test-key");
  assert.equal(textCfg.maxTokenField, "max_completion_tokens");
  for(const [name, value] of Object.entries(previous)) {
    const envName = { key:"MIMO_API_KEY", base:"MIMO_BASE_URL", text:"MIMO_TEXT_MODEL", vision:"MIMO_MULTIMODAL_MODEL" }[name];
    if(value === undefined) delete process.env[envName]; else process.env[envName] = value;
  }
});

test("agent compose entry points use agent_draft and make at most primary plus fallback calls", async () => {
  const modulePath = require.resolve("./modules/llm_config.js");
  const original = require.cache[modulePath];
  const scenes = [];
  require.cache[modulePath] = { id:modulePath, filename:modulePath, loaded:true, exports:{
    runWithFallback: async (sceneId, run) => {
      scenes.push(sceneId);
      try { return await run({ model:"primary", url:"https://primary", headers:{}, maxTokenField:"max_tokens" }); }
      catch(e){ assert.equal(e.llmRetryable, true); return run({ model:"fallback", url:"https://fallback", headers:{}, maxTokenField:"max_tokens" }); }
    }
  }};
  const oldFetch = global.fetch;
  const urls = [];
  global.fetch = async url => {
    urls.push(String(url));
    if(String(url).includes("primary")) return { ok:false, status:503 };
    return { ok:true, status:200, json:async()=>({ choices:[{ message:{ content:"已收到，我来帮您整理。" } }] }) };
  };
  try{
    delete require.cache[require.resolve("./agent/compose.js")];
    delete require.cache[require.resolve("./agent/compose_health_chat.js")];
    await require("./agent/compose.js").compose({ text:"您好", goal:"service" });
    await require("./agent/compose_health_chat.js").composeHealthChat({ text:"有点不舒服", phase:"advise", slots:{} });
    assert.deepStrictEqual(scenes, ["agent_draft", "agent_draft"]);
    assert.equal(urls.length, 4);
  }finally{
    global.fetch = oldFetch;
    if(original) require.cache[modulePath] = original; else delete require.cache[modulePath];
  }
});

test("health probe retries a primary HTTP failure once on the fallback", async () => {
  const modulePath = require.resolve("./modules/llm_config.js");
  const healthPath = require.resolve("./llm_health.js");
  const original = require.cache[modulePath];
  const scenes = [];
  require.cache[modulePath] = { id:modulePath, filename:modulePath, loaded:true, exports:{
    runWithFallback: async (sceneId, run) => {
      scenes.push(sceneId);
      try { return await run({ model:"primary", url:"https://primary", headers:{} }); }
      catch(e){ assert.equal(e.llmRetryable, true); return run({ model:"fallback", url:"https://fallback", headers:{} }); }
    }
  }};
  const oldFetch = global.fetch;
  let calls = 0;
  global.fetch = async url => {
    calls += 1;
    if(String(url).includes("primary")) return { ok:false, status:503 };
    return { ok:true, status:200, json:async()=>({ choices:[{ message:{ content:"ok" } }] }) };
  };
  try{
    delete require.cache[healthPath];
    const health = require("./llm_health.js").startLlmHealthCheck({ log:()=>{}, logError:()=>{} });
    await health.probeOnce();
    clearInterval(health.timer);
    assert.deepStrictEqual(scenes, ["health_probe", "health_probe"]);
    assert.equal(calls, 4);
    assert.equal(health.status().ok, true);
  }finally{
    global.fetch = oldFetch;
    delete require.cache[healthPath];
    if(original) require.cache[modulePath] = original; else delete require.cache[modulePath];
  }
});

test("runWithFallback directly uses fallback once when primary is unavailable", async () => {
  const db = memoryDb();
  llm.ensureSchema(db);
  const primary = addReadyModel(db, "primary");
  const fallback = addReadyModel(db, "fallback");
  llm.saveRoutes(fiveRoutes(primary, fallback), "alice", db);
  db.prepare("UPDATE llm_models SET test_ok=0 WHERE id=?").run(primary);
  const calls = [];
  const result = await llm.runWithFallback("triage", async (runtime) => {
    calls.push(runtime.modelId);
    return "fallback ok";
  }, {}, db);
  assert.equal(result, "fallback ok");
  assert.deepStrictEqual(calls, [fallback]);
});

test("runWithFallback tries fallback once after primary throws", async () => {
  const db = memoryDb();
  llm.ensureSchema(db);
  const primary = addReadyModel(db, "primary");
  const fallback = addReadyModel(db, "fallback");
  llm.saveRoutes(fiveRoutes(primary, fallback), "alice", db);
  const calls = [];
  const result = await llm.runWithFallback("triage", async (runtime) => {
    calls.push(runtime.modelId);
    if (runtime.modelId === primary) throw Object.assign(new Error("primary failed"), { llmRetryable:true });
    return "fallback ok";
  }, {}, db);
  assert.equal(result, "fallback ok");
  assert.deepStrictEqual(calls, [primary, fallback]);
});

test("business content rejection is returned without trying the fallback", async () => {
  const db = memoryDb();
  llm.ensureSchema(db);
  const primary = addReadyModel(db, "primary");
  const fallback = addReadyModel(db, "fallback");
  llm.saveRoutes(fiveRoutes(primary, fallback), "alice", db);
  let calls = 0;
  const result = await llm.runWithFallback("agent_draft", async () => {
    calls += 1;
    return { ok:false, reason:"medical_assertion" };
  }, {}, db);
  assert.deepStrictEqual(result, { ok:false, reason:"medical_assertion" });
  assert.equal(calls, 1);
});

test("business or medical rejection errors do not try the fallback", async () => {
  const db = memoryDb();
  llm.ensureSchema(db);
  const primary = addReadyModel(db, "primary");
  const fallback = addReadyModel(db, "fallback");
  llm.saveRoutes(fiveRoutes(primary, fallback), "alice", db);
  let calls = 0;
  await assert.rejects(() => llm.runWithFallback("agent_draft", async () => {
    calls += 1;
    throw Object.assign(new Error("medical_refusal"), { code:"medical_refusal" });
  }, {}, db), /medical_refusal/);
  assert.equal(calls, 1);
});

test("runWithFallback rethrows the primary error without fallback", async () => {
  const db = memoryDb();
  llm.ensureSchema(db);
  const primary = addReadyModel(db, "primary");
  llm.saveRoutes(fiveRoutes(primary), "alice", db);
  const original = new Error("original");
  let caught;
  try {
    await llm.runWithFallback("triage", async () => { throw original; }, {}, db);
  } catch (error) {
    caught = error;
  }
  assert.strictEqual(caught, original);
});

test("runWithFallback throws the fallback error when both fail", async () => {
  const db = memoryDb();
  llm.ensureSchema(db);
  const primary = addReadyModel(db, "primary");
  const fallback = addReadyModel(db, "fallback");
  llm.saveRoutes(fiveRoutes(primary, fallback), "alice", db);
  const backupError = new Error("backup failed");
  let calls = 0;
  let caught;
  try {
    await llm.runWithFallback("triage", async (runtime) => {
      calls += 1;
      if (runtime.modelId === primary) throw Object.assign(new Error("primary failed"), { llmRetryable:true });
      throw backupError;
    }, {}, db);
  } catch (error) {
    caught = error;
  }
  assert.strictEqual(caught, backupError);
  assert.equal(calls, 2);
});

test("runWithFallback does not retry the same model from malformed route data", async () => {
  const db = memoryDb();
  llm.ensureSchema(db);
  const primary = addReadyModel(db, "primary");
  db.prepare(`INSERT INTO llm_scene_routes
    (scene_id,primary_model_id,fallback_model_id,fallback_action,enabled)
    VALUES(?,?,?,?,?)`).run("triage", primary, primary, FALLBACK_ACTIONS.triage, 1);
  const original = new Error("primary failed");
  let calls = 0;
  let caught;
  try {
    await llm.runWithFallback("triage", async () => {
      calls += 1;
      original.llmRetryable = true;
      throw original;
    }, {}, db);
  } catch (error) {
    caught = error;
  }
  assert.equal(calls, 1);
  assert.strictEqual(caught, original);
});

test("model probes only persist successful results made with the saved key", async () => {
  const db = memoryDb();
  llm.ensureSchema(db);
  const model = llm.saveModel({ name: "saved", provider: "openai", baseUrl: "https://saved.example",
    apiKey: "saved-secret", model: "saved-model", timeoutMs: 8000 }, "alice", db);
  const previousFetch = global.fetch;
  let authorization = "";
  global.fetch = async (_url, options) => {
    authorization = options.headers.Authorization;
    return { ok: true, status: 200, text: async () => JSON.stringify({
      choices: [{ message: { content: "echo " + authorization.slice("Bearer ".length) } }]
    }) };
  };
  try {
    const temporary = await llm.probeModel(model.id, { apiKey: "temporary-secret" }, db);
    assert.equal(temporary.usesSavedKey, false);
    assert.equal(temporary.result.ok, true);
    assert.equal(authorization, "Bearer temporary-secret");
    assert.equal(JSON.stringify(temporary).includes("temporary-secret"), false);
    let row = db.prepare("SELECT api_key,test_ok,test_status,test_latency_ms,tested_at,updated_by FROM llm_models WHERE id=?")
      .get(model.id);
    assert.equal(row.api_key, "saved-secret");
    assert.equal(row.test_ok, 0);
    assert.equal(row.tested_at, null);

    const saved = await llm.probeModel(model.id, {}, db);
    assert.equal(saved.usesSavedKey, true);
    const persisted = llm.recordModelTest(model.id, saved.result, "bob", db);
    assert.equal(persisted.testOk, true);
    row = db.prepare("SELECT test_ok,test_status,test_latency_ms,tested_at,updated_by FROM llm_models WHERE id=?").get(model.id);
    assert.equal(row.test_ok, 1);
    assert.equal(row.test_status, "200");
    assert.ok(Number.isInteger(row.test_latency_ms));
    assert.ok(row.tested_at);
    assert.equal(row.updated_by, "bob");

    global.fetch = async () => ({ ok: false, status: 503, text: async () => "unavailable" });
    const failed = await llm.probeModel(model.id, {}, db);
    assert.equal(failed.result.ok, false);
    const failedModel = llm.recordModelTest(model.id, failed.result, "carol", db);
    assert.equal(failedModel.testOk, false);
    assert.equal(failedModel.testStatus, "503");
    assert.ok(failedModel.testedAt);
    assert.equal(failedModel.updatedBy, "carol");
  } finally {
    global.fetch = previousFetch;
  }
  await assert.rejects(() => llm.probeModel(999, {}, db), /not found|不存在/i);
});

test("model configuration marks validation conflicts and missing models with public error codes", () => {
  const db = memoryDb();
  llm.ensureSchema(db);
  let validation;
  try {
    llm.saveModel({ name: "invalid", baseUrl: "", model: "m" }, "alice", db);
  } catch (error) {
    validation = error;
  }
  assert.equal(validation.code, "LLM_VALIDATION");

  let missing;
  try {
    llm.copyModel(999, "alice", db);
  } catch (error) {
    missing = error;
  }
  assert.equal(missing.code, "LLM_NOT_FOUND");

  const model = llm.saveModel({ name: "referenced", provider: "openai", baseUrl: "https://api.example",
    apiKey: "secret", model: "m" }, "alice", db);
  db.prepare(`INSERT INTO llm_scene_routes(scene_id,primary_model_id,fallback_action,enabled)
    VALUES('triage',?,'local_rule_triage',1)`).run(model.id);
  let conflict;
  try {
    llm.deleteModel(model.id, db);
  } catch (error) {
    conflict = error;
  }
  assert.equal(conflict.code, "LLM_VALIDATION");

  db.prepare(`INSERT INTO llm_models(name,provider,base_url,api_key,model,timeout_ms,enabled)
    VALUES('no-key','openai','https://api.example',NULL,'m',8000,1)`).run();
  const noKeyId = Number(db.prepare("SELECT id FROM llm_models WHERE name='no-key'").get().id);
  return assert.rejects(
    () => llm.probeModel(noKeyId, {}, db),
    (error) => error.code === "LLM_VALIDATION"
  );
});

test("server injects its database into LLM admin routes", () => {
  const source = require("fs").readFileSync(require.resolve("./server.js"), "utf8");
  assert.match(source, /registerLlmAdminRoutes\(route,\s*\{[^}]*\bdb\b[^}]*\}\)/s);
});

test("legacy config methods honor an explicitly injected database", () => {
  const fallbackDb = memoryDb();
  const injectedDb = memoryDb();
  const dbModulePath = require.resolve("./db.js");
  const previousDbModule = require.cache[dbModulePath];
  require.cache[dbModulePath] = {
    id: dbModulePath, filename: dbModulePath, loaded: true, exports: { db: fallbackDb }
  };
  try {
    const saved = llm.saveConfig({
      provider: "openai", baseUrl: "https://injected.example", apiKey: "injected-secret",
      model: "injected-model", timeoutMs: 8000, disabled: false
    }, "alice", injectedDb);
    assert.equal(saved.model, "injected-model");
    assert.equal(injectedDb.prepare("SELECT model FROM llm_global_config WHERE id=1").get().model, "injected-model");
    assert.equal(fallbackDb.prepare(
      "SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name='llm_global_config'"
    ).get().count, 0);
    assert.equal(llm.getPublic(injectedDb).model, "injected-model");
  } finally {
    if (previousDbModule) require.cache[dbModulePath] = previousDbModule;
    else delete require.cache[dbModulePath];
  }
});

test("legacy connection validation exposes a business error code", async () => {
  const db = memoryDb();
  llm.ensureSchema(db);
  const previousKey = process.env.DEEPSEEK_API_KEY;
  process.env.DEEPSEEK_API_KEY = "";
  try {
    await assert.rejects(
      () => llm.testConnection({ baseUrl: "https://api.example", model: "m" }, db),
      (error) => error.code === "LLM_VALIDATION"
    );
  } finally {
    if (previousKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = previousKey;
  }
});

test("LLM admin routes register CRUD, routes and legacy APIs with gated sanitized audits", async () => {
  const modulePath = require.resolve("./modules/llm_config.js");
  const routePath = require.resolve("./routes/llm-admin.js");
  const originalModule = require.cache[modulePath];
  const publicModel = (id, name) => ({ id, name, apiKeyConfigured: true, apiKeyMasked: "secr…cret" });
  const moduleCalls = { saveConfig: 0, testConnection: 0, saveModel: 0, copyModel: 0,
    probeModel: 0, recordModelTest: 0, deleteModel: 0, saveRoutes: 0 };
  const stub = {
    getPublic: () => ({ model: "legacy", apiKeyConfigured: true }),
    saveConfig: () => { moduleCalls.saveConfig += 1; return { model: "legacy", apiKeyConfigured: true }; },
    testConnection: async () => { moduleCalls.testConnection += 1; return { ok: true, status: 200 }; },
    listModels: () => [publicModel(1, "one")],
    getModelPublic: (id) => Number(id) === 404 ? null : publicModel(Number(id), "before"),
    saveModel: (input) => {
      moduleCalls.saveModel += 1;
      if (input.forceError) throw Object.assign(new Error("validation failed"), { code: "LLM_VALIDATION" });
      return publicModel(input.id || 2, input.name);
    },
    copyModel: () => { moduleCalls.copyModel += 1; return publicModel(3, "copy"); },
    probeModel: async (id, input) => {
      moduleCalls.probeModel += 1;
      assert.equal(input.apiKey, "plain-test-secret");
      return {
        result: { ok: true, status: 200, latencyMs: 3 },
        model: publicModel(Number(id), "before"),
        usesSavedKey: false
      };
    },
    recordModelTest: () => { moduleCalls.recordModelTest += 1; return publicModel(1, "persisted"); },
    deleteModel: (id) => {
      moduleCalls.deleteModel += 1;
      if (Number(id) === 409) throw Object.assign(new Error("model is referenced by route"), { code: "LLM_VALIDATION" });
      return true;
    },
    listRoutes: () => [{ sceneId: "triage", primaryModelId: 1 }],
    saveRoutes: (routes) => {
      moduleCalls.saveRoutes += 1;
      if (!Array.isArray(routes)) throw Object.assign(new Error("routes validation failed"), { code: "LLM_VALIDATION" });
      return routes;
    }
  };
  require.cache[modulePath] = { id: modulePath, filename: modulePath, loaded: true, exports: stub };
  delete require.cache[routePath];
  const routes = [];
  const audits = [];
  const responses = [];
  let parseCalls = 0;
  let gateCalls = 0;
  let permissionCalls = 0;
  let gateAllowed = true;
  let permissionAllowed = true;
  const ctx = {
    db: memoryDb(),
    parseBody: async (req) => { parseCalls += 1; return req.body || {}; },
    json: (res, status, body) => { res.status = status; res.body = body; },
    gate: () => { gateCalls += 1; return gateAllowed ? { username: "admin" } : null; },
    requireAdminAction: (_req, _res, _s, action) => {
      permissionCalls += 1;
      assert.equal(action, "credential.manage");
      return permissionAllowed;
    },
    adminAudit: (_req, _s, event) => audits.push(event)
  };
  try {
    require("./routes/llm-admin.js").registerLlmAdminRoutes(
      (method, pattern, handler) => routes.push({ method, pattern, handler }), ctx
    );
    const registered = routes.map((entry) => entry.method + " " + entry.pattern.source);
    const expectedRoutes = [
      "GET ^\\/api\\/admin\\/llm\\/config$", "PUT ^\\/api\\/admin\\/llm\\/config$",
      "POST ^\\/api\\/admin\\/llm\\/test$", "GET ^\\/api\\/admin\\/llm\\/models$",
      "POST ^\\/api\\/admin\\/llm\\/models$", "PUT ^\\/api\\/admin\\/llm\\/models\\/(\\d+)$",
      "POST ^\\/api\\/admin\\/llm\\/models\\/(\\d+)\\/copy$", "POST ^\\/api\\/admin\\/llm\\/models\\/(\\d+)\\/test$",
      "DELETE ^\\/api\\/admin\\/llm\\/models\\/(\\d+)$", "GET ^\\/api\\/admin\\/llm\\/routes$",
      "PUT ^\\/api\\/admin\\/llm\\/routes$"
    ];
    assert.equal(routes.length, 11);
    assert.equal(new Set(registered).size, 11);
    assert.deepStrictEqual(registered, expectedRoutes);

    async function invoke(method, path, body) {
      const matches = routes.filter((item) => item.method === method && item.pattern.test(path));
      assert.equal(matches.length, 1, `${method} ${path} must match exactly one route`);
      const res = {};
      await matches[0].handler({ body }, res, path.match(matches[0].pattern));
      responses.push(res.body);
      return res;
    }
    async function invokeChecked(method, path, body) {
      const beforeGate = gateCalls;
      const beforePermission = permissionCalls;
      const response = await invoke(method, path, body);
      assert.equal(gateCalls, beforeGate + 1, `${method} ${path} must call gate once`);
      assert.equal(permissionCalls, beforePermission + 1, `${method} ${path} must check credential.manage once`);
      return response;
    }

    assert.equal((await invokeChecked("GET", "/api/admin/llm/models")).status, 200);
    assert.equal((await invokeChecked("POST", "/api/admin/llm/models",
      { name: "created", apiKey: "plain-create-secret" })).status, 201);
    assert.equal((await invokeChecked("PUT", "/api/admin/llm/models/1",
      { name: "edited", apiKey: "plain-update-secret" })).status, 200);
    const beforeCopyParse = parseCalls;
    assert.equal((await invokeChecked("POST", "/api/admin/llm/models/1/copy", { __oversize: true })).status, 201);
    assert.equal(parseCalls, beforeCopyParse, "copy must not parse an unused body");
    const testResponse = await invokeChecked("POST", "/api/admin/llm/models/1/test",
      { apiKey: "plain-test-secret" });
    assert.equal(testResponse.status, 200);
    assert.equal(testResponse.body.result.ok, true);
    assert.equal(testResponse.body.model.id, 1);
    assert.equal(moduleCalls.recordModelTest, 0, "temporary key result must not persist");
    assert.equal((await invokeChecked("DELETE", "/api/admin/llm/models/1")).status, 200);
    assert.equal((await invokeChecked("GET", "/api/admin/llm/routes")).status, 200);
    assert.equal((await invokeChecked("PUT", "/api/admin/llm/routes",
      { routes: [{ sceneId: "triage" }], apiKey: "plain-route-secret" })).status, 200);

    const newAudits = audits.slice();
    assert.deepStrictEqual(newAudits.map((event) => event.action), [
      "llm.model.create", "llm.model.update", "llm.model.copy", "llm.model.test", "llm.model.delete", "llm.routes.update"
    ]);
    assert.deepStrictEqual(newAudits.map((event) => event.resourceId), [2, 1, 3, 1, 1, "llm_routes"]);

    for (const [method, path] of [
      ["PUT", "/api/admin/llm/models/404"], ["POST", "/api/admin/llm/models/404/copy"],
      ["POST", "/api/admin/llm/models/404/test"], ["DELETE", "/api/admin/llm/models/404"]
    ]) assert.equal((await invokeChecked(method, path, {})).status, 404);

    const writesByRoute = [
      ["POST", "/api/admin/llm/models", "saveModel"],
      ["PUT", "/api/admin/llm/models/1", "saveModel"],
      ["POST", "/api/admin/llm/models/1/test", "probeModel"],
      ["PUT", "/api/admin/llm/routes", "saveRoutes"]
    ];
    for (const [method, path, moduleMethod] of writesByRoute) {
      const beforeWrites = moduleCalls[moduleMethod];
      assert.equal((await invokeChecked(method, path, { __oversize: true })).status, 413);
      assert.equal(moduleCalls[moduleMethod], beforeWrites, `${moduleMethod} must not run for oversized body`);
    }

    assert.equal((await invokeChecked("POST", "/api/admin/llm/models", { forceError: true })).status, 400);
    assert.equal((await invokeChecked("DELETE", "/api/admin/llm/models/409")).status, 400);
    assert.equal((await invokeChecked("PUT", "/api/admin/llm/routes", { routes: "invalid" })).status, 400);

    assert.equal((await invokeChecked("GET", "/api/admin/llm/config")).status, 200);
    assert.equal((await invokeChecked("PUT", "/api/admin/llm/config",
      { apiKey: "plain-legacy-save-secret", baseUrl: "https://legacy.example", model: "legacy" })).status, 200);
    assert.equal((await invokeChecked("POST", "/api/admin/llm/test",
      { apiKey: "plain-legacy-test-secret" })).status, 200);
    assert.equal(moduleCalls.saveConfig, 1);
    assert.equal(moduleCalls.testConnection, 1);

    const beforeDeniedWrites = { ...moduleCalls };
    gateAllowed = false;
    const beforeDeniedGate = gateCalls;
    const beforeDeniedPermission = permissionCalls;
    await invoke("POST", "/api/admin/llm/models", { apiKey: "denied-secret" });
    assert.equal(gateCalls, beforeDeniedGate + 1);
    assert.equal(permissionCalls, beforeDeniedPermission);
    assert.deepStrictEqual(moduleCalls, beforeDeniedWrites);
    gateAllowed = true;
    permissionAllowed = false;
    const beforePermissionGate = gateCalls;
    const beforePermissionCheck = permissionCalls;
    await invoke("POST", "/api/admin/llm/models", { apiKey: "denied-secret" });
    assert.equal(gateCalls, beforePermissionGate + 1);
    assert.equal(permissionCalls, beforePermissionCheck + 1);
    assert.deepStrictEqual(moduleCalls, beforeDeniedWrites);
    permissionAllowed = true;

    const serialized = JSON.stringify({ responses, audits });
    for (const secret of ["plain-create-secret", "plain-update-secret", "plain-test-secret",
      "plain-route-secret", "plain-legacy-save-secret", "plain-legacy-test-secret"]) {
      assert.equal(serialized.includes(secret), false);
    }
    for (const event of audits) {
      const auditPayload = JSON.stringify({ before: event.before, after: event.after, meta: event.meta });
      assert.equal(/plain-(create|update|test|route|legacy)/.test(auditPayload), false);
    }
  } finally {
    if (originalModule) require.cache[modulePath] = originalModule;
    else delete require.cache[modulePath];
    delete require.cache[routePath];
  }
});

test("LLM admin writes and audits are atomic and internal errors are sanitized", async () => {
  const db = memoryDb();
  llm.ensureSchema(db);
  db.exec("CREATE TABLE audit_log(id INTEGER PRIMARY KEY, action TEXT NOT NULL)");
  db.prepare(`INSERT INTO llm_global_config
    (id,provider,base_url,api_key,model,timeout_ms,disabled,updated_at,updated_by)
    VALUES(1,'openai','https://legacy-before.example','legacy-secret','legacy-before',8000,0,'before','setup')`).run();
  const primary = addReadyModel(db, "atomic-primary");
  const replacement = addReadyModel(db, "atomic-replacement");
  llm.saveRoutes(fiveRoutes(primary), "setup", db);

  const modulePath = require.resolve("./modules/llm_config.js");
  const routePath = require.resolve("./routes/llm-admin.js");
  const originalModule = require.cache[modulePath];
  let auditThrows = true;
  let unknownListError = false;
  let unknownConfigError = false;
  let probeResult = { ok: true, status: 200, latencyMs: 4 };
  let probeUsesSavedKey = true;
  const injected = (database) => assert.strictEqual(database, db, "route must pass the injected database");
  const stub = {
    getPublic: (database) => {
      injected(database);
      if (unknownConfigError) throw new Error("plain-config-internal-secret");
      const row = database.prepare("SELECT * FROM llm_global_config WHERE id=1").get();
      return { provider: row.provider, baseUrl: row.base_url, model: row.model, timeoutMs: row.timeout_ms,
        disabled: !!row.disabled, apiKeyConfigured: !!row.api_key };
    },
    saveConfig: (input, username, database) => {
      injected(database);
      database.prepare(`UPDATE llm_global_config SET base_url=?,model=?,updated_by=? WHERE id=1`)
        .run(input.baseUrl, input.model, username);
      return stub.getPublic(database);
    },
    testConnection: async () => ({ ok: true, status: 200 }),
    listModels: (database) => {
      injected(database);
      if (unknownListError) throw new Error("plain-internal-secret");
      return llm.listModels(database);
    },
    getModelPublic: (id, database) => { injected(database); return llm.getModelPublic(id, database); },
    saveModel: (input, username, database) => { injected(database); return llm.saveModel(input, username, database); },
    copyModel: (id, username, database) => { injected(database); return llm.copyModel(id, username, database); },
    deleteModel: (id, database) => { injected(database); return llm.deleteModel(id, database); },
    listRoutes: (database) => { injected(database); return llm.listRoutes(database); },
    saveRoutes: (routes, username, database) => { injected(database); return llm.saveRoutes(routes, username, database); },
    probeModel: async (id, _input, database) => {
      injected(database);
      return { result: probeResult, model: llm.getModelPublic(id, database), usesSavedKey: probeUsesSavedKey };
    },
    recordModelTest: (id, result, username, database) => {
      injected(database);
      return llm.recordModelTest(id, result, username, database);
    }
  };
  require.cache[modulePath] = { id: modulePath, filename: modulePath, loaded: true, exports: stub };
  delete require.cache[routePath];
  const routes = [];
  const ctx = {
    db,
    parseBody: async (req) => req.body || {},
    json: (res, status, body) => { res.status = status; res.body = body; },
    gate: () => ({ username: "atomic-admin" }),
    requireAdminAction: () => true,
    adminAudit: (_req, _session, event) => {
      db.prepare("INSERT INTO audit_log(action) VALUES(?)").run(event.action);
      if (auditThrows) throw new Error("audit failed with plain-audit-secret");
    }
  };
  try {
    require("./routes/llm-admin.js").registerLlmAdminRoutes(
      (method, pattern, handler) => routes.push({ method, pattern, handler }), ctx
    );
    async function invoke(method, path, body) {
      const entry = routes.find((item) => item.method === method && item.pattern.test(path));
      const res = {};
      await entry.handler({ body }, res, path.match(entry.pattern));
      return res;
    }

    const beforeCreate = db.prepare("SELECT COUNT(*) AS count FROM llm_models").get().count;
    const failedLegacy = await invoke("PUT", "/api/admin/llm/config", {
      baseUrl: "https://legacy-after.example", model: "legacy-after"
    });
    assert.equal(failedLegacy.status, 500);
    assert.deepStrictEqual(failedLegacy.body, { error: "服务器内部错误" });
    assert.equal(db.prepare("SELECT model FROM llm_global_config WHERE id=1").get().model, "legacy-before");
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM audit_log").get().count, 0);

    const failedCreate = await invoke("POST", "/api/admin/llm/models", {
      name: "rollback-create", provider: "openai", baseUrl: "https://atomic.example",
      apiKey: "plain-create-key", model: "atomic", timeoutMs: 8000
    });
    assert.equal(failedCreate.status, 500);
    assert.deepStrictEqual(failedCreate.body, { error: "服务器内部错误" });
    assert.equal(JSON.stringify(failedCreate.body).includes("plain-audit-secret"), false);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM llm_models").get().count, beforeCreate);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM audit_log").get().count, 0);

    const replacementRoutes = fiveRoutes(replacement);
    const failedRoutes = await invoke("PUT", "/api/admin/llm/routes", { routes: replacementRoutes });
    assert.equal(failedRoutes.status, 500);
    assert.deepStrictEqual(llm.listRoutes(db).map((route) => route.primaryModelId), Array(5).fill(primary));
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM audit_log").get().count, 0);

    db.prepare("UPDATE llm_models SET test_ok=0,test_status=NULL,tested_at=NULL WHERE id=?").run(primary);
    const failedTestWrite = await invoke("POST", `/api/admin/llm/models/${primary}/test`, {});
    assert.equal(failedTestWrite.status, 500);
    assert.equal(llm.getModelPublic(primary, db).testOk, false);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM audit_log").get().count, 0);

    probeUsesSavedKey = false;
    const failedTemporaryAudit = await invoke("POST", `/api/admin/llm/models/${primary}/test`, {
      apiKey: "temporary-secret"
    });
    assert.equal(failedTemporaryAudit.status, 500);
    assert.equal(llm.getModelPublic(primary, db).testOk, false);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM audit_log").get().count, 0);

    auditThrows = false;
    probeUsesSavedKey = true;
    const successfulCreate = await invoke("POST", "/api/admin/llm/models", {
      name: "rollback-create", provider: "openai", baseUrl: "https://atomic.example",
      apiKey: "plain-create-key", model: "atomic", timeoutMs: 8000
    });
    assert.equal(successfulCreate.status, 201);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM llm_models").get().count, beforeCreate + 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM audit_log WHERE action='llm.model.create'").get().count, 1);
    const successfulRoutes = await invoke("PUT", "/api/admin/llm/routes", { routes: replacementRoutes });
    assert.equal(successfulRoutes.status, 200);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM llm_scene_routes").get().count, 5);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM audit_log WHERE action='llm.routes.update'").get().count, 1);

    db.prepare("UPDATE llm_models SET test_ok=1,test_status='200',tested_at='old' WHERE id=?").run(primary);
    probeResult = { ok: false, status: 503, latencyMs: 7, error: "http_503" };
    const savedFailure = await invoke("POST", `/api/admin/llm/models/${primary}/test`, {});
    assert.equal(savedFailure.status, 200);
    assert.equal(savedFailure.body.result.ok, false);
    assert.equal(savedFailure.body.model.testOk, false);
    assert.equal(savedFailure.body.model.testStatus, "503");
    assert.notEqual(savedFailure.body.model.testedAt, "old");
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM audit_log WHERE action='llm.model.test'").get().count, 1);

    unknownListError = true;
    const internal = await invoke("GET", "/api/admin/llm/models");
    assert.equal(internal.status, 500);
    assert.deepStrictEqual(internal.body, { error: "服务器内部错误" });
    assert.equal(JSON.stringify(internal.body).includes("plain-internal-secret"), false);
    unknownConfigError = true;
    const configInternal = await invoke("GET", "/api/admin/llm/config");
    assert.equal(configInternal.status, 500);
    assert.deepStrictEqual(configInternal.body, { error: "服务器内部错误" });
    assert.equal(JSON.stringify(configInternal.body).includes("plain-config-internal-secret"), false);
  } finally {
    if (originalModule) require.cache[modulePath] = originalModule;
    else delete require.cache[modulePath];
    delete require.cache[routePath];
  }
});

async function main() {
  for (const [name, fn] of tests) {
    await fn();
    console.log("ok -", name);
  }
  console.log("llm pool tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
