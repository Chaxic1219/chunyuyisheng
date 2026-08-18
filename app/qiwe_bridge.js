/* QiWe 单聊桥：兼容入口。实现已拆到 modules/qiwe/{shared,media,cards,delivery,callback}。
   文本走患者回复链路；小程序卡片回调用来采集 /msg/sendWeapp 模板。 */
"use strict";

const qiweMod = require("./modules/qiwe");

module.exports = {
  activeDoctorId: qiweMod.activeDoctorId,
  prepareDelivery: qiweMod.prepareDelivery,
  deliverReplyToQiwe: qiweMod.deliverReplyToQiwe,
  deliverOutbox: qiweMod.deliverOutbox,
  processEvent: qiweMod.processEvent,
  handleCallbackBody: qiweMod.handleCallbackBody,
  replyAutoSendable: qiweMod.replyAutoSendable,
  agentReplyShouldAutoDeliver: qiweMod.agentReplyShouldAutoDeliver,
  markRoomMemberFirstSeen: qiweMod.markRoomMemberFirstSeen,
  buildGroupWelcomeText: qiweMod.buildGroupWelcomeText,
  buildMemberVisitText: qiweMod.buildMemberVisitText,
  fireGroupWelcome: qiweMod.fireGroupWelcome,
  resolvePosterAsset: qiweMod.resolvePosterAsset,
  resolvePosterAssetByCode: qiweMod.resolvePosterAssetByCode,
  hasPosterImageResponse: qiweMod.hasPosterImageResponse,
  textBeforeRichDelayMs: qiweMod.textBeforeRichDelayMs
};
