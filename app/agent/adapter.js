/* Agent 结果 → 社群/投递侧适配 */
function responsesToPlainText(responses, patientName){
  if(!Array.isArray(responses)) return "";
  const patient = String(patientName || "").trim().slice(0, 20);
  return responses.map(r=>{
    if(!r) return "";
    if(r.type === "text") return String(r.text || "").trim().slice(0, 1200);
    if(r.type === "link") return `请打开：${r.title || "相关链接"}${r.source ? "（" + r.source + "）" : ""}`;
    if(r.type === "mp") return `请打开小程序卡：${r.title || "春雨医生服务"}`;
    if(r.type === "qr") return `请扫码联系：${r.name || "医生团队"}${r.caption ? " - " + r.caption : ""}`;
    if(r.type === "popup") return `请查看群内弹窗/卡片：${r.modal || "详情"}`;
    if(r.type === "image") return `请查看图片/海报：${r.title || "医生资料"}`;
    return String(r.text || r.title || "").trim().slice(0, 600);
  }).filter(Boolean).join("\n\n").replace(/@?\{patient\}\s?/g, patient ? (patient + " ") : "");
}

function agentCanAutoInGroup(reply, group){
  if(!reply || !reply.triage) return false;
  if(reply.dryRun) return false;
  if(reply.triage.canAutoSend !== true) return false;
  if(reply.triage.sendPolicy === "review") return false;
  // 放宽自动发送门槛：风险策略已允许自动发送时，不再额外受 review_mode=auto_keywords 限制；
  // 仅在群被暂停时继续阻断，避免把本应自动发送的低/中风险建议误落 pending。
  if(!group) return false;
  if(group.status === "paused" || group.review_mode === "paused") return false;
  if(group.auto_reply_enabled === false || group.auto_reply_enabled === 0) return false;
  return true;
}

module.exports = { responsesToPlainText, agentCanAutoInGroup };
