/* Agent 环境开关（无依赖，供 runtime / bridge 共用） */
function agentEnabled(){
  return process.env.DIALOGUE_AGENT_ENABLED === "1";
}

/* 本地默认允许真发：仅显式 AGENT_DRY_RUN=1 时进入演练（不落 pending、不阻断 canAutoSend） */
function agentDryRun(){
  return process.env.AGENT_DRY_RUN === "1";
}

function healthChatEnabled(){
  return process.env.HEALTH_CHAT_ENABLED === "1";
}

/* 健康对话「首次给建议」须人工确认：开启后（HEALTH_CHAT_FIRST_REVIEW=1），
   每个会话首次 advise 落 pending 人工审核，后续追问才自动发送（防止无复核医疗建议）。 */
function healthChatFirstReview(){
  return process.env.HEALTH_CHAT_FIRST_REVIEW === "1";
}

module.exports = { agentEnabled, agentDryRun, healthChatEnabled, healthChatFirstReview };
