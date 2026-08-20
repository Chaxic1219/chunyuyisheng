"use strict";
/* QiWe 回调：processEvent / 欢迎入群 / handleCallbackBody */
const S = require("./shared");
const cards = require("./cards");
const media = require("./media");
const delivery = require("./delivery");
const feedVideoCapture = require("../outbound/feed-video.js");
const {
  db, qiwe, opsConfig, groupGate, triage,
  resolvePatient, isPlaceholderDisplayName, friendlyPatientLabel, patientArchiveLabel,
  logInboundMessage, buildPatientReply, responsesToQiweText, miniProgramResponses,
  outbox,
  now, patientLogName, resolveSenderDisplayName,
  seenDuplicate, activeDoctorId, currentQiweDoctorId, resolveDirectDoctorId, resolveEventDoctorId, idAllowed, idAllowedStrict,
  cleanText, publicGroupName, qiweScriptVars, configuredScript,
  atMemberIdSendable, realMentionName, ensureTextMention, stripTextMention
} = S;
const {
  replyCode, nativeWeappAllowedResponse, linkCards, weappRuleLinkUrls, weappSendConfirmed,
  replyAutoSendable, agentReplyShouldAutoDeliver,
  rememberPendingTemplateCode, takePendingTemplateCode, captureWeappTemplate,
  inferResponseCodes, archiveBusinessGroup,
  welcomeWeappPayload, welcomeVideoLinkCard
} = cards;
const { attachInboundImagePreview } = media;
const { prepareDelivery, deliverReplyToQiwe, joinWelcomeTextFromResponses } = delivery;

function replyPlainText(reply){
  const responses = reply && reply.responses;
  if(!Array.isArray(responses)) return "";
  const parts = responses.filter(r => r && r.type === "text").map(r => String(r.text || "").trim()).filter(Boolean);
  if(parts.length <= 1) return parts[0] || "";
  return parts.join("\n\n");
}

function patchLatestQiweDmOutbound(doctorId, senderId, sentText, draftText){
  if(!senderId) return;
  const out = String(sentText || draftText || "").trim().slice(0, 2400);
  if(!out) return;
  try{
    db.prepare(`UPDATE message_log SET reply_sent=COALESCE(NULLIF(trim(reply_sent),''), ?),
      ai_draft=COALESCE(NULLIF(trim(ai_draft),''), ?),
      reply_status=CASE WHEN reply_status='pending' THEN 'sent' ELSE reply_status END,
      action_taken=CASE WHEN action_taken IS NULL OR trim(action_taken)='' THEN 'auto_replied' ELSE action_taken END
      WHERE id=(
        SELECT id FROM message_log WHERE sender_id=? AND channel='qiwe' AND direction='inbound'
          AND (group_id IS NULL OR trim(group_id)='') ORDER BY id DESC LIMIT 1
      )`).run(out, out, String(senderId));
  }catch(e){ console.error("[qiwe] patchLatestQiweDmOutbound:", e && e.message); }
}

function weappCaptureSkip(evt, cfg){
  if(!cfg || !cfg.enabled) return "disabled";
  if(!cfg.token || !cfg.guid) return "not_configured";
  if(Number.isFinite(evt.cmd) && evt.cmd !== 15000) return "not_chat_message";
  if(evt.isGroup && !cfg.allowGroup) return "group_disabled";
  if(!cfg.selfUserId || evt.senderId !== cfg.selfUserId) return "not_self";
  return "";
}

function skipReason(evt, cfg){
  if(!cfg || !cfg.enabled) return "disabled";
  if(!cfg.token || !cfg.guid) return "not_configured";
  if(Number.isFinite(evt.cmd) && evt.cmd !== 15000) return "not_chat_message";
  if(evt.isGroup && !cfg.allowGroup) return "group_disabled";
  if(!evt.isText) return "unsupported_msg_type";
  if(!evt.text) return "empty_text";
  if(evt.isFromSelf) return "self_message";
  if(!idAllowed(evt, cfg)) return "outside_test_scope";
  // 群消息不要求 replyToId（用户可直接发关键词不回复任何人）；单聊仍要求
  if(!evt.isGroup && !evt.replyToId) return "missing_reply_to";
  const key = evt.externalMsgId;
  if(key){
    const cur = now();
    if(seenDuplicate(key, cur)) return "duplicate";
  }
  return "";
}

/* 语音转写前的信任闸 = skipReason 去掉 {isText, empty_text, dedup}：
   语音本就非 text、转写前无正文，且 dedup 留给转写成功后落进的 skipReason 跑一次（避免双重去重冲突）。
   只在 enabled/configured/cmd/group/self/scope/replyTo 都通过时才真调转写（省调用、不处理不可信语音）。 */
function voiceSkipReason(evt, cfg){
  if(!cfg || !cfg.enabled) return "disabled";
  if(!cfg.token || !cfg.guid) return "not_configured";
  if(Number.isFinite(evt.cmd) && evt.cmd !== 15000) return "not_chat_message";
  if(evt.isGroup && !cfg.allowGroup) return "group_disabled";
  if(evt.isFromSelf) return "self_message";
  if(!idAllowed(evt, cfg)) return "outside_test_scope";
  if(!evt.replyToId) return "missing_reply_to";
  return "";
}

/* 成员变更入群（msgType=2118/1005/1002）：与 voiceSkipReason 同口径，但不要求 isText、不拦 changedMemberId 本人。 */
function memberJoinSkipReason(evt, cfg){
  if(!cfg || !cfg.enabled) return "disabled";
  if(!cfg.token || !cfg.guid) return "not_configured";
  if(Number.isFinite(evt.cmd) && evt.cmd !== 15000) return "not_chat_message";
  if(evt.isGroup && !cfg.allowGroup) return "group_disabled";
  if(!idAllowed(evt, cfg)) return "outside_test_scope";
  if(!evt.fromRoomId) return "missing_reply_to";
  return "";
}

function isSelfJoinUser(joinUserId, cfg, evt){
  const uid = String(joinUserId || "").trim();
  if(!uid) return false;
  const selfId = String((cfg && cfg.selfUserId) || "").trim();
  const loggedId = String((evt && evt.loggedInUserId) || "").trim();
  return !!(uid && (uid === selfId || uid === loggedId));
}

/* ===== 新患者入群提醒 =====
   ① msgType=2118/1005/1002 + changedMemberId/List（真机样本 2026-07-15/17）
   ② 明确入群提示文本（「邀请某某加入群聊」「某某您好，欢迎加入…」） */

/* 入群提示去重登记：INSERT OR IGNORE 到 qiwe_room_member_seen；changes>0 = 本次提示未处理过。 */
function markRoomMemberFirstSeen(doctorId, roomId, senderId, senderName){
  const rid = String(roomId || "").trim();
  const sid = String(senderId || "").trim();
  if(!rid || !sid) return false;
  const sname = realMentionName(senderName);
  const syntheticId = sname ? ("join-name:" + sname) : "";
  if(syntheticId){
    const args = [doctorId || null, rid];
    if(sid !== syntheticId && db.prepare("SELECT 1 FROM qiwe_room_member_seen WHERE doctor_id IS ? AND room_id=? AND sender_id=?").get(args[0], args[1], syntheticId)) return false;
    if(sid === syntheticId && db.prepare("SELECT 1 FROM qiwe_room_member_seen WHERE doctor_id IS ? AND room_id=? AND sender_name=? AND sender_id<>?").get(args[0], args[1], sname, syntheticId)) return false;
  }
  const r = db.prepare("INSERT OR IGNORE INTO qiwe_room_member_seen(doctor_id,room_id,sender_id,sender_name,first_at) VALUES(?,?,?,?,?)")
    .run(doctorId || null, rid, sid, String(senderName || "").slice(0, 80), new Date().toISOString());
  return (r.changes || 0) > 0;
}


function buildGroupWelcomeText(doctorId, patientName, groupRow){
  const welcome = require("../../welcome.js");
  const groupName = groupRow && (groupRow.name || groupRow.groupName);
  const resolved = welcome.resolveWelcomeText({
    doctorId,
    patientName,
    groupName
  });
  const mentionName = realMentionName(patientName);
  // 入群欢迎属固定模板：@姓名 与正文之间用换行（与编号话术一致）；AI 自由回答仍用空格。
  return ensureTextMention(resolved.text, mentionName, { sep: "\n" });
}

/* 给医助的内部「新患者到访」提醒文案（仅供关注，绝不外发到任何人）。 */
function buildMemberVisitText(doctorId, patientName, senderId){
  if(arguments.length < 3){
    senderId = patientName;
    patientName = doctorId;
    doctorId = null;
  }
  let who = String(patientName || "").trim();
  if(!who || who === "企微患者") who = "新成员";
  const configured = configuredScript(doctorId, ["memberVisit","newPatientVisit","internalVisit"], qiweScriptVars(doctorId, who, { senderId }));
  if(configured) return configured;
  return `【新患者到访 · 仅供医助关注，无需发送】检测到${who}（${senderId || "未知ID"}）入群提示，系统已发送入群欢迎。建议医助关注后续消息，必要时确认身份、备注为「姓名+疾病」，并主动引导 101 咨询/201 挂号等入口。`;
}

/* 入群提示触发：① 欢迎（autoSend ON→qiwe.sendText 自动真发到群，DRY_RUN 不真发；autoSend OFF 或发送失败→落 pending 由医助确认发）；
   ② 医助内部「新患者到访」提醒行——故意不带 payload.qiwe.toId → setOutboxStatus qiwe 分支 qtoId 空守门失败 → 落 V1 兜底仅标 sent，
      **绝不真发到任何人**（deliverOutbox 亦会因缺 toId 抛错），status=pending 仅为在审核台/侧边栏可见「待关注」。
   注：allowGroup + idAllowed 已由调用点前的 skipReason 把过；这里只按 cfg.autoSend 决定欢迎是否自动发。 */
async function fireGroupWelcome(evt, cfg, doctorId){
  const toId = evt.fromRoomId;
  const name = evt.senderName || "";
  let groupRow = null;
  try{
    const community = require("../community");
    const hit = community.findQiweBusinessGroupByRoom
      ? community.findQiweBusinessGroupByRoom(toId)
      : (community.findQiweBusinessGroup ? community.findQiweBusinessGroup(doctorId, toId) : null);
    if(hit && hit.accepted) groupRow = hit.group;
  }catch(e){ groupRow = null; }
  if(!groupRow){
    // 只读兜底：查找失败时不阻断欢迎落库（不写 community 表）
    try{
      groupRow = db.prepare("SELECT * FROM community_groups WHERE doctor_id=? AND external_group_id=? ORDER BY id LIMIT 1").get(+doctorId, String(toId || ""));
    }catch(e){ groupRow = null; }
  }
  // 群级欢迎开关：未启用则不外发欢迎（仍可写内部到访提醒）
  const welcomeEnabled = !groupRow || groupRow.welcome_enabled == null || Number(groupRow.welcome_enabled) !== 0;
  const outbound = require("../outbound/resolve.js");
  const joinHit = welcomeEnabled ? outbound.matchJoin(doctorId) : null;

  let welcomeText = "";
  let welcomeWeappCodes = [];
  let welcomeLinkCards = [];
  if(welcomeEnabled && joinHit && Array.isArray(joinHit.responses) && joinHit.responses.length){
    // 已迁移：join 编排决定文案 / weapp / linkCards，禁止再写死 979/808 或拼 welcomeVideo。
    const firstMp = joinHit.responses.find(r =>
      r && (r.type === "mp" || r.type === "mini_program") && (r.weappCode || r.templateCode)
    );
    const reply = {
      code: firstMp ? String(firstMp.weappCode || firstMp.templateCode) : "welcome",
      responses: joinHit.responses,
      source: "outbound"
    };
    const plan = prepareDelivery(doctorId, reply, name, { isGroup: true });
    const body = String(joinWelcomeTextFromResponses(joinHit.responses, name) || plan.replyText || "").trim();
    const mentionName = realMentionName(name);
    if(body){
      welcomeText = ensureTextMention(body, mentionName, { sep: "\n" });
    }else if(mentionName){
      // 仅卡无文案时仍要落 outbox：@姓名即可（ensureTextMention 对空 body 不补 @）
      welcomeText = "@" + mentionName;
    }else{
      welcomeText = "\u200b";
    }
    welcomeWeappCodes = cards.filterSendableWeappCodes(doctorId, welcomeWeappCodes);
    if(!welcomeWeappCodes.length){
      welcomeWeappCodes = cards.filterSendableWeappCodes(
        doctorId,
        cards.resolveMultiWeappCodes(doctorId, cards.nativeWeappResponses(reply))
      );
    }
    welcomeLinkCards = Array.isArray(plan.linkCards) ? plan.linkCards.slice() : [];
  }else if(welcomeEnabled){
    // 未迁移兜底：运营欢迎文案 + 写死 weapp / welcomeVideo 链接卡
    welcomeText = buildGroupWelcomeText(doctorId, name, groupRow);
    const videoCard = welcomeVideoLinkCard(doctorId);
    welcomeWeappCodes = cards.filterSendableWeappCodes(
      doctorId,
      videoCard ? ["979"] : welcomeWeappPayload()
    );
    welcomeLinkCards = videoCard ? [videoCard] : [];
  }

  const hasWelcomeContent = !!(welcomeText || welcomeWeappCodes.length || welcomeLinkCards.length);
  const wantAuto = !!cfg.autoSend && hasWelcomeContent;
  const atUserId = evt.senderId || "";
  const atMember = atMemberIdSendable(atUserId);
  let sent = false, sendError = "", sentMode = "";
  let welcomeCards = { sentCards:[], cardErrors:[] };
  let welcomeOutboxId = null;
  if(hasWelcomeContent){
    // 安全口径（P1）：始终先 pending 入队，再经 outbox.setOutboxStatus 真发。
    // 禁止「先 send* 再 insert status=sent」——避免假 sent、绕过 preempt/防重，失败时草稿可重试，不丢可追溯记录。
    const queueText = (wantAuto && atMember) ? stripTextMention(welcomeText, name) : welcomeText;
    const welcomePayload = {
      qiwe:{
        toId,
        atUserId,
        weappCodes: welcomeWeappCodes,
        linkCards: welcomeLinkCards,
        forceAtMember: !!atMember
      },
      source:"welcome",
      memberVisit:true
    };
    welcomeOutboxId = outbox().insert({
      doctorId,
      groupId: groupRow && groupRow.id || null,
      messageId: null,
      targetType: "qiwe_room",
      targetName: String(toId || ""),
      channelType: "qiwe",
      text: queueText,
      payload: welcomePayload,
      status: "pending",
      source: "welcome",
      priority: "normal",
      dataSource: "manual"
    }, { via: "qiwe_welcome" });

    if(wantAuto){
      try{
        await outbox().setOutboxStatus(welcomeOutboxId, "sent", "system", { requireRealSend:true });
        sent = true;
        sentMode = "outbox_state_machine";
        const row = outbox().getById(welcomeOutboxId);
        let payload = {};
        try{ payload = row && row.payload ? JSON.parse(row.payload) : {}; }catch(e){ payload = {}; }
        if(Array.isArray(payload.sentCards)) welcomeCards.sentCards = payload.sentCards;
        if(Array.isArray(payload.cardErrors)) welcomeCards.cardErrors = payload.cardErrors;
      }catch(e){
        sent = false;
        sendError = (e && e.message) || "发送失败";
        // 行保持 pending，可供医助确认重发；不删除、不改写成假 sent
      }
    }
    if(sentMode || sendError || welcomeCards.sentCards.length || welcomeCards.cardErrors.length){
      try{
        const row = outbox().getById(welcomeOutboxId);
        if(row && row.status === "pending"){
          const patch = Object.assign({}, welcomePayload);
          if(sentMode) patch.sentMode = sentMode;
          if(sendError) patch.sendError = sendError;
          if(welcomeCards.cardErrors.length) patch.cardErrors = welcomeCards.cardErrors;
          outbox().updatePendingDraft(welcomeOutboxId, { text:queueText, payload:patch }, "system");
        }
      }catch(e){}
    }
  }
  // 医助到访提醒：payload 顶层放线索但**不放 qiwe.toId** → 不可外发（三重护栏：无 toId + 落 V1 兜底 + deliverOutbox 缺 toId 抛错）。
  const visitText = buildMemberVisitText(doctorId, name, evt.senderId);
  const visitOutboxId = outbox().insert({
    doctorId,
    groupId: groupRow && groupRow.id || null,
    messageId: null,
    targetType: "qiwe_room",
    targetName: String(toId || ""),
    channelType: "qiwe",
    text: visitText,
    payload: { source:"member_visit", roomId:toId || "", senderId:evt.senderId || "", senderName:name },
    status: "pending",
    source: "member_visit",
    priority: "normal",
    dataSource: "manual"
  }, { via: "qiwe_member_visit" });
  return { welcomeOutboxId, visitOutboxId, welcomeSent:sent, welcomeSkipped:!hasWelcomeContent, sentCards:welcomeCards.sentCards, cardErrors:welcomeCards.cardErrors, sendError };
}

function extractJoinMemberName(evt){
  const rawText = cleanText(evt && evt.text, 1000);
  if(!rawText) return "";
  // 企微常见格式：你邀请"C"加入了群聊（引号为 \u201c\u201d 或 "" 或 「」）
  // 先尝试从引号内直接提取姓名，避免字符类误排中文弯引号。
  const quotedPatterns = [
    /邀请了?[\u201c\u201d"「]([^"\u201c\u201d「」]{1,40})[\u201c\u201d"」]加入(?:了)?(?:外部)?群聊/,
    /[\u201c\u201d"「]([^"\u201c\u201d「」]{1,40})[\u201c\u201d"」]通过扫描.*?二维码加入(?:了)?(?:外部)?群聊/,
  ];
  for(const re of quotedPatterns){
    const m = rawText.match(re);
    const name = realMentionName(m && m[1]);
    if(name && !/^(?:你|您|我|大家|各位|群友|新朋友)$/.test(name)) return name;
  }
  // 去掉中文弯引号后再跑通用正则（兼容无引号、直引号等格式）
  const text = rawText.replace(/[\u201c\u201d]/g, "");
  const patterns = [
    /邀请(?:了)?(?:微信的|企业微信的|微信用户|外部联系人)?([^，,。\s「」"]{1,40})加入(?:了)?(?:外部)?群聊/,
    /(?:你|您|我|管理员|群主)?邀请了?([^，,。\s「」"]{1,40})加入(?:了)?(?:外部)?群聊/,
    /([^，,。\s「」"]{1,40})通过扫描.*?二维码加入(?:了)?(?:外部)?群聊/,
    /(?:^|[\n\r\s])(?:@)?([^，,。\s「」"]{1,40})\s*您好[，,、\s]*欢迎加入/,
    /欢迎\s*@([^，,。\s「」"]{1,40})\s*加入/,
    /欢迎\s*([^，,。\s「」"]{1,40})\s*加入(?:了)?(?:本|本群|群聊|外部群聊)/
  ];
  for(const re of patterns){
    const m = text.match(re);
    const raw = m && m[1];
    const name = realMentionName(raw && raw.replace(/^[\u201c\u201d"「」]+|[\u201c\u201d"「」]+$/g, ""));
    if(name && !/^(?:你|您|我|大家|各位|群友|新朋友)$/.test(name)) return name;
  }
  return "";
}

function joinMemberId(evt, memberName){
  const raw = (evt && evt.raw) || {};
  const msgData = (evt && evt.msgData) || {};
  const id = cleanText((evt && evt.joinUserId) || ((evt && evt.joinUserIds) || [])[0] || msgData.changedMemberId || raw.joinUserId || raw.newUserId || raw.memberId || raw.joinMemberId || raw.externalUserId || raw.external_userid || "", 120);
  return id || ("join-name:" + realMentionName(memberName));
}

async function processMemberJoinEvent(evt, cfg, doctorId){
  const joinUids = Array.isArray(evt.joinUserIds) ? evt.joinUserIds.map(x=>String(x || "").trim()).filter(Boolean) : [];
  const joinUid = String(evt.joinUserId || joinUids[0] || "").trim();
  if(!joinUid) return { ok:true, skipped:"member_join_missing_user" };
  const uniqueJoinUids = (joinUids.length ? joinUids : [joinUid]).filter((x, i, arr)=>arr.indexOf(x) === i);
  const hasSelfJoin = uniqueJoinUids.some(uid => isSelfJoinUser(uid, cfg, evt));
  if(hasSelfJoin){
    const nextCfg = qiwe.ensureRoomInTestToId(evt.fromRoomId, cfg);
    if(uniqueJoinUids.every(uid => isSelfJoinUser(uid, cfg, evt))){
      return { ok:true, skipped:"self_join_room_whitelist", roomId:evt.fromRoomId, testToId:nextCfg.testToId || "", joinUserId:uniqueJoinUids[0], joinUserIds:uniqueJoinUids };
    }
    cfg = nextCfg;
  }
  const jskip = memberJoinSkipReason(evt, cfg);
  if(jskip) return { ok:true, skipped:jskip, memberJoin:true, joinUserId:joinUid, joinUserIds:joinUids.length ? joinUids : [joinUid] };
  const dkey = evt.externalMsgId;
  if(dkey && seenDuplicate(dkey, now())) return { ok:true, skipped:"duplicate", memberJoin:true, joinUserId:joinUid, joinUserIds:joinUids.length ? joinUids : [joinUid] };
  if(!doctorId) return { ok:false, error:"doctor_not_found" };

  const welcomes = [];
  const joinNames = [];
  const memberProfile = require("./member_profile.js");
  for(const uid of uniqueJoinUids){
    if(isSelfJoinUser(uid, cfg, evt)){
      qiwe.ensureRoomInTestToId(evt.fromRoomId, cfg);
      continue;
    }
    // 入群立刻抓取微信名+头像（失败则回落跨群已知名 / 占位）
    let joinName = "";
    try{
      const enriched = await memberProfile.enrichContactProfile(doctorId, uid, { cfg });
      joinName = String((enriched && enriched.displayName) || "").trim();
    }catch(e){
      try{ memberProfile.applyKnownProfile(doctorId, uid); }catch(_){}
      joinName = "";
    }
    if(!joinName){
      joinName = resolveSenderDisplayName(doctorId, uid, "");
    }
    // 运营/托管号：仍归档群成员事实，但不建患者档、不发入群欢迎
    if(memberProfile.isInternalQiweAccount({ userId:uid, displayName:joinName, cfg, doctorId })){
      const joinEvt = Object.assign({}, evt, { senderName:joinName, senderId:uid, joinUserId:uid, text:"", isText:false });
      try{ archiveBusinessGroup(joinEvt, doctorId); }catch(e){}
      joinNames.push(joinName);
      welcomes.push({ joinUserId:uid, memberName:joinName, welcome:null, skipped:"internal_account" });
      continue;
    }
    const joinEvt = Object.assign({}, evt, { senderName:joinName, senderId:uid, joinUserId:uid, text:"", isText:false });
    const communityRecord = archiveBusinessGroup(joinEvt, doctorId);
    if(communityRecord && !communityRecord.accepted){
      return { ok:true, skipped:communityRecord.reason || "non_business_group", memberJoin:true, joinUserId:uid, joinUserIds:uniqueJoinUids };
    }
    let welcome = null;
    try{
      if(markRoomMemberFirstSeen(doctorId, joinEvt.fromRoomId, joinEvt.senderId, joinEvt.senderName)){
        welcome = await fireGroupWelcome(joinEvt, cfg, doctorId);
      }
    }catch(e){
      welcome = { error:(e && e.message) || "welcome_failed" };
    }
    joinNames.push(joinName);
    welcomes.push({ joinUserId:uid, memberName:joinName, welcome });
  }
  const processed = welcomes.some(item => item.welcome && item.welcome.welcomeOutboxId);
  return {
    ok:true,
    skipped:processed ? "member_join_event_processed" : "member_join_event_duplicate",
    memberName:joinNames[0] || "",
    joinUserId:joinUid,
    joinUserIds:uniqueJoinUids,
    welcome:welcomes[0] ? welcomes[0].welcome : null,
    welcomes
  };
}

async function processEvent(raw, cfg){
  cfg = cfg || qiwe.loadConfig();
  const evt = qiwe.normalizeEvent(raw, cfg);
  let doctorId = evt.isGroup || evt.fromRoomId ? resolveEventDoctorId(evt, cfg) : resolveDirectDoctorId(evt, cfg);
  if(!doctorId && !(evt.isGroup || evt.fromRoomId)) return { ok:true, skipped:"doctor_not_found_for_qiwe_dm" };
  if(doctorId) qiwe.syncWeappTemplatesFromRules(doctorId);
  if(evt.isGroup && evt.isRoomNotice){
    let roomNameSync = null;
    try{
      roomNameSync = await require("../../qiwe_sync.js").syncRoomName({ roomId:evt.fromRoomId, cfg });
    }catch(e){
      console.warn("[qiwe] sync room name:", e && e.message);
    }
    if(!evt.isMemberJoin) return { ok:true, skipped:"room_name_notice_processed", roomNameSync };
  }
  // 群内语音（msgType=16/cmd=15000）：先过信任闸 → 转写 → 当普通文本喂进后续 engine→triage 管线
  // （风险仍本地判、非 low 仍转人工、患者侧仍 service-only；语音只是把音变字）。转写失败/空 → pending 转人工草稿。
  let communityRecord = null;
  if(evt.cmd === 15000 && evt.msgType === 16){
    const vskip = voiceSkipReason(evt, cfg);
    if(vskip) return { ok:true, skipped:vskip, event:{ senderId:evt.senderId, receiverId:evt.receiverId, msgType:evt.msgType, isGroup:evt.isGroup } };
    if(!doctorId) return { ok:false, error:"doctor_not_found" };
    const msgServerId = String((evt.raw && evt.raw.msgServerId) || evt.externalMsgId || "").trim();
    let transcript = "";
    try{ transcript = String(await qiwe.voiceToText(msgServerId, cfg) || "").trim(); }catch(e){ transcript = ""; }
    if(!transcript){
      communityRecord = archiveBusinessGroup(evt, doctorId);
      if(communityRecord && !communityRecord.accepted) return { ok:true, skipped:communityRecord.reason || "non_business_group" };
      // 修2：失败/空分支自补去重（成功路径仍由下方 skipReason 登记一次，这里只管失败/空，避免双重登记）。
      // 同一 msgServerId/msgUniqueIdentifier 重放 → 已见过则直接 return，不重复插 qiwe_voice 草稿。
      const dkey = evt.externalMsgId;
      if(dkey){
        const cur = now();
        if(seenDuplicate(dkey, cur)) return { ok:true, skipped:"duplicate", voiceFailed:true, event:{ senderId:evt.senderId, receiverId:evt.receiverId, msgType:evt.msgType, isGroup:evt.isGroup } };
      }
      // 转写失败/空：绝不喂空/猜测进 triage、绝不自动答 → 入 pending「转人工」草稿（患者侧文案为服务性安抚，不含医学内容）。
      const isGroup = !!evt.isGroup;
      const toId = evt.replyToId;
      const vars = qiweScriptVars(doctorId, evt.senderName, { senderId:evt.senderId, roomId:evt.fromRoomId || "" });
      const text = configuredScript(doctorId, ["voice","voiceFailed","voiceFallback"], vars)
        || "不好意思，您的语音我这边暂时没能听清/稳定识别。为了不漏掉您的情况，麻烦您用文字简单补充一下；如果不方便打字，我也会帮您转医助人工查看。";
      const outboxId = outbox().insert({
        doctorId,
        groupId: null,
        messageId: null,
        targetType: isGroup ? "qiwe_room" : "qiwe_dm",
        targetName: String(toId || ""),
        channelType: "qiwe",
        text,
        payload: { qiwe:{ toId, atUserId:isGroup ? (evt.senderId || "") : "", voiceFailed:true }, source:"qiwe_voice" },
        status: "pending",
        source: "qiwe_voice",
        priority: "high",
        dataSource: "manual"
      }, { via: "qiwe_voice" });
      return { ok:true, sent:false, reviewOnly:true, voiceFailed:true, outboxId, toId, skipped:"voice_transcribe_failed" };
    }
    // 转写成功：就地改成"文本事件"，落进下面 ④⑤⑥⑦ 全链（skipReason 此时 isText 通过、dedup 跑一次、buildPatientReply 吃转写文本）。
    evt.text = transcript;
    evt.isText = true;
    evt.isVoice = true;
  }
  // 成员变更入群（msgType=2118/1005/1002）：托管号本人入群→自动补 testToId；患者入群→欢迎语（不依赖文本系统提示）。
  if(evt.isMemberJoin){
    return processMemberJoinEvent(evt, cfg, doctorId);
  }
  // 信任/范围闸先行（H2）：未启用/未配置/非聊天cmd/群未放开/不在测试白名单 → 既不采集卡片、也不记 pending code（防投毒）。
  const captureSkip = weappCaptureSkip(evt, cfg);
  if(evt.isFeedVideo){
    if(captureSkip) return { ok:true, skipped:captureSkip, event:{ senderId:evt.senderId, receiverId:evt.receiverId, msgType:evt.msgType, isGroup:evt.isGroup } };
    const captured = feedVideoCapture.consumeCapture(doctorId, evt.raw);
    return {
      ok:true,
      skipped:captured.captured ? "feed_video_template_saved" : captured.reason,
      doctorId,
      ready:!!captured.ready,
      missing:captured.missing || []
    };
  }
  if(evt.isWeapp){
    if(captureSkip) return { ok:true, skipped:captureSkip, event:{ senderId:evt.senderId, receiverId:evt.receiverId, msgType:evt.msgType, isGroup:evt.isGroup } };
    return captureWeappTemplate(evt, cfg);
  }
  // 非文字/非语音/非卡片聊天消息（图片/文件/视频/位置等）：
  // 图片（msgType 14/101）会尽力换可访问预览地址并落地本地副本，供分诊台出图；仍落 pending 转人工、绝不自动发。
  // 安全闸复用 voiceSkipReason；再加 dedup。放在 skipReason 之前判定
  // （skipReason 无差别 !isText→unsupported_msg_type 会抢先吞掉）。
  // 故意不 markRoomMemberFirstSeen：非文字消息只落转人工草稿；入群欢迎必须来自明确入群提示，不能用首条消息近似。
  if(!evt.isText && !evt.isVoice && !evt.isWeapp){
    const nskip = voiceSkipReason(evt, cfg);
    if(nskip) return { ok:true, skipped:nskip, event:{ senderId:evt.senderId, receiverId:evt.receiverId, msgType:evt.msgType, isGroup:evt.isGroup } };
    // 转人工 pending 路径用严格白名单（比 text/voice 的 idAllowed 更紧，codex 红线复核收口）：idAllowed 的 DM 分支含 loggedInUserId，
    // 它在 raw.userId 缺失时回落成 selfUserId（qiwe.js normalizeEvent），「省略 userId、sender/receiver 均不在白名单」的越界伪造消息
    // 借 selfUserId∈testToId 过 idAllowed → 会漏进转人工队列。此处用 idAllowedStrict（去掉该自回落），越界伪造 → outside_test_scope、不落草稿。
    if(!idAllowedStrict(evt, cfg)) return { ok:true, skipped:"outside_test_scope", nonText:true, event:{ senderId:evt.senderId, receiverId:evt.receiverId, msgType:evt.msgType, isGroup:evt.isGroup } };
    if(!doctorId) return { ok:false, error:"doctor_not_found" };
    // 图片预览：归档前尽量写入 localPreviewUrl / cloudUrl（失败不阻断）。
    if(evt.isImage || qiwe.isImageMsgType(evt.msgType) || qiwe.extractImageHttpUrls(evt.msgData || {}).length){
      try{ await attachInboundImagePreview(evt, cfg); }catch(e){ console.warn("[qiwe] attachInboundImagePreview：", e && e.message); }
    }
    communityRecord = archiveBusinessGroup(evt, doctorId);
    if(communityRecord && !communityRecord.accepted) return { ok:true, skipped:communityRecord.reason || "non_business_group" };
    // dedup：同一非文字消息重放 → 已见过直接跳过，不重复落草稿（与语音失败分支同口径）。
    const dkey = evt.externalMsgId;
    if(dkey && seenDuplicate(dkey, now())) return { ok:true, skipped:"duplicate", nonText:true, event:{ senderId:evt.senderId, receiverId:evt.receiverId, msgType:evt.msgType, isGroup:evt.isGroup } };
    // 落 pending 转人工草稿（复用语音失败那套 INSERT）：患者侧纯服务话术、零医学内容（诊断/病情/用药/症状/检查报告 一个都不带）；
    // source=qiwe_media、priority=high、needsHuman；永远 pending、绝不进 deliverReplyToQiwe/replyAutoSendable → 结构上不可能自动发。
    const isGroup = !!evt.isGroup;
    const toId = evt.replyToId;
    const vars = qiweScriptVars(doctorId, evt.senderName, { senderId:evt.senderId, roomId:evt.fromRoomId || "" });
    const text = configuredScript(doctorId, ["nonText","media","mediaFallback","imageFallback","fileFallback"], vars)
      || "您发来的图片/资料我已经收到。图片内容需要医助人工查看，我会帮您转给医助跟进；如果方便，也请补充一句文字说明您最想咨询的问题，这样处理会更快。";
    const materialReview = triage.materialReviewSummary({ msgType:evt.msgType, name:evt.msgTypeName || "", mime:"" });
    const previewUrls = [];
    try{
      const md = (evt.raw && evt.raw.msgData) || {};
      if(md.localPreviewUrl) previewUrls.push(md.localPreviewUrl);
      for(const u of (md._remotePreviewUrls || [])){ if(u && !previewUrls.includes(u)) previewUrls.push(u); }
    }catch(e){}
    const outboxId = outbox().insert({
      doctorId,
      groupId: null,
      messageId: null,
      targetType: isGroup ? "qiwe_room" : "qiwe_dm",
      targetName: String(toId || ""),
      channelType: "qiwe",
      text,
      payload: {
        qiwe:{ toId, atUserId:isGroup ? (evt.senderId || "") : "", nonText:true, needsHuman:true },
        source:"qiwe_media",
        materialReview,
        mediaPreview:{ urls:previewUrls.slice(0, 4) }
      },
      status: "pending",
      source: "qiwe_media",
      priority: "high",
      dataSource: "manual"
    }, { via: "qiwe_media" });
    return { ok:true, sent:false, reviewOnly:true, nonText:true, needsHuman:true, outboxId, toId, skipped:"nontext_handoff", mediaPreview:previewUrls.slice(0, 4) };
  }
  // 文本路径：仅在过信任闸后才记 pending code（医助"先发码再转卡片"的学习铺垫，防被伪造事件污染）。
  if(!captureSkip) rememberPendingTemplateCode(evt, cfg, doctorId);
  const skip = skipReason(evt, cfg);
  if(skip) return { ok:true, skipped:skip, event:{ senderId:evt.senderId, receiverId:evt.receiverId, msgType:evt.msgType, isGroup:evt.isGroup } };

  if(!doctorId) return { ok:false, error:"doctor_not_found" };

  communityRecord = archiveBusinessGroup(evt, doctorId);
  if(communityRecord && !communityRecord.accepted){
    console.warn("[qiwe] 业务群门禁拦截（将不回复）：", communityRecord.reason || "non_business_group",
      "room=", evt.fromRoomId, "doctor=", doctorId);
    return { ok:true, skipped:communityRecord.reason || "non_business_group",
      event:{ senderId:evt.senderId, receiverId:evt.receiverId, msgType:evt.msgType, isGroup:true } };
  }
  if(evt.isGroup && communityRecord && communityRecord.accepted){
    console.log("[qiwe] 业务群已归档 messageId=", communityRecord.messageId,
      "groupId=", communityRecord.groupRow && communityRecord.groupRow.id, "textLen=", String(evt.text||"").length);
  }

  // 真实群里常见形态：企微/小助手会先发「某某您好，欢迎加入...」或系统文案「邀请某某加入群聊」。
  // 这类消息不是患者提问，不能把小助手当患者去命中 101/联络表；识别到新人姓名后，仅触发入群欢迎并停止患者回复链路。
  const joinedName = evt.isGroup ? extractJoinMemberName(evt) : "";
  if(joinedName){
    const joinEvt = Object.assign({}, evt, { senderName:joinedName, senderId:joinMemberId(evt, joinedName) });
    let welcome = null;
    try{
      if(markRoomMemberFirstSeen(doctorId, joinEvt.fromRoomId, joinEvt.senderId, joinEvt.senderName)){
        welcome = await fireGroupWelcome(joinEvt, cfg, doctorId);
      }
    }catch(e){
      welcome = { error:(e && e.message) || "welcome_failed" };
    }
    return { ok:true, skipped:welcome && welcome.welcomeOutboxId ? "member_join_hint_processed" : "member_join_hint_duplicate", memberName:joinedName, welcome };
  }

  // 群风控 Phase A1 报警接线（2026-07-09，旁路 best-effort）：所有真实群文本先过 scanModeration 落 moderation_flag 给医助看板。
  // 必须在下方 group_gate 之前——广告/引流/赌博刷群消息通常不 @ 助手，会被 gate 判 chitchat 静默返回，放 gate 之后=最该抓的全漏。
  // 只发现、只标记，不处置：recordGroupModeration 不写 risk_level、不调 triage、不入 outbound_queue（与医疗分诊三档完全隔离）；
  // 失败只记日志，绝不中断/改变下方回复主流程。入群系统提示已在上方早退，不会被当患者刷群扫描；DM 单聊不扫（群边界职责）。
  // 经 modules/community 门面（Phase 2 解环）；懒加载，无顶层环。
  // channelType 传 "wecom"：community_groups 对企微真实群的既有映射约定=wecom（见 db.js「吕富靖真实企微群映射」注释，
  // community.js CHANNEL_TYPES 无 qiwe 会把它回落 wechat）——保证报警行挂到侧边栏/看板同一群行，不裂群。
  if(evt.isGroup && evt.text){
    try{
      const modHit = require("../community").recordGroupModeration({
        doctorId,
        channelType:"wecom",
        externalGroupId:evt.fromRoomId,
        externalMsgId:evt.externalMsgId,
        senderName:evt.senderName || "企微患者",
        senderId:evt.senderId || "",
        text:evt.text
      });
      // 刷群广告/诋毁等：只报警给医助看板，不跟帖回复（避免和广告员互动）；skip 口径与闲聊静默对齐便于运营观测。
      if(modHit && modHit.flagged){
        let patientId = null;
        const silentDisplay = resolveSenderDisplayName(doctorId, evt.senderId || "", evt.senderName);
        try{
          patientId = resolvePatient({ doctorId, channel:"qiwe", externalId:evt.senderId || "", displayName:silentDisplay });
        }catch(e){}
        logInboundMessage({
          doctorId,
          patientId,
          patientName: patientLogName(doctorId, patientId, silentDisplay, evt.senderId || null, { isGroup:true }),
          senderId: evt.senderId || null,
          channel: "qiwe",
          groupId: evt.fromRoomId || null,
          text: evt.text || "",
          sourceMessageId: communityRecord && communityRecord.messageId,
          isSilent: true
        });
        return { ok:true, skipped:"group_chitchat", moderation:modHit,
          event:{ senderId:evt.senderId, receiverId:evt.receiverId, msgType:evt.msgType, isGroup:evt.isGroup } };
      }
    }catch(e){ console.error("[qiwe] recordGroupModeration 失败（不影响回复）：", e && e.message); }
  }

  // 真实业务群已经由 archiveBusinessGroup 完成“QiWe 已同步 + 管理员已勾选”范围校验。
  // 群消息统一进入 agent，由语义分级与 sendPolicy 决定自动发送、人工审核或引导贴片。
  // 这里保留 gate 结果仅用于观测，不再前置拦截出站。
  if(evt.isGroup){
    let gate = groupGate.shouldHandleGroupText({
      doctorId,
      text:evt.text,
      rawText:evt.text,
      senderName:evt.senderName,
      evt,
      cfg,
      patientKey:"qiwe:" + (evt.senderId || evt.replyToId || "unknown")
    });
    if(gate && gate.ok === false && groupGate.isMeaninglessNoise(evt.text)
      && !(gate.reason === "mention")){
      gate = { ok:false, reason:"meaningless_noise", skipped:"meaningless_noise", riskLevel:"low" };
    }
    // no-op: gate 仅用于诊断观测，群消息不再在此提前静默
  }

  let patientId = null;
  const senderDisplay = resolveSenderDisplayName(doctorId, evt.senderId || evt.replyToId || "", evt.senderName);
  try{
    patientId = resolvePatient({ doctorId, channel:"qiwe", externalId:evt.senderId || evt.replyToId || "", displayName:senderDisplay });
  }catch(e){}
  const patientName = patientLogName(doctorId, patientId, senderDisplay, evt.senderId || evt.replyToId || "", { isGroup: !!evt.isGroup });

  // 群：Dialogue Agent → 回落 buildPatientReply（医生团队人设）。
  // 私聊：走 mpAi 通用医疗助手（与小程序同口径，不绑定具体医生助理人设）。
  let reply = null;
  if(!evt.isGroup){
    try{
      const { buildQiweDmAssistantReply } = require("./dm_assistant.js");
      reply = await buildQiweDmAssistantReply({
        doctorId,
        text:evt.text,
        senderId:evt.senderId || evt.replyToId || ""
      });
    }catch(e){
      console.error("[qiwe] 私聊 mpAi 失败：", e && e.message);
      reply = null;
    }
  }else{
    try{
      const agent = require("../../agent/index.js");
      if(agent.agentEnabled()){
        reply = await agent.runTurn({
          doctorId,
          text:evt.text,
          patientName,
          suppressPatientName:true,
          isGroup:true,
          patientKey:"qiwe:" + (evt.senderId || evt.replyToId || "unknown"),
          patientId
        });
        if(reply && agent.agentDryRun()){
          reply.dryRun = true;
          reply.autoSent = false;
        }
      }
    }catch(e){
      console.error("[qiwe] dialogue agent 失败，回落 buildPatientReply：", e && e.message);
      reply = null;
    }
    if(!reply){
      reply = await buildPatientReply({
        doctorId,
        text:evt.text,
        patientName,
        suppressPatientName:true,
        isGroup:true,
        patientKey:"qiwe:" + (evt.senderId || evt.replyToId || "unknown")
      });
    }
  }

  const isKeywordRule = reply && (reply.source === "keyword_rule" || reply.source === "ai_intent");
  const shouldAutoDeliver = agentReplyShouldAutoDeliver(cfg, reply);
  const autoSent = shouldAutoDeliver;
  const triageRisk = reply && reply.triage ? reply.triage : null;
  const outboundPreview = replyPlainText(reply);
  logInboundMessage({
    doctorId,
    patientId,
    patientName,
    senderId: evt.senderId || null,
    channel: "qiwe",
    groupId: evt.fromRoomId || null,
    text: evt.text || "",
    sourceMessageId: communityRecord && communityRecord.messageId,
    isKeywordRule,
    aiDraft: outboundPreview || (reply && reply.aiDraftText ? reply.aiDraftText : (reply && reply.draft) || null),
    triageSessionId: reply && reply.sessionId ? reply.sessionId : null,
    autoSent,
    riskLevel: triageRisk && triageRisk.riskLevel,
    needsHuman: !!(triageRisk && triageRisk.needsHuman),
    needsDoctor: !!(triageRisk && (triageRisk.needsDoctor || /用药|处方|诊断|加重/.test(String((triageRisk.triggers||[]).join(","))))) ,
    riskTriggers: triageRisk && triageRisk.triggers,
    emergency: !!(triageRisk && triageRisk.emergency)
  });

const deliveryPlan = prepareDelivery(doctorId, reply, patientName, { isGroup:!!evt.isGroup });
  // codex 2026-07-03 反例修：某编号回复只有可成卡的 link 响应、无正文 text 时，①去重的 omitLinkCards 会把文本整条省略 → replyText 空。
  //   原判定只看 replyText/weappReady 未纳入 linkCards → 会 empty_reply 早退，卡既不自动发也不落 pending（违反「去重不丢链接」）。
  //   故 linkCards 非空时不早退：autoSend 路径经 deliverReplyToQiwe 的 linkCards 循环发卡；pending 路径 draftText 空落库但 payload.linkCards 有卡、deliverOutbox 发卡。
  const hasLinkCards = !!(deliveryPlan.linkCards && deliveryPlan.linkCards.length);
  const hasFeedVideos = !!(deliveryPlan.feedVideos && deliveryPlan.feedVideos.length);
  const hasImages = !!(deliveryPlan.images && deliveryPlan.images.length);
  if(!deliveryPlan.replyText && !deliveryPlan.weappReady && !hasLinkCards && !hasFeedVideos && !hasImages) return { ok:true, skipped:"empty_reply", source:reply.source || "" };

  if(!shouldAutoDeliver){
    // autoSend 关 → 一律 pending；autoSend 开但未过真发闸门（三档下=medium AI 分诊 / 分诊异常等）→ 同样落 pending 转人工（#5a 收紧）。
    // H1：V1 半自动主流程——草稿不丢，入 outbound_queue(pending) 等医助在后台「确认发送」。
    // 持久化口径：text=纯文本(去小程序)；mpFallbackText=小程序当文本版(无条件算，链接不丢)；卡片不塞 payload，按 code 发送时重查模板。
    const isGroup = !!evt.isGroup;
    // text 永远去 mp（小程序由原生卡片/fallback 单独发，避免重复链接）；qr 仅在原生卡片就绪时去（与 autoSend 同口径，不混入"微信扫一扫"旧话术）；
    // 卡片未就绪时保留 qr，作为发不出卡片时的真实联系兜底。
    // omitLinkCards:true（甲方 2026-07-03 去重）：草稿 payload.linkCards 已带链接卡，deliverOutbox 按其发卡 → draftText 里整条省略成卡链接行，避免重复。
    // 与 deliveryPlan.linkCards 同口径（willBecomeLinkCard↔linkCardFromResponse，同读 PUBLIC_ORIGIN）：origin 空→深链不成卡→linkCards 空→文本行保留（链接不丢）。
    const draftText = responsesToQiweText(reply, evt.senderName, { omitMiniPrograms:true, omitQr:deliveryPlan.weappReady, omitLinkCards:true, omitPatientName:isGroup });
    // omitLinkCards:true（codex 2026-07-03 反例修）：mp 响应带 external.url（如 414 春雨问卷 webLink）会被 linkCardFromResponse 认成卡进 payload.linkCards，
    //   又出现在 mpFallbackText —— deliverOutbox 无就绪原生模板时发 fallbackText + 又发同 URL link_card → 文本+卡片重复。与 draftText 同口径把成卡响应从 fallback 文本整条省略。
    //   PUBLIC_ORIGIN 空等不成卡场景照旧保留文本（willBecomeLinkCard=false，两侧 fail-closed 对齐，链接不丢）。mp 同时有 shortLink+url 时整条省略连 shortLink 文本一起省——可接受（卡片已承载链接，且②本就不发 #小程序:// 文本行）。
    const mpFallbackText = responsesToQiweText({ responses:miniProgramResponses(reply) }, evt.senderName, { omitLinkCards:true, omitPatientName:isGroup });
    // 缺陷一修（2026-07-03 夜）：草稿 code 与 prepareDelivery 同源（resolveWeappDelivery 命中就绪模板时=该模板编号，
    // 否则=主编号，现状不变）——低危 attach 首编号（饮食）无模板时，payload.qiwe.code 落 101，医助确认发送时
    // deliverOutbox 按此 code 重查就绪模板发原生卡（deliverOutbox 只吃持久化行、无法反查响应，必须在入队时定准）。
    const code = deliveryPlan.code;
    const toId = evt.replyToId;
    const risk = reply && reply.triage && reply.triage.riskLevel;
    const priority = risk === "high" ? "urgent" : (reply && reply.triage && reply.triage.needsHuman) ? "high" : "normal";
    const t = (reply && reply.triage) || {};
    const payloadObj = {
      qiwe:{ toId, code, mpFallbackText, atUserId:isGroup ? (evt.senderId || "") : "", hasMiniProgram:deliveryPlan.hasMiniProgram, weappReadyAtDraft:deliveryPlan.weappReady, linkCards:deliveryPlan.linkCards || [], weappCodes:deliveryPlan.weappCodes || [], feedVideos:deliveryPlan.feedVideos || [], images:deliveryPlan.images || [] },
      triage:{
        sessionId:reply.sessionId || null,
        decisionId:reply.decisionId || null,
        riskLevel:t.riskLevel || "",
        sendPolicy:t.sendPolicy || "",
        canAutoSend:t.canAutoSend === true,
        needsHuman:!!t.needsHuman,
        needsDoctor:!!t.needsDoctor,
        level:Number.isFinite(+t.level) ? +t.level : null,
        autoDeliver:false
      },
      source:reply.source || ""
    };
    const outboxId = outbox().insert({
      doctorId,
      groupId: communityRecord ? communityRecord.groupRow.id : null,
      messageId: communityRecord ? communityRecord.messageId : null,
      targetType: isGroup ? "qiwe_room" : "qiwe_dm",
      targetName: String(toId || ""),
      channelType: "qiwe",
      text: String(draftText || "").slice(0, 2400),
      payload: payloadObj,
      status: "pending",
      source: "qiwe",
      priority,
      dataSource: communityRecord ? "qiwe" : "manual"
    }, { via: "qiwe_review_only" });
    return {
      ok:true,
      sent:false,
      reviewOnly:true,
      outboxId,
      toId,
      replyText:draftText,
      source:reply.source || "",
      sendPolicy:t.sendPolicy || "",
      canAutoSend:t.canAutoSend === true,
      weapp:deliveryPlan.weappPublic,
      hasMiniProgram:deliveryPlan.hasMiniProgram
    };
  }

  const sendResult = await deliverReplyToQiwe({
    cfg,
    doctorId,
    reply,
    toId:evt.replyToId,
    patientName:evt.senderName,
    isGroup:!!evt.isGroup,
    atUserId:evt.isGroup ? (evt.senderId || "") : ""
  });
  // 自动发成功后必须落出站审计行：即使业务群归档失败/为空，也要让社群工作台看得出「系统已回复」
  try{
    outbox().insert({
      doctorId,
      groupId: communityRecord && communityRecord.groupRow ? communityRecord.groupRow.id : null,
      messageId: communityRecord && communityRecord.messageId ? communityRecord.messageId : null,
      targetType: evt.isGroup ? "qiwe_room" : "qiwe_dm",
      targetName: String(evt.replyToId || ""),
      channelType: "qiwe",
      text: String(deliveryPlan.replyText || "").slice(0,2400),
      payload: { qiwe:{ toId:evt.replyToId }, result:sendResult },
      status: sendResult.sent ? "sent" : "pending",
      source: "qiwe",
      priority: "normal",
      sentAt: sendResult.sent ? new Date().toISOString() : null,
      sentBy: sendResult.sent ? "system" : null,
      externalMsgId: sendResult.externalMsgId || null,
      sentMode: sendResult.sent ? "real" : null,
      dataSource: communityRecord && communityRecord.accepted ? "qiwe" : "manual"
    }, { via: "qiwe_autosend_audit" });
  }catch(e){
    console.error("[qiwe] autoSend 后写出站队列失败（回复可能已发出）：", e && e.message);
  }
  if(!evt.isGroup && sendResult.sent){
    patchLatestQiweDmOutbound(doctorId, evt.senderId, sendResult.replyText || deliveryPlan.replyText, outboundPreview);
  }
  return {
    ok:true,
    sent:sendResult.sent,
    toId:evt.replyToId,
    source:reply.source || "",
    replyPreview:(sendResult.replyText || "").slice(0, 160),
    sentParts:sendResult.sentParts,
    weapp:sendResult.weapp,
    qiwe:sendResult.results
  };
}

async function handleCallbackBody(body, cfg){
  cfg = cfg || qiwe.loadConfig();
  const events = qiwe.extractEvents(body);
  const results = [];
  for(const raw of events){
    try{ results.push(await processEvent(raw, cfg)); }
    catch(e){ results.push({ ok:false, error:e && e.message ? e.message : "qiwe_event_failed" }); }
  }
  return { ok:true, accepted:events.length, results };
}

/* 从 qiweapi 发送响应里 best-effort 取一个外部消息 ID；qiweapi 文档未稳定给出，取不到留 null。 */

module.exports = {
  processEvent,
  handleCallbackBody,
  fireGroupWelcome,
  markRoomMemberFirstSeen,
  buildGroupWelcomeText,
  buildMemberVisitText,
  activeDoctorId,
  weappCaptureSkip,
  skipReason,
  voiceSkipReason,
  memberJoinSkipReason,
  processMemberJoinEvent
};
