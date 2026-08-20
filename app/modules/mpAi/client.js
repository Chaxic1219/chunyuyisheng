"use strict";

/**
 * OpenAI 兼容 chat completions（仿静态项目 aiProxy 非流式形态）。
 * 禁止 require triage / agent / health_chat。
 */

function resolveConfig() {
  try {
    const llmConfig = require("../llm_config.js");
    const runtime = llmConfig.resolveRuntime({});
    if (runtime) {
      return {
        key: runtime.key,
        url: runtime.url,
        model: runtime.model,
        multimodal: !!runtime.multimodal,
        timeoutMs: runtime.timeoutMs || +(process.env.MP_AI_TIMEOUT_MS || 30000)
      };
    }
  } catch (e) {}

  const key = String(process.env.MP_AI_API_KEY || process.env.DEEPSEEK_API_KEY || "").trim();
  if (!key) return null;
  const base = String(
    process.env.MP_AI_BASE_URL ||
      process.env.DEEPSEEK_BASE_URL ||
      "https://api.deepseek.com"
  )
    .trim()
    .replace(/\/$/, "");
  const model = String(
    process.env.MP_AI_MODEL || process.env.DEEPSEEK_MODEL || "deepseek-chat"
  ).trim();
  return {
    key,
    url: base + "/chat/completions",
    model,
    timeoutMs: +(process.env.MP_AI_TIMEOUT_MS || 30000)
  };
}

/**
 * @param {{ messages: Array<{role:string, content: string | Array<{type:string, text?:string, image_url?:{url:string}}>}>, temperature?: number, max_tokens?: number }} opts
 * @param {{ fetchImpl?: typeof fetch }} [deps]
 */
async function chatCompletions(opts, deps, sceneId){
  const fetchImpl = (deps && deps.fetchImpl) || globalThis.fetch;
  const sid = String(sceneId || "mp_ai").trim() || "mp_ai";
  if (typeof fetchImpl !== "function") {
    const err = new Error("fetch_unavailable");
    err.code = "upstream_error";
    throw err;
  }
  try {
    const llmConfig = require("../llm_config.js");
    return await llmConfig.runWithFallback(sid, async (cfg) => {
      const body = { model: cfg.model, messages: opts.messages,
        temperature: opts.temperature != null ? opts.temperature : 0.7,
        max_tokens: opts.max_tokens != null ? opts.max_tokens : 1000 };
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), cfg.timeoutMs || +(process.env.MP_AI_TIMEOUT_MS || 30000));
      try {
        const res = await fetchImpl(cfg.url, { method: "POST", headers: cfg.headers || {
          "Content-Type": "application/json", Authorization: "Bearer " + cfg.key },
          body: JSON.stringify(body), signal: controller.signal });
        if (!res.ok) {
          let detail = "";
          try { detail = await res.text(); } catch (_) {}
          const err = new Error("mp_ai_upstream_http_" + res.status + (detail ? ": " + String(detail).slice(0, 200) : ""));
          err.code = "upstream_error";
          err.status = res.status;
          err.llmRetryable = true;
          throw err;
        }
        const data = await res.json();
        const text = String((((data.choices || [])[0] || {}).message || {}).content || "").trim();
        if (!text) throw Object.assign(new Error("mp_ai_empty_response"), { code: "upstream_error", llmRetryable:true });
        return { text, model: cfg.model, raw: data };
      } catch (e) {
        if (e && e.llmRetryable !== true) e.llmRetryable = true;
        throw e;
      } finally {
        clearTimeout(timer);
      }
    }, { legacyRuntime:resolveConfig() });
  } catch (e) {
    if (e && /Primary model is unavailable/.test(e.message || "")) {
      const err = new Error("mp_ai_not_configured");
      err.code = "not_configured";
      throw err;
    }
    if (e && e.code) throw e;
    const err = new Error(e && e.name === "AbortError" ? "mp_ai_timeout" : (e && e.message) || "mp_ai_upstream_error");
    err.code = "upstream_error";
    err.llmRetryable = true;
    throw err;
  }
}

module.exports = { resolveConfig, chatCompletions };
