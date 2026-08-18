"use strict";

/**
 * QiWe 入站归档（事实落库）；与 handleInbound 编排解耦，避免环依赖。
 */
const { db, resolvePatient } = require("../../db.js");
const engine = require("../../engine.js");
const { logInboundMessage } = require("../../message_log.js");
const service = require("./service.js");
const repo = require("./repo.js");
const rules = require("./rules.js");
const memberProfile = require("../qiwe/member_profile.js");

const MEDIA_CAPTION_ANCHORS = new Map();

function anchorKey(doctorId, groupId, memberId){
  return `${doctorId}:${groupId}:${memberId}`;
}

function getMediaAnchor(k){
  const a = MEDIA_CAPTION_ANCHORS.get(k);
  if(!a) return null;
  if(a.expiresAt <= Date.now()){
    MEDIA_CAPTION_ANCHORS.delete(k);
    return null;
  }
  return a;
}

function setMediaAnchor(k, imageMessageId, windowMs){
  const ttl = Number.isFinite(windowMs) ? Math.max(0, windowMs) : 180000;
  MEDIA_CAPTION_ANCHORS.set(k, { imageMessageId, expiresAt: Date.now() + ttl });
}

function findNearbyPeerMessages(opts){
  opts = opts || {};
  return repo.listNearbyPeerMessages(opts.doctorId, opts.memberId, opts.excludeMessageId, opts.windowSec);
}

function memberHasNearbyMedia(doctorId, senderId, roomId, windowSec){
  const did = +doctorId;
  const sid = String(senderId || "").trim();
  if(!did || !sid) return false;
  try{
    let member = null;
    if(roomId){
      const g = service.findQiweBusinessGroup(did, roomId);
      if(g && g.accepted && g.group){
        member = repo.findMemberIdByGroupUser(did, g.group.id, sid);
      }
    }
    if(!member) member = repo.findLatestMemberIdByUser(did, sid);
    if(!member) return false;
    const peers = findNearbyPeerMessages({ doctorId:did, memberId:member.id, windowSec:windowSec || 180 });
    return peers.images.length > 0;
  }catch(e){
    return false;
  }
}

function archiveQiweInbound(input){
  input = input || {};
  let did = Number(input.doctorId);
  const roomId = rules.cleanText(input.roomId || input.externalGroupId, 120);
  if(!roomId) return { accepted:false, reason:"invalid_event" };
  const hit = service.findQiweBusinessGroupByRoom(roomId);
  if(!hit.accepted) return { accepted:false, reason:hit.reason || "non_business_group" };
  const group = hit.group;
  did = +hit.primaryDoctorId || +group.doctor_id;
  if(!Number.isInteger(did) || did <= 0) return { accepted:false, reason:"missing_primary" };
  const externalMsgId = rules.cleanText(input.externalMsgId, 120);
  if(externalMsgId){
    const old = repo.getMessageByExternal(did, externalMsgId);
    if(old) return {
      accepted:true, deduped:true, group:rules.groupOut(group),
      message:rules.messageOut(old), groupRow:group, messageId:old.id
    };
  }
  const member = service.upsertMember(did, group.id, {
    externalUserId:input.senderId,
    senderName:input.senderName,
    dataSource:"qiwe"
  });
  // 入群/发言瞬间：先用跨群已知昵称头像回写，再异步拉企微联系人详情。
  try{ memberProfile.applyKnownProfile(did, member.external_user_id); }catch(e){}
  const refreshed = repo.getMemberByKey(did, group.id, member.external_user_id) || member;
  let patientId = null;
  const allowPatient = memberProfile.shouldCreatePatientArchive({
    userId: refreshed.external_user_id,
    displayName: refreshed.display_name || input.senderName,
    doctorId: did
  });
  if(allowPatient){
    try{
      patientId = resolvePatient({
        doctorId:did, channel:"qiwe", externalId:refreshed.external_user_id,
        groupId:group.id, displayName:refreshed.display_name
      });
      if(patientId) repo.setMemberPatientId(refreshed.id, patientId);
    }catch(e){}
    try{ memberProfile.scheduleEnrich(did, refreshed.external_user_id); }catch(e){}
  }
  const msgType = rules.cleanText(input.msgType || "text", 40);
  const body = rules.cleanText(input.text, 1000);
  const archived = repo.insertMessage({
    doctorId:did, groupId:group.id, memberId:refreshed.id, externalMsgId:externalMsgId || null,
    senderName:refreshed.display_name, senderRole:"patient", msgType, text:body,
    rawPayload:input.rawPayload || {}, processStatus:"received", dataSource:"qiwe"
  });
  const messageId = Number(archived.id);
  if(msgType === "event"){
    return {
      accepted:true, deduped:false, group:rules.groupOut(group), member:refreshed, patientId,
      message:rules.messageOut(repo.getMessageById(messageId)), groupRow:group, messageId
    };
  }
  const logText = body || `[${msgType || "非文字"}消息]`;
  const isMediaMsg = msgType === "image" || msgType === "media" || msgType === "file" || msgType === "video";
  const logOpts = {
    doctorId:did,
    patientId,
    patientName:refreshed.display_name,
    senderId:refreshed.external_user_id || String(refreshed.id),
    channel:"qiwe",
    groupId:roomId,
    text:logText,
    sourceMessageId:messageId,
    isKeywordRule:!!(body && engine.match(did, body))
  };
  if(isMediaMsg){
    logOpts.needsHuman = true;
    logOpts.riskLevel = "medium";
    logOpts.replyStatus = "pending";
    logOpts.actionTaken = "media_review";
  }
  const mKey = anchorKey(did, group.id, refreshed.id);
  try{
    if(isMediaMsg){
      setMediaAnchor(mKey, messageId, 180000);
      const peers = findNearbyPeerMessages({
        doctorId:did, memberId:refreshed.id, excludeMessageId:messageId, windowSec:180
      });
      if(peers.texts.length){
        const caption = peers.texts.map(t => rules.cleanText(t.text, 200)).filter(Boolean).join("；");
        if(caption){
          logOpts.text = (caption + " " + logText).slice(0, 1000);
          logOpts.needsHuman = true;
          logOpts.riskLevel = "medium";
          logOpts.replyStatus = "pending";
        }
        try{
          const txtIds = peers.texts.map(t => t.id).filter(Boolean).slice(0, 8);
          for(const tid of txtIds){
            db.prepare(`UPDATE message_log SET
              level=3, level_label='需医助',
              reply_status='pending',
              action_taken=COALESCE(NULLIF(action_taken,''),'media_caption_merge')
              WHERE doctor_id=? AND source_message_id=?`).run(did, tid);
          }
        }catch(e){}
      }
    }else if(body){
      const a = getMediaAnchor(mKey);
      if(a && a.imageMessageId){
        try{
          db.prepare(`UPDATE message_log SET text=CASE
            WHEN text IS NULL OR trim(text)='' OR text LIKE '[%消息]' THEN ?
            WHEN instr(text, ?) > 0 THEN text
            ELSE substr(text || '；' || ?, 1, 1000)
          END,
          level=3, level_label='需医助',
          reply_status='pending',
          action_taken=COALESCE(NULLIF(action_taken,''),'media_caption_merge')
          WHERE doctor_id=? AND source_message_id=?`).run(
            body, body, body, did, a.imageMessageId
          );
        }catch(e){}
        logOpts.needsHuman = true;
        logOpts.riskLevel = "medium";
        logOpts.replyStatus = "pending";
        logOpts.actionTaken = "media_caption_merge";
      }
    }
  }catch(e){}
  logInboundMessage(logOpts);
  return {
    accepted:true, deduped:false, group:rules.groupOut(group), member:refreshed, patientId,
    message:rules.messageOut(repo.getMessageById(messageId)), groupRow:group, messageId
  };
}

module.exports = {
  archiveQiweInbound,
  findNearbyPeerMessages,
  memberHasNearbyMedia,
  getMediaAnchor,
  setMediaAnchor,
  anchorKey
};
