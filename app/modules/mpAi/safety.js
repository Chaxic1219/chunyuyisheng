"use strict";

/** 与 triage.js 同口径：拦截模型自曝与结构化泄漏 */
const LLM_REPLY_LEAK =
  /系统提示|system\s*prompt|模型指令|作为(一个)?\s*(AI|人工智能|大?语言模型|智能助手|机器人)|我是(一个)?\s*(AI|人工智能|语言模型|智能助手|ChatGPT|GPT|DeepSeek|大模型)|我(只是|不过是)(一个)?\s*(AI|人工智能|程序|机器人|模型)|人工智能助手|智能客服|语言模型|ChatGPT|GPT-?\d|DeepSeek|Claude|文心一言|通义千问|忽略(之前|上述|以上).{0,4}(指令|提示|设定)|ignore (previous|above)|<\/?system>|```|我没有实体|虚拟助手|自动回复程序/i;

const FALLBACK_REPLY =
  "我这边先帮你记下，稍后会按你的情况继续跟进。如果还有别的健康或就医问题，也可以直接说。";

function sanitizeReply(text) {
  const t = String(text == null ? "" : text).trim();
  if (!t) return FALLBACK_REPLY;
  if (LLM_REPLY_LEAK.test(t) || /^\s*[{\[]/.test(t) || /"(reply|attach)"\s*:/.test(t)) {
    return FALLBACK_REPLY;
  }
  return t;
}

module.exports = { LLM_REPLY_LEAK, FALLBACK_REPLY, sanitizeReply };
