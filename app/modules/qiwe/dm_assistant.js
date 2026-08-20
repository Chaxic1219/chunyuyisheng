"use strict";
/* 企微私聊：与小程序 mpAi 同口径通用医助；LLM 走独立场景 qiwe_dm（非 mp_ai 路由）。 */
const { db } = require("../../db.js");
const mpAi = require("../mpAi");
const { splitReplyBubbles } = require("../../reply_bubbles.js");

const SCENE_ID = "qiwe_dm";
const DM_BUBBLE_CFG = { minTotal: 72, maxBubble: 140, delayMs: 450 };

function dmResponsesFromText(text){
  const t = String(text || "").trim();
  if(!t) return [];
  const bubbles = splitReplyBubbles(t, DM_BUBBLE_CFG);
  return (bubbles.length ? bubbles : [t]).map(part => ({ type:"text", text: part }));
}

function loadDmHistory(doctorId, senderId){
  if(!senderId) return [];
  try{
    const rows = db.prepare(`
      SELECT direction, text, reply_sent, ai_draft
      FROM message_log
      WHERE sender_id=? AND channel='qiwe'
        AND (group_id IS NULL OR trim(group_id)='')
      ORDER BY id DESC LIMIT 10
    `).all(String(senderId));
    const out = [];
    for(const r of rows.reverse()){
      const inbound = String(r.text || "").trim();
      const outbound = String(r.reply_sent || r.ai_draft || "").trim();
      if(inbound) out.push({ role:"user", text:inbound.slice(0, 2000) });
      if(outbound) out.push({ role:"assistant", text:outbound.slice(0, 2000) });
    }
    return out.slice(-10);
  }catch(e){
    return [];
  }
}

async function buildQiweDmAssistantReply(input){
  input = input || {};
  const text = String(input.text || "").trim();
  if(!text) return null;
  const doctorId = Number(input.doctorId);
  const senderId = String(input.senderId || "").trim();
  const history = Array.isArray(input.history)
    ? input.history
    : loadDmHistory(doctorId, senderId);

  let replyText = "";
  let model = "";
  try{
    const out = await mpAi.chat({ text, history, sceneId: SCENE_ID });
    replyText = out && out.reply && out.reply.text ? String(out.reply.text).trim() : "";
    model = out && out.model ? String(out.model) : "";
  }catch(e){
    console.error("[qiwe] dm qiwe_dm 失败：", e && e.message);
    return {
      bot:"医助",
      responses:[{
        type:"text",
        text:"您的问题已收到，我这边稍后继续帮您跟进。如有明显不适，请及时到正规医院就诊。"
      }],
      source:"qiwe_dm_fallback",
      triage:{ riskLevel:"medium", canAutoSend:false, needsHuman:true, sendPolicy:"review" },
      autoSent:false,
      handoff:true
    };
  }
  if(!replyText){
    return {
      bot:"医助",
      responses:[{
        type:"text",
        text:"我这边先帮您记下，如有健康或就医相关的问题，可以直接描述具体情况。"
      }],
      source:"qiwe_dm_fallback",
      triage:{ riskLevel:"medium", canAutoSend:false, needsHuman:true, sendPolicy:"review" },
      autoSent:false,
      handoff:true
    };
  }
  return {
    bot:"医助",
    responses: dmResponsesFromText(replyText),
    source:"qiwe_dm",
    model,
    triage:{ riskLevel:"low", canAutoSend:true, needsHuman:false, sendPolicy:"auto" },
    autoSent:true,
    handoff:false
  };
}

if(require.main === module){
  console.assert(Array.isArray(loadDmHistory(0, "")), "dm_assistant: loadDmHistory fail-closed");
  console.assert(SCENE_ID === "qiwe_dm", "dm_assistant: scene qiwe_dm");
}

module.exports = { buildQiweDmAssistantReply, loadDmHistory, dmResponsesFromText, SCENE_ID };
