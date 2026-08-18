"use strict";

/**
 * 出站状态机与真发编排（归属 outbox 模块）。
 */
const wecom = require("../../wecom.js");
const qiwe = require("../../qiwe.js");
const repo = require("./repo.js");
const rules = require("./rules.js");

function qiweDelivery(){
  return require("../qiwe");
}

async function setOutboxStatus(id, status, username, options){
  const opts = options || {};
  const next = rules.normalizeStatus(status);
  const row = repo.getById(+id);
  if(!row) throw new Error("出站消息不存在");

  if(next !== "sent"){
    if(row.status !== "pending"){
      throw new Error(next === "pending" ? "已发送/已关闭的记录不可置回待发送" : "仅待发送草稿可忽略/取消");
    }
    repo.updateNonSent(+id, next, username);
    return rules.toPublic(repo.getById(+id));
  }

  if(row.status === "sent") return rules.toPublic(row);

  const preempt = ()=>{
    if(!repo.preemptSending(+id, username)){
      throw new Error("该草稿正在发送中或已发送，请勿重复操作");
    }
  };

  const cfg = wecom.loadConfig();
  const touser = repo.resolveTouser(row);
  const isWecom = (row.channel_type || "") === "wecom";
  if(isWecom && rules.canRealSendWecom(cfg) && touser){
    if((row.attempts || 0) >= rules.SEND_MAX_ATTEMPTS) throw new Error("发送失败次数已达上限，请人工核查后处理");
    preempt();
    try{
      const r = await wecom.sendAppText(cfg, touser, row.text || "");
      repo.markSentReal(+id, username, (r && r.msgid) ? String(r.msgid) : null);
      return rules.toPublic(repo.getById(+id));
    }catch(e){
      repo.rollbackSending(+id, username, (e && e.message) || "发送失败");
      throw new Error("企微发送失败：" + ((e && e.message) || ""));
    }
  }

  if((row.channel_type || "") === "qiwe"){
    const qcfg = qiwe.loadConfig();
    const qpayload = repo.parsePayload(row.payload) || {};
    if(!qpayload.qiwe || typeof qpayload.qiwe !== "object") qpayload.qiwe = {};
    let qtoId = String(qpayload.qiwe.toId || "").trim();
    // 兼容旧运营草稿（周五科普等曾漏写 toId）：从挂群 external_group_id 回填后再真发
    if(!qtoId){
      const fromGroup = repo.resolveGroupExternalId(row.group_id);
      if(fromGroup){
        qpayload.qiwe.toId = fromGroup;
        qtoId = fromGroup;
        row.payload = JSON.stringify(qpayload);
        try{ repo.updatePendingDraft(+id, row.text, qpayload, username); }catch(e){}
      }
    }
    if(qcfg.token && qcfg.guid && qtoId){
      if((row.attempts || 0) >= rules.SEND_MAX_ATTEMPTS) throw new Error("发送失败次数已达上限，请人工核查后处理");
      preempt();
      try{
        const r = await qiweDelivery().deliverOutbox(row, qcfg);
        if(!r || !r.sent) throw new Error("QiWe 投递未发出任何部分（weapp/文本/卡片全部失败），草稿保持待发送");
        repo.markSentReal(+id, username, (r && r.externalMsgId) ? String(r.externalMsgId) : null);
        return rules.toPublic(repo.getById(+id));
      }catch(e){
        repo.rollbackSending(+id, username, (e && e.message) || "发送失败");
        throw new Error("企微发送失败：" + ((e && e.message) || ""));
      }
    }
  }

  if(opts.requireRealSend) throw new Error(rules.realSendUnavailable(row));

  repo.markSentManual(+id, username);
  return rules.toPublic(repo.getById(+id));
}

function editOutboxText(id, text, username){
  const row = repo.getById(+id);
  if(!row) throw new Error("出站消息不存在");
  if(row.status !== "pending") throw new Error("仅待发送草稿可编辑");
  const next = rules.cleanText(text, 2400);
  if(!next) throw new Error("内容不能为空");
  repo.updateTextPending(+id, next, username);
  return rules.toPublic(repo.getById(+id));
}

function setOutboxAssignee(id, assignee, username){
  const row = repo.getById(+id);
  if(!row) throw new Error("出站消息不存在");
  if(row.status !== "pending") throw new Error("仅待发送草稿可转医生/撤回");
  const next = assignee === "doctor" ? "doctor" : null;
  repo.updateAssigneePending(+id, next, username);
  return rules.toPublic(repo.getById(+id));
}

function outboxForDecision(decisionId){
  const row = repo.findByDecision(decisionId);
  return row ? rules.toPublic(row) : null;
}

async function sendOutboxForDecision(decisionId, text, username){
  const d = repo.getTriageDecision(decisionId);
  if(!d) throw new Error("分诊决策不存在");
  if(d.status === "confirmed_sent") throw new Error("该回复已发送，请勿重复发送");
  if(d.session_status === "closed") throw new Error("会话已标记处理，无法再发送");

  const finalText = rules.cleanText(text || d.final_text || "", 2400);
  if(!finalText) throw new Error("发送内容不能为空");

  const row = repo.findByDecision(decisionId);
  if(!row){
    if(repo.findSendingByDecision(decisionId)) throw new Error("该回复正在发送中，请勿重复操作");
    throw new Error("没有找到这条分诊对应的真实出站队列，不能在 AI 分诊台确认发送；请到社群工作台处理，或重新从真实企微消息进入");
  }
  if(row.status === "sent"){
    if(row.sent_mode === "real"){
      return { ok:true, alreadySent:true, outbox:rules.toPublic(row) };
    }
    throw new Error("该队列是人工标记的已发送、未经真实通道投递，分诊台不能据此确认；如确已人工发出请在社群工作台保持记录并用『标记已处理』关闭分诊会话");
  }
  const edited = editOutboxText(row.id, finalText, username);
  const sent = await setOutboxStatus(row.id, "sent", username, { requireRealSend:true });
  return { ok:true, alreadySent:false, edited, outbox:sent };
}

module.exports = {
  setOutboxStatus,
  editOutboxText,
  setOutboxAssignee,
  outboxForDecision,
  sendOutboxForDecision
};
