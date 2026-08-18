"use strict";

/**
 * 社群群/成员领域服务（表归属本模块）。
 */
const { preferDisplayName } = require("../../db.js");
const repo = require("./repo.js");
const rules = require("./rules.js");

function doctorBundle(doctorId){
  const doctor = repo.getDoctorBrief(doctorId);
  if(!doctor) return null;
  return { doctor, content: rules.parseDoctorContent(doctor) };
}

function findQiweBusinessGroupByRoom(roomId){
  const rid = rules.cleanText(roomId, 120);
  if(!rid) return { accepted:false, reason:"invalid_event" };
  const group = repo.findByExternalGroupId(rid);
  if(!group) return { accepted:false, reason:"non_business_group" };
  const cgd = require("../../community_group_doctors.js");
  const primaryId = cgd.resolvePrimaryDoctorId(group.id) || group.doctor_id;
  if(group.is_business){
    return { accepted:true, group, primaryDoctorId:+primaryId };
  }
  const bizCount = repo.countBusinessForPrimary(primaryId);
  if(bizCount === 0 && !rules.isPlaceholderGroupId(group.external_group_id)){
    return { accepted:true, group, primaryDoctorId:+primaryId, legacyOpen:true };
  }
  return { accepted:false, reason:"non_business_group", group, primaryDoctorId:+primaryId };
}

function findQiweBusinessGroup(doctorId, roomId){
  return findQiweBusinessGroupByRoom(roomId);
}

function ensureDefaultGroup(doctorId){
  let g = repo.firstGroupByDoctor(doctorId);
  if(g) return g;
  const d = repo.getDoctorBrief(doctorId);
  if(!d) return null;
  const groupName = d.group_name || `${d.name}医生健康班`;
  g = repo.insertGroup({
    doctorId: d.id,
    channelType: "wechat",
    externalGroupId: `local-${d.id}`,
    name: groupName,
    owner: "医助运营",
    memberCount: d.member_count || 0,
    status: "pilot",
    welcomeEnabled: true,
    welcomeText: `欢迎加入${groupName}。这里由${d.name}医生团队和医助共同维护，可发送 1 查看群功能，紧急情况请直接线下就医或拨打 120。`,
    autoReplyEnabled: true,
    reviewMode: "human_review",
    notes: "本地默认社群配置。"
  });
  return g;
}

function suggestGroupName(doctorId){
  const did = +doctorId;
  if(!repo.doctorExists(did)) throw new Error("医生不存在");
  const bundle = doctorBundle(did);
  const pattern = rules.cleanText(bundle.content.groupNaming && bundle.content.groupNaming.pattern, 120)
    || rules.DEFAULT_GROUP_NAME_PATTERN;
  const seq = repo.countGroupsByDoctor(did) + 1;
  return {
    suggestedName: rules.buildGroupName(bundle.doctor, bundle.content, seq),
    pattern,
    roomBaseName: rules.buildGroupName(bundle.doctor, bundle.content, "")
  };
}

function createGroup(input){
  const did = +input.doctorId;
  if(!repo.doctorExists(did)) throw new Error("医生不存在");
  const channel = rules.CHANNEL_TYPES.has(input.channelType) ? input.channelType : "wechat";
  const reviewMode = rules.REVIEW_MODES.has(input.reviewMode) ? input.reviewMode : "human_review";
  const status = rules.GROUP_STATUS.has(input.status) ? input.status : "pilot";
  let name = rules.cleanText(input.name, 120);
  if(!name){
    const bundle = doctorBundle(did);
    const seq = repo.countGroupsByDoctor(did) + 1;
    name = rules.cleanText(rules.buildGroupName(bundle.doctor, bundle.content, seq), 120);
  }
  if(!name) throw new Error("群名称必填");
  let row = repo.insertGroup({
    doctorId: did,
    channelType: channel,
    externalGroupId: rules.cleanText(input.externalGroupId, 120) || null,
    name,
    owner: rules.cleanText(input.owner, 80),
    memberCount: rules.cleanInt(input.memberCount),
    status,
    welcomeEnabled: input.welcomeEnabled !== false,
    welcomeText: "",
    autoReplyEnabled: input.autoReplyEnabled !== false,
    reviewMode,
    qrcodeUrl: rules.cleanText(input.qrcodeUrl, 500),
    notes: rules.cleanText(input.notes, 1200)
  });
  row = repo.setManualDefaults(row.id);
  return rules.groupOut(row);
}

function findGroup(doctorId, input){
  const channel = rules.CHANNEL_TYPES.has(input.channelType) ? input.channelType : "wechat";
  const ext = rules.cleanText(input.externalGroupId, 120);
  if(input.groupId){
    const g = repo.getGroupByDoctorAndId(doctorId, input.groupId);
    if(g) return g;
  }
  if(ext){
    const g = repo.getGroupByDoctorChannelExt(doctorId, channel, ext);
    if(g) return g;
    return repo.insertGroup({
      doctorId: +doctorId,
      channelType: channel,
      externalGroupId: ext,
      name: rules.cleanText(input.groupName, 120) || "新接入社群",
      owner: "企微/微信回调",
      memberCount: 0,
      status: "pilot",
      welcomeEnabled: true,
      welcomeText: "欢迎入群。发送 1 查看群功能；紧急情况请直接线下就医或拨打 120。",
      autoReplyEnabled: true,
      reviewMode: "human_review",
      notes: "由入站回调自动创建。"
    });
  }
  return ensureDefaultGroup(doctorId);
}

function upsertMember(doctorId, groupId, input){
  const externalUserId = rules.cleanText(input.externalUserId, 120)
    || `local-${rules.cleanText(input.senderName || "群友", 40)}`;
  const incoming = rules.cleanText(input.senderName || input.displayName || "群友", 80);
  let m = repo.getMemberByKey(doctorId, groupId, externalUserId);
  if(m){
    const name = preferDisplayName(m.display_name, incoming);
    return repo.updateMemberActive(m.id, {
      displayName: name,
      dataSource: rules.cleanText(input.dataSource, 20) || m.data_source || "manual"
    });
  }
  const created = repo.insertMember({
    doctorId: +doctorId,
    groupId: +groupId,
    externalUserId,
    displayName: incoming,
    phone: rules.cleanText(input.phone, 20),
    tags: input.tags || [],
    dataSource: rules.cleanText(input.dataSource, 20) || "manual"
  });
  repo.bumpMemberCount(groupId);
  return created;
}

module.exports = {
  repo,
  rules,
  findQiweBusinessGroupByRoom,
  findQiweBusinessGroup,
  ensureDefaultGroup,
  suggestGroupName,
  createGroup,
  findGroup,
  upsertMember,
  groupOut: rules.groupOut,
  messageOut: rules.messageOut,
  buildGroupName: rules.buildGroupName,
  isPlaceholderGroupId: rules.isPlaceholderGroupId,
  REVIEW_MODES: rules.REVIEW_MODES,
  CHANNEL_TYPES: rules.CHANNEL_TYPES,
  GROUP_STATUS: rules.GROUP_STATUS,
  DEFAULT_GROUP_NAME_PATTERN: rules.DEFAULT_GROUP_NAME_PATTERN
};
