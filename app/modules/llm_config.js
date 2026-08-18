"use strict";

/**
 * 全局大模型配置：库内优先，环境变量回退；密钥不写审计明文。
 */

function getDb() {
  return require("../db.js").db;
}

const SCENE_IDS = ["triage", "agent_draft", "science_reminder", "mp_ai", "health_probe"];
const FALLBACK_ACTIONS = {
  triage: "local_rule_triage",
  agent_draft: "basic_template",
  science_reminder: "stop_and_alert",
  mp_ai: "safe_message",
  health_probe: "log_error"
};

function ensureSchema(database) {
  const d = database || getDb();
  d.exec(`CREATE TABLE IF NOT EXISTS llm_global_config(
    id INTEGER PRIMARY KEY CHECK (id = 1),
    provider TEXT,
    base_url TEXT,
    api_key TEXT,
    model TEXT,
    timeout_ms INTEGER,
    disabled INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT,
    updated_by TEXT
  );
  CREATE TABLE IF NOT EXISTS llm_models(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    provider TEXT NOT NULL,
    base_url TEXT NOT NULL,
    api_key TEXT,
    model TEXT NOT NULL,
    timeout_ms INTEGER NOT NULL DEFAULT 8000,
    multimodal INTEGER NOT NULL DEFAULT 0,
    enabled INTEGER NOT NULL DEFAULT 1,
    test_ok INTEGER NOT NULL DEFAULT 0,
    test_status TEXT,
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
  )`);

  // 幂等：为既有 llm_models 表补充 multimodal 列（老库无此列）
  const llmModelCols = d.prepare("PRAGMA table_info(llm_models)").all();
  if (!llmModelCols.some((c) => c.name === "multimodal")) {
    d.exec("ALTER TABLE llm_models ADD COLUMN multimodal INTEGER NOT NULL DEFAULT 0");
  }

  if (d.prepare("SELECT COUNT(*) AS count FROM llm_models").get().count !== 0) return;
  const legacy = d.prepare("SELECT * FROM llm_global_config WHERE id=1").get();
  if (!legacy) {
    importEnvironmentModels(d);
    return;
  }
  const ts = legacy.updated_at || nowIso();
  const by = legacy.updated_by || "migration";
  d.exec("SAVEPOINT llm_config_legacy_migration");
  try {
    const inserted = d.prepare(`INSERT INTO llm_models
      (name,provider,base_url,api_key,model,timeout_ms,enabled,updated_at,updated_by)
      VALUES(?,?,?,?,?,?,?,?,?)`).run(
      "默认模型", legacy.provider || "deepseek", legacy.base_url || "", legacy.api_key || null,
      legacy.model || "", legacy.timeout_ms == null ? 8000 : legacy.timeout_ms,
      legacy.disabled ? 0 : 1, ts, by
    );
    const addRoute = d.prepare(`INSERT OR IGNORE INTO llm_scene_routes
      (scene_id,primary_model_id,fallback_action,enabled,updated_at,updated_by)
      VALUES(?,?,?,?,?,?)`);
    for (const scene of SCENE_IDS) {
      addRoute.run(scene, Number(inserted.lastInsertRowid), FALLBACK_ACTIONS[scene], legacy.disabled ? 0 : 1, ts, by);
    }
    d.exec("RELEASE llm_config_legacy_migration");
  } catch (error) {
    d.exec("ROLLBACK TO llm_config_legacy_migration; RELEASE llm_config_legacy_migration");
    throw error;
  }
}

function inferProvider(baseUrl) {
  const base = String(baseUrl || "").toLowerCase();
  if (base.includes("deepseek.com")) return "deepseek";
  if (base.includes("aliyuncs.com") || base.includes("maas.aliyuncs.com")) return "bailian";
  if (base.includes("bigmodel.cn")) return "zhipu";
  if (base.includes("volces.com")) return "doubao";
  if (base.includes("minimaxi.com")) return "minimax";
  return "custom";
}

function importEnvironmentModels(database) {
  const triage = envDeepseek();
  const mp = envMp();
  const timeout = Math.min(Math.max(Number(process.env.TRIAGE_AI_TIMEOUT_MS || 8000), 1000), 120000);
  const candidates = [
    { name: "环境模型 · " + triage.model, key: triage.key, base: triage.base, model: triage.model, timeout },
    { name: "小程序环境模型 · " + mp.model, key: mp.key, base: mp.base, model: mp.model, timeout: 8000 }
  ].filter((item) => item.key && item.base && item.model);
  const seen = new Set();
  const insert = database.prepare(`INSERT INTO llm_models
    (name,provider,base_url,api_key,model,timeout_ms,enabled,test_ok,updated_at,updated_by)
    VALUES(?,?,?,?,?,?,1,0,?,?)`);
  for (const item of candidates) {
    const identity = [item.base, item.key, item.model].join("\n");
    if (seen.has(identity)) continue;
    seen.add(identity);
    insert.run(item.name, inferProvider(item.base), item.base, item.key, item.model, item.timeout, nowIso(), "environment-import");
  }
}

function nowIso() {
  return new Date().toISOString();
}

function llmError(code, message) {
  return Object.assign(new Error(message), { code });
}

function maskKey(key) {
  const s = String(key || "");
  if (!s) return "";
  if (s.length <= 8) return "***";
  return s.slice(0, 4) + "…" + s.slice(-4);
}

function modelPublic(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    provider: row.provider,
    baseUrl: row.base_url,
    model: row.model,
    timeoutMs: row.timeout_ms,
    multimodal: !!row.multimodal,
    enabled: !!row.enabled,
    testOk: !!row.test_ok,
    testStatus: row.test_status || "",
    testLatencyMs: row.test_latency_ms == null ? null : row.test_latency_ms,
    testedAt: row.tested_at || "",
    updatedAt: row.updated_at || "",
    updatedBy: row.updated_by || "",
    apiKeyMasked: maskKey(row.api_key),
    apiKeyConfigured: !!row.api_key
  };
}

function listModels(database) {
  const d = database || getDb();
  ensureSchema(d);
  return d.prepare("SELECT * FROM llm_models ORDER BY id").all().map(modelPublic);
}

function getModelPublic(id, database) {
  const d = database || getDb();
  ensureSchema(d);
  return modelPublic(d.prepare("SELECT * FROM llm_models WHERE id=?").get(Number(id)));
}

function saveModel(input, username, database) {
  const d = database || getDb();
  ensureSchema(d);
  input = input || {};
  const id = input.id == null ? null : Number(input.id);
  const current = id == null ? null : d.prepare("SELECT * FROM llm_models WHERE id=?").get(id);
  if (id != null && !current) throw llmError("LLM_NOT_FOUND", "模型不存在");

  const name = String(input.name == null ? current?.name || "" : input.name).trim().slice(0, 80);
  const provider = String(input.provider == null ? current?.provider || "openai_compatible" : input.provider)
    .trim().slice(0, 40) || "openai_compatible";
  const baseUrl = String(input.baseUrl == null ? current?.base_url || "" : input.baseUrl)
    .trim().replace(/\/+$/, "").slice(0, 240);
  const model = String(input.model == null ? current?.model || "" : input.model).trim().slice(0, 80);
  const timeoutMs = input.timeoutMs == null ? current?.timeout_ms ?? 8000 : Number(input.timeoutMs);
  const multimodal = Object.prototype.hasOwnProperty.call(input, "multimodal")
    ? !!input.multimodal
    : current ? !!current.multimodal : false;
  if (!name) throw llmError("LLM_VALIDATION", "请填写模型名称");
  if (!baseUrl) throw llmError("LLM_VALIDATION", "请填写 Base URL");
  if (!model) throw llmError("LLM_VALIDATION", "请填写模型名");
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1000 || timeoutMs > 120000) {
    throw llmError("LLM_VALIDATION", "超时时间必须在 1000 到 120000 毫秒之间");
  }

  const suppliedKey = Object.prototype.hasOwnProperty.call(input, "apiKey")
    ? String(input.apiKey == null ? "" : input.apiKey).trim()
    : "";
  const apiKey = suppliedKey || current?.api_key || "";
  if (!current && !apiKey) throw llmError("LLM_VALIDATION", "新建模型必须填写 API Key");
  const enabled = Object.prototype.hasOwnProperty.call(input, "enabled") ? !!input.enabled : current ? !!current.enabled : true;
  if (current && current.enabled && !enabled && referencedScene(d, id)) {
    throw llmError("LLM_VALIDATION", "模型正被场景路由引用，不能停用");
  }
  const ts = nowIso();
  const by = String(username || "admin").slice(0, 80);

  let savedId = id;
  if (current) {
    const connectionChanged = provider !== current.provider || baseUrl !== current.base_url ||
      apiKey !== (current.api_key || "") || model !== current.model;
    d.prepare(`UPDATE llm_models SET
      name=?,provider=?,base_url=?,api_key=?,model=?,timeout_ms=?,multimodal=?,enabled=?,
      test_ok=?,test_status=?,test_latency_ms=?,tested_at=?,updated_at=?,updated_by=? WHERE id=?`)
      .run(
        name, provider, baseUrl, apiKey, model, Math.round(timeoutMs), multimodal ? 1 : 0, enabled ? 1 : 0,
        connectionChanged ? 0 : current.test_ok,
        connectionChanged ? null : current.test_status,
        connectionChanged ? null : current.test_latency_ms,
        connectionChanged ? null : current.tested_at,
        ts, by, id
      );
  } else {
    savedId = Number(d.prepare(`INSERT INTO llm_models
      (name,provider,base_url,api_key,model,timeout_ms,multimodal,enabled,updated_at,updated_by)
      VALUES(?,?,?,?,?,?,?,?,?,?)`)
      .run(name, provider, baseUrl, apiKey, model, Math.round(timeoutMs), multimodal ? 1 : 0, enabled ? 1 : 0, ts, by).lastInsertRowid);
  }
  return getModelPublic(savedId, d);
}

function copyModel(id, username, database) {
  const d = database || getDb();
  ensureSchema(d);
  const source = d.prepare("SELECT * FROM llm_models WHERE id=?").get(Number(id));
  if (!source) throw llmError("LLM_NOT_FOUND", "模型不存在");
  return saveModel({
    name: source.name + " 副本",
    provider: source.provider,
    baseUrl: source.base_url,
    apiKey: source.api_key,
    model: source.model,
    timeoutMs: source.timeout_ms,
    multimodal: !!source.multimodal,
    enabled: !!source.enabled
  }, username, d);
}

function referencedScene(database, id) {
  return database.prepare(`SELECT scene_id FROM llm_scene_routes
    WHERE primary_model_id=? OR fallback_model_id=? LIMIT 1`).get(id, id);
}

function setModelEnabled(id, enabled, username, database) {
  const d = database || getDb();
  ensureSchema(d);
  const numericId = Number(id);
  if (!d.prepare("SELECT 1 FROM llm_models WHERE id=?").get(numericId)) throw llmError("LLM_NOT_FOUND", "模型不存在");
  if (!enabled && referencedScene(d, numericId)) throw llmError("LLM_VALIDATION", "模型正被场景路由引用，不能停用");
  d.prepare("UPDATE llm_models SET enabled=?,updated_at=?,updated_by=? WHERE id=?")
    .run(enabled ? 1 : 0, nowIso(), String(username || "admin").slice(0, 80), numericId);
  return getModelPublic(numericId, d);
}

function deleteModel(id, database) {
  const d = database || getDb();
  ensureSchema(d);
  const numericId = Number(id);
  if (!d.prepare("SELECT 1 FROM llm_models WHERE id=?").get(numericId)) throw llmError("LLM_NOT_FOUND", "模型不存在");
  if (referencedScene(d, numericId)) throw llmError("LLM_VALIDATION", "模型正被场景路由引用，不能删除");
  return d.prepare("DELETE FROM llm_models WHERE id=?").run(numericId).changes > 0;
}

function listRoutes(database) {
  const d = database || getDb();
  ensureSchema(d);
  const rows = new Map(d.prepare("SELECT * FROM llm_scene_routes").all().map((row) => [row.scene_id, row]));
  const modelById = new Map(d.prepare("SELECT * FROM llm_models").all().map((row) => [row.id, row]));
  return SCENE_IDS.map((sceneId) => {
    const row = rows.get(sceneId);
    const primaryModelId = row ? row.primary_model_id : null;
    const fallbackModelId = row && row.fallback_model_id != null ? row.fallback_model_id : null;
    return {
      sceneId,
      primaryModelId,
      fallbackModelId,
      fallbackAction: row ? row.fallback_action : FALLBACK_ACTIONS[sceneId],
      enabled: !!(row && row.enabled),
      updatedAt: row ? row.updated_at || "" : "",
      updatedBy: row ? row.updated_by || "" : "",
      primaryModel: modelPublic(modelById.get(primaryModelId)),
      fallbackModel: modelPublic(modelById.get(fallbackModelId))
    };
  });
}

function saveRoutes(routes, username, database) {
  const d = database || getDb();
  ensureSchema(d);
  if (!Array.isArray(routes) || routes.length !== SCENE_IDS.length) {
    throw llmError("LLM_VALIDATION", "Routes must contain exactly five scenes");
  }
  const sceneIds = routes.map((route) => String(route && route.sceneId || ""));
  if (new Set(sceneIds).size !== sceneIds.length) throw llmError("LLM_VALIDATION", "Duplicate scene");
  if (sceneIds.some((sceneId) => !SCENE_IDS.includes(sceneId))) throw llmError("LLM_VALIDATION", "Unknown scene");
  if (SCENE_IDS.some((sceneId) => !sceneIds.includes(sceneId))) throw llmError("LLM_VALIDATION", "Routes must contain every scene");

  const readyModel = d.prepare("SELECT id FROM llm_models WHERE id=? AND enabled=1 AND test_ok=1");
  for (const route of routes) {
    const primaryModelId = Number(route.primaryModelId);
    const fallbackModelId = route.fallbackModelId == null || route.fallbackModelId === ""
      ? null : Number(route.fallbackModelId);
    if (!Number.isInteger(primaryModelId) || !readyModel.get(primaryModelId)) {
      throw llmError("LLM_VALIDATION", "Primary model must be available, enabled and tested");
    }
    if (fallbackModelId != null && (!Number.isInteger(fallbackModelId) || !readyModel.get(fallbackModelId))) {
      throw llmError("LLM_VALIDATION", "Fallback model must be available, enabled and tested");
    }
    if (fallbackModelId === primaryModelId) throw llmError("LLM_VALIDATION", "Primary and fallback models cannot be the same");
    if (route.fallbackAction !== FALLBACK_ACTIONS[route.sceneId]) throw llmError("LLM_VALIDATION", "Unsupported fallback action");
  }

  const save = d.prepare(`INSERT INTO llm_scene_routes
    (scene_id,primary_model_id,fallback_model_id,fallback_action,enabled,updated_at,updated_by)
    VALUES(?,?,?,?,?,?,?)
    ON CONFLICT(scene_id) DO UPDATE SET
      primary_model_id=excluded.primary_model_id,
      fallback_model_id=excluded.fallback_model_id,
      fallback_action=excluded.fallback_action,
      enabled=excluded.enabled,
      updated_at=excluded.updated_at,
      updated_by=excluded.updated_by`);
  const ts = nowIso();
  const by = String(username || "admin").slice(0, 80);
  d.exec("SAVEPOINT llm_routes_save");
  try {
    for (const sceneId of SCENE_IDS) {
      const route = routes.find((item) => item.sceneId === sceneId);
      save.run(
        sceneId,
        Number(route.primaryModelId),
        route.fallbackModelId == null || route.fallbackModelId === "" ? null : Number(route.fallbackModelId),
        route.fallbackAction,
        route.enabled === false ? 0 : 1,
        ts,
        by
      );
    }
    d.exec("RELEASE llm_routes_save");
  } catch (error) {
    d.exec("ROLLBACK TO llm_routes_save; RELEASE llm_routes_save");
    throw error;
  }
  return listRoutes(d);
}

function rowOrNull(database) {
  try {
    return (database || getDb()).prepare("SELECT * FROM llm_global_config WHERE id=1").get() || null;
  } catch (e) {
    return null;
  }
}

function envDeepseek() {
  const key = String(process.env.DEEPSEEK_API_KEY || "").trim();
  const base = String(process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com").trim().replace(/\/$/, "");
  const model = String(process.env.DEEPSEEK_MODEL || process.env.TRIAGE_MODEL || "deepseek-v4-flash").trim();
  return { key, base, model, hasKey: !!key };
}

function envMp() {
  const key = String(process.env.MP_AI_API_KEY || process.env.DEEPSEEK_API_KEY || "").trim();
  const base = String(
    process.env.MP_AI_BASE_URL || process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com"
  )
    .trim()
    .replace(/\/$/, "");
  const model = String(process.env.MP_AI_MODEL || process.env.DEEPSEEK_MODEL || "deepseek-chat").trim();
  return { key, base, model, hasKey: !!key };
}

function loadMerged(database) {
  const row = rowOrNull(database);
  const env = envDeepseek();
  const hasDb = !!(row && (row.api_key || row.base_url || row.model));
  const disabledEnv = process.env.TRIAGE_AI_DISABLED === "1";
  const disabledDb = row ? !!row.disabled : false;
  return {
    row,
    hasDb,
    provider: (row && row.provider) || "deepseek",
    baseUrl: (row && row.base_url && String(row.base_url).trim()) || env.base,
    apiKey: (row && row.api_key && String(row.api_key).trim()) || env.key,
    model: (row && row.model && String(row.model).trim()) || env.model,
    timeoutMs: Math.min(
      Math.max(+(row && row.timeout_ms != null ? row.timeout_ms : process.env.TRIAGE_AI_TIMEOUT_MS || 8000), 1000),
      120000
    ),
    disabled: disabledDb || disabledEnv,
    source: hasDb && row && row.api_key ? "db" : env.hasKey ? "env" : "none",
    updatedAt: (row && row.updated_at) || "",
    updatedBy: (row && row.updated_by) || ""
  };
}

/**
 * 运行时配置，供 triage / mpAi / health 使用。
 * @returns {null|{provider,key,url,model,headers,maxTokenField,errorPrefix,timeoutMs,source}}
 */
function resolveRuntime(opts) {
  opts = opts || {};
  if (opts.sceneId) {
    const d = opts.database || getDb();
    ensureSchema(d);
    const modelColumn = opts.fallback ? "fallback_model_id" : "primary_model_id";
    const row = d.prepare(`SELECT m.* FROM llm_scene_routes r
      JOIN llm_models m ON m.id=r.${modelColumn}
      WHERE r.scene_id=? AND r.enabled=1 AND m.enabled=1 AND m.test_ok=1`).get(String(opts.sceneId));
    if (!row || !row.api_key || !row.base_url) return null;
    const base = String(row.base_url).replace(/\/$/, "");
    if (!base) return null;
    return {
      modelId: row.id,
      provider: row.provider || "openai_compatible",
      key: row.api_key,
      url: base + "/chat/completions",
      model: row.model,
      multimodal: !!row.multimodal,
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + row.api_key
      },
      maxTokenField: "max_tokens",
      errorPrefix: "LLM",
      timeoutMs: row.timeout_ms,
      source: "db"
    };
  }
  const m = loadMerged(opts.database);
  if (m.disabled) return null;
  if (!m.apiKey) return null;
  const base = String(m.baseUrl || "").replace(/\/$/, "");
  if (!base) return null;
  return {
    provider: m.provider || "openai_compatible",
    key: m.apiKey,
    url: base + "/chat/completions",
    model: m.model || "deepseek-chat",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + m.apiKey
    },
    maxTokenField: "max_tokens",
    errorPrefix: "LLM",
    timeoutMs: m.timeoutMs,
    source: m.source
  };
}

async function runWithFallback(sceneId, run, opts, database) {
  opts = opts || {};
  const d = database || getDb();
  let route = null;
  try {
    route = d.prepare("SELECT primary_model_id FROM llm_scene_routes WHERE scene_id=?").get(String(sceneId)) || null;
  } catch (e) {}
  ensureSchema(d);
  if (!route || route.primary_model_id == null) {
    const legacy = opts.legacyRuntime || resolveRuntime({ ...opts, database: d });
    if (!legacy) throw new Error("Primary model is unavailable");
    return run(legacy);
  }
  const primary = resolveRuntime({ ...opts, sceneId, fallback: false, database: d });
  if (!primary) {
    const fallback = resolveRuntime({ ...opts, sceneId, fallback: true, database: d });
    if (!fallback) throw new Error("Primary model is unavailable");
    return run(fallback);
  }
  try {
    return await run(primary);
  } catch (primaryError) {
    if (!primaryError || primaryError.llmRetryable !== true) throw primaryError;
    const fallback = resolveRuntime({ ...opts, sceneId, fallback: true, database: d });
    if (!fallback || fallback.modelId === primary.modelId) throw primaryError;
    return run(fallback);
  }
}

function getPublic(database) {
  const m = loadMerged(database);
  const env = envDeepseek();
  const mp = envMp();
  const runtime = resolveRuntime({ database });
  return {
    provider: m.provider || "deepseek",
    baseUrl: m.baseUrl || "",
    model: m.model || "",
    timeoutMs: m.timeoutMs,
    disabled: !!m.disabled,
    apiKeyMasked: maskKey(m.apiKey),
    apiKeyConfigured: !!m.apiKey,
    source: m.source,
    updatedAt: m.updatedAt,
    updatedBy: m.updatedBy,
    envFallback: {
      deepseekKeyConfigured: env.hasKey,
      mpKeyConfigured: mp.hasKey,
      triageAiDisabledEnv: process.env.TRIAGE_AI_DISABLED === "1"
    },
    scenes: [
      {
        id: "triage_agent",
        name: "分诊 / Agent / 医助草稿",
        usesGlobal: true,
        available: !!runtime
      },
      {
        id: "science_reminder",
        name: "科普提醒 AI 草稿",
        usesGlobal: true,
        available: !!runtime
      },
      {
        id: "mp_ai",
        name: "小程序 AI",
        usesGlobal: true,
        available: !!runtime
      },
      {
        id: "llm_health",
        name: "健康探针",
        usesGlobal: true,
        available: !!runtime
      }
    ]
  };
}

function saveConfig(input, username, database) {
  const d = database || getDb();
  ensureSchema(d);
  const cur = rowOrNull(d) || {};
  const provider = String((input && input.provider) || cur.provider || "deepseek").trim().slice(0, 40) || "deepseek";
  let baseUrl = Object.prototype.hasOwnProperty.call(input || {}, "baseUrl")
    ? String(input.baseUrl || "").trim()
    : String(cur.base_url || "").trim();
  baseUrl = baseUrl.replace(/\/$/, "").slice(0, 240);
  let model = Object.prototype.hasOwnProperty.call(input || {}, "model")
    ? String(input.model || "").trim()
    : String(cur.model || "").trim();
  model = model.slice(0, 80);
  let timeoutMs = Object.prototype.hasOwnProperty.call(input || {}, "timeoutMs")
    ? Number(input.timeoutMs)
    : cur.timeout_ms != null
      ? Number(cur.timeout_ms)
      : 8000;
  if (!Number.isFinite(timeoutMs)) timeoutMs = 8000;
  timeoutMs = Math.min(Math.max(Math.round(timeoutMs), 1000), 120000);
  const disabled = Object.prototype.hasOwnProperty.call(input || {}, "disabled")
    ? !!input.disabled
    : !!cur.disabled;

  let apiKey = cur.api_key || "";
  if (Object.prototype.hasOwnProperty.call(input || {}, "apiKey")) {
    const next = String(input.apiKey == null ? "" : input.apiKey).trim();
    if (next) apiKey = next.slice(0, 200);
    // 空字符串 = 保留原密钥
  }

  if (!baseUrl) throw llmError("LLM_VALIDATION", "请填写 Base URL");
  if (!model) throw llmError("LLM_VALIDATION", "请填写模型名");

  const ts = nowIso();
  const by = String(username || "admin").slice(0, 80);
  d.prepare(
    `INSERT INTO llm_global_config(id,provider,base_url,api_key,model,timeout_ms,disabled,updated_at,updated_by)
     VALUES(1,?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET
       provider=excluded.provider,
       base_url=excluded.base_url,
       api_key=excluded.api_key,
       model=excluded.model,
       timeout_ms=excluded.timeout_ms,
       disabled=excluded.disabled,
       updated_at=excluded.updated_at,
       updated_by=excluded.updated_by`
  ).run(provider, baseUrl || null, apiKey || null, model || null, timeoutMs, disabled ? 1 : 0, ts, by);

  return getPublic(d);
}

async function testConnection(input, database) {
  let cfg = null;
  if (input && (input.apiKey || input.baseUrl || input.model)) {
    const key = String(input.apiKey || "").trim() || loadMerged(database).apiKey;
    const base = String(input.baseUrl || loadMerged(database).baseUrl || "")
      .trim()
      .replace(/\/$/, "");
    const model = String(input.model || loadMerged(database).model || "deepseek-chat").trim();
    if (!key) throw llmError("LLM_VALIDATION", "未配置 API Key");
    if (!base) throw llmError("LLM_VALIDATION", "未配置 Base URL");
    cfg = {
      url: base + "/chat/completions",
      model,
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
      timeoutMs: Math.min(Math.max(+(input.timeoutMs || loadMerged(database).timeoutMs || 8000), 1000), 60000)
    };
  } else {
    const runtime = resolveRuntime({ database });
    if (!runtime) throw llmError("LLM_VALIDATION", "当前无可用模型配置（请检查密钥或总开关）");
    cfg = runtime;
  }

  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs || 8000);
  try {
    const res = await fetch(cfg.url, {
      method: "POST",
      headers: cfg.headers,
      signal: controller.signal,
      body: JSON.stringify({
        model: cfg.model,
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 1,
        stream: false
      })
    });
    clearTimeout(timer);
    const ms = Date.now() - started;
    const bodyText = await res.text().catch(() => "");
    let preview = "";
    try {
      const j = JSON.parse(bodyText);
      preview = String((((j.choices || [])[0] || {}).message || {}).content || j.error?.message || "").slice(0, 120);
    } catch (e) {
      preview = bodyText.slice(0, 120);
    }
    if (!res.ok) {
      return { ok: false, status: res.status, latencyMs: ms, error: "http_" + res.status, preview };
    }
    return { ok: true, status: res.status, latencyMs: ms, model: cfg.model, preview };
  } catch (e) {
    clearTimeout(timer);
    const ms = Date.now() - started;
    const reason = e && e.name === "AbortError" ? "timeout" : (e && e.message) || "fetch_error";
    return { ok: false, status: 0, latencyMs: ms, error: reason };
  }
}

async function probeModel(id, input, database) {
  const d = database || getDb();
  ensureSchema(d);
  const numericId = Number(id);
  const row = d.prepare("SELECT * FROM llm_models WHERE id=?").get(numericId);
  if (!row) throw llmError("LLM_NOT_FOUND", "模型不存在");
  const suppliedKey = String(input && input.apiKey || "").trim();
  const apiKey = suppliedKey || row.api_key || "";
  if (!apiKey) throw llmError("LLM_VALIDATION", "未配置 API Key");
  const rawResult = await testConnection({
    apiKey,
    baseUrl: row.base_url,
    model: row.model,
    timeoutMs: row.timeout_ms
  });
  const result = Object.fromEntries(Object.entries(rawResult).map(([key, value]) => [
    key,
    typeof value === "string" ? value.split(apiKey).join("***") : value
  ]));
  return {
    result,
    model: getModelPublic(numericId, d),
    usesSavedKey: !!row.api_key && (!suppliedKey || suppliedKey === row.api_key)
  };
}

function recordModelTest(id, result, username, database) {
  const d = database || getDb();
  ensureSchema(d);
  const numericId = Number(id);
  if (!d.prepare("SELECT 1 FROM llm_models WHERE id=?").get(numericId)) throw llmError("LLM_NOT_FOUND", "模型不存在");
  const testedAt = nowIso();
  d.prepare(`UPDATE llm_models SET test_ok=?,test_status=?,test_latency_ms=?,tested_at=?,updated_at=?,updated_by=?
    WHERE id=?`).run(
    result.ok ? 1 : 0,
    String(result.status == null ? "" : result.status),
    result.latencyMs == null ? null : Math.round(result.latencyMs),
    testedAt,
    testedAt,
    String(username || "admin").slice(0, 80),
    numericId
  );
  return getModelPublic(numericId, d);
}

module.exports = {
  SCENE_IDS,
  ensureSchema,
  listModels,
  getModelPublic,
  saveModel,
  copyModel,
  setModelEnabled,
  deleteModel,
  listRoutes,
  saveRoutes,
  resolveRuntime,
  runWithFallback,
  getPublic,
  saveConfig,
  testConnection,
  probeModel,
  recordModelTest,
  loadMerged,
  maskKey
};
