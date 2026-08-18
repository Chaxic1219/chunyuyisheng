/* Phase 2–4 模块化冒烟：解环 + 门面 + 事件 */
const os = require("os"), path = require("path"), fs = require("fs");
const TMP = path.join(os.tmpdir(), "chunyu_mod_phase234_test.db");
[TMP, TMP + "-wal", TMP + "-shm"].forEach(f=>{ try{ fs.unlinkSync(f); }catch(e){} });
process.env.DB_PATH = TMP;
process.env.TRIAGE_AI_DISABLED = "1";

const { db } = require("./db.js");
const eventBus = require("./shared/eventBus.js");
const communityMod = require("./modules/community");
const qiweMod = require("./modules/qiwe");
const followupMod = require("./modules/followup");
const opsMod = require("./modules/ops");
const outboxMod = require("./modules/outbox");
const { wireModuleEvents } = require("./modules/wiring");

let n = 0, fails = [];
const ok = (c, m)=>{ n++; if(!c){ fails.push(m); console.log("  ✗ " + m); } else console.log("  ✓ " + m); };

(async ()=>{
  eventBus.clearAllForTests();
  wireModuleEvents();

  // 解环：community 模块源码顶层不再 require qiwe_bridge
  const communitySrc = fs.readFileSync(path.join(__dirname, "community.js"), "utf8");
  ok(!/^const qiweBridge = require\("\.\/qiwe_bridge\.js"\);$/m.test(communitySrc), "community.js 顶层无 qiwe_bridge require");
  const bridgeShell = fs.readFileSync(path.join(__dirname, "qiwe_bridge.js"), "utf8");
  const qiweImplSrc = ["shared.js","media.js","cards.js","delivery.js","callback.js"]
    .map(f=>fs.readFileSync(path.join(__dirname, "modules", "qiwe", f), "utf8")).join("\n");
  ok(!/require\("\.\/community\.js"\)/.test(bridgeShell + "\n" + qiweImplSrc), "qiwe 实现不再直接 require community.js");
  ok(/require\("\.\.\/community"\)/.test(qiweImplSrc), "qiwe 实现改走 modules/community");
  ok(/modules\/qiwe/.test(bridgeShell) || /require\("\.\/modules\/qiwe"\)/.test(bridgeShell), "qiwe_bridge.js 为兼容壳");

  const lv = db.prepare("SELECT id FROM doctors WHERE slug='lvfujing'").get();
  ok(!!lv, "种子医生存在");

  ok(typeof communityMod.findQiweBusinessGroupByRoom === "function", "community 门面导出查群");
  ok(typeof qiweMod.deliverOutbox === "function", "qiwe 门面导出 deliverOutbox");
  ok(typeof followupMod.mine === "function" && typeof followupMod.enroll === "function", "followup 门面可用");
  ok(typeof opsMod.scripts === "function" && typeof opsMod.emitPublished === "function", "ops 门面可用");

  let archived = null, published = null;
  eventBus.on("community.inbound.archived", (p)=>{ archived = p; });
  eventBus.on("ops.config.published", (p)=>{ published = p; });

  // 非业务群归档应拒绝（不发 archived）
  const miss = communityMod.archiveQiweInbound({
    doctorId: lv.id,
    roomId: "room-not-exist-" + Date.now(),
    senderId: "u1",
    senderName: "测",
    text: "hi",
    msgType: "text",
    externalMsgId: "msg-" + Date.now()
  });
  ok(miss && miss.accepted === false, "未知群归档拒绝");
  ok(!archived, "拒绝归档不发事件");

  opsMod.emitPublished({ configId:1, doctorId:lv.id, domain:"scripts", version:2 });
  ok(published && published.domain === "scripts" && published.version === 2, "ops.config.published 事件可达");

  const id = outboxMod.enqueueDirect({
    doctorId: lv.id,
    targetId: "room-x",
    text: "phase234",
    source: "unit_p234",
    channelType: "qiwe",
    isGroup: true
  });
  ok(Number(id) > 0, "outbox 门面仍可用");

  console.log("\n断言 " + n + " 条，失败 " + fails.length);
  if(fails.length){
    fails.forEach(f=>console.log("FAIL:", f));
    process.exit(1);
  }
  console.log("ALL PASS");
  process.exit(0);
})().catch(e=>{ console.error(e); process.exit(1); });
