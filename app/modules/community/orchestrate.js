"use strict";

/**
 * 社群入站主编排：handleInbound。
 * 依赖 runtime / moderation / service / repo / outbox / agent / triage，不依赖 community.js。
 */
const { db, resolvePatient } = require("../../db.js");
const engine = require("../../engine.js");
const triage = require("../../triage.js");
const { buildMenuText } = require("../../patient_reply.js");
const { logInboundMessage } = require("../../message_log.js");
const service = require("./service.js");
const repo = require("./repo.js");
const rules = require("./rules.js");
const moderation = require("./moderation.js");
const rt = require("./runtime.js");

async function handleInbound(input){
  const did = rt.resolveDoctorId(input);
  if(!did) throw new Error("医生不存在或缺少 doctorId/doctorSlug");
  const group = service.findGroup(did, input);
  if(!group) throw new Error("群配置不存在");
  if(rt.isLoopbackInbound(input)){
    return { ok:true, skipped:"loopback", group:rules.groupOut(group), message:null, outbox:null };
  }
  const dedupKey = rt.cleanText(input.externalMsgId, 120);
  if(dedupKey){
    const dup = repo.getLatestMessageByExternal(did, dedupKey);
    if(dup){
      return { ok:true, deduped:true, group:rules.groupOut(group), message:rules.messageOut(dup), outbox:null };
    }
  }
  const eventType = rt.cleanText(input.eventType || "message", 40);
  const dataSource = rt.cleanText(input.dataSource, 20) || "manual";
  const member = service.upsertMember(did, group.id, { ...input, dataSource });
  let patientId = null;
  try{
    patientId = resolvePatient({ doctorId:did, channel:group.channel_type || "wechat", externalId:member.external_user_id,
      groupId:group.id, phone:member.phone, unionid:input.unionid, displayName:member.display_name });
    if(patientId && member.patient_id !== patientId) repo.setMemberPatientId(member.id, patientId);
  }catch(e){}
  const text = rt.cleanText(input.text || input.content || "", 1000);
  const msgType = rt.cleanText(input.msgType || (eventType === "member_join" ? "event" : "text"), 40);
  const inboundRow = repo.insertMessage({
    doctorId:did, groupId:group.id, memberId:member.id,
    externalMsgId:rt.cleanText(input.externalMsgId, 120),
    senderName:member.display_name, senderRole:rt.cleanText(input.senderRole || "patient", 40),
    msgType, text:text || (eventType === "member_join" ? `${member.display_name} 入群` : ""),
    rawPayload:input.rawPayload || input, processStatus:"received", dataSource
  });
  const messageId = inboundRow.id;

  if(msgType === "text" && text){
    const mod = moderation.scanModeration(text);
    if(mod.flag){
      repo.setModerationFlag(messageId, mod.flag, mod.keys.join(","), mod.level);
    }
  }

  if(group.status === "paused" || group.review_mode === "paused"){
    repo.setProcessStatus(messageId, "paused");
    return { ok:true, group:rules.groupOut(group), message:rules.messageOut(repo.getMessageById(messageId)), outbox:null };
  }

  if(eventType === "member_join"){
    const outboxes = [];
    const welcomeResolved = require("../../welcome.js").resolveWelcomeText({
      doctorId:did,
      patientName:member.display_name,
      groupName:group.name
    });
    const welcomeText = welcomeResolved.text;
    if(group.welcome_enabled && welcomeText){
      outboxes.push(rt.enqueue({ doctorId:did, group, messageId, targetName:group.name,
        text:rt.atName(member.display_name, welcomeText),
        payload:{ eventType, memberId:member.id, welcomeSource:welcomeResolved.source }, source:"welcome", priority:"normal" }));
    }
    outboxes.push(rt.enqueue({ doctorId:did, group, messageId, targetName:group.name,
      text:rt.atName(member.display_name, rt.joinFaqText(did, member.display_name)),
      payload:{ eventType, memberId:member.id, page:"faq", card:{ type:"mp", title:"群友常见问题", page:"faq" } },
      source:"faq_welcome", priority:"normal" }));
    repo.setProcessMatched(messageId, "welcome_queued", "welcome,faq_welcome");
    return { ok:true, group:rules.groupOut(group), message:rules.messageOut(repo.getMessageById(messageId)), outbox:outboxes[0] || null, outboxes };
  }

  if(!text){
    const vars = rt.scriptVars(did, group, member);
    const key = msgType === "voice" || msgType === "audio" ? "voice" : "nonText";
    const script = rt.configuredScript(did, key, vars) || rt.configuredScript(did, "nonText", vars);
    if(group.auto_reply_enabled && script){
      const materialReview = triage.materialReviewSummary({ msgType, text, name:rt.cleanText(input.fileName || input.filename || "", 120), mime:rt.cleanText(input.mime || input.contentType || "", 80) });
      const out = rt.enqueue({ doctorId:did, group, messageId, targetName:group.name, text:rt.atName(member.display_name, script),
        payload:{ msgType, eventType, memberId:member.id, materialReview }, status:"pending", source:key === "voice" ? "voice_fallback" : "non_text_fallback", priority:"normal" });
      repo.setProcessMatched(messageId, "non_text_pending_review", out.source);
      return { ok:true, group:rules.groupOut(group), message:rules.messageOut(repo.getMessageById(messageId)), outbox:out };
    }
    repo.setProcessStatus(messageId, "ignored_empty");
    return { ok:true, group:rules.groupOut(group), message:rules.messageOut(repo.getMessageById(messageId)), outbox:null };
  }

  if(!group.auto_reply_enabled){
    repo.setProcessStatus(messageId, "manual_only");
    logInboundMessage({ ...rt.inboundLogBase(did, group, member, patientId, text), actionTaken:"manual_only", replyStatus:"pending" });
    return { ok:true, group:rules.groupOut(group), message:rules.messageOut(repo.getMessageById(messageId)), outbox:null };
  }

  try{
    const agentMod = require("../../agent/index.js");
    if(agentMod.agentEnabled()){
      const attachments = [];
      if(msgType && msgType !== "text" && msgType !== "event"){
        attachments.push({ type:msgType, name:rt.cleanText(input.fileName || input.filename || "", 120) });
      }
      if(Array.isArray(input.attachments)) attachments.push(...input.attachments);
      const agentReply = await agentMod.runTurn({
        doctorId:did,
        text,
        patientName:member.display_name,
        patientKey:`community:${group.id}:${member.external_user_id || member.id}`,
        patientId,
        isGroup:true,
        attachments
      });
      if(agentReply && (agentReply.source === "dialogue_agent" || agentReply.source === "code_fast_path")){
        const { responsesToPlainText, agentCanAutoInGroup } = require("../../agent/adapter.js");
        let outText = responsesToPlainText(agentReply.responses, member.display_name);
        if(agentReply.source !== "code_fast_path") outText = rt.atName(member.display_name, outText);
        const canAuto = agentCanAutoInGroup(agentReply, group);
        const enqueueStatus = (canAuto && !(group.channel_type === "qiwe" && group.is_business)) ? "sent" : "pending";
        const risk = (agentReply.triage && (agentReply.triage.clinicalRisk || agentReply.triage.riskLevel)) || "low";
        const priority = risk === "high" ? "urgent" : (agentReply.triage && agentReply.triage.needsHuman) ? "high" : "normal";
        let out = rt.enqueue({
          doctorId:did, group, messageId, targetName:group.name, text:outText,
          payload:{
            agent:true,
            source:agentReply.source,
            intentCode:agentReply.intentCode || null,
            toolCalls:agentReply.toolCalls || [],
            triage:agentReply.triage || null,
            agentMeta:agentReply.agentMeta || null,
            responses:agentReply.responses || [],
            qiwe: group.channel_type === "qiwe" ? {
              toId: group.external_group_id || "",
              code: agentReply.intentCode || null,
              atUserId: member.external_user_id || ""
            } : null
          },
          status:enqueueStatus, source:agentReply.source === "code_fast_path" ? "code_fast_path" : "dialogue_agent", priority
        });
        let status = out.status;
        if(canAuto && group.channel_type === "qiwe" && group.is_business){
          try{
            out = await rt.setOutboxStatus(out.id, "sent", "system");
            status = "sent";
          }catch(e){
            console.error("[community] agent 自动真发失败，保留 pending：", e && e.message);
            out = rt.outboxOut(require("../outbox").getById(out.id));
            status = out.status || "pending";
          }
        }else if(canAuto){
          status = "sent";
        }else{
          status = "pending";
        }
        repo.setRiskProcess(messageId, risk, status === "sent" ? "agent_auto_sent" : "agent_pending_review", agentReply.source);
        const tri = agentReply.triage || {};
        logInboundMessage({
          ...rt.inboundLogBase(did, group, member, patientId, text),
          isKeywordRule: agentReply.source === "code_fast_path",
          aiDraft: null,
          triageSessionId: agentReply.sessionId || null,
          autoSent: status === "sent",
          riskLevel: tri.riskLevel || tri.clinicalRisk,
          needsHuman: !!tri.needsHuman,
          needsDoctor: !!tri.needsDoctor
            || (typeof triage.needsDoctorFromTriggers === "function"
                && triage.needsDoctorFromTriggers(tri.triggers)),
          riskTriggers: tri.triggers,
          emergency: !!tri.emergency,
          sentinel: !!tri.sentinel
        });
        return {
          ok:true,
          group:rules.groupOut(group),
          message:rules.messageOut(repo.getMessageById(messageId)),
          outbox:out,
          triage:agentReply.triage || null,
          agent:agentReply
        };
      }
    }
  }catch(e){
    console.error("[community] dialogue agent 失败，回落旧链路：", e && e.message);
  }

  const matched = engine.match(did, text);
  if(matched){
    const vars = rt.scriptVars(did, group, member);
    const baseReply = matched.menu ? buildMenuText(rt.doctorContent(did).content) : rt.responseToText(matched.responses, member.display_name);
    const reply = matched.menu ? baseReply : rt.mergeConfiguredReply(rt.configuredCodeScript(did, matched.code, vars), baseReply);
    const canAuto = rt.communityFallbackCanAuto(group, null);
    const status = canAuto ? "sent" : "pending";
    const out = rt.enqueue({ doctorId:did, group, messageId, targetName:group.name, text:reply, payload:{ matched }, status, source:"keyword_rule", priority:"normal" });
    repo.setRiskProcess(messageId, "low", status === "sent" ? "rule_auto_sent" : "rule_pending_review", "keyword_rule");
    logInboundMessage({ ...rt.inboundLogBase(did, group, member, patientId, text), isKeywordRule:true, autoSent: status === "sent" });
    return { ok:true, group:rules.groupOut(group), message:rules.messageOut(repo.getMessageById(messageId)), outbox:out };
  }

  const intent = await triage.classifyIntent(did, text);
  const intentAuditRisk = intent && intent.source === "model_service_intent" ? "medium" : "low";
  if(intent && intent.menu){
    const reply = buildMenuText(rt.doctorContent(did).content);
    const canAuto = rt.communityFallbackCanAuto(group, null);
    const status = canAuto ? "sent" : "pending";
    const out = rt.enqueue({ doctorId:did, group, messageId, targetName:group.name, text:reply,
      payload:{ matched:{ menu:true }, intentSource:intent.source }, status, source:"ai_intent", priority:"normal" });
    repo.setRiskProcess(messageId, intentAuditRisk, status === "sent" ? "intent_auto_sent" : "intent_pending_review", "ai_intent:menu");
    logInboundMessage({ ...rt.inboundLogBase(did, group, member, patientId, text), isKeywordRule:true, autoSent: status === "sent" });
    return { ok:true, group:rules.groupOut(group), message:rules.messageOut(repo.getMessageById(messageId)), outbox:out };
  }
  if(intent && intent.code && Array.isArray(intent.responses)){
    const vars = rt.scriptVars(did, group, member);
    const merged = rt.mergeConfiguredReply(rt.configuredCodeScript(did, intent.code, vars), rt.responseToText(intent.responses, member.display_name));
    if(merged){
      const reply = rt.atName(member.display_name, merged);
      const canAuto = rt.communityFallbackCanAuto(group, null);
      const status = canAuto ? "sent" : "pending";
      const out = rt.enqueue({ doctorId:did, group, messageId, targetName:group.name, text:reply,
        payload:{ matched:{ code:intent.code, responses:intent.responses }, intentSource:intent.source }, status, source:"ai_intent", priority:"normal" });
      repo.setRiskProcess(messageId, intentAuditRisk, status === "sent" ? "intent_auto_sent" : "intent_pending_review", "ai_intent:" + intent.code);
      logInboundMessage({ ...rt.inboundLogBase(did, group, member, patientId, text), isKeywordRule:true, autoSent: status === "sent" });
      return { ok:true, group:rules.groupOut(group), message:rules.messageOut(repo.getMessageById(messageId)), outbox:out };
    }
  }

  const tri = await triage.handleIncoming({
    doctorId:did,
    text,
    patientName:member.display_name,
    patientKey:`community:${group.id}:${member.external_user_id || member.id}`,
    patientId,
    isGroup:true
  });
  const canAuto = rt.communityFallbackCanAuto(group, tri.triage || null);
  const status = canAuto ? "sent" : "pending";
  const priority = tri.triage && tri.triage.riskLevel === "high" ? "urgent" : tri.triage && tri.triage.needsHuman ? "high" : "normal";
  const entryLines = rt.triageEntryCardLines(tri);
  const baseText = status === "sent"
    ? ((tri.response && tri.response.text) || "")
    : ((tri.draft || (tri.response && tri.response.text)) || "");
  const vars = rt.scriptVars(did, group, member);
  const humanScript = tri.triage && tri.triage.needsHuman && status !== "sent" ? rt.configuredScript(did, "transferHuman", vars) : "";
  const emergencyScript = tri.triage && tri.triage.riskLevel === "high" && status !== "sent" ? rt.configuredScript(did, "emergency", vars) : "";
  const outText = [humanScript, emergencyScript, baseText, entryLines].filter(Boolean).join("\n");
  const out = rt.enqueue({ doctorId:did, group, messageId, targetName:group.name, text:outText,
    payload:{ triage:tri.triage, triageSessionId:tri.sessionId, triageDecisionId:tri.decisionId, entryCode:(tri.entryCode || "") },
    status, source:"ai_triage", priority });
  repo.setRiskProcessTriage(
    messageId,
    (tri.triage && tri.triage.riskLevel) || "low",
    status === "sent" ? "triage_auto_sent" : "triage_pending_review",
    "ai_triage",
    tri.sessionId,
    tri.decisionId
  );

  logInboundMessage({
    ...rt.inboundLogBase(did, group, member, patientId, text),
    aiDraft: tri.draft || null,
    triageSessionId: tri.sessionId || null,
    autoSent: status === "sent",
    riskLevel: tri.triage && tri.triage.riskLevel,
    needsHuman: !!(tri.triage && tri.triage.needsHuman)
  });

  return { ok:true, group:rules.groupOut(group), message:rules.messageOut(repo.getMessageById(messageId)), outbox:out, triage:tri.triage };
}

module.exports = { handleInbound };
