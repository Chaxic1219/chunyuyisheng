/* outbound schema + repo 冒烟（离线） */
"use strict";
const assert = require("assert");
const os = require("os");
const path = require("path");
const fs = require("fs");

const TMP = path.join(os.tmpdir(), `outbound-${Date.now()}.db`);
[TMP, TMP + "-wal", TMP + "-shm"].forEach((f) => {
  try {
    fs.unlinkSync(f);
  } catch (e) {}
});
process.env.DB_PATH = TMP;
process.env.TRIAGE_AI_DISABLED = "1";

const { db } = require("./db.js");
const repo = require("./modules/outbound/repo.js");

let n = 0;
const fails = [];
const ok = (c, m) => {
  n++;
  if (!c) {
    fails.push(m);
    console.log("  ✗ " + m);
  } else {
    console.log("  ✓ " + m);
  }
};

try {
  ok(!!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='outbound_assets'").get(), "outbound_assets 表存在");
  ok(!!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='outbound_triggers'").get(), "outbound_triggers 表存在");
  ok(!!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='outbound_trigger_steps'").get(), "outbound_trigger_steps 表存在");

  const doctor = db.prepare("SELECT id FROM doctors ORDER BY id LIMIT 1").get();
  assert(doctor);
  ok(!!doctor, "种子医生存在");

  // boot 时 migrateAllDoctors 可能已写入 outbound；清掉该医生以便后续 CRUD/resolve 断言可控
  db.prepare(
    `DELETE FROM outbound_trigger_steps WHERE trigger_id IN (
      SELECT id FROM outbound_triggers WHERE doctor_id=?
    )`
  ).run(doctor.id);
  db.prepare("DELETE FROM outbound_triggers WHERE doctor_id=?").run(doctor.id);
  db.prepare("DELETE FROM outbound_assets WHERE doctor_id=?").run(doctor.id);

  const a = repo.createAsset({
    doctorId: doctor.id,
    type: "text",
    title: "t1",
    payload: { text: "你好" },
    groupCode: "101",
  });
  ok(a && a.id, "应能创建 asset");
  ok(a.payload && a.payload.text === "你好", "payload 解析");
  ok(a.groupCode === "101", "groupCode");

  const a2 = repo.createAsset({
    doctorId: doctor.id,
    type: "text",
    title: "t2",
    payload: { text: "第二条" },
    groupCode: "101",
  });

  const list = repo.listAssets(doctor.id, { groupCode: "101" });
  ok(list.length >= 2, "listAssets 按 groupCode");
  ok(list.some((x) => x.id === a.id), "listAssets 含 a");

  const bundle = repo.createCodeBundle(doctor.id, "626");
  ok(bundle && bundle.id, "createCodeBundle 创建空 code 触发");
  ok(bundle.kind === "code" && bundle.code === "626", "createCodeBundle kind/code");
  const bundleTrig = repo.getTrigger(doctor.id, bundle.id);
  ok(bundleTrig && (!bundleTrig.steps || bundleTrig.steps.length === 0), "createCodeBundle 无 steps");

  const trigger = repo.createTrigger({
    doctorId: doctor.id,
    kind: "code",
    code: "101",
    aliases: ["一百零一"],
    matchType: "exact",
  });
  ok(trigger && trigger.id, "createTrigger");

  repo.replaceSteps(doctor.id, trigger.id, [
    { assetId: a.id, sort: 0, enabled: true },
    { assetId: a2.id, sort: 1, enabled: true },
  ]);
  const withSteps = repo.getTrigger(doctor.id, trigger.id);
  ok(withSteps && withSteps.steps && withSteps.steps.length === 2, "replaceSteps 写入两步");
  ok(withSteps.steps[0].assetId === a.id, "replaceSteps 顺序");

  let threw = false;
  try {
    repo.deleteAsset(doctor.id, a.id);
  } catch (e) {
    threw = true;
    ok(e.code === "ASSET_IN_USE", "deleteAsset 引用中抛 ASSET_IN_USE");
  }
  ok(threw, "deleteAsset 引用中应拒绝");

  repo.replaceSteps(doctor.id, trigger.id, [{ assetId: a2.id, sort: 0 }]);
  repo.deleteAsset(doctor.id, a.id);
  const gone = db.prepare("SELECT id FROM outbound_assets WHERE id=?").get(a.id);
  ok(!gone, "deleteAsset 无引用时删除成功");

  const triggers = repo.listTriggers(doctor.id);
  ok(triggers.some((t) => t.id === trigger.id), "listTriggers");

  const updated = repo.updateAsset(doctor.id, a2.id, { title: "updated" });
  ok(updated && updated.title === "updated", "updateAsset");


  // --- 多租户隔离 ---
  let doctorB = db.prepare("SELECT id FROM doctors WHERE id<>? ORDER BY id LIMIT 1").get(doctor.id);
  if (!doctorB) {
    const info = db
      .prepare("INSERT INTO doctors(slug,name,active) VALUES(?,?,1)")
      .run("outbound-iso-" + Date.now(), "隔离医生");
    doctorB = { id: info.lastInsertRowid };
  }
  ok(!!doctorB && doctorB.id !== doctor.id, "隔离用医生 B 存在");

  const beforeIso = repo.getTrigger(doctor.id, trigger.id);
  const wrongDoc = repo.replaceSteps(doctorB.id, trigger.id, [{ assetId: a2.id, sort: 0 }]);
  ok(wrongDoc === null, "replaceSteps 错误 doctorId 返回 null");
  const afterIso = repo.getTrigger(doctor.id, trigger.id);
  ok(
    afterIso &&
      afterIso.steps &&
      afterIso.steps.length === (beforeIso.steps || []).length &&
      afterIso.steps[0] &&
      afterIso.steps[0].assetId === a2.id,
    "replaceSteps 错误 doctorId 不改 steps"
  );

  const foreignAsset = repo.createAsset({
    doctorId: doctorB.id,
    type: "text",
    title: "foreign",
    payload: { text: "跨医生" },
    groupCode: "x",
  });
  let mismatch = false;
  try {
    repo.replaceSteps(doctor.id, trigger.id, [{ assetId: foreignAsset.id, sort: 0 }]);
  } catch (e) {
    mismatch = e.code === "ASSET_DOCTOR_MISMATCH";
    ok(e.code === "ASSET_DOCTOR_MISMATCH", "replaceSteps 跨医生 asset 抛 ASSET_DOCTOR_MISMATCH");
  }
  ok(mismatch, "replaceSteps 拒绝链接他医生 assetId");
  const stillOwn = repo.getTrigger(doctor.id, trigger.id);
  ok(
    stillOwn && stillOwn.steps && stillOwn.steps.length === 1 && stillOwn.steps[0].assetId === a2.id,
    "跨医生 asset 失败后 steps 未变"
  );

  const updWrong = repo.updateAsset(doctorB.id, a2.id, { title: "hacked" });
  ok(updWrong === null, "updateAsset 错误 doctorId 返回 null");
  const a2check = db.prepare("SELECT title FROM outbound_assets WHERE id=?").get(a2.id);
  ok(a2check && a2check.title === "updated", "updateAsset 错误 doctorId 未改写");

  // --- Task 2: resolve 匹配展开 ---
  const resolve = require("./modules/outbound/resolve.js");

  const rText1 = repo.createAsset({
    doctorId: doctor.id,
    type: "text",
    title: "r1",
    payload: { text: "第一条" },
    groupCode: "101",
  });
  const rText2 = repo.createAsset({
    doctorId: doctor.id,
    type: "text",
    title: "r2",
    payload: { text: "第二条" },
    groupCode: "101",
  });
  const rMp = repo.createAsset({
    doctorId: doctor.id,
    type: "mp",
    title: "小程序",
    payload: { title: "预约", shortLink: "https://s.example/x", weappCode: "wx001" },
    groupCode: "101",
  });
  repo.replaceSteps(doctor.id, trigger.id, [
    { assetId: rText1.id, sort: 0, enabled: true },
    { assetId: rText2.id, sort: 1, enabled: true },
    { assetId: rMp.id, sort: 2, enabled: true },
  ]);

  const hit = resolve.matchCode(doctor.id, "101");
  ok(!!hit, "matchCode 命中 101");
  ok(hit && hit.source === "outbound", "matchCode source=outbound");
  ok(hit && hit.bot === "小宝医助", "matchCode bot");
  ok(hit && hit.code === "101", "matchCode code");
  ok(hit && hit.responses && hit.responses.length === 3, "matchCode 返回 3 条 responses");
  ok(hit && hit.responses[0].type === "text", "responses[0] text");
  ok(hit && hit.responses[1].type === "text", "responses[1] text");
  ok(hit && hit.responses[2].type === "mp", "responses[2] mp");

  // 未完成真机采样的视频号素材不得退化成普通 link 卡片
  const rVideo = repo.createAsset({
    doctorId: doctor.id,
    type: "video",
    title: "视频号内容",
    payload: { url: "https://weixin.qq.com/sph/ASEtZjMGev", iconUrl: "" },
    groupCode: "114",
  });
  const trig114 = repo.createTrigger({
    doctorId: doctor.id,
    kind: "code",
    code: "114",
    matchType: "exact",
  });
  repo.replaceSteps(doctor.id, trig114.id, [{ assetId: rVideo.id, sort: 0, enabled: true }]);
  const hitVideo = resolve.matchCode(doctor.id, "114");
  ok(!!hitVideo, "matchCode 命中 114");
  ok(hitVideo && hitVideo.responses && hitVideo.responses.length === 0, "114 未采样时不发送错误格式");

  // 图片素材（image 类型）：填 URL 即可展开为可发送的 image response
  const rImg = repo.createAsset({
    doctorId: doctor.id,
    type: "image",
    title: "科普海报",
    payload: { url: "https://yht.chunyutianxia.com/uploads/poster/818.png", imageUrl: "https://yht.chunyutianxia.com/uploads/poster/818.png" },
    groupCode: "818",
  });
  const trig818 = repo.createTrigger({
    doctorId: doctor.id,
    kind: "code",
    code: "818",
    matchType: "exact",
  });
  repo.replaceSteps(doctor.id, trig818.id, [{ assetId: rImg.id, sort: 0, enabled: true }]);
  const hitImg = resolve.matchCode(doctor.id, "818");
  ok(!!hitImg, "matchCode 命中 818");
  ok(hitImg && hitImg.responses && hitImg.responses.length === 1, "818 返回 1 条 responses（image 素材）");
  ok(hitImg && hitImg.responses[0].type === "image", "image 素材 → image response");
  ok(hitImg && hitImg.responses[0].url === "https://yht.chunyutianxia.com/uploads/poster/818.png", "image response 携带图片 url");


  ok(resolve.hasOutboundConfig(doctor.id) === true, "hasOutboundConfig true");

  const joinTrig = repo.createTrigger({
    doctorId: doctor.id,
    kind: "join",
    code: "",
    matchType: "exact",
  });
  const joinText = repo.createAsset({
    doctorId: doctor.id,
    type: "text",
    title: "欢迎",
    payload: { text: "欢迎入群" },
    groupCode: "join",
  });
  repo.replaceSteps(doctor.id, joinTrig.id, [{ assetId: joinText.id, sort: 0 }]);
  const joinHit = resolve.matchJoin(doctor.id);
  ok(!!joinHit, "matchJoin 命中");
  ok(joinHit && joinHit.kind === "join", "matchJoin kind");
  ok(joinHit && joinHit.source === "outbound", "matchJoin source");
  ok(
    joinHit && joinHit.responses && joinHit.responses.length === 1 && joinHit.responses[0].type === "text",
    "matchJoin 展开 text"
  );
  ok(joinHit && joinHit.triggerId === joinTrig.id, "matchJoin triggerId");

  // --- Task 3: migrateDoctor（绕过全局 patch，直接测单医生）---
  const migrate = require("./modules/outbound/migrate.js");
  const migDocInfo = db
    .prepare("INSERT INTO doctors(slug,name,active) VALUES(?,?,1)")
    .run("outbound-mig-" + Date.now(), "迁移测试医生");
  const migDid = migDocInfo.lastInsertRowid;
  ok(!!migDid, "迁移测试医生已插入");

  db.prepare(
    `INSERT INTO rules(doctor_id,code,aliases,match_type,bot,responses,enabled,sort)
     VALUES(?,?,?,?,?,?,1,0)`
  ).run(
    migDid,
    "101",
    JSON.stringify(["咨询"]),
    "exact",
    "小宝医助",
    JSON.stringify([
      {
        type: "mp",
        title: "测试主页",
        external: { shortLink: "#小程序://test/abc" },
      },
      { type: "qr", name: "应跳过" },
    ])
  );

  const scriptPayload = JSON.stringify({
    code101: "迁移前置话术CODE101",
    groupWelcome: "欢迎加入迁移测试群",
  });
  const nowMig = new Date().toISOString();
  db.prepare(
    `INSERT INTO ops_configs(doctor_id,domain,title,scope,draft_json,published_json,published_version,status,updated_at,published_at)
     VALUES(?,?,?,?,?,?,?,?,?,?)`
  ).run(
    migDid,
    "scripts",
    "话术脚本配置",
    "doctor",
    scriptPayload,
    scriptPayload,
    1,
    "published",
    nowMig,
    nowMig
  );

  // 欢迎 mp 码若有模板则挂上；无模板时 migrate 会 warn 并跳过
  db.prepare(
    `INSERT INTO qiwe_weapp_templates(
      doctor_id,code,source_type,source_page,source_short_link,title,app_id,username,page_path,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?)`
  ).run(
    migDid,
    "979",
    "test",
    "welcome",
    "#小程序://test/979",
    "联络表测试",
    "wx_test",
    "gh_test",
    "/pages/form",
    nowMig
  );

  const mig1 = migrate.migrateDoctor(migDid);
  ok(mig1 && mig1.migrated === true, "migrateDoctor 首次应迁移");

  const codeTrig = db
    .prepare("SELECT * FROM outbound_triggers WHERE doctor_id=? AND kind='code' AND code=?")
    .get(migDid, "101");
  ok(!!codeTrig, "迁移后存在 code=101 触发");

  const codeSteps = repo.getTrigger(migDid, codeTrig.id);
  ok(codeSteps && codeSteps.steps && codeSteps.steps.length >= 2, "101 steps 至少 2（script text + mp）");
  const step0Asset = db
    .prepare("SELECT * FROM outbound_assets WHERE id=?")
    .get(codeSteps.steps[0].assetId);
  ok(step0Asset && step0Asset.type === "text", "steps[0] 为 script text");
  const step0Payload = JSON.parse(step0Asset.payload || "{}");
  ok(step0Payload.text === "迁移前置话术CODE101", "steps[0] text 含 code101 文案");
  const step1Asset = db
    .prepare("SELECT * FROM outbound_assets WHERE id=?")
    .get(codeSteps.steps[1].assetId);
  ok(step1Asset && step1Asset.type === "mp", "steps[1] 为 mp");

  const skippedQr = db
    .prepare("SELECT COUNT(*) c FROM outbound_assets WHERE doctor_id=? AND type='qr'")
    .get(migDid).c;
  ok(skippedQr === 0, "qr 响应被跳过未建 asset");

  const joinMig = db
    .prepare("SELECT * FROM outbound_triggers WHERE doctor_id=? AND kind='join' LIMIT 1")
    .get(migDid);
  ok(!!joinMig, "迁移后存在 kind=join 触发");
  const joinSteps = repo.getTrigger(migDid, joinMig.id);
  ok(joinSteps && joinSteps.steps && joinSteps.steps.length >= 1, "join 至少有欢迎 text");
  const join0 = db.prepare("SELECT * FROM outbound_assets WHERE id=?").get(joinSteps.steps[0].assetId);
  ok(join0 && join0.type === "text", "join steps[0] text");
  const join0p = JSON.parse(join0.payload || "{}");
  ok(join0p.text === "欢迎加入迁移测试群", "join 首步 = groupWelcome");
  ok(join0.group_code === "welcome", "welcome group_code");

  const welcomeMp = joinSteps.steps.find((s) => {
    const a = db.prepare("SELECT * FROM outbound_assets WHERE id=?").get(s.assetId);
    return a && a.type === "mp";
  });
  ok(!!welcomeMp, "join 含模板 979 的 mp 步");

  const mig2 = migrate.migrateDoctor(migDid);
  ok(mig2 && mig2.skipped === true, "migrateDoctor 二次跳过（已有 triggers）");

  const allSkip = migrate.migrateAllDoctors();
  ok(allSkip && allSkip.skipped === true, "migrateAllDoctors 因 patch 已应用而跳过");

  // --- Task 4: engine.match 走 outbound ---
  const engine = require("./engine.js");
  const engHit = engine.match(doctor.id, "101");
  ok(!!engHit, "engine.match 命中 101");
  ok(engHit && engHit.source === "outbound", "engine.match source=outbound");
  ok(engHit && engHit.code === "101", "engine.match code=101");
  ok(engHit && engHit.responses && engHit.responses.length === 3, "engine.match 返回 3 步（无需 withConfiguredCodeScript）");
  ok(engHit && engHit.responses[0].type === "text", "engine.match responses[0] text");
  ok(engHit && engHit.responses[2].type === "mp", "engine.match responses[2] mp");

  // 已迁移医生：outbound 未命中时不回落 rules
  const engMiss = engine.match(doctor.id, "zzz-no-such-code-99999");
  ok(engMiss === null, "有 outbound 配置时未命中返回 null（不回落 rules）");

  // 无 outbound 的医生仍走 rules
  const bareInfo = db
    .prepare("INSERT INTO doctors(slug,name,active) VALUES(?,?,1)")
    .run("outbound-bare-" + Date.now(), "无outbound医生");
  const bareDid = bareInfo.lastInsertRowid;
  db.prepare(
    `INSERT INTO rules(doctor_id,code,aliases,match_type,bot,responses,enabled,sort)
     VALUES(?,?,?,?,?,?,1,0)`
  ).run(
    bareDid,
    "777",
    JSON.stringify([]),
    "exact",
    "小宝医助",
    JSON.stringify([{ type: "text", text: "rules兜底" }])
  );
  ok(resolve.hasOutboundConfig(bareDid) === false, "bare 医生无 outbound");
  const rulesHit = engine.match(bareDid, "777");
  ok(!!rulesHit && !rulesHit.source, "无 outbound 时 engine 走 rules（无 source=outbound）");
  ok(
    rulesHit && rulesHit.code === "777" && rulesHit.responses && rulesHit.responses[0].text === "rules兜底",
    "无 outbound 时 rules 命中正确"
  );

  // --- Task 5: joinHit → prepareDelivery 欢迎 payload（与 fireGroupWelcome outbound 分支同口径）---
  const deliveryMod = require("./modules/qiwe/delivery.js");
  const cardsMod = require("./modules/qiwe/cards.js");
  const joinWel = resolve.matchJoin(migDid);
  ok(!!joinWel && joinWel.responses && joinWel.responses.length >= 1, "Task5 matchJoin 有 responses");
  const welFirstMp = (joinWel.responses || []).find(
    (r) => r && (r.type === "mp" || r.type === "mini_program") && (r.weappCode || r.templateCode)
  );
  const welReply = {
    code: welFirstMp ? String(welFirstMp.weappCode || welFirstMp.templateCode) : "welcome",
    responses: joinWel.responses,
    source: "outbound",
  };
  const welPlan = deliveryMod.prepareDelivery(migDid, welReply, "入群测", { isGroup: true });
  let welCodes = Array.isArray(welPlan.weappCodes) ? welPlan.weappCodes.slice() : [];
  if (!welCodes.length) {
    welCodes = cardsMod.resolveMultiWeappCodes(migDid, cardsMod.nativeWeappResponses(welReply));
  }
  ok(welCodes.includes("979"), "Task5 prepareDelivery/join 含 979 weappCode");
  ok(
    String(welPlan.replyText || "").indexOf("欢迎加入迁移测试群") >= 0,
    "Task5 prepareDelivery replyText 含 join 欢迎文案"
  );

  // --- Task 6: updateTrigger / deleteTrigger ---
  const updTrig = repo.updateTrigger(doctor.id, trigger.id, {
    aliases: ["一百零一", "yi0yi"],
    enabled: true,
    steps: [
      { assetId: rText1.id, sort: 0, enabled: true },
      { assetId: rMp.id, sort: 1, enabled: true },
    ],
  });
  ok(updTrig && updTrig.aliases && updTrig.aliases.indexOf("yi0yi") >= 0, "updateTrigger 更新 aliases");
  ok(updTrig && updTrig.steps && updTrig.steps.length === 2, "updateTrigger 写入 steps");
  ok(updTrig.steps[0].assetId === rText1.id && updTrig.steps[1].assetId === rMp.id, "updateTrigger steps 顺序");

  const updWrongTrig = repo.updateTrigger(doctorB.id, trigger.id, { aliases: ["hack"] });
  ok(updWrongTrig === null, "updateTrigger 错误 doctorId 返回 null");

  let updMismatch = false;
  try {
    repo.updateTrigger(doctor.id, trigger.id, {
      steps: [{ assetId: foreignAsset.id, sort: 0 }],
    });
  } catch (e) {
    updMismatch = e.code === "ASSET_DOCTOR_MISMATCH";
    ok(e.code === "ASSET_DOCTOR_MISMATCH", "updateTrigger 跨医生 asset 抛 ASSET_DOCTOR_MISMATCH");
  }
  ok(updMismatch, "updateTrigger 拒绝跨医生 asset");

  const delTrig = repo.createTrigger({
    doctorId: doctor.id,
    kind: "code",
    code: "del-me",
    matchType: "exact",
  });
  const delAsset = repo.createAsset({
    doctorId: doctor.id,
    type: "text",
    title: "to-del-trig",
    payload: { text: "x" },
    groupCode: "del-me",
  });
  repo.replaceSteps(doctor.id, delTrig.id, [{ assetId: delAsset.id, sort: 0 }]);
  ok(repo.deleteTrigger(doctor.id, delTrig.id) === true, "deleteTrigger 成功");
  ok(!repo.getTrigger(doctor.id, delTrig.id), "deleteTrigger 后 getTrigger null");
  const orphanStep = db
    .prepare("SELECT COUNT(*) c FROM outbound_trigger_steps WHERE trigger_id=?")
    .get(delTrig.id).c;
  ok(orphanStep === 0, "deleteTrigger 级联清 steps");
  ok(repo.deleteTrigger(doctor.id, delTrig.id) === false, "deleteTrigger 重复删除返回 false");
  ok(repo.deleteTrigger(doctorB.id, trigger.id) === false, "deleteTrigger 错误 doctorId 返回 false");
  // 素材仍在（deleteTrigger 不删 asset）
  ok(!!db.prepare("SELECT id FROM outbound_assets WHERE id=?").get(delAsset.id), "deleteTrigger 保留 asset");
} catch (e) {
  console.error(e);
  process.exit(1);
}

(async () => {
  try {
    const qiwe = require("./qiwe.js");
    const bridge = require("./qiwe_bridge.js");
    const cardsMod = require("./modules/qiwe/cards.js");
    const deliveryMod = require("./modules/qiwe/delivery.js");
    const resolve = require("./modules/outbound/resolve.js");

    const migDoc = db.prepare("SELECT id FROM doctors WHERE slug LIKE 'outbound-mig-%' ORDER BY id DESC LIMIT 1").get();
    ok(!!migDoc, "Task5 fireGroupWelcome 用迁移医生");
    qiwe.saveConfig({
      enabled: true,
      autoSend: false,
      allowGroup: true,
      token: "tok",
      guid: "guid-out-wel",
      selfUserId: "self-1",
      testToId: "self-1,room-out-wel",
    });
    const joinHit = resolve.matchJoin(migDoc.id);
    const firstMp = (joinHit.responses || []).find(
      (r) => r && (r.type === "mp" || r.type === "mini_program") && (r.weappCode || r.templateCode)
    );
    const reply = {
      code: firstMp ? String(firstMp.weappCode || firstMp.templateCode) : "welcome",
      responses: joinHit.responses,
      source: "outbound",
    };
    const plan = deliveryMod.prepareDelivery(migDoc.id, reply, "出站测甲", { isGroup: true });
    let expectCodes = Array.isArray(plan.weappCodes) ? plan.weappCodes.slice() : [];
    if (!expectCodes.length) {
      expectCodes = cardsMod.resolveMultiWeappCodes(migDoc.id, cardsMod.nativeWeappResponses(reply));
    }
    const r = await bridge.fireGroupWelcome(
      { fromRoomId: "room-out-wel", senderId: "1688857254811888", senderName: "出站测甲" },
      qiwe.loadConfig(),
      migDoc.id
    );
    ok(!!r.welcomeOutboxId, "Task5 fireGroupWelcome 入队");
    const row = db.prepare("SELECT payload, text FROM outbound_queue WHERE id=?").get(r.welcomeOutboxId);
    const payload = JSON.parse((row && row.payload) || "{}");
    ok(
      Array.isArray(payload.qiwe.weappCodes) && payload.qiwe.weappCodes.join(",") === expectCodes.join(","),
      "Task5 fireGroupWelcome weappCodes=join/prepareDelivery"
    );
    ok(
      JSON.stringify(payload.qiwe.linkCards || []) === JSON.stringify(plan.linkCards || []),
      "Task5 fireGroupWelcome linkCards=join/prepareDelivery（非 welcomeVideo）"
    );
    ok(String(row.text || "").indexOf("出站测甲") >= 0, "Task5 欢迎语含 @姓名");
    const expectText = deliveryMod.joinWelcomeTextFromResponses(joinHit.responses, "出站测甲");
    ok(
      String(row.text || "").indexOf(String(expectText || "").trim()) >= 0,
      "Task5 欢迎语与 join text 资产一致（不含 mp 标题行）"
    );
  } catch (e) {
    console.error(e);
    fails.push("Task5 fireGroupWelcome: " + ((e && e.message) || e));
  }

  console.log("\n断言 " + n + " 条，失败 " + fails.length);
  if (fails.length) {
    fails.forEach((f) => console.log("FAIL:", f));
    process.exit(1);
  }
  console.log("ALL PASS");
  process.exit(0);
})();
