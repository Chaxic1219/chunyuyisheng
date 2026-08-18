/* QiWe 配置回退回归测试：最新一行 guid/self_user_id 字段为空时，
   loadConfig 应回捞最近非空的历史值（而不是落回 env）。 */
const os = require("os");
const path = require("path");
const fs = require("fs");
const assert = require("assert");

const TMP = path.join(os.tmpdir(), `chunyu-qiwe-config-fallback-${Date.now()}.db`);
for (const suffix of ["", "-wal", "-shm"]) {
  try { fs.unlinkSync(TMP + suffix); } catch (e) {}
}
process.env.DB_PATH = TMP;
process.env.QIWE_DRY_RUN = "1";
process.env.QIWE_TOKEN = "env-token";
process.env.QIWE_GUID = "env-guid";
process.env.QIWE_SELF_USER_ID = "env-self-user";
process.env.QIWE_API_URL = "http://env-api.example.com/doApi";

const qiwe = require("./qiwe.js");
const { db } = require("./db.js");

function nowIso(){
  return new Date().toISOString();
}

(async ()=>{
  // old row: 有真实值
  db.prepare(`
    INSERT INTO qiwe_configs(
      doctor_id,token,guid,self_user_id,test_to_id,callback_secret,api_url,
      enabled,auto_send,allow_group,note,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    1,
    "token-good",
    "guid-good",
    "self-good",
    "test-good",
    "secret-good",
    "http://api-good.example.com/doApi",
    1, 1, 0,
    "old-note",
    nowIso()
  );

  // new row: 最近一行核心字段为空（模拟线上脏数据）
  db.prepare(`
    INSERT INTO qiwe_configs(
      doctor_id,token,guid,self_user_id,test_to_id,callback_secret,api_url,
      enabled,auto_send,allow_group,note,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    2,
    "",
    "",
    "",
    "test-new",
    "",
    "",
    0, 0, 1,
    "new-note",
    nowIso()
  );

  const cfg = qiwe.loadConfig();

  assert.strictEqual(cfg.guid, "guid-good", "guid 应回捞最近非空历史值");
  assert.strictEqual(cfg.selfUserId, "self-good", "selfUserId 应回捞最近非空历史值");
  assert.strictEqual(cfg.token, "token-good", "token 应回捞最近非空历史值");
  assert.strictEqual(cfg.callbackSecret, "secret-good", "callbackSecret 应回捞最近非空历史值");
  assert.strictEqual(cfg.apiUrl, "http://api-good.example.com/doApi", "apiUrl 应回捞最近非空历史值");

  // 布尔/doctorId/note 仍以最新行为主
  assert.strictEqual(cfg.doctorId, 2, "doctorId 应以最新行为主");
  assert.strictEqual(cfg.enabled, false, "enabled 应以最新行为主");
  assert.strictEqual(cfg.autoSend, false, "autoSend 应以最新行为主");
  assert.strictEqual(cfg.allowGroup, true, "allowGroup 应以最新行为主");
  assert.strictEqual(cfg.note, "new-note", "note 应以最新行为主");

  console.log("QiWe config fallback test: PASS");
  db.close();
  process.exit(0);
})().catch((e)=>{
  console.error(e && e.stack ? e.stack : e);
  try{ db.close(); }catch(_){}
  process.exit(1);
});

