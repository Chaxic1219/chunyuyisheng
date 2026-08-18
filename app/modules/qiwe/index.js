"use strict";

/**
 * 企微 / QiWe 投递门面。
 * community 出站真发经此调用 deliverOutbox；实现已拆到 modules/qiwe/{shared,media,cards,delivery,callback}。
 */
const shared = require("./shared");
const media = require("./media");
const cards = require("./cards");
const delivery = require("./delivery");
const callback = require("./callback");
const api = require("../../qiwe.js");

function deliverOutbox(row, cfg){
  return delivery.deliverOutbox(row, cfg);
}

function loadConfig(){
  return api.loadConfig();
}

function processEvent(evt, cfg){
  return callback.processEvent(evt, cfg);
}

module.exports = {
  deliverOutbox,
  loadConfig,
  processEvent,
  fireGroupWelcome(...args){ return callback.fireGroupWelcome(...args); },
  activeDoctorId(...args){ return shared.activeDoctorId(...args); },
  prepareDelivery: delivery.prepareDelivery,
  deliverReplyToQiwe: delivery.deliverReplyToQiwe,
  handleCallbackBody: callback.handleCallbackBody,
  replyAutoSendable: cards.replyAutoSendable,
  agentReplyShouldAutoDeliver: cards.agentReplyShouldAutoDeliver,
  markRoomMemberFirstSeen: callback.markRoomMemberFirstSeen,
  buildGroupWelcomeText: callback.buildGroupWelcomeText,
  buildMemberVisitText: callback.buildMemberVisitText,
  resolvePosterAsset: media.resolvePosterAsset,
  resolvePosterAssetByCode: media.resolvePosterAssetByCode,
  hasPosterImageResponse: media.hasPosterImageResponse,
  textBeforeRichDelayMs: shared.textBeforeRichDelayMs,
  // 便于按域引用
  shared, media, cards, delivery, callback
};
