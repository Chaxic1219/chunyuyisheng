const assert = require("assert");
const fs = require("fs");
const path = require("path");

const dbPath = path.join(__dirname, `_qiwe_business_${process.pid}.db`);
process.env.DB_PATH = dbPath;
process.env.QIWE_DRY_RUN = "1";

async function main(){
  const { db } = require("./db.js");
  const community = require("./community.js");
  const qiweSync = require("./qiwe_sync.js");
  const doctor = db.prepare("SELECT id FROM doctors ORDER BY id LIMIT 1").get();
  assert(doctor && doctor.id, "测试库应有医生种子数据");
  const did = doctor.id;

  const groupCols = db.prepare("PRAGMA table_info(community_groups)").all().map(x=>x.name);
  assert(groupCols.includes("data_source") && groupCols.includes("is_business") && groupCols.includes("last_synced_at"));
  const memberCols = db.prepare("PRAGMA table_info(community_members)").all().map(x=>x.name);
  const messageCols = db.prepare("PRAGMA table_info(community_messages)").all().map(x=>x.name);
  assert(memberCols.includes("data_source") && messageCols.includes("data_source"));
  const messageLogCols = db.prepare("PRAGMA table_info(message_log)").all().map(x=>x.name);
  assert(messageLogCols.includes("source_message_id"), "AI 分诊日志必须能关联并去重真实社群消息");

  const calls = [];
  const api = async (method, params)=>{
    calls.push({ method, params });
    if(method === "/room/getRoomList") return { code:200, data:{ hasMore:0, nextStartIndex:-1, roomList:[
      { roomId:"room-business-1", roomName:Buffer.from("真实业务群").toString("base64"), roomOwnerId:"owner-1", roomMemberCount:2 }
    ] } };
    if(method === "/session/getSessionPage") return { code:0, data:{ hasMore:0, currentSeq:1, sessionList:[
      { sessionId:"room-business-1", sessionType:1 }
    ] } };
    if(method === "/room/batchGetRoomDetail") return { code:200, data:{ roomList:[{
      roomId:"room-business-1", roomName:Buffer.from("真实业务群").toString("base64"), roomCreateUserId:"owner-1",
      memberList:[
        { userId:"member-1", name:"患者甲", joinTime:1700000000, isAdmin:0 },
        { userId:"member-2", name:"患者乙", joinTime:1700000001, isAdmin:1 }
      ]
    }] } };
    throw new Error("unexpected method " + method);
  };

  const first = await qiweSync.syncGroups({ doctorId:did, api });
  assert.strictEqual(first.groups, 1);
  assert.strictEqual(first.members, 2);
  assert(calls.some(x=>x.method === "/room/getRoomList"));
  assert(calls.some(x=>x.method === "/session/getSessionPage"));
  const realGroup = db.prepare("SELECT * FROM community_groups WHERE doctor_id=? AND external_group_id=?").get(did, "room-business-1");
  assert(realGroup && realGroup.data_source === "qiwe");
  assert.strictEqual(realGroup.name, "真实业务群");
  assert.strictEqual(realGroup.is_business, 1, "企微真实群同步后自动纳入业务范围");

  await qiweSync.syncGroups({ doctorId:did, api });
  const selected = db.prepare("SELECT * FROM community_groups WHERE id=?").get(realGroup.id);
  assert.strictEqual(selected.is_business, 1, "后续同步保持业务群");
  assert.strictEqual(selected.external_group_id, "room-business-1", "同步不得清空真实群 ID");
  assert.strictEqual(db.prepare("SELECT COUNT(*) c FROM community_members WHERE group_id=? AND data_source='qiwe' AND status='active'").get(realGroup.id).c, 2);

  // canonical 写回回归：协诊 doctor 触发 sync 时，成员/患者仍必须写到 canonical 主诊
  const docs2 = db.prepare("SELECT id FROM doctors ORDER BY id LIMIT 2").all();
  assert(docs2.length >= 2, "需要至少 2 位医生种子数据");
  const primaryForSync = did;
  const collabForSync = docs2.find(x => x.id !== primaryForSync).id;
  require("./community_group_doctors.js").setGroupDoctors(realGroup.id, {
    primaryDoctorId: primaryForSync,
    collaboratorIds: [collabForSync],
    shareVisibleToCollab: 1
  });
  await qiweSync.syncGroups({ doctorId:collabForSync, api });
  const collabMembers = db.prepare(`
    SELECT COUNT(*) c FROM community_members
    WHERE doctor_id=? AND group_id=? AND external_user_id IN ('member-1','member-2')
  `).get(collabForSync, realGroup.id).c;
  assert.strictEqual(collabMembers, 0, "协诊触发同步不得在协诊 doctor 下生成成员记录");
  const collabPatients = db.prepare(`
    SELECT COUNT(*) c FROM patients
    WHERE doctor_id=?
      AND id IN (SELECT patient_id FROM community_members WHERE doctor_id=? AND group_id=? AND external_user_id IN ('member-1','member-2'))
  `).get(collabForSync, collabForSync, realGroup.id).c;
  assert.strictEqual(collabPatients, 0, "协诊触发同步不得在协诊 doctor 下生成患者记录");

  // 后台已取消业务群开关：即使传入 isBusiness=false 也应被忽略；同步/提升会保持/回写为业务群
  await community.updateGroup(realGroup.id, { name:realGroup.name, isBusiness:false });
  await qiweSync.syncGroups({ doctorId:did, api });
  require("./community_group_doctors.js").mergeDuplicateQiweGroups();
  require("./modules/community/repo.js").setQiweBusinessFlags(realGroup.id);
  const afterIgnore = db.prepare("SELECT is_business, data_source, review_mode FROM community_groups WHERE id=?").get(realGroup.id);
  assert.strictEqual(afterIgnore.is_business, 1, "企微群应保持业务范围（忽略关闭请求）");
  assert.strictEqual(afterIgnore.data_source, "qiwe", "提升仅改 data_source");
  const dbJs = fs.readFileSync(path.join(__dirname, "db.js"), "utf8");
  assert(
    !/SET data_source='qiwe', is_business=1[\s\S]{0,200}WHERE is_business=0/.test(dbJs),
    "db.js 不得在启动时把 is_business=0 强写回 1"
  );
  const ignored = community.archiveQiweInbound({ doctorId:did, roomId:"room-not-selected", senderId:"x", senderName:"无关群成员", text:"hello", externalMsgId:"ignored-1", rawPayload:{} });
  assert.strictEqual(ignored.accepted, false);
  assert.strictEqual(ignored.reason, "non_business_group");

  const archived = community.archiveQiweInbound({ doctorId:did, roomId:"room-business-1", senderId:"member-1", senderName:"患者甲", text:"真实消息", externalMsgId:"real-msg-1", rawPayload:{ cmd:15000 } });
  assert.strictEqual(archived.accepted, true);
  const firstLog = db.prepare("SELECT * FROM message_log WHERE source_message_id=?").get(archived.messageId);
  assert(firstLog && firstLog.text === "真实消息", "真实业务群消息验收后必须立即进入 AI 分诊台");
  const duplicate = community.archiveQiweInbound({ doctorId:did, roomId:"room-business-1", senderId:"member-1", senderName:"患者甲", text:"真实消息", externalMsgId:"real-msg-1", rawPayload:{ cmd:15000 } });
  assert.strictEqual(duplicate.deduped, true);
  assert.strictEqual(db.prepare("SELECT COUNT(*) c FROM community_messages WHERE external_msg_id='real-msg-1'").get().c, 1);
  assert.strictEqual(db.prepare("SELECT COUNT(*) c FROM message_log WHERE source_message_id=?").get(archived.messageId).c, 1, "回调重放不得在 AI 分诊台生成重复消息");

  const codeMessage = community.archiveQiweInbound({ doctorId:did, roomId:"room-business-1", senderId:"member-1", senderName:"患者甲", text:"101", externalMsgId:"real-msg-101", rawPayload:{ cmd:15000 } });
  const codeLog = db.prepare("SELECT * FROM message_log WHERE source_message_id=?").get(codeMessage.messageId);
  assert(codeLog && codeLog.level === 5, "业务群编号 101 必须作为 L5 消息显示在 AI 分诊台");

  const manual = community.createGroup({ doctorId:did, name:"手工测试群", channelType:"wechat" });
  await community.handleInbound({ doctorId:did, groupId:manual.id, eventType:"message", senderName:"模拟患者", externalUserId:"sim-1", text:"模拟消息", dataSource:"simulation", externalMsgId:"sim-msg-1" });
  const overview = community.overview(did);
  assert(overview.summary.groups >= 1 && overview.groups.some(x=>x.isBusiness && x.externalGroupId === "room-business-1"),
    "真实群 KPI 至少包含当前勾选的业务群，且该群出现在列表中");
  assert.strictEqual(overview.summary.totalGroups, overview.groups.length, "群配置总数应等于列表条数（含手工群）");
  assert.strictEqual(overview.summary.members, 2, "真实成员 KPI 不得包含模拟成员");
  assert.strictEqual(overview.summary.inbound, 2, "真实消息 KPI 应包含两条真实消息且不得包含模拟消息");
  assert(overview.groups.some(x=>x.dataSource === "manual"), "保留手工新增群入口及其数据");
  assert(overview.messages.some(x=>x.dataSource === "simulation"), "保留模拟入站并明确标记来源");
  assert(require("./group_gate.js").hasSymptomAsk("拉肚子") === true, "常见症状「拉肚子」不得被当闲聊吞掉");
  assert(require("./group_gate.js").hasSymptomAsk("着凉") === true, "着凉应视作症状短句");
  assert(require("./group_gate.js").hasSymptomAsk("特别痒我想止痒") === true, "瘙痒/止痒应视作症状求助");
  assert(require("./group_gate.js").hasSymptomAsk("我现在被蚊子叮了个包，特别痒我想止痒") === true, "蚊子叮包求止痒不得当闲聊");
  assert(require("./group_gate.js").shouldHandleGroupText({ doctorId:did, text:"拉肚子" }).ok === true, "症状短句应过群门控");
  assert(require("./group_gate.js").shouldHandleGroupText({ doctorId:did, text:"我现在被蚊子叮了个包，特别痒我想止痒" }).ok === true, "蚊子叮包应过群门控，不得 L6 静默");
  assert(require("./group_gate.js").isMeaninglessNoise("好的") === true, "无意义：好的");
  assert(require("./group_gate.js").isMeaninglessNoise("嗯嗯") === true, "无意义：嗯嗯");
  assert(require("./group_gate.js").isMeaninglessNoise("哈哈") === true, "无意义：哈哈");
  assert(require("./group_gate.js").isMeaninglessNoise("拉肚子") === false, "症状不是无意义");
  assert(require("./group_gate.js").isMeaninglessNoise("特别痒我想止痒") === false, "止痒求助不是无意义");
  assert(require("./group_gate.js").shouldHandleGroupText({ doctorId:did, text:"好的" }).skipped === "meaningless_noise", "好的应静默");
  assert(require("./group_gate.js").shouldHandleGroupText({ doctorId:did, text:"今天天气不错" }).skipped === "group_chitchat", "纯闲聊仍应静默");
  assert(require("./group_gate.js").isDiseaseConsultAsk("我肚子有点疼") === true, "有点疼自述也是问病");
  assert(require("./group_gate.js").shouldHandleGroupText({ doctorId:did, text:"我肚子有点疼" }).ok === true, "我肚子有点疼不得静默");
  assert(require("./group_gate.js").shouldHandleGroupText({ doctorId:did, text:"我最近有点尿急" }).ok === true, "有点尿急不得静默");
  assert(require("./group_gate.js").isDiseaseConsultAsk("我着凉了怎么办") === true, "问病优先识别着凉");
  assert(require("./group_gate.js").isDiseaseConsultAsk("怎么挂号") === false, "纯挂号不算问病硬套");

  const serverSource = fs.readFileSync(path.join(__dirname, "server.js"), "utf8");
  const communityAdminSource = fs.readFileSync(path.join(__dirname, "routes/community-admin.js"), "utf8");
  const adminSource = fs.readFileSync(path.join(__dirname, "public/src/admin.js"), "utf8");
  const bridgeSource = ["callback.js","cards.js","delivery.js","shared.js","media.js"]
    .map(f=>fs.readFileSync(path.join(__dirname, "modules", "qiwe", f), "utf8")).join("\n");
  const adminApiSurface = serverSource + "\n" + communityAdminSource;
  assert(adminApiSurface.includes('/api\\/admin\\/community\\/qiwe\\/sync'), "后台必须提供真实 QiWe 群同步接口");
  assert(adminApiSurface.includes('dataSource:"simulation"'), "后台模拟入站必须强制标记为测试数据");
  assert(adminSource.includes("同步企微群") && adminSource.includes("真实同步") && adminSource.includes("模拟/手工"), "社群工作台必须区分真实与测试数据");
  assert(adminSource.includes("communityRefreshTimer") && adminSource.includes("softRefreshCommunityFeeds") && adminSource.includes("renderCommunity(m)"), "社群工作台必须定时软刷新入站/出站，且支持完整重载");
  assert(adminSource.includes("community-scroll") && adminSource.includes("COMMUNITY_FEED_LIMIT"), "入站/出站须限高滚动并限制展示条数");
  assert(bridgeSource.includes("archiveBusinessGroup(evt, doctorId)"), "QiWe 回调必须经过业务群范围闸门");
  assert(bridgeSource.includes("isMeaninglessNoise") && bridgeSource.includes("meaningless_noise"), "业务群也应对无意义消息静默");
  assert(bridgeSource.includes("if(evt.isGroup)"), "群消息先过门控/无意义静默分支");

  // --- 多医生同群（MDG）---
  const cgd = require("./community_group_doctors.js");
  const docs = db.prepare("SELECT id FROM doctors ORDER BY id LIMIT 2").all();
  assert(docs.length >= 2, "MDG 测试需要至少两名医生");
  const primaryId = did;
  const collabId = docs.find(d => d.id !== primaryId).id;
  cgd.setGroupDoctors(realGroup.id, {
    primaryDoctorId: primaryId,
    collaboratorIds: [collabId],
    shareVisibleToCollab: true
  });
  const mdgArchived = community.archiveQiweInbound({
    doctorId: collabId,
    roomId: "room-business-1",
    senderId: "member-1",
    senderName: "患者甲",
    text: "MDG归属测试",
    externalMsgId: "mdg-owner-1",
    rawPayload: { cmd: 15000 }
  });
  assert.strictEqual(mdgArchived.accepted, true);
  const mdgMsg = db.prepare("SELECT doctor_id FROM community_messages WHERE external_msg_id='mdg-owner-1'").get();
  assert.strictEqual(+mdgMsg.doctor_id, primaryId, "入站消息 doctor_id 必须归属主诊，而非回调配置医生");
  const mdgPrimary = cgd.resolvePrimaryDoctorId(realGroup.id);
  assert.strictEqual(mdgPrimary, primaryId, "resolvePrimaryDoctorId 应返回主诊");

  const stamp = Date.now();
  const dupExt = "room-dup-" + stamp;
  try { db.exec("DROP INDEX IF EXISTS idx_cg_qiwe_external"); } catch (e) {}
  const g1 = db.prepare(`INSERT INTO community_groups(
    doctor_id,channel_type,external_group_id,name,status,welcome_enabled,auto_reply_enabled,
    review_mode,created_at,updated_at,data_source,is_business,share_visible_to_collab
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    primaryId, "qiwe", dupExt, "重复群A", "active", 1, 1,
    "human_review", new Date().toISOString(), new Date().toISOString(), "qiwe", 1, 1
  );
  db.prepare(`INSERT INTO community_groups(
    doctor_id,channel_type,external_group_id,name,status,welcome_enabled,auto_reply_enabled,
    review_mode,created_at,updated_at,data_source,is_business,share_visible_to_collab
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    collabId, "qiwe", dupExt, "重复群B", "active", 1, 1,
    "human_review", new Date().toISOString(), new Date().toISOString(), "qiwe", 0, 1
  );
  db.prepare(`INSERT OR IGNORE INTO community_group_doctors
    (group_id,doctor_id,role,auto_reply,can_outbound,joined_at) VALUES (?,?,?,?,?,?)`)
    .run(g1.lastInsertRowid, primaryId, "primary", 1, 1, new Date().toISOString());
  const merged = cgd.mergeDuplicateQiweGroups();
  const dupEntry = merged.find(m => m.externalGroupId === dupExt);
  assert(dupEntry, "重复 external_group_id 应被合并");
  assert.strictEqual(
    db.prepare("SELECT COUNT(*) c FROM community_groups WHERE external_group_id=? AND data_source='qiwe'").get(dupExt).c,
    1,
    "合并后同一 external_group_id 仅保留一行"
  );

  console.log("QiWe business group tests: PASS");
  db.close();
}

main().catch(err=>{
  console.error(err.stack || err);
  process.exitCode = 1;
}).finally(()=>{
  for(const suffix of ["", "-wal", "-shm"]){
    try{ fs.rmSync(dbPath + suffix, { force:true }); }catch(e){}
  }
});
