/* 入群资料抓取 + 运营号过滤回归 */
const os = require("os");
const path = require("path");
const fs = require("fs");
const assert = require("assert");

const TMP = path.join(os.tmpdir(), `chunyu-member-profile-${Date.now()}.db`);
for(const suffix of ["", "-wal", "-shm"]){
  try{ fs.unlinkSync(TMP + suffix); }catch(e){}
}
process.env.DB_PATH = TMP;
process.env.QIWE_DRY_RUN = "1";

const { db, resolvePatient, isPlaceholderDisplayName } = require("./db.js");
const community = require("./community.js");
const memberProfile = require("./modules/qiwe/member_profile.js");
const repo = require("./modules/community/repo.js");

async function main(){
  const doctorA = db.prepare("SELECT id FROM doctors ORDER BY id LIMIT 1").get();
  assert(doctorA && doctorA.id, "需要医生种子");
  const doctorB = db.prepare("SELECT id FROM doctors WHERE id<>? ORDER BY id LIMIT 1").get(doctorA.id)
    || doctorA;
  const didA = doctorA.id;
  const didB = doctorB.id;

  // ---- 1) 运营号识别 ----
  assert(memberProfile.isInternalQiweAccount({ displayName: "春雨医生阳阳" }), "春雨医生* 应为运营号");
  assert(memberProfile.isInternalQiweAccount({ displayName: "医生助手" }), "医生助手应为运营号");
  assert(memberProfile.isInternalQiweAccount({ userId: "u-self", cfg: { selfUserId: "u-self" } }), "托管号本人应过滤");
  const docRow = db.prepare("SELECT id,name FROM doctors WHERE id=?").get(didA);
  if(docRow && docRow.name){
    assert(memberProfile.isInternalQiweAccount({ displayName: docRow.name, doctorId: didA }), "医生本人进群应过滤");
  }
  assert(!memberProfile.shouldCreatePatientArchive({ displayName: "春雨医生阳阳" }), "运营号不应建档");
  assert(memberProfile.shouldCreatePatientArchive({ displayName: "真实患者甲" }), "真实患者应建档");

  // ---- 2) 跨群已知昵称回填 ----
  const gA = community.createGroup({ doctorId: didA, name: "mp-a", channelType: "wechat" });
  const gB = community.createGroup({ doctorId: didB, name: "mp-b", channelType: "wechat" });
  // 有真实昵称的患者，即使跨群曾有「医生助手」名，也不得因 includeInternal 被归档
  const pidKeep = resolvePatient({
    doctorId: didB, channel: "qiwe", externalId: "uid-keep-real", displayName: "真实昵称甲"
  });
  repo.insertMember({
    doctorId: didA, groupId: gA.id, externalUserId: "uid-keep-real",
    displayName: "医生助手", phone: "", tags: [], joinedAt: new Date().toISOString(),
    status: "active", dataSource: "qiwe"
  });
  const archKeep = memberProfile.archiveInternalPatientsForDoctors([didB]);
  assert(!archKeep.ids.includes(pidKeep), "真昵称患者不得因跨群运营别名被归档");
  const keepRow = db.prepare("SELECT archived_at, display_name FROM patients WHERE id=?").get(pidKeep);
  assert(keepRow && !keepRow.archived_at, "真昵称患者应保持活跃");
  repo.insertMember({
    doctorId: didA, groupId: gA.id, externalUserId: "uid-real-1",
    displayName: "王小明", phone: "", tags: [], joinedAt: new Date().toISOString(),
    status: "active", dataSource: "qiwe", lastSyncedAt: new Date().toISOString()
  });
  db.prepare("UPDATE community_members SET avatar_url=? WHERE doctor_id=? AND external_user_id=?")
    .run("https://example.com/a.png", didA, "uid-real-1");
  resolvePatient({ doctorId: didA, channel: "qiwe", externalId: "uid-real-1", displayName: "王小明" });

  // B 医生侧只有占位
  const pidB = resolvePatient({
    doctorId: didB, channel: "qiwe", externalId: "uid-real-1", displayName: "企微患者"
  });
  repo.insertMember({
    doctorId: didB, groupId: gB.id, externalUserId: "uid-real-1",
    displayName: "企微患者", phone: "", tags: [], joinedAt: new Date().toISOString(),
    status: "active", dataSource: "qiwe", lastSyncedAt: new Date().toISOString()
  });

  const applied = memberProfile.applyKnownProfile(didB, "uid-real-1");
  assert(applied.displayName === "王小明", "跨群应借到王小明");
  const ptB = db.prepare("SELECT display_name, avatar_url FROM patients WHERE id=?").get(pidB);
  assert(ptB.display_name === "王小明", "占位患者应回填微信名");
  assert(ptB.avatar_url && ptB.avatar_url.includes("a.png"), "占位患者应回填头像");

  // ---- 3) enrichContactProfile 调企微接口 ----
  const pidNew = resolvePatient({
    doctorId: didB, channel: "qiwe", externalId: "uid-new-2", displayName: "企微患者"
  });
  repo.insertMember({
    doctorId: didB, groupId: gB.id, externalUserId: "uid-new-2",
    displayName: "企微患者", phone: "", tags: [], joinedAt: new Date().toISOString(),
    status: "active", dataSource: "qiwe"
  });
  const enriched = await memberProfile.enrichContactProfile(didB, "uid-new-2", {
    api: async (method, params)=>{
      assert.strictEqual(method, "/contact/batchGetUserinfo");
      return {
        data: {
          contactList: [{
            userId: params.userIdList[0],
            nickname: "新入群患者",
            avatarUrl: "https://example.com/new.png"
          }]
        }
      };
    }
  });
  assert(enriched.displayName === "新入群患者", "enrich 应写入接口昵称");
  const ptNew = db.prepare("SELECT display_name, avatar_url FROM patients WHERE id=?").get(pidNew);
  assert(ptNew.display_name === "新入群患者", "患者档案微信名应更新");
  assert(ptNew.avatar_url.includes("new.png"), "患者档案头像应更新");

  // ---- 4) inbound 不对运营号建档 ----
  // 先在 A 侧登记运营号真名
  repo.insertMember({
    doctorId: didA, groupId: gA.id, externalUserId: "uid-ops-1",
    displayName: "春雨医生阳阳", phone: "", tags: [], joinedAt: new Date().toISOString(),
    status: "active", dataSource: "qiwe"
  });
  const beforeCount = db.prepare("SELECT COUNT(*) c FROM patients WHERE doctor_id=?").get(didB).c;
  // 模拟入站：需要业务群。把 gB 标成 qiwe 业务群
  db.prepare("UPDATE community_groups SET data_source='qiwe', is_business=1, external_group_id=? WHERE id=?")
    .run("room-mp-b", gB.id);
  const inbound = require("./modules/community/inbound.js");
  const archived = inbound.archiveQiweInbound({
    doctorId: didB,
    roomId: "room-mp-b",
    senderId: "uid-ops-1",
    senderName: "春雨医生阳阳",
    text: "",
    msgType: "event",
    externalMsgId: "evt-ops-1"
  });
  assert(archived.accepted, "运营号入群事件仍应归档群事实");
  assert(!archived.patientId, "运营号不应创建 patientId");
  const afterCount = db.prepare("SELECT COUNT(*) c FROM patients WHERE doctor_id=?").get(didB).c;
  assert.strictEqual(afterCount, beforeCount, "运营号入群不得新增患者档案");

  // ---- 5) backfill + archive internals ----
  const pidOps = resolvePatient({
    doctorId: didB, channel: "qiwe", externalId: "uid-ops-2", displayName: "企微患者"
  });
  repo.insertMember({
    doctorId: didA, groupId: gA.id, externalUserId: "uid-ops-2",
    displayName: "春雨医生乐乐", phone: "", tags: [], joinedAt: new Date().toISOString(),
    status: "active", dataSource: "qiwe"
  });
  const arch = memberProfile.archiveInternalPatientsForDoctors([didB]);
  assert(arch.ids.includes(pidOps), "跨群识别为运营号的占位档应被归档");
  const opsRow = db.prepare("SELECT archived_at FROM patients WHERE id=?").get(pidOps);
  assert(opsRow && opsRow.archived_at, "archived_at 应写入");

  console.log("member_profile test: PASS");
  process.exit(0);
}

main().catch(e=>{
  console.error(e && e.stack ? e.stack : e);
  try{ db.close(); }catch(_){}
  process.exit(1);
});
