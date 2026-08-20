"use strict";

const { buildSystemPrompt, buildQiweDmSystemPrompt, buildQiweDmPhaseHint, buildNonMedicalRedirectPrompt, QIWE_DM_NON_MEDICAL_REPLY } = require("./prompt.js");
const { resolveConfig, chatCompletions } = require("./client.js");
const { isMedicalConsultAllowed, NON_MEDICAL_REPLY } = require("./gate.js");
const { sanitizeReply, FALLBACK_REPLY } = require("./safety.js");

const HISTORY_LIMIT = 10;

/** 指定场景路由模型是否支持图片（配置中心 multimodal 标志；异常/未配置时 false） */
function mpAiSupportsImages(sceneId){
  try{
    const llmConfig = require("../llm_config.js");
    const sid = String(sceneId || "mp_ai").trim() || "mp_ai";
    const runtime = llmConfig.resolveRuntime({ sceneId: sid });
    return !!(runtime && runtime.multimodal);
  }catch(e){
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

/** 非医疗门禁触发后：走 LLM 委婉拒答并引导回健康话题；失败才用写死兜底。 */
async function replyNonMedicalRedirect(input, deps, sceneId) {
  const isQiweDm = sceneId === "qiwe_dm";
  const fallback = isQiweDm ? QIWE_DM_NON_MEDICAL_REPLY : NON_MEDICAL_REPLY;
  const text = String(input.text || "").trim();
  if (!text) return fallback;
  const messages = [
    { role: "system", content: buildNonMedicalRedirectPrompt(isQiweDm) },
    ...normalizeHistory(input.history).slice(-4),
    { role: "user", content: text.slice(0, 2000) },
  ];
  try {
    const result = await chatCompletions(
      { messages, temperature: isQiweDm ? 0.75 : 0.7, max_tokens: isQiweDm ? 400 : 320 },
      deps,
      sceneId
    );
    const out = sanitizeReply(result.text);
    return out && out !== FALLBACK_REPLY ? out : fallback;
  } catch (_) {
    return fallback;
  }
}

/**
 * @param {{ doctorId?: number|string, text: string, history?: any[], sessionId?: string, assistantRole?: string, pageContext?: string, images?: string[], sceneId?: string }} input
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

  const sceneId = String(input.sceneId || "mp_ai").trim() || "mp_ai";
  const isQiweDm = sceneId === "qiwe_dm";

  const gate = isMedicalConsultAllowed({ text, images, history: input.history, sceneId });
  if (!gate.allowed) {
    const redirectText = await replyNonMedicalRedirect(input, deps, sceneId);
    return {
      reply: {
        id: "a-" + Date.now(),
        role: "assistant",
        text: redirectText,
      },
      sessionId: input.sessionId ? String(input.sessionId) : "",
      gateRedirect: true,
    };
  }

  // doctorId 可选：仅作前端上下文兼容，不进入人设（助手为独立身份）
  const assistantRole = String(input.assistantRole || "").trim();
  const pageContext = String(input.pageContext || "").trim().slice(0, 500);
  let textPart = pageContext
    ? `【页面上下文】${pageContext}\n\n${text.slice(0, 2000)}`
    : text.slice(0, 2000);
  if (isQiweDm) {
    textPart = buildQiweDmPhaseHint(input.history) + "\n\n" + textPart;
  }

  // 多模态判定：由配置中心 mp_ai 场景路由的模型决定。
  // 模型支持图片 → content 为数组 [text, image_url...]；否则忽略图片只发文本（降级不报错）。
  const supportsImages = mpAiSupportsImages(sceneId);

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
    { role: "system", content: isQiweDm ? buildQiweDmSystemPrompt() : buildSystemPrompt(assistantRole) },
    ...normalizeHistory(input.history),
    { role: "user", content: userContent },
  ];

  const result = await chatCompletions(
    { messages, temperature: isQiweDm ? 0.75 : 0.7, max_tokens: isQiweDm ? 900 : 1000 },
    deps,
    sceneId
  );

  return {
    reply: {
      id: "a-" + Date.now(),
      role: "assistant",
      text: sanitizeReply(result.text),
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
  isMedicalConsultAllowed,
  replyNonMedicalRedirect,
};
