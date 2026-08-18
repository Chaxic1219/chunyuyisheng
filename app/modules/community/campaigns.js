"use strict";

/**
 * 社群运营草稿：周运营 / 知识候选 / 医助辅助草稿 / 定时周产。
 */
const { db } = require("../../db.js");
const triage = require("../../triage.js");
const service = require("./service.js");
const repo = require("./repo.js");
const rules = require("./rules.js");
const rt = require("./runtime.js");
const outbox = require("../outbox");

const now = () => new Date().toISOString();
const cleanText = (v, max) => rules.cleanText(v, max);
const doctorContent = (id) => rt.doctorContent(id);
const resolveDoctorId = (input) => rt.resolveDoctorId(input);
const findGroup = (doctorId, input) => service.findGroup(doctorId, input);
const enqueue = (args) => rt.enqueue(args);
const outboxOut = (o) => outbox.outboxOut(o);

function createWeeklyCampaign(input){
  const did = resolveDoctorId(input);
  if(!did) throw new Error("医生不存在或缺少 doctorId/doctorSlug");
  const group = findGroup(did, input);
  if(!group) throw new Error("群配置不存在");
  if(group.status === "paused" || group.review_mode === "paused") throw new Error("群已暂停，不能生成运营内容");
  const { content, doctor } = doctorContent(did);
  const cfg = content.weeklyOps || {};
  const topic = cleanText(input.topic, 90) || cleanText(cfg.defaultTopic, 90) || "不吸烟，为什么还会得肺癌？";
  const quiz = Array.isArray(input.quiz) ? input.quiz : (Array.isArray(cfg.quiz) ? cfg.quiz : []);
  const quizLine = quiz.length
    ? "互动提问：" + quiz.map((x,i)=>`${String.fromCharCode(65+i)}.${cleanText(x, 24)}`).join("  ")
    : "互动提问：您最想了解这个话题里的哪一点？A.原因  B.预防  C.检查  D.复诊";
  const doctorName = doctor && doctor.name ? doctor.name : "医生";
  const dept = doctor && (doctor.dept || doctor.specialty) ? `（${doctor.dept || doctor.specialty}）` : "";
  const body = [
    "@所有人",
    `今天的群内科普主题：${topic}`,
    `这是${doctorName}医生团队${dept}整理的健康提醒，适合群友先做基础了解。`,
    cleanText(cfg.template, 500) || "建议大家先看科普，再结合自己的检查资料和症状向医生/医助咨询；群内内容只做健康教育，不替代面诊。",
    quizLine,
    "回复选项或问题即可；涉及具体病情判断、报告结论、用药和手术决策时，医助会转人工处理。"
  ].filter(Boolean).join("\n");
  return enqueue({
    doctorId:did,
    group,
    targetName:group.name,
    text:body,
    payload:{
      eventType:"weekly_ops",
      topic,
      quiz,
      doctorId:did,
      // 真发依赖 payload.qiwe.toId（企微 roomId）；缺省时 setOutboxStatus 会落成「仅标 sent」假发送
      qiwe:{
        toId: group.external_group_id || "",
        needAtAll:true
      },
      ...(input && input.payloadExtra && typeof input.payloadExtra === "object" ? input.payloadExtra : {})
    },
    status:"pending",
    source: (input && input.outboxSource) || "weekly_ops",
    priority:"normal"
  });
}

function outboxReviewContext(row){
  const payload = rt.j(row && row.payload, {});
  const msg = row && row.message_id ? repo.getMessageById(row.message_id) : null;
  const tri = payload.triage || {};
  return {
    payload,
    sourceText: msg && msg.text ? msg.text : "",
    riskLevel: tri.riskLevel || (msg && msg.risk_level) || "",
    contextType: [row && row.source, msg && msg.msg_type, row && row.channel_type].filter(Boolean).join("/") || "outbox",
    triageDecisionId: payload.triageDecisionId || payload.decisionId || tri.decisionId || null
  };
}

async function generateAssistantDraftForOutbox(id, input){
  const row = outbox.getById(+id);
  if(!row) throw new Error("出站消息不存在");
  if(row.status !== "pending") throw new Error("仅待发送草稿可生成医助辅助草稿");
  const ctx = outboxReviewContext(row);
  const generated = await triage.generateAssistantReviewDraft({
    doctorId:row.doctor_id,
    sourceText:ctx.sourceText,
    originalDraft:row.text || "",
    riskLevel:ctx.riskLevel,
    contextType:ctx.contextType,
    instruction:input && input.instruction
  });
  if(!generated.ok){
    return {
      ok:false,
      changed:false,
      reason:generated.reason || "draft_generation_failed",
      outbox:outboxOut(row),
      assistantDraft:{ source:"assistant_draft", generatedAt:now(), contextScope:generated.contextScope || ctx.contextType, degraded:true }
    };
  }
  const payload = {
    ...ctx.payload,
    assistantDraft:{
      source:"assistant_draft",
      model:generated.model || "",
      contextScope:generated.contextScope || ctx.contextType,
      generatedAt:generated.generatedAt || now(),
      basedOn:{ outboxId:row.id, source:row.source || "", riskLevel:ctx.riskLevel || "", messageId:row.message_id || null, triageDecisionId:ctx.triageDecisionId || null },
      originalText:String(row.text || "").slice(0, 800)
    }
  };
  const updated = outbox.updatePendingDraft(+id, {
    text: cleanText(generated.text, 2400),
    payload
  }, (input && input.username) || "admin");
  if(!updated) throw new Error("仅待发送草稿可生成医助辅助草稿");
  return { ok:true, changed:true, outbox:updated, assistantDraft:payload.assistantDraft };
}

function readyKnowledgeForCandidate(doctorId, input){
  const did = +doctorId;
  const kid = Number(input && input.knowledgeId);
  if(Number.isInteger(kid) && kid > 0){
    return db.prepare("SELECT * FROM knowledge_items WHERE doctor_id=? AND id=? AND status='ready'").all(did, kid);
  }
  return db.prepare(`SELECT * FROM knowledge_items WHERE doctor_id=? AND status='ready'
    ORDER BY CASE layer WHEN '医生个人' THEN 1 WHEN '医院/科室通用' THEN 2 WHEN '医院通用' THEN 3 ELSE 4 END, id DESC LIMIT 3`).all(did);
}

function createOpsContentCandidate(input){
  const did = resolveDoctorId(input);
  if(!did) throw new Error("医生不存在或缺少 doctorId/doctorSlug");
  const group = findGroup(did, input);
  if(!group) throw new Error("群配置不存在");
  if(group.status === "paused" || group.review_mode === "paused") throw new Error("群已暂停，不能生成运营内容");
  const items = readyKnowledgeForCandidate(did, input);
  if(!items.length) throw new Error("缺少已审核知识源：请先把 knowledge_items 标记为 ready，再生成候选内容");
  const { doctor } = doctorContent(did);
  const topic = cleanText(input && input.topic, 90) || cleanText(items[0].title, 90);
  const evidence = items.map(x=>({ id:x.id, title:x.title, layer:x.layer, source:x.source || "" }));
  const summary = cleanText(items.map(x=>x.body || "").join("\n").replace(/\s+/g, " "), 260);
  const doctorName = doctor && doctor.name ? doctor.name : "医生";
  const body = [
    `【候选科普】${topic}`,
    `依据素材：${items.map(x=>cleanText(x.title, 40)).join(" / ")}`,
    summary ? `摘要：${summary}` : "",
    `群内引导：这是${doctorName}医生团队准备的科普候选稿，适合群友先做基础了解。涉及个人病情、报告结论、用药和手术决策时，请转医生/医助确认。`,
    "审核提示：发布前请医学运营或医助核对素材依据、时间有效性和群内表达；确认后再发送。"
  ].filter(Boolean).join("\n");
  return enqueue({
    doctorId:did,
    group,
    targetName:group.name,
    text:body,
    payload:{
      eventType:"ops_content_candidate",
      topic,
      evidence,
      reviewerRequired:true,
      generatedAt:now(),
      source:"knowledge_items.ready",
      qiwe:{ toId: group.external_group_id || "" },
      ...(input && input.payloadExtra && typeof input.payloadExtra === "object" ? input.payloadExtra : {})
    },
    status:"pending",
    source: (input && input.outboxSource) || "ops_candidate",
    priority:"normal",
    username:input && input.username
  });
}

function weekIso(date){
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dayNum + 3);
  const isoYear = d.getUTCFullYear();
  const jan4 = new Date(Date.UTC(isoYear, 0, 4));
  const jan4DayNum = (jan4.getUTCDay() + 6) % 7;
  jan4.setUTCDate(jan4.getUTCDate() - jan4DayNum + 3);
  const week = 1 + Math.round((d.getTime() - jan4.getTime()) / (7 * 24 * 3600 * 1000));
  return `${isoYear}-W${String(week).padStart(2, "0")}`;
}

function runWeeklyAuto(nowDate, opts){
  opts = opts || {};
  const hourThreshold = Number(opts.hour != null ? opts.hour : (process.env.WEEKLY_OPS_HOUR || 9));
  const ms = (nowDate && typeof nowDate.getTime === "function" ? nowDate.getTime() : Date.now()) + 8 * 3600 * 1000;
  const bj = new Date(ms);
  const generated = [];
  if(bj.getUTCDay() !== 5) return generated;
  if(bj.getUTCHours() < hourThreshold) return generated;
  const weekKey = weekIso(bj);
  const rows = repo.listActiveGroupsForWeeklyAuto();
  for(const r of rows){
    if(r.lastWeek === weekKey) continue;
    const { content } = doctorContent(r.did);
    const topic = content && content.weeklyOps && cleanText(content.weeklyOps.defaultTopic, 90);
    if(!topic) continue;
    try{
      const row = createWeeklyCampaign({ doctorId:r.did, groupId:r.gid });
      repo.setWeeklyAutoLastWeek(r.gid, weekKey);
      generated.push({ groupId:r.gid, doctorId:r.did, outboxId:row.id, weekKey });
    }catch(e){
      console.error("[weekly-auto] 群", r.gid, "生成失败:", e && e.message);
    }
  }
  return generated;
}

module.exports = {
  createWeeklyCampaign,
  createOpsContentCandidate,
  generateAssistantDraftForOutbox,
  weekIso,
  runWeeklyAuto,
  outboxReviewContext
};
