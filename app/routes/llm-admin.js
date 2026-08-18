"use strict";

function registerLlmAdminRoutes(route, ctx) {
  const { parseBody, json, gate, requireAdminAction, adminAudit, db } = ctx;
  const llmConfig = require("../modules/llm_config.js");
  const authorize = (req, res, message) => {
    const session = gate(req, res);
    if (!session) return null;
    return requireAdminAction(req, res, session, "credential.manage", null, message) ? session : null;
  };
  const readBody = async (req, res) => {
    const body = await parseBody(req);
    if (body.__oversize) {
      json(res, 413, { error: "请求体过大（上限 1MB）" });
      return null;
    }
    return body;
  };
  let savepointId = 0;
  const withAuditSavepoint = (fn) => {
    const name = "llm_admin_audit_" + (++savepointId);
    db.exec(`SAVEPOINT ${name}`);
    try {
      const result = fn();
      db.exec(`RELEASE ${name}`);
      return result;
    } catch (error) {
      db.exec(`ROLLBACK TO ${name}; RELEASE ${name}`);
      throw error;
    }
  };
  const sendError = (res, error) => {
    if (error && error.code === "LLM_NOT_FOUND") return json(res, 404, { error: "模型不存在" });
    if (error && error.code === "LLM_VALIDATION") return json(res, 400, { error: error.message });
    return json(res, 500, { error: "服务器内部错误" });
  };

  route("GET", /^\/api\/admin\/llm\/config$/, (req, res) => {
    const s = gate(req, res);
    if (!s) return;
    if (!requireAdminAction(req, res, s, "credential.manage", null, "仅超级管理员可查看大模型配置")) return;
    try {
      json(res, 200, { ok: true, config: llmConfig.getPublic(db) });
    } catch (e) {
      sendError(res, e);
    }
  });

  route("PUT", /^\/api\/admin\/llm\/config$/, async (req, res) => {
    const s = gate(req, res);
    if (!s) return;
    if (!requireAdminAction(req, res, s, "credential.manage", null, "仅超级管理员可保存大模型配置")) return;
    const b = await parseBody(req);
    if (b.__oversize) return json(res, 413, { error: "请求体过大（上限 1MB）" });
    try {
      const before = llmConfig.getPublic(db);
      const after = withAuditSavepoint(() => {
        const saved = llmConfig.saveConfig(b, s.username, db);
        adminAudit(req, s, {
          action: "credential.update",
          resourceType: "credential_config",
          resourceId: "llm_global",
          before: {
            provider: before.provider,
            baseUrl: before.baseUrl,
            model: before.model,
            timeoutMs: before.timeoutMs,
            disabled: before.disabled,
            apiKeyConfigured: before.apiKeyConfigured
          },
          after: {
            provider: saved.provider,
            baseUrl: saved.baseUrl,
            model: saved.model,
            timeoutMs: saved.timeoutMs,
            disabled: saved.disabled,
            apiKeyConfigured: saved.apiKeyConfigured
          },
          meta: { provider: "llm" }
        });
        return saved;
      });
      json(res, 200, { ok: true, config: after });
    } catch (e) {
      sendError(res, e);
    }
  });

  route("POST", /^\/api\/admin\/llm\/test$/, async (req, res) => {
    const s = gate(req, res);
    if (!s) return;
    if (!requireAdminAction(req, res, s, "credential.manage", null, "仅超级管理员可测试大模型")) return;
    const b = await parseBody(req);
    if (b.__oversize) return json(res, 413, { error: "请求体过大（上限 1MB）" });
    try {
      const result = await llmConfig.testConnection(b || {}, db);
      json(res, 200, { ok: true, result });
    } catch (e) {
      sendError(res, e);
    }
  });

  route("GET", /^\/api\/admin\/llm\/models$/, (req, res) => {
    if (!authorize(req, res, "仅超级管理员可查看大模型")) return;
    try {
      json(res, 200, { ok: true, models: llmConfig.listModels(db) });
    } catch (e) {
      sendError(res, e);
    }
  });

  route("POST", /^\/api\/admin\/llm\/models$/, async (req, res) => {
    const s = authorize(req, res, "仅超级管理员可创建大模型");
    if (!s) return;
    const b = await readBody(req, res);
    if (!b) return;
    try {
      const after = withAuditSavepoint(() => {
        const saved = llmConfig.saveModel(b, s.username, db);
        adminAudit(req, s, {
          action: "llm.model.create", resourceType: "llm_model", resourceId: saved.id,
          before: null, after: saved
        });
        return saved;
      });
      json(res, 201, { ok: true, model: after });
    } catch (e) {
      sendError(res, e);
    }
  });

  route("PUT", /^\/api\/admin\/llm\/models\/(\d+)$/, async (req, res, m) => {
    const s = authorize(req, res, "仅超级管理员可编辑大模型");
    if (!s) return;
    let before;
    try {
      before = llmConfig.getModelPublic(m[1], db);
    } catch (e) {
      return sendError(res, e);
    }
    if (!before) return json(res, 404, { error: "模型不存在" });
    const b = await readBody(req, res);
    if (!b) return;
    try {
      const after = withAuditSavepoint(() => {
        const saved = llmConfig.saveModel({ ...b, id: Number(m[1]) }, s.username, db);
        adminAudit(req, s, {
          action: "llm.model.update", resourceType: "llm_model", resourceId: saved.id,
          before, after: saved
        });
        return saved;
      });
      json(res, 200, { ok: true, model: after });
    } catch (e) {
      sendError(res, e);
    }
  });

  route("POST", /^\/api\/admin\/llm\/models\/(\d+)\/copy$/, async (req, res, m) => {
    const s = authorize(req, res, "仅超级管理员可复制大模型");
    if (!s) return;
    let before;
    try {
      before = llmConfig.getModelPublic(m[1], db);
    } catch (e) {
      return sendError(res, e);
    }
    if (!before) return json(res, 404, { error: "模型不存在" });
    try {
      const after = withAuditSavepoint(() => {
        const saved = llmConfig.copyModel(m[1], s.username, db);
        adminAudit(req, s, {
          action: "llm.model.copy", resourceType: "llm_model", resourceId: saved.id,
          before, after: saved
        });
        return saved;
      });
      json(res, 201, { ok: true, model: after });
    } catch (e) {
      sendError(res, e);
    }
  });

  route("POST", /^\/api\/admin\/llm\/models\/(\d+)\/test$/, async (req, res, m) => {
    const s = authorize(req, res, "仅超级管理员可测试大模型");
    if (!s) return;
    let before;
    try {
      before = llmConfig.getModelPublic(m[1], db);
    } catch (e) {
      return sendError(res, e);
    }
    if (!before) return json(res, 404, { error: "模型不存在" });
    const b = await readBody(req, res);
    if (!b) return;
    try {
      const probe = await llmConfig.probeModel(m[1], b, db);
      let model = probe.model;
      if (probe.usesSavedKey) {
        model = withAuditSavepoint(() => {
          const saved = llmConfig.recordModelTest(m[1], probe.result, s.username, db);
          adminAudit(req, s, {
            action: "llm.model.test", resourceType: "llm_model", resourceId: before.id,
            before, after: saved, meta: { result: probe.result, persisted: true }
          });
          return saved;
        });
      } else {
        withAuditSavepoint(() => {
          adminAudit(req, s, {
            action: "llm.model.test", resourceType: "llm_model", resourceId: before.id,
            before, after: model, meta: { result: probe.result, persisted: false }
          });
        });
      }
      json(res, 200, { ok: true, result: probe.result, model });
    } catch (e) {
      sendError(res, e);
    }
  });

  route("DELETE", /^\/api\/admin\/llm\/models\/(\d+)$/, (req, res, m) => {
    const s = authorize(req, res, "仅超级管理员可删除大模型");
    if (!s) return;
    let before;
    try {
      before = llmConfig.getModelPublic(m[1], db);
    } catch (e) {
      return sendError(res, e);
    }
    if (!before) return json(res, 404, { error: "模型不存在" });
    try {
      withAuditSavepoint(() => {
        llmConfig.deleteModel(m[1], db);
        adminAudit(req, s, {
          action: "llm.model.delete", resourceType: "llm_model", resourceId: before.id,
          before, after: null
        });
      });
      json(res, 200, { ok: true });
    } catch (e) {
      sendError(res, e);
    }
  });

  route("GET", /^\/api\/admin\/llm\/routes$/, (req, res) => {
    if (!authorize(req, res, "仅超级管理员可查看大模型路由")) return;
    try {
      json(res, 200, { ok: true, routes: llmConfig.listRoutes(db) });
    } catch (e) {
      sendError(res, e);
    }
  });

  route("PUT", /^\/api\/admin\/llm\/routes$/, async (req, res) => {
    const s = authorize(req, res, "仅超级管理员可编辑大模型路由");
    if (!s) return;
    const b = await readBody(req, res);
    if (!b) return;
    try {
      const before = llmConfig.listRoutes(db);
      const after = withAuditSavepoint(() => {
        const saved = llmConfig.saveRoutes(b.routes, s.username, db);
        adminAudit(req, s, {
          action: "llm.routes.update", resourceType: "llm_routes", resourceId: "llm_routes",
          before, after: saved
        });
        return saved;
      });
      json(res, 200, { ok: true, routes: after });
    } catch (e) {
      sendError(res, e);
    }
  });
}

module.exports = { registerLlmAdminRoutes };
