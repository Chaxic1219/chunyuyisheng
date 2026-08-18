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

module.exports = { agentEnabled, agentDryRun, healthChatEnabled };
