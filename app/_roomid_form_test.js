/* 企微 roomId 8/17 位形态容错单测：idAllowed 前缀匹配 + findByExternalGroupId 前缀兜底 */
const os = require("os"), path = require("path"), fs = require("fs");
const TMP = path.join(os.tmpdir(), "chunyu_roomid_test.db");
[TMP, TMP + "-wal", TMP + "-shm"].forEach(f=>{ try{ fs.unlinkSync(f); }catch(e){} });
process.env.DB_PATH = TMP;
process.env.TRIAGE_AI_DISABLED = "1";

const { db } = require("./db.js");
const { idAllowed, idAllowedMatch } = require("./modules/qiwe/shared.js");
const repo = require("./modules/community/repo.js");

let n = 0, fails = [];
const ok = (c, m) => { n++; if(!c){ fails.push(m); console.log("  FAIL " + m); } else console.log("  ok   " + m); };

(async ()=>{
  const lv = db.prepare("SELECT id FROM doctors WHERE slug='lvfujing'").get();
  const did = lv.id;

  console.log("== idAllowedMatch 前缀容错 ==");
  const allowed = new Set(["10782599"]); // 白名单存 8 位内部 roomid
  ok(idAllowedMatch("10782599648880210", allowed) === true, "回调 17 位 → 白名单 8 位前缀命中");
  ok(idAllowedMatch("10782599", allowed) === true, "回调 8 位 → 白名单 8 位精确命中");
  ok(idAllowedMatch("10865977378465695", allowed) === false, "无关 17 位群 → 不命中");

  const allowed17 = new Set(["10782599648880210"]); // 白名单存 17 位 chat_id
  ok(idAllowedMatch("10782599", allowed17) === true, "回调 8 位 → 白名单 17 位前缀命中");
  ok(idAllowedMatch("10782599648880210", allowed17) === true, "回调 17 位 → 白名单 17 位精确命中");
  ok(idAllowedMatch("99999999", allowed17) === false, "无关 8 位 → 不命中");

  console.log("== findByExternalGroupId 前缀兜底 ==");
  // 建一个 17 位 ext 的群
  const g = repo.insertGroup({
    doctorId: did, channelType: "qiwe", externalGroupId: "10782599648880210",
    name: "测试形态群", owner: "测试", memberCount: 0, status: "pilot",
    welcomeEnabled: 1, welcomeText: "", autoReplyEnabled: 1,
    reviewMode: "human_review", notes: "形态测试", dataSource: "qiwe", isBusiness: 1
  });
  const hit17 = repo.findByExternalGroupId("10782599648880210");
  ok(!!hit17 && hit17.id === g.id, "17 位精确命中");
  const hit8 = repo.findByExternalGroupId("10782599");
  ok(!!hit8 && hit8.id === g.id, "8 位前缀兜底命中同一群");
  const miss = repo.findByExternalGroupId("10865977378465695");
  ok(!miss, "无关 17 位 → 不命中");

  console.log("\n共 " + n + " 项断言，" + (fails.length ? "失败 " + fails.length + " 项" : "全部通过"));
  process.exit(fails.length ? 1 : 0);
})().catch(e=>{ console.error(e); process.exit(2); });
