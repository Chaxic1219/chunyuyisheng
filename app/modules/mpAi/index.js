"use strict";

const { buildSystemPrompt } = require("./prompt.js");
const { resolveConfig, chatCompletions } = require("./client.js");

const HISTORY_LIMIT = 10;

/** mp_ai 场景路由模型是否支持图片（配置中心 multimodal 标志；异常/未配置时 false） */
function mpAiSupportsImages() {
  try {
    const llmConfig = require("../llm_config.js");
    const runtime = llmConfig.resolveRuntime({ sceneId: "mp_ai" });
    return !!(runtime && runtime.multimodal);
  } catch (e) {
    return false;
  }
}

function normalizeHistory(history) {
  const rows = Array.isArray(history) ? history : [];
  const out = [];
  for (const h of rows) {
    if (!h) continue;
    const role = h.role === "assistant" || h.role === "ai" ? "assistant" : h.role === "user" ? "user" : "";
    if (!role) continue;
    const text = String(h.text != null ? h.text : h.content || "").trim().slice(0, 2000);
    if (!text) continue;
    out.push({ role, content: text });
  }
  return out.slice(-HISTORY_LIMIT);
}

/**
 * @param {{ doctorId?: number|string, text: string, history?: any[], sessionId?: string, assistantRole?: string, pageContext?: string, images?: string[] }} input
 * @param {{ fetchImpl?: typeof fetch }} [deps]
 */
async function chat(input, deps) {
  input = input || {};
  const text = String(input.text || "").trim();
  const images = Array.isArray(input.images) ? input.images.slice(0, 3) : [];
  if (!text && !images.length) {
    const err = new Error("text_required");
    err.code = "bad_request";
    throw err;
  }
  // doctorId 可选：仅作前端上下文兼容，不进入人设（助手为独立身份）
  const assistantRole = String(input.assistantRole || "").trim();
  const pageContext = String(input.pageContext || "").trim().slice(0, 500);
  const textPart = pageContext
    ? `【页面上下文】${pageContext}\n\n${text.slice(0, 2000)}`
    : text.slice(0, 2000);

  // 多模态判定：由配置中心 mp_ai 场景路由的模型决定。
  // 模型支持图片 → content 为数组 [text, image_url...]；否则忽略图片只发文本（降级不报错）。
  const supportsImages = mpAiSupportsImages();

  let userContent;
  if (images.length && supportsImages) {
    const parts = [];
    if (textPart) parts.push({ type: "text", text: textPart });
    for (const img of images) {
      parts.push({ type: "image_url", image_url: { url: img } });
    }
    userContent = parts;
  } else {
    userContent = images.length
      ? `${textPart ? textPart + "\n\n" : ""}[用户上传了 ${images.length} 张图片，当前模型不支持图片解析，仅回复文字内容]`
      : textPart;
  }

  const messages = [
    { role: "system", content: buildSystemPrompt(assistantRole) },
    ...normalizeHistory(input.history),
    { role: "user", content: userContent },
  ];

  const result = await chatCompletions(
    { messages, temperature: 0.7, max_tokens: 1000 },
    deps
  );

  return {
    reply: {
      id: "a-" + Date.now(),
      role: "assistant",
      text: result.text,
    },
    sessionId: input.sessionId ? String(input.sessionId) : "",
    model: result.model,
    imageHandled: images.length > 0,
  };
}

module.exports = {
  buildSystemPrompt,
  resolveConfig,
  chatCompletions,
  chat,
  normalizeHistory,
  mpAiSupportsImages,
  HISTORY_LIMIT,
};
