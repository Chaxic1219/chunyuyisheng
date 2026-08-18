/* QiWe enrichment 回写回归测试：占位 patients.display_name 应被真实 nickname 覆盖 */
const os = require("os");
const path = require("path");
const fs = require("fs");
const assert = require("assert");

const TMP = path.join(os.tmpdir(), `chunyu-qiwe-enrich-${Date.now()}.db`);
for (const suffix of ["", "-wal", "-shm"]) {
  try { fs.unlinkSync(TMP + suffix); } catch (e) {}
}
process.env.DB_PATH = TMP;
process.env.QIWE_DRY_RUN = "1";

const qiwe = require("./qiwe.js");
const qiweSync = require("./qiwe_sync.js");
const community = require("./community.js");
const { db, resolvePatient } = require("./db.js");

async function main(){
  const doctor = db.prepare("SELECT id FROM doctors ORDER BY id LIMIT 1").get();
  assert(doctor && doctor.id, "需要医生种子数据");
  const did = doctor.id;

  const group = community.createGroup({ doctorId: did, name: "enrich-test-group", channelType: "wechat" });

  // 1) 先创建一个占位患者：display_name=企微患者
  const pid = resolvePatient({
    doctorId: did,
    channel: "qiwe",
    externalId: "u1",
    displayName: "企微患者"
  });

  // 2) 创建占位 community_members（不关键是否挂 patient_id，enrich 依 external_user_id 回写）
  const repo = require("./modules/community/repo.js");
  repo.insertMember({
    doctorId: did,
    groupId: group.id,
    externalUserId: "u1",
    displayName: "企微患者",
    phone: "",
    tags: [],
    joinedAt: new Date().toISOString(),
    status: "active",
    dataSource: "qiwe",
    lastSyncedAt: new Date().toISOString()
  });

  // 3) stub /contact/batchGetUserinfo 返回真实 nickname/avatarUrl
  const api = async (method, params)=>{
    assert.strictEqual(method, "/contact/batchGetUserinfo");
    const list = (params && params.userIdList) || [];
    return {
      data: {
        contactList: list.map(uid=>({
          userId: uid,
          nickname: "王小明",
          realName: "王小明",
          avatarUrl: "http://example.com/wxm.png"
        }))
      }
    };
  };

  await qiweSync.enrichMemberNames(did, api);

  const cm = db.prepare("SELECT display_name, avatar_url FROM community_members WHERE doctor_id=? AND external_user_id=? ORDER BY id DESC LIMIT 1").get(did, "u1");
  assert(cm && cm.display_name === "王小明", "community_members.display_name 应被覆盖为真实 nickname");
  assert(cm && cm.avatar_url && cm.avatar_url.includes("wxm.png"), "community_members.avatar_url 应被写入");

  const pt = db.prepare("SELECT display_name, avatar_url FROM patients WHERE id=?").get(pid);
  assert(pt && pt.display_name === "王小明", "patients.display_name 应被覆盖为真实 nickname");
  assert(pt && pt.avatar_url && pt.avatar_url.includes("wxm.png"), "patients.avatar_url 应被写入/覆盖（强一致）");

  console.log("QiWe enrichMemberNames test: PASS");
  process.exit(0);
}

main().catch((e)=>{
  console.error(e && e.stack ? e.stack : e);
  try{ db.close(); }catch(_){}
  process.exit(1);
});

